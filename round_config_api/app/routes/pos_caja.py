"""POS — cuadre diario de caja (Fase 8, mayo 2026).

Resumen del día: agrega pos_venta del día actual del trainer activo agrupando
por método de pago. El operador cuenta el efectivo físico y registra el cierre
con `importe_contado_efectivo`. El sistema calcula la diferencia.

Reglas:
  * 1 cierre por (id_manager, id_trainer, fecha) — UNIQUE constraint en BD.
  * Reabrir un cierre existente NO está soportado en v1; admin puede borrarlo
    vía SQL si fuera necesario (raro).
  * Diferencia | > 5€ requiere notas explicando el motivo.
  * Solo se computa el efectivo en `diferencia` — los métodos electrónicos
    (tarjeta, bizum, transferencia) cuadran por banco, no por caja física.

Endpoints:
  GET    /api/pos/caja/resumen?fecha=YYYY-MM-DD&id_trainer=X
         → totales del día por método + nº ventas + anuladas
  POST   /api/pos/caja/cerrar
         body: {fecha, id_trainer?, importe_contado_efectivo, notas?, fondo_caja?}
  GET    /api/pos/caja/cierres?desde=&hasta=&id_trainer=
         → listado histórico
  GET    /api/pos/caja/cierre/<id>
         → detalle de un cierre concreto
"""
import logging
import datetime as dt
from decimal import Decimal
from flask import Blueprint, request, jsonify, g

from ..auth import auth_required, require_permission, resolve_trainer_target
from ..db import get_conn
from ..audit_log import log_action, actor_from_request

bp = Blueprint('pos_caja', __name__)
log = logging.getLogger(__name__)


METODOS_AGREGADOS = (
    'efectivo', 'tarjeta', 'bizum',
    'transferencia', 'link_pago', 'recibo_mensual',
)
DIFF_TOLERADA_SIN_NOTAS = Decimal('5.00')


def _row_json(r):
    """JSON-safe."""
    if not r: return None
    o = dict(r)
    for k in ('fecha', 'created_at', 'updated_at'):
        if o.get(k) and hasattr(o[k], 'isoformat'):
            o[k] = o[k].isoformat()
    for k, v in list(o.items()):
        if isinstance(v, Decimal):
            o[k] = float(v)
    return o


def _resumen_dia(cur, id_manager, id_trainer, fecha):
    """Calcula los totales del día desde pos_venta. Retorna dict con
    totales por método + num_ventas + num_anuladas + total_anulado.

    Las ventas anuladas NO entran en los totales por método (porque
    revierten stock + crean refund en Odoo). Cuentan en num_anuladas
    y total_anulado para auditoría.
    """
    where_base = ("id_manager=%s AND id_trainer=%s "
                  "AND fecha >= %s::date AND fecha < (%s::date + 1)")
    vals_base = (str(id_manager), str(id_trainer), fecha, fecha)
    # Totales por método (solo completadas)
    cur.execute(f"""
        SELECT metodo_pago, COALESCE(SUM(total), 0) AS suma, COUNT(*) AS n
          FROM pos_venta
         WHERE {where_base} AND estado='completada'
         GROUP BY metodo_pago
    """, vals_base)
    por_metodo = {row['metodo_pago']: (float(row['suma']), row['n'])
                  for row in cur.fetchall()}
    out = {}
    total_dia = 0.0
    num_ventas = 0
    for m in METODOS_AGREGADOS:
        suma, n = por_metodo.get(m, (0.0, 0))
        out[f'total_{m}'] = suma
        total_dia += suma
        num_ventas += n
    out['total_dia'] = total_dia
    out['num_ventas'] = num_ventas
    # Anuladas (informativo)
    cur.execute(f"""
        SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS suma
          FROM pos_venta
         WHERE {where_base} AND estado='anulada'
    """, vals_base)
    a = cur.fetchone()
    out['num_anuladas'] = a['n']
    out['total_anulado'] = float(a['suma'])
    return out


@bp.route('/caja/resumen', methods=['GET'])
@auth_required
@require_permission('tpv.caja.ver')
def caja_resumen():
    """Resumen del día calculado en vivo desde pos_venta. Si ya existe
    cierre para esa fecha, lo incluye en la respuesta (cierre_existente).
    """
    qs = request.args
    # Sprint 4 #H2 — validar fecha
    try:
        fecha = dt.date.fromisoformat(
            qs.get('fecha') or dt.date.today().isoformat()).isoformat()
    except (TypeError, ValueError):
        return jsonify({'ok': False, 'error': 'fecha_invalida'}), 400
    # Sprint 4 #C3 — anti cross-trainer
    id_trainer, forbidden = resolve_trainer_target(qs.get('id_trainer'))
    if forbidden:
        return jsonify({'ok': False, 'error': 'forbidden_trainer'}), 403
    if not id_trainer:
        return jsonify({'ok': False, 'error': 'id_trainer_required'}), 400
    with get_conn() as conn, conn.cursor() as cur:
        resumen = _resumen_dia(cur, g.id_manager, id_trainer, fecha)
        cur.execute("""SELECT * FROM pos_cierre_caja
                        WHERE id_manager=%s AND id_trainer=%s AND fecha=%s""",
                    (str(g.id_manager), str(id_trainer), fecha))
        cierre = cur.fetchone()
    return jsonify({'ok': True, 'fecha': fecha, 'id_trainer': id_trainer,
                    'resumen': resumen,
                    'cierre_existente': _row_json(cierre)})


