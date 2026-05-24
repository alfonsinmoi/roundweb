"""Auth: token compartido + headers de identidad (id_manager, id_trainer).

Modelo de auth en Round (mayo 2026):

1) **Token compartido** (`X-Round-Token`): hardcoded en `.env` (CONFIG_API_TOKEN),
   garantiza que la API solo la usa el front oficial. Origen histórico: era
   el único mecanismo de auth para el manager NoofitPro logueado.

2) **JWT de usuario_web** (`Authorization: Bearer …`): opcional. Si el
   request lo trae además del token compartido, identificamos al usuario_web
   concreto y resolvemos su `perfil` (matriz JSONB de permisos). Permite
   enforcement fino server-side vía `@require_permission(...)`.

Reglas combinadas:
  - Token compartido REQUERIDO siempre.
  - JWT OPCIONAL. Si llega:
       g.usuario_web = fila BD (con perfil joined)
       g.perfil      = {id, nombre, is_admin, permisos}
    Si NO llega:
       g.usuario_web = None
       g.perfil      = None
    En ese caso, `@require_permission` deja pasar (control total — es el
    manager NoofitPro logueado de forma clásica).
  - `id_manager` se toma del JWT si presente (más fiable); si no, del
    header `X-Round-Manager-Id`.
"""
from functools import wraps
from flask import request, jsonify, g

from . import config
from .auth_usuario import decode_jwt
from .db import get_conn


def _load_usuario_web_from_jwt():
    """Si hay header Authorization: Bearer <jwt>, decodifica y carga
    g.usuario_web + g.perfil + actualiza id_manager/id_trainer del JWT.
    Si no hay JWT o es inválido, no hace nada (deja g.*=None).

    Retorna `True` si cargó usuario, `False` si no.
    """
    g.usuario_web = None
    g.perfil = None

    auth = request.headers.get('Authorization', '')
    if not auth.startswith('Bearer '):
        return False
    token = auth[len('Bearer '):].strip()
    claims = decode_jwt(token)
    if not claims or claims.get('kind') != 'usuario_web':
        return False
    try:
        usuario_id = int(claims['sub'])
    except (KeyError, ValueError, TypeError):
        return False

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT u.id, u.id_manager, u.id_trainer, u.perfil_id, u.email,
                   u.nombre, u.apellidos, u.activo,
                   p.id   AS p_id,
                   p.nombre AS p_nombre,
                   p.permisos AS p_permisos,
                   p.is_admin AS p_is_admin
              FROM usuario_web u
              LEFT JOIN perfil p ON p.id = u.perfil_id
             WHERE u.id = %s
        """, (usuario_id,))
        row = cur.fetchone()
    if not row or not row['activo']:
        return False
    g.usuario_web = row
    g.perfil = {
        'id': row['p_id'],
        'nombre': row['p_nombre'],
        'is_admin': bool(row['p_is_admin']),
        'permisos': row['p_permisos'] or {},
    }
    # Sobreescribe id_manager/id_trainer con los del JWT (autoritativos).
    g.id_manager = row['id_manager']
    g.id_trainer = row['id_trainer']
    return True


def auth_required(fn):
    """Valida el token compartido y carga g.id_manager, g.id_trainer.

    Acepta token vía header X-Round-Token o query param ?token= (este último
    para `<a href>` directos donde el navegador no manda headers — p.ej.
    'ver archivo' subido).

    Adicionalmente, si llega `Authorization: Bearer <jwt>`, intenta resolver
    el usuario_web y carga g.usuario_web + g.perfil. Sirve para
    `@require_permission(...)`.
    """
    @wraps(fn)
    def wrapper(*args, **kwargs):
        token = request.headers.get('X-Round-Token', '') or request.args.get('token', '')
        if not config.API_TOKEN or token != config.API_TOKEN:
            return jsonify({'ok': False, 'error': 'invalid_token'}), 401

        g.id_manager = (request.headers.get('X-Round-Manager-Id', '')
                        or request.args.get('manager', '')).strip()
        g.id_trainer = (request.headers.get('X-Round-Trainer-Id', '')
                        or request.args.get('trainer', '')).strip() or None

        # Intenta resolver usuario_web si vino JWT (no obligatorio).
        _load_usuario_web_from_jwt()

        if not g.id_manager:
            return jsonify({'ok': False, 'error': 'missing_manager_id'}), 400

        return fn(*args, **kwargs)
    return wrapper


def _has_permission(perfil: dict | None, path: str) -> bool:
    """Espejo en backend de `hasPermission()` del frontend
    (src/config/permissions.js). Path tipo 'clientes.archivar' o
    'economico.cuotas_mensuales.procesar_sepa'.

    - perfil=None → True (sin JWT → manager NoofitPro clásico, control total).
    - is_admin=True → True.
    - Path no existente en la matriz → False (deny-by-default).
    """
    if perfil is None:
        return True
    if perfil.get('is_admin'):
        return True
    cur = perfil.get('permisos') or {}
    for part in path.split('.'):
        if not isinstance(cur, dict):
            return False
        cur = cur.get(part)
        if cur is None:
            return False
    return cur is True


def require_permission(path: str):
    """Decorador para gating fino server-side. Debe ir DESPUÉS de
    `@auth_required` (que carga g.perfil).

    Ejemplo:
        @bp.route('/leads/<id>', methods=['DELETE'])
        @auth_required
        @require_permission('crm.leads.borrar_lead')
        def borrar_lead(id):
            ...

    Si el usuario no tiene el permiso, responde 403 con
    `{ok:false, error:'permission_denied', perm:<path>}`.
    """
    def deco(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            perfil = getattr(g, 'perfil', None)
            if not _has_permission(perfil, path):
                # Auditoría: registrar denegación (no falla si log error).
                try:
                    from .audit_log import log_action, actor_from_request
                    log_action(actor_from_request(),
                               entidad='permission_check',
                               entidad_id=path,
                               accion='denied',
                               resumen=f'perm={path} perfil={perfil.get("nombre") if perfil else "?"}')
                except Exception:
                    pass
                return jsonify({
                    'ok': False,
                    'error': 'permission_denied',
                    'perm': path,
                }), 403
            return fn(*args, **kwargs)
        return wrapper
    return deco
