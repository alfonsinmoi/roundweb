"""Sincronización de ventas TPV → Odoo (Fase 4, mayo 2026).

INTEGRIDAD (audit mayo 2026)
============================
Garantías de NO duplicación:

  1) **Lock optimista BD**: `sync_venta` empieza con UPDATE atómico
     `SET sync_status='syncing' WHERE sync_status NOT IN ('syncing','synced')`.
     Si el UPDATE no afecta filas, otro proceso ya está sincronizando o ya
     terminó → returns.

  2) **Idempotency contra Odoo**: ANTES de `account.move.create`, buscamos
     por `ref = numero_TPV` (que es UNIQUE per trainer+año). Si existe,
     reusamos su id en lugar de duplicar. Cubre el caso "Odoo recibió el
     create pero la BD no llegó a UPDATE odoo_move_id" (timeout/crash).

  3) **Idempotency partner anónimo**: search → si vacío create. Lock per-
     proceso evita carrera dentro del mismo gunicorn worker.

  4) **Idempotency tax price_include**: misma estrategia, con lock.

Anulacion -> propaga a Odoo:
  `anular_venta` ahora invoca `revertir_venta_odoo` que crea un
  `account.move` con `move_type='out_refund'` linked al original. El
  out_refund se postea y se reconcilia para que el invoice quede
  'reversed'. Si el revert falla, el flag `sync_status='error'` permite
  reintentarlo manualmente desde el frontend.

Para cada venta completada:
  1. Crea `account.move` (move_type='out_invoice', ticket simplificado B2C
     o factura completa si hay cliente con NIF).
  2. Una `account.move.line` por cada línea (producto y descuento), con
     cuenta contable + tax_ids según iva_pct.
  3. action_post() la factura.
  4. Crea `account.payment` en el journal del método de pago.
  5. Reconcilia el payment con la factura (queda 'paid').
  6. Persiste IDs y estado en `pos_venta`.

Política:
  * Se ejecuta sincrónamente al final de `crear_venta` (sub-segundo
    típico) dentro de try/except — un error de Odoo NO tira la venta.
  * Si el manager no tiene `odoo_cuotas_enabled`, se salta silenciosamente
    (estado queda 'skipped').
  * `metodo_pago='recibo_mensual'` se delega a Fase 6 (estado 'deferred',
    se vinculará al recibo mensual del cliente).
  * Endpoint `POST /api/pos/ventas/<id>/sync-odoo` permite reintentar
    manualmente desde el frontend.

Mapeo métodos pago → journal Odoo (heredando el del módulo de cuotas):
  efectivo, bizum  → journal type='cash' (CAJA)
  tarjeta, link_pago, transferencia → journal type='bank' (BANCO)
"""
import logging
import threading
from .db import get_conn
from .odoo_cuotas import OdooCuotas

log = logging.getLogger(__name__)


METODO_A_JOURNAL_TYPE = {
    'efectivo':       'cash',
    'bizum':          'cash',
    'tarjeta':        'bank',
    'transferencia':  'bank',
    'link_pago':      'bank',
}


# ─── Caches a nivel de proceso ──────────────────────────────────────────
_tax_cache = {}            # (company_id, iva_pct) → tax_id
_account_cache = {}        # (company_id, code) → account_id
_consumidor_final_cache = {}  # company_id → partner_id
# Locks per-proceso para evitar carreras al CREAR partners/taxes (search vacío
# en dos threads paralelos → ambos crean → duplicados). Las búsquedas posteriores
# ya saldrían del cache.
_tax_create_lock = threading.Lock()
_partner_create_lock = threading.Lock()


def _tax_for(o, company_id, iva_pct):
    """Busca/crea el account.tax de venta del % indicado con price_include=True.

    En un TPV el precio que se ve en pantalla y se cobra es con IVA. Usar un
    impuesto `price_include=True` hace que pasemos `price_unit = precio_venta`
    tal cual y Odoo desglosa base + IVA sin descuadres de céntimo (vs pasar
    base_unit pre-calculado, que sufre redondeos a 2 decimales internos).
    """
    key = (company_id, float(iva_pct))
    if key in _tax_cache:
        return _tax_cache[key]
    # Sección crítica para evitar carrera search→create con otro thread
    with _tax_create_lock:
        if key in _tax_cache:   # otro thread la creó mientras esperábamos
            return _tax_cache[key]
        return _tax_for_locked(o, company_id, iva_pct, key)


def _tax_for_locked(o, company_id, iva_pct, key):
    # Política (Audit #8+#10 mayo 2026): SOLO cacheamos hits positivos. Si la
    # búsqueda devuelve [] o la creación falla, propagamos el problema (no
    # cachear None, no cachear el tax wrong) — para que un admin que añade el
    # tax en Odoo Vea efecto inmediato sin restart del worker.
    ids = o._call('account.tax', 'search',
                  [('company_id', '=', company_id),
                   ('type_tax_use', '=', 'sale'),
                   ('amount', '=', float(iva_pct)),
                   ('amount_type', '=', 'percent'),
                   ('price_include', '=', True)],
                  limit=1)
    if ids:
        _tax_cache[key] = ids[0]
        return ids[0]
    # No hay price_include — clonar desde la base sin price_include
    base = o._call('account.tax', 'search',
                   [('company_id', '=', company_id),
                    ('type_tax_use', '=', 'sale'),
                    ('amount', '=', float(iva_pct)),
                    ('amount_type', '=', 'percent')],
                   limit=1)
    if not base:
        # No cachear: dejar que el llamador vea None y propague excepción.
        log.warning(f'No hay tax base {iva_pct}% en company {company_id} '
                    f'— NO se cachea None (audit #8)')
        return None
    base_data = o._call('account.tax', 'read', [base[0]],
                        ['name', 'amount', 'amount_type', 'type_tax_use',
                         'tax_group_id', 'invoice_repartition_line_ids',
                         'refund_repartition_line_ids'])[0]
    # Si el copy() falla, NO devolvemos el tax base (wrong); propagamos.
    # Resultado: la venta queda 'error' con detalle; tras corregir Odoo,
    # el retry funcionará sin reiniciar el worker.
    nombre_raw = base_data['name']
    nombre_str = (nombre_raw.replace('{', '').replace('}', '')
                  if isinstance(nombre_raw, str) else str(nombre_raw))
    tid = o._call('account.tax', 'copy', [base[0]], {
        'name': f'{nombre_str} (TPV incl)',
        'price_include': True,
        'include_base_amount': False,
    })
    log.info(f'Creado tax {iva_pct}% price_include en company {company_id}: id={tid}')
    _tax_cache[key] = tid
    return tid


