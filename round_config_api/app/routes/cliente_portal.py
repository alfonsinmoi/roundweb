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
    """Devuelve la fila trabajador para este cliente (cualquier estado).

    JOIN con centro_contacto para devolver `nombre_trainer_empleador` —
    así el portal puede mostrar el nombre del centro (no el ID crudo).
    """
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT t.id, t.id_manager, t.cliente_idnoofit, t.id_trainer_empleador,
                   t.nif, t.nombre_completo, t.email, t.jornada_h_semana,
                   t.categoria_profesional, t.tipo_contrato,
                   t.fecha_alta_laboral, t.fecha_baja_laboral,
                   t.estado, t.solicitud_motivo, t.rechazo_motivo, t.resuelto_at,
                   t.notas, t.created_at,
                   c.nombre_centro AS nombre_trainer_empleador
              FROM trabajador t
              LEFT JOIN centro_contacto c
                ON c.id_manager = t.id_manager
               AND c.id_trainer = t.id_trainer_empleador::text
             WHERE t.id_manager = %s AND t.cliente_idnoofit = %s
        """, (str(id_manager), str(cliente_idnoofit)))
        return cur.fetchone()


def _trabajador_to_portal_dict(t):
    if not t:
        return None
    return {
        'id': t['id'],
        'estado': t['estado'],
        'id_trainer_empleador': t['id_trainer_empleador'],
        'nombre_trainer_empleador': t.get('nombre_trainer_empleador') or '',
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


# ═══════════════════════════════════════════════════════════════════════════
# ║  BUZÓN — Notificaciones + Notas dirigidas al cliente                     ║
# ═══════════════════════════════════════════════════════════════════════════

@bp.route('/notificaciones', methods=['GET'])
@cliente_required
def listar_notificaciones():
    """Notificaciones recibidas por este cliente (vía notif_destinatario)."""
    solo_no_leidas = (request.args.get('solo_no_leidas') or '').lower() in ('1', 'true', 'yes')
    with get_conn() as conn, conn.cursor() as cur:
        sql = """
          SELECT d.id AS dest_id, d.leida, d.fecha_lectura,
                 e.id AS envio_id, e.seccion, e.tipo, e.titulo, e.cuerpo,
                 e.cuerpo_html, e.url, e.fecha_envio, e.created_at,
                 e.fecha_desaparicion
            FROM notif_destinatario d
            JOIN notif_envio e ON e.id = d.envio_id
           WHERE d.cliente_idnoofit = %s
             AND d.id_manager = %s
             AND e.estado = 'enviada'
             AND (e.fecha_desaparicion IS NULL OR e.fecha_desaparicion > NOW())
        """
        params = [str(g.cliente_idnoofit), str(g.id_manager)]
        if solo_no_leidas:
            sql += " AND d.leida = FALSE"
        sql += " ORDER BY COALESCE(e.fecha_envio, e.created_at) DESC LIMIT 100"
        cur.execute(sql, params)
        rows = cur.fetchall()
        cur.execute("""
          SELECT COUNT(*) AS n FROM notif_destinatario d
            JOIN notif_envio e ON e.id = d.envio_id
           WHERE d.cliente_idnoofit = %s AND d.id_manager = %s
             AND d.leida = FALSE AND e.estado = 'enviada'
             AND (e.fecha_desaparicion IS NULL OR e.fecha_desaparicion > NOW())
        """, (str(g.cliente_idnoofit), str(g.id_manager)))
        no_leidas = cur.fetchone()['n']

    return jsonify({
        'ok': True,
        'no_leidas': no_leidas,
        'notificaciones': [{
            'id': r['dest_id'],
            'envio_id': r['envio_id'],
            'seccion': r['seccion'],
            'tipo': r['tipo'],
            'titulo': r['titulo'],
            'cuerpo': r['cuerpo'] or '',
            'cuerpo_html': r['cuerpo_html'] or '',
            'url': r['url'] or '',
            'leida': bool(r['leida']),
            'fecha_lectura': r['fecha_lectura'].isoformat() if r['fecha_lectura'] else None,
            'fecha': (r['fecha_envio'] or r['created_at']).isoformat() if (r['fecha_envio'] or r['created_at']) else None,
        } for r in rows],
    })


@bp.route('/notificaciones/<int:dest_id>/leer', methods=['POST'])
@cliente_required
def marcar_notificacion_leida(dest_id):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
          UPDATE notif_destinatario
             SET leida = TRUE,
                 fecha_lectura = COALESCE(fecha_lectura, NOW())
           WHERE id = %s AND cliente_idnoofit = %s AND id_manager = %s
          RETURNING id, fecha_lectura
        """, (dest_id, str(g.cliente_idnoofit), str(g.id_manager)))
        r = cur.fetchone()
    if not r:
        return jsonify({'ok': False, 'error': 'no_encontrado'}), 404
    return jsonify({'ok': True, 'fecha_lectura': r['fecha_lectura'].isoformat()})


