"""Endpoints CRUD para categorías de cliente + asignación cliente↔categoría.

Conceptos:
- categoria: catálogo a nivel manager. Cada manager define las suyas.
  Atributos: nombre, color, puede_reservar, tiene_cuota, activa.
- cliente_categoria: asignación 1:1 (un cliente NoofitPro → una categoría).
  Sin asignación = "Pagador con cuota" implícito.

Cuando NoofitPro publique un servicio equivalente, sincronizaremos vía
campo `noofit_alias` en categoria.
"""
import logging
from flask import Blueprint, request, jsonify, g
from ..auth import auth_required, require_permission, require_any_permission
from ..db import get_conn, seed_categorias_for_manager
from ..audit_log import log_action, actor_from_request

bp = Blueprint('categorias', __name__)
log = logging.getLogger(__name__)


# ─── CATÁLOGO ───────────────────────────────────────────────────────────────

@bp.route('', methods=['GET'])
@bp.route('/', methods=['GET'])
@auth_required
def list_categorias():
    """Lista las categorías del manager (incluye inactivas, frontend filtra)."""
    try:
        # Sembrar defaults si el manager nunca ha tenido categorías
        seed_categorias_for_manager(g.id_manager)
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT id, nombre, color, puede_reservar, tiene_cuota, activa,
                       noofit_alias, created_at, updated_at
                  FROM categoria
                 WHERE id_manager = %s
                 ORDER BY activa DESC, nombre ASC
            """, (g.id_manager,))
            rows = cur.fetchall()
        return jsonify({'ok': True, 'categorias': rows})
    except Exception as e:
        log.exception('list_categorias')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('', methods=['POST'])
@bp.route('/', methods=['POST'])
@auth_required
@require_permission('configuracion.categorias_cliente.crear')
def create_categoria():
    """Crea categoría. body = {nombre, color?, puede_reservar?, tiene_cuota?, activa?}"""
    try:
        d = request.get_json() or {}
        nombre = (d.get('nombre') or '').strip()
        if not nombre:
            return jsonify({'ok': False, 'error': 'nombre_required'}), 400
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                INSERT INTO categoria (id_manager, nombre, color, puede_reservar, tiene_cuota, activa, noofit_alias)
                VALUES (%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (id_manager, nombre) DO UPDATE
                  SET color = EXCLUDED.color,
                      puede_reservar = EXCLUDED.puede_reservar,
                      tiene_cuota = EXCLUDED.tiene_cuota,
                      activa = EXCLUDED.activa,
                      noofit_alias = COALESCE(EXCLUDED.noofit_alias, categoria.noofit_alias)
                RETURNING *
            """, (
                g.id_manager, nombre, d.get('color'),
                bool(d.get('puede_reservar', True)),
                bool(d.get('tiene_cuota', False)),
                bool(d.get('activa', True)),
                d.get('noofit_alias'),
            ))
            row = cur.fetchone()
        log_action(actor_from_request(), 'categoria', 'create',
                   entidad_id=(row or {}).get('id'),
                   resumen=f"Categoría creada {nombre}",
                   cambios={'nombre': nombre, 'color': d.get('color'),
                            'puede_reservar': bool(d.get('puede_reservar', True)),
                            'tiene_cuota': bool(d.get('tiene_cuota', False)),
                            'activa': bool(d.get('activa', True))})
        return jsonify({'ok': True, 'categoria': row})
    except Exception as e:
        log.exception('create_categoria')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/<int:cat_id>', methods=['PATCH', 'PUT'])
@auth_required
@require_permission('configuracion.categorias_cliente.editar')
def update_categoria(cat_id):
    """Edita categoría. Acepta cualquier subset de campos."""
    try:
        d = request.get_json() or {}
        allowed = ('nombre', 'color', 'puede_reservar', 'tiene_cuota', 'activa', 'noofit_alias')
        sets, vals = [], []
        for k in allowed:
            if k in d:
                sets.append(f"{k} = %s")
                vals.append(d[k])
        if not sets:
            return jsonify({'ok': False, 'error': 'no_fields'}), 400
        vals.extend([g.id_manager, cat_id])
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute(f"""
                UPDATE categoria SET {', '.join(sets)}
                 WHERE id_manager = %s AND id = %s
                RETURNING *
            """, vals)
            row = cur.fetchone()
        if not row:
            return jsonify({'ok': False, 'error': 'not_found'}), 404
        log_action(actor_from_request(), 'categoria', 'update',
                   entidad_id=cat_id,
                   resumen=f"Categoría actualizada {row.get('nombre')}",
                   cambios={k: d[k] for k in allowed if k in d})
        return jsonify({'ok': True, 'categoria': row})
    except Exception as e:
        log.exception('update_categoria')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/<int:cat_id>', methods=['DELETE'])
