"""Emisión confirmada — modo α.

Para los recibos generados con preemision-v2, este endpoint:
  - Para los que estado='pagado' y forma_pago=sepa: crea account.payment en
    Odoo (cobro). Idempotente: si ya tiene account_payment_id, salta.
  - Para tarjeta_token: crea account.payment vía la pasarela del trainer
    (PayComet etc.). Por ahora, solo registra el payment Odoo (la integración
    real con la pasarela queda pendiente en otro turno).
  - Para impagados (efectivo, enlace_pago): no se crea payment todavía
    (se cobrarán a lo largo del trimestre).

Endpoints:
  POST /api/cuotas/emitir-v2/<mes>     confirma y crea payments para los pagados
"""
import datetime as dt
import logging
from flask import Blueprint, request, jsonify, g

from ..auth import auth_required, require_permission
from ..db import get_conn
from ..audit_log import log_action, actor_from_request

bp = Blueprint('emision_v2', __name__)
log = logging.getLogger(__name__)


def _odoo():
    from ..odoo_alta import OdooAlta
    o = OdooAlta(); o._connect()
    return o


def _company_id():
    from .. import config as appconfig
    return getattr(appconfig, 'ODOO_COMPANY', 3) or 3


@bp.route('/<mes>', methods=['POST'])
@auth_required
@require_permission('economico.cuotas_mensuales.emitir_mes')
def emitir(mes):
    """Crea account.payment para los recibos pagados (sepa, tarjeta_token)."""
    # ── Guard: NO se puede emitir sin una PRE-EMISIÓN previa del mes ─────────
    # La emisión definitiva (payments/remesa) exige que antes se hayan generado
    # los recibos del mes ("Generar recibos"). Sin recibos cron_emision del mes,
    # se rechaza para evitar emitir un mes vacío o por error.
    _tr_g = str(g.id_trainer) if getattr(g, 'id_trainer', None) else None
    _gq = ("SELECT count(*) AS n FROM recibo WHERE id_manager=%s AND periodo=%s "
           "AND origen='cron_emision'")
    _gv = [str(g.id_manager), mes]
    if _tr_g:
        _gq += " AND id_trainer=%s"; _gv.append(_tr_g)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(_gq, _gv)
        if int((cur.fetchone() or {}).get('n') or 0) == 0:
            return jsonify({'ok': False, 'error': 'sin_preemision',
                            'detalle': f'No hay pre-emisión para {mes}. Genera primero los '
                                       f'recibos del mes ("Generar recibos") antes de emitir.'}), 400

    company_id = _company_id()
    o = _odoo()

    # Buscar journals
    bank_jids = o._call('account.journal', 'search',
        [('company_id', '=', company_id), ('type', '=', 'bank')], limit=1)
    bank_jid = bank_jids[0] if bank_jids else None
    cash_jids = o._call('account.journal', 'search',
        [('company_id', '=', company_id), ('type', '=', 'cash')], limit=1)
    cash_jid = cash_jids[0] if cash_jids else None

    # ── Buscar recibos pagados sin payment (cron_emision + manuales) ────────
    # NOTA: la transición borrador_remesa → pagado/impagado ya la hizo
    # `preemision_v2.generar` (botón "Generar recibos"). Aquí solo recogemos
    # los pagados que aún no tienen account_payment_id.
    # Scope por trainer (auditoría #22): si operas como un trainer concreto,
    # solo se cobran SUS recibos; el manager (sin scope) cobra todos.
    _tr = str(g.id_trainer) if getattr(g, 'id_trainer', None) else None
    _q = ("SELECT id, cliente_idnoofit, cliente_nombre, importe_total, "
          "metodo_pago, fecha_emision FROM recibo "
          "WHERE id_manager=%s AND periodo=%s "
          "AND origen IN ('cron_emision','manual_remesa') "
          "AND estado='pagado' AND account_payment_id IS NULL")
    _v = [str(g.id_manager), mes]
    if _tr:
        _q += " AND id_trainer=%s"
        _v.append(_tr)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(_q, _v)
        recibos_a_pagar = cur.fetchall()

    pagos_creados = 0
    errores = 0

    for r in recibos_a_pagar:
        # Localizar partner Odoo
        try:
            partner_ids = o._call('res.partner', 'search',
                [('id_noofit', '=', str(r['cliente_idnoofit'])),
                 ('company_id', '=', company_id)], limit=1)
            if not partner_ids:
                # Buscar sin filtro de company
                partner_ids = o._call('res.partner', 'search',
                    [('id_noofit', '=', str(r['cliente_idnoofit']))], limit=1)
            if not partner_ids:
                errores += 1
                log.warning(f'recibo {r["id"]}: partner no encontrado en Odoo (idnoofit={r["cliente_idnoofit"]})')
                continue
            pid = partner_ids[0]

            # Journal según método
            jid = bank_jid if r['metodo_pago'] in ('sepa', 'tarjeta_token') else cash_jid
            if not jid:
                errores += 1
                continue

            payment_vals = {
                'partner_id': pid,
                'partner_type': 'customer',
                'payment_type': 'inbound',
                'amount': float(r['importe_total']),
                'date': str(r['fecha_emision']) if r['fecha_emision'] else str(dt.date.today()),
                'journal_id': jid,
                'company_id': company_id,
                'ref': f'COBRO-RECIBO-{r["id"]}',
            }
            pay_id = o._call('account.payment', 'create', payment_vals)
            try:
                o._call('account.payment', 'action_post', [pay_id])
            except Exception as e:
                log.warning(f'No se pudo postear payment {pay_id}: {e}')

            # Vincular en BD
            with get_conn() as conn, conn.cursor() as cur:
                cur.execute("""
                    UPDATE recibo SET account_payment_id=%s, fecha_pago=NOW(),
                                       updated_by=%s
                     WHERE id=%s
                """, (pay_id, 'emision_v2', r['id']))
            pagos_creados += 1
        except Exception as e:
            errores += 1
            log.exception(f'emision_v2 recibo {r["id"]}')

    log_action(actor_from_request(), entidad='recibo_lote', entidad_id=mes,
               accion='emision_v2',
               resumen=f'Emisión {mes}: {pagos_creados} payments creados · {errores} errores')

    # Stats finales del mes
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT estado, COUNT(*) AS n, SUM(importe_total) AS total
              FROM recibo
             WHERE id_manager=%s AND periodo=%s AND origen='cron_emision'
             GROUP BY estado
        """, (str(g.id_manager), mes))
        stats = {r['estado']: {'n': r['n'], 'total': float(r['total'] or 0)} for r in cur.fetchall()}

    return jsonify({
        'ok': True, 'mes': mes,
        'pagos_creados': pagos_creados,
        'errores': errores,
        'stats': stats,
    })
