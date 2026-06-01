"""CRUD de grupos familiares.

Una familia agrupa N clientes. Sirve para que los descuentos de tipo
"familiares" se apliquen automáticamente a TODOS los miembros activos
cuando hay ≥ 2 en alta para la cuota indicada.

Endpoints:
  GET    /api/familias                          lista todas las familias del manager + sus miembros
  POST   /api/familias                          crea familia { nombre? }
  GET    /api/familias/<id>                     ficha de una familia
  PATCH  /api/familias/<id>                     renombra familia
  DELETE /api/familias/<id>                     borra familia (cascade miembros)

  GET    /api/familias/cliente/<idnoofit>       devuelve la familia (con miembros) del cliente, o null
  POST   /api/familias/cliente/<idnoofit>       añade el cliente a una familia.
                                                body = {familia_id?: int, otro_cliente_idnoofit?: str}
                                                  - familia_id: si ya existe la familia, lo añade
                                                  - otro_cliente_idnoofit: crea (o reutiliza) la
                                                    familia del otro cliente y mete a éste
                                                  - Si nada: crea familia nueva con sólo este cliente
  DELETE /api/familias/cliente/<idnoofit>       quita al cliente de su familia
"""
import logging
from flask import Blueprint, request, jsonify, g

from ..auth import auth_required, require_permission
from ..db import get_conn
from ..trainer_scope import cliente_pertenece_a_trainer

bp = Blueprint('familias', __name__)
# Aceptamos rutas con y sin barra final para que nginx pueda hacer
# proxy_pass http://.../api/familias/ sin generar 301.
log = logging.getLogger(__name__)


def _row(r):
    if not r: return None
    out = dict(r)
    for k in ('created_at', 'updated_at'):
        if out.get(k): out[k] = out[k].isoformat()
    return out


def _miembros_de(cur, familia_id):
    cur.execute("""
        SELECT id, cliente_idnoofit, created_at
          FROM familia_miembro
         WHERE familia_id = %s
         ORDER BY created_at ASC
    """, (familia_id,))
    return [_row(r) for r in cur.fetchall()]


# ── LISTADO ────────────────────────────────────────────────────────────────

@bp.route('', methods=['GET'])
@bp.route('/', methods=['GET'])
@auth_required
def list_():
    """Lista todas las familias del manager con sus miembros embebidos.

    Aislamiento por trainer: si el usuario está impersonando un trainer,
    devolvemos sólo familias con ≥1 miembro perteneciente a ese trainer
    (vía `cliente_cache.id_trainer`). El manager bare ve todas."""
    where = ['f.id_manager = %s']
    vals = [str(g.id_manager)]
    if g.id_trainer:
        # EXISTS sub-correlated: la familia tiene al menos un miembro cuyo
        # cliente está asignado a este trainer.
        where.append("""EXISTS (
            SELECT 1 FROM familia_miembro fm
              JOIN cliente_cache cc
                ON cc.id::text = fm.cliente_idnoofit
               AND cc.id_manager = fm.id_manager
             WHERE fm.familia_id = f.id
               AND cc.id_trainer = %s
        )""")
        vals.append(str(g.id_trainer))
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"""
            SELECT f.id, f.id_manager, f.nombre, f.created_at, f.updated_at
              FROM familia f
             WHERE {' AND '.join(where)}
             ORDER BY f.nombre NULLS LAST, f.created_at
        """, vals)
        familias = [_row(r) for r in cur.fetchall()]
        for f in familias:
            f['miembros'] = _miembros_de(cur, f['id'])
    return jsonify({'ok': True, 'familias': familias})


