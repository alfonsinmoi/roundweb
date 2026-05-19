"""Endpoints REST para el sistema de notificaciones.

  GET    /api/notif/catalog                    → secciones + tipos (fijo)
  GET    /api/notif/envios                     → lista envíos del manager/trainer
  POST   /api/notif/envios                     → crear envío (manual)
  GET    /api/notif/envios/<id>                → detalle + destinatarios + leídos
  DELETE /api/notif/envios/<id>                → cancelar envío programado
  GET    /api/notif/cliente/<id_noofit>        → notificaciones del cliente (vista app/perfil)

  GET    /api/notif/config                     → config (manager/trainer)
  PUT    /api/notif/config                     → guardar config

  PUT    /api/notif/<envio_id>/leida           → app marca como leída (público con token)
"""
import logging
from flask import Blueprint, request, jsonify, g
from ..auth import auth_required
from ..db import get_conn
from .. import notif_catalog as cat
from ..notif_sender import enviar_notificacion, marcar_leida

bp = Blueprint('notif', __name__)
log = logging.getLogger(__name__)


# ── Catálogo (público con auth) ────────────────────────────────────────────
@bp.route('/catalog', methods=['GET'])
@auth_required
def catalog():
    return jsonify({
        'ok': True,
        'secciones': cat.SECCIONES,
        'tipos': cat.TIPOS,
    })


# ── Listar envíos ──────────────────────────────────────────────────────────
@bp.route('/envios', methods=['GET'])
@auth_required
def list_envios():
    """Lista envíos del manager (filtra por trainer si está impersonando).

    Query params:
      seccion, tipo, estado, programados, desde, hasta, limit (default 500)
      desde/hasta: ISO datetime; default desde = NOW() - 30 days, hasta = NOW().
    """
    try:
        q_seccion = request.args.get('seccion')
        q_tipo    = request.args.get('tipo')
        q_estado  = request.args.get('estado')
        q_programados = request.args.get('programados') in ('1','true','yes')
        q_desde   = request.args.get('desde')   # ISO o vacío
        q_hasta   = request.args.get('hasta')
        q_limit   = int(request.args.get('limit', 500))

        wheres = ['id_manager = %s']
        params = [g.id_manager]
        if g.id_trainer:
            wheres.append('id_trainer = %s')
            params.append(g.id_trainer)
        if q_seccion:
            wheres.append('seccion = %s'); params.append(q_seccion)
        if q_tipo:
            wheres.append('tipo = %s'); params.append(q_tipo)
        if q_estado:
            wheres.append('estado = %s'); params.append(q_estado)
        if q_programados:
            wheres.append('programada_at IS NOT NULL')
        # Rango de fechas — default últimos 30 días si no llega 'desde'
        if q_desde:
            wheres.append('COALESCE(fecha_envio, created_at) >= %s'); params.append(q_desde)
        else:
            wheres.append("COALESCE(fecha_envio, created_at) >= NOW() - INTERVAL '30 days'")
        if q_hasta:
            wheres.append('COALESCE(fecha_envio, created_at) <= %s'); params.append(q_hasta)

        sql = f"""
            SELECT e.id, e.seccion, e.tipo, e.scope, e.scope_ref,
                   e.titulo, e.cuerpo, e.cuerpo_html, e.url,
                   e.programada_at, e.fecha_envio, e.fecha_desaparicion,
                   e.estado, e.onesignal_id, e.error,
                   e.origen, e.origen_ref, e.total_destinatarios,
                   e.id_trainer, e.created_by, e.created_at,
                   COALESCE((SELECT COUNT(*) FROM notif_destinatario d WHERE d.envio_id=e.id AND d.leida), 0) AS total_leidas
              FROM notif_envio e
             WHERE {' AND '.join(wheres)}
             ORDER BY COALESCE(fecha_envio, created_at) DESC
             LIMIT %s
        """
        params.append(q_limit)
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute(sql, params)
            envios = cur.fetchall()
        return jsonify({'ok': True, 'envios': envios})
    except Exception as e:
        log.exception('list_envios')
        return jsonify({'ok': False, 'error': str(e)}), 500


