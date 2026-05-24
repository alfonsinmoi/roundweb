"""Auth del cliente NoofitPro (portal web del cliente).

Diferente de:
- `auth.auth_required`            : admin (manager/trainer con token compartido).
- `auth_usuario.usuario_web_required`: usuario web con perfil de admin.
- `auth_trabajador.trabajador_required`: trabajador (legacy emitido por
  `/api/horario/auth/login`). El JWT cliente con `es_trabajador=true` también
  pasa este decorador — ver más abajo.

Modelo: cualquier cliente NoofitPro (categoría Trabajador o no) puede acceder
al portal web (`/portal`). Login con sus credenciales NoofitPro (las mismas
que usa en mynoofit). El backend emite un JWT propio `kind='cliente'` con
claims:
  sub  → cliente_idnoofit
  kind → 'cliente'
  mgr  → id_manager
  esw  → es_trabajador (bool)
  tid  → trabajador_id (sólo si es_trabajador, para evitar lookup extra)
  iat, exp
"""
import os
import logging
import datetime as dt
from functools import wraps

import jwt
from flask import request, jsonify, g

from .db import get_conn

log = logging.getLogger(__name__)

JWT_SECRET = os.getenv('JWT_SECRET', '')
JWT_ALGO = 'HS256'
JWT_TTL_HOURS = 168  # 7 días


def issue_jwt_cliente(cliente_idnoofit: str, id_manager: str,
                      es_trabajador: bool, trabajador_id: int | None = None) -> str:
    if not JWT_SECRET:
        raise RuntimeError('JWT_SECRET no configurado')
    payload = {
        'sub': str(cliente_idnoofit),
        'kind': 'cliente',
        'mgr': str(id_manager),
        'esw': bool(es_trabajador),
        'tid': int(trabajador_id) if trabajador_id else None,
        'iat': dt.datetime.utcnow(),
        'exp': dt.datetime.utcnow() + dt.timedelta(hours=JWT_TTL_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


def decode_jwt_cliente(token: str) -> dict | None:
    if not JWT_SECRET or not token:
        return None
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except jwt.PyJWTError:
        return None


def _decode_auth_header() -> dict | None:
    auth = request.headers.get('Authorization', '')
    if not auth.startswith('Bearer '):
        return None
    token = auth[len('Bearer '):].strip()
    return decode_jwt_cliente(token)


def cliente_required(fn):
    """Carga `g.cliente` y `g.id_manager` para endpoints del portal."""
    @wraps(fn)
    def wrapper(*args, **kwargs):
        claims = _decode_auth_header()
        if not claims or claims.get('kind') != 'cliente':
            return jsonify({'ok': False, 'error': 'invalid_token'}), 401
        cliente_idnoofit = claims.get('sub')
        id_manager = claims.get('mgr')
        if not cliente_idnoofit or not id_manager:
            return jsonify({'ok': False, 'error': 'invalid_token'}), 401

        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT id::TEXT AS cliente_idnoofit, id_manager,
                       name, surname, email, id_trainer
                  FROM cliente_cache
                 WHERE id_manager = %s AND id::TEXT = %s
            """, (str(id_manager), str(cliente_idnoofit)))
            cli = cur.fetchone()
        if not cli:
            return jsonify({'ok': False, 'error': 'cliente_no_encontrado'}), 401

        g.cliente = dict(cli)
        g.cliente_idnoofit = cli['cliente_idnoofit']
        g.id_manager = cli['id_manager']
        g.es_trabajador = bool(claims.get('esw'))
        g.trabajador_id_from_jwt = claims.get('tid')
        return fn(*args, **kwargs)
    return wrapper


def resolver_trabajador_activo(id_manager: str, cliente_idnoofit: str) -> dict | None:
    """Devuelve la fila `trabajador` (dict) si el cliente tiene un trabajador
    activo en ese manager; None si no es trabajador, está en baja o el
    módulo no está activo."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT t.id, t.id_manager, t.cliente_idnoofit, t.id_trainer_empleador,
                   t.nombre_completo, t.estado,
                   mc.control_horario_enabled
              FROM trabajador t
              LEFT JOIN manager_config mc ON mc.id_manager = t.id_manager
             WHERE t.id_manager = %s
               AND t.cliente_idnoofit = %s
        """, (str(id_manager), str(cliente_idnoofit)))
        row = cur.fetchone()
    if not row:
        return None
    if row['estado'] != 'activo':
        return None
    if not row.get('control_horario_enabled'):
        return None
    return dict(row)
