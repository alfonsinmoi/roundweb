"""Endpoints para get/set modo_facturacion del manager.

3 modos posibles:
  - 'recibo_trimestre' (α): mensual = recibo, trimestral = factura formal
  - 'factura_draft'    (β): mensual = factura draft, trimestral = postear
  - 'factura_directa'  (γ): mensual = factura final, trimestral = solo informe
"""
import logging
from flask import Blueprint, request, jsonify, g
from ..auth import auth_required, require_permission, require_manager
from ..db import get_conn
from ..audit_log import log_action, actor_from_request

bp = Blueprint('modo_facturacion', __name__)
log = logging.getLogger(__name__)

VALID_MODES = {'recibo_trimestre', 'factura_draft', 'factura_directa'}


@bp.route('', methods=['GET'])
@bp.route('/', methods=['GET'])
@auth_required
def get_modo():
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT modo_facturacion FROM manager_config WHERE id_manager=%s",
                    (str(g.id_manager),))
        row = cur.fetchone()
    return jsonify({
        'ok': True,
        'modo_facturacion': (row.get('modo_facturacion') if row else None) or 'recibo_trimestre',
    })


@bp.route('', methods=['PUT'])
@bp.route('/', methods=['PUT'])
@auth_required
@require_permission('configuracion.modo_facturacion.editar')
@require_manager
def set_modo():
    d = request.get_json() or {}
    nuevo = (d.get('modo_facturacion') or '').strip()
    if nuevo not in VALID_MODES:
        return jsonify({'ok': False, 'error': f'modo_invalid (valores: {sorted(VALID_MODES)})'}), 400

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE manager_config SET modo_facturacion = %s
             WHERE id_manager = %s
            RETURNING modo_facturacion
        """, (nuevo, str(g.id_manager)))
        row = cur.fetchone()
    if not row:
        return jsonify({'ok': False, 'error': 'manager_no_encontrado'}), 404
    log_action(actor_from_request(), entidad='manager_config',
               entidad_id=g.id_manager, accion='set_modo_facturacion',
               resumen=f'modo_facturacion → {nuevo}')
    return jsonify({'ok': True, 'modo_facturacion': nuevo})
