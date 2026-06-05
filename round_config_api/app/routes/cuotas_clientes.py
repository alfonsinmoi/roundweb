"""Endpoints API para gestión de cuotas/recibos de clientes.

Todas operan sobre Odoo (round_facturacion) via XML-RPC.
"""
import base64
import logging
import os
from flask import Blueprint, request, jsonify, g, Response
from ..auth import auth_required, require_permission, require_seccion
from ..odoo_guard import require_feature
from ..odoo_cuotas import get_cuotas
from ..odoo_alta import get_alta
from ..db import get_conn
from ..notif_sender import enviar_notificacion
from ..trainer_scope import (clientes_id_noofit_del_trainer, cliente_pertenece_a_trainer,
                             clientes_id_noofit_del_manager)
from ..audit_log import log_action, actor_from_request
from .. import config as cfg

bp = Blueprint('cuotas_clientes', __name__)
log = logging.getLogger(__name__)


def _disparar_notif_pago_alta(oc, inv_id, callback_body):
    """Tras un pago confirmado en PayComet, manda push al cliente.

    Defensivo: si no encontramos cliente_idnoofit o auto_pago_alta=False,
    salimos sin error. El callback ya marcó el recibo como pagado.
    """
    # 1) Leer factura + partner para identificar al cliente
    inv = oc._call('account.move', 'read', [inv_id],
                   ['partner_id', 'amount_total', 'currency_id', 'name'])[0]
    partner_id = inv['partner_id'][0] if inv.get('partner_id') else None
    if not partner_id:
        log.info(f'notif pago_alta: factura {inv_id} sin partner')
        return
    partner = oc._call('res.partner', 'read', [partner_id],
                       ['id_noofit', 'name', 'email'])[0]
    cliente_idnoofit = (partner.get('id_noofit') or '').strip()
    if not cliente_idnoofit:
        log.info(f'notif pago_alta: partner {partner_id} sin id_noofit')
        return

    # 2) Resolver manager (hoy mono-tenant: env). Trainer NULL por defecto.
    id_manager = os.getenv('ROUND_DEFAULT_MANAGER', '17675')
    id_trainer = None  # TODO: derivar del partner.x_id_trainer cuando exista

    # 3) Comprobar config (auto_pago_alta on/off)
    from ..db import get_conn
    auto_on = True
    plantillas = {}
    try:
        with get_conn() as conn, conn.cursor() as cur:
            # Buscar config trainer-specific o manager-wide
            cur.execute("""
                SELECT auto_pago_alta, plantillas FROM notif_config
                 WHERE id_manager=%s
                   AND (id_trainer IS NULL OR id_trainer=%s)
                 ORDER BY (id_trainer IS NULL) ASC LIMIT 1
            """, (id_manager, id_trainer or ''))
            row = cur.fetchone()
            if row is not None:
                auto_on = bool(row['auto_pago_alta'])
                plantillas = row.get('plantillas') or {}
    except Exception:
        pass
    if not auto_on:
        log.info('notif pago_alta: desactivado por config')
        return

    importe = inv.get('amount_total') or 0
    plantilla_pago = (plantillas.get('pago_alta') or {}) if isinstance(plantillas, dict) else {}

    res = enviar_notificacion(
        id_manager=id_manager,
        id_trainer=id_trainer,
        seccion='cobros',
        tipo='pago_alta',
        titulo=plantilla_pago.get('titulo') or None,  # None = usar plantilla default catalog
        cuerpo=plantilla_pago.get('cuerpo') or None,
        plantilla_vars={
            'importe': f'{importe:.2f}',
            'cliente_nombre': partner.get('name', ''),
            'recibo': inv.get('name', ''),
        },
        audience={'tipo': 'cliente', 'ref': cliente_idnoofit},
        origen='paycomet_callback',
        origen_ref=f'invoice:{inv_id}',
    )
    log.info(f'notif pago_alta inv={inv_id} cliente={cliente_idnoofit} → {res.get("estado")}')


def _serialize(rec):
    """Convierte tipos Odoo (lista [id,name]) a dicts más simples para JSON."""
    if not rec: return rec
    out = dict(rec)
    for k, v in list(out.items()):
        if isinstance(v, list) and len(v) == 2 and isinstance(v[0], (int, type(None))):
            out[k] = {'id': v[0], 'name': v[1]}
    return out


# Estados BD `recibo` → payment_state estilo Odoo (consumido por el front).
_BD_ESTADO_PAYMENT_STATE = {
    'pagado':     'paid',
    'facturado':  'paid',
    'impagado':   'not_paid',
    'devuelto':   'not_paid',
    'emitido':    'not_paid',
    'cancelado':  'not_paid',
}


