"""Helper para gatear endpoints que requieren un módulo activado.

Uso clásico (compat retro — mira odoo_enabled global):
    from flask import g
    from ..odoo_guard import require_odoo

    @bp.route('/foo', methods=['GET'])
    @auth_required
    @require_odoo
    def foo():
        ...

Uso granular (Fase 6 + Fase 7 — split por feature):
    from ..odoo_guard import require_feature

    @bp.route('/leads', methods=['GET'])
    @auth_required
    @require_feature('crm')
    def leads():
        ...

Features válidas: 'crm', 'cuotas', 'contabilidad', 'control_horario'.
Cada una mira su columna correspondiente en manager_config
(odoo_crm_enabled, odoo_cuotas_enabled, odoo_contabilidad_enabled,
control_horario_enabled).

El decorador inspecciona `manager_config` para el manager actual
(g.id_manager) y, si la feature está a FALSE o el manager no existe en
BD, devuelve `403 odoo_not_enabled` con un mensaje útil — en vez de dejar
que se llame a Odoo XML-RPC y se peta con 500.

Para el manager actual (17675, todas las flags=true) el decorador no
afecta: deja pasar inmediatamente. Cero coste en operación normal.
"""
from functools import wraps
from flask import jsonify, g

from .db import get_conn


# Map feature name → columna en manager_config
_FEATURE_COLUMNS = {
    'crm':              'odoo_crm_enabled',
    'cuotas':           'odoo_cuotas_enabled',
    'contabilidad':     'odoo_contabilidad_enabled',
    'control_horario':  'control_horario_enabled',
}


def manager_has_odoo(id_manager) -> bool:
    """True si el manager existe en manager_config con `odoo_enabled=true`.
    False si no existe o si está desactivado."""
    if not id_manager:
        return False
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""SELECT odoo_enabled FROM manager_config
                            WHERE id_manager = %s""", (str(id_manager),))
            row = cur.fetchone()
        return bool(row and row.get('odoo_enabled'))
    except Exception:
        # Ante fallo de BD, ser conservador: NO bloquear (el manager
        # actual sigue funcionando). El endpoint puede fallar después,
        # pero al menos no bloqueamos lo que sí funciona.
        return True


def manager_has_feature(id_manager, feature: str) -> bool:
    """True si el manager tiene la `feature` (crm/cuotas/contabilidad)
    activa en su fila de manager_config. False si no existe la fila,
    si la columna no es válida o si la feature está desactivada."""
    if not id_manager:
        return False
    col = _FEATURE_COLUMNS.get(feature)
    if not col:
        # Feature desconocida → tratamos como denegada (programación defensiva)
        return False
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute(f"""SELECT {col} AS enabled FROM manager_config
                             WHERE id_manager = %s""", (str(id_manager),))
            row = cur.fetchone()
        return bool(row and row.get('enabled'))
    except Exception:
        # Ante fallo de BD, NO bloquear (consistente con manager_has_odoo).
        return True


def require_odoo(fn):
    """Decorador que devuelve 403 si el manager no tiene Odoo activo."""
    @wraps(fn)
    def wrapper(*args, **kwargs):
        id_manager = getattr(g, 'id_manager', None)
        if not manager_has_odoo(id_manager):
            return jsonify({
                'ok': False,
                'error': 'odoo_not_enabled',
                'motivo': ('Este endpoint requiere contabilidad/Odoo desplegada. '
                           'Actívala en Configuración → Suscripciones.'),
            }), 403
        return fn(*args, **kwargs)
    return wrapper


def require_feature(feature: str):
    """Factory de decorador que comprueba una feature granular concreta.

    Devuelve 403 `feature_not_enabled` si la columna correspondiente está
    a FALSE para el manager actual.

    Args:
        feature: una de 'crm', 'cuotas', 'contabilidad'.

    Raises:
        ValueError en import-time si el nombre de feature no es válido —
        es mejor petar al importar el módulo que silenciar el error.
    """
    if feature not in _FEATURE_COLUMNS:
        raise ValueError(
            f"require_feature: feature {feature!r} desconocida. "
            f"Válidas: {list(_FEATURE_COLUMNS)}"
        )

    # Mensaje específico per-feature
    _MENSAJES = {
        'crm':              ('Este endpoint requiere el módulo CRM activado. '
                             'Actívalo en Configuración → Suscripciones → CRM.'),
        'cuotas':           ('Este endpoint requiere el módulo Cuotas activado. '
                             'Actívalo en Configuración → Suscripciones → Cuotas.'),
        'contabilidad':     ('Este endpoint requiere el módulo Contabilidad activado. '
                             'Actívalo en Configuración → Suscripciones → Contabilidad.'),
        'control_horario':  ('Este endpoint requiere el módulo Control horario '
                             'activado. Actívalo en Configuración → Suscripciones '
                             '→ Control horario.'),
    }
    motivo = _MENSAJES[feature]

    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            id_manager = getattr(g, 'id_manager', None)
            if not manager_has_feature(id_manager, feature):
                return jsonify({
                    'ok': False,
                    'error': 'feature_not_enabled',
                    'feature': feature,
                    'motivo': motivo,
                }), 403
            return fn(*args, **kwargs)
        return wrapper
    return decorator
