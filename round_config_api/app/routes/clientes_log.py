"""Endpoints de tracking de cambios de estado de cliente (activo↔archivado)
y sincronización NoofitPro → Odoo de datos del cliente.

  GET  /api/clientes/estado-log                  → últimas 90 días de eventos
  GET  /api/clientes/estado-log/<cliente_id>     → historial de un cliente
  POST /api/clientes/estado-log/sincronizar      → fuerza ejecución del cron (manager-only)
  POST /api/clientes/<id_noofit>/sync-odoo       → upsert partner Odoo desde NoofitPro
"""
import logging
from flask import Blueprint, request, jsonify, g
from ..auth import auth_required
from ..db import get_conn
from .. import noofit_client as nc
from ..odoo_alta import get_alta

bp = Blueprint('clientes_log', __name__)
log = logging.getLogger(__name__)


@bp.route('/estado-log', methods=['GET'])
@auth_required
def listar_eventos():
    """Devuelve eventos del manager (limitado a últimos 90 días por defecto).

    Query params:
      ?dias=90        ventana en días
      ?solo_baja=1    solo cambios a 'archivado'
      ?cliente_ids=1,2,3  filtra por una lista de IDs (batch lookup)
    Devuelve además un mapa { cliente_id: fecha_baja_iso } útil para UI.
    """
    try:
        dias = int(request.args.get('dias', 90))
        solo_baja = request.args.get('solo_baja') in ('1','true','yes')
        ids_param = request.args.get('cliente_ids') or ''
        cliente_ids = []
        if ids_param:
            for x in ids_param.split(','):
                try: cliente_ids.append(int(x.strip()))
                except: pass

        with get_conn() as conn, conn.cursor() as cur:
            sql = """SELECT id, cliente_id, cliente_nombre, estado_nuevo,
                            estado_anterior, motivo_archivado, detected_at
                       FROM cliente_estado_log
                      WHERE id_manager=%s
                        AND detected_at >= NOW() - INTERVAL '%s days'"""
            params = [g.id_manager, dias]
            if solo_baja:
                sql += " AND estado_nuevo='archivado'"
            if cliente_ids:
                sql += f" AND cliente_id = ANY(%s)"
                params.append(cliente_ids)
            sql += " ORDER BY detected_at DESC"
            cur.execute(sql, params)
            eventos = cur.fetchall() or []

            # Mapa cliente_id → fecha última baja (último archivado registrado)
            cur.execute("""SELECT DISTINCT ON (cliente_id) cliente_id, detected_at
                             FROM cliente_estado_log
                            WHERE id_manager=%s
                              AND estado_nuevo='archivado'
                            ORDER BY cliente_id, detected_at DESC""",
                        (g.id_manager,))
            fecha_baja_map = {r['cliente_id']: r['detected_at'].isoformat()
                              for r in (cur.fetchall() or [])}

        return jsonify({
            'ok': True,
            'eventos': eventos,
            'fecha_baja_por_cliente': fecha_baja_map,
        })
    except Exception as e:
        log.exception('listar_eventos cliente_estado_log')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/estado-log/<int:cliente_id>', methods=['GET'])