@bp.route('/caja/cerrar', methods=['POST'])
@auth_required
@require_permission('tpv.caja.cerrar')
def caja_cerrar():
    """Body:
      {
        fecha: 'YYYY-MM-DD' (opcional, default hoy),
        id_trainer: 'X' (opcional si impersona),
        importe_contado_efectivo: 245.50,
        fondo_caja: 0,  (opcional)
        notas: '...' (obligatorio si |diferencia| > 5€)
      }
    """
    import psycopg.errors as pgerr
    d = request.get_json() or {}
    # Sprint 4 #H2 — validar fecha estrictamente
    try:
        fecha_d = dt.date.fromisoformat(
            d.get('fecha') or dt.date.today().isoformat())
    except (TypeError, ValueError):
        return jsonify({'ok': False, 'error': 'fecha_invalida'}), 400
    if fecha_d > dt.date.today():
        return jsonify({'ok': False, 'error': 'fecha_futura',
                        'detalle': 'No se puede cerrar caja de una fecha futura.'}), 400
    fecha = fecha_d.isoformat()
    # Sprint 4 #C3 — anti cross-trainer
    id_trainer, forbidden = resolve_trainer_target(d.get('id_trainer'))
    if forbidden:
        return jsonify({'ok': False, 'error': 'forbidden_trainer'}), 403
    if not id_trainer:
        return jsonify({'ok': False, 'error': 'id_trainer_required'}), 400
    try:
        contado = Decimal(str(d.get('importe_contado_efectivo') or 0))
        fondo = Decimal(str(d.get('fondo_caja') or 0))
    except Exception:
        return jsonify({'ok': False, 'error': 'importe_invalido'}), 400
    if contado < 0 or fondo < 0:
        return jsonify({'ok': False, 'error': 'importe_negativo'}), 400
    notas = (d.get('notas') or '').strip() or None

    actor = actor_from_request()
    actor_label = actor.get('label') or actor.get('email') or 'tpv'

    with get_conn() as conn, conn.cursor() as cur:
        # Sprint 4 #H1 — advisory lock per-(manager, trainer, fecha) para
        # serializar cierres concurrentes. Se libera al COMMIT/ROLLBACK.
        lock_key = f'pos_caja:{g.id_manager}:{id_trainer}:{fecha}'
        cur.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))",
                    (lock_key,))
        # ¿Ya existe?
        cur.execute("""SELECT id FROM pos_cierre_caja
                        WHERE id_manager=%s AND id_trainer=%s AND fecha=%s""",
                    (str(g.id_manager), str(id_trainer), fecha))
        if cur.fetchone():
            return jsonify({'ok': False, 'error': 'cierre_ya_existe',
                            'detalle': f'Ya hay cierre para {fecha} en este centro. '
                                       'Para reabrirlo contacta con el admin.'}), 409

        r = _resumen_dia(cur, g.id_manager, id_trainer, fecha)
        # Esperado en caja = total efectivo del día + fondo inicial
        esperado = Decimal(str(r['total_efectivo'])) + fondo
        diferencia = contado - esperado

        # Validar notas obligatorias si diferencia significativa
        if abs(diferencia) > DIFF_TOLERADA_SIN_NOTAS and not notas:
            return jsonify({'ok': False, 'error': 'notas_required',
                            'detalle': f'Diferencia {diferencia:.2f}€ excede '
                                       f'{DIFF_TOLERADA_SIN_NOTAS}€ — añade '
                                       'notas explicando el motivo.'}), 400

        # Sprint 4 #H1 — UniqueViolation → 409 explícito (defensa: el lock
        # advisory de arriba ya serializó, pero si el constraint dispara por
        # cualquier motivo, no queremos un 500 sin mensaje útil)
        try:
            cur.execute("""
                INSERT INTO pos_cierre_caja
                  (id_manager, id_trainer, fecha,
                   total_efectivo, total_tarjeta, total_bizum,
                   total_transferencia, total_link_pago, total_recibo_mensual,
                   total_dia, num_ventas, num_anuladas, total_anulado,
                   importe_contado_efectivo, fondo_caja, diferencia,
                   notas, created_by)
                VALUES (%s, %s, %s,
                        %s, %s, %s,
                        %s, %s, %s,
                        %s, %s, %s, %s,
                        %s, %s, %s,
                        %s, %s)
                RETURNING *
            """, (
                str(g.id_manager), str(id_trainer), fecha,
                r['total_efectivo'], r['total_tarjeta'], r['total_bizum'],
                r['total_transferencia'], r['total_link_pago'], r['total_recibo_mensual'],
                r['total_dia'], r['num_ventas'], r['num_anuladas'], r['total_anulado'],
                contado, fondo, diferencia,
                notas, actor_label,
            ))
            row = cur.fetchone()
        except pgerr.UniqueViolation:
            conn.rollback()
            return jsonify({'ok': False, 'error': 'cierre_ya_existe',
                            'detalle': 'Cierre creado en paralelo. '
                                       'Recarga e intenta de nuevo.'}), 409

    log_action(actor, entidad='pos_cierre_caja', entidad_id=row['id'],
               accion='cierre',
               resumen=f'Cierre {fecha} · efectivo {r["total_efectivo"]:.2f}€ · '
                       f'contado {contado:.2f}€ · diferencia {diferencia:.2f}€')
    return jsonify({'ok': True, 'cierre': _row_json(row)}), 201