def _account_for(o, company_id, code):
    """Busca account.account por código (con cache). Resuelve por prefijo:
    si '700' existe lo usa, si no busca '700%' y coge el primero.

    Audit #8 mayo 2026: cacheamos SOLO hits positivos. Si la cuenta no
    existe (chart aún no cargada, error transitorio), devolvemos None
    SIN cachear → la siguiente llamada reintenta la búsqueda (admin
    puede añadir la cuenta sin necesidad de reiniciar workers).
    """
    if not code:
        return None
    key = (company_id, str(code))
    if key in _account_cache:
        return _account_cache[key]
    ids = o._call('account.account', 'search',
                  [('company_id', '=', company_id), ('code', '=', str(code))],
                  limit=1)
    if not ids:
        # Buscar por prefijo: 700 → 70000000 (8 dígitos del plan PYMES)
        ids = o._call('account.account', 'search',
                      [('company_id', '=', company_id),
                       ('code', 'like', f'{code}%')],
                      limit=1)
    if not ids:
        log.warning(f'No hay cuenta {code} en company {company_id} '
                    f'— NO se cachea None')
        return None
    aid = ids[0]
    _account_cache[key] = aid
    return aid


def _journal_for(o, company_id, journal_type):
    """Primer journal del tipo solicitado para la company."""
    ids = o._call('account.journal', 'search',
                  [('company_id', '=', company_id),
                   ('type', '=', journal_type)],
                  limit=1)
    return ids[0] if ids else None


def _partner_for_venta(o, company_id, cliente_id, cliente_nombre):
    """Resuelve partner_id Odoo:
      - Si cliente_id (id_noofit) → busca/crea res.partner por id_noofit
      - Si no → usa/crea Consumidor Final per-company
    """
    if cliente_id:
        # Reutilizar lógica de odoo_payments — busca primero por id_noofit
        # en la company y luego cross-company.
        from .odoo_payments import _partner_id_for_idnoofit
        pid = _partner_id_for_idnoofit(o, company_id, cliente_id)
        if pid:
            return pid
        # Crear bajo lock (evita 2 threads creando 2 partners para el mismo
        # id_noofit). Re-search dentro del lock por si otro lo creó ya.
        with _partner_create_lock:
            pid = _partner_id_for_idnoofit(o, company_id, cliente_id)
            if pid:
                return pid
            log.info(f'sync: creando partner para id_noofit={cliente_id}')
            return o._call('res.partner', 'create', {
                'name': cliente_nombre or f'Cliente {cliente_id}',
                'id_noofit': str(cliente_id),
                'company_id': company_id,
                'company_type': 'person',
            })
    # Consumidor final (anónimo)
    if company_id in _consumidor_final_cache:
        return _consumidor_final_cache[company_id]
    with _partner_create_lock:
        if company_id in _consumidor_final_cache:
            return _consumidor_final_cache[company_id]
        ids = o._call('res.partner', 'search',
                      [('name', '=', 'Consumidor final TPV'),
                       ('company_id', '=', company_id)], limit=1)
        if ids:
            _consumidor_final_cache[company_id] = ids[0]
            return ids[0]
        pid = o._call('res.partner', 'create', {
            'name': 'Consumidor final TPV',
            'company_id': company_id,
            'company_type': 'person',
            'comment': 'Cliente genérico para tickets simplificados TPV',
        })
        _consumidor_final_cache[company_id] = pid
        return pid


# ─── Sync principal ─────────────────────────────────────────────────────

