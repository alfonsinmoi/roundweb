"""Endpoints de autenticación de usuarios web.

POST /login              — email + password → JWT
POST /verify-email       — token → email_verificado=true
POST /request-reset      — email → manda link cambio contraseña
POST /change-password    — token + new_password (cambio por reset)
POST /change-password-self — old + new (cambio voluntario, ya logueado)
GET  /me                 — datos del usuario logueado + perfil

Las rutas no exigen el `X-Round-Token` clásico (api_token compartido). Su
autorización viene del propio JWT (excepto login/verify/reset que son
públicas para el flujo de password).
"""
import datetime as dt
import hashlib
import logging
import requests
import urllib3
from flask import Blueprint, request, jsonify, g, current_app

from ..db import get_conn
from ..email_sender import enviar
from ..auth_usuario import (
    hash_password, verify_password, random_token, issue_jwt,
    audit, usuario_web_required, password_expired,
    PASSWORD_TTL_DAYS, VERIF_TTL_HOURS, RESET_TTL_MINUTES,
    LOCK_AFTER_FAILS, LOCK_DURATION_MINUTES,
)
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
NOOFIT_BASE = 'https://pro.wiemspro.com/wiemspro'
NOOFIT_APP_VERSION = '1.8.39'


def _noofit_login_with_manager_creds(id_manager: str):
    """Hace loginEasy en NoofitPro con las credenciales del manager guardadas
    en manager_config. Devuelve (token, manager_id) o (None, None) si falla."""
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT noofit_email, noofit_password
                  FROM manager_config WHERE id_manager = %s AND activo = TRUE
                LIMIT 1
            """, (str(id_manager),))
            row = cur.fetchone()
        if not row:
            # Fallback: cualquier manager activo (caso multi-id)
            with get_conn() as conn, conn.cursor() as cur:
                cur.execute("""
                    SELECT noofit_email, noofit_password
                      FROM manager_config WHERE activo = TRUE LIMIT 1
                """)
                row = cur.fetchone()
        if not row or not row['noofit_email'] or not row['noofit_password']:
            return None, None
        body = {
            'email': row['noofit_email'],
            'appVersion': NOOFIT_APP_VERSION,
            'password': hashlib.md5(row['noofit_password'].encode()).hexdigest().upper(),
        }
        r = requests.post(f'{NOOFIT_BASE}/account/loginEasy',
                          json=body, headers={'Content-Type': 'application/json'},
                          verify=False, timeout=20)
        if r.status_code != 200:
            return None, None
        return r.headers.get('X-CustomToken'), r.headers.get('X-TRAINER_MANAGER', '')
    except Exception as e:
        logging.getLogger(__name__).warning(f'noofit_login error: {e}')
        return None, None

bp = Blueprint('auth_usuario', __name__)
log = logging.getLogger(__name__)

WEB_URL = 'https://noofit.wiemspro.com'  # FIXME: leer de config


# ─── Helpers email ─────────────────────────────────────────────────────────────
def _send_verify_email(usuario):
    link = f"{WEB_URL}/verificar?token={usuario['verif_token']}"
    subject = 'Verifica tu email para acceder a Round'
    body_text = (
        f"Hola {usuario.get('nombre') or ''},\n\n"
        f"Para acceder a la plataforma Round necesitas verificar tu email y\n"
        f"establecer una contraseña personal.\n\n"
        f"Pulsa este enlace (válido {VERIF_TTL_HOURS} horas):\n{link}\n\n"
        f"Si no esperabas este email, ignóralo.\n\n"
        f"— Round Training Center"
    )
    body_html = f"""<p>Hola <b>{usuario.get('nombre') or ''}</b>,</p>