@bp.route('/caja/cierres', methods=['GET'])
@auth_required
@require_permission('tpv.caja.ver')
def caja_listar_cierres():
    qs = request.args
    id_trainer, forbidden = resolve_trainer_target(qs.get('id_trainer'))
    if forbidden:
        return jsonify({'ok': False, 'error': 'forbidden_trainer'}), 403
    where = ['id_manager=%s']
    vals = [str(g.id_manager)]
    if id_trainer:
        where.append('id_trainer=%s'); vals.append(str(id_trainer))
    # Validar fechas si vienen
    for k in ('desde', 'hasta'):
        if qs.get(k):
            try:
                dt.date.fromisoformat(qs[k])
            except (TypeError, ValueError):
                return jsonify({'ok': False, 'error': f'{k}_invalida'}), 400
    if qs.get('desde'):
        where.append('fecha >= %s'); vals.append(qs['desde'])
    if qs.get('hasta'):
        where.append('fecha <= %s'); vals.append(qs['hasta'])
    try:
        limit = min(int(qs.get('limit') or 100), 500)
    except (TypeError, ValueError):
        limit = 100
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"""
            SELECT * FROM pos_cierre_caja
             WHERE {' AND '.join(where)}
             ORDER BY fecha DESC, id DESC
             LIMIT %s
        """, vals + [limit])
        rows = [_row_json(r) for r in cur.fetchall()]
    return jsonify({'ok': True, 'cierres': rows})


@bp.route('/caja/cierre/<int:cid>', methods=['GET'])
@auth_required
@require_permission('tpv.caja.ver')
def caja_detalle(cid):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT * FROM pos_cierre_caja
                        WHERE id=%s AND id_manager=%s""",
                    (cid, str(g.id_manager)))
        row = cur.fetchone()
    if not row:
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    return jsonify({'ok': True, 'cierre': _row_json(row)})


@bp.route('/caja/cierre/<int:cid>/reabrir', methods=['POST'])
@auth_required
@require_permission('tpv.caja.reabrir')
def caja_reabrir(cid):
    """Sprint 5 #4 — Reapertura de cierre con auditoría.

    Elimina la fila de pos_cierre_caja (libera el constraint UNIQUE
    manager/trainer/fecha → permite re-cerrar) PERO antes registra:
      - reopened_at, reopened_by, reopen_motivo en una fila histórica
      - log_action con el motivo y el actor

    Requiere body {motivo: '...'}. Sin motivo se rechaza.
    """
    d = request.get_json() or {}
    motivo = (d.get('motivo') or '').strip()
    if not motivo:
        return jsonify({'ok': False, 'error': 'motivo_required',
                        'detalle': 'Indica el motivo de la reapertura.'}), 400
    actor = actor_from_request()
    actor_label = actor.get('label') or actor.get('email') or 'admin'
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT * FROM pos_cierre_caja
                        WHERE id=%s AND id_manager=%s FOR UPDATE""",
                    (cid, str(g.id_manager)))
        row = cur.fetchone()
        if not row:
            return jsonify({'ok': False, 'error': 'not_found'}), 404
        # Marcar reopen y borrar — el audit_log + el resumen en
        # log_action preservan trazabilidad histórica.
        cur.execute("""UPDATE pos_cierre_caja
                          SET reopened_at=NOW(), reopened_by=%s,
                              reopen_motivo=%s
                        WHERE id=%s""", (actor_label, motivo, cid))
        cur.execute("DELETE FROM pos_cierre_caja WHERE id=%s", (cid,))
    log_action(actor, entidad='pos_cierre_caja', entidad_id=cid,
               accion='reapertura',
               resumen=(f'Reabierto cierre {row["fecha"]} trainer '
                        f'{row["id_trainer"]} · diff orig '
                        f'{float(row["diferencia"]):.2f}€ · motivo: {motivo}'))
    return jsonify({'ok': True, 'cierre_borrado': cid})
