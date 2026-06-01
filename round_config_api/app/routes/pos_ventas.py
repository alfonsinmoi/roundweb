"""POS — registro de ventas del TPV (Fase 2, mayo 2026).

Endpoints:
  POST   /api/pos/ventas              crea una venta a partir del carrito
  GET    /api/pos/ventas              listado con filtros
  GET    /api/pos/ventas/<id>         detalle (cabecera + líneas)
  POST   /api/pos/ventas/<id>/anular  marca anulada (revierte stock si aplica)

Política trainer (mayo 2026): cada venta lleva su `id_trainer` (centro
físico donde se hizo). Si el operador está impersonando un trainer, ese
se asume automáticamente. Manager bare debe enviar `id_trainer` en el
body o se rechaza 400.

Sync Odoo: pendiente Fase 4. De momento se guarda solo en BD propia y
los campos `odoo_*` quedan a NULL.

Stock: si la línea tiene `producto_id` y el producto es `inventariable`,
se descuenta automáticamente del `pos_producto.stock_actual` y se inserta
un movimiento de tipo `venta` en `pos_stock_movimiento`. La anulación
revierte el stock.
"""
import logging
import datetime as dt
from decimal import Decimal, ROUND_HALF_UP
from flask import Blueprint, request, jsonify, g

from ..auth import auth_required, require_permission, resolve_trainer_target
from ..db import get_conn
from ..audit_log import log_action, actor_from_request

bp = Blueprint('pos_ventas', __name__)
log = logging.getLogger(__name__)


METODOS_PAGO_VALIDOS = {
    'efectivo', 'tarjeta', 'recibo_mensual',
    'transferencia', 'link_pago', 'bizum',
}


def _q2(x):
    """Redondeo financiero a 2 decimales (HALF_UP)."""
    return Decimal(str(x or 0)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def _calcular_linea(precio_unit, cantidad, iva_pct):
    """Dado precio con IVA incluido, cantidad e IVA%, devuelve
    (subtotal, iva_importe, total) ya redondeados."""
    precio_unit = _q2(precio_unit)
    cantidad    = Decimal(str(cantidad or 0))
    iva_pct     = Decimal(str(iva_pct or 0))
    total       = _q2(precio_unit * cantidad)
    base        = (total / (Decimal('1') + iva_pct / Decimal('100')))
    base        = _q2(base)
    iva_imp     = _q2(total - base)
    return base, iva_imp, total


def _siguiente_numero(cur, manager, trainer):
    """Genera 'T-2026-00001' por trainer y año.

    Audit #9 mayo 2026: usa `pg_advisory_xact_lock(hash(manager,trainer,año))`
    para serializar dos cobros concurrentes del mismo trainer. Sin esto, dos
    cajeros simultáneos calculan el mismo N y violan UNIQUE (manager,trainer,
    numero) — o peor, generan duplicados de número fiscal (incumple SII).
    El lock se libera automáticamente al COMMIT de la transacción.
    """
    año = dt.date.today().year
    # Clave de lock: int64 derivado del trío (manager,trainer,año). PostgreSQL
    # acepta cualquier bigint; usamos hashtextextended para una clave estable.
    lock_key = f'pos_venta_num:{manager}:{trainer}:{año}'
    cur.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (lock_key,))
    cur.execute("""
        SELECT COUNT(*) AS n FROM pos_venta
         WHERE id_manager = %s AND id_trainer = %s
           AND EXTRACT(YEAR FROM fecha) = %s
    """, (str(manager), str(trainer), año))
    n = cur.fetchone()['n'] + 1
    return f'T-{año}-{n:05d}'


# ═══════════════════════════════════════════════════════════════════════
#                              CREAR VENTA
# ═══════════════════════════════════════════════════════════════════════

