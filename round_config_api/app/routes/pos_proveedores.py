"""POS — facturas de proveedor (Fase 7, mayo 2026).

Reglas carajfam (memoria de proyecto):
  * DRAFT only en Odoo — admin valida manualmente.
  * Cuentas PGC: 600 (default compras), 622/623/625/626/628/629 (servicios).
  * Total negativo → in_refund.
  * Partner por VAT/NIF con supplier_rank=1.

Endpoints:
  GET    /api/pos/proveedores              listado con filtros
  GET    /api/pos/proveedores/<id>         detalle
  POST   /api/pos/proveedores              crear (lanza sync background)
  PATCH  /api/pos/proveedores/<id>         editar (solo si NO sincronizada)
  POST   /api/pos/proveedores/<id>/anular  marca anulada
  POST   /api/pos/proveedores/<id>/sync    fuerza re-sync
"""
import logging
import datetime as dt
from decimal import Decimal, ROUND_HALF_UP
from flask import Blueprint, request, jsonify, g

from ..auth import auth_required, require_permission
from ..db import get_conn
from ..audit_log import log_action, actor_from_request
from ..validators import validate_nif_cif_nie
from ..trainer_scope import trainer_bloquea

bp = Blueprint('pos_proveedores', __name__)
log = logging.getLogger(__name__)


CUENTAS_VALIDAS = {
    '600': 'Compras de mercaderías',
    '602': 'Compras otros aprovisionamientos',
    '607': 'Trabajos realizados por otras empresas',
    '621': 'Arrendamientos y cánones',
    '622': 'Reparaciones y conservación',
    '623': 'Servicios profesionales independientes',
    '624': 'Transportes',
    '625': 'Primas de seguros',
    '626': 'Servicios bancarios',
    '627': 'Publicidad, propaganda y RR.PP.',
    '628': 'Suministros (luz, agua, gas, internet)',
    '629': 'Otros servicios',
}


def _q2(x):
    return Decimal(str(x or 0)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def _row_json(r):
    if not r: return None
    o = dict(r)
    for k in ('fecha', 'created_at', 'updated_at', 'sync_attempted_at'):
        if o.get(k) and hasattr(o[k], 'isoformat'):
            o[k] = o[k].isoformat()
    for k, v in list(o.items()):
        if isinstance(v, Decimal):
            o[k] = float(v)
    return o


@bp.route('/proveedores', methods=['GET'])
@auth_required
@require_permission('tpv.proveedores.ver')
def list_proveedores():
    qs = request.args
    where = ['id_manager=%s']
    vals = [str(g.id_manager)]
    if qs.get('desde'):
        where.append('fecha >= %s'); vals.append(qs['desde'])
    if qs.get('hasta'):
        where.append('fecha <= %s'); vals.append(qs['hasta'])
    if qs.get('estado'):
        where.append('estado=%s'); vals.append(qs['estado'])
    if qs.get('proveedor_nif'):
        where.append('proveedor_nif=%s'); vals.append(qs['proveedor_nif'].upper())
    if qs.get('cuenta'):
        where.append('cuenta_contable=%s'); vals.append(qs['cuenta'])
    limit = min(int(qs.get('limit') or 200), 1000)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"""
            SELECT * FROM pos_factura_proveedor
             WHERE {' AND '.join(where)}
             ORDER BY fecha DESC, id DESC
             LIMIT %s
        """, vals + [limit])
        rows = [_row_json(r) for r in cur.fetchall()]
    return jsonify({'ok': True, 'facturas': rows})