@auth_required
def historial_cliente(cliente_id):
    """Historial completo de cambios de estado de un cliente."""
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""SELECT id, cliente_id, cliente_nombre, estado_nuevo,
                                  estado_anterior, motivo_archivado, detected_at,
                                  id_trainer, notas
                             FROM cliente_estado_log
                            WHERE id_manager=%s AND cliente_id=%s
                            ORDER BY detected_at DESC""",
                        (g.id_manager, cliente_id))
            rows = cur.fetchall() or []
        return jsonify({'ok': True, 'historial': rows})
    except Exception as e:
        log.exception('historial_cliente')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/estado-log/sincronizar', methods=['POST'])
@auth_required
def sincronizar():
    """Fuerza la ejecución del cron (útil para tests / primer arranque)."""
    if g.id_trainer:
        return jsonify({'ok': False, 'error': 'manager_only'}), 403
    try:
        from ..cron_cliente_log import sincronizar_log
        return jsonify(sincronizar_log(g.id_manager))
    except Exception as e:
        log.exception('sincronizar manual')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/<int:cliente_id>/fechas', methods=['GET'])
@auth_required
def fechas_cliente(cliente_id):
    """Devuelve las fechas clave de un cliente.

    Reglas (derivadas de cliente_estado_log):
      - fecha_primera_alta: detected_at del PRIMER evento donde el cliente
        fue visto como 'activo' (o NoofitPro fechaCreacion como fallback).
      - fecha_alta_actual: detected_at del último evento 'activo' (la
        última reactivación). Igual a primera_alta si nunca pasó a inactivo.
      - fecha_inactivo: detected_at del último evento 'archivado' SI el
        cliente está actualmente inactivo (su último estado es archivado).
        NULL si está activo.
    """
    try:
        with get_conn() as conn, conn.cursor() as cur:
            # Estado actual: el más reciente
            cur.execute("""
                SELECT estado_nuevo, detected_at
                  FROM cliente_estado_log
                 WHERE id_manager=%s AND cliente_id=%s
                 ORDER BY detected_at DESC LIMIT 1
            """, (g.id_manager, cliente_id))
            ult = cur.fetchone()
            estado_actual = ult['estado_nuevo'] if ult else None

            # Primera vez visto como 'activo'
            cur.execute("""
                SELECT detected_at FROM cliente_estado_log
                 WHERE id_manager=%s AND cliente_id=%s AND estado_nuevo='activo'
                 ORDER BY detected_at ASC LIMIT 1
            """, (g.id_manager, cliente_id))
            primera_act = cur.fetchone()
            fecha_primera_alta = primera_act['detected_at'].isoformat() if primera_act else None

            # Última vez que pasó a activo
            cur.execute("""
                SELECT detected_at FROM cliente_estado_log
                 WHERE id_manager=%s AND cliente_id=%s AND estado_nuevo='activo'
                 ORDER BY detected_at DESC LIMIT 1
            """, (g.id_manager, cliente_id))
            ult_act = cur.fetchone()
            fecha_alta_actual = ult_act['detected_at'].isoformat() if ult_act else None

            # Último archivado solo si actualmente inactivo
            fecha_inactivo = None
            if estado_actual == 'archivado':
                cur.execute("""
                    SELECT detected_at FROM cliente_estado_log
                     WHERE id_manager=%s AND cliente_id=%s AND estado_nuevo='archivado'
                     ORDER BY detected_at DESC LIMIT 1
                """, (g.id_manager, cliente_id))
                ult_arc = cur.fetchone()
                fecha_inactivo = ult_arc['detected_at'].isoformat() if ult_arc else None

        # Fallback NoofitPro fechaCreacion si no tenemos primera alta en log
        fecha_creacion_noofit = None
        if not fecha_primera_alta:
            try:
                clis = nc.get_clientes() or []
                cli = next((c for c in clis if c.get('id') == cliente_id), None)
                if cli:
                    fecha_creacion_noofit = cli.get('fechaCreacion') or cli.get('createdAt')
                    if not fecha_primera_alta and fecha_creacion_noofit:
                        fecha_primera_alta = fecha_creacion_noofit
            except Exception:
                pass

        return jsonify({
            'ok': True,
            'cliente_id': cliente_id,
            'estado_actual': estado_actual,           # 'activo' | 'archivado' | None
            'fecha_primera_alta': fecha_primera_alta,
            'fecha_alta_actual': fecha_alta_actual,
            'fecha_inactivo': fecha_inactivo,         # NULL si está activo
            'fecha_creacion_noofit': fecha_creacion_noofit,
        })
    except Exception as e:
        log.exception(f'fechas_cliente {cliente_id}')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/<int:id_noofit>/sync-odoo', methods=['POST'])
@auth_required
def sync_odoo(id_noofit):
    """Lee los datos actuales del cliente desde NoofitPro y actualiza el
    partner correspondiente en Odoo (upsert por id_noofit/DNI/email).

    Útil tras editar un cliente desde la UI para que Odoo refleje los
    nuevos datos sin esperar a un cron."""
    try:
        clis = nc.get_clientes() or []
        cli = next((c for c in clis if c.get('id') == id_noofit), None)
        if not cli:
            return jsonify({'ok': False, 'error': 'cliente_no_encontrado'}), 404
        datos = {
            'idnoofit':  str(id_noofit),
            'nombre':    cli.get('name') or '',
            'apellidos': cli.get('surname') or '',
            'email':     cli.get('email') or '',
            'movil':     cli.get('cellPhone') or cli.get('tlf') or '',
            'dni':       cli.get('dni') or '',
            'direccion': cli.get('address') or '',
            'localidad': cli.get('town') or '',
            'cp':        cli.get('postal_code') or '',
            'fecha_nacimiento': cli.get('birthdate') or '',
        }
        partner_id = get_alta().upsert_partner(datos)
        return jsonify({
            'ok': True, 'partner_id': partner_id,
            'sincronizado': {'email': datos['email'], 'movil': datos['movil'],
                             'dni': datos['dni']},
        })
    except Exception as e:
        log.exception(f'sync-odoo {id_noofit}')
        return jsonify({'ok': False, 'error': str(e)}), 500
