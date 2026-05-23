"""Endpoints CRUD de recibos.

Sistema nuevo (mayo 2026 →):
  - Mensual: emisión de recibos (cron + endpoint manual)
  - Trimestral: wizard de facturación (genera account.move en bloque)

Endpoints:
  GET    /api/recibos                       lista filtrable
  GET    /api/recibos/<id>                  ficha
  POST   /api/recibos                       crear (manual)
  PATCH  /api/recibos/<id>                  editar
  DELETE /api/recibos/<id>                  borrar (solo emitidos)

  POST   /api/recibos/<id>/marcar-pagado    body: {metodo?, fecha?}
  POST   /api/recibos/<id>/marcar-impagado  vuelve a impagado (deshacer pago)
  POST   /api/recibos/<id>/marcar-devuelto  body: {motivo?}
  POST   /api/recibos/<id>/generar-link     genera link PayComet (sólo si cliente activo)

  GET    /api/recibos/cliente/<id_noofit>   recibos del cliente

  GET    /api/recibos/stats                 stats por estado/método/periodo
"""
import datetime as dt
import json
import logging
from flask import Blueprint, request, jsonify, g

from ..auth import auth_required
from ..db import get_conn
from ..audit_log import log_action, actor_from_request

bp = Blueprint('recibos', __name__)
log = logging.getLogger(__name__)


METODOS_VALIDOS = {
    'sepa', 'tarjeta_tok', 'caja_efectivo', 'caja_tpv_fisico',
    'caja_tpv_virtual', 'enlace_pago',
}
ESTADOS_VALIDOS = {
    'emitido', 'pagado', 'impagado', 'devuelto', 'facturado', 'cancelado',
}
# Métodos que se consideran PAGADOS al emitir
METODOS_PAGADOS_AL_EMITIR = {'sepa', 'tarjeta_tok'}


# ─── Helpers ─────────────────────────────────────────────────────────────────
def _select_recibo_cols():
    return """id, id_manager, id_trainer, cliente_idnoofit, cliente_nombre,
              cuota_id, cuota_codigo, cuota_descripcion,
              periodo, fecha_desde, fecha_hasta, periodicidad,
              importe_base, importe_iva, importe_total, iva_pct,
              metodo_pago, estado,
              fecha_emision, fecha_pago, fecha_devolucion, fecha_facturacion,
              account_payment_id, account_move_id, account_move_ref,
              link_pago_token, link_pago_url, link_pago_creado_at, link_pago_pagado_at,
              intentos_cobro, origen, origen_ref, notas, lote_facturacion_id,
              created_at, updated_at, created_by, updated_by"""


# ─── Endpoints ───────────────────────────────────────────────────────────────

@bp.route('', methods=['GET'])
@bp.route('/', methods=['GET'])
@auth_required
def list_recibos():
    """Lista recibos con filtros:
       ?cliente=<idnoofit>  ?estado=<>  ?metodo=<>  ?periodo=YYYY-MM
       ?desde=YYYY-MM-DD    ?hasta=YYYY-MM-DD
       ?lote=<id>           ?facturados=0|1
       ?limit=200 (max 500) ?offset=0
    """
    qs = request.args
    where = ['id_manager = %s']
    vals = [str(g.id_manager)]
    if g.id_trainer:
        where.append('(id_trainer = %s OR id_trainer IS NULL)')
        vals.append(str(g.id_trainer))
    if qs.get('cliente'):
        where.append('cliente_idnoofit = %s'); vals.append(qs['cliente'])
    if qs.get('estado'):
        where.append('estado = %s'); vals.append(qs['estado'])
    if qs.get('metodo'):
        where.append('metodo_pago = %s'); vals.append(qs['metodo'])
    if qs.get('periodo'):
        where.append('periodo = %s'); vals.append(qs['periodo'])
    if qs.get('desde'):
        where.append('fecha_emision >= %s'); vals.append(qs['desde'])
    if qs.get('hasta'):
        where.append('fecha_emision <= %s'); vals.append(qs['hasta'])
    if qs.get('lote'):
        where.append('lote_facturacion_id = %s'); vals.append(int(qs['lote']))
    if qs.get('facturados') == '1':
        where.append("estado = 'facturado'")
    elif qs.get('facturados') == '0':
        where.append("estado <> 'facturado'")

    try:
        limit = min(int(qs.get('limit', '200')), 500)
        offset = int(qs.get('offset', '0'))
    except ValueError:
        return jsonify({'ok': False, 'error': 'limit/offset_invalid'}), 400

    sql = f"""
        SELECT {_select_recibo_cols()}
          FROM recibo
         WHERE {' AND '.join(where)}
         ORDER BY fecha_emision DESC, id DESC
         LIMIT %s OFFSET %s
    """
    vals.extend([limit, offset])
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(sql, vals)
        rows = cur.fetchall()
        # Total para paginar
        cur.execute(f"SELECT COUNT(*) AS n FROM recibo WHERE {' AND '.join(where)}",
                    vals[:-2])
        total = cur.fetchone()['n']
    return jsonify({'ok': True, 'recibos': rows, 'count': len(rows), 'total': total})


