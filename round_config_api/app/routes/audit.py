"""Endpoint para consultar el accion_log.

GET /api/config/audit                       - lista global del manager
  ?entidad=cliente|nota|usuario_web|...
  ?entidad_id=<id>
  ?actor=<id>
  ?accion=<keyword>
  ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
  ?limit=100&offset=0
"""
import logging
from flask import Blueprint, request, jsonify, g

from ..auth import auth_required
from ..db import get_conn

bp = Blueprint('audit', __name__)
log = logging.getLogger(__name__)


@bp.route('', methods=['GET'])
@bp.route('/', methods=['GET'])
@auth_required
def list_audit():
    where = ['id_manager = %s']; vals = [str(g.id_manager)]
    qs = request.args
    if qs.get('entidad'):
        where.append('entidad = %s'); vals.append(qs['entidad'])
    if qs.get('entidad_id'):
        where.append('entidad_id = %s'); vals.append(qs['entidad_id'])
    if qs.get('actor'):
        where.append('(actor_id = %s OR actor_email = %s)')
        vals.extend([qs['actor'], qs['actor']])
    if qs.get('accion'):
        where.append('accion = %s'); vals.append(qs['accion'])
    if qs.get('desde'):
        where.append('ts >= %s'); vals.append(qs['desde'])
    if qs.get('hasta'):
        where.append('ts <= %s'); vals.append(qs['hasta'])

    try:
        limit = min(int(qs.get('limit', '100')), 500)
        offset = int(qs.get('offset', '0'))
    except ValueError:
        return jsonify({'ok': False, 'error': 'limit/offset_invalid'}), 400

    sql = f"""
        SELECT id, ts, id_trainer, actor_kind, actor_id, actor_email, actor_label,
               entidad, entidad_id, accion, resumen, cambios, ip
          FROM accion_log
         WHERE {' AND '.join(where)}
         ORDER BY ts DESC
         LIMIT %s OFFSET %s
    """
    vals.extend([limit, offset])
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(sql, vals)
        rows = cur.fetchall()
        cur.execute(f"SELECT COUNT(*) AS n FROM accion_log WHERE {' AND '.join(where[:-2] if len(where) > 1 else where)}",
                    [str(g.id_manager)] + vals[1:-2] if len(vals) > 3 else [str(g.id_manager)])
        # NOTE: el count completo es complejo con los filtros — cliente paginará bien con limit/offset; total opcional
    return jsonify({'ok': True, 'audit': rows, 'count': len(rows)})
