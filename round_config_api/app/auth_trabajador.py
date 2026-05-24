"""Auth del trabajador (módulo Control horario laboral).

Diferente de:
- `auth.auth_required`: token compartido del manager/trainer admin.
- `auth_usuario.usuario_web_required`: usuario web con perfil y permisos.

El trabajador es un cliente NoofitPro con categoría 'Trabajador'. Se loguea
con sus credenciales NoofitPro (loginEasy) y nuestro backend le emite un
JWT propio que mynoofit/web reenvían en `Authorization: Bearer …` para los
endpoints de fichaje.

Claims del JWT trabajador:
  sub  → trabajador.id  (PK interno, no clienteId NoofitPro)
  kind → 'trabajador'
  mgr  → id_manager
  cli  → cliente_idnoofit
  iat, exp
"""
import os
import logging
import datetime as dt
from functools import wraps

import jwt
import requests
from flask import request, jsonify, g

from .db import get_conn
from . import noofit_client as nfc

log = logging.getLogger(__name__)

JWT_SECRET = os.getenv('JWT_SECRET', '')
JWT_ALGO = 'HS256'
JWT_TTL_HOURS = 168  # 7 días — coherente con usuario_web


def issue_jwt_trabajador(trabajador_id: int, id_manager: str,
                         cliente_idnoofit: str) -> str:
    if not JWT_SECRET:
        raise RuntimeError('JWT_SECRET no configurado')
    payload = {
        'sub': str(trabajador_id),
        'kind': 'trabajador',
        'mgr': str(id_manager),
        'cli': str(cliente_idnoofit),
        'iat': dt.datetime.utcnow(),
        'exp': dt.datetime.utcnow() + dt.timedelta(hours=JWT_TTL_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


def decode_jwt_trabajador(token: str) -> dict | None:
    if not JWT_SECRET or not token:
        return None
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except jwt.PyJWTError:
        return None


def login_noofit_cliente(email: str, password: str):
    """Valida credenciales de un cliente final contra NoofitPro.

    Usa `account/loginMobile` (endpoint de mynoofit cliente), distinto del
    `loginEasy` del manager/trainer. Devuelve `(True, custom_token)` si OK,
    `(False, motivo)` si KO.

    No persistimos el token NoofitPro — solo validamos credenciales y
    emitimos nuestro JWT propio (kind='trabajador' o kind='cliente').
    """
    try:
        token = nfc.login_cliente_final(email, password)
        return True, token
    except requests.HTTPError as e:
        code = e.response.status_code if e.response is not None else 0
        if code in (400, 401, 403):
            return False, 'credenciales_invalidas'
        return False, f'noofit_http_{code}'
    except Exception as e:
        log.warning(f'login_noofit_cliente: {e}')
        return False, 'noofit_unreachable'


def _load_trabajador_by_id(trab_id: int) -> dict | None:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT t.id, t.id_manager, t.cliente_idnoofit,
                   t.id_trainer_empleador, t.nombre_completo, t.estado,
                   mc.control_horario_enabled
              FROM trabajador t
              LEFT JOIN manager_config mc ON mc.id_manager = t.id_manager
             WHERE t.id = %s
        """, (trab_id,))
        return cur.fetchone()


def _load_trabajador_by_cliente(id_manager: str, cliente_idnoofit: str) -> dict | None:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT t.id, t.id_manager, t.cliente_idnoofit,
                   t.id_trainer_empleador, t.nombre_completo, t.estado,
                   mc.control_horario_enabled
              FROM trabajador t
              LEFT JOIN manager_config mc ON mc.id_manager = t.id_manager
             WHERE t.id_manager = %s AND t.cliente_idnoofit = %s
        """, (str(id_manager), str(cliente_idnoofit)))
        return cur.fetchone()


def trabajador_required(fn):
    """Decorador: acepta JWT `kind='trabajador'` (legacy) o `kind='cliente'`
    con `es_trabajador=true`. Carga `g.trabajador` (dict) y `g.id_manager`.

    Errores:
      401 missing_token / invalid_token
      403 trabajador_baja / trabajador_pendiente_alta / feature_not_enabled
    """
    @wraps(fn)
    def wrapper(*args, **kwargs):
        auth = request.headers.get('Authorization', '')
        if not auth.startswith('Bearer '):
            return jsonify({'ok': False, 'error': 'missing_token'}), 401
        token = auth[len('Bearer '):].strip()
        claims = decode_jwt_trabajador(token)
        if not claims:
            return jsonify({'ok': False, 'error': 'invalid_token'}), 401

        kind = claims.get('kind')
        row = None
        if kind == 'trabajador':
            try:
                trab_id = int(claims['sub'])
            except (KeyError, ValueError, TypeError):
                return jsonify({'ok': False, 'error': 'invalid_token'}), 401
            row = _load_trabajador_by_id(trab_id)
        elif kind == 'cliente':
            # No miramos el claim `esw` del JWT — puede estar desactualizado si
            # el cliente se logueó antes de que el admin le diera de alta.
            # La verdad la determina la fila `trabajador` en BD, recalculada
            # en cada request.
            cli = claims.get('sub')
            mgr = claims.get('mgr')
            if not cli or not mgr:
                return jsonify({'ok': False, 'error': 'invalid_token'}), 401
            row = _load_trabajador_by_cliente(mgr, cli)
        else:
            return jsonify({'ok': False, 'error': 'invalid_token'}), 401

        if not row:
            return jsonify({'ok': False, 'error': 'no_eres_trabajador'}), 403
        if row['estado'] != 'activo':
            return jsonify({'ok': False, 'error': f'trabajador_{row["estado"]}'}), 403
        if not row.get('control_horario_enabled'):
            return jsonify({
                'ok': False, 'error': 'feature_not_enabled',
                'feature': 'control_horario',
            }), 403

        g.trabajador = row
        g.id_manager = row['id_manager']
        return fn(*args, **kwargs)
    return wrapper
