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
    # id_manager: del BD (es invariante por usuario).
    g.id_manager = row['id_manager']
    # id_trainer: del JWT claim `trn` (autoritativo — el usuario eligió
    # un centro al login y queda bloqueado a él durante toda la sesión).
    # Fallback al valor del BD para usuarios viejos sin claim `trn`.
    g.id_trainer = claims.get('trn') or row['id_trainer']
    return True


def parent_manager_si_es_trainer(id_x):
    """Si `id_x` es un trainer registrado bajo OTRO manager (fila en
    trainer_noofit_creds con id_trainer=id_x e id_manager<>id_x), devuelve el
    id de ese manager padre. Si no, None.

    Sirve para corregir el caso de un login DIRECTO de trainer: NoofitPro
    devuelve X-TRAINER_MANAGER=false y el frontend cae al id propio como
    manager (p.ej. Añoreta 17674). Aquí lo reconducimos a su manager real.
    """
    if not id_x:
        return None
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT id_manager FROM trainer_noofit_creds
                 WHERE id_trainer = %s AND id_manager <> %s AND activo = TRUE
                 LIMIT 1
            """, (str(id_x), str(id_x)))
            row = cur.fetchone()
        return str(row['id_manager']) if row and row.get('id_manager') else None
    except Exception:
        return None


def _remap_trainer_as_manager():
    """Si el id_manager recibido NO es un manager real (sin manager_config) pero
    SÍ es un trainer conocido, operamos bajo su manager padre + ese trainer."""
    mgr = getattr(g, 'id_manager', None)
    if not mgr:
        return
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("SELECT 1 FROM manager_config WHERE id_manager = %s", (mgr,))
            if cur.fetchone():
                return  # es un manager real → no tocar
    except Exception:
        return
    parent = parent_manager_si_es_trainer(mgr)
    if parent and parent != mgr:
        if not getattr(g, 'id_trainer', None):
            g.id_trainer = mgr
        g.id_manager = parent


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
        # Validar que id_manager e id_trainer son numéricos (id NoofitPro).
        # Sin esto, cualquier endpoint que use g.id_manager en rutas
        # filesystem (upload-media) o WHERE de SQL sin params (no debería
        # haberlas, pero defensivo) acepta '..' o '/' — audit mayo 2026.
        import re as _re
        if not _re.fullmatch(r'\d{1,16}', g.id_manager):
            return jsonify({'ok': False, 'error': 'invalid_manager_id'}), 400
        if g.id_trainer and not _re.fullmatch(r'\d{1,16}', g.id_trainer):
            return jsonify({'ok': False, 'error': 'invalid_trainer_id'}), 400

        # Reconducir login directo de trainer a su manager real (ver helper).
        _remap_trainer_as_manager()

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


def resolve_trainer_target(qs_value):
    """Sprint 4 #C3: helper para evitar cross-trainer leaks.

    Un usuario_web atado a un centro (`g.id_trainer` set por su JWT) NO
    puede ver datos de OTRO trainer pasando `?id_trainer=Y` en query string.
    Manager NoofitPro (sin perfil) y manager_bare (con perfil pero sin
    `trn` claim) sí pueden filtrar libremente.

    Returns: (target_trainer:str|None, forbidden:bool)
      - forbidden=True → el endpoint debe devolver 403
    """
    qs_trainer = (qs_value or '').strip()
    bound_trainer = getattr(g, 'id_trainer', None)
    if bound_trainer and qs_trainer and qs_trainer != str(bound_trainer):
        return None, True
    return (qs_trainer or bound_trainer), False


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


def require_manager(fn):
    """Gating "solo el manager del grupo" para una sesión NoofitPro.

    Cierra el agujero del login DIRECTO de trainer: un trainer NoofitPro tiene
    `perfil=None` y, por sí solo, `require_permission` lo dejaría pasar
    (perfil None = control total). Regla:
      - NoofitPro MANAGER  → `perfil=None` y SIN `g.id_trainer`  → pasa.
      - NoofitPro TRAINER  → `perfil=None` y CON `g.id_trainer`  → 403.
      - usuario_web        → `perfil≠None` → NO lo bloquea aquí; lo decide su
        perfil vía `require_permission` (delegación normal). Así un usuario_web
        admin de nivel manager (cuyo JWT lleva `trn`=su centro) no queda fuera.
    Debe ir DESPUÉS de `@auth_required`."""
    @wraps(fn)
    def wrapper(*args, **kwargs):
        perfil = getattr(g, 'perfil', None)
        if perfil is None and getattr(g, 'id_trainer', None):
            return jsonify({'ok': False, 'error': 'manager_only'}), 403
        return fn(*args, **kwargs)
    return wrapper


def _has_section_access(perfil: dict | None, section: str) -> bool:
    """Espejo backend de `canAccessSection()` del frontend (useCanAccess):
    acceso a una SECCIÓN/pantalla si el perfil tiene CUALQUIER hoja=True bajo
    esa sección. Sirve para gatear endpoints de LECTURA con la misma regla que
    usa el frontend para mostrar la sección (así no se deniega a quien la ve).

    - perfil=None → True (manager NoofitPro, control total).
    - is_admin    → True.
    - sección ausente o sin ninguna hoja True → False.
    """
    if perfil is None:
        return True
    if perfil.get('is_admin'):
        return True
    cur = perfil.get('permisos') or {}
    for part in section.split('.'):
        if not isinstance(cur, dict):
            return False
        cur = cur.get(part)
        if cur is None:
            return False

    def _any_true(node):
        if node is True:
            return True
        if isinstance(node, dict):
            return any(_any_true(v) for v in node.values())
        return False
    return _any_true(cur)


def require_seccion(section: str):
    """Decorador para gatear endpoints de LECTURA por sección (mismo criterio
    que el menú/frontend). Va DESPUÉS de `@auth_required`. 403 si el perfil no
    puede ver nada de esa sección."""
    def deco(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            if not _has_section_access(getattr(g, 'perfil', None), section):
                return jsonify({'ok': False, 'error': 'permission_denied',
                                'seccion': section}), 403
            return fn(*args, **kwargs)
        return wrapper
    return deco
