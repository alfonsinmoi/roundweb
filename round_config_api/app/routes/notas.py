"""Endpoints de notas de cliente.

Crear/editar/asignar usa @auth_required (manager) o @usuario_web_required.
Por simplicidad acepto AMBAS auths con un decorador combinado.

Endpoints:
  GET    /api/notas/cliente/<idnoofit>       — todas las notas del cliente
  POST   /api/notas/cliente/<idnoofit>       — crear nota
  PATCH  /api/notas/<id>                     — editar / asignar / cambiar estado
  POST   /api/notas/<id>/responder           — crear nota hija (respuesta)
  POST   /api/notas/<id>/archivar            — marcar archivada
  POST   /api/notas/<id>/recordatorio        — diferir N horas
  DELETE /api/notas/<id>                     — borrar (solo manager o creador)

Para el banner del usuario:
  GET    /api/notas/me/banner                — abiertas asignadas a mí
  GET    /api/notas/me                       — todas mis notas (con filtros)

Listado del cliente para popup de últimas 3:
  GET    /api/notas/cliente/<idnoofit>?limit=3
"""
import datetime as dt
import logging
from functools import wraps
from flask import Blueprint, request, jsonify, g

from ..auth import auth_required
from ..auth_usuario import usuario_web_required, decode_jwt
from ..db import get_conn
from ..audit_log import log_action, actor_from_request

bp = Blueprint('notas', __name__)
log = logging.getLogger(__name__)


def either_auth(fn):
    """Acepta auth manager (X-Round-Token + X-Round-Manager-Id) o JWT usuario_web."""
    @wraps(fn)
    def wrapper(*args, **kwargs):
        # Probar JWT primero
        auth_header = request.headers.get('Authorization', '')
        if auth_header.startswith('Bearer '):
            return usuario_web_required(fn)(*args, **kwargs)
        return auth_required(fn)(*args, **kwargs)
    return wrapper


def _actor_label_for_insert():
    """Construye los campos created_by_* a partir del actor."""
    actor = actor_from_request()
    return {
        'kind': actor['kind'],
        'id': actor['id'],
        'email': actor['email'] or '',
        'label': actor['label'] or actor['email'] or 'Manager',
    }


def _serialize(row):
    """Asegura que campos JSONB y datetimes se serializan bien."""
    return row


# ──────────────────────────────────────────────────────────────────────────────

@bp.route('/cliente/<idnoofit>', methods=['GET'])
@either_auth
def list_notas_cliente(idnoofit):
    limit = min(int(request.args.get('limit', '100')), 500)
    incluir_archivadas = request.args.get('archivadas') == '1'
    where = ['id_manager=%s', 'cliente_idnoofit=%s']
    vals = [str(g.id_manager), str(idnoofit)]
    if not incluir_archivadas:
        where.append("estado <> 'archivada'")
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"""
            SELECT id, parent_id, contenido,
                   created_by_kind, created_by_id, created_by_email, created_by_label,
                   asignada_a_usuario_id, asignada_a_email, asignada_a_label,
                   estado, recordatorio_hasta,
                   created_at, updated_at, archived_at, archived_by_email
              FROM cliente_nota
             WHERE {' AND '.join(where)}
             ORDER BY created_at DESC
             LIMIT %s
        """, vals + [limit])
        rows = cur.fetchall()
    return jsonify({'ok': True, 'notas': rows})


@bp.route('/cliente/<idnoofit>', methods=['POST'])
@either_auth
def create_nota(idnoofit):
    d = request.get_json() or {}
    contenido = (d.get('contenido') or '').strip()
    if not contenido:
        return jsonify({'ok': False, 'error': 'contenido_required'}), 400
    cliente_nombre = (d.get('cliente_nombre') or '').strip() or None
    asignada_a = d.get('asignada_a_usuario_id')

    by = _actor_label_for_insert()
    asignada_email, asignada_label = None, None
    if asignada_a:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT email, nombre, apellidos FROM usuario_web
                 WHERE id=%s AND id_manager=%s
            """, (asignada_a, str(g.id_manager)))
            r = cur.fetchone()
            if not r:
                return jsonify({'ok': False, 'error': 'asignado_no_existe'}), 400
            asignada_email = r['email']
            asignada_label = f"{r.get('nombre','') or ''} {r.get('apellidos','') or ''}".strip() or r['email']

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            INSERT INTO cliente_nota
              (id_manager, id_trainer, cliente_idnoofit, cliente_nombre, contenido,
               created_by_kind, created_by_id, created_by_email, created_by_label,
               asignada_a_usuario_id, asignada_a_email, asignada_a_label,
               estado, parent_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'abierta', %s)
            RETURNING *
        """, (
            str(g.id_manager), g.id_trainer, str(idnoofit), cliente_nombre, contenido,
            by['kind'], by['id'], by['email'], by['label'],
            asignada_a, asignada_email, asignada_label,
            d.get('parent_id'),
        ))
        row = cur.fetchone()
    log_action(actor_from_request(), entidad='nota', entidad_id=row['id'],
               accion='create',
               resumen=f"Nota creada en cliente {idnoofit}" + (f" → asignada a {asignada_email}" if asignada_email else ''),
               cambios={'cliente': str(idnoofit), 'asignada_a': asignada_email})
    return jsonify({'ok': True, 'nota': row})