@bp.route('/ventas', methods=['POST'])
@auth_required
@require_permission('tpv.ventas.cobrar')
def crear_venta():
    """Body:
      {
        cliente_id?: 'NF id',
        cliente_nombre?: 'snapshot' (req si no hay id),
        cliente_email?: '...',
        metodo_pago: 'efectivo'|...,
        notas?: '...',
        id_trainer?: 'X' (manager bare),
        lineas: [
          { producto_id?, codigo?, nombre, cantidad, precio_unit, iva_pct,
            cuenta_contable?, tipo? }
        ]
      }
    """
    d = request.get_json() or {}
    lineas_in = d.get('lineas') or []
    if not lineas_in:
        return jsonify({'ok': False, 'error': 'lineas_vacias'}), 400
    metodo = (d.get('metodo_pago') or '').strip().lower()
    if metodo not in METODOS_PAGO_VALIDOS:
        return jsonify({'ok': False, 'error': 'metodo_pago_invalido',
                        'detalle': f'Acepta: {sorted(METODOS_PAGO_VALIDOS)}'}), 400

    target_trainer = (d.get('id_trainer') or '').strip() or g.id_trainer
    if not target_trainer:
        return jsonify({'ok': False, 'error': 'id_trainer_required',
                        'detalle': 'Selecciona el centro o impersona un trainer.'}), 400

    cliente_id     = (d.get('cliente_id') or '').strip() or None
    cliente_nombre = (d.get('cliente_nombre') or '').strip() or None
    cliente_email  = (d.get('cliente_email') or '').strip() or None

    # Si recibo_mensual, exige cliente + odoo_cuotas_enabled.
    # Sin Odoo activado, la venta se INSERTARÍA pero aplicar_a_recibo_mensual
    # la marcaría 'skipped' y el cliente nunca se facturaría → pérdida
    # silenciosa de ingresos. Rechazamos a la cara.
    if metodo == 'recibo_mensual':
        if not cliente_id:
            return jsonify({'ok': False, 'error': 'cliente_required_para_recibo'}), 400
        with get_conn() as _c, _c.cursor() as _cur:
            _cur.execute("SELECT odoo_cuotas_enabled FROM manager_config WHERE id_manager=%s",
                         (str(g.id_manager),))
            _row = _cur.fetchone()
        if not _row or not _row.get('odoo_cuotas_enabled'):
            return jsonify({'ok': False, 'error': 'odoo_cuotas_required',
                            'detalle': 'El método "Cargo a recibo mensual" '
                                       'requiere que el manager tenga el módulo '
                                       'Cuotas activado en Configuración → Suscripciones.'}), 400

    actor       = actor_from_request()
    actor_label = actor.get('label') or actor.get('email') or 'tpv'

    subtotal_t = Decimal('0'); iva_t = Decimal('0'); total_t = Decimal('0')
    lineas_calc = []
    for l in lineas_in:
        cant = Decimal(str(l.get('cantidad') or 0))
        tipo_l = (l.get('tipo') or 'producto').strip().lower()
        # Descuento: cantidad 1, precio negativo permitido (sin stock).
        # Audit mayo 2026: una línea descuento NO puede llevar producto_id —
        # si llevara, el snap_tipo se sobreescribiría con el del producto y
        # quedaría persistida como tipo='producto' con precio negativo y
        # descuento de stock, abriendo abuso (phantom discount + stock spoof).
        if tipo_l == 'descuento':
            if l.get('producto_id'):
                return jsonify({'ok': False, 'error': 'descuento_no_admite_producto_id',
                                'detalle': 'Las líneas tipo=descuento se aplican al ticket, no llevan producto_id.'}), 400
            if cant == 0:
                cant = Decimal('1')
        elif cant <= 0:
            return jsonify({'ok': False, 'error': 'cantidad_invalida',
                            'detalle': f'línea "{l.get("nombre")}" cant={cant}'}), 400
        pu = _q2(l.get('precio_unit'))
        if pu < 0 and tipo_l != 'descuento':
            return jsonify({'ok': False, 'error': 'precio_invalido',
                            'detalle': f'precio negativo solo para tipo descuento (línea "{l.get("nombre")}")'}), 400
        iva_pct = Decimal(str(l.get('iva_pct') or 21))
        base, iva_imp, total = _calcular_linea(pu, cant, iva_pct)
        subtotal_t += base; iva_t += iva_imp; total_t += total
        lineas_calc.append({
            **l, '_base': base, '_iva': iva_imp, '_total': total,
            '_cant': cant, '_pu': pu, '_iva_pct': iva_pct,
        })
    # Total puede ser 0€ pero no negativo
    if total_t < 0:
        return jsonify({'ok': False, 'error': 'total_negativo',
                        'detalle': 'Los descuentos superan el importe del ticket'}), 400

    try:
        with get_conn() as conn, conn.cursor() as cur:
            # Lock optimista de filas de stock para evitar carreras si dos cajeros
            # venden el mismo producto a la vez.
            prod_ids = [int(l['producto_id']) for l in lineas_calc
                        if l.get('producto_id')]
            stock_map = {}   # producto_id → (antes, inventariable, nombre)
            if prod_ids:
                cur.execute("""SELECT id, stock_actual, inventariable, nombre,
                                       codigo, cuenta_contable, tipo, id_trainer
                                 FROM pos_producto
                                WHERE id = ANY(%s) AND id_manager = %s
                                FOR UPDATE""",
                            (prod_ids, str(g.id_manager)))
                for r in cur.fetchall():
                    stock_map[r['id']] = r
                # Verifica que todos los productos son del trainer correcto
                for pid in prod_ids:
                    pr = stock_map.get(pid)
                    if not pr:
                        return jsonify({'ok': False, 'error': 'producto_no_encontrado',
                                        'detalle': f'id={pid}'}), 404
                    if str(pr.get('id_trainer') or '') and str(pr['id_trainer']) != str(target_trainer):
                        return jsonify({'ok': False, 'error': 'producto_otro_centro',
                                        'detalle': f'{pr["nombre"]} ({pr["codigo"]}) pertenece a otro centro.'}), 400

            numero = _siguiente_numero(cur, g.id_manager, target_trainer)
            cur.execute("""
                INSERT INTO pos_venta
                  (id_manager, id_trainer, numero, cliente_id, cliente_nombre,
                   cliente_email, subtotal, iva, total, metodo_pago,
                   estado, notas, created_by)
                VALUES (%s, %s, %s, %s, %s,
                        %s, %s, %s, %s, %s,
                        'completada', %s, %s)
                RETURNING id, fecha
            """, (str(g.id_manager), str(target_trainer), numero,
                  cliente_id, cliente_nombre, cliente_email,
                  _q2(subtotal_t), _q2(iva_t), _q2(total_t),
                  metodo, (d.get('notas') or None), actor_label))
            row = cur.fetchone()
            venta_id = row['id']

            for l in lineas_calc:
                pid = l.get('producto_id')
                snap_codigo = l.get('codigo') or ''
                snap_nombre = l.get('nombre') or '(sin nombre)'
                snap_cuenta = l.get('cuenta_contable')
                snap_tipo   = (l.get('tipo') or 'producto').strip().lower()
                # Líneas descuento NUNCA derivan datos de un producto.
                # (Above validamos que descuento → no producto_id, así que
                # pid in stock_map sería imposible aquí; defensa redundante.)
                if pid and pid in stock_map and snap_tipo != 'descuento':
                    pr = stock_map[int(pid)]
                    snap_codigo = snap_codigo or pr['codigo']
                    snap_nombre = pr['nombre']
                    snap_cuenta = snap_cuenta or pr['cuenta_contable']
                    snap_tipo   = pr['tipo']

                cur.execute("""
                    INSERT INTO pos_venta_linea
                      (venta_id, producto_id, codigo, nombre, cantidad,
                       precio_unit, iva_pct, subtotal, iva_importe, total,
                       cuenta_contable, tipo)
                    VALUES (%s, %s, %s, %s, %s,
                            %s, %s, %s, %s, %s,
                            %s, %s)
                """, (venta_id, pid, snap_codigo, snap_nombre, l['_cant'],
                      l['_pu'], l['_iva_pct'], l['_base'], l['_iva'], l['_total'],
                      snap_cuenta, snap_tipo))

                # Descuento de stock si es inventariable
                if pid and pid in stock_map and stock_map[int(pid)]['inventariable']:
                    pr = stock_map[int(pid)]
                    antes = Decimal(str(pr['stock_actual'] or 0))
                    despues = antes - l['_cant']
                    cur.execute("""UPDATE pos_producto
                                      SET stock_actual = %s
                                    WHERE id = %s""", (despues, pid))
                    cur.execute("""
                        INSERT INTO pos_stock_movimiento
                          (id_manager, id_trainer, producto_id, tipo, cantidad,
                           stock_antes, stock_despues, venta_id, motivo, created_by)
                        VALUES (%s, %s, %s, 'venta', %s, %s, %s, %s, %s, %s)
                    """, (str(g.id_manager), str(target_trainer), pid,
                          -l['_cant'], antes, despues, venta_id,
                          f'Venta {numero}', actor_label))
                    # Refrescar para que las próximas líneas del MISMO producto
                    # en este body usen el stock actualizado
                    pr['stock_actual'] = despues

        log_action(actor, entidad='pos_venta', entidad_id=venta_id,
                   accion='create',
                   resumen=f'Venta {numero} · {len(lineas_calc)} líneas · {total_t:.2f}€ · {metodo}')

        # Sync Odoo en background — no bloquea la respuesta al TPV. Si falla,
        # queda registrado en pos_venta.sync_status='error' y se puede
        # reintentar manualmente desde el frontend.
        try:
            from ..odoo_pos_sync import sync_async
            sync_async(g.id_manager, venta_id)
        except Exception:
            log.exception('disparando sync_async')

        return jsonify({'ok': True, 'id': venta_id, 'numero': numero,
                        'fecha': row['fecha'].isoformat(),
                        'subtotal': float(subtotal_t),
                        'iva': float(iva_t),
                        'total': float(total_t)}), 201

    except Exception as e:
        log.exception('crear_venta')
        return jsonify({'ok': False, 'error': str(e)}), 500