@bp.route('/notificaciones/marcar-todas-leidas', methods=['POST'])
@cliente_required
def marcar_todas_notif_leidas():
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
          UPDATE notif_destinatario
             SET leida = TRUE, fecha_lectura = COALESCE(fecha_lectura, NOW())
           WHERE cliente_idnoofit = %s AND id_manager = %s AND leida = FALSE
        """, (str(g.cliente_idnoofit), str(g.id_manager)))
        n = cur.rowcount or 0
    return jsonify({'ok': True, 'marcadas': n})


@bp.route('/notas', methods=['GET'])
@cliente_required
def listar_notas_cliente():
    """Notas dirigidas al cliente con sus respuestas en hilo (parent_id)."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
          SELECT id, contenido, estado, created_at, created_by_label, created_by_email,
                 leida_at_cliente, asignada_a_label
            FROM cliente_nota
           WHERE cliente_idnoofit = %s AND id_manager = %s
             AND parent_id IS NULL
             AND COALESCE(visible_cliente, TRUE) = TRUE
             AND estado != 'archivada'
           ORDER BY created_at DESC LIMIT 100
        """, (str(g.cliente_idnoofit), str(g.id_manager)))
        raices = cur.fetchall()

        respuestas_por_padre = {}
        if raices:
            ids = [r['id'] for r in raices]
            cur.execute("""
              SELECT id, parent_id, contenido, created_at, created_by_label,
                     created_by_kind, created_by_email
                FROM cliente_nota
               WHERE parent_id = ANY(%s) AND cliente_idnoofit = %s AND id_manager = %s
               ORDER BY parent_id, created_at ASC
            """, (ids, str(g.cliente_idnoofit), str(g.id_manager)))
            for r in cur.fetchall():
                respuestas_por_padre.setdefault(r['parent_id'], []).append({
                    'id': r['id'],
                    'contenido': r['contenido'],
                    'created_at': r['created_at'].isoformat() if r['created_at'] else None,
                    'autor_label': r['created_by_label'] or r['created_by_email'] or 'Manager',
                    'autor_kind': r['created_by_kind'] or 'manager',
                })

        cur.execute("""
          SELECT COUNT(*) AS n FROM cliente_nota
           WHERE cliente_idnoofit = %s AND id_manager = %s
             AND parent_id IS NULL AND leida_at_cliente IS NULL
             AND COALESCE(visible_cliente, TRUE) = TRUE
             AND estado != 'archivada'
        """, (str(g.cliente_idnoofit), str(g.id_manager)))
        no_leidas = cur.fetchone()['n']

    return jsonify({
        'ok': True,
        'no_leidas': no_leidas,
        'notas': [{
            'id': r['id'],
            'contenido': r['contenido'],
            'estado': r['estado'],
            'created_at': r['created_at'].isoformat() if r['created_at'] else None,
            'autor_label': r['created_by_label'] or r['created_by_email'] or 'Manager',
            'leida_at': r['leida_at_cliente'].isoformat() if r['leida_at_cliente'] else None,
            'respuestas': respuestas_por_padre.get(r['id'], []),
        } for r in raices],
    })


@bp.route('/notas/<int:nota_id>/leer', methods=['POST'])
@cliente_required
def marcar_nota_leida(nota_id):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
          UPDATE cliente_nota
             SET leida_at_cliente = COALESCE(leida_at_cliente, NOW()),
                 updated_at = NOW()
           WHERE id = %s AND cliente_idnoofit = %s AND id_manager = %s
             AND parent_id IS NULL
          RETURNING id, leida_at_cliente
        """, (nota_id, str(g.cliente_idnoofit), str(g.id_manager)))
        r = cur.fetchone()
    if not r:
        return jsonify({'ok': False, 'error': 'no_encontrada'}), 404
    return jsonify({'ok': True, 'leida_at': r['leida_at_cliente'].isoformat()})