def _bd_recibo_to_unified(r):
    """Convierte una fila de BD `recibo` al shape "tipo Odoo" que espera el
    frontend (RecibosTable, ListadoTab). Así podemos devolver una lista
    unificada — BD + Odoo — sin que la UI tenga que diferenciar.

    Marcadores: `_source='bd'` + `_origen` + `estado_bd` para que el front
    pueda mostrar un chip indicando que aún no está facturado a Odoo.
    """
    def _iso(d):
        return d.isoformat() if hasattr(d, 'isoformat') else d
    importe = float(r.get('importe_total') or 0)
    estado_bd = r.get('estado') or 'emitido'
    periodo = r.get('periodo') or ''
    nombre_doc = f'BD/{periodo}/{r["id"]:05d}' if periodo else f'BD/{r["id"]:05d}'
    return {
        # `id` con prefijo para no colisionar con IDs de account.move Odoo.
        'id': f'bd-{r["id"]}',
        'id_bd': r['id'],
        'name': nombre_doc,
        'invoice_date': _iso(r.get('fecha_emision')),
        'invoice_date_due': _iso(r.get('fecha_hasta')) or _iso(r.get('fecha_emision')),
        'amount_total': importe,
        'state': 'posted',
        'payment_state': _BD_ESTADO_PAYMENT_STATE.get(estado_bd, 'not_paid'),
        'partner_id': {'id': None, 'name': r.get('cliente_nombre') or ''},
        'partner_idnoofit': r.get('cliente_idnoofit'),
        'round_subscription_id': None,
        'cuota_codigo': r.get('cuota_codigo') or '',
        'cuota_descripcion': r.get('cuota_descripcion') or '',
        'cuota_actividades': '',
        'forma_pago': r.get('metodo_pago'),
        'periodicidad': r.get('periodicidad'),
        'mes_ref': periodo or None,
        'create_date': _iso(r.get('created_at')),
        'narration': r.get('notas') or '',
        'descuentos_aplicados': [],
        'modificaciones_aplicadas': [],
        # Marcadores propios — no rompen el front existente.
        '_source': 'bd',
        '_origen': r.get('origen'),
        'estado_bd': estado_bd,
    }


