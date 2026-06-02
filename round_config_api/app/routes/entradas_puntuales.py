"""Cuotas de ENTRADA PUNTUAL (drop-in / pago por visita).

Modelo:
  - `entrada_puntual_alta`   → registro local: qué clientes están dados de alta
                               en una cuota de entrada puntual, con qué modo
                               (por_entrada / por_mes) y forma de pago.
  - `entrada_puntual_evento` → cada reserva confirmada detectada = una entrada
                               a cobrar (por_entrada, en recepción) o a facturar
                               al cierre de mes (por_mes).

La detección de reservas confirmadas la hace el cron `cron_entradas_puntuales`
(reutilizable vía `detectar_entradas()`), que también se puede disparar a mano
con POST /api/entradas-puntuales/detectar.

Endpoints (auth manager/trainer):
  GET    /api/entradas-puntuales/altas            altas activas (registro)
  POST   /api/entradas-puntuales/altas            crear alta (desde AltaClienteModal)
  DELETE /api/entradas-puntuales/altas/<id>       baja del registro (activo=false)
  GET    /api/entradas-puntuales/pendientes       banner: por_entrada pendientes de cobro
  GET    /api/entradas-puntuales/eventos          listado con filtros
  POST   /api/entradas-puntuales/eventos/<id>/cobrar   cobro en recepción (por_entrada)
  POST   /api/entradas-puntuales/eventos/<id>/anular
  POST   /api/entradas-puntuales/emitir-mes       factura agregada del mes (por_mes)
  POST   /api/entradas-puntuales/detectar         dispara detección a demanda
"""
import logging
from datetime import date
from flask import Blueprint, request, jsonify, g

from ..auth import auth_required, require_permission
from ..db import get_conn
from ..odoo_alta import get_alta
from ..audit_log import actor_from_request, log_action

bp = Blueprint('entradas_puntuales', __name__)
log = logging.getLogger(__name__)

MODOS = ('por_entrada', 'por_mes')
# Formas de pago válidas por modo
FORMAS_POR_ENTRADA = ('efectivo', 'tpv_fisico', 'tarjeta_token')
FORMAS_POR_MES = ('sepa', 'tarjeta_token')


def _f(v):
    return float(v) if v is not None else None


def _alta_to_dict(r):
    out = dict(r)
    out['precio_entrada'] = _f(out.get('precio_entrada'))
    for k in ('created_at', 'fecha_alta'):
        if out.get(k):
            out[k] = out[k].isoformat()
    return out


def _evt_to_dict(r):
    out = dict(r)
    out['precio_entrada'] = _f(out.get('precio_entrada'))
    for k in ('created_at', 'cobrado_at', 'fecha_clase'):
        if out.get(k):
            out[k] = out[k].isoformat()
    return out


# ─── ALTAS (registro) ─────────────────────────────────────────────────────────
@bp.route('/altas', methods=['GET'])
@auth_required
def list_altas():
    solo_activas = request.args.get('activas', '1') != '0'
    sql = "SELECT * FROM entrada_puntual_alta WHERE id_manager=%s"
    params = [str(g.id_manager)]
    if g.id_trainer:
        # Aislamiento estricto: solo el trainer impersonado.
        sql += " AND id_trainer=%s"
        params.append(str(g.id_trainer))
    if solo_activas:
        sql += " AND activo=TRUE"
    sql += " ORDER BY created_at DESC"
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        rows = [_alta_to_dict(r) for r in cur.fetchall()]
    return jsonify({'ok': True, 'altas': rows})