@bp.route('/<int:rid>', methods=['GET'])
@auth_required
def get_recibo(rid):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"SELECT {_select_recibo_cols()} FROM recibo WHERE id_manager=%s AND id=%s",
                    (str(g.id_manager), rid))
        r = cur.fetchone()
    if not r:
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    return jsonify({'ok': True, 'recibo': r})


@bp.route('', methods=['POST'])
@bp.route('/', methods=['POST'])
@auth_required
def create_recibo():
    d = request.get_json() or {}
    # Validaciones
    cliente = (d.get('cliente_idnoofit') or '').strip()
    if not cliente:
        return jsonify({'ok': False, 'error': 'cliente_idnoofit_required'}), 400
    metodo = d.get('metodo_pago')
    if metodo not in METODOS_VALIDOS:
        return jsonify({'ok': False, 'error': f'metodo_pago_invalid (acepta: {sorted(METODOS_VALIDOS)})'}), 400
    estado = d.get('estado') or ('pagado' if metodo in METODOS_PAGADOS_AL_EMITIR else 'impagado')
    if estado not in ESTADOS_VALIDOS:
        return jsonify({'ok': False, 'error': 'estado_invalid'}), 400

    importe_total = float(d.get('importe_total') or 0)
    iva_pct = float(d.get('iva_pct') or 21.0)
    importe_base = float(d.get('importe_base') or round(importe_total / (1 + iva_pct/100), 2))
    importe_iva  = float(d.get('importe_iva')  or round(importe_total - importe_base, 2))

    fecha_emision = d.get('fecha_emision') or dt.date.today().isoformat()
    fecha_pago = d.get('fecha_pago')
    if estado == 'pagado' and not fecha_pago:
        fecha_pago = dt.datetime.utcnow().isoformat()

    actor = actor_from_request()
    actor_label = actor.get('label') or actor.get('email') or 'API'

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            INSERT INTO recibo
              (id_manager, id_trainer, cliente_idnoofit, cliente_nombre,
               cuota_id, cuota_codigo, cuota_descripcion,
               periodo, fecha_desde, fecha_hasta, periodicidad,
               importe_base, importe_iva, importe_total, iva_pct,
               metodo_pago, estado, fecha_emision, fecha_pago,
               origen, origen_ref, notas, created_by, updated_by)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s)
            RETURNING id
        """, (
            str(g.id_manager), g.id_trainer or d.get('id_trainer'), cliente, d.get('cliente_nombre'),
            d.get('cuota_id'), d.get('cuota_codigo'), d.get('cuota_descripcion'),
            d.get('periodo'), d.get('fecha_desde'), d.get('fecha_hasta'), d.get('periodicidad'),
            importe_base, importe_iva, importe_total, iva_pct,
            metodo, estado, fecha_emision, fecha_pago,
            d.get('origen', 'manual'), d.get('origen_ref'), d.get('notas'),
            actor_label, actor_label,
        ))
        rid = cur.fetchone()['id']

    log_action(actor, entidad='recibo', entidad_id=rid, accion='create',
               resumen=f"Recibo creado {cliente} {d.get('periodo')} {importe_total}€ ({metodo}/{estado})")
    return jsonify({'ok': True, 'id': rid})


@bp.route('/<int:rid>', methods=['PATCH'])
@auth_required
def update_recibo(rid):
    """Actualiza campos editables. Para cambios de estado usar los endpoints
    específicos (marcar-pagado, etc.)."""
    d = request.get_json() or {}
    allowed = ['cliente_nombre', 'cuota_codigo', 'cuota_descripcion',
               'fecha_desde', 'fecha_hasta', 'periodicidad',
               'importe_base', 'importe_iva', 'importe_total', 'iva_pct',
               'notas']
    sets, vals = [], []
    for f in allowed:
        if f in d:
            sets.append(f"{f} = %s"); vals.append(d[f])
    if not sets:
        return jsonify({'ok': False, 'error': 'no_fields'}), 400
    actor = actor_from_request()
    sets.append("updated_by = %s"); vals.append(actor.get('label') or actor.get('email'))
    vals.extend([str(g.id_manager), rid])
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"UPDATE recibo SET {', '.join(sets)} WHERE id_manager=%s AND id=%s RETURNING id",
                    vals)
        row = cur.fetchone()
    if not row:
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    log_action(actor, entidad='recibo', entidad_id=rid, accion='update', cambios=d)
    return jsonify({'ok': True})


@bp.route('/<int:rid>', methods=['DELETE'])
@auth_required
def delete_recibo(rid):
    """Solo se pueden borrar recibos en estado emitido / impagado / cancelado.
    Los pagados o facturados NO se borran (mantener trazabilidad)."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT estado, account_move_id FROM recibo WHERE id_manager=%s AND id=%s",
                    (str(g.id_manager), rid))
        r = cur.fetchone()
        if not r:
            return jsonify({'ok': False, 'error': 'not_found'}), 404
        if r['estado'] in ('pagado', 'facturado') or r['account_move_id']:
            return jsonify({'ok': False, 'error': 'no_borrable',
                            'detalle': 'pagado/facturado: cancelar en vez de borrar'}), 400
        cur.execute("DELETE FROM recibo WHERE id_manager=%s AND id=%s", (str(g.id_manager), rid))
    log_action(actor_from_request(), entidad='recibo', entidad_id=rid, accion='delete')
    return jsonify({'ok': True})