def _bd_recibos_cliente(id_noofit):
    """Lee recibos BD de un cliente del manager actual. Excluye:
      - los facturados a Odoo (`account_move_id IS NOT NULL`) — esos
        llegan vía la consulta Odoo, evitamos duplicar.
      - los borradores de remesa (`estado='borrador_remesa'`) — solo
        deben verse en el tab "Recibos manuales" hasta que se emitan.
    """
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT id, cliente_idnoofit, cliente_nombre,
                   cuota_codigo, cuota_descripcion,
                   periodo, fecha_emision, fecha_pago, fecha_hasta, fecha_desde,
                   periodicidad, importe_total, metodo_pago, estado,
                   origen, notas, created_at, account_move_id
              FROM recibo
             WHERE id_manager = %s AND cliente_idnoofit = %s
               AND account_move_id IS NULL
               AND estado <> 'borrador_remesa'
             ORDER BY fecha_emision DESC, id DESC
        """, (str(g.id_manager), str(id_noofit)))
        return cur.fetchall()


def _bd_recibos_filtrado(mes_str=None, estado=None, cliente_idnoofit=None):
    """Lee recibos BD del manager actual, opcionalmente filtrados por mes/
    estado/cliente. Excluye `account_move_id IS NOT NULL` por la misma razón
    que arriba — el move Odoo ya los representa."""
    where = ['id_manager = %s', 'account_move_id IS NULL',
             # Excluir borradores de remesa: solo el tab "Recibos manuales"
             # los muestra.
             "estado <> 'borrador_remesa'"]
    vals = [str(g.id_manager)]
    if g.id_trainer:
        # Estricto: recibo.id_trainer DEBE coincidir. Hay un backfill (mayo
        # 2026) que pobló los 950 recibos previos vía cliente_cache, así que
        # NULL solo ocurriría para recibos huérfanos sin cliente conocido.
        where.append('id_trainer = %s')
        vals.append(str(g.id_trainer))
    if mes_str:
        where.append('periodo = %s'); vals.append(mes_str)
    if estado:
        # Mapear payment_state Odoo a estado BD si llega así
        if estado in ('paid',):
            where.append("estado IN ('pagado','facturado')")
        elif estado in ('not_paid',):
            where.append("estado IN ('impagado','devuelto','emitido')")
        else:
            where.append('estado = %s'); vals.append(estado)
    if cliente_idnoofit:
        where.append('cliente_idnoofit = %s'); vals.append(str(cliente_idnoofit))
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"""
            SELECT id, cliente_idnoofit, cliente_nombre,
                   cuota_codigo, cuota_descripcion,
                   periodo, fecha_emision, fecha_pago, fecha_hasta, fecha_desde,
                   periodicidad, importe_total, metodo_pago, estado,
                   origen, notas, created_at
              FROM recibo
             WHERE {' AND '.join(where)}
             ORDER BY fecha_emision DESC, id DESC
        """, vals)
        return cur.fetchall()


# ── Listado por cliente (pestaña Cuotas en ClientProfile) ─────────────────────
@bp.route('/cliente/<id_noofit>', methods=['GET'])
@auth_required
@require_feature('cuotas')
@require_seccion('economico.cuotas_mensuales')
def cuotas_cliente(id_noofit):
    """Devuelve los recibos del cliente, unificando dos orígenes:
      - Odoo `account.move` (recibos ya facturados / con factura oficial).
      - BD `recibo` (recibos preemitidos o migrados que aún no se facturaron).
    Si Odoo falla seguimos devolviendo los BD para que la ficha al menos
    muestre algo (mejor visibilidad parcial que pantalla vacía).

    Aislamiento por trainer: si el usuario impersona un trainer y el cliente
    NO le pertenece, devolvemos lista vacía (no revelar datos del centro
    equivocado)."""
    if not cliente_pertenece_a_trainer(id_noofit):
        return jsonify({'ok': True, 'recibos': []})
    odoo_rows, odoo_error = [], None
    try:
        odoo_rows = get_cuotas().list_recibos_cliente(id_noofit)
    except Exception as e:
        odoo_error = str(e)
        log.exception('cuotas_cliente:odoo')

    try:
        bd_rows = _bd_recibos_cliente(id_noofit)
    except Exception:
        log.exception('cuotas_cliente:bd')
        bd_rows = []

    unified = ([_serialize(r) for r in odoo_rows]
               + [_bd_recibo_to_unified(r) for r in bd_rows])
    # Ordenar por fecha de emisión desc — los BD usan `invoice_date` también.
    unified.sort(key=lambda x: x.get('invoice_date') or '', reverse=True)
    resp = {'ok': True, 'recibos': unified}
    if odoo_error:
        resp['warning'] = f'odoo_unavailable: {odoo_error}'
    return jsonify(resp)


# ── Listado filtrable (Cuotas clientes / Listado) ─────────────────────────────
@bp.route('', methods=['GET'])
@bp.route('/', methods=['GET'])
@auth_required
@require_feature('cuotas')
@require_seccion('economico.cuotas_mensuales')
def list_cuotas():
    """Listado unificado de recibos (BD `recibo` + Odoo `account.move`).
    Si Odoo cae, devolvemos al menos los BD para que el operador siga
    teniendo visibilidad de los recibos pendientes de facturar."""
    mes = request.args.get('mes') or None
    estado = request.args.get('estado') or None
    partner_id = request.args.get('partner_id', type=int)
    cliente = request.args.get('cliente') or None  # cliente_idnoofit

    odoo_rows, odoo_error = [], None
    try:
        odoo_rows = get_cuotas().list_recibos_filtrado(mes, estado, partner_id)
    except Exception as e:
        odoo_error = str(e)
        log.exception('list_cuotas:odoo')

    # Aislamiento por MANAGER (siempre): varios managers pueden compartir la
    # misma company Odoo (p.ej. 17674 Añoreta y 17675 Málaga → company 3), así
    # que el company_id no los separa. Filtramos por los clientes del manager
    # para que un manager NO vea recibos de otro aunque compartan compañía.
    clientes_del_manager = clientes_id_noofit_del_manager()
    if clientes_del_manager is not None:
        odoo_rows = [r for r in odoo_rows
                     if str(r.get('partner_idnoofit') or '') in clientes_del_manager]

    # Aislamiento por trainer (Odoo side): account.move es manager-wide, sin
    # id_trainer. Post-filtramos por partner_idnoofit cuyo cliente pertenece
    # al trainer impersonado. Si no hay trainer impersonado → set None → no
    # filtro adicional.
    clientes_del_trainer = clientes_id_noofit_del_trainer()
    if clientes_del_trainer is not None:
        odoo_rows = [r for r in odoo_rows
                     if str(r.get('partner_idnoofit') or '') in clientes_del_trainer]

    try:
        bd_rows = _bd_recibos_filtrado(mes_str=mes, estado=estado,
                                       cliente_idnoofit=cliente)
    except Exception:
        log.exception('list_cuotas:bd')
        bd_rows = []

    unified = ([_serialize(r) for r in odoo_rows]
               + [_bd_recibo_to_unified(r) for r in bd_rows])
    unified.sort(key=lambda x: x.get('invoice_date') or '', reverse=True)
    resp = {'ok': True, 'recibos': unified}
    if odoo_error:
        resp['warning'] = f'odoo_unavailable: {odoo_error}'
    return jsonify(resp)


# ── Preemisión: generar borradores del mes ────────────────────────────────────
@bp.route('/preemision/<mes>', methods=['POST'])
@auth_required
@require_feature('cuotas')
@require_permission('economico.cuotas_mensuales.validar_preemision')
def preemision_generar(mes):
    """mes formato YYYY-MM"""
    try:
        result = get_cuotas().generar_preemision(mes)
        log_action(actor_from_request(), 'preemision', 'preemitir',
                   entidad_id=mes,
                   resumen=f'Preemisión generada {mes}',
                   cambios={'mes': mes, 'result': result})
        return jsonify({'ok': True, **result})
    except Exception as e:
        log.exception('preemision_generar')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/preemision/<mes>', methods=['GET'])
@auth_required
@require_feature('cuotas')
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
@require_feature('cuotas')
@require_permission('economico.cuotas_mensuales.editar_preemision')
def preemision_modificar(invoice_id):
    """Modificar un borrador: precio, fecha vencimiento, notas."""
    try:
        d = request.get_json() or {}
        result = get_cuotas().update_borrador(invoice_id, d)
        log_action(actor_from_request(), 'preemision', 'update',
                   entidad_id=invoice_id,
                   resumen=f'Borrador recibo {invoice_id} modificado',
                   cambios={'after': d})
        return jsonify({'ok': True, 'recibo': _serialize(result)})
    except ValueError as e:
        return jsonify({'ok': False, 'error': str(e)}), 400
    except Exception as e:
        log.exception('preemision_modificar')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/preemision/recibo/<int:invoice_id>', methods=['DELETE'])
@auth_required
@require_feature('cuotas')
@require_permission('economico.cuotas_mensuales.borrar_preemision')
def preemision_eliminar(invoice_id):
    try:
        get_cuotas().delete_borrador(invoice_id)
        log_action(actor_from_request(), 'preemision', 'delete',
                   entidad_id=invoice_id,
                   resumen=f'Borrador recibo {invoice_id} eliminado')
        return jsonify({'ok': True})
    except ValueError as e:
        return jsonify({'ok': False, 'error': str(e)}), 400
    except Exception as e:
        log.exception('preemision_eliminar')
        return jsonify({'ok': False, 'error': str(e)}), 500


# ── Emisión: confirmar remesa → genera SEPA ───────────────────────────────────
@bp.route('/emitir/<mes>', methods=['POST'])
@auth_required
@require_feature('cuotas')
@require_permission('economico.cuotas_mensuales.emitir_mes')
def emitir_remesa(mes):
    try:
        result = get_cuotas().emitir_remesa(mes)
        log_action(actor_from_request(), 'remesa', 'emitir',
                   entidad_id=mes,
                   resumen=f'Remesa emitida {mes}',
                   cambios={'mes': mes, 'result': result})
        return jsonify(result)
    except Exception as e:
        log.exception('emitir_remesa')
        return jsonify({'ok': False, 'error': str(e)}), 500


# ── Enviar factura por email al cliente (con PDF adjunto) ────────────────────
@bp.route('/recibo/<int:invoice_id>/enviar', methods=['POST'])
@auth_required
@require_feature('cuotas')
@require_permission('economico.cuotas_mensuales.reenviar_factura')
def enviar_factura(invoice_id):
    """Envía la factura por email al cliente con PDF adjunto.
    Body opcional: { dest_email?: '...', mensaje?: '...' }
    Si no se especifica dest_email, usa el email del partner asociado a la factura.
    """
    try:
        d = request.get_json(silent=True) or {}
        dest = (d.get('dest_email') or '').strip() or None
        mensaje = (d.get('mensaje') or '').strip()
        result = get_cuotas().enviar_factura_email(
            invoice_id,
            dest_email=dest,
            id_manager=g.id_manager,
            id_trainer=g.id_trainer,
            extra_message=mensaje,
        )
        if result.get('ok'):
            log_action(actor_from_request(), 'recibo', 'enviar_factura',
                       entidad_id=invoice_id,
                       resumen=f'Factura {invoice_id} enviada por email',
                       cambios={'dest_email': dest})
        return jsonify(result), (200 if result.get('ok') else 400)
    except Exception as e:
        log.exception('enviar_factura')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/alta-cliente', methods=['POST'])
@auth_required
@require_feature('cuotas')
@require_permission('cuotas_clientes.asignar')
def alta_cliente():
    """Crea cliente + suscripción + recibo alta + procesa pago en Odoo.
    Body: {cliente: {...}, suscripcion: {...}, alta: {...}}
    """
    try:
        payload = request.get_json() or {}
        if not payload.get('cliente') or not payload.get('suscripcion') or not payload.get('alta'):
            return jsonify({'ok': False, 'error': 'payload incompleto (cliente / suscripcion / alta)'}), 400
        result = get_alta().crear_alta_cliente(
            payload,
            id_manager=g.id_manager,
            id_trainer=g.id_trainer,
        )
        _cli = payload.get('cliente') or {}
        log_action(actor_from_request(), 'alta_cliente', 'alta',
                   entidad_id=_cli.get('id_noofit') or _cli.get('idNoofit'),
                   resumen=f"Alta cliente {_cli.get('nombre','') or ''}".strip(),
                   cambios={'cliente': _cli.get('nombre'),
                            'cuota': (payload.get('suscripcion') or {}).get('cuota_codigo'),
                            'result': result})
        return jsonify(result)
    except ValueError as e:
        return jsonify({'ok': False, 'error': str(e)}), 400
    except Exception as e:
        log.exception('alta_cliente')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/paycomet-stub/<path:order_ref>', methods=['GET'])
def paycomet_stub(order_ref):
    """Página de pago simulado para pruebas SIN cuenta PayComet.
    Muestra dos botones: 'Pagar' (llama callback con OK) o 'Rechazar' (KO).
    """
    amount = request.args.get('amount', '0')
    html = f"""<!DOCTYPE html>
