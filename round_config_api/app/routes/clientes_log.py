"""Endpoints de tracking de cambios de estado de cliente (activo↔archivado)
y sincronización NoofitPro → Odoo de datos del cliente.

  GET  /api/clientes/estado-log                  → últimas 90 días de eventos
  GET  /api/clientes/estado-log/<cliente_id>     → historial de un cliente
  POST /api/clientes/estado-log/sincronizar      → fuerza ejecución del cron (manager-only)
  POST /api/clientes/<id_noofit>/sync-odoo       → upsert partner Odoo desde NoofitPro
"""
import logging
from flask import Blueprint, request, jsonify, g
from ..auth import auth_required, require_permission
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
@require_permission('clientes.historial_estado.forzar_sync')
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

        # Fallback NoofitPro / cliente_cache si no tenemos primera alta en log.
        # Orden de prioridad:
        #   1) cliente_cache.raw_data.dtCreated (timestamp millis epoch de NF)
        #   2) cliente_cache.raw_data.editionDate (texto ISO)
        #   3) cliente_cache.synced_at (cuándo lo vimos por primera vez en
        #      nuestra cache; aproximación razonable si NF no nos dio dato)
        #   4) nc.get_clientes() — último recurso (solo ve clientes del .env)
        fecha_creacion_noofit = None
        if not fecha_primera_alta:
            try:
                with get_conn() as conn, conn.cursor() as cur:
                    cur.execute("""
                        SELECT raw_data, synced_at FROM cliente_cache
                         WHERE id_manager=%s AND id=%s
                    """, (str(g.id_manager), cliente_id))
                    cache_row = cur.fetchone()
                if cache_row:
                    import datetime as _dt
                    raw = cache_row['raw_data'] or {}
                    if isinstance(raw, str):
                        import json as _json
                        try: raw = _json.loads(raw)
                        except: raw = {}
                    dt_ms = raw.get('dtCreated')
                    edition = raw.get('editionDate')
                    if dt_ms:
                        # NF guarda timestamps en milisegundos epoch
                        try:
                            fecha_creacion_noofit = _dt.datetime.utcfromtimestamp(
                                int(dt_ms) / 1000).isoformat() + 'Z'
                        except Exception:
                            pass
                    elif edition and isinstance(edition, str):
                        fecha_creacion_noofit = edition
                    elif cache_row.get('synced_at'):
                        fecha_creacion_noofit = cache_row['synced_at'].isoformat()
                    if fecha_creacion_noofit:
                        fecha_primera_alta = fecha_creacion_noofit
                        # Si tampoco había alta_actual, usar el mismo valor
                        if not fecha_alta_actual:
                            fecha_alta_actual = fecha_creacion_noofit
            except Exception:
                pass
            # Último fallback: live (solo manager .env)
            if not fecha_primera_alta:
                try:
                    clis = nc.get_clientes() or []
                    cli = next((c for c in clis if c.get('id') == cliente_id), None)
                    if cli:
                        fecha_creacion_noofit = cli.get('fechaCreacion') or cli.get('createdAt')
                        if fecha_creacion_noofit:
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


@bp.route('/descuentos-auto/recalcular', methods=['POST'])
@auth_required
@require_permission('clientes.historial_estado.recalcular_descuentos')
def recalcular_descuentos_auto_endpoint():
    """Recalcula manualmente los descuentos automáticos (varias_cuotas +
    familiares) del manager actual. Útil para refrescar inmediatamente tras
    cambiar una cuota / asignar a familia / etc. sin esperar al cron diario.
    """
    if g.id_trainer:
        return jsonify({'ok': False, 'error': 'manager_only'}), 403
    try:
        from ..cron_descuentos_auto import recalcular_descuentos_auto
        stats = recalcular_descuentos_auto(g.id_manager)
        return jsonify({'ok': True, **stats})
    except Exception as e:
        log.exception('recalcular descuentos_auto')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/<int:cliente_id>/trazabilidad', methods=['GET'])