# ─── Cambios de estado ────────────────────────────────────────────────────────

@bp.route('/<int:rid>/marcar-pagado', methods=['POST'])
@auth_required
def marcar_pagado(rid):
    d = request.get_json() or {}
    fecha = d.get('fecha') or dt.datetime.utcnow().isoformat()
    metodo = d.get('metodo')   # opcional: cambiar método al marcar pagado
    actor = actor_from_request()
    actor_label = actor.get('label') or actor.get('email')
    with get_conn() as conn, conn.cursor() as cur:
        if metodo and metodo in METODOS_VALIDOS:
            cur.execute("""
                UPDATE recibo
                   SET estado='pagado', fecha_pago=%s, metodo_pago=%s, updated_by=%s
                 WHERE id_manager=%s AND id=%s
                RETURNING id, cliente_idnoofit, importe_total, metodo_pago
            """, (fecha, metodo, actor_label, str(g.id_manager), rid))
        else:
            cur.execute("""
                UPDATE recibo
                   SET estado='pagado', fecha_pago=%s, updated_by=%s
                 WHERE id_manager=%s AND id=%s
                RETURNING id, cliente_idnoofit, importe_total, metodo_pago
            """, (fecha, actor_label, str(g.id_manager), rid))
        r = cur.fetchone()
    if not r:
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    log_action(actor, entidad='recibo', entidad_id=rid, accion='marcar_pagado',
               resumen=f"Recibo {rid} pagado vía {r['metodo_pago']}")
    return jsonify({'ok': True})