@bp.route('/<int:_id>', methods=['GET'])
@auth_required
def get(_id):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT id, id_manager, nombre, created_at, updated_at
              FROM familia
             WHERE id_manager = %s AND id = %s
        """, (str(g.id_manager), _id))
        f = _row(cur.fetchone())
        if not f:
            return jsonify({'ok': False, 'error': 'not_found'}), 404
        f['miembros'] = _miembros_de(cur, _id)
        # Aislamiento por trainer: si está impersonado, comprobar que la
        # familia tiene al menos un miembro suyo. Si no, 404 (no exponer).
        if g.id_trainer:
            cur.execute("""
                SELECT 1 FROM familia_miembro fm
                  JOIN cliente_cache cc
                    ON cc.id::text = fm.cliente_idnoofit
                   AND cc.id_manager = fm.id_manager
                 WHERE fm.familia_id = %s
                   AND cc.id_trainer = %s
                 LIMIT 1
            """, (_id, str(g.id_trainer)))
            if not cur.fetchone():
                return jsonify({'ok': False, 'error': 'not_found'}), 404
    return jsonify({'ok': True, 'familia': f})


# ── CRUD FAMILIAS ──────────────────────────────────────────────────────────

@bp.route('', methods=['POST'])
@bp.route('/', methods=['POST'])
@auth_required
@require_permission('clientes.familias.crear')
def create():
    d = request.get_json() or {}
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            INSERT INTO familia (id_manager, nombre)
            VALUES (%s, %s)
            RETURNING id, id_manager, nombre, created_at, updated_at
        """, (str(g.id_manager), (d.get('nombre') or '').strip() or None))
        f = _row(cur.fetchone())
        f['miembros'] = []
    return jsonify({'ok': True, 'familia': f}), 201


@bp.route('/<int:_id>', methods=['PATCH', 'PUT'])
@auth_required
@require_permission('clientes.familias.editar')
def update(_id):
    d = request.get_json() or {}
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE familia SET nombre = %s, updated_at = NOW()
             WHERE id_manager = %s AND id = %s
            RETURNING id, id_manager, nombre, created_at, updated_at
        """, ((d.get('nombre') or '').strip() or None, str(g.id_manager), _id))
        f = _row(cur.fetchone())
        if not f:
            return jsonify({'ok': False, 'error': 'not_found'}), 404
        f['miembros'] = _miembros_de(cur, _id)
    return jsonify({'ok': True, 'familia': f})


@bp.route('/<int:_id>', methods=['DELETE'])
@auth_required
@require_permission('clientes.familias.borrar')
def delete(_id):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            DELETE FROM familia
             WHERE id_manager = %s AND id = %s
        """, (str(g.id_manager), _id))
        n = cur.rowcount
    if n == 0:
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    return jsonify({'ok': True, 'deleted': n})


# ── MIEMBROS POR CLIENTE ───────────────────────────────────────────────────