def sync_venta(id_manager, venta_id):
    """Sincroniza una venta a Odoo (creando account.move + account.payment +
    reconcile). Idempotente y thread-safe.

    Returns dict:
      {ok, move_id, payment_id}            si se creó o reusó
      {ok, already_synced, move_id}        ya estaba sincronizada
      {ok, reconciled, move_id}            ya tenía move/payment, solo reconcilió
      {ok, skipped, reason}                manager sin Odoo
      {ok, deferred}                       recibo_mensual → Fase 6
      {ok, busy}                           otro thread está sincronizando
      {ok, false, error}                   error
    """
    # ── LOCK OPTIMISTA: marca 'syncing' atomicamente. Si otra ejecución ya
    # lo está procesando o ya terminó, retorna sin tocar.
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT v.*, m.odoo_cuotas_enabled
                         FROM pos_venta v
                    LEFT JOIN manager_config m ON m.id_manager = v.id_manager
                        WHERE v.id = %s AND v.id_manager = %s""",
                    (venta_id, str(id_manager)))
        v = cur.fetchone()
        if not v:
            return {'ok': False, 'error': 'venta_not_found'}
        if v['odoo_move_id']:
            # Ya tiene move. Estados posibles:
            #  (a) tiene payment + reconciled OK → already_synced
            #  (b) tiene payment + residual > 0 → reintentar reconcile
            #  (c) NO tiene payment (crash entre create_move y create_payment,
            #      Audit #6 mayo 2026) → crear payment + reconcile abajo
            #      (cae por el flujo normal de creación). NO devolvemos
            #      already_synced para no dejar invoice sin pagar forever.
            try:
                o = OdooCuotas(id_manager=id_manager)
            except Exception as e:
                return {'ok': False, 'error': f'odoo_unavailable: {e}'}
            if v.get('odoo_payment_id'):
                try:
                    inv = o._call('account.move', 'read', [v['odoo_move_id']],
                                  ['amount_residual', 'payment_state'])
                    residual = float(inv[0].get('amount_residual', 0)) if inv else 0
                    if residual > 0:
                        _reconcile(o, v['odoo_move_id'], v['odoo_payment_id'],
                                   o.company_id)
                        # Re-leer tras reconcile
                        inv2 = o._call('account.move', 'read', [v['odoo_move_id']],
                                       ['amount_residual'])
                        residual2 = float(inv2[0].get('amount_residual', 0)) if inv2 else 0
                        return {'ok': True, 'reconciled': residual2 == 0,
                                'move_id': v['odoo_move_id'],
                                'residual': residual2}
                    return {'ok': True, 'already_synced': True,
                            'move_id': v['odoo_move_id']}
                except Exception as e:
                    log.warning(f'reintento reconcile venta {venta_id}: {e}')
                    return {'ok': False, 'error': f'reconcile_failed: {e}'}
            # Caso (c): orphan move sin payment. Caemos en el flujo normal
            # SIN volver a crear move (la idempotency search-by-ref lo reusará).
            log.info(f'sync_venta {venta_id}: orphan move {v["odoo_move_id"]} '
                     f'sin payment — completando flujo')
            # No early-return — sigue abajo. Pero el `if v["estado"] != "completada"`
            # podría disparar. Lo permitimos: si está anulada, otro flujo lo
            # arreglará.
        if v['estado'] != 'completada':
            return {'ok': False, 'error': f'estado={v["estado"]}_no_sincronizable'}
        if not v['odoo_cuotas_enabled']:
            _mark(cur, venta_id, 'skipped', 'manager_sin_odoo')
            conn.commit()
            return {'ok': True, 'skipped': True, 'reason': 'manager_sin_odoo'}
        if v['metodo_pago'] == 'recibo_mensual':
            # Fase 6: acumular en invoice draft mensual del cliente
            # (NO postear, lo cerrará la remesa SEPA al final de mes).
            conn.commit()  # libera lock antes de llamar al helper que vuelve a abrir conn
            return aplicar_a_recibo_mensual(id_manager, venta_id)

        # LOCK: solo procedo si nadie más lo tiene marcado 'syncing'.
        # TTL: aceptamos también ventas que llevan 'syncing' >5 min — significa
        # que el worker que las cogió murió mid-flight (OOM, SIGTERM, deploy).
        # Sin este TTL las ventas zombies son irrecuperables sin SQL manual.
        cur.execute("""UPDATE pos_venta
                          SET sync_status='syncing', sync_attempted_at=NOW()
                        WHERE id=%s AND id_manager=%s
                          AND (sync_status NOT IN ('syncing','synced')
                               OR (sync_status='syncing'
                                   AND sync_attempted_at < NOW() - INTERVAL '5 minutes'))
                       RETURNING id""",
                    (venta_id, str(id_manager)))
        if not cur.fetchone():
            conn.commit()
            log.info(f'sync_venta {venta_id}: otro proceso lo está sincronizando')
            return {'ok': True, 'busy': True}
        conn.commit()

        cur.execute("""SELECT * FROM pos_venta_linea
                        WHERE venta_id = %s ORDER BY id""", (venta_id,))
        lineas = cur.fetchall()

    o = OdooCuotas(id_manager=id_manager)
    try:
        company_id = o.company_id
        partner_id = _partner_for_venta(o, company_id,
                                          v.get('cliente_id'),
                                          v.get('cliente_nombre'))

        # Construir líneas de la factura
        line_vals = []
        for l in lineas:
            iva_pct = float(l['iva_pct'] or 0)
            tax_id = _tax_for(o, company_id, iva_pct)
            if tax_id is None:
                # Audit #8: no continuar silenciosamente con IVA 0. Lanzar
                # excepción que llegue al except superior → sync_status='error'
                raise RuntimeError(
                    f'No se pudo resolver tax {iva_pct}% en company '
                    f'{company_id}. Verifica el plan de cuentas en Odoo.')
            account_id = _account_for(o, company_id, l['cuenta_contable'])
            if account_id is None and l.get('cuenta_contable'):
                raise RuntimeError(
                    f"No existe la cuenta {l['cuenta_contable']} en company "
                    f"{company_id}. Verifica el plan de cuentas en Odoo.")
            # Como el tax tiene price_include=True (ver _tax_for), pasamos
            # directamente el precio que ve el cliente (con IVA) y Odoo
            # desglosa exactamente igual que nosotros — sin descuadres de
            # céntimo por redondeo intermedio.
            cant = float(l['cantidad']) or 1
            precio_unit_iva_incl = float(l['precio_unit'])
            line = {
                'name': l['nombre'][:200],
                'quantity': cant,
                'price_unit': precio_unit_iva_incl,
                'tax_ids': [(6, 0, [tax_id])] if tax_id else [(6, 0, [])],
            }
            if account_id:
                line['account_id'] = account_id
            line_vals.append((0, 0, line))

        # IDEMPOTENCY: buscar move existente por ref=numero. El numero es
        # UNIQUE per trainer+año, así que si ya existe es nuestro y lo
        # reusamos. Cubre el caso "Odoo creó el move, BD no llegó a UPDATE".
        existing = o._call('account.move', 'search',
                            [('ref', '=', v['numero']),
                             ('move_type', '=', 'out_invoice'),
                             ('company_id', '=', company_id),
                             ('state', '!=', 'cancel')],
                            limit=1)
        if existing:
            move_id = existing[0]
            log.info(f'sync_venta {venta_id}: reusando move existente {move_id} '
                     f'(ref={v["numero"]})')
            # Postear si quedó en draft
            inv = o._call('account.move', 'read', [move_id], ['state'])
            if inv and inv[0]['state'] == 'draft':
                o._call('account.move', 'action_post', [move_id])
        else:
            move_vals = {
                'move_type': 'out_invoice',
                'partner_id': partner_id,
                'invoice_date': str(v['fecha'])[:10],
                'invoice_line_ids': line_vals,
                'company_id': company_id,
                'narration': f'TPV {v["numero"]}'
                             + (f' · {v["notas"]}' if v.get('notas') else ''),
                'ref': v['numero'],
            }
            move_id = o._call('account.move', 'create', move_vals)
            o._call('account.move', 'action_post', [move_id])

        # Crear payment + reconciliar (también idempotente: buscar por
        # payment_reference antes de crear)
        jtype = METODO_A_JOURNAL_TYPE.get(v['metodo_pago'], 'cash')
        jid = _journal_for(o, company_id, jtype)
        payment_id = None
        if jid:
            pref = f'TPV {v["numero"]}'
            existing_pay = o._call('account.payment', 'search',
                                    [('payment_reference', '=', pref),
                                     ('company_id', '=', company_id),
                                     ('state', '!=', 'cancel')],
                                    limit=1)
            if existing_pay:
                payment_id = existing_pay[0]
                log.info(f'sync_venta {venta_id}: reusando payment existente {payment_id}')
            else:
                payment_id = o._call('account.payment', 'create', {
                    'partner_id': partner_id,
                    'partner_type': 'customer',
                    'payment_type': 'inbound',
                    'amount': float(v['total']),
                    'date': str(v['fecha'])[:10],
                    'journal_id': jid,
                    'company_id': company_id,
                    'payment_reference': pref,
                })
            # action_post + reconcile: NO swallow. Si fallan, dejamos sync_status
            # 'error' con detalle para reintento manual. Persistimos los IDs
            # creados para que el reintento sea idempotente (Audit #5 mayo 2026).
            try:
                o._call('account.payment', 'action_post', [payment_id])
                _reconcile(o, move_id, payment_id, company_id)
            except Exception as e:
                log.exception(f'sync venta {venta_id} action_post/reconcile')
                with get_conn() as conn, conn.cursor() as cur:
                    # Guardar IDs creados para que la próxima retry los reuse
                    cur.execute("""UPDATE pos_venta
                                      SET odoo_move_id=%s, odoo_payment_id=%s,
                                          sync_status='error',
                                          sync_error=%s, sync_attempted_at=NOW(),
                                          updated_at=NOW()
                                    WHERE id=%s""",
                                (move_id, payment_id,
                                 f'action_post_reconcile_failed: {str(e)[:400]}',
                                 venta_id))
                    conn.commit()
                return {'ok': False,
                        'error': f'action_post_reconcile_failed: {e}',
                        'move_id': move_id, 'payment_id': payment_id}

        # Validar estado real ANTES de marcar synced. Si el invoice quedó con
        # residual>0 (reconcile no emparejó del todo, payment no posteó), NO
        # marcamos 'synced' — queda 'error' para reintento manual.
        try:
            inv_check = o._call('account.move', 'read', [move_id],
                                ['amount_residual', 'payment_state', 'state'])
            residual = float(inv_check[0].get('amount_residual', 0)) if inv_check else 0
            state = inv_check[0].get('state') if inv_check else None
        except Exception as e:
            residual = -1; state = 'unknown'
            log.warning(f'sync venta {venta_id}: no se pudo releer move: {e}')

        if state != 'posted' or residual != 0:
            with get_conn() as conn, conn.cursor() as cur:
                cur.execute("""UPDATE pos_venta
                                  SET odoo_move_id=%s, odoo_payment_id=%s,
                                      sync_status='error',
                                      sync_error=%s, sync_attempted_at=NOW(),
                                      updated_at=NOW()
                                WHERE id=%s""",
                            (move_id, payment_id,
                             f'post_sync_state=state={state} residual={residual}',
                             venta_id))
                conn.commit()
            return {'ok': False, 'error': 'post_sync_invalid_state',
                    'state': state, 'residual': residual,
                    'move_id': move_id, 'payment_id': payment_id}

        # Persistir IDs (estado real validado: posted + residual=0)
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""UPDATE pos_venta
                              SET odoo_move_id=%s, odoo_payment_id=%s,
                                  sync_status='synced', sync_error=NULL,
                                  sync_attempted_at=NOW(), updated_at=NOW()
                            WHERE id=%s""",
                        (move_id, payment_id, venta_id))
            conn.commit()
        return {'ok': True, 'move_id': move_id, 'payment_id': payment_id}

    except Exception as e:
        log.exception(f'sync_venta {venta_id}')
        with get_conn() as conn, conn.cursor() as cur:
            _mark(cur, venta_id, 'error', str(e)[:500])
            conn.commit()
        return {'ok': False, 'error': str(e)}


