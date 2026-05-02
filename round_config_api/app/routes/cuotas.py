"""CRUD de cuotas + endpoint para adoptar plantilla.

Cada CREATE/UPDATE/DELETE se replica también en Odoo (round.cuota.catalogo)
si CONFIG_ODOO_SYNC=1. Si Odoo está caído, sigue funcionando sólo con Postgres.
"""
from flask import Blueprint, request, jsonify, g
from ..auth import auth_required
from ..db import get_conn
from ..odoo_sync import get_sync
from .. import config

bp = Blueprint('cuotas', __name__)

SELECT_FIELDS = """
    id, scope, id_manager, id_trainer, plantilla_origen_id, codigo, descripcion,
    precio_mensual, precio_bimensual, precio_trimestral,
    precio_semestral, precio_anual, matricula,
    formas_pago, periodicidades, actividades_idnoofit,
    active, odoo_id, created_at, updated_at
"""


def _validate_payload(d):
    """Valida campos enum. Devuelve None si OK, mensaje string si error."""
    if 'formas_pago' in d:
        for fp in d['formas_pago']:
            if fp not in config.FORMAS_PAGO:
                return f'forma_pago invalida: {fp}'
    if 'periodicidades' in d:
        for p in d['periodicidades']:
            if p not in config.PERIODICIDADES:
                return f'periodicidad invalida: {p}'
    return None


def _row_to_dict(row):
    """Serializa fechas y arrays para JSON."""
    if not row: return None
    out = dict(row)
    for k in ('created_at', 'updated_at'):
        if out.get(k):
            out[k] = out[k].isoformat()
    for k in ('precio_mensual','precio_bimensual','precio_trimestral',
              'precio_semestral','precio_anual','matricula'):
        if out.get(k) is not None:
            out[k] = float(out[k])
    return out


@bp.route('', methods=['GET'])
@auth_required
def list_cuotas():
    """Lista cuotas visibles para el usuario actual.

    - Si hay id_trainer: devuelve plantillas del manager + trainer-cuotas del trainer
    - Si solo id_manager: devuelve todas las plantillas y sus trainer-cuotas hijas
    """
    with get_conn() as conn:
        with conn.cursor() as cur:
            if g.id_trainer:
                cur.execute(f"""
                    SELECT {SELECT_FIELDS} FROM cuota
                    WHERE id_manager = %s
                      AND (scope = 'plantilla_manager'
                           OR (scope = 'trainer' AND id_trainer = %s))
                    ORDER BY scope, codigo
                """, (g.id_manager, g.id_trainer))
            else:
                cur.execute(f"""
                    SELECT {SELECT_FIELDS} FROM cuota
                    WHERE id_manager = %s
                    ORDER BY scope, id_trainer NULLS FIRST, codigo
                """, (g.id_manager,))
            rows = [_row_to_dict(r) for r in cur.fetchall()]
    return jsonify({'ok': True, 'cuotas': rows})


@bp.route('', methods=['POST'])
@auth_required
def create_cuota():
    d = request.get_json() or {}
    err = _validate_payload(d)
    if err: return jsonify({'ok': False, 'error': err}), 400

    if not d.get('codigo'):
        return jsonify({'ok': False, 'error': 'codigo_obligatorio'}), 400

    # scope: si hay id_trainer, es trainer-cuota; si no, plantilla manager
    scope = 'trainer' if g.id_trainer else 'plantilla_manager'
    id_trainer = g.id_trainer if scope == 'trainer' else None

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(f"""
                INSERT INTO cuota (
                    scope, id_manager, id_trainer, plantilla_origen_id, codigo, descripcion,
                    precio_mensual, precio_bimensual, precio_trimestral,
                    precio_semestral, precio_anual, matricula,
                    formas_pago, periodicidades, actividades_idnoofit, active
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                RETURNING {SELECT_FIELDS}
            """, (
                scope, g.id_manager, id_trainer, d.get('plantilla_origen_id'),
                d['codigo'], d.get('descripcion'),
                d.get('precio_mensual',0), d.get('precio_bimensual',0), d.get('precio_trimestral',0),
                d.get('precio_semestral',0), d.get('precio_anual',0), d.get('matricula',0),
                d.get('formas_pago', []), d.get('periodicidades', []),
                d.get('actividades_idnoofit', []), d.get('active', True),
            ))
            row = cur.fetchone()

    # Sync Odoo: solo plantillas de manager (las trainer-cuotas son derivadas)
    if scope == 'plantilla_manager':
        odoo_id = get_sync().cuota_create(row)
        if odoo_id and isinstance(odoo_id, int):
            with get_conn() as conn, conn.cursor() as cur:
                cur.execute("UPDATE cuota SET odoo_id=%s WHERE id=%s RETURNING odoo_id", (odoo_id, row['id']))
                row['odoo_id'] = odoo_id
    return jsonify({'ok': True, 'cuota': _row_to_dict(row)}), 201


