"""Helpers reutilizables para crear `account.payment` Odoo desde recibos BD.

Centraliza la lógica de:
  - Encontrar journal Odoo según método de pago (bank vs cash).
  - Resolver partner Odoo por id_noofit del cliente.
  - Crear + postear `account.payment`.
  - Vincular el id del payment con `recibo.account_payment_id` en BD.

Usado por:
  - `routes/emision_v2.py` (cobro al emitir SEPA/tarjeta).
  - `routes/recibos.py` `marcar_pagado` (cobro en caja).
  - `routes/recibos.py` `generar_link_pago` (callback PayComet — pendiente).
"""
import datetime as dt
import logging

log = logging.getLogger(__name__)


# Mapeo método de pago BD → tipo de journal Odoo necesario.
# bank: cobros que pasan por banco (SEPA, tarjeta tokenizada, TPV virtual,
#       enlace de pago — todos llegan a la cuenta bancaria).
# cash: cobros en caja (efectivo, TPV físico que ingresa en caja diaria).
METODO_A_JOURNAL_TYPE = {
    'sepa':            'bank',
    'tarjeta_tok':     'bank',
    'tarjeta_token':   'bank',
    'enlace_pago':     'bank',
    'caja_tpv_virtual':'bank',
    'caja_efectivo':   'cash',
    'caja_tpv_fisico': 'cash',
}


def _journal_id_for(o, company_id, journal_type):
    """Devuelve el id del primer journal del tipo solicitado para la company.

    Cachea el resultado a nivel de proceso para evitar consultas repetidas.
    """
    cache = _journal_id_for._cache  # set en first call
    key = (company_id, journal_type)
    if key in cache:
        return cache[key]
    ids = o._call('account.journal', 'search',
                  [('company_id', '=', company_id), ('type', '=', journal_type)],
                  limit=1)
    jid = ids[0] if ids else None
    cache[key] = jid
    return jid
_journal_id_for._cache = {}


def _partner_id_for_idnoofit(o, company_id, idnoofit):
    """B2/B9 — 1 idnoofit = 1 partner GLOBAL (compartido entre companies,
    company_id NULL). Se busca solo por id_noofit; NO se filtra por company
    (evita el fallback cross-company que podía colgar el cobro de un partner
    de otra empresa). B2 garantiza unicidad de id_noofit."""
    partner_ids = o._call('res.partner', 'search',
                          [('id_noofit', '=', str(idnoofit))], limit=1)
    return partner_ids[0] if partner_ids else None


def crear_account_payment(o, *, company_id, recibo_id, cliente_idnoofit,
                          importe_total, metodo_pago, fecha_emision=None):
    """Crea + postea un `account.payment` Odoo para un recibo BD.

    Args:
      o:                 instancia OdooAlta conectada.
      company_id:        int company_id (ODOO_COMPANY).
      recibo_id:         int id del recibo en BD `recibo`.
      cliente_idnoofit:  str id NoofitPro del cliente.
      importe_total:     float importe a cobrar.
      metodo_pago:       str método BD (sepa/tarjeta_tok/caja_*/enlace_pago).
      fecha_emision:     date | str (ISO) | None → usa hoy.

    Returns:
      dict {ok: bool, payment_id: int|None, journal_id: int|None,
            error: str|None}
    """
    journal_type = METODO_A_JOURNAL_TYPE.get(metodo_pago, 'cash')
    jid = _journal_id_for(o, company_id, journal_type)
    if not jid:
        return {'ok': False, 'payment_id': None, 'journal_id': None,
                'error': f'no_journal_{journal_type}_para_company_{company_id}'}

    pid = _partner_id_for_idnoofit(o, company_id, cliente_idnoofit)
    if not pid:
        return {'ok': False, 'payment_id': None, 'journal_id': jid,
                'error': f'partner_no_encontrado_idnoofit_{cliente_idnoofit}'}

    ref = f'COBRO-RECIBO-{recibo_id}'

    def _ensure_posted(pay_id):
        """Relee el estado; si no está posteado intenta postear y devuelve estado."""
        st = (o._call('account.payment', 'read', [pay_id], ['state']) or [{}])[0].get('state')
        if st != 'posted':
            try:
                o._call('account.payment', 'action_post', [pay_id])
            except Exception as e:
                log.warning(f'action_post falló para payment {pay_id}: {e}')
            st = (o._call('account.payment', 'read', [pay_id], ['state']) or [{}])[0].get('state')
        return st

    # B9 — Idempotencia por ref: si ya existe un payment con este ref (no
    # cancelado), reutilizarlo en vez de crear otro. Cierra el doble-pago ante
    # reintentos/timeouts/concurrencia (cron+UI). El estado posted se valida.
    existing = o._call('account.payment', 'search',
        [('ref', '=', ref), ('company_id', '=', company_id), ('state', '!=', 'cancel')], limit=1)
    if existing:
        pay_id = existing[0]
        st = _ensure_posted(pay_id)
        return {'ok': st == 'posted', 'payment_id': pay_id, 'journal_id': jid,
                'reused': True, 'error': None if st == 'posted' else 'no_posted'}

    fecha = fecha_emision
    if isinstance(fecha, dt.date) and not isinstance(fecha, dt.datetime):
        fecha = fecha.isoformat()
    if not fecha:
        fecha = dt.date.today().isoformat()
    elif hasattr(fecha, 'isoformat'):
        fecha = fecha.isoformat()

    try:
        payment_id = o._call('account.payment', 'create', {
            'partner_id':   pid,
            'partner_type': 'customer',
            'payment_type': 'inbound',
            'amount':       float(importe_total),
            'date':         str(fecha)[:10],
            'journal_id':   jid,
            'company_id':   company_id,
            'ref':          ref,
        })
    except Exception as e:
        log.exception(f'crear_account_payment recibo={recibo_id}')
        return {'ok': False, 'payment_id': None, 'journal_id': jid,
                'error': f'create_failed: {e}'}

    # B9 — postear y VALIDAR estado: si no queda 'posted', ok=False para que el
    # llamador NO marque el recibo pagado en silencio (lo dejará pending → cron).
    st = _ensure_posted(payment_id)
    return {'ok': st == 'posted', 'payment_id': payment_id, 'journal_id': jid,
            'error': None if st == 'posted' else 'no_posted'}


