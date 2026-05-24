"""Endpoints CRUD para canales de captación (mapping UTM → canal con nombre).

Cada manager define sus canales (ej: 'Instagram', 'Google Ads', 'Recom.')
y los patrones de `utm_source` que entran por la web pública del lead.
Al crear un lead, el backend hace match case-insensitive en
`utm_source_match` y asigna canal_id al lead_asignacion.

Endpoints (todos requieren auth + son visibles para Manager / Recepción /
Solo lectura según la matriz `configuracion.canales_captacion.*`).
"""
import logging
from flask import Blueprint, request, jsonify, g
from psycopg.types.json import Json

from ..auth import auth_required, require_permission
from ..db import get_conn
from ..audit_log import log_action, actor_from_request

bp = Blueprint('canales_captacion', __name__)
log = logging.getLogger(__name__)


def _row_to_dict(r):
    return {
        'id': r['id'],
        'nombre': r['nombre'],
        'color': r['color'] or 'cyan',
        'utm_source_match': r['utm_source_match'] or [],
        'notas': r['notas'] or '',
        'activa': bool(r['activa']),
        'orden': r['orden'] or 0,
    }


@bp.route('', methods=['GET'])
@bp.route('/', methods=['GET'])
@auth_required
@require_permission('configuracion.canales_captacion.ver')
def listar():
    """Lista los canales del manager. Default: solo activos. ?incluir_inactivos=1 los muestra todos."""
    incluir_inactivos = (request.args.get('incluir_inactivos') or '').lower() in ('1', 'true', 'yes')
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT id, nombre, color, utm_source_match, notas, activa, orden
              FROM canal_captacion
             WHERE id_manager = %s
               AND (%s OR activa = TRUE)
             ORDER BY COALESCE(orden, 999), nombre
        """, (str(g.id_manager), incluir_inactivos))
        rows = cur.fetchall()
    return jsonify({'ok': True, 'canales': [_row_to_dict(r) for r in rows]})


@bp.route('', methods=['POST'])
@bp.route('/', methods=['POST'])
@auth_required
@require_permission('configuracion.canales_captacion.editar')
def crear():
    d = request.get_json() or {}
    nombre = (d.get('nombre') or '').strip()
    if not nombre:
        return jsonify({'ok': False, 'error': 'nombre_requerido'}), 400
    color = (d.get('color') or 'cyan').strip()
    utm_match = d.get('utm_source_match') or []
    if not isinstance(utm_match, list):
        utm_match = [str(utm_match)]
    utm_match = [str(x).strip().lower() for x in utm_match if str(x).strip()]
    notas = (d.get('notas') or '').strip() or None
    orden = int(d.get('orden') or 0)
    with get_conn() as conn, conn.cursor() as cur:
        try:
            cur.execute("""
                INSERT INTO canal_captacion
                  (id_manager, nombre, color, utm_source_match, notas, orden, activa)
                VALUES (%s,%s,%s,%s,%s,%s, TRUE)
                RETURNING id, nombre, color, utm_source_match, notas, activa, orden
            """, (str(g.id_manager), nombre, color, utm_match, notas, orden))
            row = cur.fetchone()
        except Exception as e:
            log.warning(f'crear canal_captacion: {e}')
            return jsonify({'ok': False, 'error': 'conflicto_o_invalido'}), 400
    log_action(actor_from_request(), entidad='canal_captacion',
               entidad_id=row['id'], accion='crear',
               resumen=f'canal {nombre}')
    return jsonify({'ok': True, 'canal': _row_to_dict(row)})


@bp.route('/<int:canal_id>', methods=['PATCH'])
@auth_required
@require_permission('configuracion.canales_captacion.editar')
def actualizar(canal_id):
    d = request.get_json() or {}
    sets, params = [], []
    if 'nombre' in d:
        sets.append('nombre = %s'); params.append((d['nombre'] or '').strip())
    if 'color' in d:
        sets.append('color = %s'); params.append((d['color'] or 'cyan').strip())
    if 'utm_source_match' in d:
        v = d['utm_source_match'] or []
        if not isinstance(v, list): v = [str(v)]
        v = [str(x).strip().lower() for x in v if str(x).strip()]
        sets.append('utm_source_match = %s'); params.append(v)
    if 'notas' in d:
        sets.append('notas = %s'); params.append((d['notas'] or '').strip() or None)
    if 'orden' in d:
        sets.append('orden = %s'); params.append(int(d['orden'] or 0))
    if 'activa' in d:
        sets.append('activa = %s'); params.append(bool(d['activa']))
    if not sets:
        return jsonify({'ok': False, 'error': 'sin_cambios'}), 400
    sets.append('updated_at = NOW()')
    params.extend([canal_id, str(g.id_manager)])
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"""
            UPDATE canal_captacion SET {', '.join(sets)}
             WHERE id = %s AND id_manager = %s
            RETURNING id, nombre, color, utm_source_match, notas, activa, orden
        """, params)
        row = cur.fetchone()
    if not row:
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    log_action(actor_from_request(), entidad='canal_captacion',
               entidad_id=canal_id, accion='editar',
               resumen=f'canal {row["nombre"]}')
    return jsonify({'ok': True, 'canal': _row_to_dict(row)})


@bp.route('/<int:canal_id>', methods=['DELETE'])
@auth_required
@require_permission('configuracion.canales_captacion.editar')
def borrar(canal_id):
    """Soft delete: marca activa=false. Los leads existentes conservan su
    canal_id (FK ON DELETE SET NULL solo si se borra duro).
    Hard delete con ?hard=1."""
    hard = (request.args.get('hard') or '').lower() in ('1', 'true', 'yes')
    with get_conn() as conn, conn.cursor() as cur:
        if hard:
            cur.execute("DELETE FROM canal_captacion WHERE id=%s AND id_manager=%s",
                        (canal_id, str(g.id_manager)))
        else:
            cur.execute("""
                UPDATE canal_captacion SET activa = FALSE, updated_at = NOW()
                 WHERE id = %s AND id_manager = %s
            """, (canal_id, str(g.id_manager)))
        if cur.rowcount == 0:
            return jsonify({'ok': False, 'error': 'not_found'}), 404
    log_action(actor_from_request(), entidad='canal_captacion',
               entidad_id=canal_id, accion='borrar_hard' if hard else 'desactivar',
               resumen='')
    return jsonify({'ok': True})


def resolver_canal_id(id_manager: str, utm_source: str) -> int | None:
    """Helper para `crm.py` lead-prueba: dado un utm_source entrante,
    busca el primer canal activo del manager cuya lista
    `utm_source_match` contenga el utm_source (case-insensitive).

    Devuelve canal_id o None si no hay match.
    """
    if not utm_source:
        return None
    needle = str(utm_source).strip().lower()
    if not needle:
        return None
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT id FROM canal_captacion
                 WHERE id_manager = %s
                   AND activa = TRUE
                   AND %s = ANY(utm_source_match)
                 ORDER BY COALESCE(orden, 999), id
                 LIMIT 1
            """, (str(id_manager), needle))
            r = cur.fetchone()
        return r['id'] if r else None
    except Exception as e:
        log.warning(f'resolver_canal_id falló: {e}')
        return None