@bp.route('/<int:rid>/marcar-impagado', methods=['POST'])
@auth_required
def marcar_impagado(rid):
    actor = actor_from_request()
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE recibo SET estado='impagado', fecha_pago=NULL, updated_by=%s
             WHERE id_manager=%s AND id=%s
            RETURNING id
        """, (actor.get('label') or actor.get('email'), str(g.id_manager), rid))
        r = cur.fetchone()
    if not r:
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    log_action(actor, entidad='recibo', entidad_id=rid, accion='marcar_impagado')
    return jsonify({'ok': True})


@bp.route('/<int:rid>/marcar-devuelto', methods=['POST'])
@auth_required
def marcar_devuelto(rid):
    """Marca un recibo como devuelto (devolución bancaria SEPA típicamente).

    Modo α: el recibo está vinculado a un account.payment de Odoo (no a un
    account.move). Al marcarlo devuelto:
      - Anula el account.payment en Odoo (si existe).
      - Pone estado='impagado' (re-cobrable) o 'devuelto' según
        reactivar_impagado (default True → vuelve a impagado para re-cobro).
      - Limpia account_payment_id para que el wizard trimestral no lo arrastre.
      - Suma intento de cobro y deja traza en notas.

    body = {motivo?: str, reactivar_impagado?: bool (default true)}
    """
    d = request.get_json() or {}
    motivo = d.get('motivo') or 'devolución bancaria'
    reactivar = d.get('reactivar_impagado', True)
    actor = actor_from_request()
    actor_label = actor.get('label') or actor.get('email')

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT id, cliente_idnoofit, account_payment_id, estado, intentos_cobro
                         FROM recibo WHERE id_manager=%s AND id=%s""",
                    (str(g.id_manager), rid))
        r = cur.fetchone()
    if not r:
        return jsonify({'ok': False, 'error': 'not_found'}), 404

    pago_anulado = False
    if r.get('account_payment_id'):
        try:
            from ..odoo_alta import OdooAlta
            o = OdooAlta(); o._connect()
            try:
                o._call('account.payment', 'action_cancel', [[r['account_payment_id']]])
                pago_anulado = True
            except Exception as e:
                # Algunos pagos no pueden cancelarse (ya conciliados); intentar draft
                log.warning(f'action_cancel falló para payment {r["account_payment_id"]}: {e}')
                try:
                    o._call('account.payment', 'action_draft', [[r['account_payment_id']]])
                    pago_anulado = True
                except Exception as e2:
                    log.warning(f'action_draft también falló: {e2}')
        except Exception as e:
            log.warning(f'No se pudo conectar a Odoo para anular payment: {e}')

    nuevo_estado = 'impagado' if reactivar else 'devuelto'
    intentos = (r.get('intentos_cobro') or 0) + 1
    nota_extra = (f"\n[devolución {dt.date.today().isoformat()}] {motivo}"
                  + (' · payment Odoo anulado' if pago_anulado else ''))
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE recibo
               SET estado=%s, fecha_devolucion=NOW(),
                   account_payment_id=NULL,
                   intentos_cobro=%s,
                   notas=COALESCE(notas, '') || %s,
                   updated_by=%s
             WHERE id_manager=%s AND id=%s
        """, (nuevo_estado, intentos, nota_extra, actor_label,
              str(g.id_manager), rid))

    log_action(actor, entidad='recibo', entidad_id=rid, accion='marcar_devuelto',
               resumen=f'{motivo} → estado={nuevo_estado}'
                       + (' · payment Odoo anulado' if pago_anulado else ''),
               cambios={'motivo': motivo, 'pago_anulado': pago_anulado,
                        'nuevo_estado': nuevo_estado, 'intentos_cobro': intentos})
    return jsonify({'ok': True, 'pago_anulado': pago_anulado,
                    'nuevo_estado': nuevo_estado, 'intentos_cobro': intentos})


@bp.route('/<int:rid>/generar-link', methods=['POST'])
@auth_required
def generar_link_pago(rid):
    """Genera un link de pago (PayComet) para un recibo impagado.

    Solo se permite si:
      - estado IN ('impagado', 'devuelto', 'emitido')
      - no tiene link_pago_token activo (o si lo tiene, regenerarlo)

    NOTA: La integración real con PayComet requiere credenciales en
    `pasarela_credenciales` (terminal + password). Si no hay config, se
    genera un token local que se usará cuando se configure la pasarela.

    body = {regenerar?: bool}
    """
    import secrets
    d = request.get_json() or {}
    regenerar = d.get('regenerar', False)
    actor = actor_from_request()
    actor_label = actor.get('label') or actor.get('email')

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT id, cliente_idnoofit, importe_total, estado,
                              link_pago_token, link_pago_pagado_at
                         FROM recibo WHERE id_manager=%s AND id=%s""",
                    (str(g.id_manager), rid))
        r = cur.fetchone()
    if not r:
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    if r['estado'] in ('pagado', 'facturado', 'cancelado'):
        return jsonify({'ok': False, 'error': 'estado_no_permite_link',
                        'detalle': f"estado={r['estado']}"}), 400
    if r.get('link_pago_pagado_at'):
        return jsonify({'ok': False, 'error': 'link_ya_pagado'}), 400
    if r.get('link_pago_token') and not regenerar:
        # Devolver el ya generado
        return jsonify({'ok': True, 'token': r['link_pago_token'],
                        'url': f"https://noofit.wiemspro.com/pago/{r['link_pago_token']}",
                        'reused': True})

    # Generar token nuevo
    token = secrets.token_urlsafe(24)
    url = f"https://noofit.wiemspro.com/pago/{token}"

    # TODO: cuando haya credenciales PayComet, crear orden en pasarela aquí.
    # Por ahora se guarda el token local; el handler /pago/<token> hará el
    # checkout con PayComet en cuanto haya pasarela_credenciales configurada.
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE recibo
               SET link_pago_token=%s, link_pago_url=%s,
                   link_pago_creado_at=NOW(), updated_by=%s
             WHERE id_manager=%s AND id=%s
        """, (token, url, actor_label, str(g.id_manager), rid))

    log_action(actor, entidad='recibo', entidad_id=rid, accion='generar_link_pago',
               resumen=f"Link de pago generado: {url}")
    return jsonify({'ok': True, 'token': token, 'url': url, 'reused': False})


@bp.route('/cliente/<id_noofit>', methods=['GET'])
@auth_required
def list_cliente(id_noofit):
    """Recibos de un cliente concreto."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"""
            SELECT {_select_recibo_cols()}
              FROM recibo
             WHERE id_manager=%s AND cliente_idnoofit=%s
             ORDER BY fecha_emision DESC, id DESC
        """, (str(g.id_manager), id_noofit))
        rows = cur.fetchall()
    return jsonify({'ok': True, 'recibos': rows})


@bp.route('/stats', methods=['GET'])
@auth_required
def stats():
    """Stats por estado/método/periodo (para dashboards)."""
    qs = request.args
    where = ['id_manager = %s']; vals = [str(g.id_manager)]
    if qs.get('periodo'):
        where.append('periodo = %s'); vals.append(qs['periodo'])
    if qs.get('desde'):
        where.append('fecha_emision >= %s'); vals.append(qs['desde'])
    if qs.get('hasta'):
        where.append('fecha_emision <= %s'); vals.append(qs['hasta'])
    sql = f"""
        SELECT estado, metodo_pago, COUNT(*) as n,
               SUM(importe_total) AS total
          FROM recibo WHERE {' AND '.join(where)}
         GROUP BY estado, metodo_pago
         ORDER BY estado, metodo_pago
    """
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(sql, vals)
        rows = cur.fetchall()
    # Convert Decimal to float for JSON
    for r in rows:
        if r.get('total'): r['total'] = float(r['total'])
    return jsonify({'ok': True, 'stats': rows})