# ── Crear envío manual ─────────────────────────────────────────────────────
@bp.route('/envios', methods=['POST'])
@auth_required
def create_envio():
    """Crear envío manual.
    Body:
      { seccion, tipo,
        titulo?, cuerpo?, cuerpo_html?, url?,
        audience: {tipo:'cliente'|'lista'|'cluster'|'broadcast', ref|clientes},
        plantilla_vars?, fecha_desaparicion?, programada_at? }
    """
    try:
        d = request.get_json() or {}
        # Solo manager o trainer impersonando puede mandar
        result = enviar_notificacion(
            id_manager=g.id_manager,
            id_trainer=g.id_trainer,
            seccion=d.get('seccion'),
            tipo=d.get('tipo'),
            titulo=d.get('titulo'),
            cuerpo=d.get('cuerpo'),
            cuerpo_html=d.get('cuerpo_html'),
            url=d.get('url'),
            audience=d.get('audience'),
            plantilla_vars=d.get('plantilla_vars'),
            fecha_desaparicion=d.get('fecha_desaparicion'),
            programada_at=d.get('programada_at'),
            origen=d.get('origen', 'manual'),
            origen_ref=d.get('origen_ref'),
            created_by=getattr(g, 'created_by', None) or d.get('created_by'),
            send_now=bool(d.get('send_now', True)),
        )
        if not result.get('ok'):
            return jsonify(result), 400
        return jsonify(result)
    except Exception as e:
        log.exception('create_envio')
        return jsonify({'ok': False, 'error': str(e)}), 500


# ── Detalle envío + destinatarios ──────────────────────────────────────────
@bp.route('/envios/<int:envio_id>', methods=['GET'])
@auth_required
def get_envio(envio_id):
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT * FROM notif_envio
                 WHERE id = %s AND id_manager = %s
            """, (envio_id, g.id_manager))
            envio = cur.fetchone()
            if not envio:
                return jsonify({'ok': False, 'error': 'no_encontrado'}), 404
            # Si trainer, restringir
            if g.id_trainer and envio.get('id_trainer') and str(envio['id_trainer']) != str(g.id_trainer):
                return jsonify({'ok': False, 'error': 'forbidden'}), 403
            cur.execute("""
                SELECT id, cliente_idnoofit, leida, fecha_lectura, created_at
                  FROM notif_destinatario
                 WHERE envio_id = %s
                 ORDER BY created_at
            """, (envio_id,))
            dests = cur.fetchall()
        return jsonify({'ok': True, 'envio': envio, 'destinatarios': dests})
    except Exception as e:
        log.exception('get_envio')
        return jsonify({'ok': False, 'error': str(e)}), 500


# ── Cancelar envío programado ──────────────────────────────────────────────
@bp.route('/envios/<int:envio_id>', methods=['DELETE'])
@auth_required
def cancel_envio(envio_id):
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                UPDATE notif_envio
                   SET estado = 'cancelada'
                 WHERE id = %s AND id_manager = %s AND estado = 'pendiente'
                RETURNING id, onesignal_id
            """, (envio_id, g.id_manager))
            row = cur.fetchone()
        if not row:
            return jsonify({'ok': False, 'error': 'no_pendiente_o_no_encontrado'}), 404
        # Si tenía onesignal_id (programado en OneSignal con send_after), cancelar allí también
        # (futuro: ahora no usamos send_after, todo se manda inmediatamente)
        return jsonify({'ok': True, 'cancelled': True})
    except Exception as e:
        log.exception('cancel_envio')
        return jsonify({'ok': False, 'error': str(e)}), 500


# ── Notificaciones de un cliente (vista perfil + app) ──────────────────────
@bp.route('/cliente/<id_noofit>', methods=['GET'])
@auth_required
def list_por_cliente(id_noofit):
    """Devuelve los envíos que recibió ese cliente, joineado con metadata."""
    try:
        q_seccion = request.args.get('seccion')
        q_tipo    = request.args.get('tipo')
        q_solo_no_leidas = request.args.get('solo_no_leidas') in ('1','true','yes')
        q_limit   = int(request.args.get('limit', 100))

        wheres = ['d.id_manager = %s', 'd.cliente_idnoofit = %s']
        params = [g.id_manager, str(id_noofit)]
        if q_seccion:
            wheres.append('e.seccion = %s'); params.append(q_seccion)
        if q_tipo:
            wheres.append('e.tipo = %s'); params.append(q_tipo)
        if q_solo_no_leidas:
            wheres.append('d.leida = FALSE')

        sql = f"""
            SELECT d.id AS destinatario_id, d.envio_id,
                   d.leida, d.fecha_lectura,
                   e.seccion, e.tipo, e.titulo, e.cuerpo, e.cuerpo_html, e.url,
                   e.fecha_envio, e.fecha_desaparicion, e.origen, e.origen_ref,
                   e.created_at
              FROM notif_destinatario d
              JOIN notif_envio e ON e.id = d.envio_id
             WHERE {' AND '.join(wheres)}
             ORDER BY e.fecha_envio DESC NULLS LAST, e.created_at DESC
             LIMIT %s
        """
        params.append(q_limit)
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()
        return jsonify({'ok': True, 'notificaciones': rows})
    except Exception as e:
        log.exception('list_por_cliente')
        return jsonify({'ok': False, 'error': str(e)}), 500