@bp.route('/proveedores/<int:fid>', methods=['GET'])
@auth_required
@require_permission('tpv.proveedores.ver')
def detalle_proveedor(fid):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT * FROM pos_factura_proveedor
                        WHERE id=%s AND id_manager=%s""",
                    (fid, str(g.id_manager)))
        r = cur.fetchone()
    if not r:
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    if trainer_bloquea(r['id_trainer']):
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    return jsonify({'ok': True, 'factura': _row_json(r)})


@bp.route('/proveedores', methods=['POST'])
@auth_required
@require_permission('tpv.proveedores.crear')
def crear_proveedor():
    """Body:
      {
        fecha: 'YYYY-MM-DD',
        proveedor_nombre, proveedor_nif (NIF/CIF/NIE), proveedor_email?,
        base, iva_pct, total (puede ser negativo → in_refund),
        cuenta_contable: '600'|'622'|...,
        concepto, numero_factura?, pdf_url?, notas?, id_trainer?,
      }
    """
    d = request.get_json() or {}
    # Validaciones obligatorias
    fecha = (d.get('fecha') or '').strip() or dt.date.today().isoformat()
    nombre = (d.get('proveedor_nombre') or '').strip()
    nif = (d.get('proveedor_nif') or '').strip().upper()
    concepto = (d.get('concepto') or '').strip()
    if not nombre:
        return jsonify({'ok': False, 'error': 'proveedor_nombre_required'}), 400
    if not nif:
        return jsonify({'ok': False, 'error': 'proveedor_nif_required'}), 400
    ok_nif, _msg = validate_nif_cif_nie(nif)
    if not ok_nif:
        return jsonify({'ok': False, 'error': 'nif_invalido',
                        'detalle': _msg}), 400
    if not concepto:
        return jsonify({'ok': False, 'error': 'concepto_required'}), 400
    cuenta = (d.get('cuenta_contable') or '600').strip()
    if cuenta not in CUENTAS_VALIDAS:
        return jsonify({'ok': False, 'error': 'cuenta_invalida',
                        'detalle': f'Acepta: {sorted(CUENTAS_VALIDAS)}'}), 400
    try:
        base = _q2(d.get('base'))
        iva_pct = Decimal(str(d.get('iva_pct') if d.get('iva_pct') is not None else 21))
        # Si nos pasan iva_importe lo respetamos, si no lo calculamos
        if d.get('iva_importe') is not None:
            iva_imp = _q2(d.get('iva_importe'))
        else:
            iva_imp = _q2(base * iva_pct / Decimal('100'))
        # Total: si lo pasan lo usamos (puede ser negativo), si no = base+iva
        if d.get('total') is not None:
            total = _q2(d.get('total'))
        else:
            total = _q2(base + iva_imp)
    except Exception:
        return jsonify({'ok': False, 'error': 'importes_invalidos'}), 400

    # Coherencia: si total<0 (rectificativa), base e iva_importe también
    # deben ser negativos (o se lo dejamos al usuario). Para Odoo lo
    # convertimos a positivo con move_type='in_refund'.
    actor = actor_from_request()
    actor_label = actor.get('label') or actor.get('email') or 'tpv'

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            INSERT INTO pos_factura_proveedor
              (id_manager, id_trainer, fecha,
               proveedor_nombre, proveedor_nif, proveedor_email,
               base, iva_pct, iva_importe, total,
               cuenta_contable, concepto, numero_factura, pdf_url,
               notas, created_by)
            VALUES (%s, %s, %s,
                    %s, %s, %s,
                    %s, %s, %s, %s,
                    %s, %s, %s, %s,
                    %s, %s)
            RETURNING *
        """, (
            str(g.id_manager),
            (d.get('id_trainer') or '').strip() or g.id_trainer,
            fecha,
            nombre, nif, (d.get('proveedor_email') or None),
            base, iva_pct, iva_imp, total,
            cuenta, concepto,
            (d.get('numero_factura') or None),
            (d.get('pdf_url') or None),
            (d.get('notas') or None),
            actor_label,
        ))
        row = cur.fetchone()

    log_action(actor, entidad='pos_factura_proveedor', entidad_id=row['id'],
               accion='create',
               resumen=f'{nombre} ({nif}) · {total:.2f}€ · cuenta {cuenta} · {concepto[:40]}')

    # Sync Odoo en background si el manager tiene cuotas activadas
    try:
        from ..odoo_proveedores_sync import sync_async_factura
        sync_async_factura(g.id_manager, row['id'])
    except Exception:
        log.exception('lanzando sync proveedor')

    return jsonify({'ok': True, 'factura': _row_json(row)}), 201