def _mark(cur, venta_id, status, msg=None):
    cur.execute("""UPDATE pos_venta
                      SET sync_status=%s, sync_error=%s, sync_attempted_at=NOW()
                    WHERE id=%s""",
                (status, msg, venta_id))


def _reconcile(o, move_id, payment_id, company_id):
    """Empareja la línea 'receivable' del payment con la del invoice para
    que el invoice quede en estado 'paid'.

    Cuidado: account.payment.move_id ≠ payment_id. El payment crea su propio
    account.move; las account.move.line viven en ese move, no en el payment.
    """
    # Resolver el journal entry (account.move) creado por el payment
    pay_read = o._call('account.payment', 'read', [payment_id], ['move_id'])
    if not pay_read or not pay_read[0].get('move_id'):
        log.warning(f'reconcile: payment {payment_id} sin move_id (¿posteado?)')
        return
    payment_move_id = pay_read[0]['move_id'][0]
    pay_lines = o._call('account.move.line', 'search',
                        [('move_id', '=', payment_move_id),
                         ('account_id.account_type', '=', 'asset_receivable'),
                         ('reconciled', '=', False),
                         ('company_id', '=', company_id)])
    inv_lines = o._call('account.move.line', 'search',
                        [('move_id', '=', move_id),
                         ('account_id.account_type', '=', 'asset_receivable'),
                         ('reconciled', '=', False),
                         ('company_id', '=', company_id)])
    if not pay_lines or not inv_lines:
        log.warning(f'reconcile: sin líneas a emparejar move={move_id} '
                    f'payment_move={payment_move_id}')
        return
    o._call('account.move.line', 'reconcile', pay_lines + inv_lines)


