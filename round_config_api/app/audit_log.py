"""Audit log genérico — registra QUIÉN hace QUÉ.

Uso desde cualquier endpoint:

    from .audit_log import log_action, actor_from_request

    actor = actor_from_request()  # detecta JWT usuario_web o headers manager
    log_action(actor, entidad='cliente', entidad_id='1817155',
               accion='archive', resumen='Archivado por baja',
               cambios={'before': {'enabled': True}, 'after': {'enabled': False}})

`actor_from_request()` mira:
  1. Authorization: Bearer <jwt> → usuario_web
  2. X-Round-Manager-Id              → manager (NoofitPro)
"""
import json as _json
import logging
from flask import request, g
from .db import get_conn
from .auth_usuario import decode_jwt

log = logging.getLogger(__name__)


def actor_from_request() -> dict:
    """Devuelve un dict con info del actor. Si no se puede determinar, devuelve
    actor_kind='unknown' (igualmente se loggea para no perder trazabilidad)."""
    # Si el endpoint usaba @usuario_web_required, g.usuario_web ya está cargado
    u = getattr(g, 'usuario_web', None)
    if u:
        return {
            'kind': 'usuario_web',
            'id': u['id'],
            'email': u['email'],
            'label': f"{u.get('nombre','') or ''} {u.get('apellidos','') or ''}".strip() or u['email'],
            'id_manager': u['id_manager'],
            'id_trainer': u.get('id_trainer'),
        }
    # Auth manager (X-Round-Manager-Id)
    auth_header = request.headers.get('Authorization', '') if request else ''
    if auth_header.startswith('Bearer '):
        claims = decode_jwt(auth_header[7:].strip())
        if claims and claims.get('kind') == 'usuario_web':
            uid = int(claims.get('sub', 0)) or None
            email = None
            label = None
            # Resolver persona física desde BD para que el log diga QUIÉN
            # (y no un usuario_web anónimo) aunque el endpoint no use
            # @usuario_web_required (p.ej. los gated por X-Round-Token).
            if uid:
                try:
                    with get_conn() as conn, conn.cursor() as cur:
                        cur.execute("SELECT email, nombre, apellidos FROM usuario_web WHERE id=%s", (uid,))
                        r = cur.fetchone()
                    if r:
                        email = r.get('email')
                        label = f"{r.get('nombre','') or ''} {r.get('apellidos','') or ''}".strip() or email
                except Exception:
                    pass
            return {
                'kind': 'usuario_web',
                'id': uid,
                'email': email,
                'label': label,
                'id_manager': claims.get('mgr'),
                'id_trainer': claims.get('trn'),
            }
    # Manager NoofitPro
    mgr = (request.headers.get('X-Round-Manager-Id', '') if request else '').strip()
    trn = (request.headers.get('X-Round-Trainer-Id', '') if request else '').strip() or None
    if mgr:
        return {
            'kind': 'manager',
            'id': None,
            'email': None,
            'label': 'Manager',
            'id_manager': mgr,
            'id_trainer': trn,
        }
    return {'kind': 'unknown', 'id': None, 'email': None, 'label': None,
            'id_manager': None, 'id_trainer': None}


def log_action(actor: dict, entidad: str, accion: str, *,
               entidad_id: str = None, resumen: str = None,
               cambios: dict = None) -> None:
    """Registra una acción. Falla silenciosamente — el audit no debe romper la app."""
    try:
        ip = ''
        ua = ''
        if request:
            ip = (request.headers.get('X-Forwarded-For', '') or
                  request.headers.get('X-Real-IP', '') or
                  request.remote_addr or '')[:64]
            ua = (request.headers.get('User-Agent', ''))[:255]
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                INSERT INTO accion_log
                  (id_manager, id_trainer, actor_kind, actor_id, actor_email, actor_label,
                   entidad, entidad_id, accion, resumen, cambios, ip, user_agent)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s)
            """, (
                actor.get('id_manager') or '',
                actor.get('id_trainer'),
                actor.get('kind') or 'unknown',
                actor.get('id'),
                actor.get('email'),
                actor.get('label') or actor.get('email') or actor.get('kind'),
                entidad, str(entidad_id) if entidad_id is not None else None,
                accion,
                resumen,
                _json.dumps(cambios, default=str) if cambios else None,
                ip or None, ua or None,
            ))
    except Exception as e:
        log.warning(f'audit_log fallo silencioso entidad={entidad} accion={accion}: {e}')


def diff_dict(before: dict | None, after: dict | None) -> dict:
    """Calcula un dict {key: (old, new)} solo con campos que cambian."""
    if before is None: before = {}
    if after is None: after = {}
    out = {}
    for k in set(before) | set(after):
        if before.get(k) != after.get(k):
            out[k] = {'before': before.get(k), 'after': after.get(k)}
    return out
