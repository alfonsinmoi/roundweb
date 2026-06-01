"""Bandeja de incidencias internas del admin (junio 2026).

Endpoints:
  GET    /api/incidencias                 → listado (filtros: solo_pendientes, tipo)
  POST   /api/incidencias/<id>/marcar-leida
  GET    /api/incidencias/count           → contador para badge en sidebar
"""
import logging
from flask import Blueprint, request, jsonify, g
from ..auth import auth_required, require_permission, resolve_trainer_target
from ..db import get_conn
from ..audit_log import log_action, actor_from_request

bp = Blueprint('incidencias', __name__)
log = logging.getLogger(__name__)


def _row(r):
    if not r: return None
    o = dict(r)
    for k in ('leida_at', 'created_at'):
        if o.get(k) and hasattr(o[k], 'isoformat'):
            o[k] = o[k].isoformat()
    return o


@bp.route('/incidencias', methods=['GET'])
@auth_required
@require_permission('incidencias.ver')
def listar_incidencias():
    qs = request.args
    where = ['id_manager=%s']
    vals = [str(g.id_manager)]
    id_trainer, forbidden = resolve_trainer_target(qs.get('id_trainer'))
    if forbidden:
        return jsonify({'ok': False, 'error': 'forbidden_trainer'}), 403
    if id_trainer:
        where.append('(id_trainer = %s OR id_trainer IS NULL)')
        vals.append(str(id_trainer))
    if qs.get('solo_pendientes') == '1':
        where.append('leida_at IS NULL')
    if qs.get('tipo'):
        where.append('tipo = %s'); vals.append(qs['tipo'])
    if qs.get('severidad'):
        where.append('severidad = %s'); vals.append(qs['severidad'])
    try:
        limit = min(int(qs.get('limit') or 100), 500)
    except (TypeError, ValueError):
        limit = 100
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"""
            SELECT * FROM incidencia_admin
             WHERE {' AND '.join(where)}
             ORDER BY (leida_at IS NULL) DESC, created_at DESC
             LIMIT %s
        """, vals + [limit])
        rows = [_row(r) for r in cur.fetchall()]
    return jsonify({'ok': True, 'incidencias': rows})


@bp.route('/incidencias/count', methods=['GET'])
@auth_required
@require_permission('incidencias.ver')
def count_incidencias():
    """Devuelve {pendientes: N} para badge en sidebar.

    Sprint 7 M2 — scope correcto: si el usuario está atado a un trainer,
    cuenta sus incidencias + las globales del manager (id_trainer NULL).
    Antes contaba TODAS las del manager → leak cardinal entre centros.
    """
    qs = request.args
    id_trainer, forbidden = resolve_trainer_target(qs.get('id_trainer'))
    if forbidden:
        return jsonify({'ok': False, 'error': 'forbidden_trainer'}), 403
    where = ['id_manager=%s', 'leida_at IS NULL']
    vals = [str(g.id_manager)]
    if id_trainer:
        where.append('(id_trainer=%s OR id_trainer IS NULL)')
        vals.append(str(id_trainer))
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"""SELECT COUNT(*) AS n FROM incidencia_admin
                         WHERE {' AND '.join(where)}""", vals)
        n = cur.fetchone()['n']
    return jsonify({'ok': True, 'pendientes': n})


@bp.route('/incidencias/<int:iid>/marcar-leida', methods=['POST'])
@auth_required
@require_permission('incidencias.ver')
def marcar_leida(iid):
    actor = actor_from_request()
    label = actor.get('label') or actor.get('email') or 'admin'
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""UPDATE incidencia_admin
                          SET leida_at=NOW(), leida_por=%s
                        WHERE id=%s AND id_manager=%s
                       RETURNING id""", (label, iid, str(g.id_manager)))
        if not cur.fetchone():
            return jsonify({'ok': False, 'error': 'not_found'}), 404
    log_action(actor, entidad='incidencia_admin', entidad_id=iid,
               accion='marcar_leida')
    return jsonify({'ok': True})