@bp.route('/notas/<int:nota_id>/responder', methods=['POST'])
@cliente_required
def responder_nota(nota_id):
    d = request.get_json() or {}
    contenido = (d.get('contenido') or '').strip()
    if not contenido:
        return jsonify({'ok': False, 'error': 'contenido_vacio'}), 400
    if len(contenido) > 5000:
        return jsonify({'ok': False, 'error': 'contenido_demasiado_largo'}), 400
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
          SELECT id, cliente_nombre, id_trainer
            FROM cliente_nota
           WHERE id = %s AND cliente_idnoofit = %s AND id_manager = %s
             AND parent_id IS NULL
        """, (nota_id, str(g.cliente_idnoofit), str(g.id_manager)))
        padre = cur.fetchone()
        if not padre:
            return jsonify({'ok': False, 'error': 'no_encontrada'}), 404
        cur.execute("""
          INSERT INTO cliente_nota (
            id_manager, id_trainer, cliente_idnoofit, cliente_nombre,
            contenido, parent_id,
            created_by_kind, created_by_email, created_by_label,
            estado, visible_cliente
          ) VALUES (%s, %s, %s, %s, %s, %s, 'cliente', %s, %s, 'abierta', TRUE)
          RETURNING id, created_at
        """, (str(g.id_manager), padre['id_trainer'],
              str(g.cliente_idnoofit), padre['cliente_nombre'],
              contenido, nota_id,
              getattr(g, 'cliente_email', None),
              getattr(g, 'cliente_nombre', None) or 'Cliente'))
        nueva = cur.fetchone()
        cur.execute("""
          UPDATE cliente_nota
             SET estado = 'contestada',
                 leida_at_cliente = COALESCE(leida_at_cliente, NOW()),
                 updated_at = NOW()
           WHERE id = %s
        """, (nota_id,))
    return jsonify({
        'ok': True,
        'respuesta': {
            'id': nueva['id'],
            'contenido': contenido,
            'created_at': nueva['created_at'].isoformat(),
        },
    })


@bp.route('/buzon-resumen', methods=['GET'])
@cliente_required
def buzon_resumen():
    """Conteo rápido de no-leídas para el badge del sidebar."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
          SELECT COUNT(*) AS n FROM notif_destinatario d
            JOIN notif_envio e ON e.id = d.envio_id
           WHERE d.cliente_idnoofit = %s AND d.id_manager = %s
             AND d.leida = FALSE AND e.estado = 'enviada'
             AND (e.fecha_desaparicion IS NULL OR e.fecha_desaparicion > NOW())
        """, (str(g.cliente_idnoofit), str(g.id_manager)))
        n_notif = cur.fetchone()['n']
        cur.execute("""
          SELECT COUNT(*) AS n FROM cliente_nota
           WHERE cliente_idnoofit = %s AND id_manager = %s
             AND parent_id IS NULL AND leida_at_cliente IS NULL
             AND COALESCE(visible_cliente, TRUE) = TRUE
             AND estado != 'archivada'
        """, (str(g.cliente_idnoofit), str(g.id_manager)))
        n_notas = cur.fetchone()['n']
    return jsonify({
        'ok': True,
        'notificaciones_no_leidas': n_notif,
        'notas_no_leidas': n_notas,
        'total_no_leidas': n_notif + n_notas,
    })
