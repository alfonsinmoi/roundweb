"""Lógica principal del poller.

Cada ejecución:
  1. Lee el cursor de última ejecución (timestamp)
  2. Busca en Odoo facturas/recibos cuyo write_date sea posterior al cursor
  3. Determina el evento (cobrado_sepa, cobrado_tarjeta, devolucion_sepa, impagado)
  4. Para cada evento: notifica a NoofitPro + envía push HTML al cliente
  5. Persiste log en round.log.webhook con direccion='salida'
  6. Actualiza el cursor

Si una notificación falla (red, etc.), queda en 'error' en round.log.webhook
y la siguiente ejecución no la reintentará (ya pasó el cursor); para reintentar
hay que cambiar el estado del log a 'pendiente' manualmente y bajar el cursor.
"""
import os
import json
import logging
from datetime import datetime, timedelta
from pathlib import Path

# Importes relativos al paquete mcp_round
from app.odoo_client import get_client
from app import config as app_config
from . import config as poller_config
from .noofit_client import get_noofit_client
from .templates import render

log = logging.getLogger(__name__)


def _read_cursor():
    p = Path(poller_config.CURSOR_FILE)
    if not p.exists():
        # Primer arranque: 1 hora atrás (no procesa todo el histórico)
        return (datetime.utcnow() - timedelta(hours=1)).strftime('%Y-%m-%d %H:%M:%S')
    return p.read_text().strip()


def _write_cursor(ts):
    p = Path(poller_config.CURSOR_FILE)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(ts)


def _build_push_vars(odoo, partner_id, move):
    """Construye las variables comunes de las plantillas push."""
    p = odoo.call('res.partner', 'read', [partner_id],
                  ['name', 'phone', 'trainer_analytic_id'])[0]
    centro = '—'
    if p.get('trainer_analytic_id'):
        centro = p['trainer_analytic_id'][1]
    company = odoo.call('res.company', 'read', [app_config.DEFAULT_COMPANY_ID],
                        ['name', 'phone'])[0]
    invoice_date = move.get('invoice_date') or ''
    mes = invoice_date[:7] if invoice_date else '—'
    return {
        'nombre':          (p['name'] or '').split(' ')[0] or 'cliente',
        'centro':          centro or company.get('name', ''),
        'centro_telefono': company.get('phone', ''),
        'importe':         f"{move.get('amount_total', 0):.2f}",
        'mes':             mes,
        'fecha_cargo':     invoice_date,
    }


def _detect_evento(move):
    """Devuelve el código de evento según el estado del recibo, o None."""
    state         = move.get('state')
    payment_state = move.get('payment_state')
    move_type     = move.get('move_type')

    if move_type != 'out_invoice':
        return None
    if state != 'posted':
        return None

    # Cobrado
    if payment_state == 'paid':
        # Detectar canal: si el journal del payment es bancario → SEPA, si pasarela → tarjeta
        # Para POC asumimos SEPA por defecto (banco Santander). El detalle real lo afinamos
        # cuando exista el journal de tarjeta.
        return 'recibo.cobrado_sepa'

    # Vencido sin cobrar (lo consideramos impagado tras N días)
    invoice_date_due = move.get('invoice_date_due')
    if payment_state in ('not_paid', 'partial') and invoice_date_due:
        try:
            due = datetime.strptime(invoice_date_due, '%Y-%m-%d').date()
            if (datetime.utcnow().date() - due).days >= poller_config.IMPAGO_DIAS:
                return 'recibo.impagado'
        except Exception:
            pass

    # NOTE: 'recibo.devolucion_sepa' lo detectaríamos cuando el extracto bancario
    #       importe una transacción R con código (AC04, MD01, …). Eso depende de
    #       que el flujo de conciliación esté montado. Lo dejamos para sesión 5.
    return None


