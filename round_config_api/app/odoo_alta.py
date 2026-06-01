"""Alta de cliente en Odoo desde el flujo ERP (web → backend → Odoo).

Flujo:
  1. Crea / actualiza el res.partner (con DNI, IBAN si SEPA, dirección...).
  2. Crea round.subscription activa con la cuota seleccionada.
  3. Crea primer recibo (alta) con el importe + opcional matrícula.
  4. Procesa el pago según `forma_pago_alta`:
       - efectivo    → action_post + payment en journal de caja
       - tpv_fisico  → action_post + payment en journal TPV
       - enlace_pago → action_post + devuelve enlace (PayComet, fase 4)
       - aplazar     → action_post + crea modificacion en próximo mes
"""
import logging
from datetime import date, datetime, timedelta
from .odoo_cuotas import OdooCuotas
from .paycomet_client import get_client as get_paycomet, get_client_for as get_paycomet_for, PayCometError
from . import config as cfg

log = logging.getLogger(__name__)

# Mapa forma_pago_alta → fragmento que buscamos en el name del journal
JOURNAL_KEYS = {
    'efectivo':    ('caja', 'cash'),
    'tpv_fisico':  ('tpv', 'physical', 'datafono', 'pos'),
    'enlace_pago': ('bank',),
}


class OdooAlta(OdooCuotas):
    """Hereda OdooCuotas para reusar conexión XML-RPC y _calcular_importe."""

    # ── Partner ──────────────────────────────────────────────────────────────
    def upsert_partner(self, datos):
        """datos = {nombre, apellidos, dni, email, movil, direccion, localidad,
                    cp, fecha_nacimiento, sexo, idnoofit, iban}"""
        idnoofit = str(datos.get('idnoofit') or '').strip() or None
        # 1) Buscar por id_noofit (el que usamos para sync). Multi-company:
        #    res.partner es global en Odoo pero queremos limitar al partner
        #    de la company del manager actual (para evitar colisiones cuando
        #    dos managers tengan el mismo cliente con el mismo idnoofit).
        partner_id = None
        if idnoofit:
            ids = self._call_scoped('res.partner', 'search', [('id_noofit','=',idnoofit)], limit=1)
            if ids: partner_id = ids[0]
        # 2) Si no, buscar por DNI (vat) o email
        if not partner_id and datos.get('dni'):
            ids = self._call_scoped('res.partner', 'search', [('vat','=',datos['dni'])], limit=1)
            if ids: partner_id = ids[0]
        if not partner_id and datos.get('email'):
            ids = self._call_scoped('res.partner', 'search', [('email','=ilike',datos['email'])], limit=1)
            if ids: partner_id = ids[0]

        vals = {
            'name': f"{datos.get('nombre','') or ''} {datos.get('apellidos','') or ''}".strip(),
            'vat': datos.get('dni') or False,
            'email': datos.get('email') or False,
            'mobile': datos.get('movil') or False,
            'street': datos.get('direccion') or False,
            'city': datos.get('localidad') or False,
            'zip': datos.get('cp') or False,
        }
        if idnoofit:
            vals['id_noofit'] = idnoofit

        # Limpiar Falses → no actualizar
        write_vals = {k: v for k, v in vals.items() if v not in (None, '')}

        def _persist(vals_to_write):
            if partner_id:
                if vals_to_write:
                    self._call('res.partner', 'write', [partner_id], vals_to_write)
                return partner_id
            return self._call('res.partner', 'create', vals_to_write)

        try:
            new_id = _persist(write_vals)
        except Exception as e:
            # NoofitPro a veces trae documentos (NIE/pasaporte/etc.) que Odoo
            # rechaza como número de IVA inválido (p.ej. 'GR6611888', cuyo
            # prefijo 'GR' Odoo interpreta como IVA griego). En ese caso el
            # documento NO es un VAT válido: lo guardamos en notas y creamos el
            # partner SIN vat para no bloquear el alta/suscripción.
            msg = str(e)
            if write_vals.get('vat') and ('IVA' in msg or 'VAT' in msg.upper()):
                doc = write_vals.pop('vat')
                nota = f'Documento (no validado como IVA): {doc}'
                write_vals['comment'] = ((write_vals.get('comment') or '') + ' ' + nota).strip()
                log.warning(f'upsert_partner: vat "{doc}" rechazado por Odoo '
                            f'(idnoofit={idnoofit}); creando sin vat')
                new_id = _persist(write_vals)
            else:
                raise
        if not partner_id:
            partner_id = new_id
            log.info(f'Partner creado id={partner_id} idnoofit={idnoofit}')

        # IBAN (res.partner.bank) si se proporciona
        if datos.get('iban'):
            iban_clean = (datos['iban'] or '').replace(' ', '').upper()
            existing = self._call('res.partner.bank', 'search',
                [('partner_id','=',partner_id),('acc_number','=',iban_clean)], limit=1)
            if not existing:
                self._call('res.partner.bank', 'create', {
                    'partner_id': partner_id,
                    'acc_number': iban_clean,
                })
                log.info(f'IBAN registrado para partner {partner_id}')
        return partner_id

    # ── Cuota lookup / autocreación ──────────────────────────────────────────
    def get_cuota_by_codigo(self, codigo):
        if not codigo: return None
        ids = self._call_scoped('round.cuota.catalogo', 'search',
            [('codigo','=', str(codigo))], limit=1)
        if not ids: return None
        return self._call('round.cuota.catalogo', 'read', [ids[0]],
            ['id','codigo','descripcion','precio_mensual','precio_trimestral',
             'precio_semestral','precio_anual','matricula','product_id'])[0]

    def get_or_create_cuota(self, codigo, fallback_precio=None, fallback_periodicidad='mensual'):
        """Devuelve la cuota; si no existe la crea con el precio aportado en
        la periodicidad indicada. Útil cuando el trainer da de alta a un
        cliente cuya cuota no se ha configurado todavía en el catálogo."""
        c = self.get_cuota_by_codigo(codigo)
        if c: return c
        if fallback_precio is None or fallback_precio <= 0:
            return None  # no podemos crearla sin precio
        precio_field = {
            'mensual':    'precio_mensual',
            'bimensual':  'precio_mensual',  # Odoo no tiene precio_bimensual
            'trimestral': 'precio_trimestral',
            'semestral':  'precio_semestral',
            'anual':      'precio_anual',
        }.get(fallback_periodicidad, 'precio_mensual')
        vals = {
            'codigo': str(codigo),
            'descripcion': f'{codigo} (creada desde alta cliente)',
            precio_field: float(fallback_precio),
            'company_id': self.company_id,
            'activo': True,
        }
        cuota_id = self._call('round.cuota.catalogo', 'create', vals)
        log.info(f'Cuota auto-creada {codigo} id={cuota_id} {precio_field}={fallback_precio}')
        return self._call('round.cuota.catalogo', 'read', [cuota_id],
            ['id','codigo','descripcion','precio_mensual','precio_trimestral',
             'precio_semestral','precio_anual','matricula','product_id'])[0]

    # ── Subscription ─────────────────────────────────────────────────────────
    def _desc_ids_from_codigos(self, codigos):
        """Lista de codigos → lista de ids de round.descuento.catalogo."""
        out = []
        for cod in (codigos or []):
            if not cod: continue
            ids = self._call_scoped('round.descuento.catalogo', 'search',
                [('codigo','=', str(cod))], limit=1)
            if ids: out.append(ids[0])
        return out


    @staticmethod
    def _map_forma_pago_recurrente(v):
        """Normaliza valores legacy/UI al Selection real del modelo Odoo
        round.subscription.forma_pago: ['sepa', 'tarjeta_token', 'enlace_pago', 'efectivo']."""
        s = (v or '').strip().lower()
        if not s: return 'sepa'  # default
        if s in ('sepa', 'tarjeta_token', 'enlace_pago', 'efectivo'): return s
        # Aliases UI
        if s in ('caja', 'cash', 'metalico', 'metálico'): return 'efectivo'
        if s in ('tarjeta', 'card', 'token', 'tokenizada'): return 'tarjeta_token'
        if s in ('domiciliacion', 'domiciliación', 'banco', 'bank'): return 'sepa'
        if s in ('enlace', 'link', 'paycomet'): return 'enlace_pago'
        return 'sepa'

    def crear_subscription(self, partner_id, cuota_id, periodicidad, forma_pago,
                           fecha_inicio=None, descuentos_codigos=None):
        # Normalizar forma_pago al Selection real de round.subscription
        forma_pago = self._map_forma_pago_recurrente(forma_pago)

        # ── Anti-duplicado: si ya hay suscripción activa con mismo
        # partner+cuota+periodicidad, la reutilizamos (actualizamos forma_pago).
        existing = self._call('round.subscription', 'search',
            [('partner_id','=',partner_id),
             ('cuota_id','=',cuota_id),
             ('periodicidad','=',periodicidad),
             ('estado','=','activa')], limit=1)
        if existing:
            sub_id = existing[0]
            log.info(f'crear_subscription: reutilizando sub #{sub_id} '
                     f'(partner={partner_id} cuota={cuota_id} {periodicidad})')
            # Actualizamos forma_pago si vino distinta
            try:
                self._call('round.subscription', 'write', [sub_id],
                           {'forma_pago': forma_pago})
            except Exception as e:
                log.warning(f'sub write forma_pago: {e}')
            # Aplicar descuentos nuevos si vinieron
            if descuentos_codigos:
                try:
                    desc_ids = self._desc_ids_from_codigos(descuentos_codigos)
                    if desc_ids:
                        self._call('round.subscription', 'write', [sub_id],
                                   {'descuentos_activos_ids': [(6, 0, desc_ids)]})
                except Exception as e: log.warning(f'descuentos: {e}')
            return sub_id

        # Mandato SEPA si forma_pago == sepa
        mandate_id = False
        if forma_pago == 'sepa':
            mandate_ids = self._call('account.banking.mandate', 'search',
                [('partner_id','=',partner_id),('state','=','valid')], limit=1)
            mandate_id = mandate_ids[0] if mandate_ids else False

        vals = {
            'partner_id': partner_id,
            'cuota_id': cuota_id,
            'periodicidad': periodicidad,
            'forma_pago': forma_pago,
            'estado': 'activa',
            'fecha_inicio': fecha_inicio or str(date.today()),
        }
        if mandate_id:
            vals['mandate_id'] = mandate_id

        # Descuentos
        if descuentos_codigos:
            desc_ids = self._desc_ids_from_codigos(descuentos_codigos)
            if desc_ids:
                vals['descuentos_activos_ids'] = [(6, 0, desc_ids)]

        # Multi-trainer (Fase 4): si el manager tiene Odoo desplegado con
        # analytic plan, resolvemos el analytic del trainer del cliente y
        # lo guardamos en la subscription. `generar_preemision` lo usa
        # luego para inyectar analytic_distribution en cada factura.
        if self._id_manager:
            try:
                from .odoo_analytics import resolve_analytic
                # Lookup del id_trainer del partner en cliente_cache (Fase 1)
                analytic_id = self._resolve_analytic_for_partner(partner_id)
                if analytic_id:
                    vals['trainer_analytic_id'] = analytic_id
            except Exception as e:
                log.warning(f'crear_subscription: resolve_analytic falló: {e}')

        sub_id = self._call('round.subscription', 'create', vals)
        log.info(f'Subscription creada id={sub_id}')
        return sub_id

    def _resolve_analytic_for_partner(self, partner_id):
        """Dado un partner_id en Odoo, devuelve el analytic_id que le
        corresponde según el trainer del cliente en NoofitPro (vía
        cliente_cache.id_trainer).

        Si no encontramos el cliente o el manager no tiene analytic plan,
        devolvemos None (no se aplica analytic)."""
        from .odoo_analytics import resolve_analytic
        from .db import get_conn
        # 1) Sacar id_noofit del partner Odoo
        info = self._call('res.partner', 'read', [partner_id], ['id_noofit'])
        if not info or not info[0].get('id_noofit'):
            return resolve_analytic(self._id_manager, None)
        idnoofit = info[0]['id_noofit']
        # 2) Buscar el trainer en cliente_cache
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT id_trainer FROM cliente_cache
                 WHERE id_manager=%s AND id=%s
            """, (str(self._id_manager), int(idnoofit)))
            row = cur.fetchone()
        id_trainer = (row or {}).get('id_trainer')
        return resolve_analytic(self._id_manager, id_trainer)

    # ── Recibo de alta ───────────────────────────────────────────────────────
    def crear_recibo_alta(self, partner_id, sub_id, cuota_dict, importe_alta,
                          matricula=0, mes_str=None, narration_extra=None):
        """Crea account.move (borrador) con la línea del alta + matrícula.
        importe_alta es el TOTAL final del recibo (sin matrícula adicional aparte)."""
        if mes_str is None:
            mes_str = date.today().strftime('%Y-%m')
        # Multi-trainer: resolver analytic vía la subscription que acabamos
        # de crear (que YA tiene trainer_analytic_id si aplica).
        line_extras = {}
        try:
            sub = self._call('round.subscription', 'read', [sub_id],
                             ['trainer_analytic_id'])
            tai = (sub[0] if sub else {}).get('trainer_analytic_id')
            aid = tai[0] if isinstance(tai, (list, tuple)) else tai
            if aid:
                line_extras['analytic_distribution'] = {str(aid): 100.0}
        except Exception as e:
            log.warning(f'crear_recibo_alta: resolve analytic falló: {e}')

        line_vals = []
        product_id = cuota_dict.get('product_id', [False])[0] if cuota_dict.get('product_id') else False
        line_vals.append((0, 0, {
            'name': f"Cuota alta {cuota_dict.get('codigo')} {mes_str}",
            'quantity': 1,
            'price_unit': float(importe_alta),
            'product_id': product_id,
            **line_extras,
        }))
        if matricula and float(matricula) > 0:
            line_vals.append((0, 0, {
                'name': f"Matrícula {cuota_dict.get('codigo')}",
                'quantity': 1,
                'price_unit': float(matricula),
                'product_id': product_id,
                **line_extras,
            }))
        inv_vals = {
            'partner_id': partner_id,
            'move_type': 'out_invoice',
            'invoice_date': str(date.today()),
            'invoice_date_due': str(date.today()),
            'invoice_line_ids': line_vals,
            'round_subscription_id': sub_id,
            'narration': (f'Alta cliente {date.today().isoformat()}'
                          + (f' · {narration_extra}' if narration_extra else '')),
            'company_id': self.company_id,
        }
        inv_id = self._call('account.move', 'create', inv_vals)
        return inv_id

    # ── Buscar journal por palabra clave ─────────────────────────────────────
    def _journal_for(self, forma_pago_alta):
        keys = JOURNAL_KEYS.get(forma_pago_alta, ())
        if not keys: return None
        # Buscar journals tipo cash/bank con name que contenga alguna keyword
        type_filter = 'cash' if forma_pago_alta == 'efectivo' else 'bank'
        journals = self._call('account.journal', 'search_read',
            [('type','=',type_filter),('company_id','=',cfg.ODOO_COMPANY)],
            ['id','name'])
        for k in keys:
            for j in journals:
                if k.lower() in (j.get('name') or '').lower():
                    return j['id']
        # Fallback: primer journal del tipo
        if journals: return journals[0]['id']
        return None

    # ── Procesar pago de alta ────────────────────────────────────────────────
    def procesar_pago_alta(self, invoice_id, forma_pago_alta, mes_str=None,
                           id_manager=None, id_trainer=None):
        """Tras crear el recibo, según forma_pago_alta:
          - efectivo / tpv_fisico → action_post + payment.register
          - enlace_pago → action_post + devuelve placeholder (PayComet, fase 4)
          - aplazar → action_post + crea modificacion mes siguiente
        """
        result = {'forma_pago_alta': forma_pago_alta, 'invoice_id': invoice_id}

        # Si el recibo es de importe 0 €, solo lo posteamos y devolvemos.
        # No tiene sentido registrar pago/aplazar 0 €.
        try:
            inv = self._call('account.move', 'read', [invoice_id],
                             ['amount_total'])[0]
            if float(inv.get('amount_total') or 0) == 0:
                try: self._call('account.move','action_post',[invoice_id])
                except Exception: pass
                result['paid'] = True
                result['skipped_payment_zero_amount'] = True
                return result
        except Exception as e:
            log.warning(f'procesar_pago_alta: read amount: {e}')

        if forma_pago_alta == 'aplazar':
            # No postear ahora, solo crear modificacion para el próximo mes
            inv = self._call('account.move', 'read', [invoice_id],
                ['amount_total','round_subscription_id'])[0]
            # Cancel/draft → mantenemos como borrador? Mejor postear y registrar deuda.
            self._call('account.move','action_post',[invoice_id])
            sub = inv.get('round_subscription_id')
            if sub:
                # Crear modificacion tipo cargo_extra para el próximo mes
                hoy = date.today()
                proximo = (hoy.replace(day=1) + timedelta(days=32)).replace(day=1)
                fin_proximo = (proximo + timedelta(days=32)).replace(day=1) - timedelta(days=1)
                self._call('round.modificacion.recibo','create', {
                    'subscription_id': sub[0],
                    'tipo': 'cargo_extra',
                    'valor': float(inv['amount_total']),
                    'razon': f'Alta aplazada - recibo {invoice_id}',
                    'fecha_desde': str(proximo),
                    'fecha_hasta': str(fin_proximo),
                    'estado': 'activa',
                })
                result['modificacion_proximo_mes'] = True
            return result

        # Postear el recibo
        self._call('account.move','action_post',[invoice_id])

        if forma_pago_alta in ('efectivo','tpv_fisico'):
            journal_id = self._journal_for(forma_pago_alta)
            if not journal_id:
                result['warning'] = f'No journal {forma_pago_alta}, recibo posted sin pago'
                return result
            try:
                inv = self._call('account.move','read',[invoice_id],['invoice_date'])[0]
                ctx = {'active_model':'account.move','active_ids':[invoice_id]}
                wiz = self._call_ctx('account.payment.register','create', ctx, {
                    'journal_id': journal_id,
                    'payment_date': inv.get('invoice_date') or False,
                })
                self._call_ctx('account.payment.register','action_create_payments', ctx, [wiz])
                result['paid'] = True
                result['journal_id'] = journal_id
            except Exception as e:
                result['error_pago'] = str(e)
                log.exception('procesar_pago_alta')
            return result

        if forma_pago_alta == 'enlace_pago':
            # PayComet: generar enlace de pago hospedado y devolverlo al frontend
            try:
                inv = self._call('account.move','read',[invoice_id],
                                 ['name','amount_total','partner_id','narration'])[0]
                ref = inv.get('name') or f'INV-{invoice_id}'
                amount = float(inv.get('amount_total') or 0)
                desc = f"Alta {ref}"
                cli = get_paycomet_for(id_manager, id_trainer)
                url = cli.crear_enlace_pago(amount, ref, productDescription=desc)
                # Guardar la URL en narration para trazabilidad
                new_narration = ((inv.get('narration') or '') +
                                 f"\n[PayComet] Enlace pago: {url}").strip()
                self._call('account.move','write',[invoice_id], {'narration': new_narration})
                result['enlace_pago_url'] = url
                log.info(f'PayComet link inv={invoice_id} ref={ref} amount={amount}')

                # ── Notif automática "enlace_pago" al cliente (defensivo) ──
                try:
                    self._notif_enlace_pago(id_manager, id_trainer,
                                            invoice_id, inv, amount, url)
                except Exception as e:
                    log.warning(f'notif enlace_pago fallback: {e}')
            except PayCometError as e:
                result['error_pago'] = str(e)
                log.error(f'PayComet alta inv={invoice_id}: {e}')
            except Exception as e:
                result['error_pago'] = f'PayComet inesperado: {e}'
                log.exception('paycomet alta')
            return result

        result['warning'] = f'forma_pago_alta desconocida: {forma_pago_alta}'
        return result

    def crear_recibo_suelto(self, cli, concepto, importe, forma_pago,
                            id_manager=None, id_trainer=None, fecha=None):
        """Crea un recibo (account.move) SIN suscripción asociada — para cobros
        puntuales (cuotas de entrada puntual: cobro en recepción o factura
        mensual agregada). Postea y, si la forma de pago es de caja/TPV/enlace,
        registra el pago; para SEPA o tarjeta tokenizada solo postea (el cobro
        real se hará por remesa SEPA o cargo tokenizado en su flujo).
        Devuelve {ok, invoice_id, pago}.
        """
        partner_id = self.upsert_partner(cli)
        fecha = fecha or str(date.today())
        inv_vals = {
            'partner_id': partner_id,
            'move_type': 'out_invoice',
            'invoice_date': fecha,
            'invoice_date_due': fecha,
            'invoice_line_ids': [(0, 0, {
                'name': concepto,
                'quantity': 1,
                'price_unit': float(importe),
                'product_id': False,
            })],
            'narration': concepto,
            'company_id': self.company_id,
        }
        invoice_id = self._call('account.move', 'create', inv_vals)
        pago = {}
        try:
            if forma_pago in ('efectivo', 'tpv_fisico', 'enlace_pago'):
                pago = self.procesar_pago_alta(
                    invoice_id, forma_pago,
                    id_manager=id_manager, id_trainer=id_trainer)
            else:
                # sepa / tarjeta_token → solo postear
                self._call('account.move', 'action_post', [invoice_id])
                pago = {'posted': True, 'forma_pago': forma_pago}
        except Exception as e:
            log.exception('crear_recibo_suelto pago')
            pago = {'error_pago': str(e)}
        return {'ok': True, 'invoice_id': invoice_id, 'pago': pago}

    def _notif_enlace_pago(self, id_manager, id_trainer, invoice_id, inv, amount, url):
        """Notifica al cliente que tiene un enlace de pago pendiente.

        Defensivo: cualquier error sale como warning, no rompe el alta.
        """
        from .notif_sender import enviar_notificacion
        from .db import get_conn
        partner_id = inv.get('partner_id')
        if isinstance(partner_id, list):
            partner_id = partner_id[0]
        if not partner_id:
            return
        partner = self._call('res.partner', 'read', [partner_id],
                             ['id_noofit', 'name'])[0]
        cliente_idnoofit = (partner.get('id_noofit') or '').strip()
        if not cliente_idnoofit:
            log.info(f'notif enlace_pago: partner {partner_id} sin id_noofit')
            return
        # Comprobar config auto_enlace_pago
        try:
            with get_conn() as conn, conn.cursor() as cur:
                cur.execute("""
                    SELECT auto_enlace_pago, plantillas FROM notif_config
                     WHERE id_manager=%s
                       AND (id_trainer IS NULL OR id_trainer=%s)
                     ORDER BY (id_trainer IS NULL) ASC LIMIT 1
                """, (str(id_manager or ''), str(id_trainer or '')))
                row = cur.fetchone()
                if row is not None and not row['auto_enlace_pago']:
                    return
                plantillas = (row.get('plantillas') if row else None) or {}
        except Exception:
            plantillas = {}
        plantilla = (plantillas.get('enlace_pago') or {}) if isinstance(plantillas, dict) else {}
        res = enviar_notificacion(
            id_manager=str(id_manager or ''),
            id_trainer=str(id_trainer or '') or None,
            seccion='cobros',
            tipo='enlace_pago',
            titulo=plantilla.get('titulo') or None,
            cuerpo=plantilla.get('cuerpo') or None,
            url=url,
            plantilla_vars={
                'importe': f'{amount:.2f}',
                'cliente_nombre': partner.get('name', ''),
                'url': url,
            },
            audience={'tipo': 'cliente', 'ref': cliente_idnoofit},
            origen='alta_enlace_pago',
            origen_ref=f'invoice:{invoice_id}',
        )
        log.info(f'notif enlace_pago inv={invoice_id} cliente={cliente_idnoofit} → {res.get("estado")}')

    # ── Punto de entrada ─────────────────────────────────────────────────────
    def crear_alta_cliente(self, payload, id_manager=None, id_trainer=None):
        """payload = {
            cliente:    {nombre, apellidos, dni, email, movil, direccion,
                         localidad, cp, fecha_nacimiento, idnoofit, iban},
            suscripcion: {cuota_codigo, periodicidad, forma_pago_recurrente,
                          fecha_alta, descuento_codigo},
            alta:       {forma_pago_alta, importe_alta, matricula,
                          recaptacion: bool (si era cliente archivado)}
          }
        """
        cli = payload.get('cliente') or {}
        sub = payload.get('suscripcion') or {}
        alta = payload.get('alta') or {}
        recaptacion = bool(alta.get('recaptacion'))

        # 1) Partner
        partner_id = self.upsert_partner(cli)

        # 2) Cuota — si no existe la creamos con el importe aportado
        importe_alta = float(alta.get('importe_alta') or 0)
        periodicidad = sub.get('periodicidad') or 'mensual'
        cuota = self.get_or_create_cuota(
            sub.get('cuota_codigo'),
            fallback_precio=importe_alta,
            fallback_periodicidad=periodicidad,
        )
        if not cuota:
            raise ValueError(
                f"cuota '{sub.get('cuota_codigo')}' no existe y no se puede crear "
                f"(falta importe). Crea la cuota en Configuración primero."
            )

        # 3) Subscription
        sub_id = self.crear_subscription(
            partner_id=partner_id,
            cuota_id=cuota['id'],
            periodicidad=sub.get('periodicidad') or 'mensual',
            forma_pago=sub.get('forma_pago_recurrente') or 'sepa',
            fecha_inicio=sub.get('fecha_alta'),
            descuentos_codigos=[sub.get('descuento_codigo')] if sub.get('descuento_codigo') else None,
        )

        # 4) Recibo de alta
        importe_alta = float(alta.get('importe_alta') or 0)
        matricula = float(alta.get('matricula') or 0)
        # Importe 0 JUSTIFICADO: el operador quiere expresamente un recibo a 0€
        # (cortesía, beca, promo, etc.). En ese caso NO sustituimos por el
        # precio de catálogo y guardamos la justificación en el recibo.
        permitir_cero = bool(alta.get('importe_cero_justificado'))
        justificacion = (alta.get('justificacion') or '').strip()
        # Si no vino importe_alta del form pero la cuota tiene precio, lo usamos
        # (caso típico: form solo tiene "Precio del curso" y no separa el alta)
        if importe_alta == 0 and not permitir_cero:
            periodicidad_norm = (sub.get('periodicidad') or 'mensual').lower()
            campo_precio = {
                'mensual':    'precio_mensual',
                'bimensual':  'precio_mensual',
                'trimestral': 'precio_trimestral',
                'semestral':  'precio_semestral',
                'anual':      'precio_anual',
            }.get(periodicidad_norm, 'precio_mensual')
            precio_catalogo = float(cuota.get(campo_precio) or 0)
            if precio_catalogo > 0:
                importe_alta = precio_catalogo
                log.info(f'importe_alta=0 → usando precio catálogo cuota {cuota.get("codigo")}: {importe_alta}')
        narration_extra = None
        if permitir_cero and importe_alta == 0 and justificacion:
            narration_extra = f'Importe 0€ justificado: {justificacion}'
        invoice_id = self.crear_recibo_alta(
            partner_id, sub_id, cuota, importe_alta, matricula,
            narration_extra=narration_extra,
        )

        # 5) Procesar pago
        pago = self.procesar_pago_alta(
            invoice_id, alta.get('forma_pago_alta') or 'aplazar',
            id_manager=id_manager, id_trainer=id_trainer,
        )

        # 6) Auto-mover lead CRM a "Alta" si existe (busca por DNI/email/idnoofit)
        lead_movido = self._cerrar_lead_crm(cli, recaptacion=recaptacion,
                                            id_manager=id_manager,
                                            id_trainer=id_trainer)

        # 7) Si es recaptación, reactivar el cliente en NoofitPro (enabled=True)
        cliente_reactivado = None
        if recaptacion and cli.get('idnoofit'):
            try:
                from . import noofit_client as nc
                cliente_reactivado = nc.reactivar_cliente(int(cli['idnoofit']))
            except Exception as e:
                log.warning(f'reactivar cliente NoofitPro {cli.get("idnoofit")}: {e}')
                cliente_reactivado = False

        return {
            'ok': True,
            'partner_id': partner_id,
            'subscription_id': sub_id,
            'invoice_id': invoice_id,
            'cuota': {'id': cuota['id'], 'codigo': cuota['codigo']},
            'pago': pago,
            'lead_cerrado': lead_movido,
            'recaptacion': recaptacion,
            'cliente_reactivado_noofit': cliente_reactivado,
        }


    def _cerrar_lead_crm(self, cli, recaptacion=False, id_manager=None, id_trainer=None):
        """Busca el lead CRM Odoo asociado al cliente (por DNI/email/teléfono)
        y lo mueve a la etapa 'Alta'. Si recaptacion=True, le añade un tag.
        Devuelve dict con info del lead movido o None si no se encontró."""
        try:
            # Buscar etapa "Alta" (won)
            stage_ids = self._call('crm.stage', 'search', [('is_won','=',True)], limit=1)
            if not stage_ids:
                stage_ids = self._call('crm.stage', 'search', [('name','ilike','alta')], limit=1)
            stage_alta_id = stage_ids[0] if stage_ids else None

            # Buscar el lead por email/teléfono/dni en description (orden de preferencia)
            domain = []
            if cli.get('email'):
                domain = [('email_from', '=ilike', cli['email']), ('type', '=', 'opportunity')]
            elif cli.get('movil') or cli.get('telefono'):
                tel = cli.get('movil') or cli.get('telefono')
                domain = [('phone', '=', tel), ('type', '=', 'opportunity')]
            if not domain: return None

            # Excluir leads ya en etapa won/lost (folded)
            lead_ids = self._call('crm.lead', 'search', domain,
                                  order='create_date desc', limit=5)
            if not lead_ids: return None

            # Tomar el primero que NO esté ya cerrado
            leads = self._call('crm.lead', 'read', lead_ids,
                               ['id','name','stage_id'])
            target = None
            for l in leads:
                stage_name = (l.get('stage_id') and l['stage_id'][1] or '').lower()
                if stage_name in ('alta', 'perdido', 'lost', 'won'): continue
                target = l; break
            if not target: return None

            # Mover a Alta
            vals = {}
            if stage_alta_id and target['stage_id'] and target['stage_id'][0] != stage_alta_id:
                vals['stage_id'] = stage_alta_id

            # Añadir tag de recaptación si corresponde
            if recaptacion:
                tag_id = self._get_or_create_crm_tag('Recaptación')
                if tag_id:
                    vals['tag_ids'] = [(4, tag_id, 0)]  # link many2many

            if vals:
                self._call('crm.lead', 'write', [target['id']], vals)
            return {'id': target['id'], 'name': target['name'], 'recaptacion': recaptacion}
        except Exception as e:
            log.warning(f'_cerrar_lead_crm: {e}')
            return None


    def _get_or_create_crm_tag(self, name):
        try:
            ids = self._call('crm.tag', 'search', [('name','=',name)], limit=1)
            if ids: return ids[0]
            return self._call('crm.tag', 'create', {'name': name})
        except Exception as e:
            log.warning(f'_get_or_create_crm_tag {name}: {e}')
            return None


# Cache de instancias por manager — ver get_cuotas() para detalles.
_instances = {}
def get_alta(id_manager=None):
    """Devuelve la instancia OdooAlta para el manager dado.

    - `get_alta()` → instancia default (legacy).
    - `get_alta(id_manager='17675')` → ligada a ese manager."""
    key = str(id_manager or 'default')
    inst = _instances.get(key)
    if inst is None:
        inst = OdooAlta(id_manager=id_manager)
        _instances[key] = inst
    return inst