<p>Para acceder a la plataforma Round necesitas verificar tu email y establecer
una contraseña personal.</p>
<p><a href="{link}" style="display:inline-block;padding:10px 20px;background:#2DD4A8;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Verificar email y crear contraseña</a></p>
<p style="font-size:12px;color:#888">Enlace válido durante {VERIF_TTL_HOURS} horas.<br/>
Si no esperabas este email, ignóralo.</p>
<p style="font-size:11px;color:#aaa;margin-top:24px">— Round Training Center</p>"""
    try:
        enviar(usuario['email'], subject, body_text, body_html=body_html,
               id_manager=usuario['id_manager'], id_trainer=usuario.get('id_trainer'))
        return True
    except Exception as e:
        log.warning(f'send verify email fail: {e}')
        return False


def _send_reset_email(usuario, motivo='reset'):
    link = f"{WEB_URL}/reset?token={usuario['reset_token']}"
    if motivo == 'expirado':
        subject = 'Tu contraseña Round ha expirado — cámbiala para entrar'
        intro = 'Han pasado más de 30 días desde el último cambio. Por seguridad debes establecer una nueva contraseña antes de continuar.'
    else:
        subject = 'Restablecer contraseña Round'
        intro = 'Has solicitado restablecer tu contraseña. Pulsa el enlace para crear una nueva.'
    body_text = (
        f"Hola {usuario.get('nombre') or ''},\n\n{intro}\n\n"
        f"Enlace (válido {RESET_TTL_MINUTES} minutos):\n{link}\n\n"
        f"Si no fuiste tú, ignora este mensaje.\n\n— Round Training Center"
    )
    body_html = f"""<p>Hola <b>{usuario.get('nombre') or ''}</b>,</p>