# ═══════════════════════════════════════════════════════════════════════
#                              LISTADO
# ═══════════════════════════════════════════════════════════════════════

@bp.route('/ventas', methods=['GET'])
@auth_required
@require_permission('tpv.ventas.ver')
def listar_ventas():
    """Filtros: ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&metodo=&estado=&cliente_id=
              &id_trainer=&limit=200"""
    qs = request.args
    where = ['v.id_manager = %s']
    vals  = [str(g.id_manager)]
    target_trainer, forbidden = resolve_trainer_target(qs.get('id_trainer'))
    if forbidden:
        return jsonify({'ok': False, 'error': 'forbidden_trainer',
                        'detalle': 'No puedes consultar otro centro.'}), 403
    if target_trainer:
        where.append('v.id_trainer = %s'); vals.append(str(target_trainer))
    if qs.get('desde'):
        where.append('v.fecha >= %s'); vals.append(qs['desde'])
    if qs.get('hasta'):
        where.append('v.fecha < (%s::date + 1)'); vals.append(qs['hasta'])
    if qs.get('metodo'):
        where.append('v.metodo_pago = %s'); vals.append(qs['metodo'])
    if qs.get('estado'):
        where.append('v.estado = %s'); vals.append(qs['estado'])
    if qs.get('cliente_id'):
        where.append('v.cliente_id = %s'); vals.append(qs['cliente_id'])
    limit = min(int(qs.get('limit') or 200), 1000)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"""
            SELECT v.id, v.numero, v.fecha, v.id_trainer,
                   v.cliente_id, v.cliente_nombre, v.cliente_email,
                   v.subtotal, v.iva, v.total, v.metodo_pago, v.estado,
                   v.notas, v.created_by,
                   v.sync_status, v.sync_error, v.odoo_move_id, v.odoo_payment_id,
                   v.odoo_refund_move_id, v.recibo_id,
                   (SELECT COUNT(*) FROM pos_venta_linea WHERE venta_id = v.id) AS num_lineas
              FROM pos_venta v
             WHERE {' AND '.join(where)}
             ORDER BY v.fecha DESC
             LIMIT %s
        """, vals + [limit])
        rows = []
        for r in cur.fetchall():
            o = dict(r)
            if o.get('fecha'): o['fecha'] = o['fecha'].isoformat()
            for k in ('subtotal', 'iva', 'total'):
                if o.get(k) is not None: o[k] = float(o[k])
            rows.append(o)
    return jsonify({'ok': True, 'ventas': rows})