<html lang="es"><head>
<meta charset="utf-8"><title>Pago simulado · Round</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
       background:#0f172a;color:#e2e8f0;
       display:flex;min-height:100vh;align-items:center;justify-content:center;padding:20px}}
  .card{{background:#1e293b;border:1px solid #334155;border-radius:16px;
        padding:32px;max-width:420px;width:100%;text-align:center;
        box-shadow:0 8px 32px rgba(0,0,0,.4)}}
  h1{{font-size:20px;margin:0 0 8px;color:#f8fafc}}
  .sub{{color:#94a3b8;font-size:13px;margin-bottom:24px}}
  .amount{{font-size:36px;font-weight:700;color:#2dd4a8;margin:24px 0;
          font-family:ui-monospace,monospace}}
  .ref{{background:#0f172a;border:1px solid #334155;border-radius:8px;
       padding:8px 12px;font-family:ui-monospace,monospace;font-size:11px;
       color:#94a3b8;margin-bottom:24px;word-break:break-all}}
  .btn{{display:inline-block;padding:14px 24px;border-radius:10px;font-size:14px;
       font-weight:600;cursor:pointer;border:none;margin:4px;
       text-decoration:none}}
  .btn-ok{{background:#2dd4a8;color:#fff}}
  .btn-ko{{background:transparent;color:#f87171;border:1px solid rgba(248,113,113,.4)}}
  .warn{{margin-top:24px;padding:10px;border-radius:8px;font-size:11px;
        background:rgba(251,191,36,.1);color:#fbbf24;border:1px solid rgba(251,191,36,.3)}}
  #status{{font-size:14px;margin-top:16px}}
  .ok{{color:#2dd4a8}} .err{{color:#f87171}}
</style></head><body>
<div class="card">
  <h1>Pago simulado</h1>
  <p class="sub">Modo prueba — sin cuenta PayComet real</p>
  <div class="amount">{float(amount):.2f} €</div>
  <div class="ref">Ref: {order_ref}</div>
  <button class="btn btn-ok" onclick="responder(0)">✅ Pagar</button>
  <button class="btn btn-ko" onclick="responder(1)">❌ Rechazar</button>
  <div id="status"></div>
  <p class="warn">⚠ Esta página no procesa pagos reales. Sustitúyela
    cuando configures las credenciales PayComet.</p>
</div>
<script>
async function responder(resp){{
  document.getElementById('status').textContent = 'Procesando…'
  try {{
    const r = await fetch('/api/cuotas/paycomet-callback', {{
      method:'POST', headers:{{'Content-Type':'application/json'}},
      body: JSON.stringify({{Order:'{order_ref}', Response: resp}})
    }})
    const d = await r.json()
    const el = document.getElementById('status')
    if (resp === 0 && d.ok && d.paid) {{
      el.className='ok'; el.textContent='✅ Pago registrado en Odoo (recibo #'+d.invoice_id+')'
    }} else if (resp === 0) {{
      el.className='err'; el.textContent='Error: '+(d.error||JSON.stringify(d))
    }} else {{
      el.className='err'; el.textContent='Pago rechazado'
    }}
  }} catch(e) {{
    document.getElementById('status').className='err'
    document.getElementById('status').textContent='Error: '+e.message
  }}
}}
</script></body></html>"""
    from flask import Response
    return Response(html, mimetype='text/html')


@bp.route('/paycomet-callback', methods=['POST', 'GET'])
def paycomet_callback():
    """Webhook server-to-server de PayComet. Cuando un pago se completa
    (success), localizamos la factura por el campo `name` (que enviamos como
    `order` al crear el enlace) y registramos el pago en Odoo.

    NOTA: este endpoint NO usa @auth_required porque PayComet no manda
    nuestro X-Round-Token. La protección viene de la firma que PayComet
    incluye y de que el `order` ref es difícil de adivinar. (Ver TODO
    sobre validar firma una vez tengamos el secret en el .env.)
    """
    try:
        d = request.get_json(silent=True) or request.form.to_dict() or {}
        order = d.get('Order') or d.get('order') or d.get('TransactionType') and d.get('Order')
        # PayComet usa varios formatos según versión; intentamos los comunes
        if not order:
            for k in ('order', 'orderRef', 'reference', 'ref'):
                if d.get(k): order = d[k]; break
        # Estado: response 0 = OK
        ok = False
        for k in ('Response','response','status','errorCode'):
            v = d.get(k)
            if v is not None:
                ok = (str(v) == '0' or str(v).lower() == 'ok' or v == 0)
                break
        log.info(f'PayComet callback order={order} ok={ok} body={d}')
        if not order:
            return jsonify({'ok': False, 'error': 'order missing'}), 400
        # Localizar invoice. CRÍTICO multi-company: si dos managers usan el
        # mismo formato de referencia, _call sin scope cogería la primera.
        # _call_scoped fuerza company_id del manager actual.
        from ..odoo_cuotas import get_cuotas
        oc = get_cuotas(id_manager=getattr(g, 'id_manager', None))
        inv_ids = oc._call_scoped('account.move','search',[('name','=', order)], limit=1)
        if not inv_ids:
            log.warning(f'PayComet callback: invoice {order} no encontrado')
            return jsonify({'ok': False, 'error': 'invoice not found'}), 200
        inv_id = inv_ids[0]
        if not ok:
            # Pago fallido; no hacemos nada (la factura sigue posted/not_paid)
            return jsonify({'ok': True, 'invoice_id': inv_id, 'paid': False})
        # Registrar pago via account.payment.register
        inv = oc._call('account.move','read',[inv_id],['invoice_date','state'])[0]
        if inv.get('state') != 'posted':
            try: oc._call('account.move','action_post',[inv_id])
            except Exception: pass
        journals = oc._call('account.journal','search',
            [('type','=','bank'),('company_id','=',cfg.ODOO_COMPANY)], limit=1)
        if not journals:
            return jsonify({'ok': False, 'error': 'no bank journal'}), 500
        ctx = {'active_model':'account.move','active_ids':[inv_id]}
        wiz = oc._call_ctx('account.payment.register','create', ctx, {
            'journal_id': journals[0],
            'payment_date': inv.get('invoice_date') or False,
        })
        oc._call_ctx('account.payment.register','action_create_payments', ctx, [wiz])

        # ── Notif automática al cliente: "pago_alta" ──
        # Si la config del manager/trainer tiene auto_pago_alta=True, mandamos
        # un push al cliente confirmándole el pago. Defensivo: cualquier error
        # aquí NO debe romper el callback (el pago ya está marcado).
        try:
            _disparar_notif_pago_alta(oc, inv_id, d)
        except Exception as e:
            log.warning(f'paycomet_callback notif fallback: {e}')

        log_action(actor_from_request(), 'recibo', 'cobrar',
                   entidad_id=inv_id,
                   resumen=f'Pago PayComet registrado recibo {order}',
                   cambios={'order': order, 'invoice_id': inv_id})
        return jsonify({'ok': True, 'invoice_id': inv_id, 'paid': True})
    except Exception as e:
        log.exception('paycomet_callback')
        return jsonify({'ok': False, 'error': str(e)}), 500


import re as _re
from datetime import date as _date


def _norm_doc(s):
    """Normaliza un DNI/NIE: mayúsculas, solo alfanumérico."""
    v = _re.sub(r'[^A-Za-z0-9]', '', str(s or '')).upper()
    return v or None


def _parse_importe_dev(v):
    if v is None or v == '':
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        s = str(v).strip().replace('.', '').replace(',', '.')
        try:
            return float(s)
        except ValueError:
            return None


def _cliente_idnoofit_por_dni(id_manager, dni):
    """DNI → cliente_idnoofit dentro del MANAGER (todos sus trainers; la
    devolución no sale de la esfera del manager). None si no hay match único."""
    if not dni:
        return None
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT id::text AS id FROM cliente_cache
             WHERE id_manager = %s
               AND upper(regexp_replace(coalesce(raw_data->>'dni',''),'[^A-Za-z0-9]','','g')) = %s
             LIMIT 1
        """, (str(id_manager), dni))
        row = cur.fetchone()
    return row['id'] if row else None


def _recibo_para_devolucion(id_manager, cliente_idnoofit, periodo, importe):
    """Recibo (BD) que casa con la devolución: manager + cliente + periodo.
    Prefiere el no-devuelto y el de importe más cercano. Manager-scoped."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT id, id_trainer, cliente_nombre, estado, importe_total, account_move_id
              FROM recibo
             WHERE id_manager = %s AND cliente_idnoofit = %s AND periodo = %s
               AND estado <> 'anulado'
             ORDER BY (estado = 'devuelto') ASC,
                      CASE WHEN %s IS NULL THEN 0
                           ELSE abs(coalesce(importe_total,0) - %s) END ASC,
                      id DESC
             LIMIT 1
        """, (str(id_manager), str(cliente_idnoofit), periodo, importe, importe))
        return cur.fetchone()


@bp.route('/devoluciones', methods=['POST'])
@auth_required
def devoluciones():
    """Procesa devoluciones SEPA. Cada fila casa con la EMISIÓN (mes/año) + el
    CLIENTE (DNI), NO con la referencia Odoo. Body:
      { rows: [{ dni|cliente_idnoofit, periodo:'AAAA-MM', importe?, motivo?,
                 referencia?, librado? }, ...] }
    Matching MANAGER-scoped (todos los trainers; el fichero del banco es de la
    empresa fiscal entera). Marca el recibo 'devuelto' (BD) y anula el pago en
    Odoo si tiene asiento. Idempotente (si ya está devuelto, lo reporta).
    """
    try:
        d = request.get_json() or {}
        rows = d.get('rows') or []
        if not rows:
            return jsonify({'ok': False, 'error': 'Sin filas'}), 400
        oc = get_cuotas(g.id_manager)
        result = {'procesadas': [], 'errores': []}
        for r in rows:
            ref = (r.get('referencia') or r.get('invoice_ref') or '').strip()
            librado = (r.get('librado') or '').strip()
            motivo = (r.get('motivo') or '').strip() or 'Devolución SEPA'
            periodo = (r.get('periodo') or '').strip()
            importe = _parse_importe_dev(r.get('importe'))
            cliente = (str(r.get('cliente_idnoofit') or '').strip()) or None
            dni = _norm_doc(r.get('dni'))
            err = {'referencia': ref, 'librado': librado}

            if not cliente and dni:
                cliente = _cliente_idnoofit_por_dni(g.id_manager, dni)
            if not cliente:
                err['error'] = 'cliente no encontrado (DNI)'; result['errores'].append(err); continue
            if not periodo:
                err['error'] = 'sin periodo (fecha de cobro original)'; result['errores'].append(err); continue

            rec = _recibo_para_devolucion(g.id_manager, cliente, periodo, importe)
            if not rec:
                err['error'] = f'recibo no encontrado (cliente {cliente}, {periodo})'
                result['errores'].append(err); continue

            base = {'referencia': ref, 'recibo_id': rec['id'],
                    'invoice_id': rec['account_move_id'], 'partner': rec['cliente_nombre'],
                    'partner_idnoofit': cliente, 'importe': float(rec['importe_total'] or 0),
                    'motivo': motivo, 'periodo': periodo}
            if rec['estado'] == 'devuelto':
                base['ya_devuelto'] = True
                result['procesadas'].append(base); continue

            # Marcar devuelto en BD
            with get_conn() as conn, conn.cursor() as cur:
                cur.execute("""
                    UPDATE recibo SET estado='devuelto', fecha_devolucion=NOW(),
                           notas = COALESCE(notas,'') || %s, updated_at = NOW()
                     WHERE id = %s
                """, (f"\n[DEVOLUCIÓN {_date.today().isoformat()}] {motivo}", rec['id']))
            # Anular el pago en Odoo (si el recibo tiene asiento) → queda pendiente de recobro
            pagos_anulados = 0
            if rec['account_move_id']:
                try:
                    pagos_anulados = oc.anular_pagos_de_move(rec['account_move_id'])
                except Exception as e:
                    log.warning(f'devolucion: anular pago move {rec["account_move_id"]}: {e}')
            base['pagos_anulados'] = pagos_anulados
            result['procesadas'].append(base)
            log_action(actor_from_request(), 'devolucion', 'devolucion', entidad_id=str(rec['id']),
                       resumen=f"Devolución SEPA · recibo {rec['id']} · {rec['cliente_nombre']} · {periodo}",
                       cambios={'motivo': motivo, 'importe': base['importe'], 'periodo': periodo})

        # Notif automática al cliente afectado
        notificadas = 0
        for proc in result['procesadas']:
            if proc.get('ya_devuelto'):
                continue
            try:
                if _disparar_notif_devolucion(proc, g.id_manager):
                    notificadas += 1
            except Exception as e:
                log.warning(f'notif devolucion: {e}')
        result['notif_enviadas'] = notificadas
        return jsonify({'ok': True, **result})
    except Exception as e:
        log.exception('devoluciones')
        return jsonify({'ok': False, 'error': str(e)}), 500


def _disparar_notif_devolucion(proc: dict, id_manager: str, id_trainer: str = None) -> bool:
    """Manda notif "devolucion" al cliente si tiene id_noofit y auto_devolucion=True.

    `proc` viene de procesar_devoluciones: incluye partner_idnoofit, importe,
    motivo, invoice_ref, invoice_id. `id_manager` = el manager que sube el
    fichero (g.id_manager); ya NO se usa ROUND_DEFAULT_MANAGER hardcodeado, así
    funciona multimanager. Retorna True si se intentó el envío.
    """
    cliente_idnoofit = (proc.get('partner_idnoofit') or '').strip()
    if not cliente_idnoofit:
        return False

    from ..db import get_conn
    # Derivar el trainer del cliente (de la cache) para scopear bien la config
    # de notif y el envío. Si no se encuentra, queda None (manager-wide).
    if id_trainer is None:
        try:
            with get_conn() as conn, conn.cursor() as cur:
                cur.execute("SELECT id_trainer FROM cliente_cache "
                            "WHERE id_manager=%s AND id::text=%s LIMIT 1",
                            (str(id_manager), cliente_idnoofit))
                row = cur.fetchone()
                if row and row.get('id_trainer') is not None:
                    id_trainer = str(row['id_trainer'])
        except Exception:
            pass

    # Comprobar config
    auto_on = True
    plantillas = {}
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT auto_devolucion, plantillas FROM notif_config
                 WHERE id_manager=%s
                   AND (id_trainer IS NULL OR id_trainer=%s)
                 ORDER BY (id_trainer IS NULL) ASC LIMIT 1
            """, (id_manager, id_trainer or ''))
            row = cur.fetchone()
            if row is not None:
                auto_on = bool(row['auto_devolucion'])
                plantillas = row.get('plantillas') or {}
    except Exception:
        pass
    if not auto_on:
        return False

    plantilla = (plantillas.get('devolucion') or {}) if isinstance(plantillas, dict) else {}
    res = enviar_notificacion(
        id_manager=id_manager,
        id_trainer=id_trainer,
        seccion='cobros',
        tipo='devolucion',
        titulo=plantilla.get('titulo') or None,
        cuerpo=plantilla.get('cuerpo') or None,
        plantilla_vars={
            'importe': f'{(proc.get("importe") or 0):.2f}',
            'cliente_nombre': proc.get('partner', ''),
            'recibo': proc.get('invoice_ref', ''),
            'motivo': proc.get('motivo', ''),
        },
        audience={'tipo': 'cliente', 'ref': cliente_idnoofit},
        origen='devolucion_sepa',
        origen_ref=f'invoice:{proc.get("invoice_id")}',
    )
    log.info(f'notif devolucion inv={proc.get("invoice_id")} cliente={cliente_idnoofit} → {res.get("estado")}')
    return True


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
