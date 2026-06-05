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
    """Cliente XML-RPC a Odoo, con awareness de multi-company.

    Cada instancia está vinculada a UN manager Round (`id_manager`). De ahí
    resuelve la `company_id` en Odoo (vía `manager_config.odoo_company_id`)
    y, opcionalmente, la URL de Odoo si el manager tiene una propia
    (`manager_config.odoo_url`). Si `id_manager` es None se usan los
    defaults del `.env` (`ODOO_URL`, `ODOO_COMPANY`) — comportamiento
    histórico para no romper código legacy.

    Toda búsqueda que pase por `_call_scoped(...)` lleva inyectado
    automáticamente `('company_id','=',self.company_id)` en el dominio,
    evitando filtraciones entre managers cuando convivan varias compañías
    en el mismo Odoo.
    """

    def __init__(self, id_manager=None):
        self._uid = None
        self._models = None
        self._id_manager = str(id_manager) if id_manager else None
        # Lazy: company_id y odoo_url se resuelven en la primera conexión
        self._company_id = None
        self._odoo_url = None

    # ── Resolución de identidad del manager ─────────────────────────────────
    def _ensure_identity(self):
        """Resuelve company_id y odoo_url desde manager_config (lazy)."""
        if self._company_id is not None:
            return
        if self._id_manager:
            try:
                from .db import get_conn
                with get_conn() as conn, conn.cursor() as cur:
                    cur.execute("""
                        SELECT odoo_company_id, odoo_url
                          FROM manager_config
                         WHERE id_manager = %s
                    """, (self._id_manager,))
                    row = cur.fetchone()
                if row and row.get('odoo_company_id'):
                    self._company_id = int(row['odoo_company_id'])
                    self._odoo_url = (row.get('odoo_url') or '').strip() or None
                    return
                log.warning(f'OdooCuotas: manager_id={self._id_manager} '
                            f'no tiene odoo_company_id en BD; usando default '
                            f'cfg.ODOO_COMPANY={cfg.ODOO_COMPANY}')
            except Exception as e:
                log.exception(f'OdooCuotas: error resolviendo identidad '
                              f'del manager {self._id_manager}: {e}')
        # Fallback al .env (manager histórico Round, id=17675, company_id=3)
        self._company_id = int(cfg.ODOO_COMPANY)
        self._odoo_url = None

    @property
    def company_id(self):
        self._ensure_identity()
        return self._company_id

    @property
    def odoo_url(self):
        self._ensure_identity()
        return self._odoo_url or cfg.ODOO_URL

    # ── XML-RPC ────────────────────────────────────────────────────────────
    def _connect(self):
        if self._uid is not None:
            return True
        try:
            url = self.odoo_url  # resuelve identity también
            common = xmlrpc.client.ServerProxy(f'{url}/xmlrpc/2/common', allow_none=True)
            self._uid = common.authenticate(cfg.ODOO_DB, cfg.ODOO_USER, cfg.ODOO_PWD, {})
            if not self._uid:
                return False
            self._models = xmlrpc.client.ServerProxy(f'{url}/xmlrpc/2/object', allow_none=True)
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

    def _call_ctx(self, model, method, ctx, *args, **kwargs):
        if not self._connect():
            raise RuntimeError('Odoo no disponible')
        kwargs['context'] = ctx
        try:
            return self._models.execute_kw(
                cfg.ODOO_DB, self._uid, cfg.ODOO_PWD,
                model, method, list(args), kwargs
            )
        except xmlrpc.client.Fault as e:
            if 'cannot marshal None' in str(e):
                return True
            raise

    # ── Helper defensivo multi-company ─────────────────────────────────────
    @staticmethod
    def _domain_has_company(domain):
        """Inspecciona el dominio para ver si ya hay una tupla company_id."""
        if not domain:
            return False
        for term in domain:
            if isinstance(term, (list, tuple)) and len(term) >= 1 and term[0] == 'company_id':
                return True
        return False

    def _call_scoped(self, model, method, domain, *args, **kwargs):
        """Como `_call` pero auto-inyecta `('company_id','=',self.company_id)`
        en el dominio si no estaba ya. Solo para métodos que aceptan dominio
        como primer argumento: search, search_read, search_count.

        IMPORTANTE: para `read([ids])` o `create({...})` NO usar esto — los
        primeros argumentos no son un dominio.
        """
        if not self._domain_has_company(domain):
            domain = [('company_id', '=', self.company_id)] + list(domain or [])
        return self._call(model, method, domain, *args, **kwargs)

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

        subs = self._call_scoped('round.subscription','search_read',
            [('estado','=','activa')],
            fields=['id','partner_id','cuota_id','periodicidad','forma_pago','mandate_id',
             'pasarela_id','trainer_analytic_id','company_id','descuentos_activos_ids',
             'fecha_inicio','token_tarjeta'])
        log.info(f'Preemisión {mes_str}: {len(subs)} suscripciones activas')

        creados, ya_emitido, no_aplica = [], [], []

        for s in subs:
            sub_id = s['id']
            # Comprobar si ya existe recibo de este mes
            existing = self._call_scoped('account.move','search',
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

            # Multi-trainer (Fase 4): si la subscription tiene
            # trainer_analytic_id, propagar a analytic_distribution de la
            # línea para que el reporte por trainer funcione en Odoo.
            line_extras = {}
            tai = s.get('trainer_analytic_id')
            if tai:
                # tai puede venir como [id, "nombre"] o como int
                aid = tai[0] if isinstance(tai, (list, tuple)) else tai
                if aid:
                    line_extras['analytic_distribution'] = {str(aid): 100.0}

            line_vals = [(0,0,{
                'name': descripcion,
                'quantity': 1,
                'price_unit': calc['precio_final'],
                'product_id': cuota['product_id'][0] if cuota.get('product_id') else False,
                **line_extras,
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
                # Payment mode SEPA Direct Debit (per-company en Odoo)
                pm = self._call_scoped('account.payment.mode','search',
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
        last = self._call_scoped('account.move','search_read',
            [('round_subscription_id','=',sub_id),('move_type','=','out_invoice')],
            fields=['invoice_date'], limit=1, order='invoice_date desc')
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
        n = self._call_scoped('account.move','search_count',
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
        mods = self._call_scoped('round.modificacion.recibo','search_read',
            [('subscription_id','=',s['id']),('estado','=','activa'),
             ('fecha_desde','<=',str(fin)),
             '|',('fecha_hasta','=',False),('fecha_hasta','>=',str(inicio))],
            fields=['id','tipo','valor','razon'])
        mod_descs, mod_total = [], 0.0
        for m in mods:
            v = float(m['valor'])
            # Math por SIGNO de valor: positivo suma, negativo resta.
            # `tipo` queda como etiqueta; `precio_alternativo` sustituye base.
            if m['tipo'] in ('descuento', 'cargo_extra'):
                mod_total += v
            elif m['tipo'] == 'precio_alternativo':
                precio_base = abs(v)
            mod_descs.append(f"{m['tipo']} {'+' if v >= 0 else '−'}{abs(v)}€")

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
        # Mostramos recibos de cuota: los emitidos por el flujo round
        # (round_subscription_id) Y los importados a Odoo como facturas
        # sueltas con ref 'RB-<recibo_id>' (p.ej. la migración de recibos
        # Añoreta 2026-06, que no tienen round.subscription). El post-filtro
        # por trainer (partner_idnoofit ∈ cliente_cache) los aísla por centro.
        domain = [('move_type','=','out_invoice'),
                  '|', ('round_subscription_id','!=',False),
                       ('ref','=like','RB-%')]
        if mes_str:
            inicio, fin = self._periodos_mes(mes_str)
            domain += [('invoice_date','>=',str(inicio)),('invoice_date','<=',str(fin))]
        if estado:
            domain.append(('payment_state','=',estado))
        if partner_id:
            domain.append(('partner_id','=',partner_id))
        return self._list_recibos(domain)

    def list_recibos_cliente(self, id_noofit):
        # IMPORTANTE: hay clientes con varios partners Odoo duplicados con el
        # mismo id_noofit (residuo de altas previas que crearon ghost partners).
        # Buscamos TODOS los partners y devolvemos los recibos de TODOS — si
        # filtrásemos al primero (limit=1) los recibos emitidos contra el
        # otro partner quedarían invisibles para el operador.
        partner_ids = self._call('res.partner','search',
                                 [('id_noofit','=',str(id_noofit))])
        if not partner_ids:
            return []
        return self._list_recibos([('move_type','=','out_invoice'),
                                   ('partner_id','in',partner_ids)])


    def generar_pdf_factura(self, invoice_id):
        """Genera el PDF de una factura via el endpoint HTTP de Odoo
        (`/report/pdf/account.report_invoice/<id>`).
        Devuelve (filename, bytes_pdf).

        XML-RPC no permite llamar a `_render_qweb_pdf` (método privado),
        así que autenticamos sesión vía /web/session/authenticate y
        descargamos el PDF como cualquier navegador haría.
        """
        import requests
        from . import config as cfg

        sess = requests.Session()
        # 1) Autenticar (sesión cookie)
        auth_url = f'{cfg.ODOO_URL}/web/session/authenticate'
        r = sess.post(auth_url, json={
            'jsonrpc': '2.0',
            'params': {
                'db': cfg.ODOO_DB,
                'login': cfg.ODOO_USER,
                'password': cfg.ODOO_PWD,
            },
        }, timeout=15)
        if r.status_code != 200:
            raise RuntimeError(f'Odoo auth fallo {r.status_code}')
        data = r.json() or {}
        if data.get('error') or not (data.get('result') or {}).get('uid'):
            raise RuntimeError(f'Odoo auth: {data.get("error") or "credenciales"}')

        # 2) Descargar el PDF
        # account.report_invoice es el reporte estándar de Odoo Community 17
        report_url = f'{cfg.ODOO_URL}/report/pdf/account.report_invoice/{invoice_id}'
        rp = sess.get(report_url, timeout=30)
        if rp.status_code != 200:
            raise RuntimeError(f'pdf {rp.status_code}: {rp.text[:200]}')
        if not rp.content or not rp.content.startswith(b'%PDF'):
            raise RuntimeError('respuesta no es un PDF válido')

        # 3) Nombre archivo
        inv = self._call('account.move', 'read', [invoice_id], ['name'])[0]
        safe_name = (inv.get('name') or f'factura-{invoice_id}').replace('/', '-')
        return f'{safe_name}.pdf', rp.content


    def enviar_factura_email(self, invoice_id, dest_email=None,
                             id_manager=None, id_trainer=None,
                             extra_message=''):
        """Genera el PDF + envía por email al partner del recibo (o al
        dest_email indicado). Devuelve dict con resultado."""
        import re
        from .email_sender import enviar as enviar_email
        inv = self._call('account.move', 'read', [invoice_id],
            ['name', 'state', 'amount_total', 'partner_id', 'invoice_date',
             'currency_id'])[0]
        if inv.get('state') != 'posted':
            return {'ok': False, 'error': 'factura_no_publicada',
                    'state': inv.get('state')}
        # Resolver destinatario
        if not dest_email:
            partner = self._call('res.partner', 'read',
                                 [inv['partner_id'][0]],
                                 ['email', 'name'])[0]
            dest_email = (partner.get('email') or '').strip()
            partner_name = partner.get('name') or ''
        else:
            dest_email = dest_email.strip()
            partner_name = inv['partner_id'][1] if inv.get('partner_id') else ''
        if not dest_email:
            return {'ok': False, 'error': 'sin_email_destinatario',
                    'partner_email_odoo': None}
        # Validación RFC simple del email
        valid_re = re.compile(r'^[^\s@]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$')
        if not valid_re.match(dest_email):
            return {'ok': False, 'error': 'email_invalido',
                    'email_invalido': dest_email,
                    'detalle': 'El email no cumple RFC 5321 (puede contener guión bajo en el dominio u otro carácter no permitido)'}

        # PDF
        try:
            filename, pdf_bytes = self.generar_pdf_factura(invoice_id)
        except Exception as e:
            return {'ok': False, 'error': f'pdf_fail: {e}'}

        importe = inv.get('amount_total') or 0
        currency_pair = inv.get('currency_id') or [None, '€']
        currency = currency_pair[1] if isinstance(currency_pair, list) else '€'
        subject = f'Factura {inv.get("name")} · Round Training Center'
        body_html = (
            f'<p>Hola{f" <b>{partner_name}</b>" if partner_name else ""},</p>'
            f'<p>Adjuntamos tu factura <b>{inv.get("name")}</b> con fecha '
            f'{inv.get("invoice_date","")} por importe de <b>{importe} {currency}</b>.</p>'
            + (f'<p>{extra_message}</p>' if extra_message else '')
            + '<p>Si tienes cualquier duda, responde a este email.</p>'
            '<p>Un saludo,<br/>Round Training Center</p>'
        )
        body_text = (
            f'Adjuntamos tu factura {inv.get("name")} con fecha '
            f'{inv.get("invoice_date","")} por importe de {importe} {currency}.'
        )
        ok = enviar_email(dest_email, subject, body_text, body_html=body_html,
                          id_manager=id_manager, id_trainer=id_trainer,
                          attachments=[(filename, pdf_bytes, 'application/pdf')])
        return {'ok': bool(ok), 'invoice_name': inv.get('name'),
                'sent_to': dest_email, 'amount': importe}

    def _list_recibos(self, domain):
        invs = self._call('account.move','search_read', domain,
            ['id','name','invoice_date','invoice_date_due','amount_total','state',
             'payment_state','partner_id','round_subscription_id','narration',
             'payment_mode_id','mandate_id','create_date'],
            order='invoice_date desc')
        # Cache para evitar repetir lectura de cuotas / partners
        partners_cache = {}
        cuotas_cache = {}
        # Enriquecer con datos de la suscripción y cuota
        result = []
        for i in invs:
            row = {**i}
            # Datos del partner (id_noofit para cross-ref con NoofitPro)
            partner_pair = i.get('partner_id')
            if partner_pair:
                pid = partner_pair[0]
                if pid not in partners_cache:
                    pdata = self._call('res.partner','read',[pid],
                        ['id_noofit','name'])
                    partners_cache[pid] = pdata[0] if pdata else {}
                pinfo = partners_cache[pid]
                row['partner_idnoofit'] = pinfo.get('id_noofit') or None
            sub_id_pair = i.get('round_subscription_id')
            if sub_id_pair:
                sub_id = sub_id_pair[0]
                sub = self._call('round.subscription','read',[sub_id],
                    ['cuota_id','forma_pago','periodicidad','descuentos_activos_ids'])[0]
                cuota_pair = sub.get('cuota_id')
                row['cuota_codigo'] = cuota_pair[1] if cuota_pair else ''
                row['cuota_id_int'] = cuota_pair[0] if cuota_pair else None
                row['forma_pago'] = sub.get('forma_pago')
                row['periodicidad'] = sub.get('periodicidad')
                # Para SEPA y tokenización, in_payment se considera cobrado
                # (el pago está registrado, pendiente de conciliar con banco)
                if (row.get('payment_state') == 'in_payment'
                        and sub.get('forma_pago') in ('sepa','tarjeta_token','tokenizacion')):
                    row['payment_state'] = 'paid'
                # Actividades incluidas (desc texto)
                if cuota_pair:
                    cid = cuota_pair[0]
                    if cid not in cuotas_cache:
                        cd = self._call('round.cuota.catalogo','read',[cid],
                            ['actividades_descripcion','descripcion'])
                        cuotas_cache[cid] = cd[0] if cd else {}
                    cinfo = cuotas_cache[cid]
                    row['cuota_descripcion'] = cinfo.get('descripcion') or ''
                    row['cuota_actividades'] = cinfo.get('actividades_descripcion') or ''

                mes_str = i['invoice_date'][:7] if i.get('invoice_date') else None
                # Descuentos aplicados (con importe)
                desc_aplicados = []
                if sub.get('descuentos_activos_ids') and cuota_pair:
                    descs = self._call('round.descuento.catalogo','read',
                        sub['descuentos_activos_ids'],
                        ['codigo','descripcion','tipo','valor'])
                    cuota = self._call('round.cuota.catalogo','read',
                        [cuota_pair[0]],
                        ['precio_mensual','precio_trimestral','precio_semestral','precio_anual'])[0]
                    per = sub.get('periodicidad','mensual')
                    precio_base = float({
                        'mensual':    cuota.get('precio_mensual') or 0,
                        'trimestral': cuota.get('precio_trimestral') or 0,
                        'semestral':  cuota.get('precio_semestral') or 0,
                        'anual':      cuota.get('precio_anual') or 0,
                    }.get(per, cuota.get('precio_mensual') or 0))
                    for d in descs:
                        v = float(d['valor'])
                        importe = precio_base * v / 100.0 if d['tipo'] == 'porcentaje' else v
                        desc_aplicados.append({
                            'codigo': d['codigo'],
                            'descripcion': d.get('descripcion') or d['codigo'],
                            'tipo': d['tipo'],
                            'valor': v,
                            'importe': round(importe, 2),
                        })
                row['descuentos_aplicados'] = desc_aplicados

                # Modificaciones vigentes ese mes
                mods_aplicadas = []
                if mes_str:
                    inicio, fin = self._periodos_mes(mes_str)
                    mods = self._call_scoped('round.modificacion.recibo','search_read',
                        [('subscription_id','=',sub_id),('estado','=','activa'),
                         ('fecha_desde','<=',str(fin)),
                         '|',('fecha_hasta','=',False),('fecha_hasta','>=',str(inicio))],
                        fields=['tipo','valor','razon'])
                    for mo in mods:
                        v = float(mo['valor'])
                        # Signo de valor manda. `precio_alternativo` afecta
                        # al base, no se suma al importe.
                        if mo['tipo'] in ('descuento', 'cargo_extra'):
                            importe = v
                        else:  # precio_alternativo
                            importe = 0
                        mods_aplicadas.append({
                            'tipo': mo['tipo'],
                            'valor': v,
                            'importe': round(importe, 2),
                            'razon': mo.get('razon') or '',
                        })
                row['modificaciones_aplicadas'] = mods_aplicadas
            else:
                row['descuentos_aplicados'] = []
                row['modificaciones_aplicadas'] = []
            row['tipo'] = self._detectar_tipo_invoice(i)
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
        """Actualiza un borrador.
        vals admite:
          - precio: float (override directo del importe final)
          - invoice_date_due: 'YYYY-MM-DD'
          - narration: str
          - descuento_ids: [int]  → reemplaza descuentos_activos_ids del sub y recalcula
          - modificaciones_nuevas: [{tipo, valor, razon, fecha_desde, fecha_hasta}] → las crea ligadas a la sub
          - modificaciones_borrar: [int] → borra esos modificaciones (round.modificacion.recibo)
        Si se han cambiado descuentos o modificaciones, el importe final se recalcula.
        """
        inv = self._call('account.move','read',[invoice_id],
            ['state','invoice_line_ids','round_subscription_id','invoice_date'])[0]
        if inv['state'] != 'draft':
            raise ValueError('Solo se pueden modificar borradores')

        narration = vals.get('narration', vals.get('notas'))
        if narration is not None:
            self._call('account.move','write',[invoice_id],{'narration': narration or False})
        if 'invoice_date_due' in vals and vals['invoice_date_due']:
            self._call('account.move','write',[invoice_id],{'invoice_date_due': vals['invoice_date_due']})

        sub_pair = inv.get('round_subscription_id')
        sub_id = sub_pair[0] if sub_pair else None
        recalc_needed = False

        # Reemplazar descuentos del sub
        if 'descuento_ids' in vals and sub_id:
            ids = [int(x) for x in (vals['descuento_ids'] or [])]
            # (6,0,ids) reemplaza la colección completa
            self._call('round.subscription','write',[sub_id],
                {'descuentos_activos_ids': [(6, 0, ids)]})
            recalc_needed = True

        # Borrar modificaciones
        for mid in vals.get('modificaciones_borrar') or []:
            try: self._call('round.modificacion.recibo','unlink',[int(mid)])
            except Exception as e: log.warning(f'unlink mod {mid}: {e}')
            recalc_needed = True

        # Crear nuevas modificaciones
        for nm in vals.get('modificaciones_nuevas') or []:
            mod_vals = {
                'subscription_id': sub_id,
                'tipo': nm.get('tipo'),
                'valor': float(nm.get('valor') or 0),
                'razon': nm.get('razon') or '',
                'fecha_desde': nm.get('fecha_desde') or (inv['invoice_date'] or ''),
                'estado': 'activa',
            }
            if nm.get('fecha_hasta'): mod_vals['fecha_hasta'] = nm['fecha_hasta']
            try:
                self._call('round.modificacion.recibo','create', mod_vals)
            except Exception as e:
                log.warning(f'create mod: {e}')
            recalc_needed = True

        # Recalcular precio si hubo cambios en descuentos/modificaciones
        if recalc_needed and sub_id:
            sub = self._call('round.subscription','read',[sub_id],
                ['cuota_id','partner_id','periodicidad','forma_pago','mandate_id',
                 'pasarela_id','trainer_analytic_id','company_id','descuentos_activos_ids',
                 'fecha_inicio','token_tarjeta'])[0]
            sub['id'] = sub_id
            mes_str = inv['invoice_date'][:7] if inv.get('invoice_date') else None
            if mes_str:
                calc = self._calcular_importe(sub, mes_str)
                if inv.get('invoice_line_ids'):
                    line_id = inv['invoice_line_ids'][0]
                    self._call('account.move.line','write',[line_id],
                        {'price_unit': float(calc['precio_final'])})
        elif 'precio' in vals and inv.get('invoice_line_ids'):
            # Override manual del precio
            line_id = inv['invoice_line_ids'][0]
            self._call('account.move.line','write',[line_id],
                {'price_unit': float(vals['precio'])})

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
           4. Registrar pago automático para SEPA + tokenización (se asume cobrado)
        """
        inicio, fin = self._periodos_mes(mes_str)
        borradores = self._call_scoped('account.move','search',
            [('state','=','draft'),('move_type','=','out_invoice'),
             ('invoice_date','>=',str(inicio)),('invoice_date','<=',str(fin)),
             ('round_subscription_id','!=',False)])
        if not borradores:
            return {'ok': False, 'error': 'no_drafts'}

        # Post (action_post)
        self._call('account.move','action_post', borradores)
        log.info(f'Emisión {mes_str}: {len(borradores)} recibos posted')

        # Auto-pago SEPA + tokenización (asumimos cobrado salvo devolución posterior)
        cobrados_auto = self._registrar_pagos_auto(borradores)

        # Crear payment.order SEPA (payment.mode es per-company en Odoo)
        sepa_pm = self._call_scoped('account.payment.mode','search',
            [('payment_method_id.code','=','sepa_direct_debit')],limit=1)
        sepa_attachment_id = None
        sepa_filename = None
        if sepa_pm:
            sepa_invoices = self._call_scoped('account.move','search',
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
            'cobrados_auto': cobrados_auto,
            'sepa_attachment_id': sepa_attachment_id,
            'sepa_filename': sepa_filename,
        }

    def _registrar_pagos_auto(self, invoice_ids):
        """Para cada invoice de SEPA o tokenización, registra un account.payment
        que la deja como 'paid'. Devuelve lista de invoice_ids procesados.
        """
        if not invoice_ids:
            return []
        # Buscar journal bancario
        journals = self._call('account.journal','search',
            [('type','=','bank'),('company_id','=',cfg.ODOO_COMPANY)], limit=1)
        if not journals:
            log.warning('No journal bancario; no se registran pagos auto')
            return []
        journal_id = journals[0]

        cobrados = []
        for inv_id in invoice_ids:
            inv = self._call('account.move','read',[inv_id],
                ['round_subscription_id','invoice_date','payment_state','state'])[0]
            sub_pair = inv.get('round_subscription_id')
            if not sub_pair: continue
            sub = self._call('round.subscription','read',[sub_pair[0]],['forma_pago'])[0]
            fp = sub.get('forma_pago')
            if fp not in ('sepa','tarjeta_token','tokenizacion'):
                continue
            if inv.get('payment_state') == 'paid':
                continue  # ya pagado
            try:
                ctx = {'active_model':'account.move','active_ids':[inv_id]}
                wiz_id = self._call_ctx('account.payment.register','create', ctx, {
                    'journal_id': journal_id,
                    'payment_date': inv.get('invoice_date') or False,
                })
                self._call_ctx('account.payment.register','action_create_payments', ctx, [wiz_id])
                cobrados.append(inv_id)
                log.info(f'Pago auto {fp} registrado para inv {inv_id}')
            except Exception as e:
                log.warning(f'No se pudo registrar pago auto inv {inv_id}: {e}')
        return cobrados

    # ── Devoluciones ────────────────────────────────────────────────────────
    def procesar_devoluciones(self, rows):
        """rows = [{invoice_ref, motivo}, ...]
        Para cada uno: anula los pagos reconciliados → vuelve a 'not_paid'
        y deja una nota en narration.
        """
        from datetime import date as _date
        result = {'procesadas': [], 'errores': []}
        for r in rows:
            ref = (r.get('invoice_ref') or r.get('name') or '').strip()
            if not ref:
                result['errores'].append({'row': r, 'error': 'Sin referencia'})
                continue
            # _call_scoped inyecta company_id = empresa del manager → la
            # devolución casa el recibo dentro de la esfera del manager (todos
            # sus trainers) y NUNCA con una factura de otra empresa/manager que
            # tenga el mismo número de factura.
            inv_ids = self._call_scoped('account.move','search',
                [('move_type','=','out_invoice'),('name','=',ref)], limit=1)
            if not inv_ids:
                result['errores'].append({'invoice_ref': ref, 'error': 'No encontrado'})
                continue
            inv_id = inv_ids[0]
            inv = self._call('account.move','read',[inv_id],
                ['name','partner_id','amount_total','payment_state','narration'])[0]
            # Leer id_noofit del partner para que el caller pueda mandar notif
            partner_idnoofit = None
            if inv.get('partner_id'):
                pdata = self._call('res.partner','read', [inv['partner_id'][0]],
                                   ['id_noofit'])
                if pdata: partner_idnoofit = (pdata[0].get('id_noofit') or '').strip() or None
            try:
                # Pagos reconciliados con esta factura
                payments = self._call('account.payment','search',
                    [('reconciled_invoice_ids','in',[inv_id])])
                anulados = 0
                for p in payments:
                    try:
                        self._call('account.payment','action_draft',[p])
                    except Exception: pass
                    try:
                        self._call('account.payment','action_cancel',[p])
                        anulados += 1
                    except Exception as e:
                        log.warning(f'cancel payment {p}: {e}')
                # Nota
                motivo = (r.get('motivo') or 'sin motivo').strip()
                nota_extra = f"\n[DEVOLUCIÓN {_date.today().isoformat()}] {motivo}"
                new_narration = (inv.get('narration') or '') + nota_extra
                self._call('account.move','write',[inv_id],{'narration': new_narration})
                result['procesadas'].append({
                    'invoice_ref': ref,
                    'invoice_id': inv_id,
                    'partner': inv['partner_id'][1] if inv.get('partner_id') else '',
                    'partner_idnoofit': partner_idnoofit,
                    'importe': inv.get('amount_total'),
                    'pagos_anulados': anulados,
                    'motivo': motivo,
                })
            except Exception as e:
                result['errores'].append({'invoice_ref': ref, 'error': str(e)})
        return result

    def anular_pagos_de_move(self, move_id):
        """Cancela los account.payment reconciliados con un account.move → la
        factura vuelve a NO pagada (amount_residual>0), pendiente de recobro.
        Devuelve el nº de pagos cancelados. Idempotente."""
        try:
            move_id = int(move_id)
        except (TypeError, ValueError):
            return 0
        pagos = self._call('account.payment', 'search',
                           [('reconciled_invoice_ids', 'in', [move_id])])
        n = 0
        for p in pagos:
            try:
                self._call('account.payment', 'action_draft', [p])
            except Exception:
                pass
            try:
                self._call('account.payment', 'action_cancel', [p])
                n += 1
            except Exception as e:
                log.warning(f'anular_pagos_de_move: cancel payment {p}: {e}')
        return n

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


# Cache de instancias por manager. La identidad se resuelve lazy en la
# primera llamada, así que crear la instancia es barato.
# Llamadas sin id_manager (legacy) reciben la instancia 'default' que usa
# los valores del .env (manager histórico Round, company_id=3).
_instances = {}
def get_cuotas(id_manager=None):
    """Devuelve la instancia OdooCuotas para el manager dado.

    - `get_cuotas()` → instancia default (compatible con código legacy).
    - `get_cuotas(id_manager='17675')` → instancia ligada a ese manager,
      con su company_id y odoo_url resueltos desde manager_config.
    """
    key = str(id_manager or 'default')
    inst = _instances.get(key)
    if inst is None:
        inst = OdooCuotas(id_manager=id_manager)
        _instances[key] = inst
    return inst
