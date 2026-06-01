"""POS — catálogo de descuentos (Fase 2.5, mayo 2026).

Descuentos aplicables en el TPV. Pueden ser:
  * porcentaje (10 → -10%) o importe fijo (5.00 → -5,00 €)
  * de ámbito 'producto' (vinculado a un producto del catálogo) o 'general'
    (sobre el total del ticket)

Per-trainer (cada centro tiene los suyos), igual que productos. La
validación de la combinación (ámbito|producto_id) se hace tanto en BD
(CHECK constraint) como aquí.

Endpoints:
  GET    /api/pos/descuentos
  POST   /api/pos/descuentos
  PATCH  /api/pos/descuentos/<id>
  DELETE /api/pos/descuentos/<id>   (archive = active=false)
"""
import logging
from flask import Blueprint, request, jsonify, g
from ..auth import auth_required, require_permission
from ..db import get_conn
from ..audit_log import log_action, actor_from_request

bp = Blueprint('pos_descuentos', __name__)
log = logging.getLogger(__name__)

TIPOS_VALIDOS = {'porcentaje', 'importe'}
AMBITOS_VALIDOS = {'producto', 'general'}


def _row(r):
    if not r: return None
    o = dict(r)
    for k in ('created_at', 'updated_at'):
        if o.get(k) and hasattr(o[k], 'isoformat'): o[k] = o[k].isoformat()
    if o.get('valor') is not None: o['valor'] = float(o['valor'])
    return o


@bp.route('/descuentos', methods=['GET'])
@auth_required
@require_permission('configuracion.pos.productos_ver')
def list_descuentos():
    """Filtros: ?id_trainer=X, ?activos=0|1 (def 1), ?producto_id=Y, ?ambito=..."""
    qs = request.args
    where = ['d.id_manager = %s']
    vals  = [str(g.id_manager)]
    target_trainer = (qs.get('id_trainer') or '').strip() or g.id_trainer
    if target_trainer:
        where.append('d.id_trainer = %s'); vals.append(str(target_trainer))
    if qs.get('activos', '1') == '1':
        where.append('d.active = TRUE')
    if qs.get('producto_id'):
        where.append('d.producto_id = %s'); vals.append(int(qs['producto_id']))
    if qs.get('ambito') in AMBITOS_VALIDOS:
        where.append('d.ambito = %s'); vals.append(qs['ambito'])
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"""
            SELECT d.*, p.nombre AS producto_nombre, p.codigo AS producto_codigo
              FROM pos_descuento d
              LEFT JOIN pos_producto p ON p.id = d.producto_id
             WHERE {' AND '.join(where)}
             ORDER BY d.ambito, d.nombre
        """, vals)
        return jsonify({'ok': True,
                        'descuentos': [_row(r) for r in cur.fetchall()]})


@bp.route('/descuentos', methods=['POST'])
@auth_required
@require_permission('configuracion.pos.descuentos_editar')
def create_descuento():
    d = request.get_json() or {}
    nombre = (d.get('nombre') or '').strip()
    if not nombre:
        return jsonify({'ok': False, 'error': 'nombre_required'}), 400
    tipo = (d.get('tipo') or '').strip().lower()
    if tipo not in TIPOS_VALIDOS:
        return jsonify({'ok': False, 'error': 'tipo_invalido',
                        'detalle': f'acepta {sorted(TIPOS_VALIDOS)}'}), 400
    try:
        valor = float(d.get('valor') or 0)
    except (TypeError, ValueError):
        return jsonify({'ok': False, 'error': 'valor_invalido'}), 400
    if valor <= 0:
        return jsonify({'ok': False, 'error': 'valor_debe_ser_positivo'}), 400
    if tipo == 'porcentaje' and valor > 100:
        return jsonify({'ok': False, 'error': 'porcentaje_max_100'}), 400
    ambito = (d.get('ambito') or '').strip().lower()
    if ambito not in AMBITOS_VALIDOS:
        return jsonify({'ok': False, 'error': 'ambito_invalido'}), 400
    producto_id = d.get('producto_id')
    if ambito == 'producto' and not producto_id:
        return jsonify({'ok': False,
                        'error': 'producto_required_para_ambito_producto'}), 400
    if ambito == 'general' and producto_id:
        return jsonify({'ok': False,
                        'error': 'producto_no_admitido_en_general'}), 400
    target_trainer = (d.get('id_trainer') or '').strip() or g.id_trainer
    if not target_trainer:
        return jsonify({'ok': False, 'error': 'id_trainer_required',
                        'detalle': 'Los descuentos son per-centro.'}), 400

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            INSERT INTO pos_descuento
              (id_manager, id_trainer, codigo, nombre, tipo, valor,
               ambito, producto_id, icono, color, notas)
            VALUES (%s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s)
            RETURNING *
        """, (str(g.id_manager), str(target_trainer),
              d.get('codigo'), nombre, tipo, valor,
              ambito, producto_id if ambito == 'producto' else None,
              d.get('icono') or '🎁',
              d.get('color') or '#ef4444',
              d.get('notas')))
        row = cur.fetchone()
    log_action(actor_from_request(), entidad='pos_descuento',
               entidad_id=row['id'], accion='create',
               resumen=f'{nombre} · {valor}{"%" if tipo=="porcentaje" else "€"} ({ambito})')
    return jsonify({'ok': True, 'descuento': _row(row)}), 201


@bp.route('/descuentos/<int:did>', methods=['PATCH'])
@auth_required
@require_permission('configuracion.pos.descuentos_editar')
def update_descuento(did):
    d = request.get_json() or {}
    allowed = ['codigo', 'nombre', 'tipo', 'valor', 'ambito',
               'producto_id', 'icono', 'color', 'notas', 'active']
    sets, vals = [], []
    for f in allowed:
        if f in d:
            sets.append(f'{f} = %s'); vals.append(d[f])
    if not sets:
        return jsonify({'ok': False, 'error': 'no_fields'}), 400
    vals.extend([did, str(g.id_manager)])
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"""
            UPDATE pos_descuento SET {', '.join(sets)}, updated_at=NOW()
             WHERE id = %s AND id_manager = %s
            RETURNING *
        """, vals)
        row = cur.fetchone()
    if not row:
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    log_action(actor_from_request(), entidad='pos_descuento',
               entidad_id=did, accion='update', cambios=d)
    return jsonify({'ok': True, 'descuento': _row(row)})


@bp.route('/descuentos/<int:did>', methods=['DELETE'])
@auth_required
@require_permission('configuracion.pos.descuentos_editar')
def archive_descuento(did):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""UPDATE pos_descuento
                          SET active = FALSE, updated_at=NOW()
                        WHERE id = %s AND id_manager = %s
                       RETURNING id""", (did, str(g.id_manager)))
        if not cur.fetchone():
            return jsonify({'ok': False, 'error': 'not_found'}), 404
    log_action(actor_from_request(), entidad='pos_descuento',
               entidad_id=did, accion='archive')
    return jsonify({'ok': True})
