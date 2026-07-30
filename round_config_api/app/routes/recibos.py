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

from ..auth import auth_required, require_permission, require_seccion, require_any_permission
from ..db import get_conn
from ..audit_log import log_action, actor_from_request
from ..trainer_scope import (
    apply_trainer_filter_direct, apply_trainer_filter_via_cache,
    cliente_pertenece_a_trainer, trainer_bloquea, clientes_id_noofit_del_manager,
)

bp = Blueprint('recibos', __name__)
log = logging.getLogger(__name__)


METODOS_VALIDOS = {
    'sepa', 'tarjeta_tok', 'caja_efectivo', 'caja_tpv_fisico',
    'caja_tpv_virtual', 'enlace_pago',
}
ESTADOS_VALIDOS = {
    'emitido', 'pagado', 'impagado', 'devuelto', 'facturado', 'cancelado',
    # Borrador para inclusión en remesa: visible solo en el tab "Recibos
    # manuales" mientras espera la emisión. NO aparece en ficha ni en
    # listado general hasta que `emision_v2` lo transiciona a `pagado` /
    # `impagado` según método de pago.
    'borrador_remesa',
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
@require_seccion('economico.cuotas_mensuales')
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
    # Aislamiento por trainer: si está impersonado, restringir a su id_trainer
    # o a registros del manager sin trainer asignado (catálogo).
    apply_trainer_filter_direct(where, vals, include_nulls=False)
    # Por defecto excluimos los borradores de remesa — solo aparecen cuando
    # el frontend los pide explícitamente con ?estado=borrador_remesa o
    # ?incluir_borradores=1 (página de "Recibos manuales").
    if qs.get('incluir_borradores') != '1' and qs.get('estado') != 'borrador_remesa':
        where.append("estado <> 'borrador_remesa'")
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
@require_seccion('economico.cuotas_mensuales')
def get_recibo(rid):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"SELECT {_select_recibo_cols()} FROM recibo WHERE id_manager=%s AND id=%s",
                    (str(g.id_manager), rid))
        r = cur.fetchone()
    if not r:
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    if trainer_bloquea(r['id_trainer']):
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    return jsonify({'ok': True, 'recibo': r})


@bp.route('', methods=['POST'])
@bp.route('/', methods=['POST'])
@auth_required
@require_any_permission('economico.cuotas_mensuales.crear_recibo',
                        'economico.cuotas_mensuales.modificar_recibo')