@bp.route('/altas', methods=['POST'])
@auth_required
@require_permission('entradas_puntuales.crear_alta')
def create_alta():
    """Da de alta a un cliente en una cuota de entrada puntual.
    body: {cliente_idnoofit, cliente_nombre, cuota_codigo, actividades_idnoofit,
           modo, forma_pago, precio_entrada, iban?}
    """
    d = request.get_json() or {}
    cliente_idnoofit = str(d.get('cliente_idnoofit') or '').strip()
    cuota_codigo = (d.get('cuota_codigo') or '').strip()
    modo = (d.get('modo') or '').strip()
    forma_pago = (d.get('forma_pago') or '').strip() or None
    if not cliente_idnoofit or not cuota_codigo:
        return jsonify({'ok': False, 'error': 'cliente_y_cuota_obligatorios'}), 400
    if modo not in MODOS:
        return jsonify({'ok': False, 'error': 'modo_invalido'}), 400
    if not forma_pago:
        return jsonify({'ok': False, 'error': 'forma_pago_obligatoria'}), 400
    if modo == 'por_entrada' and forma_pago not in FORMAS_POR_ENTRADA:
        return jsonify({'ok': False, 'error': 'forma_pago_no_valida_por_entrada'}), 400
    if modo == 'por_mes' and forma_pago not in FORMAS_POR_MES:
        return jsonify({'ok': False, 'error': 'forma_pago_no_valida_por_mes'}), 400

    actividades = d.get('actividades_idnoofit') or []
    try:
        actividades = [int(a) for a in actividades]
    except (TypeError, ValueError):
        actividades = []
    precio_entrada = float(d.get('precio_entrada') or 0)

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            INSERT INTO entrada_puntual_alta
              (id_manager, id_trainer, cliente_idnoofit, cliente_nombre,
               cuota_codigo, actividades_idnoofit, modo, forma_pago,
               precio_entrada, iban, activo)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,TRUE)
            ON CONFLICT (id_manager, cliente_idnoofit, cuota_codigo) DO UPDATE
              SET id_trainer=EXCLUDED.id_trainer,
                  cliente_nombre=EXCLUDED.cliente_nombre,
                  actividades_idnoofit=EXCLUDED.actividades_idnoofit,
                  modo=EXCLUDED.modo, forma_pago=EXCLUDED.forma_pago,
                  precio_entrada=EXCLUDED.precio_entrada, iban=EXCLUDED.iban,
                  activo=TRUE
            RETURNING *
        """, (str(g.id_manager), str(g.id_trainer) if g.id_trainer else None,
              cliente_idnoofit, d.get('cliente_nombre'), cuota_codigo,
              actividades, modo, forma_pago, precio_entrada, d.get('iban')))
        row = cur.fetchone()
    log_action(
        actor_from_request(), 'entrada_puntual_alta', 'alta',
        entidad_id=row['id'] if row else None,
        resumen='Alta cliente en cuota de entrada puntual',
        cambios={'cliente_idnoofit': cliente_idnoofit, 'cuota_codigo': cuota_codigo,
                 'modo': modo, 'forma_pago': forma_pago, 'precio_entrada': precio_entrada},
    )
    return jsonify({'ok': True, 'alta': _alta_to_dict(row)}), 201


@bp.route('/altas/<int:alta_id>', methods=['DELETE'])
@auth_required
@require_permission('entradas_puntuales.borrar_alta')
def delete_alta(alta_id):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE entrada_puntual_alta SET activo=FALSE
             WHERE id=%s AND id_manager=%s
        """, (alta_id, str(g.id_manager)))
        n = cur.rowcount
    if n:
        log_action(
            actor_from_request(), 'entrada_puntual_alta', 'baja',
            entidad_id=alta_id,
            resumen='Baja de alta de entrada puntual (activo=false)',
            cambios={'activo': {'before': True, 'after': False}},
        )
    return jsonify({'ok': True, 'deactivated': n})


# ─── BANNER: pendientes de cobro (por_entrada) ────────────────────────────────
@bp.route('/pendientes', methods=['GET'])
@auth_required
def pendientes():
    sql = """
        SELECT * FROM entrada_puntual_evento
         WHERE id_manager=%s AND estado='pendiente' AND modo='por_entrada'
    """
    params = [str(g.id_manager)]
    if g.id_trainer:
        # Aislamiento estricto: solo el trainer impersonado.
        sql += " AND id_trainer=%s"
        params.append(str(g.id_trainer))
    sql += " ORDER BY fecha_clase DESC, hora_clase DESC LIMIT 500"
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        rows = [_evt_to_dict(r) for r in cur.fetchall()]
    return jsonify({'ok': True, 'total': len(rows), 'eventos': rows})