@bp.route('/<int:nid>', methods=['PATCH'])
@either_auth
def update_nota(nid):
    d = request.get_json() or {}
    sets, vals = [], []
    if 'contenido' in d:
        sets.append('contenido = %s'); vals.append(d['contenido'])
    if 'asignada_a_usuario_id' in d:
        new_id = d['asignada_a_usuario_id']
        if new_id:
            with get_conn() as conn, conn.cursor() as cur:
                cur.execute("SELECT email, nombre, apellidos FROM usuario_web WHERE id=%s AND id_manager=%s",
                            (new_id, str(g.id_manager)))
                r = cur.fetchone()
                if not r: return jsonify({'ok': False, 'error': 'asignado_no_existe'}), 400
                sets.append('asignada_a_usuario_id = %s'); vals.append(new_id)
                sets.append('asignada_a_email = %s'); vals.append(r['email'])
                sets.append('asignada_a_label = %s'); vals.append(f"{r.get('nombre','') or ''} {r.get('apellidos','') or ''}".strip() or r['email'])
        else:
            sets.append('asignada_a_usuario_id = NULL')
            sets.append('asignada_a_email = NULL')
            sets.append('asignada_a_label = NULL')
    if not sets:
        return jsonify({'ok': False, 'error': 'no_fields'}), 400
    vals.extend([str(g.id_manager), nid])
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"""
            UPDATE cliente_nota SET {', '.join(sets)}
             WHERE id_manager=%s AND id=%s
            RETURNING *
        """, vals)
        row = cur.fetchone()
    if not row:
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    log_action(actor_from_request(), entidad='nota', entidad_id=nid,
               accion='update', resumen='Nota actualizada', cambios=d)
    return jsonify({'ok': True, 'nota': row})


@bp.route('/<int:nid>/archivar', methods=['POST'])
@either_auth
def archivar_nota(nid):
    actor = actor_from_request()
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE cliente_nota
               SET estado='archivada', archived_at=NOW(),
                   archived_by_email=%s
             WHERE id_manager=%s AND id=%s
            RETURNING *
        """, (actor.get('email') or actor.get('label'), str(g.id_manager), nid))
        row = cur.fetchone()
    if not row: return jsonify({'ok': False, 'error': 'not_found'}), 404
    log_action(actor, entidad='nota', entidad_id=nid, accion='archivar',
               resumen=f"Nota archivada (cliente {row['cliente_idnoofit']})")
    return jsonify({'ok': True, 'nota': row})


@bp.route('/<int:nid>/recordatorio', methods=['POST'])
@either_auth
def recordar_nota(nid):
    """body: {horas: 24}  o  {hasta: 'YYYY-MM-DDTHH:MM'}"""
    d = request.get_json() or {}
    horas = d.get('horas')
    hasta = d.get('hasta')
    if horas:
        target = dt.datetime.utcnow() + dt.timedelta(hours=int(horas))
    elif hasta:
        try: target = dt.datetime.fromisoformat(hasta.replace('Z',''))
        except Exception: return jsonify({'ok': False, 'error': 'hasta_invalid'}), 400
    else:
        return jsonify({'ok': False, 'error': 'horas_or_hasta_required'}), 400
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE cliente_nota
               SET estado='recordatorio', recordatorio_hasta=%s
             WHERE id_manager=%s AND id=%s
            RETURNING *
        """, (target, str(g.id_manager), nid))
        row = cur.fetchone()
    if not row: return jsonify({'ok': False, 'error': 'not_found'}), 404
    log_action(actor_from_request(), entidad='nota', entidad_id=nid, accion='recordatorio',
               resumen=f"Recordar más tarde ({target.isoformat()})")
    return jsonify({'ok': True, 'nota': row})