def create_recibo():
    d = request.get_json() or {}
    # Validaciones — cliente_idnoofit puede llegar como int o string.
    _raw = d.get('cliente_idnoofit')
    cliente = str(_raw).strip() if _raw is not None else ''
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

    # Resolver id_trainer del recibo: prioridad body explícito → trainer del
    # CLIENTE en `cliente_cache` → trainer impersonado como fallback. El
    # criterio correcto es "el trainer al que pertenece el cliente", no el
    # impersonado (el operador puede crear recibo a un cliente de otro centro
    # si está bajo el mismo manager).
    target_trainer = (d.get('id_trainer') or '').strip() if d.get('id_trainer') else ''
    if not target_trainer:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""SELECT id_trainer::text AS t FROM cliente_cache
                            WHERE id_manager=%s AND id::text=%s""",
                        (str(g.id_manager), str(cliente)))
            r = cur.fetchone()
            if r and r.get('t'):
                target_trainer = r['t']
    if not target_trainer:
        target_trainer = g.id_trainer

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
            str(g.id_manager), target_trainer, cliente, d.get('cliente_nombre'),
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


# Periodicidad → nº de meses de cobertura natural. Para validar la fecha fin
# del recibo (ver update_recibo). 'unico' = puntual → se trata como 1 mes.
_PERIOD_MESES = {'mensual': 1, 'bimestral': 2, 'bimensual': 2, 'trimestral': 3,
                 'semestral': 6, 'anual': 12, 'unico': 1}


def _add_months(d0, n):
    """Suma n meses a una fecha, recortando al último día válido del mes destino
    (p.ej. 31-ene + 1 mes = 28/29-feb). Sin dependencias externas."""
    import calendar
    m = d0.month - 1 + n
    y = d0.year + m // 12
    m = m % 12 + 1
    day = min(d0.day, calendar.monthrange(y, m)[1])
    return dt.date(y, m, day)


@bp.route('/<int:rid>', methods=['PATCH'])
@auth_required
@require_permission('economico.cuotas_mensuales.modificar_recibo')
def update_recibo(rid):
    """Actualiza campos del recibo (junio 2026 — permiso fino añadido).

    Estados editables (todos los campos):
      - borrador_remesa: borrador local, no llegó a contabilidad
      - pendiente / impagado / devuelto: no cobrado todavía
    Estados restringidos (solo descripciones/notas):
      - pagado / facturado: trazabilidad inmovilizada
    Estados no editables:
      - cancelado: marcar-impagado antes si necesitas cambiar
    """
    d = request.get_json() or {}
    # Base de campos siempre editables
    allowed = ['cliente_nombre', 'cuota_codigo', 'cuota_descripcion', 'notas']
    # Campos que afectan importes/contabilidad — solo si recibo no cobrado
    importe_fields = ['fecha_desde', 'fecha_hasta', 'periodicidad',
                      'importe_base', 'importe_iva', 'importe_total', 'iva_pct',
                      'metodo_pago', 'periodo', 'fecha_emision']
    # Sprint 7 M4 — validar tipos numéricos / fechas ANTES del UPDATE
    # (sin esto un string en importe_total → DataError 500 sin mensaje).
    numeric_fields = {'importe_base', 'importe_iva', 'importe_total', 'iva_pct'}
    date_fields = {'fecha_desde', 'fecha_hasta', 'fecha_emision', 'fecha_pago'}
    for f in numeric_fields:
        if f in d and d[f] is not None and d[f] != '':
            try:
                d[f] = float(d[f])
            except (TypeError, ValueError):
                return jsonify({'ok': False, 'error': f'{f}_no_numerico'}), 400
    for f in date_fields:
        if f in d and d[f]:
            try:
                dt.date.fromisoformat(str(d[f])[:10])
            except (TypeError, ValueError):
                return jsonify({'ok': False, 'error': f'{f}_invalida'}), 400

    actor = actor_from_request()
    actor_label = actor.get('label') or actor.get('email')
    # Admin = manager NoofitPro (perfil None) o usuario_web con is_admin.
    perfil = getattr(g, 'perfil', None)
    es_admin = (perfil is None) or bool(perfil.get('is_admin'))
    # Override MANUAL de la fecha fin: solo admin y solo si lo pide explícito
    # (flag `fecha_hasta_manual`). Sin el flag, la fecha fin se DERIVA de la
    # periodicidad (comportamiento por defecto). El flag NO es columna, no se
    # escribe; solo desactiva el recálculo de más abajo.
    _manual_fechafin = es_admin and bool(d.get('fecha_hasta_manual')) and bool(d.get('fecha_hasta'))

    # Sprint 7 H2 — SELECT FOR UPDATE + UPDATE en MISMA transacción
    # para evitar race con marcar-pagado concurrente.
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT * FROM recibo
                        WHERE id_manager=%s AND id=%s
                        FOR UPDATE""",
                    (str(g.id_manager), rid))
        r = cur.fetchone()
        if not r:
            return jsonify({'ok': False, 'error': 'not_found'}), 404
        if trainer_bloquea(r['id_trainer']):
            return jsonify({'ok': False, 'error': 'not_found'}), 404
        estado = r['estado']
        tiene_move = bool(r.get('account_move_id'))
        importe_en_d = [f for f in importe_fields if f in d]
        # 'emitido' SÍ es editable (recibo no cobrado, posteado-pendiente). Antes
        # quedaba fuera → caía en estado_no_editable y NO dejaba modificar NADA
        # (ni notas) — el admin lo reportaba como "no puedo modificar el recibo".
        # Con factura Odoo posteada, el guard tiene_move de abajo lo limita a
        # notas/descripción (igual que impagado/devuelto con move).
        editable_full = estado in ('borrador_remesa', 'pendiente', 'emitido',
                                    'impagado', 'devuelto')
        if editable_full:
            # Recibo NO cobrado (borrador/pendiente/emitido/impagado/devuelto).
            # La modificación afecta SOLO a la tabla `recibo` (la cuota); este
            # endpoint NUNCA toca Odoo. Regla del propietario (auditoría #25):
            # un recibo no pagado NO debe tener factura en Odoo hasta que se
            # cobre, así que se edita SIN restricción aunque tenga una factura
            # Odoo *legacy* enlazada (import GestPlus) — el cambio no la toca.
            # Cuando se cobre se factura ya con el importe correcto. Solo
            # `pagado`/`facturado` (rama de abajo) quedan inmovilizados.
            allowed += importe_fields
            if 'metodo_pago' in d and d['metodo_pago'] not in METODOS_VALIDOS:
                return jsonify({'ok': False, 'error': 'metodo_pago_invalid'}), 400
        elif estado in ('pagado', 'facturado'):
            # La fecha fin (próximo cobro) y la periodicidad se pueden ajustar
            # aunque esté cobrado (no es contable): editables por cualquiera con
            # permiso de modificar recibo.
            for _campo in ('fecha_hasta', 'periodicidad'):
                if _campo in d:
                    allowed += [_campo]
            if es_admin:
                # ADMIN — edición COMPLETA de un recibo cobrado: importe
                # (base/iva/total/iva_pct), fechas (inicio/fin/emisión/cobro),
                # método y periodo. ⚠ SOLO toca la tabla `recibo` de Round; NO
                # propaga a Odoo (la factura/pago Odoo conservan el importe
                # anterior → posible divergencia que la reconciliación marca).
                # Cada cambio contable genera incidencia con el diff (abajo).
                allowed += importe_fields + ['fecha_pago']
                if 'metodo_pago' in d and d['metodo_pago'] not in METODOS_VALIDOS:
                    return jsonify({'ok': False, 'error': 'metodo_pago_invalid'}), 400
            else:
                campos_importe_en_d = [f for f in importe_fields if f in d]
                otros_importe = [f for f in campos_importe_en_d
                                 if f not in ('fecha_hasta', 'periodicidad')]
                if otros_importe:
                    return jsonify({
                        'ok': False, 'error': 'estado_no_permite_modificar_importes',
                        'detalle': f'Recibo {estado}: solo se pueden editar notas/descripciones '
                                   f'o la fecha fin. El importe y las fechas de un recibo cobrado '
                                   f'solo los modifica un administrador.',
                        'campos_bloqueados': otros_importe,
                    }), 400
        else:
            return jsonify({'ok': False, 'error': 'estado_no_editable',
                            'detalle': f'Estado actual: {estado}'}), 400

        # ── FECHA FIN AUTOMÁTICA = fecha de emisión + periodicidad ───────────
        # Regla (propietario): la fecha fin NO se teclea a mano; se DERIVA de la
        # periodicidad elegida y la fecha de emisión (último día cubierto =
        # emisión + N meses − 1 día). Define cuándo vuelve a tocar emitir
        # (cobertura, auditoría #24). El servidor la recalcula (fuente de verdad,
        # no se fía del valor del cliente) siempre que se toque periodicidad,
        # fecha_hasta o fecha_emisión en un recibo editable o cobrado.
        # El admin puede FIJAR la fecha fin a mano (fecha_hasta_manual): en ese
        # caso NO se recalcula y se respeta el valor tecleado.
        _toca_fechafin = (('periodicidad' in allowed or 'fecha_hasta' in allowed)
                          and ('periodicidad' in d or 'fecha_hasta' in d
                               or 'fecha_desde' in d or 'fecha_emision' in d)
                          and not _manual_fechafin)
        if _toca_fechafin:
            per = str(d.get('periodicidad') or r.get('periodicidad') or 'mensual').lower()
            meses = _PERIOD_MESES.get(per, 1)
            # Base = PERIODO DESDE (inicio de cobertura), no la emisión: el último
            # día cubierto = fecha_desde + periodicidad − 1 día.
            base_raw = (d.get('fecha_desde') or r.get('fecha_desde')
                        or d.get('fecha_emision') or r.get('fecha_emision'))
            if base_raw:
                base = dt.date.fromisoformat(str(base_raw)[:10])
                d['fecha_hasta'] = (_add_months(base, meses) - dt.timedelta(days=1)).isoformat()
                if 'fecha_hasta' not in allowed:
                    allowed += ['fecha_hasta']

        # Dedup preservando orden: varias ramas pueden añadir el mismo campo
        # (p.ej. fecha_hasta llega por el bucle de cobrado Y por importe_fields
        # en la edición admin) → sin esto el UPDATE asigna la columna 2 veces.
        allowed = list(dict.fromkeys(allowed))

        sets, vals = [], []
        for f in allowed:
            if f in d:
                sets.append(f"{f} = %s"); vals.append(d[f])
        if not sets:
            return jsonify({'ok': False, 'error': 'no_fields'}), 400
        sets.append("updated_by = %s"); vals.append(actor_label)
        # Estado check defensivo: UPDATE solo si sigue siendo el estado leído
        vals.extend([str(g.id_manager), rid, estado])
        cur.execute(f"""UPDATE recibo SET {', '.join(sets)}
                        WHERE id_manager=%s AND id=%s AND estado=%s
                        RETURNING id, importe_total""", vals)
        row = cur.fetchone()
    if not row:
        return jsonify({'ok': False, 'error': 'estado_cambio',
                        'detalle': 'El recibo cambió de estado durante la modificación.'}), 409
    log_action(actor, entidad='recibo', entidad_id=rid, accion='update', cambios=d)

    # Sprint 7 H1 — incidencia para CUALQUIER cambio de campo contable
    # (no solo importe_total). Incluye diff anterior/nuevo en meta.
    contables = ['importe_base', 'importe_iva', 'importe_total', 'iva_pct',
                 'metodo_pago', 'periodo', 'fecha_emision', 'fecha_desde',
                 'fecha_hasta', 'fecha_pago', 'periodicidad']
    diffs = {}
    for f in contables:
        if f in d:
            ant = r.get(f)
            new = d[f]
            # Normalizar tipos para comparar (Decimal vs float, date vs str)
            try:
                if ant is not None and isinstance(ant, (int, float)) and new is not None:
                    if abs(float(ant) - float(new)) > 0.001:
                        diffs[f] = {'antes': float(ant), 'despues': float(new)}
                elif str(ant or '')[:10] != str(new or '')[:10]:
                    diffs[f] = {'antes': str(ant) if ant is not None else None,
                                'despues': new}
            except Exception:
                diffs[f] = {'antes': str(ant), 'despues': new}
    if diffs:
        try:
            from ..incidencias import crear_incidencia_admin
            campos = ', '.join(diffs.keys())
            crear_incidencia_admin(
                id_manager=g.id_manager, id_trainer=g.id_trainer,
                tipo='recibo_modificado',
                entidad='recibo', entidad_id=rid,
                severidad='warning' if 'importe_total' in diffs else 'info',
                titulo=f'Recibo #{rid} campos contables modificados',
                mensaje=(f'Cambios por {actor_label} en estado={estado}: {campos}. '
                         f'Detalles en meta.'),
                meta={'estado_recibo': estado, 'cambios': diffs},
                created_by=actor_label,
            )
        except Exception:
            log.exception('incidencia modificacion recibo')

    return jsonify({'ok': True})


