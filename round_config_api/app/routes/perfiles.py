"""CRUD perfiles. Gestionados por el manager (auth_required clásico) o por
un usuario_web con perfil.is_admin=true.

Devuelve permisos JSONB tal cual: el frontend gobierna la estructura
desde `src/config/permissions.js`.
"""
import logging
from flask import Blueprint, request, jsonify, g

from ..auth import auth_required, require_permission
from ..db import get_conn, seed_perfiles_for_manager
from ..audit_log import log_action, actor_from_request, diff_dict

bp = Blueprint('perfiles', __name__)
log = logging.getLogger(__name__)


@bp.route('', methods=['GET'])
@bp.route('/', methods=['GET'])
@auth_required
def list_perfiles():
    seed_perfiles_for_manager(g.id_manager)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT id, nombre, descripcion, permisos, is_admin, activa,
                   created_at, updated_at,
                   (SELECT COUNT(*) FROM usuario_web WHERE perfil_id = perfil.id) AS usuarios
              FROM perfil
             WHERE id_manager = %s
             ORDER BY is_admin DESC, activa DESC, nombre ASC
        """, (str(g.id_manager),))
        rows = cur.fetchall()
    return jsonify({'ok': True, 'perfiles': rows})


@bp.route('', methods=['POST'])
@bp.route('/', methods=['POST'])
@auth_required
@require_permission('configuracion.perfiles.editar')
def create_perfil():
    d = request.get_json() or {}
    nombre = (d.get('nombre') or '').strip()
    if not nombre:
        return jsonify({'ok': False, 'error': 'nombre_required'}), 400
    permisos = d.get('permisos') or {}
    if not isinstance(permisos, dict):
        return jsonify({'ok': False, 'error': 'permisos_invalid'}), 400
    with get_conn() as conn, conn.cursor() as cur:
        try:
            cur.execute("""
                INSERT INTO perfil (id_manager, nombre, descripcion, permisos, is_admin, activa)
                VALUES (%s, %s, %s, %s::jsonb, %s, %s)
                RETURNING *
            """, (
                str(g.id_manager), nombre, d.get('descripcion'),
                __import__('json').dumps(permisos),
                bool(d.get('is_admin', False)),
                bool(d.get('activa', True)),
            ))
            row = cur.fetchone()
        except Exception as e:
            return jsonify({'ok': False, 'error': str(e)}), 400
    log_action(actor_from_request(), entidad='perfil', entidad_id=row['id'],
               accion='create', resumen=f"Perfil creado: {row['nombre']}",
               cambios={'after': {k: row[k] for k in ('nombre','is_admin','activa') if k in row}})
    return jsonify({'ok': True, 'perfil': row})


@bp.route('/<int:pid>', methods=['PATCH', 'PUT'])
@auth_required
@require_permission('configuracion.perfiles.editar')
def update_perfil(pid):
    d = request.get_json() or {}
    sets, vals = [], []
    if 'nombre' in d:
        sets.append("nombre = %s"); vals.append(d['nombre'])
    if 'descripcion' in d:
        sets.append("descripcion = %s"); vals.append(d['descripcion'])
    if 'permisos' in d:
        if not isinstance(d['permisos'], dict):
            return jsonify({'ok': False, 'error': 'permisos_invalid'}), 400
        sets.append("permisos = %s::jsonb")
        vals.append(__import__('json').dumps(d['permisos']))
    if 'is_admin' in d:
        sets.append("is_admin = %s"); vals.append(bool(d['is_admin']))
    if 'activa' in d:
        sets.append("activa = %s"); vals.append(bool(d['activa']))
    if not sets:
        return jsonify({'ok': False, 'error': 'no_fields'}), 400
    vals.extend([str(g.id_manager), pid])
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT * FROM perfil WHERE id_manager=%s AND id=%s", (str(g.id_manager), pid))
        before = cur.fetchone()
        cur.execute(f"""
            UPDATE perfil SET {', '.join(sets)}
             WHERE id_manager = %s AND id = %s
            RETURNING *
        """, vals)
        row = cur.fetchone()
    if not row:
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    diff = diff_dict(
        {k: before[k] for k in ('nombre','descripcion','is_admin','activa','permisos')} if before else {},
        {k: row[k]    for k in ('nombre','descripcion','is_admin','activa','permisos')},
    )
    log_action(actor_from_request(), entidad='perfil', entidad_id=pid,
               accion='update', resumen=f"Perfil actualizado: {row['nombre']}",
               cambios=diff)
    return jsonify({'ok': True, 'perfil': row})


@bp.route('/<int:pid>', methods=['DELETE'])
@auth_required
@require_permission('configuracion.perfiles.editar')
def delete_perfil(pid):
    with get_conn() as conn, conn.cursor() as cur:
        # Comprobar usuarios
        cur.execute("SELECT COUNT(*) AS n FROM usuario_web WHERE perfil_id = %s", (pid,))
        n = cur.fetchone()['n']
        if n > 0:
            # Soft delete: desactivar
            cur.execute("""
                UPDATE perfil SET activa = FALSE WHERE id_manager=%s AND id=%s
                RETURNING id
            """, (str(g.id_manager), pid))
            row = cur.fetchone()
            if not row:
                return jsonify({'ok': False, 'error': 'not_found'}), 404
            log_action(actor_from_request(), entidad='perfil', entidad_id=pid,
                       accion='deactivate', resumen=f"Perfil desactivado (tenía {n} usuarios)")
            return jsonify({'ok': True, 'mode': 'soft', 'usuarios': n,
                            'message': 'Perfil con usuarios — desactivado en lugar de borrado.'})
        cur.execute("DELETE FROM perfil WHERE id_manager=%s AND id=%s", (str(g.id_manager), pid))
    log_action(actor_from_request(), entidad='perfil', entidad_id=pid,
               accion='delete', resumen=f"Perfil borrado (id={pid})")
    return jsonify({'ok': True, 'mode': 'hard'})