@bp.route('/proveedores/<int:fid>', methods=['PATCH'])
@auth_required
@require_permission('tpv.proveedores.crear')
def editar_proveedor(fid):
    """Solo editable mientras no esté sincronizada. Tras sincronizar,
    cualquier cambio requiere anular + recrear (igual que en Odoo).
    """
    d = request.get_json() or {}
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT estado, sync_status, id_trainer FROM pos_factura_proveedor
                        WHERE id=%s AND id_manager=%s""",
                    (fid, str(g.id_manager)))
        r = cur.fetchone()
        if not r:
            return jsonify({'ok': False, 'error': 'not_found'}), 404
        if trainer_bloquea(r['id_trainer']):
            return jsonify({'ok': False, 'error': 'not_found'}), 404
        if r['estado'] == 'anulada':
            return jsonify({'ok': False, 'error': 'anulada_no_editable'}), 400
        if r['sync_status'] == 'synced':
            return jsonify({'ok': False, 'error': 'sincronizada_no_editable',
                            'detalle': 'Anula y recrea para modificar.'}), 400
        allowed = ['fecha', 'proveedor_nombre', 'proveedor_nif',
                   'proveedor_email', 'base', 'iva_pct', 'iva_importe',
                   'total', 'cuenta_contable', 'concepto',
                   'numero_factura', 'pdf_url', 'notas']
        sets, vals = [], []
        for f in allowed:
            if f in d:
                v = d[f]
                if f == 'proveedor_nif' and v:
                    v = v.strip().upper()
                    ok_nif, msg = validate_nif_cif_nie(v)
                    if not ok_nif:
                        return jsonify({'ok': False, 'error': 'nif_invalido',
                                        'detalle': msg}), 400
                if f == 'cuenta_contable' and v and v not in CUENTAS_VALIDAS:
                    return jsonify({'ok': False, 'error': 'cuenta_invalida'}), 400
                sets.append(f'{f}=%s'); vals.append(v)
        if not sets:
            return jsonify({'ok': False, 'error': 'no_fields'}), 400
        vals.extend([fid, str(g.id_manager)])
        cur.execute(f"""UPDATE pos_factura_proveedor
                          SET {', '.join(sets)}, updated_at=NOW()
                        WHERE id=%s AND id_manager=%s
                       RETURNING *""", vals)
        row = cur.fetchone()
    log_action(actor_from_request(), entidad='pos_factura_proveedor',
               entidad_id=fid, accion='update', cambios=d)
    return jsonify({'ok': True, 'factura': _row_json(row)})


@bp.route('/proveedores/<int:fid>/anular', methods=['POST'])
@auth_required
@require_permission('tpv.proveedores.anular')
def anular_proveedor(fid):
    motivo = (request.get_json() or {}).get('motivo') or 'anulación'
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT estado, odoo_move_id, id_trainer FROM pos_factura_proveedor
                        WHERE id=%s AND id_manager=%s FOR UPDATE""",
                    (fid, str(g.id_manager)))
        r = cur.fetchone()
        if not r:
            return jsonify({'ok': False, 'error': 'not_found'}), 404
        if trainer_bloquea(r['id_trainer']):
            return jsonify({'ok': False, 'error': 'not_found'}), 404
        if r['estado'] == 'anulada':
            return jsonify({'ok': False, 'error': 'ya_anulada'}), 400
        cur.execute("""UPDATE pos_factura_proveedor
                          SET estado='anulada', updated_at=NOW(),
                              notas = COALESCE(notas,'') || E'\n[ANULADA] ' || %s
                        WHERE id=%s""", (motivo, fid))

    # Propagar a Odoo: rectificativa (in_refund con reversed_entry_id) si
    # la factura ya estaba POSTED; cancel directo si seguía DRAFT.
    # Sprint 1 fix #1 (audit prof. mayo 2026): el flujo anterior hacía
    # `button_draft + button_cancel` lo que desreconcilia el payment y
    # rompe SII. La rectificativa con reversed_entry_id mantiene la
    # trazabilidad exigida por AEAT.
    if r.get('odoo_move_id'):
        try:
            import threading
            from ..odoo_proveedores_sync import revertir_factura_proveedor
            mid = g.id_manager
            threading.Thread(
                target=revertir_factura_proveedor,
                args=(mid, fid, motivo),
                daemon=True, name=f'prov-revert-{fid}').start()
        except Exception:
            log.exception('lanzando revert proveedor')

    log_action(actor_from_request(), entidad='pos_factura_proveedor',
               entidad_id=fid, accion='anular', resumen=motivo)
    return jsonify({'ok': True})


@bp.route('/proveedores/<int:fid>/sync', methods=['POST'])
@auth_required
@require_permission('tpv.proveedores.crear')
def sync_proveedor_endpoint(fid):
    """Reintenta sync con Odoo. Idempotente."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT id_trainer FROM pos_factura_proveedor
                        WHERE id=%s AND id_manager=%s""",
                    (fid, str(g.id_manager)))
        r = cur.fetchone()
    if not r:
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    if trainer_bloquea(r['id_trainer']):
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    from ..odoo_proveedores_sync import sync_factura_proveedor
    res = sync_factura_proveedor(g.id_manager, fid)
    return jsonify(res)
