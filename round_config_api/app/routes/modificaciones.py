"""CRUD de modificaciones (no son plantillas, son instancias)."""
from flask import Blueprint, request, jsonify, g
from ..auth import auth_required
from ..db import get_conn
from ..odoo_sync import get_sync
from .. import config

bp = Blueprint('modificaciones', __name__)

FIELDS = """id, id_manager, id_trainer, cliente_idnoofit, cuota_id, tipo, valor,
            fecha_desde, fecha_hasta, razon, estado, odoo_id, created_at, updated_at"""


def _row(r):
    if not r: return None
    out = dict(r)
    for k in ('created_at','updated_at','fecha_desde','fecha_hasta'):
        if out.get(k): out[k] = out[k].isoformat()
    if out.get('valor') is not None:
        out['valor'] = float(out['valor'])
    return out


@bp.route('', methods=['GET'])
@auth_required
def list_():
    """Lista modificaciones del trainer (o de todos los trainers del manager).
    Filtros opcionales:
        ?cliente=<idnoofit>   solo modificaciones de ese cliente
        ?estado=<activa|aplicada|cancelada>
    """
    cliente = (request.args.get('cliente') or '').strip()
    estado  = (request.args.get('estado')  or '').strip()
    where = ['id_manager=%s']
    vals = [g.id_manager]
    if g.id_trainer:
        where.append('id_trainer=%s'); vals.append(g.id_trainer)
    if cliente:
        where.append('cliente_idnoofit=%s'); vals.append(cliente)
    if estado:
        where.append('estado=%s'); vals.append(estado)
    sql = (f"SELECT {FIELDS} FROM modificacion WHERE " + ' AND '.join(where)
           + " ORDER BY created_at DESC, fecha_desde DESC")
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(sql, vals)
        return jsonify({'ok': True, 'modificaciones': [_row(r) for r in cur.fetchall()]})


@bp.route('', methods=['POST'])
@auth_required
def create():
    d = request.get_json() or {}
    if d.get('tipo') not in config.TIPOS_MODIFICACION:
        return jsonify({'ok': False, 'error': 'tipo_invalido'}), 400
    if not d.get('fecha_desde'):
        return jsonify({'ok': False, 'error': 'fecha_desde_obligatoria'}), 400
    # Modificación siempre tiene id_trainer (es una instancia para alguien concreto)
    # Fallback: si no llega y no hay g.id_trainer (manager logueado sin
    # impersonar), deducirlo del trainer del cliente en cliente_cache.
    id_trainer = d.get('id_trainer') or g.id_trainer
    if not id_trainer and d.get('cliente_idnoofit'):
        try:
            with get_conn() as conn, conn.cursor() as cur:
                cur.execute("""
                    SELECT id_trainer FROM cliente_cache
                     WHERE id_manager=%s AND id=%s LIMIT 1
                """, (str(g.id_manager), int(d['cliente_idnoofit'])))
                row = cur.fetchone()
            if row and row.get('id_trainer'):
                id_trainer = str(row['id_trainer'])
        except Exception:
            pass
    if not id_trainer:
        return jsonify({'ok': False, 'error': 'id_trainer_obligatorio'}), 400
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"""
            INSERT INTO modificacion (id_manager, id_trainer, cliente_idnoofit, cuota_id,
              tipo, valor, fecha_desde, fecha_hasta, razon, estado)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            RETURNING {FIELDS}
        """, (g.id_manager, id_trainer, d.get('cliente_idnoofit'), d.get('cuota_id'),
              d['tipo'], d.get('valor',0), d['fecha_desde'], d.get('fecha_hasta'),
              d.get('razon'), d.get('estado', 'activa')))
        row = cur.fetchone()
    oid = get_sync().modificacion_create(row)
    if oid and isinstance(oid, int):
        with get_conn() as conn2, conn2.cursor() as cur2:
            cur2.execute("UPDATE modificacion SET odoo_id=%s WHERE id=%s", (oid, row['id']))
        row['odoo_id'] = oid
    return jsonify({'ok': True, 'modificacion': _row(row)}), 201


@bp.route('/<int:_id>', methods=['PUT','PATCH'])
@auth_required
def update(_id):
    d = request.get_json() or {}
    if 'tipo' in d and d['tipo'] not in config.TIPOS_MODIFICACION:
        return jsonify({'ok': False, 'error': 'tipo_invalido'}), 400
    allowed = ('cliente_idnoofit','cuota_id','tipo','valor','fecha_desde','fecha_hasta','razon','estado')
    sets, params = [], []
    for k in allowed:
        if k in d:
            sets.append(f"{k}=%s"); params.append(d[k])
    if not sets:
        return jsonify({'ok': False, 'error': 'no_changes'}), 400
    params.extend([_id, g.id_manager])
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"UPDATE modificacion SET {','.join(sets)} WHERE id=%s AND id_manager=%s RETURNING {FIELDS}", params)
        r = cur.fetchone()
    if not r:
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    if r.get('odoo_id'):
        get_sync().modificacion_update(r['odoo_id'], r)
    return jsonify({'ok': True, 'modificacion': _row(r)})


@bp.route('/<int:_id>', methods=['DELETE'])
@auth_required
def delete(_id):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT odoo_id FROM modificacion WHERE id=%s AND id_manager=%s", (_id, g.id_manager))
        r = cur.fetchone()
        cur.execute("DELETE FROM modificacion WHERE id=%s AND id_manager=%s", (_id, g.id_manager))
        n = cur.rowcount
    if r and r.get('odoo_id'):
        get_sync().modificacion_delete(r['odoo_id'])
    return jsonify({'ok': True, 'deleted': n})