# ─── EVENTOS (listado con filtros) ────────────────────────────────────────────
@bp.route('/eventos', methods=['GET'])
@auth_required
def list_eventos():
    estado = request.args.get('estado')
    modo = request.args.get('modo')
    mes = request.args.get('mes')
    cliente = request.args.get('cliente')
    sql = "SELECT * FROM entrada_puntual_evento WHERE id_manager=%s"
    params = [str(g.id_manager)]
    if g.id_trainer:
        # Aislamiento estricto: solo el trainer impersonado.
        sql += " AND id_trainer=%s"
        params.append(str(g.id_trainer))
    if estado:
        sql += " AND estado=%s"; params.append(estado)
    if modo:
        sql += " AND modo=%s"; params.append(modo)
    if mes:
        sql += " AND mes=%s"; params.append(mes)
    if cliente:
        sql += " AND cliente_idnoofit=%s"; params.append(str(cliente))
    sql += " ORDER BY fecha_clase DESC, hora_clase DESC LIMIT 1000"
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        rows = [_evt_to_dict(r) for r in cur.fetchall()]
    return jsonify({'ok': True, 'eventos': rows})


# ─── COBRO EN RECEPCIÓN (por_entrada) ─────────────────────────────────────────
@bp.route('/eventos/<int:evt_id>/cobrar', methods=['POST'])
@auth_required
@require_permission('entradas_puntuales.cobrar_recepcion')
def cobrar_evento(evt_id):
    """Genera el recibo de UNA entrada y la marca cobrada.
    body opcional: {forma_pago} (si se quiere sobreescribir la del alta)."""
    d = request.get_json(silent=True) or {}
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT * FROM entrada_puntual_evento WHERE id=%s AND id_manager=%s",
                    (evt_id, str(g.id_manager)))
        evt = cur.fetchone()
    if not evt:
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    if evt['estado'] != 'pendiente':
        return jsonify({'ok': False, 'error': f"estado_{evt['estado']}"}), 400

    forma_pago = (d.get('forma_pago') or evt.get('forma_pago') or 'efectivo').strip()
    importe = float(evt.get('precio_entrada') or 0)
    concepto = (f"Entrada {evt.get('cuota_codigo') or ''} "
                f"{evt.get('actividad_nombre') or ''} {evt['fecha_clase'].isoformat()}").strip()
    try:
        res = get_alta(g.id_manager).crear_recibo_suelto(
            {'idnoofit': evt['cliente_idnoofit'], 'nombre': evt.get('cliente_nombre') or ''},
            concepto, importe, forma_pago,
            id_manager=g.id_manager, id_trainer=g.id_trainer,
            fecha=evt['fecha_clase'].isoformat(),
        )
    except Exception as e:
        log.exception('cobrar_evento')
        return jsonify({'ok': False, 'error': str(e)}), 500

    actor = actor_from_request()
    actor_label = actor.get('label') or actor.get('email') or 'API'
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE entrada_puntual_evento
               SET estado='cobrado', forma_pago=%s, recibo_odoo_id=%s,
                   cobrado_at=NOW(), cobrado_por=%s
             WHERE id=%s
        """, (forma_pago, res.get('invoice_id'), actor_label, evt_id))
    log_action(
        actor, 'entrada_puntual_evento', 'cobrar',
        entidad_id=evt_id,
        resumen='Cobro entrada puntual recepción',
        cambios={'estado': {'before': 'pendiente', 'after': 'cobrado'},
                 'importe': importe, 'forma_pago': forma_pago,
                 'recibo_odoo_id': res.get('invoice_id')},
    )
    return jsonify({'ok': True, 'recibo': res})


@bp.route('/eventos/<int:evt_id>/anular', methods=['POST'])
@auth_required
@require_permission('entradas_puntuales.anular_evento')
def anular_evento(evt_id):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE entrada_puntual_evento SET estado='anulado'
             WHERE id=%s AND id_manager=%s AND estado='pendiente'
        """, (evt_id, str(g.id_manager)))
        n = cur.rowcount
    if n:
        log_action(
            actor_from_request(), 'entrada_puntual_evento', 'anular',
            entidad_id=evt_id,
            resumen='Anulación entrada puntual',
            cambios={'estado': {'before': 'pendiente', 'after': 'anulado'}},
        )
    return jsonify({'ok': True, 'anulados': n})