@auth_required
@require_permission('configuracion.categorias_cliente.borrar')
def delete_categoria(cat_id):
    """Borrado. Si la categoría está en uso, se desactiva (activa=false) en lugar
    de borrar duro, para no romper asignaciones existentes. Pasar ?hard=1 para
    forzar el borrado real (cascade quita asignaciones)."""
    try:
        hard = request.args.get('hard') == '1'
        with get_conn() as conn, conn.cursor() as cur:
            if hard:
                cur.execute("""
                    DELETE FROM categoria
                     WHERE id_manager = %s AND id = %s
                """, (g.id_manager, cat_id))
                deleted = cur.rowcount
                if deleted:
                    log_action(actor_from_request(), 'categoria', 'delete',
                               entidad_id=cat_id, resumen='Categoría eliminada (hard)')
                return jsonify({'ok': True, 'deleted': deleted, 'mode': 'hard'})
            # Soft: si tiene clientes, sólo desactiva
            cur.execute("""
                SELECT COUNT(*) AS n FROM cliente_categoria
                 WHERE id_manager = %s AND categoria_id = %s
            """, (g.id_manager, cat_id))
            n = (cur.fetchone() or {}).get('n', 0)
            if n > 0:
                cur.execute("""
                    UPDATE categoria SET activa = FALSE
                     WHERE id_manager = %s AND id = %s
                    RETURNING *
                """, (g.id_manager, cat_id))
                row = cur.fetchone()
                log_action(actor_from_request(), 'categoria', 'update',
                           entidad_id=cat_id,
                           resumen=f"Categoría desactivada (en uso por {n} clientes)",
                           cambios={'activa': {'before': True, 'after': False}})
                return jsonify({'ok': True, 'mode': 'deactivated', 'in_use': n, 'categoria': row})
            cur.execute("""
                DELETE FROM categoria
                 WHERE id_manager = %s AND id = %s
            """, (g.id_manager, cat_id))
            deleted = cur.rowcount
            if deleted:
                log_action(actor_from_request(), 'categoria', 'delete',
                           entidad_id=cat_id, resumen='Categoría eliminada (sin uso)')
            return jsonify({'ok': True, 'deleted': deleted, 'mode': 'hard'})
    except Exception as e:
        log.exception('delete_categoria')
        return jsonify({'ok': False, 'error': str(e)}), 500


# ─── ASIGNACIÓN CLIENTE ↔ CATEGORÍA ─────────────────────────────────────────

@bp.route('/asignaciones', methods=['GET'])
@auth_required
def list_asignaciones():
    """Devuelve mapa cliente_idnoofit → categoria completa (para frontend)."""
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT cc.cliente_idnoofit, c.id, c.nombre, c.color,
                       c.puede_reservar, c.tiene_cuota, c.activa
                  FROM cliente_categoria cc
                  JOIN categoria c ON c.id = cc.categoria_id
                 WHERE cc.id_manager = %s
            """, (g.id_manager,))
            rows = cur.fetchall()
        # mapa idnoofit → {id, nombre, color, …}
        mapa = {r['cliente_idnoofit']: {
            'id': r['id'], 'nombre': r['nombre'], 'color': r['color'],
            'puede_reservar': r['puede_reservar'], 'tiene_cuota': r['tiene_cuota'],
            'activa': r['activa'],
        } for r in rows}
        return jsonify({'ok': True, 'mapa': mapa})
    except Exception as e:
        log.exception('list_asignaciones')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/conteo-clientes', methods=['GET'])
@auth_required
def conteo_clientes():
    """Cuenta clientes por categoría (para informe asistencia y dashboard)."""
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT c.id, c.nombre, c.color, c.activa, c.puede_reservar, c.tiene_cuota,
                       COUNT(cc.cliente_idnoofit)::int AS clientes
                  FROM categoria c
                  LEFT JOIN cliente_categoria cc
                    ON cc.categoria_id = c.id AND cc.id_manager = c.id_manager
                 WHERE c.id_manager = %s
                 GROUP BY c.id
                 ORDER BY c.activa DESC, c.nombre ASC
            """, (g.id_manager,))
            rows = cur.fetchall()
        return jsonify({'ok': True, 'conteo': rows})
    except Exception as e:
        log.exception('conteo_clientes')
        return jsonify({'ok': False, 'error': str(e)}), 500


