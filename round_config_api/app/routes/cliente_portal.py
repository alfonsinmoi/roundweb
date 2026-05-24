"""Portal del cliente NoofitPro (entrada a /portal/* en el frontend).

  POST /api/cliente/login   (público)
  GET  /api/cliente/me      (JWT cliente)

El JWT que emitimos sirve también para los endpoints de fichaje del
módulo control horario (`/api/horario/fichaje`, `/estado`, etc.) gracias
al refactor de `trabajador_required` que acepta `kind='cliente'` con
`es_trabajador=true`.
"""
import logging
from flask import Blueprint, request, jsonify, g

from ..auth_trabajador import login_noofit_cliente
from ..auth_cliente import (
    issue_jwt_cliente, cliente_required, resolver_trabajador_activo,
)
from ..db import get_conn

bp = Blueprint('cliente_portal', __name__)
log = logging.getLogger(__name__)


@bp.route('/login', methods=['POST'])
def login_cliente():
    """Login del cliente NoofitPro contra el portal web.

    Body: { email, password, id_manager? }
    Devuelve JWT propio `kind='cliente'` con flag `es_trabajador`.

    Cualquier cliente NoofitPro puede entrar (categoría Trabajador o no).
    Para el fichaje, los endpoints de control horario validan que SÍ sea
    trabajador activo.
    """
    d = request.get_json() or {}
    email = (d.get('email') or '').strip().lower()
    password = d.get('password') or ''
    id_manager_hint = (d.get('id_manager') or '').strip() or None
    if not email or not password:
        return jsonify({'ok': False, 'error': 'email_y_password_requeridos'}), 400

    ok, info = login_noofit_cliente(email, password)
    if not ok:
        return jsonify({'ok': False, 'error': info}), 401

    # Resuelve cliente_idnoofit + id_manager desde cliente_cache.
    with get_conn() as conn, conn.cursor() as cur:
        sql = """
            SELECT id_manager, id::TEXT AS cliente_idnoofit,
                   name, surname, email, id_trainer
              FROM cliente_cache
             WHERE LOWER(email) = %s
        """
        params = [email]
        if id_manager_hint:
            sql += " AND id_manager = %s"
            params.append(id_manager_hint)
        cur.execute(sql, params)
        candidatos = cur.fetchall()

    if not candidatos:
        return jsonify({'ok': False, 'error': 'cliente_no_encontrado'}), 404
    if len(candidatos) > 1:
        return jsonify({
            'ok': False, 'error': 'manager_ambiguo',
            'managers': [c['id_manager'] for c in candidatos],
        }), 409
    c = candidatos[0]

    # ¿Es trabajador activo en este manager?
    trab = resolver_trabajador_activo(c['id_manager'], c['cliente_idnoofit'])

    # Categorías del cliente (Trabajador, Gympass, etc.) para personalizar UI.
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT cat.nombre
              FROM cliente_categoria cc
              JOIN categoria cat ON cat.id = cc.categoria_id
                                AND cat.id_manager = cc.id_manager
             WHERE cc.id_manager = %s AND cc.cliente_idnoofit = %s
        """, (c['id_manager'], c['cliente_idnoofit']))
        categorias = [r['nombre'] for r in cur.fetchall()]

    token = issue_jwt_cliente(
        c['cliente_idnoofit'], c['id_manager'],
        es_trabajador=bool(trab),
        trabajador_id=trab['id'] if trab else None,
    )
    nombre_completo = (f"{c['name'] or ''} {c['surname'] or ''}").strip()
    return jsonify({
        'ok': True,
        'token': token,
        'cliente': {
            'cliente_idnoofit': c['cliente_idnoofit'],
            'id_manager': c['id_manager'],
            'nombre': c['name'] or '',
            'apellidos': c['surname'] or '',
            'nombre_completo': nombre_completo,
            'email': c['email'] or '',
            'id_trainer_actual': str(c['id_trainer']) if c['id_trainer'] is not None else None,
            'categorias': categorias,
            'es_trabajador': bool(trab),
            'trabajador': {
                'id': trab['id'],
                'id_trainer_empleador': trab['id_trainer_empleador'],
                'nombre_completo': trab['nombre_completo'] or '',
            } if trab else None,
        },
    })


@bp.route('/me', methods=['GET'])
@cliente_required
def me_cliente():
    c = g.cliente
    # Recompute es_trabajador on-the-fly por si cambió el estado entre logins
    trab = resolver_trabajador_activo(g.id_manager, g.cliente_idnoofit)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT cat.nombre
              FROM cliente_categoria cc
              JOIN categoria cat ON cat.id = cc.categoria_id
                                AND cat.id_manager = cc.id_manager
             WHERE cc.id_manager = %s AND cc.cliente_idnoofit = %s
        """, (g.id_manager, g.cliente_idnoofit))
        categorias = [r['nombre'] for r in cur.fetchall()]
    nombre_completo = (f"{c.get('name') or ''} {c.get('surname') or ''}").strip()
    return jsonify({
        'ok': True,
        'cliente': {
            'cliente_idnoofit': g.cliente_idnoofit,
            'id_manager': g.id_manager,
            'nombre': c.get('name') or '',
            'apellidos': c.get('surname') or '',
            'nombre_completo': nombre_completo,
            'email': c.get('email') or '',
            'id_trainer_actual': str(c['id_trainer']) if c.get('id_trainer') is not None else None,
            'categorias': categorias,
            'es_trabajador': bool(trab),
            'trabajador': {
                'id': trab['id'],
                'id_trainer_empleador': trab['id_trainer_empleador'],
                'nombre_completo': trab['nombre_completo'] or '',
            } if trab else None,
        },
    })
