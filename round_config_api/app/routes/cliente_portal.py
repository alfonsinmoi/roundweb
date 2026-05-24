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


# ═══════════════════════════════════════════════════════════════════════════
# ║  Solicitud de alta laboral (modelo trabajador-iniciado)                 ║
# ═══════════════════════════════════════════════════════════════════════════

# Categorías NoofitPro que actúan de cerradura para solicitar alta.
TRABAJADOR_CATEGORIAS = ('Trabajador', 'Trabajadores', 'Empleado', 'Empleados')


def _categorias_cliente(id_manager: str, cliente_idnoofit: str):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT cat.nombre
              FROM cliente_categoria cc
              JOIN categoria cat ON cat.id = cc.categoria_id
                                AND cat.id_manager = cc.id_manager
             WHERE cc.id_manager = %s AND cc.cliente_idnoofit = %s
        """, (str(id_manager), str(cliente_idnoofit)))
        return [r['nombre'] for r in cur.fetchall()]


def _trabajador_de_cliente(id_manager: str, cliente_idnoofit: str):
    """Devuelve la fila trabajador para este cliente (cualquier estado)."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT id, id_manager, cliente_idnoofit, id_trainer_empleador,
                   nif, nombre_completo, email, jornada_h_semana,
                   categoria_profesional, tipo_contrato,
                   fecha_alta_laboral, fecha_baja_laboral,
                   estado, solicitud_motivo, rechazo_motivo, resuelto_at,
                   notas, created_at
              FROM trabajador
             WHERE id_manager = %s AND cliente_idnoofit = %s
        """, (str(id_manager), str(cliente_idnoofit)))
        return cur.fetchone()


def _trabajador_to_portal_dict(t):
    if not t:
        return None
    return {
        'id': t['id'],
        'estado': t['estado'],
        'id_trainer_empleador': t['id_trainer_empleador'],
        'nif': t['nif'] or '',
        'jornada_h_semana': float(t['jornada_h_semana']) if t['jornada_h_semana'] is not None else None,
        'fecha_alta_laboral': t['fecha_alta_laboral'].isoformat() if t['fecha_alta_laboral'] else None,
        'fecha_baja_laboral': t['fecha_baja_laboral'].isoformat() if t['fecha_baja_laboral'] else None,
        'solicitud_motivo': t['solicitud_motivo'] or '',
        'rechazo_motivo': t['rechazo_motivo'] or '',
        'resuelto_at': t['resuelto_at'].isoformat() if t['resuelto_at'] else None,
        'created_at': t['created_at'].isoformat() if t['created_at'] else None,
    }


@bp.route('/mi-trabajador', methods=['GET'])
@cliente_required
def mi_trabajador():
    """Estado de la solicitud/situación laboral del cliente logueado."""
    cats = _categorias_cliente(g.id_manager, g.cliente_idnoofit)
    elegible = any(c in TRABAJADOR_CATEGORIAS for c in cats)
    trab = _trabajador_de_cliente(g.id_manager, g.cliente_idnoofit)
    return jsonify({
        'ok': True,
        'elegible': elegible,                           # tiene categoría Trabajador en NF
        'categorias': cats,
        'trabajador': _trabajador_to_portal_dict(trab),
    })


@bp.route('/solicitar-alta-trabajador', methods=['POST'])
@cliente_required
def solicitar_alta_trabajador():
    """El cliente solicita su alta como trabajador.

    Body: { nif, jornada_h_semana, id_trainer_empleador,
            fecha_alta_esperada (opt), motivo (opt) }

    Requiere: tener categoría "Trabajador" en NoofitPro.
    No puede solicitar si ya está activo. Si está rechazada o pendiente,
    actualiza la solicitud existente con los datos nuevos.
    """
    d = request.get_json() or {}
    nif = (d.get('nif') or '').strip().upper()
    try:
        jornada = float(d.get('jornada_h_semana')) if d.get('jornada_h_semana') not in (None, '') else None
    except (TypeError, ValueError):
        jornada = None
    trainer = (d.get('id_trainer_empleador') or '').strip()
    fecha_alta = (d.get('fecha_alta_esperada') or '').strip() or None
    motivo = (d.get('motivo') or '').strip() or None

    if not nif or not jornada or not trainer:
        return jsonify({
            'ok': False, 'error': 'campos_requeridos',
            'detalle': 'NIF, jornada y trainer son obligatorios',
        }), 400

    # Cerradura: requerir categoría Trabajador en NoofitPro
    cats = _categorias_cliente(g.id_manager, g.cliente_idnoofit)
    if not any(c in TRABAJADOR_CATEGORIAS for c in cats):
        return jsonify({
            'ok': False, 'error': 'no_elegible',
            'detalle': 'Tu cuenta no tiene la categoría Trabajador en NoofitPro. Habla con tu manager.',
        }), 403

    existing = _trabajador_de_cliente(g.id_manager, g.cliente_idnoofit)
    if existing and existing['estado'] == 'activo':
        return jsonify({'ok': False, 'error': 'ya_activo'}), 409
    if existing and existing['estado'] == 'baja':
        return jsonify({'ok': False, 'error': 'estas_de_baja',
                        'detalle': 'Estás dado de baja. Contacta con tu manager para reactivar.'}), 409

    cli = g.cliente
    nombre = f"{(cli.get('name') or '').strip()} {(cli.get('surname') or '').strip()}".strip() or None
    email  = cli.get('email') or None

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            INSERT INTO trabajador
              (id_manager, cliente_idnoofit, id_trainer_empleador, nif,
               nombre_completo, email, jornada_h_semana, fecha_alta_laboral,
               estado, solicitud_motivo)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'pendiente_autorizacion',%s)
            ON CONFLICT (id_manager, cliente_idnoofit) DO UPDATE SET
              id_trainer_empleador = EXCLUDED.id_trainer_empleador,
              nif                  = EXCLUDED.nif,
              nombre_completo      = COALESCE(EXCLUDED.nombre_completo, trabajador.nombre_completo),
              email                = COALESCE(EXCLUDED.email, trabajador.email),
              jornada_h_semana     = EXCLUDED.jornada_h_semana,
              fecha_alta_laboral   = COALESCE(EXCLUDED.fecha_alta_laboral, trabajador.fecha_alta_laboral),
              estado               = 'pendiente_autorizacion',
              solicitud_motivo     = EXCLUDED.solicitud_motivo,
              rechazo_motivo       = NULL,
              resuelto_at          = NULL,
              autorizado_por_usuario_id = NULL,
              updated_at           = NOW()
            RETURNING id, estado
        """, (str(g.id_manager), str(g.cliente_idnoofit), trainer, nif,
              nombre, email, jornada, fecha_alta, motivo))
        row = cur.fetchone()
    return jsonify({
        'ok': True,
        'trabajador_id': row['id'],
        'estado': row['estado'],
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
