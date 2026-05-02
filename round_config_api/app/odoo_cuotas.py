"""Operaciones sobre cuotas/recibos en Odoo (round_facturacion).

Wrappers XML-RPC para:
- Generar preemisión (borradores account.move) desde suscripciones activas
- Listar recibos por cliente, por mes, con filtros
- Modificar/eliminar borradores
- Emitir remesa: posting account.move + crear payment.order SEPA
- Descargar fichero pain.008
"""
import logging
import base64
import xmlrpc.client
from datetime import date, datetime, timedelta
from . import config as cfg

log = logging.getLogger(__name__)


class OdooCuotas:
    def __init__(self):
        self._uid = None
        self._models = None

    def _connect(self):
        if self._uid is not None:
            return True
        try:
            common = xmlrpc.client.ServerProxy(f'{cfg.ODOO_URL}/xmlrpc/2/common', allow_none=True)
            self._uid = common.authenticate(cfg.ODOO_DB, cfg.ODOO_USER, cfg.ODOO_PWD, {})
            if not self._uid:
                return False
            self._models = xmlrpc.client.ServerProxy(f'{cfg.ODOO_URL}/xmlrpc/2/object', allow_none=True)
            return True
        except Exception as e:
            log.error(f'Odoo connect: {e}')
            return False

    def _call(self, model, method, *args, **kwargs):
        if not self._connect():
            raise RuntimeError('Odoo no disponible')
        try:
            return self._models.execute_kw(
                cfg.ODOO_DB, self._uid, cfg.ODOO_PWD,
                model, method, list(args), kwargs
            )
        except xmlrpc.client.Fault as e:
            if 'cannot marshal None' in str(e):
                return True
            raise

    # ── Helpers de fechas ────────────────────────────────────────────────────
    def _periodos_mes(self, mes_str):
        """mes_str = 'YYYY-MM' → (fecha_inicio, fecha_fin) de ese mes."""
        y, m = map(int, mes_str.split('-'))
        inicio = date(y, m, 1)
        fin = date(y + (m == 12), 1 if m == 12 else m + 1, 1) - timedelta(days=1)
        return inicio, fin

    def _meses_periodicidad(self, periodicidad):
        return {'mensual':1,'bimensual':2,'trimestral':3,'semestral':6,'anual':12}.get(periodicidad,1)

    # ── Preemisión: crea borradores account.move desde suscripciones activas ──
    def generar_preemision(self, mes_str):
        """Para cada suscripción activa, si toca recibo este mes y no existe ya
        un borrador/posted del mes, crea account.move en estado draft."""
        inicio, fin = self._periodos_mes(mes_str)

        subs = self._call('round.subscription','search_read',
            [('estado','=','activa')],
            ['id','partner_id','cuota_id','periodicidad','forma_pago','mandate_id',
             'pasarela_id','trainer_analytic_id','company_id','descuentos_activos_ids',
             'fecha_inicio','token_tarjeta'])
        log.info(f'Preemisión {mes_str}: {len(subs)} suscripciones activas')

        creados, ya_emitido, no_aplica = [], [], []

        for s in subs:
            sub_id = s['id']
            # Comprobar si ya existe recibo de este mes
            existing = self._call('account.move','search',
                [('round_subscription_id','=',sub_id),
                 ('move_type','=','out_invoice'),
                 ('invoice_date','>=',str(inicio)),
                 ('invoice_date','<=',str(fin))], limit=1)
            if existing:
                ya_emitido.append({'subscription_id': sub_id, 'invoice_id': existing[0]})
                continue

            # ¿toca recibo este mes según periodicidad?
            if not self._toca_emitir(sub_id, s, mes_str):
                no_aplica.append(sub_id)
                continue

            # Calcular importe + descripción
            calc = self._calcular_importe(s, mes_str)
            tipo = self._detectar_tipo(sub_id)

            # Crear borrador
            partner_id = s['partner_id'][0]
            cuota_id = s['cuota_id'][0]
            cuota = self._call('round.cuota.catalogo','read',[cuota_id],['codigo','descripcion','product_id'])[0]
            descripcion = f"Cuota {cuota['codigo']} {mes_str}"
            if tipo == 'alta':
                descripcion += ' (alta)'

            line_vals = [(0,0,{
                'name': descripcion,
                'quantity': 1,
                'price_unit': calc['precio_final'],
                'product_id': cuota['product_id'][0] if cuota.get('product_id') else False,
            })]
            # Notas en narration (queda como referencia para el banco)
            narration = ''
            if calc['descuentos']:
                narration += f"Descuentos aplicados: {', '.join(calc['descuentos'])}\n"
            if calc['modificaciones']:
                narration += f"Modificaciones: {', '.join(calc['modificaciones'])}\n"

            invoice_vals = {
                'partner_id': partner_id,
                'move_type': 'out_invoice',
                'invoice_date': str(date.today()),
                'invoice_date_due': str(fin),
                'invoice_line_ids': line_vals,
                'round_subscription_id': sub_id,
                'narration': narration or False,
                'company_id': s.get('company_id', [1])[0] if isinstance(s.get('company_id'), list) else 1,
            }
            # Mandato + payment_mode si SEPA
            if s.get('forma_pago') == 'sepa' and s.get('mandate_id'):
                invoice_vals['mandate_id'] = s['mandate_id'][0]
                # Payment mode SEPA Direct Debit
                pm = self._call('account.payment.mode','search',
                    [('payment_method_id.code','=','sepa_direct_debit')], limit=1)
                if pm:
                    invoice_vals['payment_mode_id'] = pm[0]

            inv_id = self._call('account.move','create', invoice_vals)
            creados.append({
                'subscription_id': sub_id,
                'invoice_id': inv_id,
                'partner_id': partner_id,
                'tipo': tipo,
                'precio_base': calc['precio_base'],
                'descuentos_total': calc['descuentos_total'],
                'modificaciones_total': calc['modificaciones_total'],
                'precio_final': calc['precio_final'],
            })

        return {
            'mes': mes_str,
            'creados': creados,
            'ya_emitido': ya_emitido,
            'no_aplica': no_aplica,
        }

    def _toca_emitir(self, sub_id, s, mes_str):
        """¿Toca emitir recibo este mes? Mensual = siempre. Otras periodicidades:
        cuando han pasado N meses desde el último recibo."""
        per = s.get('periodicidad','mensual')
        meses = self._meses_periodicidad(per)
        if meses == 1:
            # Mensual: comprobar también que la fecha_inicio sea anterior o igual al mes
            inicio_sub = s.get('fecha_inicio')
            if inicio_sub:
                if isinstance(inicio_sub, str): inicio_sub = inicio_sub[:7]
                if inicio_sub > mes_str: return False
            return True
        # Buscar último recibo
        last = self._call('account.move','search_read',
            [('round_subscription_id','=',sub_id),('move_type','=','out_invoice')],
            ['invoice_date'], limit=1, order='invoice_date desc')
        if not last:
            return True  # nunca se ha emitido → emitir ahora
        last_date = last[0].get('invoice_date')
        if not last_date:
            return True
        # Calcular si han pasado >= meses desde la última
        y0, m0 = map(int, last_date[:7].split('-'))
        y1, m1 = map(int, mes_str.split('-'))
        diff = (y1 - y0) * 12 + (m1 - m0)
        return diff >= meses

    def _detectar_tipo(self, sub_id):
        """Si la suscripción no tiene recibos previos → alta. Si los tiene → mensualidad."""
        n = self._call('account.move','search_count',
            [('round_subscription_id','=',sub_id),('move_type','=','out_invoice')])
        return 'alta' if n == 0 else 'mensualidad'

    def _calcular_importe(self, s, mes_str):
        """Aplica precio base, descuentos y modificaciones."""
        cuota = self._call('round.cuota.catalogo','read',[s['cuota_id'][0]],
            ['precio_mensual','precio_trimestral','precio_semestral','precio_anual','matricula'])[0]
        per = s.get('periodicidad','mensual')
        precio_base = float({
            'mensual':    cuota.get('precio_mensual',0),
            'trimestral': cuota.get('precio_trimestral',0),
            'semestral':  cuota.get('precio_semestral',0),
            'anual':      cuota.get('precio_anual',0),
        }.get(per, cuota.get('precio_mensual',0)))

        # Descuentos activos en la suscripción
        desc_codes, desc_total = [], 0.0
        if s.get('descuentos_activos_ids'):
            descs = self._call('round.descuento.catalogo','read',
                s['descuentos_activos_ids'], ['codigo','tipo','valor'])
            for d in descs:
                if d['tipo'] == 'porcentaje':
                    desc_total += precio_base * (float(d['valor'])/100.0)
                else:
                    desc_total += float(d['valor'])
                desc_codes.append(d['codigo'])

        # Modificaciones vigentes este mes
        inicio, fin = self._periodos_mes(mes_str)
        mods = self._call('round.modificacion.recibo','search_read',
            [('subscription_id','=',s['id']),('estado','=','activa'),
             ('fecha_desde','<=',str(fin)),
             '|',('fecha_hasta','=',False),('fecha_hasta','>=',str(inicio))],
            ['id','tipo','valor','razon'])
        mod_descs, mod_total = [], 0.0
        for m in mods:
            v = float(m['valor'])
            if m['tipo'] == 'descuento':
                mod_total -= v
            elif m['tipo'] == 'cargo_extra':
                mod_total += v
            elif m['tipo'] == 'precio_alternativo':
                # sustituye el base
                precio_base = v
            mod_descs.append(f"{m['tipo']} {v}€")

        precio_final = max(0.0, precio_base - desc_total + mod_total)
        return {
            'precio_base': precio_base,
            'descuentos': desc_codes,
            'descuentos_total': round(desc_total, 2),
            'modificaciones': mod_descs,
            'modificaciones_total': round(mod_total, 2),
            'precio_final': round(precio_final, 2),
        }

    # ── Listados ─────────────────────────────────────────────────────────────
    def list_borradores_mes(self, mes_str):
        inicio, fin = self._periodos_mes(mes_str)
        return self._list_recibos([('state','=','draft'),
                                   ('move_type','=','out_invoice'),
                                   ('invoice_date','>=',str(inicio)),
                                   ('invoice_date','<=',str(fin))])

    def list_recibos_filtrado(self, mes_str=None, estado=None, partner_id=None):
        domain = [('move_type','=','out_invoice'),('round_subscription_id','!=',False)]
        if mes_str:
            inicio, fin = self._periodos_mes(mes_str)
            domain += [('invoice_date','>=',str(inicio)),('invoice_date','<=',str(fin))]
        if estado:
            domain.append(('payment_state','=',estado))
        if partner_id:
            domain.append(('partner_id','=',partner_id))
        return self._list_recibos(domain)

    def list_recibos_cliente(self, id_noofit):
        partner_ids = self._call('res.partner','search',[('id_noofit','=',str(id_noofit))],limit=1)
        if not partner_ids:
            return []
        return self._list_recibos([('move_type','=','out_invoice'),
                                   ('partner_id','=',partner_ids[0])])

    def _list_recibos(self, domain):
        invs = self._call('account.move','search_read', domain,
            ['id','name','invoice_date','invoice_date_due','amount_total','state',
             'payment_state','partner_id','round_subscription_id','narration',
             'payment_mode_id','mandate_id','create_date'],
            order='invoice_date desc')
        # Enriquecer con datos de la suscripción y cuota
        result = []
        for i in invs:
            row = {**i}
            # Resolver tipo (alta/mensualidad)
            if i.get('round_subscription_id'):
                sub = self._call('round.subscription','read',[i['round_subscription_id'][0]],
                    ['cuota_id','forma_pago','periodicidad'])[0]
                row['cuota_codigo'] = sub.get('cuota_id', [None,''])[1] if sub.get('cuota_id') else ''
                row['forma_pago'] = sub.get('forma_pago')
                row['periodicidad'] = sub.get('periodicidad')
            # Detectar tipo: si es el primer recibo de la sub
            row['tipo'] = self._detectar_tipo_invoice(i)
            # mes referencia
            if i.get('invoice_date'):
                row['mes_ref'] = i['invoice_date'][:7]
            result.append(row)
        return result

    def _detectar_tipo_invoice(self, inv):
        if not inv.get('round_subscription_id'):
            return None
        # Si es el invoice más antiguo de su sub → alta
        oldest = self._call('account.move','search',
            [('round_subscription_id','=',inv['round_subscription_id'][0]),
             ('move_type','=','out_invoice')],
            order='invoice_date asc', limit=1)
        return 'alta' if oldest and oldest[0] == inv['id'] else 'mensualidad'

    # ── Modificar borrador ───────────────────────────────────────────────────
    def update_borrador(self, invoice_id, vals):
        """Actualiza precio (line price_unit), narration o descripción."""
        inv = self._call('account.move','read',[invoice_id],['state','invoice_line_ids'])[0]
        if inv['state'] != 'draft':
            raise ValueError('Solo se pueden modificar borradores')
        # Update narration
        if 'narration' in vals or 'notas' in vals:
            self._call('account.move','write',[invoice_id],{'narration': vals.get('narration') or vals.get('notas')})
        # Update precio
        if 'precio' in vals and inv.get('invoice_line_ids'):
            line_id = inv['invoice_line_ids'][0]
            self._call('account.move.line','write',[line_id],
                {'price_unit': float(vals['precio'])})
        # Update fecha
        if 'invoice_date_due' in vals:
            self._call('account.move','write',[invoice_id],{'invoice_date_due': vals['invoice_date_due']})
        return self._list_recibos([('id','=',invoice_id)])[0]

    def delete_borrador(self, invoice_id):
        inv = self._call('account.move','read',[invoice_id],['state'])[0]
        if inv['state'] != 'draft':
            raise ValueError('Solo se pueden eliminar borradores')
        return self._call('account.move','unlink',[invoice_id])

    # ── Emisión: post + crear payment.order SEPA + generar fichero ───────────
    def emitir_remesa(self, mes_str):
        """1. Post all borradores del mes
           2. Crear payment.order SEPA con todos los SEPA del mes
           3. Generar fichero pain.008
        """
        inicio, fin = self._periodos_mes(mes_str)
        borradores = self._call('account.move','search',
            [('state','=','draft'),('move_type','=','out_invoice'),
             ('invoice_date','>=',str(inicio)),('invoice_date','<=',str(fin)),
             ('round_subscription_id','!=',False)])
        if not borradores:
            return {'ok': False, 'error': 'no_drafts'}

        # Post (action_post)
        self._call('account.move','action_post', borradores)
        log.info(f'Emisión {mes_str}: {len(borradores)} recibos posted')

        # Crear payment.order SEPA
        sepa_pm = self._call('account.payment.mode','search',
            [('payment_method_id.code','=','sepa_direct_debit')],limit=1)
        sepa_attachment_id = None
        sepa_filename = None
        if sepa_pm:
            sepa_invoices = self._call('account.move','search',
                [('id','in',borradores),('payment_mode_id','=',sepa_pm[0])])
            if sepa_invoices:
                po_id = self._call('account.payment.order','create',{
                    'payment_type':'inbound',
                    'payment_mode_id': sepa_pm[0],
                    'date_prefered':'due',
                    'company_id': cfg.ODOO_COMPANY,
                })
                # Añadir líneas con cada move.line de cuenta a cobrar
                for inv_id in sepa_invoices:
                    inv = self._call('account.move','read',[inv_id],
                        ['name','partner_id','amount_residual','date','mandate_id','currency_id'])[0]
                    mlines = self._call('account.move.line','search',
                        [('move_id','=',inv_id),
                         ('account_id.account_type','=','asset_receivable'),
                         ('parent_state','=','posted')])
                    if not mlines or not inv.get('mandate_id'):
                        continue
                    # Buscar partner_bank
                    acc = self._call('res.partner.bank','search',
                        [('partner_id','=',inv['partner_id'][0])], limit=1)
                    self._call('account.payment.line','create',{
                        'order_id': po_id,
                        'partner_id': inv['partner_id'][0],
                        'move_line_id': mlines[0],
                        'mandate_id': inv['mandate_id'][0],
                        'partner_bank_id': acc[0] if acc else False,
                        'communication': inv['name'],
                        'communication_type':'normal',
                        'amount_currency': inv['amount_residual'],
                        'currency_id': inv['currency_id'][0],
                        'date': inv['date'],
                    })
                # Confirmar y generar
                self._call('account.payment.order','draft2open',[po_id])
                self._call('account.payment.order','open2generated',[po_id])
                # Coger adjunto
                attachs = self._call('ir.attachment','search_read',
                    [('res_model','=','account.payment.order'),('res_id','=',po_id)],
                    ['id','name','datas'])
                if attachs:
                    sepa_attachment_id = attachs[0]['id']
                    sepa_filename = attachs[0]['name']

        return {
            'ok': True,
            'mes': mes_str,
            'recibos_emitidos': len(borradores),
            'sepa_attachment_id': sepa_attachment_id,
            'sepa_filename': sepa_filename,
        }

    def descargar_sepa(self, attachment_id):
        att = self._call('ir.attachment','read',[attachment_id],['name','datas','mimetype'])
        if not att:
            return None
        a = att[0]
        return {
            'filename': a['name'],
            'mimetype': a.get('mimetype') or 'application/xml',
            'content_b64': a['datas'],
        }


_singleton = None
def get_cuotas():
    global _singleton
    if _singleton is None:
        _singleton = OdooCuotas()
    return _singleton