def aplicar_a_recibo_mensual(id_manager, venta_id):
    """Acumula una venta TPV `metodo_pago=recibo_mensual` en el invoice draft
    mensual del cliente. Si el draft no existe, lo crea con
    ref=`TPV-AAAA-MM-<partner_id>` (idempotency key). Si existe, añade las
    líneas (idempotente vía búsqueda por nombre de línea = numero de venta).

    NO postea ni cobra: queda en draft hasta que el emisor mensual lo
    incluya en la remesa SEPA (o el operador lo postee manualmente).

    Política:
      * Requiere cliente_id (validado ya en crear_venta).
      * Solo se aplica si manager tiene odoo_cuotas_enabled.
      * Estado final pos_venta.sync_status='applied_to_recibo' y
        pos_venta.recibo_id=<account.move.id del draft>.
    """
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT v.*, m.odoo_cuotas_enabled
                         FROM pos_venta v
                    LEFT JOIN manager_config m ON m.id_manager = v.id_manager
                        WHERE v.id = %s AND v.id_manager = %s""",
                    (venta_id, str(id_manager)))
        v = cur.fetchone()
        if not v:
            return {'ok': False, 'error': 'venta_not_found'}
        if not v.get('cliente_id'):
            return {'ok': False, 'error': 'cliente_required'}
        if not v['odoo_cuotas_enabled']:
            _mark(cur, venta_id, 'skipped', 'manager_sin_odoo')
            conn.commit()
            return {'ok': True, 'skipped': True}
        if v.get('recibo_id'):
            # Ya aplicada — comprobar que la línea está realmente añadida
            # (idempotency real). Por ahora retornamos OK.
            return {'ok': True, 'already_applied': True,
                    'recibo_id': v['recibo_id']}

        # LOCK optimista. Mismo TTL de 5 min que sync_venta para recuperar
        # ventas zombi tras worker crash (Audit #7 mayo 2026).
        cur.execute("""UPDATE pos_venta
                          SET sync_status='syncing', sync_attempted_at=NOW()
                        WHERE id=%s AND id_manager=%s
                          AND (sync_status NOT IN ('syncing','applied_to_recibo','synced')
                               OR (sync_status='syncing'
                                   AND sync_attempted_at < NOW() - INTERVAL '5 minutes'))
                       RETURNING id""",
                    (venta_id, str(id_manager)))
        if not cur.fetchone():
            conn.commit()
            return {'ok': True, 'busy': True}
        conn.commit()

        cur.execute("""SELECT * FROM pos_venta_linea
                        WHERE venta_id = %s ORDER BY id""", (venta_id,))
        lineas = cur.fetchall()

    o = OdooCuotas(id_manager=id_manager)
    try:
        company_id = o.company_id
        partner_id = _partner_for_venta(o, company_id,
                                          v['cliente_id'], v.get('cliente_nombre'))
        # año-mes de la venta
        fecha_str = str(v['fecha'])[:7]   # 'YYYY-MM'
        recibo_ref = f'TPV-{fecha_str}-{partner_id}'

        # Buscar invoice draft existente (idempotency key)
        existing = o._call('account.move', 'search',
                            [('ref', '=', recibo_ref),
                             ('move_type', '=', 'out_invoice'),
                             ('company_id', '=', company_id),
                             ('state', 'in', ['draft', 'posted'])],
                            limit=1)

        # Construir líneas con nombre prefijado por numero de venta para
        # poder detectar duplicados si re-ejecutamos.
        line_vals = []
        for l in lineas:
            iva_pct = float(l['iva_pct'] or 0)
            tax_id = _tax_for(o, company_id, iva_pct)
            account_id = _account_for(o, company_id, l['cuenta_contable'])
            cant = float(l['cantidad']) or 1
            line = {
                'name': f'[{v["numero"]}] {l["nombre"][:180]}',
                'quantity': cant,
                'price_unit': float(l['precio_unit']),
                'tax_ids': [(6, 0, [tax_id])] if tax_id else [(6, 0, [])],
            }
            if account_id:
                line['account_id'] = account_id
            line_vals.append((0, 0, line))

        if existing:
            recibo_id = existing[0]
            inv = o._call('account.move', 'read', [recibo_id], ['state'])[0]
            if inv['state'] != 'draft':
                # El draft mensual ya se posteó (raro pero posible si la
                # remesa salió antes de que llegara la venta). Crear un
                # invoice separado con ref único para esta venta.
                log.warning(f'aplicar_a_recibo {venta_id}: draft mensual ya '
                            f'posteado, creando invoice separado')
                recibo_id = _crear_invoice_simple(o, company_id, partner_id,
                                                    v, line_vals,
                                                    ref=f'TPV-LATE-{v["numero"]}')
            else:
                # Verificar que las líneas de esta venta no estén ya añadidas
                # (idempotency real). Buscar account.move.line con name LIKE [numero]%
                already = o._call('account.move.line', 'search',
                                    [('move_id', '=', recibo_id),
                                     ('name', 'like', f'[{v["numero"]}]%')],
                                    limit=1)
                if already:
                    log.info(f'aplicar_a_recibo {venta_id}: líneas ya '
                             f'añadidas al draft {recibo_id}')
                else:
                    o._call('account.move', 'write', [recibo_id],
                            {'invoice_line_ids': line_vals})
        else:
            # Crear el draft mensual nuevo
            recibo_id = o._call('account.move', 'create', {
                'move_type': 'out_invoice',
                'partner_id': partner_id,
                'invoice_date': str(v['fecha'])[:10],
                'invoice_line_ids': line_vals,
                'company_id': company_id,
                'ref': recibo_ref,
                'narration': f'Consumos TPV acumulados — {fecha_str}',
            })
            log.info(f'aplicar_a_recibo {venta_id}: creado draft mensual '
                     f'{recibo_id} (ref={recibo_ref})')

        # Persistir IDs
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""UPDATE pos_venta
                              SET recibo_id=%s, sync_status='applied_to_recibo',
                                  sync_error=NULL, sync_attempted_at=NOW(),
                                  updated_at=NOW()
                            WHERE id=%s""", (recibo_id, venta_id))
            conn.commit()
        return {'ok': True, 'recibo_id': recibo_id, 'aplicado': True}

    except Exception as e:
        log.exception(f'aplicar_a_recibo_mensual {venta_id}')
        with get_conn() as conn, conn.cursor() as cur:
            _mark(cur, venta_id, 'error', f'aplicar_recibo_fail: {str(e)[:400]}')
            conn.commit()
        return {'ok': False, 'error': str(e)}


def _crear_invoice_simple(o, company_id, partner_id, v, line_vals, ref):
    """Crea invoice draft simple cuando no podemos colgar de un draft mensual
    (porque ya estaba posteado). Es el fallback."""
    return o._call('account.move', 'create', {
        'move_type': 'out_invoice',
        'partner_id': partner_id,
        'invoice_date': str(v['fecha'])[:10],
        'invoice_line_ids': line_vals,
        'company_id': company_id,
        'ref': ref,
        'narration': f'TPV consumo tardío {v["numero"]} (recibo mes ya cerrado)',
    })


def revertir_aplicacion_recibo_mensual(id_manager, venta_id, motivo=''):
    """Anular una venta cuyo sync_status='applied_to_recibo': elimina las
    líneas '[T-2026-NNNNN] ...' del draft mensual (account.move state='draft').
    Si el draft ya está posteado (remesa cerrada), crea out_refund — fallback.

    Idempotente: si las líneas ya no están en el draft, devuelve already_reverted.
    """
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT * FROM pos_venta
                        WHERE id = %s AND id_manager = %s""",
                    (venta_id, str(id_manager)))
        v = cur.fetchone()
    if not v:
        return {'ok': False, 'error': 'venta_not_found'}
    recibo_id = v.get('recibo_id')
    if not recibo_id:
        return {'ok': True, 'sin_recibo': True}

    o = OdooCuotas(id_manager=id_manager)
    company_id = o.company_id
    try:
        inv = o._call('account.move', 'read', [recibo_id],
                      ['state', 'invoice_line_ids'])
        if not inv:
            log.warning(f'revert applied_to_recibo {venta_id}: draft {recibo_id} no existe')
            return {'ok': True, 'recibo_borrado': True}
        state = inv[0]['state']
        if state == 'draft':
            # Buscar líneas que arrancan con [numero]
            line_ids_to_remove = o._call('account.move.line', 'search',
                [('move_id', '=', recibo_id),
                 ('name', 'like', f'[{v["numero"]}]%')])
            if not line_ids_to_remove:
                log.info(f'revert applied_to_recibo {venta_id}: líneas ya removidas')
            else:
                # (2, id, 0) elimina la línea del move
                o._call('account.move', 'write', [recibo_id],
                        {'invoice_line_ids': [(2, lid, 0) for lid in line_ids_to_remove]})
                log.info(f'revert applied_to_recibo {venta_id}: removidas '
                         f'{len(line_ids_to_remove)} líneas del draft {recibo_id}')
            # Mark venta
            with get_conn() as conn, conn.cursor() as cur:
                cur.execute("""UPDATE pos_venta
                                  SET sync_status='reverted', sync_error=NULL,
                                      sync_attempted_at=NOW(), updated_at=NOW()
                                WHERE id=%s""", (venta_id,))
                conn.commit()
            return {'ok': True, 'lineas_removidas': len(line_ids_to_remove or []),
                    'recibo_id': recibo_id}
        else:
            # Draft ya posteado / cancelado → fallback: out_refund por las
            # líneas de esta venta (consumo a devolver al cliente).
            log.warning(f'revert applied_to_recibo {venta_id}: draft {recibo_id} '
                        f'estado={state} — fallback a out_refund separado')
            # Reusamos revertir_venta_odoo si tuviéramos odoo_move_id…
            # pero applied_to_recibo no tiene odoo_move_id propio. Creamos
            # refund manual leyendo las líneas de pos_venta_linea.
            return _refund_aplicacion_posteada(o, company_id, v, motivo)
    except Exception as e:
        log.exception(f'revertir_aplicacion_recibo_mensual {venta_id}')
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""UPDATE pos_venta SET sync_error=%s, sync_attempted_at=NOW()
                            WHERE id=%s""",
                        (f'revert_aplicacion_failed: {str(e)[:400]}', venta_id))
            conn.commit()
        return {'ok': False, 'error': str(e)}


