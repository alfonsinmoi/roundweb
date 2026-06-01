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
    """Resuelve partner Odoo por id_noofit. Prioriza el de la company; si no
    hay, busca cross-company (caso multi-empresa)."""
    partner_ids = o._call('res.partner', 'search',
                          [('id_noofit', '=', str(idnoofit)),
                           ('company_id', '=', company_id)], limit=1)
    if partner_ids:
        return partner_ids[0]
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
            'ref':          f'COBRO-RECIBO-{recibo_id}',
        })
    except Exception as e:
        log.exception(f'crear_account_payment recibo={recibo_id}')
        return {'ok': False, 'payment_id': None, 'journal_id': jid,
                'error': f'create_failed: {e}'}

    # Postear (cambiar a state=posted). Si falla, dejar el payment en draft
    # y reportar (el operador puede postearlo manualmente).
    try:
        o._call('account.payment', 'action_post', [payment_id])
    except Exception as e:
        log.warning(f'action_post falló para payment {payment_id}: {e}')

    return {'ok': True, 'payment_id': payment_id, 'journal_id': jid,
            'error': None}


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
