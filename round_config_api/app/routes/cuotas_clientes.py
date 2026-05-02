"""Endpoints API para gestión de cuotas/recibos de clientes.

Todas operan sobre Odoo (round_facturacion) via XML-RPC.
"""
import base64
import logging
from flask import Blueprint, request, jsonify, g, Response
from ..auth import auth_required
from ..odoo_cuotas import get_cuotas

bp = Blueprint('cuotas_clientes', __name__)
log = logging.getLogger(__name__)


def _serialize(rec):
    """Convierte tipos Odoo (lista [id,name]) a dicts más simples para JSON."""
    if not rec: return rec
    out = dict(rec)
    for k, v in list(out.items()):
        if isinstance(v, list) and len(v) == 2 and isinstance(v[0], (int, type(None))):
            out[k] = {'id': v[0], 'name': v[1]}
    return out


# ── Listado por cliente (pestaña Cuotas en ClientProfile) ─────────────────────
@bp.route('/cliente/<id_noofit>', methods=['GET'])
@auth_required
def cuotas_cliente(id_noofit):
    try:
        recibos = get_cuotas().list_recibos_cliente(id_noofit)
        return jsonify({'ok': True, 'recibos': [_serialize(r) for r in recibos]})
    except Exception as e:
        log.exception('cuotas_cliente')
        return jsonify({'ok': False, 'error': str(e)}), 500


# ── Listado filtrable (Cuotas clientes / Listado) ─────────────────────────────
@bp.route('', methods=['GET'])
@auth_required
def list_cuotas():
    try:
        mes = request.args.get('mes') or None
        estado = request.args.get('estado') or None
        partner_id = request.args.get('partner_id', type=int)
        recibos = get_cuotas().list_recibos_filtrado(mes, estado, partner_id)
        return jsonify({'ok': True, 'recibos': [_serialize(r) for r in recibos]})
    except Exception as e:
        log.exception('list_cuotas')
        return jsonify({'ok': False, 'error': str(e)}), 500


# ── Preemisión: generar borradores del mes ────────────────────────────────────
@bp.route('/preemision/<mes>', methods=['POST'])
@auth_required
def preemision_generar(mes):
    """mes formato YYYY-MM"""
    try:
        result = get_cuotas().generar_preemision(mes)
        return jsonify({'ok': True, **result})
    except Exception as e:
        log.exception('preemision_generar')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/preemision/<mes>', methods=['GET'])
@auth_required
def preemision_listar(mes):
    """Lista los borradores creados para ese mes."""
    try:
        borradores = get_cuotas().list_borradores_mes(mes)
        return jsonify({'ok': True, 'borradores': [_serialize(b) for b in borradores]})
    except Exception as e:
        log.exception('preemision_listar')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/preemision/recibo/<int:invoice_id>', methods=['PATCH'])
@auth_required
def preemision_modificar(invoice_id):
    """Modificar un borrador: precio, fecha vencimiento, notas."""
    try:
        d = request.get_json() or {}
        result = get_cuotas().update_borrador(invoice_id, d)
        return jsonify({'ok': True, 'recibo': _serialize(result)})
    except ValueError as e:
        return jsonify({'ok': False, 'error': str(e)}), 400
    except Exception as e:
        log.exception('preemision_modificar')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/preemision/recibo/<int:invoice_id>', methods=['DELETE'])
@auth_required
def preemision_eliminar(invoice_id):
    try:
        get_cuotas().delete_borrador(invoice_id)
        return jsonify({'ok': True})
    except ValueError as e:
        return jsonify({'ok': False, 'error': str(e)}), 400
    except Exception as e:
        log.exception('preemision_eliminar')
        return jsonify({'ok': False, 'error': str(e)}), 500


# ── Emisión: confirmar remesa → genera SEPA ───────────────────────────────────
@bp.route('/emitir/<mes>', methods=['POST'])
@auth_required
def emitir_remesa(mes):
    try:
        result = get_cuotas().emitir_remesa(mes)
        return jsonify(result)
    except Exception as e:
        log.exception('emitir_remesa')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/sepa/<int:attachment_id>', methods=['GET'])
@auth_required
def descargar_sepa(attachment_id):
    """Devuelve el fichero SEPA pain.008 binario."""
    try:
        data = get_cuotas().descargar_sepa(attachment_id)
        if not data:
            return jsonify({'ok': False, 'error': 'not_found'}), 404
        return Response(
            base64.b64decode(data['content_b64']),
            mimetype=data['mimetype'],
            headers={'Content-Disposition': f'attachment; filename="{data["filename"]}"'},
        )
    except Exception as e:
        log.exception('descargar_sepa')
        return jsonify({'ok': False, 'error': str(e)}), 500