def _refund_aplicacion_posteada(o, company_id, v, motivo):
    """Fallback cuando el draft mensual de un applied_to_recibo ya está
    posteado: crea un out_refund con las líneas de pos_venta_linea.
    """
    from .db import get_conn
    venta_id = v['id']
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT * FROM pos_venta_linea WHERE venta_id=%s ORDER BY id",
                    (venta_id,))
        lineas = cur.fetchall()
    refund_ref = f'REV-APLIC {v["numero"]}'
    existing = o._call('account.move', 'search',
                       [('ref', '=', refund_ref),
                        ('move_type', '=', 'out_refund'),
                        ('company_id', '=', company_id),
                        ('state', '!=', 'cancel')], limit=1)
    if existing:
        # Sprint 4 #C2: revalidar estado real antes de retornar OK y
        # PERSISTIR el id en BD (antes solo se retornaba ok=True sin
        # actualizar pos_venta — la fila quedaba en sync_status='reverting'
        # para siempre aunque Odoo ya tenía el refund).
        refund_id = existing[0]
        try:
            inv = o._call('account.move', 'read', [refund_id],
                          ['state', 'amount_residual'])
            r_state = inv[0]['state'] if inv else 'unknown'
            r_residual = float(inv[0].get('amount_residual', 0)) if inv else -1
        except Exception:
            r_state, r_residual = 'unknown', -1
        if r_state != 'posted' or r_residual != 0:
            with get_conn() as conn, conn.cursor() as cur:
                cur.execute("""UPDATE pos_venta
                                  SET odoo_refund_move_id=%s,
                                      sync_status='error',
                                      sync_error=%s,
                                      sync_attempted_at=NOW(),
                                      updated_at=NOW()
                                WHERE id=%s""",
                            (refund_id,
                             f'revert_aplic_existing_invalid state={r_state} residual={r_residual}',
                             venta_id))
                conn.commit()
            return {'ok': False, 'error': 'revert_existing_invalid',
                    'state': r_state, 'residual': r_residual,
                    'refund_id': refund_id}
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""UPDATE pos_venta
                              SET odoo_refund_move_id=%s,
                                  sync_status='reverted', sync_error=NULL,
                                  updated_at=NOW()
                            WHERE id=%s AND odoo_refund_move_id IS NULL""",
                        (refund_id, venta_id))
            conn.commit()
        return {'ok': True, 'refund_id': refund_id,
                'already_reverted': True}
    partner_id = _partner_for_venta(o, company_id, v['cliente_id'],
                                     v.get('cliente_nombre'))
    line_vals = []
    for l in lineas:
        iva_pct = float(l['iva_pct'] or 0)
        tax_id = _tax_for(o, company_id, iva_pct)
        account_id = _account_for(o, company_id, l['cuenta_contable'])
        line = {
            'name': f'[REV {v["numero"]}] {l["nombre"][:170]}',
            'quantity': float(l['cantidad']) or 1,
            'price_unit': float(l['precio_unit']),
            'tax_ids': [(6, 0, [tax_id])] if tax_id else [(6, 0, [])],
        }
        if account_id:
            line['account_id'] = account_id
        line_vals.append((0, 0, line))
    refund_id = o._call('account.move', 'create', {
        'move_type': 'out_refund',
        'partner_id': partner_id,
        'invoice_date': str(v['fecha'])[:10],
        'invoice_line_ids': line_vals,
        'company_id': company_id,
        'ref': refund_ref,
        'narration': f'Anulación venta TPV {v["numero"]} (aplicada a recibo) · {motivo}',
    })
    o._call('account.move', 'action_post', [refund_id])

    # Sprint 1 fix #2 (audit prof. mayo 2026): el refund applied_to_recibo
    # quedaba posted SIN payment outbound → residual=total para siempre,
    # contabilidad cuelga un saldo a devolver al cliente que nunca se cobra
    # del banco. Creamos payment outbound + reconcile.
    # Journal: `recibo_mensual` siempre se cobra por banco (SEPA) → bank.
    payment_id = None
    try:
        jid = _journal_for(o, company_id, 'bank')
        if not jid:
            log.warning(f'_refund_aplicacion_posteada {venta_id}: '
                        f'no hay bank journal — refund queda sin payment')
        else:
            pref = f'REVERT-APLIC {v["numero"]}'
            existing_pay = o._call('account.payment', 'search',
                                   [('payment_reference', '=', pref),
                                    ('company_id', '=', company_id),
                                    ('state', '!=', 'cancel')], limit=1)
            if existing_pay:
                payment_id = existing_pay[0]
            else:
                payment_id = o._call('account.payment', 'create', {
                    'partner_id': partner_id,
                    'partner_type': 'customer',
                    'payment_type': 'outbound',     # devolución al cliente
                    'amount': abs(float(v['total'])),
                    'date': str(v['fecha'])[:10],
                    'journal_id': jid,
                    'company_id': company_id,
                    'payment_reference': pref,
                })
            o._call('account.payment', 'action_post', [payment_id])
            _reconcile(o, refund_id, payment_id, company_id)
    except Exception as e:
        log.exception(f'_refund_aplicacion_posteada {venta_id} payment/reconcile')
        # No abortamos: el refund ya está creado y posted. Marcamos error
        # para que el operador reintente — el retry detectará el refund por
        # el `existing` arriba y solo recreará el payment.
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""UPDATE pos_venta
                              SET odoo_refund_move_id=%s,
                                  odoo_refund_payment_id=%s,
                                  sync_status='error',
                                  sync_error=%s,
                                  sync_attempted_at=NOW(),
                                  updated_at=NOW()
                            WHERE id=%s""",
                        (refund_id, payment_id,
                         f'revert_aplicacion_payment_failed: {str(e)[:400]}',
                         venta_id))
            conn.commit()
        return {'ok': False, 'error': str(e),
                'refund_id': refund_id, 'payment_id': payment_id}

    # Validar residual del refund tras reconcile
    try:
        inv_check = o._call('account.move', 'read', [refund_id],
                            ['amount_residual', 'state'])
        residual = float(inv_check[0].get('amount_residual', 0)) if inv_check else -1
        state = inv_check[0].get('state') if inv_check else 'unknown'
    except Exception:
        residual = -1; state = 'unknown'

    if state != 'posted' or (payment_id and residual != 0):
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""UPDATE pos_venta
                              SET odoo_refund_move_id=%s,
                                  odoo_refund_payment_id=%s,
                                  sync_status='error',
                                  sync_error=%s,
                                  sync_attempted_at=NOW(),
                                  updated_at=NOW()
                            WHERE id=%s""",
                        (refund_id, payment_id,
                         f'revert_aplicacion_invalid_state state={state} residual={residual}',
                         venta_id))
            conn.commit()
        return {'ok': False, 'error': 'revert_aplicacion_invalid_state',
                'state': state, 'residual': residual,
                'refund_id': refund_id, 'payment_id': payment_id}

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""UPDATE pos_venta
                          SET odoo_refund_move_id=%s, odoo_refund_payment_id=%s,
                              sync_status='reverted', sync_error=NULL,
                              updated_at=NOW()
                        WHERE id=%s""",
                    (refund_id, payment_id, venta_id))
        conn.commit()
    return {'ok': True, 'refund_id': refund_id, 'payment_id': payment_id}


