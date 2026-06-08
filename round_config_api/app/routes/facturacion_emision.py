"""Emisión de facturas Round (operativa de los 2 sistemas).

- GET  /api/facturacion/relacion/<periodo>  → relación seleccionable del mes:
        cobros del mes (con forma de cobro), recobros, y devoluciones de meses
        anteriores llegadas este mes. (lectura)
- POST /api/facturacion/emitir-mes/<periodo> → factura lo seleccionado (sistema
        fin_de_mes). Llama al motor (GATED por facturacion_config.activo).

Manager-only (require_permission). Scope por g.id_manager. log_action en mutación.
NO toca el flujo actual (preemision_v2/facturacion_trimestre).
"""
import logging
from flask import Blueprint, request, jsonify, g
from ..auth import auth_required, require_permission, require_manager
from ..db import get_conn
from ..audit_log import log_action, actor_from_request
from .. import facturacion_engine as ENG

bp = Blueprint('facturacion_emision', __name__)
log = logging.getLogger(__name__)


def _fecha_corte(cur, id_manager):
    cur.execute("SELECT fecha_corte FROM facturacion_config WHERE id_manager=%s ORDER BY id LIMIT 1",
                (str(id_manager),))
    r = cur.fetchone()
    return (r.get('fecha_corte') if r else None)


def _relacion(id_manager, periodo):
    """Construye la relación del mes (read-only) desde `recibo`. Solo
    considera actuaciones a partir de la fecha de corte (no toca lo viejo)."""
    m = str(id_manager)
    with get_conn() as conn, conn.cursor() as cur:
        corte = _fecha_corte(cur, m)
        # 1) Cobros del mes: recibos pagados con fecha_pago en el periodo (>= corte)
        cur.execute("""
            SELECT id, cliente_idnoofit, cliente_nombre, id_trainer, cuota_codigo,
                   importe_base, importe_total, periodo, metodo_pago, estado,
                   fecha_pago::date AS fecha, account_move_id,
                   'cobro' AS tipo
              FROM recibo
             WHERE id_manager=%s AND estado='pagado' AND fecha_pago IS NOT NULL
               AND to_char(fecha_pago,'YYYY-MM')=%s
               AND (%s::date IS NULL OR fecha_pago::date >= %s::date)
        """, (m, periodo, corte, corte))
        cobros = cur.fetchall()
        # 2) Devoluciones de meses ANTERIORES llegadas este mes (>= corte)
        cur.execute("""
            SELECT id, cliente_idnoofit, cliente_nombre, id_trainer, cuota_codigo,
                   importe_base, importe_total, periodo, metodo_pago, estado,
                   fecha_devolucion::date AS fecha, account_move_id,
                   'devolucion' AS tipo
              FROM recibo
             WHERE id_manager=%s AND estado='devuelto' AND fecha_devolucion IS NOT NULL
               AND to_char(fecha_devolucion,'YYYY-MM')=%s AND periodo < %s
               AND (%s::date IS NULL OR fecha_devolucion::date >= %s::date)
        """, (m, periodo, periodo, corte, corte))
        devoluciones = cur.fetchall()
        # 3) Recobros del mes (movimiento_financiero tipo recobro)
        cur.execute("""
            SELECT mf.recibo_id, mf.id_trainer, mf.importe, mf.fecha,
                   r.cliente_idnoofit, r.cliente_nombre, r.cuota_codigo, r.periodo,
                   r.account_move_id
              FROM movimiento_financiero mf
              LEFT JOIN recibo r ON r.id = mf.recibo_id
             WHERE mf.id_manager=%s AND mf.tipo='recobro'
               AND to_char(mf.fecha,'YYYY-MM')=%s
        """, (m, periodo))
        recobros = cur.fetchall()
    return {'cobros': cobros, 'devoluciones': devoluciones, 'recobros': recobros}


@bp.route('/relacion/<periodo>', methods=['GET'])
@auth_required
@require_manager
@require_permission('configuracion.modo_facturacion.ver')
def relacion(periodo):
    if not (len(periodo) == 7 and periodo[4] == '-'):
        return jsonify({'ok': False, 'error': 'periodo_invalido (YYYY-MM)'}), 400
    rel = _relacion(g.id_manager, periodo)
    cfg = ENG.config_activa(g.id_manager)
    return jsonify({
        'ok': True, 'periodo': periodo,
        'sistema': (cfg.get('sistema') if cfg else None),
        'activo': bool(cfg.get('activo')) if cfg else False,
        **rel,
        'totales': {
            'cobros': len(rel['cobros']),
            'devoluciones': len(rel['devoluciones']),
            'recobros': len(rel['recobros']),
        },
    })


