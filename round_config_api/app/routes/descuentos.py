"""CRUD de descuentos (mismo patrón que cuotas)."""
from flask import Blueprint, request, jsonify, g
from ..auth import auth_required
from ..db import get_conn
from .. import config

bp = Blueprint('descuentos', __name__)

FIELDS = "id, scope, id_manager, id_trainer, plantilla_origen_id, codigo, descripcion, tipo, valor, active, created_at, updated_at"


def _row(r):
    if not r: return None
    out = dict(r)
    for k in ('created_at','updated_at'):
        if out.get(k): out[k] = out[k].isoformat()
    if out.get('valor') is not None:
        out['valor'] = float(out['valor'])
    return out


@bp.route('', methods=['GET'])
@auth_required
def list_():
    with get_conn() as conn, conn.cursor() as cur:
        if g.id_trainer:
            cur.execute(f"""SELECT {FIELDS} FROM descuento
                WHERE id_manager=%s AND (scope='plantilla_manager'
                  OR (scope='trainer' AND id_trainer=%s))
                ORDER BY scope, codigo""", (g.id_manager, g.id_trainer))
        else:
            cur.execute(f"""SELECT {FIELDS} FROM descuento
                WHERE id_manager=%s ORDER BY scope, id_trainer NULLS FIRST, codigo""",
                (g.id_manager,))
        return jsonify({'ok': True, 'descuentos': [_row(r) for r in cur.fetchall()]})


@bp.route('', methods=['POST'])
@auth_required
def create():
    d = request.get_json() or {}
    if d.get('tipo') not in config.TIPOS_DESCUENTO:
        return jsonify({'ok': False, 'error': 'tipo_invalido'}), 400
    if not d.get('codigo'):
        return jsonify({'ok': False, 'error': 'codigo_obligatorio'}), 400
    scope = 'trainer' if g.id_trainer else 'plantilla_manager'
    id_trainer = g.id_trainer if scope == 'trainer' else None
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"""
            INSERT INTO descuento (scope, id_manager, id_trainer, plantilla_origen_id,
              codigo, descripcion, tipo, valor, active)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
            RETURNING {FIELDS}
        """, (scope, g.id_manager, id_trainer, d.get('plantilla_origen_id'),
              d['codigo'], d.get('descripcion'), d['tipo'], d.get('valor', 0),
              d.get('active', True)))
        return jsonify({'ok': True, 'descuento': _row(cur.fetchone())}), 201


@bp.route('/<int:_id>', methods=['PUT', 'PATCH'])
@auth_required
def update(_id):
    d = request.get_json() or {}
    if 'tipo' in d and d['tipo'] not in config.TIPOS_DESCUENTO:
        return jsonify({'ok': False, 'error': 'tipo_invalido'}), 400
    allowed = ('codigo','descripcion','tipo','valor','active')
    sets, params = [], []
    for k in allowed:
        if k in d:
            sets.append(f"{k}=%s"); params.append(d[k])
    if not sets:
        return jsonify({'ok': False, 'error': 'no_changes'}), 400
    params.extend([_id, g.id_manager])
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"UPDATE descuento SET {','.join(sets)} WHERE id=%s AND id_manager=%s RETURNING {FIELDS}", params)
        r = cur.fetchone()
    if not r:
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    return jsonify({'ok': True, 'descuento': _row(r)})


@bp.route('/<int:_id>', methods=['DELETE'])
@auth_required
def delete(_id):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM descuento WHERE id=%s AND id_manager=%s", (_id, g.id_manager))
        return jsonify({'ok': True, 'deleted': cur.rowcount})


@bp.route('/<int:_id>/adoptar', methods=['POST'])
@auth_required
def adoptar(_id):
    if not g.id_trainer:
        return jsonify({'ok': False, 'error': 'requires_trainer_id'}), 400
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"SELECT {FIELDS} FROM descuento WHERE id=%s AND id_manager=%s AND scope='plantilla_manager'",
                    (_id, g.id_manager))
        p = cur.fetchone()
        if not p: return jsonify({'ok': False, 'error': 'plantilla_not_found'}), 404
        cur.execute("SELECT id FROM descuento WHERE id_trainer=%s AND plantilla_origen_id=%s AND scope='trainer'",
                    (g.id_trainer, _id))
        ex = cur.fetchone()
        if ex: return jsonify({'ok': True, 'already_adopted': True, 'descuento_id': ex['id']})
        cur.execute(f"""
            INSERT INTO descuento (scope, id_manager, id_trainer, plantilla_origen_id,
              codigo, descripcion, tipo, valor, active)
            VALUES ('trainer', %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING {FIELDS}
        """, (g.id_manager, g.id_trainer, _id, p['codigo'], p['descripcion'], p['tipo'], p['valor'], p['active']))
        return jsonify({'ok': True, 'descuento': _row(cur.fetchone())}), 201
