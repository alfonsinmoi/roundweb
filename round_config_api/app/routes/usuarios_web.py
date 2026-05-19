"""CRUD usuarios web. Gestionados por el manager (auth_required clásico).

Crear usuario:
  - genera password temporal aleatoria
  - genera verif_token (24h)
  - manda email "bienvenido + verifica + crea contraseña"
  - must_change_password=true (forzará cambio en primer login)

Reset password forzado por manager:
  - resetea token (60min) y manda email
"""
import datetime as dt
import json
import logging
import secrets
from flask import Blueprint, request, jsonify, g

from ..auth import auth_required
from ..db import get_conn
from ..auth_usuario import (
    hash_password, random_token, audit,
    VERIF_TTL_HOURS, RESET_TTL_MINUTES,
)
from ..email_sender import enviar
from ..audit_log import log_action, actor_from_request, diff_dict

bp = Blueprint('usuarios_web', __name__)
log = logging.getLogger(__name__)

WEB_URL = 'https://round.wiemspro.com'


def _send_welcome(usuario):
    link = f"{WEB_URL}/verificar?token={usuario['verif_token']}"
    subject = f'Bienvenido a Round — verifica tu email'
    nombre = usuario.get('nombre') or ''
    body_text = (
        f"Hola {nombre},\n\n"
        f"Tu manager te ha dado acceso a la plataforma Round.\n\n"
        f"Para entrar necesitas verificar tu email y elegir una contraseña personal.\n\n"
        f"Pulsa este enlace (válido {VERIF_TTL_HOURS} horas):\n{link}\n\n"
        f"Una vez verificado, podrás entrar en https://round.wiemspro.com con tu email y "
        f"la contraseña que elijas.\n\n— Round Training Center"
    )
    body_html = f"""<p>Hola <b>{nombre}</b>,</p>
<p>Tu manager te ha dado acceso a la plataforma Round.</p>
<p>Para entrar necesitas verificar tu email y elegir una contraseña personal.</p>
<p><a href="{link}" style="display:inline-block;padding:12px 24px;background:#2DD4A8;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Verificar email y crear contraseña</a></p>
<p style="font-size:12px;color:#888">Enlace válido durante {VERIF_TTL_HOURS} horas.</p>
<p>Una vez verificado, entrarás en <a href="{WEB_URL}">round.wiemspro.com</a> con
tu email y la contraseña que elijas.</p>
<p style="font-size:11px;color:#aaa;margin-top:24px">— Round Training Center</p>"""
    try:
        enviar(usuario['email'], subject, body_text, body_html=body_html,
               id_manager=usuario['id_manager'], id_trainer=usuario.get('id_trainer'))
        return True
    except Exception as e:
        log.warning(f'send welcome fail: {e}')
        return False


def _send_reset_by_manager(usuario):
    link = f"{WEB_URL}/reset?token={usuario['reset_token']}"
    subject = 'Tu contraseña Round se ha restablecido'
    body_text = (
        f"Hola {usuario.get('nombre') or ''},\n\n"
        f"El manager ha restablecido tu contraseña. Pulsa el enlace para crear una nueva:\n"
        f"{link}\n\n(Válido {RESET_TTL_MINUTES} min)\n\n— Round Training Center"
    )
    body_html = f"""<p>Hola <b>{usuario.get('nombre') or ''}</b>,</p>
<p>El manager ha restablecido tu contraseña. Pulsa el enlace para crear una nueva:</p>
<p><a href="{link}" style="display:inline-block;padding:10px 20px;background:#2DD4A8;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Crear nueva contraseña</a></p>
<p style="font-size:12px;color:#888">Enlace válido durante {RESET_TTL_MINUTES} minutos.</p>
<p style="font-size:11px;color:#aaa;margin-top:24px">— Round Training Center</p>"""
    try:
        enviar(usuario['email'], subject, body_text, body_html=body_html,
               id_manager=usuario['id_manager'], id_trainer=usuario.get('id_trainer'))
        return True
    except Exception as e:
        log.warning(f'send reset fail: {e}')
        return False


# ─── ENDPOINTS ─────────────────────────────────────────────────────────────────

