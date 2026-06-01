"""Persistencia del banner "Nuevos clientes esperando cobro".

Cuando el trainer pulsa "✕" para descartar un cliente del banner sin asignarle
categoría, lo guardamos aquí para que el dismiss se mantenga entre navegadores
y dispositivos.

Endpoints:
  GET    /api/clientes-atendidos                       lista cliente_idnoofit atendidos
  POST   /api/clientes-atendidos                       marca uno o varios como atendido
                                                       body = {cliente_idnoofit: 'X'} o
                                                              {clientes: ['X','Y',...]}
  DELETE /api/clientes-atendidos/<cliente_idnoofit>    desmarca (vuelve a aparecer)
  DELETE /api/clientes-atendidos                       desmarca todos (reset banner)
"""
import logging
from functools import wraps
from flask import Blueprint, request, jsonify, g

from ..auth import auth_required
from ..auth_usuario import usuario_web_required
from ..db import get_conn
from ..audit_log import actor_from_request

bp = Blueprint('clientes_atendidos', __name__)
log = logging.getLogger(__name__)


def either_auth(fn):
    """Acepta X-Round-Token (manager) o JWT Bearer (usuario_web). Necesario
    para que los usuarios_web del centro compartan la misma lista de
    'clientes atendidos' que el manager — antes solo manager podía leer/
    escribir y los usuario_web se quedaban con un set local distinto cada
    uno (cada navegador veía clientes distintos en el banner)."""
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if request.headers.get('Authorization', '').startswith('Bearer '):
            return usuario_web_required(fn)(*args, **kwargs)
        return auth_required(fn)(*args, **kwargs)
    return wrapper


@bp.route('', methods=['GET'])
@bp.route('/', methods=['GET'])
@either_auth
def list_():
    """Devuelve {ids: ['1817686','1818030',...]} para que el frontend filtre.

    Aislamiento por trainer: si está impersonado, restringimos a clientes
    suyos vía cliente_cache."""
    from ..trainer_scope import apply_trainer_filter_via_cache
    where = ['id_manager = %s']
    vals = [str(g.id_manager)]
    apply_trainer_filter_via_cache(where, vals, cliente_col='cliente_idnoofit')
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"""
            SELECT cliente_idnoofit
              FROM cliente_atendido_banner
             WHERE {' AND '.join(where)}
        """, vals)
        ids = [r['cliente_idnoofit'] for r in cur.fetchall()]
    return jsonify({'ok': True, 'ids': ids})


@bp.route('', methods=['POST'])
@bp.route('/', methods=['POST'])
@either_auth
def mark_atendidos():
    """Marca uno o varios clientes como atendidos. Idempotente (UPSERT).

    body:
      {cliente_idnoofit: 'X'}            → marca un cliente
      {clientes: ['X','Y','Z']}          → marca varios
    """
    d = request.get_json() or {}
    ids = []
    if d.get('cliente_idnoofit'):
        ids = [str(d['cliente_idnoofit'])]
    elif isinstance(d.get('clientes'), list):
        ids = [str(x) for x in d['clientes'] if x]
    if not ids:
        return jsonify({'ok': False, 'error': 'cliente_idnoofit_required'}), 400

    actor = actor_from_request()
    actor_label = actor.get('label') or actor.get('email') or 'API'

    with get_conn() as conn, conn.cursor() as cur:
        # UPSERT en bloque
        from psycopg.rows import dict_row  # noqa
        cur.executemany("""
            INSERT INTO cliente_atendido_banner
              (id_manager, cliente_idnoofit, atendido_por)
            VALUES (%s, %s, %s)
            ON CONFLICT (id_manager, cliente_idnoofit) DO UPDATE
              SET atendido_at = NOW(), atendido_por = EXCLUDED.atendido_por
        """, [(str(g.id_manager), idn, actor_label) for idn in ids])
    return jsonify({'ok': True, 'marcados': len(ids)})


@bp.route('/<cliente_idnoofit>', methods=['DELETE'])
@either_auth
def unmark(cliente_idnoofit):
    """Desmarca un cliente (volverá a aparecer en el banner)."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            DELETE FROM cliente_atendido_banner
             WHERE id_manager = %s AND cliente_idnoofit = %s
        """, (str(g.id_manager), str(cliente_idnoofit)))
        n = cur.rowcount
    return jsonify({'ok': True, 'deleted': n})


@bp.route('', methods=['DELETE'])
@bp.route('/', methods=['DELETE'])
@either_auth
def unmark_all():
    """Vacía la lista de atendidos del manager (reset del banner)."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            DELETE FROM cliente_atendido_banner WHERE id_manager = %s
        """, (str(g.id_manager),))
        n = cur.rowcount
    return jsonify({'ok': True, 'deleted': n})