# ═══════════════════════════════════════════════════════════════════════
#                              DETALLE
# ═══════════════════════════════════════════════════════════════════════

@bp.route('/ventas/<int:vid>', methods=['GET'])
@auth_required
@require_permission('tpv.ventas.ver')
def detalle_venta(vid):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT * FROM pos_venta
                        WHERE id = %s AND id_manager = %s""",
                    (vid, str(g.id_manager)))
        cab = cur.fetchone()
        if not cab:
            return jsonify({'ok': False, 'error': 'not_found'}), 404
        cur.execute("""SELECT * FROM pos_venta_linea
                        WHERE venta_id = %s ORDER BY id""", (vid,))
        lineas = cur.fetchall()
    # JSON-safe
    def _ser(r):
        o = dict(r)
        for k, v in list(o.items()):
            if hasattr(v, 'isoformat'): o[k] = v.isoformat()
            if isinstance(v, Decimal):  o[k] = float(v)
        return o
    return jsonify({'ok': True,
                    'venta': _ser(cab),
                    'lineas': [_ser(l) for l in lineas]})


# ═══════════════════════════════════════════════════════════════════════
#                              ANULAR
# ═══════════════════════════════════════════════════════════════════════

@bp.route('/dashboard', methods=['GET'])
@auth_required
@require_permission('tpv.dashboard.ver')
def dashboard():
    """KPIs agregados de ventas TPV (Fase 9, mayo 2026).

    Filtros: ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&id_trainer=X
    Defaults: últimos 30 días, trainer impersonado si aplica.

    Devuelve:
      {
        ok, desde, hasta, id_trainer,
        kpis: {total_periodo, num_ventas, ticket_medio, num_anuladas,
               total_anulado, total_periodo_anterior, variacion_pct},
        por_metodo: {efectivo, tarjeta, ...},
        serie_dia: [{fecha, total, n_ventas}],
        top_productos: [{producto_id, codigo, nombre, cantidad, importe}],
        top_clientes:  [{cliente_id, cliente_nombre, n, total}]
      }
    """
    qs = request.args
    # Sprint 4 #H2 — validar fechas client side
    try:
        hasta_d = dt.date.fromisoformat(qs.get('hasta') or dt.date.today().isoformat())
        desde_d = dt.date.fromisoformat(
            qs.get('desde') or (hasta_d - dt.timedelta(days=30)).isoformat())
    except (TypeError, ValueError):
        return jsonify({'ok': False, 'error': 'fecha_invalida'}), 400
    if desde_d > hasta_d:
        return jsonify({'ok': False, 'error': 'desde_posterior_hasta'}), 400
    hasta = hasta_d.isoformat(); desde = desde_d.isoformat()
    # Sprint 4 #C3 — bloquear cross-trainer leak
    id_trainer, forbidden = resolve_trainer_target(qs.get('id_trainer'))
    if forbidden:
        return jsonify({'ok': False, 'error': 'forbidden_trainer'}), 403

    where = ["v.id_manager=%s", "v.estado='completada'",
             "v.fecha >= %s::date", "v.fecha < (%s::date + 1)"]
    vals = [str(g.id_manager), desde, hasta]
    where_anul = list(where); vals_anul = list(vals)
    where_anul[1] = "v.estado='anulada'"
    if id_trainer:
        where.append('v.id_trainer=%s'); vals.append(str(id_trainer))
        where_anul.append('v.id_trainer=%s'); vals_anul.append(str(id_trainer))

    with get_conn() as conn, conn.cursor() as cur:
        # KPI totales periodo
        cur.execute(f"""
            SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS suma
              FROM pos_venta v WHERE {' AND '.join(where)}
        """, vals)
        kpi = cur.fetchone()

        # Periodo anterior (mismo nº días)
        dias = (dt.date.fromisoformat(hasta) - dt.date.fromisoformat(desde)).days
        prev_hasta = (dt.date.fromisoformat(desde) - dt.timedelta(days=1)).isoformat()
        prev_desde = (dt.date.fromisoformat(prev_hasta)
                      - dt.timedelta(days=dias)).isoformat()
        where_prev = list(where)
        vals_prev = [str(g.id_manager), prev_desde, prev_hasta]
        if id_trainer: vals_prev.append(str(id_trainer))
        cur.execute(f"""
            SELECT COALESCE(SUM(total), 0) AS suma
              FROM pos_venta v WHERE {' AND '.join(where_prev)}
        """, vals_prev)
        prev_suma = float(cur.fetchone()['suma'])

        # Anuladas
        cur.execute(f"""
            SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS suma
              FROM pos_venta v WHERE {' AND '.join(where_anul)}
        """, vals_anul)
        anul = cur.fetchone()

        # Por método
        cur.execute(f"""
            SELECT metodo_pago, COALESCE(SUM(total), 0) AS suma, COUNT(*) AS n
              FROM pos_venta v WHERE {' AND '.join(where)}
             GROUP BY metodo_pago
        """, vals)
        por_metodo_rows = cur.fetchall()

        # Serie por día
        cur.execute(f"""
            SELECT v.fecha::date AS dia, COUNT(*) AS n,
                   COALESCE(SUM(total), 0) AS suma
              FROM pos_venta v WHERE {' AND '.join(where)}
             GROUP BY v.fecha::date
             ORDER BY v.fecha::date
        """, vals)
        serie = cur.fetchall()

        # Top productos (excluye descuentos)
        cur.execute(f"""
            SELECT l.producto_id, l.codigo, l.nombre,
                   COALESCE(SUM(l.cantidad), 0) AS cantidad,
                   COALESCE(SUM(l.total), 0)    AS importe
              FROM pos_venta_linea l
              JOIN pos_venta v ON v.id = l.venta_id
             WHERE {' AND '.join(where)}
               AND COALESCE(l.tipo, 'producto') != 'descuento'
             GROUP BY l.producto_id, l.codigo, l.nombre
             ORDER BY importe DESC
             LIMIT 10
        """, vals)
        top_prod = cur.fetchall()

        # Top clientes (excluye consumidor final). Sprint 5 #3: GROUP BY
        # cliente_id solo + MAX(cliente_nombre) — antes partíamos clientes
        # cuyo snapshot de nombre cambió entre ventas.
        cur.execute(f"""
            SELECT v.cliente_id,
                   MAX(v.cliente_nombre) AS cliente_nombre,
                   COUNT(*) AS n,
                   COALESCE(SUM(v.total), 0) AS total
              FROM pos_venta v WHERE {' AND '.join(where)}
               AND v.cliente_id IS NOT NULL
             GROUP BY v.cliente_id
             ORDER BY total DESC
             LIMIT 10
        """, vals)
        top_cli = cur.fetchall()

    total_periodo = float(kpi['suma'])
    n = kpi['n']
    variacion_pct = ((total_periodo - prev_suma) / prev_suma * 100) if prev_suma > 0 else None
    return jsonify({
        'ok': True,
        'desde': desde, 'hasta': hasta, 'id_trainer': id_trainer,
        'kpis': {
            'total_periodo': total_periodo,
            'num_ventas': n,
            'ticket_medio': (total_periodo / n) if n else 0,
            'num_anuladas': anul['n'],
            'total_anulado': float(anul['suma']),
            'total_periodo_anterior': prev_suma,
            'variacion_pct': variacion_pct,
        },
        'por_metodo': [
            {'metodo': r['metodo_pago'],
             'total': float(r['suma']), 'n': r['n']}
            for r in por_metodo_rows
        ],
        'serie_dia': [
            {'fecha': r['dia'].isoformat(),
             'total': float(r['suma']), 'n_ventas': r['n']}
            for r in serie
        ],
        'top_productos': [
            {'producto_id': r['producto_id'],
             'codigo': r['codigo'], 'nombre': r['nombre'],
             'cantidad': float(r['cantidad']),
             'importe': float(r['importe'])}
            for r in top_prod
        ],
        'top_clientes': [
            {'cliente_id': r['cliente_id'],
             'cliente_nombre': r['cliente_nombre'],
             'n': r['n'], 'total': float(r['total'])}
            for r in top_cli
        ],
    })


@bp.route('/ventas/<int:vid>/force-reset-sync', methods=['POST'])
@auth_required
@require_permission('tpv.ventas.sync_odoo')
def force_reset_sync(vid):
    """Fuerza sync_status a 'pending' para una venta zombi. Útil cuando el
    TTL del lock (5 min) no es suficiente o un operator quiere reintentar
    inmediato. NO toca odoo_move_id/odoo_payment_id — la idempotency
    search-by-ref los recuperará.
    """
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""UPDATE pos_venta
                          SET sync_status='pending', sync_error=NULL,
                              sync_attempted_at=NOW(), updated_at=NOW()
                        WHERE id=%s AND id_manager=%s
                       RETURNING id, sync_status""",
                    (vid, str(g.id_manager)))
        row = cur.fetchone()
        conn.commit()
    if not row:
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    log_action(actor_from_request(), entidad='pos_venta', entidad_id=vid,
               accion='force_reset_sync',
               resumen='sync_status reseteado a pending')
    return jsonify({'ok': True})