@bp.route('/<int:rid>', methods=['DELETE'])
@auth_required
@require_permission('economico.cuotas_mensuales.modificar_recibo')
def delete_recibo(rid):
    """Solo se pueden borrar recibos en estado borrador_remesa / emitido /
    impagado / cancelado. Los pagados o facturados NO se borran (mantener
    trazabilidad)."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT estado, account_move_id, id_trainer FROM recibo WHERE id_manager=%s AND id=%s",
                    (str(g.id_manager), rid))
        r = cur.fetchone()
        if not r:
            return jsonify({'ok': False, 'error': 'not_found'}), 404
        if trainer_bloquea(r['id_trainer']):
            return jsonify({'ok': False, 'error': 'not_found'}), 404
        if r['estado'] in ('pagado', 'facturado') or r['account_move_id']:
            return jsonify({'ok': False, 'error': 'no_borrable',
                            'detalle': 'pagado/facturado: cancelar en vez de borrar'}), 400
        cur.execute("DELETE FROM recibo WHERE id_manager=%s AND id=%s", (str(g.id_manager), rid))
    log_action(actor_from_request(), entidad='recibo', entidad_id=rid, accion='delete')
    return jsonify({'ok': True})


# ─── Cobro de recibo PURAMENTE Odoo (account.move sin fila BD) ────────────────
@bp.route('/odoo-move/<int:move_id>/cobrar', methods=['POST'])
@auth_required
@require_permission('economico.cuotas_mensuales.marcar_pagado_manual')
def cobrar_move_odoo(move_id):
    """Cobra un recibo que SOLO existe como `account.move` en Odoo (sin recibo
    BD): crea el `account.payment` y lo reconcilia contra el move. Es el caso
    de recibos facturados por el wizard trimestral / migrados, que antes solo
    se podían cobrar desde el wizard. Respeta el aislamiento manager+trainer.

    Body: {metodo?, fecha?, importe_cobrado?, observacion?}.
    """
    d = request.get_json() or {}
    metodo = (d.get('metodo') or 'caja_efectivo')
    fecha = d.get('fecha') or dt.date.today().isoformat()
    importe_in = d.get('importe_cobrado')
    observacion = (d.get('observacion') or '').strip() or None
    actor = actor_from_request()
    actor_label = actor.get('label') or actor.get('email')

    from ..odoo_alta import OdooAlta
    from ..odoo_payments import crear_account_payment_move
    from .. import config as appcfg
    company_id = getattr(appcfg, 'ODOO_COMPANY', 3) or 3

    try:
        o = OdooAlta(); o._connect()
        mv = o._call('account.move', 'read', [move_id],
                     ['state', 'amount_residual', 'amount_total', 'partner_id', 'company_id', 'move_type'])
    except Exception as e:
        log.exception('cobrar_move_odoo:read')
        return jsonify({'ok': False, 'error': f'odoo_error: {e}'}), 502
    if not mv:
        return jsonify({'ok': False, 'error': 'move_no_encontrado'}), 404
    mv = mv[0]
    # Seguridad: el move debe ser de la company del manager.
    if mv.get('company_id') and company_id and mv['company_id'][0] != company_id:
        return jsonify({'ok': False, 'error': 'move_de_otra_company'}), 403
    if mv.get('move_type') != 'out_invoice':
        return jsonify({'ok': False, 'error': 'no_es_factura_cliente'}), 400
    if mv.get('state') != 'posted':
        return jsonify({'ok': False, 'error': 'move_no_posteado'}), 400

    # Resolver el cliente (id_noofit) del partner del move.
    pid = mv['partner_id'][0] if mv.get('partner_id') else None
    idnoofit = None
    if pid:
        pr = o._call('res.partner', 'read', [pid], ['id_noofit'])
        idnoofit = (pr[0].get('id_noofit') if pr else None)
    if not idnoofit:
        return jsonify({'ok': False, 'error': 'partner_sin_id_noofit'}), 400

    # SEGURIDAD: el cliente debe ser del manager y, si hay trainer impersonado,
    # de ese trainer (no cobrar recibos de otro centro).
    mgr_clientes = clientes_id_noofit_del_manager()
    if mgr_clientes is not None and str(idnoofit) not in mgr_clientes:
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    if not cliente_pertenece_a_trainer(idnoofit):
        return jsonify({'ok': False, 'error': 'not_found'}), 404

    residual = float(mv.get('amount_residual') or 0)
    total = float(mv.get('amount_total') or 0)
    if residual <= 0:
        return jsonify({'ok': False, 'error': 'ya_pagado'}), 400
    try:
        importe = float(importe_in) if importe_in not in (None, '') else residual
    except (TypeError, ValueError):
        return jsonify({'ok': False, 'error': 'importe_invalido'}), 400
    if importe <= 0:
        return jsonify({'ok': False, 'error': 'importe_invalido'}), 400

    res = crear_account_payment_move(o, company_id=company_id, move_id=move_id,
                                     cliente_idnoofit=idnoofit, importe=importe,
                                     metodo_pago=metodo, fecha=fecha)
    if not res.get('ok'):
        return jsonify({'ok': False, 'error': res.get('error') or 'cobro_falló'}), 502

    log_action(actor, entidad='recibo_odoo', entidad_id=str(move_id),
               accion='marcar_pagado',
               resumen=(f'Cobro move Odoo {move_id}: {importe:.2f}€ vía {metodo}'
                        + (f' (residual {res.get("residual")})' if res.get('residual') else '')
                        + (f' · {observacion}' if observacion else '')),
               cambios={'move_id': move_id, 'importe': importe, 'metodo': metodo,
                        'payment_id': res.get('payment_id')})
    return jsonify({'ok': True, 'payment_id': res.get('payment_id'),
                    'residual': res.get('residual'), 'payment_state': res.get('payment_state'),
                    'total': total})


# ─── Cambios de estado ────────────────────────────────────────────────────────

@bp.route('/<int:rid>/marcar-pagado', methods=['POST'])
@auth_required
@require_permission('economico.cuotas_mensuales.marcar_pagado_manual')
def marcar_pagado(rid):
    """Marca un recibo BD como pagado y refleja el cobro en Odoo creando
    el `account.payment` correspondiente (journal según el método de pago).

    Junio 2026 — Cobro parcial:
      Body acepta `importe_cobrado` opcional. Si difiere del `importe_total`
      del recibo, se exige `observacion` y se genera incidencia_admin con
      severidad='warning' tipo='pago_diferencia' para que el admin lo audite.
      El account.payment Odoo se crea por el IMPORTE COBRADO (no por el total).

    Si el recibo ya tenía `account_payment_id` (caso raro: se vuelve a marcar
    pagado tras una devolución sin haber anulado el payment previo) NO se
    crea otro — sería un duplicado contable.
    """
    d = request.get_json() or {}
    fecha = d.get('fecha') or dt.datetime.utcnow().isoformat()
    metodo = d.get('metodo')   # opcional: cambiar método al marcar pagado
    importe_cobrado_in = d.get('importe_cobrado')   # opcional, junio 2026
    observacion = (d.get('observacion') or '').strip() or None
    actor = actor_from_request()
    actor_label = actor.get('label') or actor.get('email')

    # Sprint 7 C4 — flag explícito de sobrepago. Si el cobrado > total*1.1
    # exigimos `permitir_sobrepago=true` en el body para evitar typos (e.g.
    # operador teclea 600 en lugar de 60). Tope: 10% por encima del total.
    permitir_sobrepago = bool(d.get('permitir_sobrepago'))

    # Sprint 7 C2 — TODO en UNA transacción con SELECT...FOR UPDATE
    # para evitar race "dos cobros simultáneos → 2 payments Odoo".
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT importe_total, cliente_nombre, cliente_idnoofit,
                              estado, account_payment_id, id_trainer
                         FROM recibo
                        WHERE id_manager=%s AND id=%s
                        FOR UPDATE""",
                    (str(g.id_manager), rid))
        rec = cur.fetchone()
        if not rec:
            return jsonify({'ok': False, 'error': 'not_found'}), 404
        if trainer_bloquea(rec['id_trainer']):
            return jsonify({'ok': False, 'error': 'not_found'}), 404

        # Sprint 7 C2 — guardia explícita anti-doble-cobro
        if rec['estado'] == 'pagado' and rec.get('account_payment_id'):
            return jsonify({'ok': False, 'error': 'ya_pagado',
                            'detalle': (f'El recibo ya está pagado '
                                        f'(payment Odoo #{rec["account_payment_id"]}). '
                                        'Para corregir: anula con marcar-impagado / '
                                        'marcar-devuelto primero.')}), 409

        importe_total = float(rec['importe_total'] or 0)
        # Si no envían importe_cobrado, asumimos cobro íntegro
        try:
            cobrado = (float(importe_cobrado_in)
                       if importe_cobrado_in is not None
                       else importe_total)
        except (TypeError, ValueError):
            return jsonify({'ok': False, 'error': 'importe_cobrado_invalido'}), 400
        if cobrado <= 0:
            return jsonify({'ok': False, 'error': 'importe_cobrado_no_positivo'}), 400

        diferencia = round(cobrado - importe_total, 2)
        # Diferencia significativa (1 céntimo de tolerancia por redondeo)
        es_diferencia = abs(diferencia) > 0.01

        if es_diferencia and not observacion:
            return jsonify({'ok': False, 'error': 'observacion_required',
                            'detalle': (f'El importe cobrado ({cobrado:.2f}€) difiere '
                                        f'del importe del recibo ({importe_total:.2f}€) '
                                        f'en {diferencia:+.2f}€. '
                                        'Añade una observación explicando el motivo.')}), 400

        # Sprint 7 C4 — tope sobrepago anti-typo
        if importe_total > 0 and cobrado > importe_total * 1.1 and not permitir_sobrepago:
            return jsonify({'ok': False, 'error': 'sobrepago_excede_tope',
                            'detalle': (f'Cobrado {cobrado:.2f}€ excede en >10% el '
                                        f'importe del recibo ({importe_total:.2f}€). '
                                        'Si es intencional añade '
                                        '`permitir_sobrepago: true` al body.')}), 400

        # Construir SET dinámico (UPDATE protegido por estado actual leído arriba)
        # `importe_cobrado` persiste el cobro real (antes solo vivía en memoria
        # y se perdía → el operador veía que "el campo cobro no se guardaba").
        sets = ["estado='pagado'", "fecha_pago=%s", "importe_cobrado=%s", "updated_by=%s"]
        vals = [fecha, cobrado, actor_label]
        if metodo and metodo in METODOS_VALIDOS:
            sets.append("metodo_pago=%s"); vals.append(metodo)
        if observacion:
            sets.append("notas = COALESCE(notas,'') || %s")
            vals.append(f'\n[Cobro {fecha[:10]}] {observacion}'
                        + (f' (cobrado {cobrado:.2f}€ vs {importe_total:.2f}€)'
                           if es_diferencia else ''))
        vals.extend([str(g.id_manager), rid, rec['estado']])
        cur.execute(f"""
            UPDATE recibo
               SET {', '.join(sets)}
             WHERE id_manager=%s AND id=%s AND estado=%s
            RETURNING id, cliente_idnoofit, importe_total, metodo_pago,
                      fecha_emision, account_payment_id, account_move_id
        """, vals)
        r = cur.fetchone()
    if not r:
        # El estado cambió entre SELECT FOR UPDATE y UPDATE — no debería
        # ocurrir bajo el lock, pero por defensa devolvemos 409.
        return jsonify({'ok': False, 'error': 'estado_cambio',
                        'detalle': 'El recibo cambió de estado durante la operación.'}), 409

    # ── B12/recobro — si el recibo estaba DEVUELTO y se vuelve a cobrar, es un
    # RECOBRO: lo registramos en movimiento_financiero (trazabilidad + eficacia
    # de recobro). Aditivo y fail-silent: NUNCA rompe el cobro.
    if rec['estado'] == 'devuelto':
        try:
            mref = f'RECOBRO-{rid}-{fecha[:10]}'
            with get_conn() as _c, _c.cursor() as _cur:
                _cur.execute("""
                    INSERT INTO movimiento_financiero
                        (id_manager, id_trainer, recibo_id, tipo, referencia, importe, fecha)
                    VALUES (%s,%s,%s,'recobro',%s,%s,NOW()::date)
                    ON CONFLICT (id_manager, tipo, recibo_id, referencia) DO NOTHING
                """, (str(g.id_manager), str(rec.get('id_trainer') or ''), rid, mref, cobrado))
                _c.commit()
        except Exception as e:
            log.warning(f'marcar_pagado recibo={rid}: registro recobro: {e}')

    # ── Sistema INMEDIATO (GATED): cada cobro/recobro → factura al cliente.
    # Inerte si el manager no tiene sistema='inmediata' activo. Fail-silent:
    # NUNCA rompe el cobro. La alineación factura↔payment↔reconcile completa
    # se cierra en la activación/migración (punto 5).
    try:
        from .. import facturacion_engine as _ENG
        _cfg = _ENG.config_activa(g.id_manager)
        if _cfg and _cfg.get('activo') and _cfg.get('sistema') == 'inmediata':
            with get_conn() as _c, _c.cursor() as _cur:
                _cur.execute("""SELECT cuota_codigo, importe_base, id_trainer,
                                       cliente_idnoofit, periodo
                                  FROM recibo WHERE id_manager=%s AND id=%s""",
                             (str(g.id_manager), rid))
                _rr = _cur.fetchone()
            if _rr:
                _iva = _ENG._iva_pct_de_cuota(str(g.id_manager), _rr['cuota_codigo'], _rr['id_trainer'])
                _ENG.facturar_inmediata(
                    str(g.id_manager), _rr['cliente_idnoofit'], _rr['id_trainer'],
                    [{'concepto': f"{_rr['cuota_codigo'] or 'Cuota'} · {_rr['periodo']}",
                      'base': float(_rr['importe_base'] or 0), 'iva_pct': _iva}],
                    mov_ref=f'COBRO-{rid}', postear=True)
    except Exception as e:
        log.warning(f'marcar_pagado recibo={rid}: hook facturación inmediata: {e}')

    # ── Reflejar en Odoo: crear account.payment si no existía aún ─────────
    # IMPORTE: el payment se crea por el IMPORTE COBRADO (no por importe_total
    # del recibo). Si hay factura y el cobrado es parcial, tras reconciliar
    # la factura queda en estado 'partial' (residual positivo) — visible para
    # auditoría contable.
    payment_id = r.get('account_payment_id')
    odoo_warning = None
    # C3 (junio 2026) — política "cobro a cuenta" acordada:
    #   · Si el recibo YA tiene factura Odoo (account_move_id, posteada) →
    #     reconciliamos el payment contra ella (la factura queda pagada o
    #     parcial según el importe cobrado).
    #   · Si NO hay factura → el payment queda como crédito a cuenta del
    #     cliente (partner_type=customer). Cuando la facturación mensual/
    #     trimestral emita la factura, se neteará contra este crédito.
    reconciliado = False
    if not payment_id:
        try:
            from ..odoo_alta import OdooAlta
            from ..odoo_payments import crear_account_payment, vincular_payment_a_recibo
            from .. import config as appcfg
            company_id = getattr(appcfg, 'ODOO_COMPANY', 3) or 3
            o = OdooAlta(); o._connect()
            res = crear_account_payment(
                o, company_id=company_id, recibo_id=r['id'],
                cliente_idnoofit=r['cliente_idnoofit'],
                importe_total=cobrado,      # ← cobrado real, no total
                metodo_pago=r['metodo_pago'],
                fecha_emision=fecha,
            )
            if res['ok']:
                vincular_payment_a_recibo(r['id'], res['payment_id'],
                                           fecha_pago=fecha,
                                           actor_label=actor_label or 'marcar_pagado')
                payment_id = res['payment_id']
                # B9 — reflejo Odoo OK
                try:
                    with get_conn() as _c, _c.cursor() as _cur:
                        _cur.execute("UPDATE recibo SET sync_status='synced', "
                                     "sync_error=NULL, sync_attempted_at=now() WHERE id=%s", (r['id'],))
                        _c.commit()
                except Exception: pass
                # Reconciliar contra la factura SOLO si existe y está posteada.
                move_id = r.get('account_move_id')
                if move_id:
                    try:
                        from ..odoo_pos_sync import _reconcile
                        inv = o._call('account.move', 'read', [move_id], ['state'])
                        estado_inv = inv[0].get('state') if inv else None
                        if estado_inv == 'posted':
                            _reconcile(o, move_id, payment_id, company_id)
                            reconciliado = True
                        else:
                            log.info(f'marcar_pagado recibo={rid}: factura {move_id} '
                                     f'no posteada (state={estado_inv}); payment queda '
                                     f'a cuenta del cliente hasta facturar')
                    except Exception as e:
                        # No fatal: el payment existe y queda a cuenta. La
                        # conciliación se puede reintentar al facturar.
                        log.warning(f'marcar_pagado recibo={rid}: reconcile contra '
                                    f'factura {move_id} falló (queda a cuenta): {e}')
            else:
                odoo_warning = res['error']
                log.warning(f'marcar_pagado recibo={rid} → Odoo NO actualizado: {res["error"]}')
                # B9 — a la cola de reintento (cron_odoo_sync_retry)
                try:
                    with get_conn() as _c, _c.cursor() as _cur:
                        _cur.execute("UPDATE recibo SET sync_status='pending', "
                                     "sync_error=%s, sync_attempted_at=now() WHERE id=%s",
                                     ((res.get('error') or '')[:500], rid))
                        _c.commit()
                except Exception: pass
        except Exception as e:
            odoo_warning = str(e)
            log.exception(f'marcar_pagado recibo={rid}: error Odoo')
            # B9 — a la cola de reintento
            try:
                with get_conn() as _c, _c.cursor() as _cur:
                    _cur.execute("UPDATE recibo SET sync_status='pending', "
                                 "sync_error=%s, sync_attempted_at=now() WHERE id=%s",
                                 (str(e)[:500], rid))
                    _c.commit()
            except Exception: pass

    log_action(actor, entidad='recibo', entidad_id=rid, accion='marcar_pagado',
               resumen=(f"Recibo {rid} pagado vía {r['metodo_pago']} · "
                        f"cobrado {cobrado:.2f}€" +
                        (f" (esperado {importe_total:.2f}€, "
                         f"diff {diferencia:+.2f}€)" if es_diferencia else "") +
                        (f" · payment Odoo={payment_id}" if payment_id else
                         f" · ⚠️ Odoo no actualizado: {odoo_warning}")))

    # Sprint 7 H3 — si Odoo falló, también incidencia (severidad error).
    # Antes solo había `warning` en la respuesta HTTP que nadie revisaba.
    if odoo_warning:
        try:
            from ..incidencias import crear_incidencia_admin
            crear_incidencia_admin(
                id_manager=g.id_manager, id_trainer=g.id_trainer,
                tipo='odoo_no_actualizado',
                entidad='recibo', entidad_id=rid,
                severidad='error',
                titulo=f'Cobro recibo #{rid} sin reflejo en Odoo',
                mensaje=(f'Recibo BD marcado pagado ({cobrado:.2f}€) pero el '
                         f'account.payment Odoo NO se creó. '
                         f'Reintenta cobro o registra el payment manual en Odoo. '
                         f'Error: {odoo_warning}'),
                meta={'importe_cobrado': cobrado,
                      'metodo_pago': r['metodo_pago'],
                      'cliente_idnoofit': r['cliente_idnoofit'],
                      'error_odoo': str(odoo_warning)[:400]},
                created_by=actor_label,
            )
        except Exception:
            log.exception('crear incidencia odoo_no_actualizado')

    # Junio 2026 — Si hubo diferencia de importe, genera incidencia para
    # bandeja del admin (severidad warning).
    if es_diferencia:
        try:
            from ..incidencias import crear_incidencia_admin
            crear_incidencia_admin(
                id_manager=g.id_manager, id_trainer=g.id_trainer,
                tipo='pago_diferencia',
                entidad='recibo', entidad_id=rid,
                severidad='warning',
                titulo=(f'Cobro parcial recibo #{rid} '
                        f'({diferencia:+.2f}€)'),
                mensaje=(f'Cliente {rec["cliente_nombre"] or rec["cliente_idnoofit"]}: '
                         f'cobrado {cobrado:.2f}€ frente a importe esperado '
                         f'{importe_total:.2f}€ (diferencia {diferencia:+.2f}€). '
                         f'Observación operador: {observacion}'),
                meta={'importe_esperado': importe_total,
                      'importe_cobrado': cobrado,
                      'diferencia': diferencia,
                      'metodo_pago': r['metodo_pago'],
                      'cliente_idnoofit': r['cliente_idnoofit'],
                      'observacion': observacion},
                created_by=actor_label,
            )
        except Exception:
            log.exception('crear incidencia pago_diferencia')

    resp = {'ok': True, 'account_payment_id': payment_id,
            'importe_cobrado': cobrado, 'diferencia': diferencia,
            'reconciliado': reconciliado}
    if odoo_warning:
        resp['warning'] = f'odoo_no_actualizado: {odoo_warning}'
    return jsonify(resp)