@bp.route('/eficacia-recobro', methods=['GET'])
@auth_required
@require_manager
@require_permission('configuracion.modo_facturacion.ver')
def eficacia_recobro():
    """Σ recobrado / Σ devuelto por mes (rango ?desde=YYYY-MM&hasta=YYYY-MM,
    por defecto el año en curso de los datos). Desde movimiento_financiero."""
    desde = (request.args.get('desde') or '').strip() or None
    hasta = (request.args.get('hasta') or '').strip() or None
    m = str(g.id_manager)
    where = ["id_manager=%s", "tipo IN ('devolucion','recobro')", "fecha IS NOT NULL"]
    vals = [m]
    if desde:
        where.append("to_char(fecha,'YYYY-MM') >= %s"); vals.append(desde)
    if hasta:
        where.append("to_char(fecha,'YYYY-MM') <= %s"); vals.append(hasta)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"""
            SELECT to_char(fecha,'YYYY-MM') AS mes,
                   SUM(importe) FILTER (WHERE tipo='devolucion') AS devuelto,
                   SUM(importe) FILTER (WHERE tipo='recobro')    AS recobrado
              FROM movimiento_financiero
             WHERE {' AND '.join(where)}
             GROUP BY 1 ORDER BY 1
        """, vals)
        filas = cur.fetchall()
    out = []
    for f in filas:
        dev = float(f['devuelto'] or 0); rec = float(f['recobrado'] or 0)
        out.append({'mes': f['mes'], 'devuelto': round(dev, 2), 'recobrado': round(rec, 2),
                    'eficacia_pct': round(100 * rec / dev, 1) if dev > 0 else None})
    return jsonify({'ok': True, 'meses': out})


@bp.route('/emitir-mes/<periodo>', methods=['POST'])
@auth_required
@require_manager
@require_permission('configuracion.modo_facturacion.editar')
def emitir_mes(periodo):
    """Body: {recibo_ids:[...], postear:bool=false}. Factura por cliente los
    recibos seleccionados (sistema fin_de_mes). Draft-first por defecto."""
    d = request.get_json() or {}
    recibo_ids = d.get('recibo_ids') or []
    postear = bool(d.get('postear'))
    if not recibo_ids:
        return jsonify({'ok': False, 'error': 'recibo_ids_required'}), 400
    m = str(g.id_manager)

    # Cargar recibos seleccionados (scope manager) + IVA por cuota.
    # Blindaje corte: solo recibos pagados a partir de la fecha de corte
    # (nunca re-facturar lo anterior al arranque del sistema mensual).
    with get_conn() as conn, conn.cursor() as cur:
        corte = _fecha_corte(cur, m)
        cur.execute("""
            SELECT id, cliente_idnoofit, id_trainer, cuota_codigo,
                   importe_base, periodo, account_payment_id
              FROM recibo
             WHERE id_manager=%s AND id = ANY(%s)
               AND (%s::date IS NULL OR (fecha_pago IS NOT NULL AND fecha_pago::date >= %s::date))
        """, (m, recibo_ids, corte, corte))
        recibos = cur.fetchall()
    if not recibos:
        return jsonify({'ok': False, 'error': 'recibos_no_encontrados_o_anteriores_al_corte'}), 404

    # Agrupar por (cliente, trainer) → items para el motor
    items = {}
    for r in recibos:
        key = (r['cliente_idnoofit'], r['id_trainer'])
        iva = ENG._iva_pct_de_cuota(m, r['cuota_codigo'], r['id_trainer'])
        it = items.setdefault(key, {
            'cliente_idnoofit': r['cliente_idnoofit'],
            'id_trainer': r['id_trainer'],
            'lineas': [],
            'payment_ids': [],
            'recibo_ids': [],
        })
        it['lineas'].append({
            'concepto': f'{r["cuota_codigo"] or "Cuota"} · {r["periodo"]}',
            'base': float(r['importe_base'] or 0),
            'iva_pct': iva,
        })
        if r.get('account_payment_id'):
            it['payment_ids'].append(r['account_payment_id'])
        it['recibo_ids'].append(r['id'])

    res = ENG.facturar_mes(m, periodo, list(items.values()), postear=postear)
    log_action(actor_from_request(), entidad='facturacion_emision', entidad_id=periodo,
               accion='emitir_mes',
               resumen=f'Emitir mes {periodo}: {len(recibo_ids)} recibos, postear={postear}',
               cambios={'recibo_ids': recibo_ids[:200]})
    return jsonify({'ok': True, 'periodo': periodo, **res})