@bp.route('', methods=['GET'])
@bp.route('/', methods=['GET'])
@auth_required
def list_usuarios():
    """Lista usuarios web del manager. Trainer filtra por su id_trainer si se
    pasa ?trainer=<id>."""
    trainer_filter = request.args.get('trainer')
    where = ['u.id_manager = %s']; vals = [str(g.id_manager)]
    if trainer_filter:
        where.append('u.id_trainer = %s'); vals.append(trainer_filter)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"""
            SELECT u.id, u.id_trainer, u.email, u.nombre, u.apellidos, u.telefono,
                   u.email_verificado, u.must_change_password, u.last_password_change,
                   u.last_login_at, u.activo, u.locked_until,
                   p.id AS perfil_id, p.nombre AS perfil_nombre, p.is_admin AS perfil_admin
              FROM usuario_web u
              LEFT JOIN perfil p ON p.id = u.perfil_id
             WHERE {' AND '.join(where)}
             ORDER BY u.activo DESC, u.email ASC
        """, vals)
        rows = cur.fetchall()
    return jsonify({'ok': True, 'usuarios': rows})


@bp.route('', methods=['POST'])
@bp.route('/', methods=['POST'])
@auth_required
def create_usuario():
    d = request.get_json() or {}
    email = (d.get('email') or '').strip().lower()
    nombre = (d.get('nombre') or '').strip()
    apellidos = (d.get('apellidos') or '').strip()
    telefono = (d.get('telefono') or '').strip()
    perfil_id = d.get('perfil_id')
    id_trainer = (d.get('id_trainer') or '').strip() or None

    if not email or '@' not in email:
        return jsonify({'ok': False, 'error': 'email_invalid'}), 400
    if not nombre:
        return jsonify({'ok': False, 'error': 'nombre_required'}), 400
    if not telefono:
        return jsonify({'ok': False, 'error': 'telefono_required'}), 400
    if not perfil_id:
        return jsonify({'ok': False, 'error': 'perfil_required'}), 400

    # Validar perfil pertenece al manager
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT id FROM perfil WHERE id_manager=%s AND id=%s",
                    (str(g.id_manager), perfil_id))
        if not cur.fetchone():
            return jsonify({'ok': False, 'error': 'perfil_not_found'}), 400

    # Password temporal random — el usuario nunca la verá; el flujo es:
    #   1. login ya existe (tiene must_change_password=true)
    #   2. al ser primer login, manda email reset y bloquea
    #   3. usuario crea su password vía link
    temp_password = secrets.token_urlsafe(16)
    pwd_hash = hash_password(temp_password)
    verif_token = random_token()
    verif_exp = dt.datetime.utcnow() + dt.timedelta(hours=VERIF_TTL_HOURS)

    with get_conn() as conn, conn.cursor() as cur:
        try:
            cur.execute("""
                INSERT INTO usuario_web
                  (id_manager, id_trainer, perfil_id, email, nombre, apellidos,
                   telefono, password_hash, email_verificado, must_change_password,
                   verif_token, verif_exp, activo)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s, FALSE, TRUE, %s,%s, TRUE)
                RETURNING id, id_manager, id_trainer, email, nombre, verif_token
            """, (str(g.id_manager), id_trainer, perfil_id, email,
                  nombre, apellidos, telefono, pwd_hash, verif_token, verif_exp))
            row = cur.fetchone()
        except Exception as e:
            err = str(e).lower()
            if 'unique' in err or 'duplicate' in err:
                return jsonify({'ok': False, 'error': 'email_already_exists'}), 409
            log.exception('create_usuario')
            return jsonify({'ok': False, 'error': 'db_error', 'detail': str(e)}), 500

    _send_welcome(row)
    audit(row['id'], email, 'usuario_creado', f'by_manager={g.id_manager}')
    log_action(actor_from_request(), entidad='usuario_web', entidad_id=row['id'],
               accion='create', resumen=f"Usuario creado: {email}",
               cambios={'after': {'email': email, 'nombre': nombre, 'perfil_id': perfil_id}})
    return jsonify({'ok': True, 'usuario': {
        'id': row['id'], 'email': row['email'], 'nombre': row['nombre'],
    }})