def crear_account_payment_move(o, *, company_id, move_id, cliente_idnoofit,
                               importe, metodo_pago, fecha=None):
    """Crea+postea un `account.payment` y lo RECONCILIA contra un
    `account.move` Odoo que NO tiene recibo BD detrás (recibo puramente Odoo:
    p.ej. facturado por el wizard trimestral, o migrado). Idempotente por
    `ref=COBRO-MOVE-<move_id>`.

    Devuelve {ok, payment_id, residual, payment_state, error}.
    """
    from .odoo_pos_sync import _reconcile
    journal_type = METODO_A_JOURNAL_TYPE.get(metodo_pago, 'cash')
    jid = _journal_id_for(o, company_id, journal_type)
    if not jid:
        return {'ok': False, 'payment_id': None,
                'error': f'no_journal_{journal_type}_para_company_{company_id}'}
    pid = _partner_id_for_idnoofit(o, company_id, cliente_idnoofit)
    if not pid:
        return {'ok': False, 'payment_id': None,
                'error': f'partner_no_encontrado_idnoofit_{cliente_idnoofit}'}

    ref = f'COBRO-MOVE-{move_id}'
    fecha = fecha or dt.date.today().isoformat()
    if hasattr(fecha, 'isoformat'):
        fecha = fecha.isoformat()

    def _ensure_posted(pay_id):
        st = (o._call('account.payment', 'read', [pay_id], ['state']) or [{}])[0].get('state')
        if st != 'posted':
            try:
                o._call('account.payment', 'action_post', [pay_id])
            except Exception as e:
                log.warning(f'action_post falló payment {pay_id}: {e}')
            st = (o._call('account.payment', 'read', [pay_id], ['state']) or [{}])[0].get('state')
        return st

    existing = o._call('account.payment', 'search',
        [('ref', '=', ref), ('company_id', '=', company_id), ('state', '!=', 'cancel')], limit=1)
    if existing:
        pay_id = existing[0]
        st = _ensure_posted(pay_id)
    else:
        try:
            pay_id = o._call('account.payment', 'create', {
                'partner_id':   pid,
                'partner_type': 'customer',
                'payment_type': 'inbound',
                'amount':       float(importe),
                'date':         str(fecha)[:10],
                'journal_id':   jid,
                'company_id':   company_id,
                'ref':          ref,
            })
        except Exception as e:
            log.exception(f'crear_account_payment_move move={move_id}')
            return {'ok': False, 'payment_id': None, 'error': f'create_failed: {e}'}
        st = _ensure_posted(pay_id)

    if st != 'posted':
        return {'ok': False, 'payment_id': pay_id, 'error': 'payment_no_posted'}

    # Reconciliar contra el move (la línea receivable). Si el reconcile no
    # empareja, el residual lo reflejará y devolvemos error para no mentir.
    try:
        _reconcile(o, move_id, pay_id, company_id)
    except Exception as e:
        log.exception(f'reconcile move={move_id} payment={pay_id}')
        return {'ok': False, 'payment_id': pay_id, 'error': f'reconcile_failed: {e}'}

    inv = o._call('account.move', 'read', [move_id], ['amount_residual', 'payment_state'])
    residual = float(inv[0].get('amount_residual', 0)) if inv else None
    pstate = inv[0].get('payment_state') if inv else None
    return {'ok': True, 'payment_id': pay_id, 'residual': residual, 'payment_state': pstate}


def vincular_payment_a_recibo(recibo_id, payment_id, fecha_pago=None,
                              actor_label='odoo_payments'):
    """Persiste `recibo.account_payment_id = payment_id` y opcionalmente
    `recibo.fecha_pago`. Se llama desde el endpoint tras crear el payment."""
    from .db import get_conn
    with get_conn() as conn, conn.cursor() as cur:
        if fecha_pago:
            cur.execute("""
                UPDATE recibo SET account_payment_id=%s, fecha_pago=%s,
                                   updated_by=%s
                 WHERE id=%s
            """, (payment_id, fecha_pago, actor_label, recibo_id))
        else:
            cur.execute("""
                UPDATE recibo SET account_payment_id=%s, updated_by=%s
                 WHERE id=%s
            """, (payment_id, actor_label, recibo_id))
