"""Menú de Configuración del manager: define qué pestañas ven los trainers.

El manager marca, pestaña a pestaña, si los trainers la ven. El trainer (login
directo o impersonado) lee esta config al entrar y solo ve lo marcado en su
Configuración. Es manager-wide; se guarda en `manager_config.trainer_tabs`
(JSONB: array de ids de pestaña habilitadas para trainers).

Reglas de acceso:
- GET: cualquier sesión autenticada (el trainer lee la config de SU manager).
- PUT: solo el manager (NoofitPro manager, o usuario_web admin). Un trainer
  NoofitPro (`perfil=None` + `g.id_trainer`) lo bloquea `@require_manager`;
  un usuario_web no-admin lo bloquea el check de is_admin.
"""
import json as _json
import logging
from flask import Blueprint, request, jsonify, g
from ..auth import auth_required, require_manager
from ..db import get_conn
from ..audit_log import log_action, actor_from_request

bp = Blueprint('config_menu', __name__)
log = logging.getLogger(__name__)


@bp.route('', methods=['GET'])
@bp.route('/', methods=['GET'])
@auth_required
def get_menu():
    """Devuelve {enabled:[ids]|null}. null = el manager no lo configuró aún
    (el frontend aplica su set por defecto)."""
    m = str(g.id_manager)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT trainer_tabs FROM manager_config WHERE id_manager=%s", (m,))
        r = cur.fetchone()
    enabled = (r.get('trainer_tabs') if r else None)
    # JSONB puede venir como string si el driver no lo parseó; normalizar.
    if isinstance(enabled, str):
        try:
            enabled = _json.loads(enabled)
        except Exception:
            enabled = None
    if enabled is not None and not isinstance(enabled, list):
        enabled = None
    return jsonify({'ok': True, 'enabled': enabled})


@bp.route('', methods=['PUT'])
@bp.route('/', methods=['PUT'])
@auth_required
@require_manager
def set_menu():
    """Body: {enabled:[tabId,...]}. Guarda la lista de pestañas que ven los
    trainers. Solo manager (NoofitPro manager o usuario_web admin)."""
    # Defensa extra: un usuario_web NO admin no puede tocar el menú.
    perfil = getattr(g, 'perfil', None)
    if perfil is not None and not perfil.get('is_admin'):
        return jsonify({'ok': False, 'error': 'manager_only'}), 403

    d = request.get_json() or {}
    enabled = d.get('enabled')
    if not isinstance(enabled, list) or not all(isinstance(x, str) for x in enabled):
        return jsonify({'ok': False, 'error': 'enabled_must_be_string_array'}), 400
    # Normalizar: strings no vacíos, sin duplicados, conservando orden.
    seen, norm = set(), []
    for x in enabled:
        s = x.strip()
        if s and s not in seen:
            seen.add(s); norm.append(s)

    m = str(g.id_manager)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT trainer_tabs FROM manager_config WHERE id_manager=%s", (m,))
        if not cur.fetchone():
            return jsonify({'ok': False, 'error': 'manager_no_encontrado'}), 404
        cur.execute("UPDATE manager_config SET trainer_tabs=%s::jsonb WHERE id_manager=%s",
                    (_json.dumps(norm), m))
        conn.commit()
    log_action(actor_from_request(), entidad='config_menu', entidad_id=m,
               accion='update', resumen=f'Menú trainers: {len(norm)} pestañas visibles',
               cambios={'enabled': norm})
    return jsonify({'ok': True, 'enabled': norm})
