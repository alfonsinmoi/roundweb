"""CRUD de forma de pago por cliente con histórico.

Cada cliente tiene UNA forma de pago activa. Al cambiarla, se cierra la actual
(fecha_fin=hoy, estado=cancelada) y se crea una nueva.

Endpoints:
  GET    /api/forma-pago/cliente/<id_noofit>      lista (activa + canceladas)
  POST   /api/forma-pago                          crea nueva (cierra anterior si activa)
  POST   /api/forma-pago/<id>/cancel              cancela la activa sin reemplazo
"""
import datetime as dt
import logging
from flask import Blueprint, request, jsonify, g

from ..auth import auth_required
from ..db import get_conn
from ..audit_log import log_action, actor_from_request

bp = Blueprint('forma_pago', __name__)
log = logging.getLogger(__name__)

FORMAS_VALIDAS = {'sepa', 'tarjeta_token', 'efectivo', 'enlace_pago'}


def _serialize(row):
    """Convierte tipos no-JSON a algo serializable."""
    return row


@bp.route('/cliente/<id_noofit>', methods=['GET'])
@auth_required
def list_by_cliente(id_noofit):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT id, cliente_idnoofit, forma_pago, iban, iban_titular, bic,
                   mandate_ref, card_token, card_brand, card_last4,
                   estado, fecha_inicio, fecha_fin, motivo_cambio,
                   created_at, updated_at, created_by, updated_by
              FROM forma_pago_cliente
             WHERE id_manager = %s AND cliente_idnoofit = %s
             ORDER BY estado ASC, fecha_inicio DESC
        """, (str(g.id_manager), str(id_noofit)))
        rows = cur.fetchall()
    return jsonify({'ok': True, 'formas_pago': rows})


@bp.route('', methods=['POST'])
@bp.route('/', methods=['POST'])
@auth_required
def create_forma_pago():
    """Crea nueva forma de pago. Si hay una activa, la cierra primero.
    body = {
      cliente_idnoofit, forma_pago,
      iban?, iban_titular?, bic?, mandate_ref?,
      card_token?, card_brand?, card_last4?,
      fecha_inicio?, motivo_cambio?
    }
    """
    d = request.get_json() or {}
    cli = (d.get('cliente_idnoofit') or '').strip()
    forma = d.get('forma_pago')
    if not cli:
        return jsonify({'ok': False, 'error': 'cliente_idnoofit_required'}), 400
    if forma not in FORMAS_VALIDAS:
        return jsonify({'ok': False, 'error': f'forma_pago_invalid (acepta: {sorted(FORMAS_VALIDAS)})'}), 400

    fecha_inicio = d.get('fecha_inicio') or dt.date.today().isoformat()
    actor = actor_from_request()
    actor_label = actor.get('label') or actor.get('email') or 'API'

    with get_conn() as conn, conn.cursor() as cur:
        # 1) Cerrar la activa actual (si existe)
        cur.execute("""
            UPDATE forma_pago_cliente
               SET estado='cancelada', fecha_fin=%s, updated_by=%s
             WHERE id_manager=%s AND cliente_idnoofit=%s AND estado='activa'
            RETURNING id
        """, (fecha_inicio, actor_label, str(g.id_manager), cli))
        cerrada = cur.fetchone()
        # 2) Crear nueva activa
        cur.execute("""
            INSERT INTO forma_pago_cliente
              (id_manager, cliente_idnoofit, forma_pago,
               iban, iban_titular, bic, mandate_ref,
               card_token, card_brand, card_last4,
               fecha_inicio, motivo_cambio, created_by, updated_by)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
        """, (
            str(g.id_manager), cli, forma,
            d.get('iban'), d.get('iban_titular'), d.get('bic'), d.get('mandate_ref'),
            d.get('card_token'), d.get('card_brand'), d.get('card_last4'),
            fecha_inicio, d.get('motivo_cambio'),
            actor_label, actor_label,
        ))
        new_id = cur.fetchone()['id']

    log_action(actor, entidad='forma_pago_cliente', entidad_id=new_id,
               accion='replace' if cerrada else 'create',
               resumen=f"Cliente {cli} → {forma}" + (f' (cierra previo {cerrada["id"]})' if cerrada else ''))
    return jsonify({'ok': True, 'id': new_id, 'cerrada_id': cerrada['id'] if cerrada else None})


@bp.route('/<int:fid>/cancel', methods=['POST'])
@auth_required
def cancel_forma_pago(fid):
    """Cancela la forma de pago sin reemplazo. El cliente queda sin forma activa."""
    d = request.get_json() or {}
    fecha = d.get('fecha_fin') or dt.date.today().isoformat()
    actor = actor_from_request()
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE forma_pago_cliente
               SET estado='cancelada', fecha_fin=%s, motivo_cambio=%s, updated_by=%s
             WHERE id_manager=%s AND id=%s AND estado='activa'
            RETURNING id, cliente_idnoofit
        """, (fecha, d.get('motivo') or 'Cancelación manual',
              actor.get('label') or actor.get('email'), str(g.id_manager), fid))
        row = cur.fetchone()
    if not row:
        return jsonify({'ok': False, 'error': 'not_found_or_already_cancelled'}), 404
    log_action(actor, entidad='forma_pago_cliente', entidad_id=fid, accion='cancel')
    return jsonify({'ok': True})