@bp.route('/ventas/<int:vid>/sync-odoo', methods=['POST'])
@auth_required
@require_permission('tpv.ventas.sync_odoo')
def sync_odoo(vid):
    """Reintenta la sincronización con Odoo. Idempotente.
    - Si la venta está 'completada' → sync_venta (crea move+payment si falta)
    - Si la venta está 'anulada' → revertir_venta_odoo (crea refund si falta)
    """
    from ..odoo_pos_sync import (sync_venta, revertir_venta_odoo,
                                    revertir_aplicacion_recibo_mensual)
    # Comprobar estado primero
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT estado, sync_status, odoo_move_id,
                              odoo_refund_move_id, recibo_id
                         FROM pos_venta
                        WHERE id=%s AND id_manager=%s""",
                    (vid, str(g.id_manager)))
        v = cur.fetchone()
    if not v:
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    # Caso 1: venta anulada con move tradicional → out_refund
    if v['estado'] == 'anulada' and v['odoo_move_id']:
        if v.get('odoo_refund_move_id'):
            return jsonify({'ok': True, 'already_reverted': True,
                            'refund_id': v['odoo_refund_move_id']})
        return jsonify(revertir_venta_odoo(g.id_manager, vid))
    # Caso 2: venta anulada que había sido aplicada a recibo mensual draft
    # → remover sus líneas del draft (Audit #1, mayo 2026).
    if (v['estado'] == 'anulada'
        and v['sync_status'] == 'applied_to_recibo'
        and v.get('recibo_id')):
        return jsonify(revertir_aplicacion_recibo_mensual(g.id_manager, vid))
    res = sync_venta(g.id_manager, vid)
    return jsonify(res)


@bp.route('/ventas/<int:vid>/anular', methods=['POST'])
@auth_required
@require_permission('tpv.ventas.anular')
def anular_venta(vid):
    """Marca anulada y revierte stock. Body opcional: {motivo}."""
    motivo = (request.get_json() or {}).get('motivo') or 'anulación'
    actor       = actor_from_request()
    actor_label = actor.get('label') or actor.get('email') or 'tpv'
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT id, numero, estado, id_trainer
                         FROM pos_venta
                        WHERE id = %s AND id_manager = %s FOR UPDATE""",
                    (vid, str(g.id_manager)))
        v = cur.fetchone()
        if not v:
            return jsonify({'ok': False, 'error': 'not_found'}), 404
        if v['estado'] == 'anulada':
            return jsonify({'ok': False, 'error': 'ya_anulada'}), 400
        # Sprint 5 #4 — Lockear todos los productos en orden ASC de PK
        # ANTES de iterar para revertir. Sin esto, dos anulaciones de
        # ventas distintas que compartan productos A,B pueden adquirir
        # los locks en orden inverso → deadlock teórico. Lock global
        # ordenado garantiza orden consistente.
        cur.execute("""SELECT l.id, l.producto_id, l.cantidad, l.nombre
                         FROM pos_venta_linea l
                        WHERE l.venta_id = %s""", (vid,))
        lineas = cur.fetchall()
        prod_ids = sorted({ln['producto_id'] for ln in lineas if ln['producto_id']})
        if prod_ids:
            cur.execute("""SELECT id FROM pos_producto
                            WHERE id = ANY(%s)
                            ORDER BY id FOR UPDATE""", (prod_ids,))
        # Ahora iteramos sin riesgo de deadlock
        for ln in lineas:
            if not ln['producto_id']:
                continue
            cur.execute("""SELECT stock_actual, inventariable
                             FROM pos_producto WHERE id = %s""",
                        (ln['producto_id'],))
            p = cur.fetchone()
            if not p or not p['inventariable']:
                continue
            antes = Decimal(str(p['stock_actual'] or 0))
            despues = antes + Decimal(str(ln['cantidad']))
            cur.execute("UPDATE pos_producto SET stock_actual=%s WHERE id=%s",
                        (despues, ln['producto_id']))
            cur.execute("""
                INSERT INTO pos_stock_movimiento
                  (id_manager, id_trainer, producto_id, tipo, cantidad,
                   stock_antes, stock_despues, venta_id, motivo, created_by)
                VALUES (%s, %s, %s, 'anulacion', %s, %s, %s, %s, %s, %s)
            """, (str(g.id_manager), v['id_trainer'], ln['producto_id'],
                  Decimal(str(ln['cantidad'])), antes, despues, vid,
                  f'Anulación {v["numero"]}: {motivo}', actor_label))
        cur.execute("""UPDATE pos_venta
                          SET estado='anulada', updated_at=NOW(),
                              notas = COALESCE(notas,'') || E'\n[ANULADA] ' || %s
                        WHERE id = %s""", (motivo, vid))
    log_action(actor, entidad='pos_venta', entidad_id=vid,
               accion='anular', resumen=f'{v["numero"]}: {motivo}')
    # Propagar a Odoo según cómo se sincronizó originalmente:
    #   - synced (move + payment) → out_refund clásico
    #   - applied_to_recibo (líneas en draft mensual) → remover líneas del draft
    #   - skipped / pending / error → nada que revertir en Odoo
    mid = g.id_manager
    # Re-leer el sync_status (puede haber cambiado entre el SELECT inicial y aquí)
    with get_conn() as _c, _c.cursor() as _cur:
        _cur.execute("SELECT sync_status FROM pos_venta WHERE id=%s", (vid,))
        _r = _cur.fetchone()
        sync_status_for_revert = _r['sync_status'] if _r else None
    try:
        import threading
        if sync_status_for_revert == 'applied_to_recibo':
            from ..odoo_pos_sync import revertir_aplicacion_recibo_mensual
            target_fn = revertir_aplicacion_recibo_mensual
        else:
            from ..odoo_pos_sync import revertir_venta_odoo
            target_fn = revertir_venta_odoo
        threading.Thread(
            target=target_fn, args=(mid, vid, motivo),
            daemon=True, name=f'pos-revert-{vid}',
        ).start()
    except Exception:
        log.exception(f'lanzando revert Odoo venta {vid}')
    return jsonify({'ok': True})