@auth_required
def trazabilidad_cliente(cliente_id):
    """Devuelve el historial completo del cliente para auditoría:
       - cliente_estado_log: altas/bajas detectadas por el cron diario
       - cliente_baja_programada: bajas planificadas + ejecutadas
       - audit_log: cambios manuales (cuotas, descuentos, modificaciones...)
       Todo ordenado cronológicamente. Cada evento incluye `ts`, `tipo`,
       `descripcion`, `por` (actor)."""
    eventos = []
    tiene_alta_log = False  # ¿hay evento 'activo' real en cliente_estado_log?
    primer_archivado_ts = None  # cota superior para la "alta inferida"
    try:
        with get_conn() as conn, conn.cursor() as cur:
            # 1) Estado log (altas/bajas detectadas por cron)
            cur.execute("""
                SELECT estado_nuevo, estado_anterior, detected_at, motivo_archivado
                  FROM cliente_estado_log
                 WHERE id_manager=%s AND cliente_id=%s
                 ORDER BY detected_at DESC
            """, (str(g.id_manager), cliente_id))
            for r in cur.fetchall():
                if r['estado_nuevo'] == 'activo':
                    tiene_alta_log = True
                elif r['estado_nuevo'] == 'archivado':
                    # Quedarnos con el archivado MÁS ANTIGUO como cota: si
                    # vamos a inferir un "alta" sintético, no puede ser
                    # posterior al primer archivado conocido.
                    ts_r = r['detected_at']
                    if primer_archivado_ts is None or ts_r < primer_archivado_ts:
                        primer_archivado_ts = ts_r
                if r['estado_nuevo'] == 'activo':
                    desc = ('Alta inicial' if r['estado_anterior'] is None
                            else 'Reactivado' if r['estado_anterior'] == 'archivado'
                            else f'Cambio estado: {r["estado_anterior"]} → activo')
                else:
                    desc = 'Archivado'
                    if r.get('motivo_archivado'):
                        desc += f' (motivo: {r["motivo_archivado"]})'
                eventos.append({
                    'ts': r['detected_at'].isoformat(),
                    'tipo': 'estado',
                    'estado': r['estado_nuevo'],
                    'descripcion': desc,
                    'por': 'cron (detectado automáticamente)',
                })
            # 2) Baja programada
            cur.execute("""
                SELECT id, fecha_baja, motivo, creada_por_email, creada_at,
                       ejecutada_at, ejecutada_error
                  FROM cliente_baja_programada
                 WHERE id_manager=%s AND cliente_idnoofit=%s
                 ORDER BY creada_at DESC
            """, (str(g.id_manager), str(cliente_id)))
            for r in cur.fetchall():
                eventos.append({
                    'ts': r['creada_at'].isoformat(),
                    'tipo': 'baja_programada',
                    'descripcion': (f'Baja programada para el '
                                    f'{r["fecha_baja"].strftime("%d/%m/%Y")}'
                                    + (f' — motivo: {r["motivo"]}' if r.get('motivo') else '')),
                    'por': r.get('creada_por_email') or 'API',
                })
                if r.get('ejecutada_at'):
                    eventos.append({
                        'ts': r['ejecutada_at'].isoformat(),
                        'tipo': 'baja_programada_ejecutada',
                        'descripcion': ('Baja programada ejecutada'
                                        + (f' — ERROR: {r["ejecutada_error"]}'
                                           if r.get('ejecutada_error') else '')),
                        'por': 'cron round_baja_programada',
                    })
            # 3) Audit log (acciones manuales). La tabla se llama `accion_log`
            # (no audit_log). Filtramos por entidad_id = idnoofit como string.
            cur.execute("""
                SELECT ts, actor_kind, actor_email, actor_label, entidad,
                       entidad_id, accion, resumen, cambios
                  FROM accion_log
                 WHERE entidad_id = %s
                   AND (id_manager IS NULL OR id_manager = %s)
                 ORDER BY ts DESC
                 LIMIT 200
            """, (str(cliente_id), str(g.id_manager)))
            for r in cur.fetchall():
                eventos.append({
                    'ts': r['ts'].isoformat(),
                    'tipo': f'manual:{r["entidad"]}:{r["accion"]}',
                    'descripcion': r.get('resumen') or f'{r["entidad"]} {r["accion"]}',
                    'por': (r.get('actor_label') or r.get('actor_email')
                            or r.get('actor_kind') or 'API'),
                })

            # 4) Sintético: si no hay ningún evento 'activo' en estado_log
            # (cliente recién creado, cron diario no ha pasado todavía), añadir
            # un evento de alta inferido desde cliente_cache. Así la
            # trazabilidad nunca sale vacía para un cliente real.
            if not tiene_alta_log:
                cur.execute("""
                    SELECT raw_data, synced_at FROM cliente_cache
                     WHERE id_manager=%s AND id=%s
                """, (str(g.id_manager), cliente_id))
                cache_row = cur.fetchone()
                if cache_row:
                    import datetime as _dt
                    import json as _json
                    raw = cache_row['raw_data'] or {}
                    if isinstance(raw, str):
                        try: raw = _json.loads(raw)
                        except Exception: raw = {}
                    # Prioridad: dtCreated NF (millis epoch) → editionDate → synced_at
                    ts_iso = None
                    fuente = None
                    dt_ms = raw.get('dtCreated')
                    if dt_ms:
                        try:
                            ts_iso = (_dt.datetime.utcfromtimestamp(int(dt_ms)/1000)
                                      .isoformat() + 'Z')
                            fuente = 'fecha de creación NoofitPro'
                        except Exception:
                            pass
                    if not ts_iso and raw.get('editionDate'):
                        ts_iso = str(raw['editionDate'])
                        fuente = 'editionDate NoofitPro'
                    if not ts_iso and cache_row.get('synced_at'):
                        ts_iso = cache_row['synced_at'].isoformat()
                        fuente = 'primera sincronización en Round'
                    # Si hay un archivado conocido, el ts del "alta" inferido
                    # NO puede ser posterior — usamos el archivado-1ms como
                    # cota superior. Si pasa eso, marcamos como "anterior".
                    desc_alta = 'Alta inicial (inferida)'
                    if ts_iso and primer_archivado_ts is not None:
                        try:
                            ts_alta_dt = _dt.datetime.fromisoformat(
                                ts_iso.replace('Z', '+00:00'))
                            # Normalizar a UTC para comparar
                            if ts_alta_dt.tzinfo is None:
                                ts_alta_dt = ts_alta_dt.replace(tzinfo=_dt.timezone.utc)
                            arch_dt = primer_archivado_ts
                            if arch_dt.tzinfo is None:
                                arch_dt = arch_dt.replace(tzinfo=_dt.timezone.utc)
                            if ts_alta_dt >= arch_dt:
                                # El "alta" inferido es ≥ archivado → imposible
                                # cronológicamente. Lo retrocedemos a un segundo
                                # antes del archivado y avisamos en la descripción.
                                ts_iso = (arch_dt - _dt.timedelta(seconds=1)).isoformat()
                                desc_alta = (f'Alta inicial (fecha real desconocida, '
                                             f'anterior al {arch_dt.strftime("%d/%m/%Y")})')
                                fuente = 'inferida por cota del primer archivado'
                        except Exception:
                            pass
                    if ts_iso:
                        eventos.append({
                            'ts': ts_iso,
                            'tipo': 'estado',
                            'estado': 'activo',
                            'descripcion': desc_alta,
                            'por': f'sistema · {fuente}',
                        })
        # Orden cronológico descendente
        eventos.sort(key=lambda e: e['ts'], reverse=True)
        return jsonify({'ok': True, 'eventos': eventos})
    except Exception as e:
        log.exception(f'trazabilidad_cliente {cliente_id}')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/<int:id_noofit>/sync-odoo', methods=['POST'])
@auth_required
@require_permission('clientes.modificar_datos_erp')
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
        partner_id = get_alta(g.id_manager).upsert_partner(datos)
        return jsonify({
            'ok': True, 'partner_id': partner_id,
            'sincronizado': {'email': datos['email'], 'movil': datos['movil'],
                             'dni': datos['dni']},
        })
    except Exception as e:
        log.exception(f'sync-odoo {id_noofit}')
        return jsonify({'ok': False, 'error': str(e)}), 500