<p>{intro}</p>
<p><a href="{link}" style="display:inline-block;padding:10px 20px;background:#2DD4A8;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Crear nueva contraseña</a></p>
<p style="font-size:12px;color:#888">Enlace válido durante {RESET_TTL_MINUTES} minutos.<br/>
Si no fuiste tú, ignora este mensaje.</p>
<p style="font-size:11px;color:#aaa;margin-top:24px">— Round Training Center</p>"""
    try:
        enviar(usuario['email'], subject, body_text, body_html=body_html,
               id_manager=usuario['id_manager'], id_trainer=usuario.get('id_trainer'))
        return True
    except Exception as e:
        log.warning(f'send reset email fail: {e}')
        return False


# ─── Endpoints públicos ────────────────────────────────────────────────────────
@bp.route('/login', methods=['POST'])
def login():
    """Login con email + password.

    Errores genéricos (no revela si email existe). Cuenta intentos fallidos.
    Si la contraseña ha expirado (>30d) o es la primera vez, no devuelve token
    sino que manda email de reset y devuelve `must_change_password=true`.
    """
    d = request.get_json() or {}
    email = (d.get('email') or '').strip().lower()
    password = d.get('password') or ''
    if not email or not password:
        return jsonify({'ok': False, 'error': 'missing_fields'}), 400

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT id, id_manager, id_trainer, perfil_id, email, nombre, apellidos,
                   password_hash, email_verificado, must_change_password,
                   last_password_change, failed_login_count, locked_until,
                   activo
              FROM usuario_web
             WHERE LOWER(email) = %s
        """, (email,))
        u = cur.fetchone()

    # Mensajes deliberadamente genéricos
    if not u:
        audit(None, email, 'login_fail', 'usuario_inexistente')
        return jsonify({'ok': False, 'error': 'invalid_credentials'}), 401
    if not u['activo']:
        audit(u['id'], email, 'login_fail', 'usuario_desactivado')
        return jsonify({'ok': False, 'error': 'invalid_credentials'}), 401

    # Comprobar bloqueo
    now = dt.datetime.now(dt.timezone.utc)
    if u['locked_until'] and (u['locked_until'].replace(tzinfo=dt.timezone.utc) if u['locked_until'].tzinfo is None else u['locked_until']) > now:
        audit(u['id'], email, 'login_fail', 'locked')
        return jsonify({'ok': False, 'error': 'account_locked',
                        'unlock_at': u['locked_until'].isoformat()}), 423

    # Verificar password
    if not verify_password(password, u['password_hash'] or ''):
        new_count = (u['failed_login_count'] or 0) + 1
        lock_until = None
        if new_count >= LOCK_AFTER_FAILS:
            lock_until = now + dt.timedelta(minutes=LOCK_DURATION_MINUTES)
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                UPDATE usuario_web
                   SET failed_login_count = %s, locked_until = %s
                 WHERE id = %s
            """, (new_count, lock_until, u['id']))
        audit(u['id'], email, 'login_fail',
              f'pwd_invalida count={new_count}' + (' LOCKED' if lock_until else ''))
        return jsonify({'ok': False, 'error': 'invalid_credentials'}), 401

    # Password correcta — comprobar email verificado y caducidad
    expired = password_expired(u['last_password_change'])
    must_change = u['must_change_password'] or expired

    if must_change or not u['email_verificado']:
        # Generar token de reset y mandar email
        token = random_token()
        exp = now + dt.timedelta(minutes=RESET_TTL_MINUTES)
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                UPDATE usuario_web
                   SET reset_token = %s, reset_exp = %s,
                       failed_login_count = 0, locked_until = NULL,
                       must_change_password = TRUE
                 WHERE id = %s
                RETURNING email, id_manager, id_trainer, nombre, reset_token
            """, (token, exp, u['id']))
            usr_for_email = cur.fetchone()
        motivo = 'expirado' if expired else 'reset'
        if not u['email_verificado']:
            motivo = 'reset'  # primer login: misma plantilla
        _send_reset_email(usr_for_email, motivo=motivo)
        audit(u['id'], email, 'login_must_change', motivo)
        return jsonify({
            'ok': False,
            'must_change_password': True,
            'email_verificado': u['email_verificado'],
            'reason': 'expired' if expired else ('first_login' if not u['email_verificado'] else 'forced'),
            'message': 'Te hemos enviado un email para que actualices tu contraseña antes de continuar.',
        }), 200

    # ── Login válido ──
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE usuario_web
               SET failed_login_count = 0, locked_until = NULL,
                   last_login_at = NOW(),
                   last_login_ip = %s
             WHERE id = %s
        """, ((request.headers.get('X-Real-IP') or request.remote_addr or '')[:64], u['id']))

    token = issue_jwt(u['id'], u['id_manager'], u['id_trainer'], u['perfil_id'])
    audit(u['id'], email, 'login_ok')

    # Login automático en NoofitPro usando las credenciales del manager.
    # Esto permite al frontend usar el token NoofitPro para llamar a los
    # endpoints clásicos (clientes, clases, etc.) sin que el usuario_web
    # tenga que conocer credenciales NoofitPro.
    nf_token, nf_manager = _noofit_login_with_manager_creds(u['id_manager'])

    return jsonify({
        'ok': True,
        'token': token,
        'usuario': {
            'id': u['id'], 'email': u['email'],
            'nombre': u['nombre'], 'apellidos': u['apellidos'],
            'id_manager': u['id_manager'], 'id_trainer': u['id_trainer'],
            'perfil_id': u['perfil_id'],
        },
        'noofit': {
            'token': nf_token,        # X-CustomToken para api/dispositivos/*
            'manager': nf_manager,    # X-TRAINER_MANAGER
        } if nf_token else None,
    })


@bp.route('/verify-email', methods=['POST'])
def verify_email():
    """Token de verificación de email (24h TTL).
    Marca email_verificado=true y permite establecer la primera contraseña."""
    d = request.get_json() or {}
    token = (d.get('token') or '').strip()
    new_password = d.get('password') or ''
    if not token:
        return jsonify({'ok': False, 'error': 'missing_token'}), 400
    if len(new_password) < 8:
        return jsonify({'ok': False, 'error': 'password_too_short'}), 400

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT id, email, verif_exp, reset_exp
              FROM usuario_web
             WHERE verif_token = %s OR reset_token = %s
            LIMIT 1
        """, (token, token))
        u = cur.fetchone()
    if not u:
        return jsonify({'ok': False, 'error': 'invalid_token'}), 400
    # Comprobar expiración
    now = dt.datetime.now(dt.timezone.utc)
    exp = u['verif_exp'] or u['reset_exp']
    if exp:
        if exp.tzinfo is None: exp = exp.replace(tzinfo=dt.timezone.utc)
        if exp < now:
            return jsonify({'ok': False, 'error': 'token_expired'}), 400

    pwd_hash = hash_password(new_password)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE usuario_web
               SET email_verificado = TRUE,
                   verif_token = NULL, verif_exp = NULL,
                   reset_token = NULL, reset_exp = NULL,
                   password_hash = %s,
                   must_change_password = FALSE,
                   last_password_change = NOW(),
                   failed_login_count = 0, locked_until = NULL
             WHERE id = %s
        """, (pwd_hash, u['id']))
    audit(u['id'], u['email'], 'verify_email_ok')
    return jsonify({'ok': True})


@bp.route('/request-reset', methods=['POST'])
def request_reset():
    """Pide reset de contraseña por email. Siempre devuelve 200 (no revela
    si el email existe)."""
    d = request.get_json() or {}
    email = (d.get('email') or '').strip().lower()
    if not email:
        return jsonify({'ok': False, 'error': 'missing_email'}), 400

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT id, email, id_manager, id_trainer, nombre, activo
              FROM usuario_web
             WHERE LOWER(email) = %s
        """, (email,))
        u = cur.fetchone()

    if u and u['activo']:
        token = random_token()
        exp = dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=RESET_TTL_MINUTES)
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                UPDATE usuario_web SET reset_token=%s, reset_exp=%s WHERE id=%s
                RETURNING email, id_manager, id_trainer, nombre, reset_token
            """, (token, exp, u['id']))
            usr_for_email = cur.fetchone()
        _send_reset_email(usr_for_email, motivo='reset')
        audit(u['id'], email, 'reset_request_ok')

    # respuesta opaca
    return jsonify({'ok': True, 'message': 'Si el email existe, recibirás un enlace para restablecer.'})


@bp.route('/change-password', methods=['POST'])
def change_password_with_token():
    """Cambio de contraseña vía token de reset (60min TTL)."""
    d = request.get_json() or {}
    token = (d.get('token') or '').strip()
    new_password = d.get('password') or ''
    if not token:
        return jsonify({'ok': False, 'error': 'missing_token'}), 400
    if len(new_password) < 8:
        return jsonify({'ok': False, 'error': 'password_too_short'}), 400

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT id, email, reset_exp FROM usuario_web WHERE reset_token=%s
        """, (token,))
        u = cur.fetchone()
    if not u:
        return jsonify({'ok': False, 'error': 'invalid_token'}), 400
    now = dt.datetime.now(dt.timezone.utc)
    exp = u['reset_exp']
    if exp and exp.tzinfo is None: exp = exp.replace(tzinfo=dt.timezone.utc)
    if not exp or exp < now:
        return jsonify({'ok': False, 'error': 'token_expired'}), 400

    pwd_hash = hash_password(new_password)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE usuario_web
               SET password_hash = %s,
                   reset_token = NULL, reset_exp = NULL,
                   must_change_password = FALSE,
                   last_password_change = NOW(),
                   email_verificado = TRUE,
                   failed_login_count = 0, locked_until = NULL
             WHERE id = %s
        """, (pwd_hash, u['id']))
    audit(u['id'], u['email'], 'pwd_change_token_ok')
    return jsonify({'ok': True})


@bp.route('/change-password-self', methods=['POST'])
@usuario_web_required
def change_password_self():
    """Cambio voluntario estando ya logueado. Requiere password actual."""
    d = request.get_json() or {}
    old_password = d.get('old_password') or ''
    new_password = d.get('new_password') or ''
    if not old_password or len(new_password) < 8:
        return jsonify({'ok': False, 'error': 'invalid_input'}), 400

    u_id = g.usuario_web['id']
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT password_hash, email FROM usuario_web WHERE id=%s", (u_id,))
        row = cur.fetchone()
    if not row or not verify_password(old_password, row['password_hash'] or ''):
        audit(u_id, row['email'] if row else None, 'pwd_change_self_fail', 'old_pwd_wrong')
        return jsonify({'ok': False, 'error': 'old_password_invalid'}), 400

    pwd_hash = hash_password(new_password)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE usuario_web
               SET password_hash = %s,
                   must_change_password = FALSE,
                   last_password_change = NOW()
             WHERE id = %s
        """, (pwd_hash, u_id))
    audit(u_id, row['email'], 'pwd_change_self_ok')
    return jsonify({'ok': True})


@bp.route('/me', methods=['GET'])
@usuario_web_required
def me():
    """Devuelve datos del usuario + perfil para que el frontend gate menús."""
    u = g.usuario_web
    return jsonify({
        'ok': True,
        'usuario': {
            'id': u['id'], 'email': u['email'],
            'nombre': u['nombre'], 'apellidos': u['apellidos'],
            'id_manager': u['id_manager'], 'id_trainer': u['id_trainer'],
            'email_verificado': u['email_verificado'],
            'must_change_password': u['must_change_password'],
        },
        'perfil': None if not u.get('perfil_id') else {
            'id': u['perfil_id'],
            'nombre': u.get('perfil_nombre'),
            'is_admin': u.get('perfil_is_admin', False),
            'permisos': u.get('permisos') or {},
        },
    })