@bp.route('/<int:rid>/marcar-impagado', methods=['POST'])
@auth_required
@require_permission('economico.cuotas_mensuales.anular_pago')
def marcar_impagado(rid):
    actor = actor_from_request()
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT id_trainer, estado FROM recibo WHERE id_manager=%s AND id=%s",
                    (str(g.id_manager), rid))
        guard = cur.fetchone()
        if not guard or trainer_bloquea(guard['id_trainer']):
            return jsonify({'ok': False, 'error': 'not_found'}), 404
        # Guard de transición (auditoría #31 · #1): 'cancelado' y 'facturado' son
        # estados finales/contabilizados — no se reabren a 'impagado' desde aquí
        # (reviviría a cobro un recibo anulado, o desincronizaría la factura Odoo
        # ya posteada). Para un facturado que se rechaza: nota de crédito en Odoo.
        if guard['estado'] in ('cancelado', 'facturado'):
            return jsonify({'ok': False, 'error': 'estado_no_permite_impagado',
                            'detalle': f"Recibo {guard['estado']}: no se puede marcar impagado. "
                                       f"Si es facturado y se rechaza, emite una nota de crédito "
                                       f"en Odoo."}), 400
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
@require_permission('economico.cuotas_mensuales.anular_pago')
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
        cur.execute("""SELECT id, cliente_idnoofit, account_payment_id, estado, intentos_cobro, id_trainer
                         FROM recibo WHERE id_manager=%s AND id=%s""",
                    (str(g.id_manager), rid))
        r = cur.fetchone()
    if not r:
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    if trainer_bloquea(r['id_trainer']):
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    # Guard de transición (auditoría #31 · #2): un recibo 'facturado' tiene una
    # factura Odoo posteada; marcarlo devuelto aquí anularía solo el payment y
    # dejaría la factura huérfana (descuadre SII). La devolución de un facturado
    # exige nota de crédito en Odoo, no este flujo.
    if r['estado'] == 'facturado':
        return jsonify({'ok': False, 'error': 'estado_no_permite_devolver',
                        'detalle': 'Recibo facturado: emite una nota de crédito en Odoo antes '
                                   'de marcarlo devuelto (no dejar la factura sin conciliar).'}), 400

    pago_anulado = False
    if r.get('account_payment_id'):
        try:
            from ..odoo_alta import OdooAlta
            o = OdooAlta(); o._connect()
            pid = r['account_payment_id']
            try:
                # CORRECCIÓN (mayo 2026): el _call hace `list(args)` así que
                # pasar `[pid]` envía `[[pid]]` a Odoo, que es la firma
                # correcta de `action_cancel(ids)`. Antes pasábamos `[[pid]]`
                # → `[[[pid]]]` y Odoo crasheaba con "unhashable type: list".
                o._call('account.payment', 'action_cancel', [pid])
                pago_anulado = True
            except Exception as e:
                # Algunos pagos no pueden cancelarse (ya conciliados); intentar draft
                log.warning(f'action_cancel falló para payment {pid}: {e}')
                try:
                    o._call('account.payment', 'action_draft', [pid])
                    # Tras pasar a borrador, sí se puede cancelar
                    o._call('account.payment', 'action_cancel', [pid])
                    pago_anulado = True
                except Exception as e2:
                    log.warning(f'action_draft+cancel también falló: {e2}')
                    # Último recurso: anular el move asociado vía SQL es opción,
                    # pero no es seguro hacerlo desde aquí. Dejamos rastro y
                    # el operador lo cancela manualmente en Odoo.
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
@require_permission('economico.cuotas_mensuales.generar_link_pago')
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
                              link_pago_token, link_pago_pagado_at, id_trainer
                         FROM recibo WHERE id_manager=%s AND id=%s""",
                    (str(g.id_manager), rid))
        r = cur.fetchone()
    if not r:
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    if trainer_bloquea(r['id_trainer']):
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


@bp.route('/manuales/<mes>', methods=['GET'])
@auth_required
@require_seccion('economico.cuotas_mensuales')
def list_manuales_mes(mes):
    """Lista los recibos manuales en estado `borrador_remesa` para un mes
    (YYYY-MM). Estos recibos:
      - se crean desde el tab "Recibos manuales para remesa"
      - aparecen en la validación junto a los auto-generados
      - se transicionan a `pagado` / `impagado` al ejecutar `emision_v2`
      - hasta entonces son editables y borrables

    Filtra por trainer si está impersonado.
    """
    where = ['id_manager = %s', 'periodo = %s', "estado = 'borrador_remesa'"]
    vals = [str(g.id_manager), mes]
    apply_trainer_filter_direct(where, vals, include_nulls=False)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"""
            SELECT {_select_recibo_cols()}
              FROM recibo
             WHERE {' AND '.join(where)}
             ORDER BY created_at DESC, id DESC
        """, vals)
        rows = cur.fetchall()
    return jsonify({'ok': True, 'recibos': rows, 'count': len(rows)})


@bp.route('/cliente/<id_noofit>', methods=['GET'])
@auth_required
@require_seccion('economico.cuotas_mensuales')
def list_cliente(id_noofit):
    """Recibos de un cliente concreto. Si el usuario está impersonando un
    trainer y el cliente no pertenece a ese trainer → 404 (no filtrar
    silenciosamente: dejar claro que no existe en su contexto)."""
    if not cliente_pertenece_a_trainer(id_noofit):
        return jsonify({'ok': True, 'recibos': []})
    where = ['id_manager = %s', 'cliente_idnoofit = %s']
    vals = [str(g.id_manager), id_noofit]
    apply_trainer_filter_direct(where, vals, include_nulls=False)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"""
            SELECT {_select_recibo_cols()}
              FROM recibo
             WHERE {' AND '.join(where)}
             ORDER BY fecha_emision DESC, id DESC
        """, vals)
        rows = cur.fetchall()
    return jsonify({'ok': True, 'recibos': rows})


@bp.route('/stats', methods=['GET'])
@auth_required
@require_seccion('economico.cuotas_mensuales')
def stats():
    """Stats por estado/método/periodo (para dashboards)."""
    qs = request.args
    where = ['id_manager = %s']; vals = [str(g.id_manager)]
    apply_trainer_filter_direct(where, vals, include_nulls=False)
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


@bp.route('/facturacion-resumen', methods=['GET'])
@auth_required
@require_seccion('economico.cuotas_mensuales')
def facturacion_resumen():
    """Resumen de facturación agrupable por año/trimestre/mes × tipo de cobro
    (metodo_pago), con importes cobrados / impagados / pendientes. Devuelve
    filas planas (periodo = YYYY-MM + trimestre + método) y el frontend arma
    el árbol con subtotales.

    Buckets por estado:
      - cobrado   = pagado, facturado
      - impagado  = impagado, devuelto
      - pendiente = emitido, pendiente, borrador_remesa
      - (cancelado se excluye)

    Periodo efectivo: `periodo` (YYYY-MM) o, si falta, mes de `fecha_emision`.
    Filtros opcionales: ?anio=YYYY, ?id_trainer (respeta scope por trainer).
    """
    qs = request.args
    where = ["id_manager = %s", "estado <> 'cancelado'"]
    vals = [str(g.id_manager)]
    apply_trainer_filter_direct(where, vals, include_nulls=False)

    sub2 = f"""
        SELECT importe_total, estado, metodo_pago AS metodo, id_trainer,
               COALESCE(NULLIF(periodo, ''), to_char(fecha_emision, 'YYYY-MM')) AS pe
          FROM recibo
         WHERE {' AND '.join(where)}
    """
    outer_where = ["pe ~ '^[0-9]{4}-[0-9]{2}'"]
    outer_vals = []
    if qs.get('anio'):
        outer_where.append("left(pe, 4) = %s"); outer_vals.append(qs['anio'][:4])
    # Añadimos id_trainer al agrupado: cuando la consulta la hace el manager
    # (sin trainer impersonado) el frontend desglosa cada agrupación temporal
    # por trainer. Los subtotales por año/trimestre/mes se recalculan en el
    # cliente sumando todas las filas, así que siguen siendo cross-trainer.
    sql = f"""
        SELECT left(pe, 4)                               AS anio,
               ceil(substring(pe, 6, 2)::int / 3.0)::int AS trimestre,
               pe                                        AS periodo,
               substring(pe, 6, 2)                       AS mes,
               COALESCE(id_trainer, '(sin trainer)')     AS id_trainer,
               COALESCE(NULLIF(metodo, ''), '(sin metodo)') AS metodo,
               SUM(CASE WHEN estado IN ('pagado','facturado')        THEN importe_total ELSE 0 END) AS cobrado_imp,
               COUNT(*) FILTER (WHERE estado IN ('pagado','facturado'))        AS cobrado_n,
               SUM(CASE WHEN estado IN ('impagado','devuelto')       THEN importe_total ELSE 0 END) AS impagado_imp,
               COUNT(*) FILTER (WHERE estado IN ('impagado','devuelto'))       AS impagado_n,
               SUM(CASE WHEN estado IN ('emitido','pendiente','borrador_remesa') THEN importe_total ELSE 0 END) AS pendiente_imp,
               COUNT(*) FILTER (WHERE estado IN ('emitido','pendiente','borrador_remesa')) AS pendiente_n
          FROM ({sub2}) x
         WHERE {' AND '.join(outer_where)}
         GROUP BY anio, trimestre, periodo, mes, id_trainer, metodo
         ORDER BY anio, trimestre, periodo, id_trainer, metodo
    """
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(sql, vals + outer_vals)
        rows = cur.fetchall()
        # Mapa id_trainer → nombre de centro (para etiquetar el desglose).
        cur.execute("""SELECT id_trainer, nombre_centro FROM centro_contacto
                        WHERE id_manager = %s""", (str(g.id_manager),))
        trainers = {str(t['id_trainer']): t['nombre_centro']
                    for t in cur.fetchall() if t.get('id_trainer')}
    for r in rows:
        for k in ('cobrado_imp', 'impagado_imp', 'pendiente_imp'):
            r[k] = float(r[k] or 0)
    return jsonify({'ok': True, 'filas': rows, 'trainers': trainers,
                    'es_manager': not getattr(g, 'id_trainer', None)})