def _log_salida(odoo, partner_id, invoice_id, evento, payload, response, estado, error=None):
    """Persiste el evento de salida en round.log.webhook."""
    try:
        odoo.call('round.log.webhook', 'create', {
            'direccion': 'salida',
            'evento': evento,
            'partner_id': partner_id or False,
            'invoice_id': invoice_id or False,
            'payload': json.dumps(payload, default=str),
            'response': json.dumps(response, default=str) if response else False,
            'estado': estado,
            'error_msg': error,
            'procesado_at': datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
                           if estado != 'pendiente' else False,
        })
    except Exception as e:
        log.error(f"No se pudo persistir log salida: {e}")


def run(force=False):
    """Ejecuta una pasada del poller.

    Si force=True, ignora el cursor y procesa todos los recibos posted.
    """
    odoo = get_client()
    noofit = get_noofit_client()

    cursor = _read_cursor() if not force else '1970-01-01 00:00:00'
    log.info(f"Poller arrancando. Cursor anterior: {cursor}")

    # Buscar facturas modificadas tras el cursor
    domain = [
        ('move_type', '=', 'out_invoice'),
        ('state', '=', 'posted'),
        ('write_date', '>', cursor),
        ('round_subscription_id', '!=', False),
    ]
    move_ids = odoo.call('account.move', 'search', domain, order='write_date asc', limit=200)
    log.info(f"Recibos modificados: {len(move_ids)}")

    if not move_ids:
        # Sin cambios; movemos cursor al ahora para no quedarnos atrás
        _write_cursor(datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S'))
        return {'procesados': 0}

    moves = odoo.call('account.move', 'read', move_ids,
                      ['id', 'name', 'state', 'payment_state', 'partner_id',
                       'invoice_date', 'invoice_date_due', 'amount_total',
                       'move_type', 'write_date', 'round_subscription_id'])

    procesados = 0
    last_write = cursor
    for m in moves:
        evento = _detect_evento(m)
        if not evento:
            last_write = m['write_date']
            continue

        partner_id = m['partner_id'][0]
        partner = odoo.call('res.partner', 'read', [partner_id], ['id_noofit'])[0]
        id_noofit = partner.get('id_noofit')

        if not id_noofit:
            log.warning(f"Recibo {m['name']} sin id_noofit en partner {partner_id}, skip")
            last_write = m['write_date']
            continue

        # Construir vars y plantilla
        vars_ = _build_push_vars(odoo, partner_id, m)
        if evento == 'recibo.devolucion_sepa':
            vars_['codigo_devolucion'] = 'AC04'  # placeholder
        asunto, cuerpo = render(evento, vars_)

        # 1) Llamar a NoofitPro para registrar estado
        estado_n = {
            'recibo.cobrado_sepa':     'cobrado',
            'recibo.cobrado_tarjeta':  'cobrado',
            'recibo.devolucion_sepa':  'devuelto',
            'recibo.impagado':         'impagado',
        }.get(evento, evento)
        api_resp = noofit.registrar_estado(
            id_noofit=id_noofit,
            estado=estado_n,
            recibo_periodo=(m.get('invoice_date') or '')[:7],
            importe=m.get('amount_total', 0),
            fecha=m.get('invoice_date'),
            mensaje=asunto,
        )

        # 2) Push HTML
        push_resp = {}
        if asunto and cuerpo:
            push_resp = noofit.push(id_noofit, asunto, cuerpo)

        ok = api_resp.get('ok') and push_resp.get('ok', True)
        _log_salida(
            odoo, partner_id, m['id'], evento,
            payload={'evento': evento, 'partner_id': partner_id, 'recibo': m['name']},
            response={'noofit': api_resp, 'push': push_resp},
            estado='procesado' if ok else 'error',
            error=None if ok else (api_resp.get('error') or push_resp.get('error')),
        )

        log.info(f"  {m['name']} → {evento} → {estado_n} (id_noofit={id_noofit})")
        procesados += 1
        last_write = m['write_date']

    _write_cursor(last_write or cursor)
    log.info(f"Poller terminado. Procesados: {procesados}. Cursor avanzado a: {last_write}")
    return {'procesados': procesados, 'cursor': last_write}