# Asignación per-cliente: GET / PUT / DELETE
@bp.route('/clientes/<id_noofit>', methods=['GET'])
@auth_required
def get_cliente_categoria(id_noofit):
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT cc.cliente_idnoofit, cc.categoria_id,
                       c.nombre, c.color, c.puede_reservar, c.tiene_cuota, c.activa
                  FROM cliente_categoria cc
                  JOIN categoria c ON c.id = cc.categoria_id
                 WHERE cc.id_manager = %s AND cc.cliente_idnoofit = %s
            """, (g.id_manager, str(id_noofit)))
            row = cur.fetchone()
        return jsonify({'ok': True, 'asignacion': row})
    except Exception as e:
        log.exception('get_cliente_categoria')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/clientes/<id_noofit>', methods=['PUT'])
@auth_required
@require_any_permission('clientes.asignar_categoria',
                        'configuracion.categorias_cliente.asignar_a_cliente')
def set_cliente_categoria(id_noofit):
    """body = {categoria_id: int|null}. Si null o vacío, borra la asignación."""
    try:
        d = request.get_json() or {}
        cat_id = d.get('categoria_id')
        with get_conn() as conn, conn.cursor() as cur:
            if not cat_id:
                cur.execute("""
                    DELETE FROM cliente_categoria
                     WHERE id_manager = %s AND cliente_idnoofit = %s
                """, (g.id_manager, str(id_noofit)))
                removed = cur.rowcount
                if removed:
                    log_action(actor_from_request(), 'cliente_categoria', 'delete',
                               entidad_id=str(id_noofit),
                               resumen='Categoría desasignada del cliente')
                return jsonify({'ok': True, 'asignacion': None, 'removed': removed})
            # Validar que la categoría existe en este manager
            cur.execute("""
                SELECT id FROM categoria
                 WHERE id_manager = %s AND id = %s
            """, (g.id_manager, int(cat_id)))
            if not cur.fetchone():
                return jsonify({'ok': False, 'error': 'categoria_invalida'}), 400
            cur.execute("""
                INSERT INTO cliente_categoria (id_manager, cliente_idnoofit, categoria_id)
                VALUES (%s,%s,%s)
                ON CONFLICT (id_manager, cliente_idnoofit)
                DO UPDATE SET categoria_id = EXCLUDED.categoria_id
                RETURNING categoria_id
            """, (g.id_manager, str(id_noofit), int(cat_id)))
            row = cur.fetchone()
        log_action(actor_from_request(), 'cliente_categoria', 'asignar',
                   entidad_id=str(id_noofit),
                   resumen='Categoría asignada al cliente',
                   cambios={'categoria_id': int(cat_id)})
        return jsonify({'ok': True, 'asignacion': row})
    except Exception as e:
        log.exception('set_cliente_categoria')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/clientes/<id_noofit>', methods=['DELETE'])
@auth_required
@require_any_permission('clientes.asignar_categoria',
                        'configuracion.categorias_cliente.quitar_de_cliente')
def del_cliente_categoria(id_noofit):
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                DELETE FROM cliente_categoria
                 WHERE id_manager = %s AND cliente_idnoofit = %s
            """, (g.id_manager, str(id_noofit)))
            n = cur.rowcount
        if n:
            log_action(actor_from_request(), 'cliente_categoria', 'delete',
                       entidad_id=str(id_noofit),
                       resumen='Categoría desasignada del cliente')
        return jsonify({'ok': True, 'removed': n})
    except Exception as e:
        log.exception('del_cliente_categoria')
        return jsonify({'ok': False, 'error': str(e)}), 500


# ─── HELPER (reutilizable desde otros módulos) ──────────────────────────────

def cliente_puede_reservar(id_manager: str, cliente_idnoofit: str) -> dict:
    """Devuelve {ok: bool, motivo: str|None, categoria: dict|None}.

    Reglas:
      - Sin asignación → ok=True (pagador con cuota implícito).
      - Categoría inactiva → ok=False.
      - Categoría con puede_reservar=False → ok=False.
    """
    if not id_manager or not cliente_idnoofit:
        return {'ok': True, 'motivo': None, 'categoria': None}
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT c.id, c.nombre, c.activa, c.puede_reservar, c.tiene_cuota
                  FROM cliente_categoria cc
                  JOIN categoria c ON c.id = cc.categoria_id
                 WHERE cc.id_manager = %s AND cc.cliente_idnoofit = %s
            """, (str(id_manager), str(cliente_idnoofit)))
            cat = cur.fetchone()
        if not cat:
            return {'ok': True, 'motivo': None, 'categoria': None}
        if not cat['activa']:
            return {'ok': False, 'motivo': f"Categoría '{cat['nombre']}' inactiva", 'categoria': cat}
        if not cat['puede_reservar']:
            return {'ok': False, 'motivo': f"La categoría '{cat['nombre']}' no permite reservar clases", 'categoria': cat}
        return {'ok': True, 'motivo': None, 'categoria': cat}
    except Exception as e:
        log.exception('cliente_puede_reservar')
        # En caso de error, no bloqueamos (fail-open)
        return {'ok': True, 'motivo': None, 'categoria': None}