@bp.route('/cliente/<idnoofit>', methods=['GET'])
@auth_required
def familia_de_cliente(idnoofit):
    """Devuelve la familia del cliente (incluyendo TODOS sus miembros) o null."""
    # Aislamiento por trainer: si el cliente no es del trainer impersonado,
    # devolver null (no exponer la familia y sus otros miembros).
    if not cliente_pertenece_a_trainer(idnoofit):
        return jsonify({'ok': True, 'familia': None})
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT f.id, f.id_manager, f.nombre, f.created_at, f.updated_at
              FROM familia f
              JOIN familia_miembro m ON m.familia_id = f.id
             WHERE f.id_manager = %s AND m.cliente_idnoofit = %s
             LIMIT 1
        """, (str(g.id_manager), str(idnoofit)))
        f = _row(cur.fetchone())
        if not f:
            return jsonify({'ok': True, 'familia': None})
        f['miembros'] = _miembros_de(cur, f['id'])
    return jsonify({'ok': True, 'familia': f})


@bp.route('/cliente/<idnoofit>', methods=['POST'])
@auth_required
@require_permission('clientes.familias.asignar')
def add_cliente_a_familia(idnoofit):
    """Asigna `idnoofit` a una familia.

    Estrategia:
      - Si `body.familia_id` viene → añadir a esa familia.
      - Si `body.otro_cliente_idnoofit` viene → buscar la familia del otro
        cliente; si no tiene, crear una nueva con ambos.
      - Si nada viene → crear una familia nueva con sólo este cliente.
    Si el cliente ya está en una familia, devuelve error (debe quitarlo antes
    o pasar `force_move=true` para moverlo).
    """
    d = request.get_json() or {}
    force_move = bool(d.get('force_move', False))
    target_familia_id = d.get('familia_id')
    # otro_cliente_idnoofit puede llegar como int desde NoofitPro o string.
    _raw_otro = d.get('otro_cliente_idnoofit')
    otro_idn = str(_raw_otro).strip() if _raw_otro is not None else ''

    with get_conn() as conn, conn.cursor() as cur:
        # ¿Ya está en alguna familia?
        cur.execute("""
            SELECT familia_id FROM familia_miembro
             WHERE id_manager = %s AND cliente_idnoofit = %s
        """, (str(g.id_manager), str(idnoofit)))
        existente = cur.fetchone()
        if existente and not force_move:
            return jsonify({'ok': False, 'error': 'cliente_ya_en_familia',
                            'familia_id': existente['familia_id']}), 409

        # Resolver target_familia_id
        if target_familia_id:
            cur.execute("""SELECT id FROM familia
                            WHERE id_manager=%s AND id=%s""",
                        (str(g.id_manager), int(target_familia_id)))
            if not cur.fetchone():
                return jsonify({'ok': False, 'error': 'familia_not_found'}), 404
        elif otro_idn:
            cur.execute("""
                SELECT familia_id FROM familia_miembro
                 WHERE id_manager = %s AND cliente_idnoofit = %s
            """, (str(g.id_manager), otro_idn))
            otro_fam = cur.fetchone()
            if otro_fam:
                target_familia_id = otro_fam['familia_id']
            else:
                # Crear familia y meter al OTRO también
                cur.execute("""
                    INSERT INTO familia (id_manager) VALUES (%s) RETURNING id
                """, (str(g.id_manager),))
                target_familia_id = cur.fetchone()['id']
                cur.execute("""
                    INSERT INTO familia_miembro (familia_id, id_manager, cliente_idnoofit)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (id_manager, cliente_idnoofit) DO NOTHING
                """, (target_familia_id, str(g.id_manager), otro_idn))
        else:
            # Familia nueva sólo para este cliente
            cur.execute("""
                INSERT INTO familia (id_manager) VALUES (%s) RETURNING id
            """, (str(g.id_manager),))
            target_familia_id = cur.fetchone()['id']

        # Si forzamos movimiento, primero quitar al cliente de su familia anterior
        if existente and force_move:
            cur.execute("""
                DELETE FROM familia_miembro
                 WHERE id_manager=%s AND cliente_idnoofit=%s
            """, (str(g.id_manager), str(idnoofit)))

        # Insertar al cliente
        cur.execute("""
            INSERT INTO familia_miembro (familia_id, id_manager, cliente_idnoofit)
            VALUES (%s, %s, %s)
            ON CONFLICT (id_manager, cliente_idnoofit) DO UPDATE
              SET familia_id = EXCLUDED.familia_id
            RETURNING id, familia_id, cliente_idnoofit, created_at
        """, (target_familia_id, str(g.id_manager), str(idnoofit)))
        miembro = _row(cur.fetchone())

        # Limpieza: borrar familias huérfanas (sin miembros) de la familia anterior
        if existente and force_move and existente['familia_id'] != target_familia_id:
            cur.execute("""
                DELETE FROM familia
                 WHERE id = %s AND id_manager = %s
                   AND NOT EXISTS (
                       SELECT 1 FROM familia_miembro WHERE familia_id = %s)
            """, (existente['familia_id'], str(g.id_manager), existente['familia_id']))

    return jsonify({'ok': True, 'miembro': miembro,
                    'familia_id': target_familia_id}), 201


@bp.route('/cliente/<idnoofit>', methods=['DELETE'])
@auth_required
@require_permission('clientes.familias.asignar')
def quitar_cliente_de_familia(idnoofit):
    """Quita al cliente de su familia. Si la familia queda vacía, la borra."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            DELETE FROM familia_miembro
             WHERE id_manager = %s AND cliente_idnoofit = %s
            RETURNING familia_id
        """, (str(g.id_manager), str(idnoofit)))
        r = cur.fetchone()
        if not r:
            return jsonify({'ok': False, 'error': 'no_pertenece_a_familia'}), 404
        # Borrar familia si queda vacía
        cur.execute("""
            DELETE FROM familia f
             WHERE f.id = %s
               AND NOT EXISTS (SELECT 1 FROM familia_miembro WHERE familia_id = f.id)
        """, (r['familia_id'],))
    return jsonify({'ok': True})