@bp.route('/<int:uid>', methods=['PATCH', 'PUT'])
@auth_required
def update_usuario(uid):
    d = request.get_json() or {}
    sets, vals = [], []
    for f in ('nombre', 'apellidos', 'telefono', 'id_trainer', 'perfil_id', 'activo'):
        if f in d:
            sets.append(f"{f} = %s"); vals.append(d[f])
    if not sets:
        return jsonify({'ok': False, 'error': 'no_fields'}), 400
    vals.extend([str(g.id_manager), uid])
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"""
            UPDATE usuario_web SET {', '.join(sets)}
             WHERE id_manager=%s AND id=%s
            RETURNING id, email, nombre, apellidos, telefono, id_trainer, perfil_id, activo
        """, vals)
        row = cur.fetchone()
    if not row:
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    audit(uid, row['email'], 'usuario_update_by_manager', json.dumps(d, default=str))
    log_action(actor_from_request(), entidad='usuario_web', entidad_id=uid,
               accion='update', resumen=f"Usuario actualizado: {row['email']}",
               cambios={'after': d})
    return jsonify({'ok': True, 'usuario': row})


@bp.route('/<int:uid>/reset-password', methods=['POST'])
@auth_required
def reset_password(uid):
    """Manager fuerza un reset. Genera nuevo token y manda email."""
    token = random_token()
    exp = dt.datetime.utcnow() + dt.timedelta(minutes=RESET_TTL_MINUTES)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE usuario_web
               SET reset_token=%s, reset_exp=%s,
                   must_change_password=TRUE,
                   failed_login_count=0, locked_until=NULL
             WHERE id_manager=%s AND id=%s
            RETURNING id, id_manager, id_trainer, email, nombre, reset_token
        """, (token, exp, str(g.id_manager), uid))
        row = cur.fetchone()
    if not row:
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    _send_reset_by_manager(row)
    audit(uid, row['email'], 'pwd_reset_by_manager', f'by={g.id_manager}')
    log_action(actor_from_request(), entidad='usuario_web', entidad_id=uid,
               accion='reset_password', resumen=f"Reset password forzado: {row['email']}")
    return jsonify({'ok': True})


@bp.route('/<int:uid>/resend-verification', methods=['POST'])
@auth_required
def resend_verification(uid):
    """Reenvía email de verificación si el usuario no completó el alta."""
    token = random_token()
    exp = dt.datetime.utcnow() + dt.timedelta(hours=VERIF_TTL_HOURS)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE usuario_web
               SET verif_token=%s, verif_exp=%s
             WHERE id_manager=%s AND id=%s AND email_verificado=FALSE
            RETURNING id, id_manager, id_trainer, email, nombre, verif_token
        """, (token, exp, str(g.id_manager), uid))
        row = cur.fetchone()
    if not row:
        return jsonify({'ok': False, 'error': 'not_found_or_already_verified'}), 404
    _send_welcome(row)
    audit(uid, row['email'], 'verification_resent', f'by={g.id_manager}')
    return jsonify({'ok': True})


@bp.route('/<int:uid>', methods=['DELETE'])
@auth_required
def delete_usuario(uid):
    """Soft delete: marca activo=false. Hard delete con ?hard=1."""
    hard = request.args.get('hard') == '1'
    with get_conn() as conn, conn.cursor() as cur:
        if hard:
            cur.execute("""
                DELETE FROM usuario_web WHERE id_manager=%s AND id=%s
                RETURNING email
            """, (str(g.id_manager), uid))
        else:
            cur.execute("""
                UPDATE usuario_web SET activo=FALSE
                 WHERE id_manager=%s AND id=%s
                RETURNING email
            """, (str(g.id_manager), uid))
        row = cur.fetchone()
    if not row:
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    audit(uid, row['email'], 'usuario_delete_by_manager', f'mode={"hard" if hard else "soft"}')
    log_action(actor_from_request(), entidad='usuario_web', entidad_id=uid,
               accion='delete' if hard else 'deactivate',
               resumen=f"Usuario {'borrado' if hard else 'desactivado'}: {row['email']}")
    return jsonify({'ok': True, 'mode': 'hard' if hard else 'soft'})