@bp.route('/<int:nid>/responder', methods=['POST'])
@either_auth
def responder_nota(nid):
    """Crea una nota hija (parent_id=nid) y, si se pide, marca la padre como 'contestada'."""
    d = request.get_json() or {}
    contenido = (d.get('contenido') or '').strip()
    if not contenido:
        return jsonify({'ok': False, 'error': 'contenido_required'}), 400
    by = _actor_label_for_insert()

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT cliente_idnoofit, cliente_nombre, asignada_a_usuario_id, asignada_a_email, asignada_a_label, created_by_id, created_by_email, created_by_label
                         FROM cliente_nota WHERE id_manager=%s AND id=%s""", (str(g.id_manager), nid))
        parent = cur.fetchone()
        if not parent: return jsonify({'ok': False, 'error': 'parent_not_found'}), 404
        # La respuesta se asigna inversamente (al que mandó la nota original) si no se especifica
        asignada_a = d.get('asignada_a_usuario_id', parent['created_by_id'])
        asignada_email = parent['created_by_email'] if asignada_a == parent['created_by_id'] else None
        asignada_label = parent['created_by_label'] if asignada_a == parent['created_by_id'] else None
        if asignada_a and not asignada_email:
            cur.execute("SELECT email, nombre, apellidos FROM usuario_web WHERE id=%s", (asignada_a,))
            r = cur.fetchone()
            if r:
                asignada_email = r['email']
                asignada_label = f"{r.get('nombre','') or ''} {r.get('apellidos','') or ''}".strip() or r['email']

        cur.execute("""
            INSERT INTO cliente_nota
              (id_manager, id_trainer, cliente_idnoofit, cliente_nombre, contenido,
               created_by_kind, created_by_id, created_by_email, created_by_label,
               asignada_a_usuario_id, asignada_a_email, asignada_a_label,
               estado, parent_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'abierta', %s)
            RETURNING *
        """, (
            str(g.id_manager), g.id_trainer, parent['cliente_idnoofit'], parent['cliente_nombre'], contenido,
            by['kind'], by['id'], by['email'], by['label'],
            asignada_a, asignada_email, asignada_label, nid,
        ))
        nueva = cur.fetchone()
        # Marcar la padre como contestada
        if d.get('cerrar_padre', True):
            cur.execute("UPDATE cliente_nota SET estado='contestada' WHERE id=%s", (nid,))
    log_action(actor_from_request(), entidad='nota', entidad_id=nueva['id'], accion='responder',
               resumen=f"Respuesta a nota {nid}")
    return jsonify({'ok': True, 'nota': nueva})


@bp.route('/<int:nid>', methods=['DELETE'])
@either_auth
def delete_nota(nid):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM cliente_nota WHERE id_manager=%s AND id=%s RETURNING cliente_idnoofit",
                    (str(g.id_manager), nid))
        row = cur.fetchone()
    if not row: return jsonify({'ok': False, 'error': 'not_found'}), 404
    log_action(actor_from_request(), entidad='nota', entidad_id=nid, accion='delete')
    return jsonify({'ok': True})


# ─── Endpoints "yo" (banner + página /notas) ─────────────────────────────────
@bp.route('/me/banner', methods=['GET'])
@usuario_web_required
def my_banner():
    """Notas activas asignadas a mí, no archivadas y sin recordatorio futuro."""
    uid = g.usuario_web['id']
    now = dt.datetime.utcnow()
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT id, cliente_idnoofit, cliente_nombre, contenido,
                   created_by_email, created_by_label,
                   estado, recordatorio_hasta, parent_id, created_at
              FROM cliente_nota
             WHERE asignada_a_usuario_id = %s
               AND estado IN ('abierta')
               AND (recordatorio_hasta IS NULL OR recordatorio_hasta <= %s)
             ORDER BY created_at DESC
             LIMIT 50
        """, (uid, now))
        rows = cur.fetchall()
    return jsonify({'ok': True, 'notas': rows, 'count': len(rows)})


@bp.route('/me', methods=['GET'])
@usuario_web_required
def my_notas():
    """Mis notas (asignadas a mí o creadas por mí), con filtros."""
    uid = g.usuario_web['id']
    qs = request.args
    where = []; vals = []
    rol = qs.get('rol', 'todas')   # asignadas | creadas | todas
    if rol == 'asignadas':
        where.append('asignada_a_usuario_id = %s'); vals.append(uid)
    elif rol == 'creadas':
        where.append('created_by_id = %s'); vals.append(uid)
    else:
        where.append('(asignada_a_usuario_id = %s OR created_by_id = %s)'); vals.extend([uid, uid])

    if qs.get('estado'):
        where.append('estado = %s'); vals.append(qs['estado'])
    if qs.get('cliente'):
        where.append('cliente_idnoofit = %s'); vals.append(qs['cliente'])

    sql = f"""
        SELECT id, parent_id, cliente_idnoofit, cliente_nombre, contenido,
               created_by_kind, created_by_id, created_by_email, created_by_label,
               asignada_a_usuario_id, asignada_a_email, asignada_a_label,
               estado, recordatorio_hasta,
               created_at, updated_at
          FROM cliente_nota
         WHERE id_manager = %s AND {' AND '.join(where)}
         ORDER BY created_at DESC
         LIMIT 500
    """
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(sql, [g.id_manager] + vals)
        rows = cur.fetchall()
    return jsonify({'ok': True, 'notas': rows})