# ── Configuración por (manager,trainer) ────────────────────────────────────
@bp.route('/config', methods=['GET'])
@auth_required
def get_config():
    """Devuelve la config del trainer actual (o manager-wide si no impersona).
    Si no existe, devuelve defaults sin crear fila aún."""
    try:
        with get_conn() as conn, conn.cursor() as cur:
            if g.id_trainer:
                cur.execute("""
                    SELECT * FROM notif_config
                     WHERE id_manager=%s AND id_trainer=%s
                """, (g.id_manager, g.id_trainer))
            else:
                cur.execute("""
                    SELECT * FROM notif_config
                     WHERE id_manager=%s AND id_trainer IS NULL
                """, (g.id_manager,))
            row = cur.fetchone()
        if not row:
            row = {
                'id_manager': g.id_manager,
                'id_trainer': g.id_trainer,
                'dia_envio_impago_efectivo': 5,
                'auto_impago_efectivo': True,
                'auto_devolucion': True,
                'auto_enlace_pago': True,
                'auto_pago_alta': True,
                'auto_link_devolucion': True,
                'auto_link_impago_efectivo': True,
                'auto_link_efectivo_dia': 0,
                'plantillas': {},
                '_default': True,
            }
        return jsonify({'ok': True, 'config': row})
    except Exception as e:
        log.exception('get_config')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/config', methods=['PUT'])
@auth_required
def put_config():
    try:
        d = request.get_json() or {}
        dia = int(d.get('dia_envio_impago_efectivo', 5))
        if dia < 0 or dia > 31:
            return jsonify({'ok': False, 'error': 'dia_invalido'}), 400
        dia_link = int(d.get('auto_link_efectivo_dia', 0))
        if dia_link < 0 or dia_link > 31:
            return jsonify({'ok': False, 'error': 'dia_link_invalido'}), 400
        plantillas = d.get('plantillas') or {}
        if not isinstance(plantillas, dict):
            return jsonify({'ok': False, 'error': 'plantillas_invalido'}), 400
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                INSERT INTO notif_config (
                    id_manager, id_trainer,
                    dia_envio_impago_efectivo,
                    auto_impago_efectivo, auto_devolucion,
                    auto_enlace_pago, auto_pago_alta,
                    auto_link_devolucion, auto_link_impago_efectivo,
                    auto_link_efectivo_dia,
                    plantillas
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb)
                ON CONFLICT (id_manager, id_trainer) DO UPDATE SET
                    dia_envio_impago_efectivo = EXCLUDED.dia_envio_impago_efectivo,
                    auto_impago_efectivo = EXCLUDED.auto_impago_efectivo,
                    auto_devolucion = EXCLUDED.auto_devolucion,
                    auto_enlace_pago = EXCLUDED.auto_enlace_pago,
                    auto_pago_alta = EXCLUDED.auto_pago_alta,
                    auto_link_devolucion = EXCLUDED.auto_link_devolucion,
                    auto_link_impago_efectivo = EXCLUDED.auto_link_impago_efectivo,
                    auto_link_efectivo_dia = EXCLUDED.auto_link_efectivo_dia,
                    plantillas = EXCLUDED.plantillas
                RETURNING *
            """, (
                g.id_manager, g.id_trainer or None,
                dia,
                bool(d.get('auto_impago_efectivo', True)),
                bool(d.get('auto_devolucion', True)),
                bool(d.get('auto_enlace_pago', True)),
                bool(d.get('auto_pago_alta', True)),
                bool(d.get('auto_link_devolucion', True)),
                bool(d.get('auto_link_impago_efectivo', True)),
                dia_link,
                __import__('json').dumps(plantillas),
            ))
            row = cur.fetchone()
        return jsonify({'ok': True, 'config': row})
    except Exception as e:
        log.exception('put_config')
        return jsonify({'ok': False, 'error': str(e)}), 500


# ── Marcar leída (endpoint público con token básico) ───────────────────────
# La app mynoofit llama a esto cuando el usuario abre/lee la notif.
# Usa el mismo X-Round-Token + id_cliente en query/body para identificar.
@bp.route('/<int:envio_id>/leida', methods=['PUT'])
def public_marcar_leida(envio_id):
    """Marca como leída. Espera ?cliente=<id_noofit> + token (header o query).

    No usa @auth_required clásico porque la app mynoofit no tiene sesión
    Round; lo identificamos con el cliente_idnoofit + un token de servicio
    compartido (mismo X-Round-Token que ya usamos para todo).
    """
    from .. import config as cfg
    token = request.headers.get('X-Round-Token') or request.args.get('token') or ''
    if token != cfg.API_TOKEN:
        return jsonify({'ok': False, 'error': 'invalid_token'}), 401
    cliente = request.args.get('cliente') or (request.get_json(silent=True) or {}).get('cliente')
    if not cliente:
        return jsonify({'ok': False, 'error': 'cliente_required'}), 400
    return jsonify(marcar_leida(envio_id, cliente))