# ─── EMISIÓN MENSUAL (por_mes) ────────────────────────────────────────────────
@bp.route('/emitir-mes', methods=['POST'])
@auth_required
@require_permission('entradas_puntuales.emitir_mes')
def emitir_mes():
    """Factura agregada del mes para entradas en modo por_mes.
    body: {mes: 'YYYY-MM'}. Agrupa por cliente+cuota: importe = nº × precio,
    concepto con los días. Marca los eventos como 'facturado'.
    """
    d = request.get_json() or {}
    mes = (d.get('mes') or '').strip()
    if len(mes) != 7:
        return jsonify({'ok': False, 'error': 'mes_invalido (YYYY-MM)'}), 400

    sql = """
        SELECT cliente_idnoofit, cliente_nombre, cuota_codigo, forma_pago,
               array_agg(id ORDER BY fecha_clase) AS evt_ids,
               array_agg(fecha_clase ORDER BY fecha_clase) AS fechas,
               count(*) AS n,
               max(precio_entrada) AS precio_entrada,
               min(id_trainer) AS id_trainer
          FROM entrada_puntual_evento
         WHERE id_manager=%s AND mes=%s AND modo='por_mes' AND estado='pendiente'
    """
    params = [str(g.id_manager), mes]
    if g.id_trainer:
        # Aislamiento estricto: solo el trainer impersonado.
        sql += " AND id_trainer=%s"
        params.append(str(g.id_trainer))
    sql += " GROUP BY cliente_idnoofit, cliente_nombre, cuota_codigo, forma_pago"
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        grupos = cur.fetchall()

    if not grupos:
        return jsonify({'ok': True, 'recibos': [], 'mensaje': 'sin entradas por_mes pendientes'})

    recibos = []
    for grp in grupos:
        n = int(grp['n'])
        precio = float(grp['precio_entrada'] or 0)
        importe = round(n * precio, 2)
        dias = ', '.join(f.strftime('%d') for f in grp['fechas'])
        concepto = (f"Entradas {grp['cuota_codigo']} {mes}: {n} días "
                    f"({dias}) × {precio:.2f}€")
        forma_pago = grp.get('forma_pago') or 'sepa'
        try:
            res = get_alta(g.id_manager).crear_recibo_suelto(
                {'idnoofit': grp['cliente_idnoofit'], 'nombre': grp.get('cliente_nombre') or ''},
                concepto, importe, forma_pago,
                id_manager=g.id_manager, id_trainer=grp.get('id_trainer') or g.id_trainer,
            )
            invoice_id = res.get('invoice_id')
            with get_conn() as conn, conn.cursor() as cur:
                cur.execute("""
                    UPDATE entrada_puntual_evento
                       SET estado='facturado', recibo_odoo_id=%s, cobrado_at=NOW()
                     WHERE id = ANY(%s)
                """, (invoice_id, list(grp['evt_ids'])))
            recibos.append({'cliente': grp['cliente_idnoofit'], 'cuota': grp['cuota_codigo'],
                            'entradas': n, 'importe': importe, 'invoice_id': invoice_id})
        except Exception as e:
            log.exception('emitir_mes grupo')
            recibos.append({'cliente': grp['cliente_idnoofit'], 'error': str(e)})
    emitidos = [r for r in recibos if r.get('invoice_id')]
    if emitidos:
        log_action(
            actor_from_request(), 'entrada_puntual_evento', 'emitir_mes',
            resumen=f'Emisión facturas mensuales entradas puntuales {mes}',
            cambios={'mes': mes, 'recibos_emitidos': len(emitidos),
                     'importe_total': round(sum(r.get('importe', 0) for r in emitidos), 2),
                     'estado': {'before': 'pendiente', 'after': 'facturado'}},
        )
    return jsonify({'ok': True, 'recibos': recibos})


# ─── DETECCIÓN a demanda ──────────────────────────────────────────────────────
@bp.route('/detectar', methods=['POST'])
@auth_required
@require_permission('entradas_puntuales.detectar_ahora')
def detectar():
    """Dispara la detección de reservas confirmadas para el manager actual.
    body opcional: {dias_atras: int} (por defecto 7)."""
    from ..cron_entradas_puntuales import detectar_entradas_manager
    d = request.get_json(silent=True) or {}
    dias = int(d.get('dias_atras') or 7)
    try:
        n = detectar_entradas_manager(str(g.id_manager), dias_atras=dias)
        log_action(
            actor_from_request(), 'entrada_puntual_evento', 'detectar',
            resumen='Detección a demanda de entradas puntuales',
            cambios={'dias_atras': dias, 'nuevas': n},
        )
        return jsonify({'ok': True, 'nuevas': n})
    except Exception as e:
        log.exception('detectar entradas')
        return jsonify({'ok': False, 'error': str(e)}), 500
