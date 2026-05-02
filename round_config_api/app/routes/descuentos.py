"""CRUD de descuentos (mismo patrón que cuotas)."""
from flask import Blueprint, request, jsonify, g
from ..auth import auth_required
from ..db import get_conn
from ..odoo_sync import get_sync
from .. import config

bp = Blueprint('descuentos', __name__)

FIELDS = "id, scope, id_manager, id_trainer, plantilla_origen_id, codigo, descripcion, tipo, valor, active, odoo_id, created_at, updated_at"


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
        row = cur.fetchone()
    if scope == 'plantilla_manager':
        oid = get_sync().descuento_create(row)
        if oid and isinstance(oid, int):
            with get_conn() as conn2, conn2.cursor() as cur2:
                cur2.execute("UPDATE descuento SET odoo_id=%s WHERE id=%s", (oid, row['id']))
            row['odoo_id'] = oid
    return jsonify({'ok': True, 'descuento': _row(row)}), 201


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
    if r['scope'] == 'plantilla_manager':
        if r.get('odoo_id'):
            get_sync().descuento_update(r['odoo_id'], r)
        else:
            oid = get_sync().descuento_create(r)
            if oid and isinstance(oid, int):
                with get_conn() as conn2, conn2.cursor() as cur2:
                    cur2.execute("UPDATE descuento SET odoo_id=%s WHERE id=%s", (oid, r['id']))
                r['odoo_id'] = oid
    return jsonify({'ok': True, 'descuento': _row(r)})


@bp.route('/<int:_id>', methods=['DELETE'])
@auth_required
def delete(_id):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT odoo_id, scope FROM descuento WHERE id=%s AND id_manager=%s", (_id, g.id_manager))
        r = cur.fetchone()
        cur.execute("DELETE FROM descuento WHERE id=%s AND id_manager=%s", (_id, g.id_manager))
        n = cur.rowcount
    if r and r.get('odoo_id') and r.get('scope') == 'plantilla_manager':
        get_sync().descuento_delete(r['odoo_id'])
    return jsonify({'ok': True, 'deleted': n})


# ── ASIGNACIONES de descuento a uno o varios clientes ──────────────────────

ASIGN_FIELDS = """id, descuento_id, id_manager, id_trainer, cliente_idnoofit,
                  fecha_desde, fecha_hasta, estado, odoo_id, created_at, updated_at"""

def _asig_row(r):
    if not r: return None
    out = dict(r)
    for k in ('created_at','updated_at','fecha_desde','fecha_hasta'):
        if out.get(k): out[k] = out[k].isoformat()
    return out


@bp.route('/<int:desc_id>/asignaciones', methods=['GET'])
@auth_required
def list_asignaciones(desc_id):
    """Lista clientes asignados a un descuento."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"""SELECT {ASIGN_FIELDS} FROM descuento_asignacion
                        WHERE descuento_id=%s AND id_manager=%s
                        ORDER BY created_at DESC""", (desc_id, g.id_manager))
        return jsonify({'ok': True, 'asignaciones': [_asig_row(r) for r in cur.fetchall()]})


@bp.route('/<int:desc_id>/asignaciones', methods=['POST'])
@auth_required
def create_asignacion(desc_id):
    """Asignar el descuento a uno o varios clientes a la vez.

    Body: {
      'clientes_idnoofit': ['12345','67890', ...]  (1 o N)
      'fecha_desde': 'yyyy-mm-dd',
      'fecha_hasta': 'yyyy-mm-dd' (opcional),
      'id_trainer': '...' (opcional, si no, usa el de header)
    }
    """
    d = request.get_json() or {}
    clientes = d.get('clientes_idnoofit') or []
    if not isinstance(clientes, list) or not clientes:
        return jsonify({'ok': False, 'error': 'clientes_idnoofit_obligatorio'}), 400
    id_trainer = d.get('id_trainer') or g.id_trainer
    if not id_trainer:
        return jsonify({'ok': False, 'error': 'id_trainer_obligatorio'}), 400

    # Verificar que el descuento existe y obtener su odoo_id
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT id, odoo_id FROM descuento WHERE id=%s AND id_manager=%s",
                    (desc_id, g.id_manager))
        desc_row = cur.fetchone()
    if not desc_row:
        return jsonify({'ok': False, 'error': 'descuento_not_found'}), 404
    desc_odoo_id = desc_row.get('odoo_id')

    creadas, ya_existentes, errores = [], [], []
    for cliente in clientes:
        cliente = str(cliente).strip()
        if not cliente:
            continue
        try:
            with get_conn() as conn, conn.cursor() as cur:
                cur.execute(f"""
                    INSERT INTO descuento_asignacion
                        (descuento_id, id_manager, id_trainer, cliente_idnoofit,
                         fecha_desde, fecha_hasta, estado)
                    VALUES (%s,%s,%s,%s,%s,%s,'activa')
                    ON CONFLICT (descuento_id, cliente_idnoofit) DO NOTHING
                    RETURNING {ASIGN_FIELDS}
                """, (desc_id, g.id_manager, id_trainer, cliente,
                      d.get('fecha_desde'), d.get('fecha_hasta')))
                row = cur.fetchone()
            if not row:
                ya_existentes.append(cliente)
                continue
            # Sync Odoo: añadir descuento a suscripciones activas del cliente
            if desc_odoo_id:
                get_sync().asignacion_apply(desc_odoo_id, cliente)
            creadas.append(_asig_row(row))
        except Exception as e:
            errores.append({'cliente': cliente, 'error': str(e)})

    return jsonify({
        'ok': True,
        'creadas': creadas,
        'ya_existentes': ya_existentes,
        'errores': errores,
    }), 201 if creadas else 200


@bp.route('/<int:desc_id>/asignaciones/<int:asig_id>', methods=['DELETE'])
@auth_required
def delete_asignacion(desc_id, asig_id):
    """Revoca una asignación."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT cliente_idnoofit FROM descuento_asignacion
                       WHERE id=%s AND descuento_id=%s AND id_manager=%s""",
                    (asig_id, desc_id, g.id_manager))
        r = cur.fetchone()
        cur.execute("DELETE FROM descuento_asignacion WHERE id=%s AND id_manager=%s",
                    (asig_id, g.id_manager))
        n = cur.rowcount

    # Sync Odoo: quitar el descuento de las suscripciones del cliente
    if r and n > 0:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("SELECT odoo_id FROM descuento WHERE id=%s", (desc_id,))
            desc_r = cur.fetchone()
        if desc_r and desc_r.get('odoo_id'):
            get_sync().asignacion_revoke(desc_r['odoo_id'], r['cliente_idnoofit'])

    return jsonify({'ok': True, 'deleted': n})


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