def revertir_venta_odoo(id_manager, venta_id, motivo=''):
    """Crea un `account.move` con move_type='out_refund' que revierte
    el invoice original y se reconcilia con un payment de salida que
    deshace el cobro. Tras esto Odoo marca el invoice original como
    reconciled-against-refund (residual sigue 0 pero ambos están atados).

    Idempotente: si ya existe un refund con ref='REV TPV-XXX', lo reusa.

    Sprint 1 fix #3 (audit prof. mayo 2026):
      * Lock optimista BD `sync_status='reverting'` con TTL 5min — evita
        que dos hilos concurrentes creen dos refunds en paralelo.
      * Tras reconcile valida `amount_residual == 0` del refund;
        si no, marca sync_status='error' (NO 'reverted').
    """
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT * FROM pos_venta
                        WHERE id = %s AND id_manager = %s""",
                    (venta_id, str(id_manager)))
        v = cur.fetchone()
        if not v:
            return {'ok': False, 'error': 'venta_not_found'}
        if not v.get('odoo_move_id'):
            return {'ok': True, 'sin_odoo': True}
        if v.get('odoo_refund_move_id'):
            # Ya revertido — informar al caller (idempotente)
            return {'ok': True, 'already_reverted': True,
                    'refund_id': v['odoo_refund_move_id']}
        # LOCK: solo procedo si nadie más está revirtiendo. Igual TTL que
        # sync_venta (Audit #7) — un worker muerto a mitad libera el lock
        # tras 5 minutos para que un retry manual lo recoja.
        cur.execute("""UPDATE pos_venta
                          SET sync_status='reverting', sync_attempted_at=NOW()
                        WHERE id=%s AND id_manager=%s
                          AND (sync_status NOT IN ('reverting','reverted')
                               OR (sync_status='reverting'
                                   AND sync_attempted_at < NOW() - INTERVAL '5 minutes'))
                       RETURNING id""",
                    (venta_id, str(id_manager)))
        if not cur.fetchone():
            conn.commit()
            log.info(f'revert venta {venta_id}: ya hay otro worker revirtiendo')
            return {'ok': True, 'busy': True}
        conn.commit()

    o = OdooCuotas(id_manager=id_manager)
    company_id = o.company_id
    refund_ref = f'REV {v["numero"]}'

    # ¿Ya existe? (idempotency Odoo además del lock BD)
    existing_refund = o._call('account.move', 'search',
                              [('ref', '=', refund_ref),
                               ('move_type', '=', 'out_refund'),
                               ('company_id', '=', company_id),
                               ('state', '!=', 'cancel')],
                              limit=1)
    if existing_refund:
        log.info(f'revert venta {venta_id}: refund ya existe {existing_refund[0]}')
        # Sprint 4 #C1: NO marcar 'reverted' a ciegas. Re-validamos que el
        # refund preexistente esté posted y con residual=0 (i.e. tiene su
        # payment outbound reconciliado). Si NO lo está, marcamos 'error'
        # con el motivo y dejamos que el operador lo reintente — el flujo
        # principal abajo creará el payment que faltaba.
        refund_id = existing_refund[0]
        try:
            inv = o._call('account.move', 'read', [refund_id],
                          ['state', 'amount_residual'])
            r_state = inv[0]['state'] if inv else 'unknown'
            r_residual = float(inv[0].get('amount_residual', 0)) if inv else -1
        except Exception:
            r_state, r_residual = 'unknown', -1
        if r_state != 'posted' or r_residual != 0:
            with get_conn() as conn, conn.cursor() as cur:
                cur.execute("""UPDATE pos_venta
                                  SET odoo_refund_move_id=%s,
                                      sync_status='error',
                                      sync_error=%s,
                                      sync_attempted_at=NOW(),
                                      updated_at=NOW()
                                WHERE id=%s""",
                            (refund_id,
                             f'revert_existing_invalid state={r_state} residual={r_residual}',
                             venta_id))
                conn.commit()
            return {'ok': False, 'error': 'revert_existing_invalid',
                    'state': r_state, 'residual': r_residual,
                    'refund_id': refund_id}
        # Estado válido: persistir como reverted (idempotente)
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""UPDATE pos_venta
                              SET odoo_refund_move_id=%s,
                                  sync_status='reverted', sync_error=NULL,
                                  updated_at=NOW()
                            WHERE id=%s AND odoo_refund_move_id IS NULL""",
                        (refund_id, venta_id))
            conn.commit()
        return {'ok': True, 'refund_id': refund_id,
                'already_reverted': True}

    try:
        # Uso del método nativo Odoo: account.move.refund() es
        # account.move._reverse_moves(). Más fiable usar account.move.reversal
        # wizard, pero su create con journal_id y date crea el move directamente.
        # Aproximación robusta: copia el invoice como out_refund manualmente.
        inv = o._call('account.move', 'read', [v['odoo_move_id']],
                      ['partner_id', 'invoice_line_ids', 'company_id'])[0]
        # Leer las líneas del invoice
        line_ids = inv.get('invoice_line_ids', [])
        lines_data = o._call('account.move.line', 'read', line_ids,
                             ['name', 'quantity', 'price_unit', 'tax_ids',
                              'account_id', 'display_type']) if line_ids else []
        # Filtrar solo líneas producto (no tax/payment_term lines)
        refund_lines = []
        for l in lines_data:
            if l.get('display_type') in ('tax', 'payment_term', 'line_section', 'line_note'):
                continue
            tax_ids = [t for t in (l.get('tax_ids') or [])]
            refund_lines.append((0, 0, {
                'name': l['name'],
                'quantity': l['quantity'],
                'price_unit': l['price_unit'],
                'tax_ids': [(6, 0, tax_ids)],
                'account_id': l['account_id'][0] if isinstance(l['account_id'], list) else l['account_id'],
            }))
        refund_id = o._call('account.move', 'create', {
            'move_type': 'out_refund',
            'partner_id': inv['partner_id'][0],
            'invoice_date': str(v['fecha'])[:10],
            'invoice_line_ids': refund_lines,
            'company_id': company_id,
            'ref': refund_ref,
            'narration': f'Anulación venta TPV {v["numero"]}'
                          + (f' · motivo: {motivo}' if motivo else ''),
            'reversed_entry_id': v['odoo_move_id'],
        })
        o._call('account.move', 'action_post', [refund_id])

        # Crear payment de salida (outbound) por el mismo importe en el
        # mismo journal que el cobro original.
        payment_id = None
        if v.get('odoo_payment_id'):
            pay = o._call('account.payment', 'read', [v['odoo_payment_id']],
                          ['journal_id'])
            if pay:
                pref = f'REVERT TPV {v["numero"]}'
                existing_pay = o._call('account.payment', 'search',
                                       [('payment_reference', '=', pref),
                                        ('company_id', '=', company_id)],
                                       limit=1)
                if existing_pay:
                    payment_id = existing_pay[0]
                else:
                    payment_id = o._call('account.payment', 'create', {
                        'partner_id': inv['partner_id'][0],
                        'partner_type': 'customer',
                        'payment_type': 'outbound',     # devolvemos al cliente
                        'amount': float(v['total']),
                        'date': str(v['fecha'])[:10],
                        'journal_id': pay[0]['journal_id'][0],
                        'company_id': company_id,
                        'payment_reference': pref,
                    })
                try:
                    o._call('account.payment', 'action_post', [payment_id])
                    _reconcile(o, refund_id, payment_id, company_id)
                except Exception as e:
                    log.exception(f'revert {venta_id} action_post/reconcile')
                    with get_conn() as conn, conn.cursor() as cur:
                        # Persistir IDs creados → próximo retry los reusa
                        cur.execute("""UPDATE pos_venta
                                          SET odoo_refund_move_id=%s,
                                              odoo_refund_payment_id=%s,
                                              sync_status='error',
                                              sync_error=%s,
                                              sync_attempted_at=NOW(),
                                              updated_at=NOW()
                                        WHERE id=%s""",
                                    (refund_id, payment_id,
                                     f'revert_post_reconcile_failed: {str(e)[:400]}',
                                     venta_id))
                        conn.commit()
                    return {'ok': False, 'error': str(e),
                            'refund_id': refund_id, 'payment_id': payment_id}

        # Validar residual del refund (post-reconcile). Si el reconcile no
        # emparejó del todo (silent reconcile failure que no lanzó), residual>0
        # → marcar error en lugar de reverted (Sprint 1 fix #3).
        try:
            inv_check = o._call('account.move', 'read', [refund_id],
                                ['amount_residual', 'state'])
            residual = float(inv_check[0].get('amount_residual', 0)) if inv_check else 0
            state = inv_check[0].get('state') if inv_check else None
        except Exception as e:
            residual = -1; state = 'unknown'
            log.warning(f'revert {venta_id}: no se pudo releer refund: {e}')

        if state != 'posted' or (payment_id and residual != 0):
            with get_conn() as conn, conn.cursor() as cur:
                cur.execute("""UPDATE pos_venta
                                  SET odoo_refund_move_id=%s,
                                      odoo_refund_payment_id=%s,
                                      sync_status='error',
                                      sync_error=%s,
                                      sync_attempted_at=NOW(),
                                      updated_at=NOW()
                                WHERE id=%s""",
                            (refund_id, payment_id,
                             f'revert_post_state={state} residual={residual}',
                             venta_id))
                conn.commit()
            return {'ok': False, 'error': 'revert_invalid_state',
                    'state': state, 'residual': residual,
                    'refund_id': refund_id, 'payment_id': payment_id}

        # Persistir IDs de reverso (estado validado: refund posted + reconciled)
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""UPDATE pos_venta
                              SET odoo_refund_move_id=%s,
                                  odoo_refund_payment_id=%s,
                                  sync_status='reverted', sync_error=NULL,
                                  updated_at=NOW()
                            WHERE id=%s""",
                        (refund_id, payment_id, venta_id))
            conn.commit()
        return {'ok': True, 'refund_id': refund_id, 'payment_id': payment_id}
    except Exception as e:
        log.exception(f'revertir_venta_odoo {venta_id}')
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""UPDATE pos_venta SET sync_error=%s WHERE id=%s""",
                        (f'revert_failed: {str(e)[:400]}', venta_id))
            conn.commit()
        return {'ok': False, 'error': str(e)}


def sync_async(id_manager, venta_id):
    """Lanza la sync en un thread daemon para no bloquear la respuesta al TPV.
    Útil para llamarlo desde crear_venta sin retrasar el redirect."""
    import threading
    def _bg():
        try:
            sync_venta(id_manager, venta_id)
        except Exception:
            log.exception(f'sync_async venta {venta_id}')
    t = threading.Thread(target=_bg, daemon=True, name=f'pos-sync-{venta_id}')
    t.start()
    return True