@bp.route('/<int:cuota_id>', methods=['PUT', 'PATCH'])
@auth_required
def update_cuota(cuota_id):
    d = request.get_json() or {}
    err = _validate_payload(d)
    if err: return jsonify({'ok': False, 'error': err}), 400

    # Construir SET dinámico
    allowed = ('codigo','descripcion','precio_mensual','precio_bimensual','precio_trimestral',
               'precio_semestral','precio_anual','matricula','formas_pago','periodicidades',
               'actividades_idnoofit','active')
    sets, params = [], []
    for k in allowed:
        if k in d:
            sets.append(f"{k}=%s")
            params.append(d[k])
    if not sets:
        return jsonify({'ok': False, 'error': 'no_changes'}), 400

    params.extend([cuota_id, g.id_manager])
    sql = f"UPDATE cuota SET {','.join(sets)} WHERE id=%s AND id_manager=%s RETURNING {SELECT_FIELDS}"
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            row = cur.fetchone()
    if not row:
        return jsonify({'ok': False, 'error': 'not_found'}), 404

    # Sync Odoo: si es plantilla y tiene odoo_id, actualizar; si no, crear
    if row['scope'] == 'plantilla_manager':
        if row.get('odoo_id'):
            get_sync().cuota_update(row['odoo_id'], row)
        else:
            new_odoo_id = get_sync().cuota_create(row)
            if new_odoo_id and isinstance(new_odoo_id, int):
                with get_conn() as conn, conn.cursor() as cur:
                    cur.execute("UPDATE cuota SET odoo_id=%s WHERE id=%s", (new_odoo_id, row['id']))
                row['odoo_id'] = new_odoo_id
    return jsonify({'ok': True, 'cuota': _row_to_dict(row)})


@bp.route('/<int:cuota_id>', methods=['DELETE'])
@auth_required
def delete_cuota(cuota_id):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT odoo_id, scope FROM cuota WHERE id=%s AND id_manager=%s", (cuota_id, g.id_manager))
            r = cur.fetchone()
            cur.execute("DELETE FROM cuota WHERE id=%s AND id_manager=%s", (cuota_id, g.id_manager))
            n = cur.rowcount
    if r and r.get('odoo_id') and r.get('scope') == 'plantilla_manager':
        get_sync().cuota_delete(r['odoo_id'])
    return jsonify({'ok': True, 'deleted': n})


@bp.route('/<int:cuota_id>/adoptar', methods=['POST'])
@auth_required
def adoptar_plantilla(cuota_id):
    """Trainer adopta una plantilla del manager. Crea una trainer-cuota
    derivada con los datos de la plantilla."""
    if not g.id_trainer:
        return jsonify({'ok': False, 'error': 'requires_trainer_id'}), 400

    with get_conn() as conn:
        with conn.cursor() as cur:
            # Cargar la plantilla
            cur.execute(f"""
                SELECT {SELECT_FIELDS} FROM cuota
                WHERE id=%s AND id_manager=%s AND scope='plantilla_manager'
            """, (cuota_id, g.id_manager))
            plantilla = cur.fetchone()
            if not plantilla:
                return jsonify({'ok': False, 'error': 'plantilla_not_found'}), 404

            # ¿ya existe trainer-cuota con misma origen?
            cur.execute("""
                SELECT id FROM cuota
                WHERE id_trainer=%s AND plantilla_origen_id=%s AND scope='trainer'
            """, (g.id_trainer, cuota_id))
            existing = cur.fetchone()
            if existing:
                return jsonify({'ok': True, 'already_adopted': True, 'cuota_id': existing['id']})

            # Insert nueva trainer-cuota copiando campos
            cur.execute(f"""
                INSERT INTO cuota (
                    scope, id_manager, id_trainer, plantilla_origen_id, codigo, descripcion,
                    precio_mensual, precio_bimensual, precio_trimestral,
                    precio_semestral, precio_anual, matricula,
                    formas_pago, periodicidades, actividades_idnoofit, active
                ) VALUES ('trainer', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING {SELECT_FIELDS}
            """, (
                g.id_manager, g.id_trainer, cuota_id,
                plantilla['codigo'], plantilla['descripcion'],
                plantilla['precio_mensual'], plantilla['precio_bimensual'],
                plantilla['precio_trimestral'], plantilla['precio_semestral'],
                plantilla['precio_anual'], plantilla['matricula'],
                plantilla['formas_pago'], plantilla['periodicidades'],
                plantilla['actividades_idnoofit'], plantilla['active'],
            ))
            row = cur.fetchone()
    return jsonify({'ok': True, 'cuota': _row_to_dict(row)}), 201
