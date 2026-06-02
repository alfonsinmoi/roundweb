"""Helpers de autenticación para usuarios web Round.

Distintos del manager NoofitPro:
- Hash con bcrypt (cost 12)
- JWT firmado con JWT_SECRET (.env), validez 12h
- Tokens random hex para verificación email + reset password

Decorador `@usuario_web_required` que carga g.usuario_web (dict) con perfil.
"""
import os
import secrets
import logging
import datetime as dt
from functools import wraps

import bcrypt
import jwt
from flask import request, jsonify, g

from .db import get_conn

log = logging.getLogger(__name__)

JWT_SECRET = os.getenv('JWT_SECRET', '')
JWT_ALGO = 'HS256'
# TTL del JWT: 7 días (168h). Cada llamada autenticada lo renueva si quedan
# menos de JWT_REFRESH_WHEN_LESS_THAN_HOURS — ver `usuario_web_required` +
# `after_request` en app/__init__.py. Así un usuario activo mantiene sesión
# indefinidamente, y uno inactivo pasa por /login a la semana.
JWT_TTL_HOURS = 168
JWT_REFRESH_WHEN_LESS_THAN_HOURS = 24

PASSWORD_TTL_DAYS = 30
VERIF_TTL_HOURS = 24
# Junio 2026 — antes 60 min: el reset lo inicia el manager (o el flujo
# must_change_password) y el usuario suele abrir el email más tarde → caducaba
# y daba "enlace expirado". 24h es ventana segura (token de un solo uso).
RESET_TTL_MINUTES = 60 * 24
LOCK_AFTER_FAILS = 5
LOCK_DURATION_MINUTES = 15


# ─── Hash / verify ─────────────────────────────────────────────────────────────
def hash_password(plain: str) -> str:
    if not plain or len(plain) < 8:
        raise ValueError('password_too_short')
    return bcrypt.hashpw(plain.encode('utf-8'), bcrypt.gensalt(rounds=12)).decode('ascii')


def verify_password(plain: str, hashed: str) -> bool:
    if not plain or not hashed:
        return False
    try:
        return bcrypt.checkpw(plain.encode('utf-8'), hashed.encode('ascii'))
    except Exception:
        return False


# ─── Tokens random ─────────────────────────────────────────────────────────────
def random_token(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes).rstrip('=').replace('-', '').replace('_', '')[:64]


# ─── JWT ───────────────────────────────────────────────────────────────────────
def issue_jwt(usuario_id: int, id_manager: str, id_trainer: str | None,
              perfil_id: int | None, kind: str = 'usuario_web') -> str:
    if not JWT_SECRET:
        raise RuntimeError('JWT_SECRET no configurado')
    payload = {
        'sub': str(usuario_id),
        'kind': kind,
        'mgr': str(id_manager),
        'trn': str(id_trainer) if id_trainer else None,
        'pf': perfil_id,
        'iat': dt.datetime.utcnow(),
        'exp': dt.datetime.utcnow() + dt.timedelta(hours=JWT_TTL_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


def decode_jwt(token: str) -> dict | None:
    if not JWT_SECRET or not token:
        return None
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except jwt.PyJWTError:
        return None


# ─── Audit log ─────────────────────────────────────────────────────────────────
def audit(usuario_id: int | None, email: str | None, evento: str,
          detalle: str | None = None) -> None:
    """Inserta una entrada en usuario_web_audit. No falla nunca silenciosamente."""
    try:
        ip = (request.headers.get('X-Forwarded-For', '') or
              request.headers.get('X-Real-IP', '') or
              request.remote_addr or '')[:64] if request else ''
        ua = (request.headers.get('User-Agent', '') if request else '')[:255]
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                INSERT INTO usuario_web_audit (usuario_id, email, evento, ip, user_agent, detalle)
                VALUES (%s, %s, %s, %s, %s, %s)
            """, (usuario_id, email, evento, ip or None, ua or None, detalle))
    except Exception as e:
        log.warning(f'audit fallo silencioso evento={evento}: {e}')


# ─── Decorador de protección ───────────────────────────────────────────────────
def usuario_web_required(fn):
    """Valida JWT del header Authorization: Bearer <token>.

    Carga g.usuario_web con la fila de la BD + perfil resuelto.
    """
    @wraps(fn)
    def wrapper(*args, **kwargs):
        auth = request.headers.get('Authorization', '')
        if not auth.startswith('Bearer '):
            return jsonify({'ok': False, 'error': 'missing_token'}), 401
        token = auth[len('Bearer '):].strip()
        claims = decode_jwt(token)
        if not claims or claims.get('kind') != 'usuario_web':
            return jsonify({'ok': False, 'error': 'invalid_token'}), 401
        usuario_id = int(claims['sub'])

        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT u.id, u.id_manager, u.id_trainer, u.perfil_id, u.email,
                       u.nombre, u.apellidos, u.email_verificado,
                       u.must_change_password, u.last_password_change,
                       u.activo, u.locked_until,
                       p.nombre AS perfil_nombre, p.permisos, p.is_admin AS perfil_is_admin
                  FROM usuario_web u
                  LEFT JOIN perfil p ON p.id = u.perfil_id
                 WHERE u.id = %s
            """, (usuario_id,))
            row = cur.fetchone()
        if not row:
            return jsonify({'ok': False, 'error': 'user_not_found'}), 401
        if not row['activo']:
            return jsonify({'ok': False, 'error': 'user_disabled'}), 403
        # No bloqueamos por must_change_password ni email_verificado aquí;
        # sólo el endpoint /login obliga; el resto de endpoints siguen funcionando
        # para que el usuario pueda al menos acceder al cambio de password.

        g.usuario_web = row
        g.id_manager = row['id_manager']
        # Trainer activo en esta sesión: el que el usuario eligió al login
        # (claim `trn` del JWT) — no el default de la fila DB. Cuando el
        # usuario tiene acceso a varios centros, cada login emite JWT con
        # `trn` distinto y g.id_trainer debe reflejar esa elección.
        g.id_trainer = claims.get('trn') or row['id_trainer']

        # Refresco silencioso: si al JWT le quedan menos de
        # JWT_REFRESH_WHEN_LESS_THAN_HOURS, emitimos uno nuevo para esta
        # respuesta. El `after_request` en app/__init__.py lo añadirá como
        # cabecera `X-New-Token`; el frontend lo guarda y sigue.
        try:
            exp_ts = claims.get('exp')
            if exp_ts:
                remaining_h = (exp_ts - dt.datetime.utcnow().timestamp()) / 3600.0
                if remaining_h < JWT_REFRESH_WHEN_LESS_THAN_HOURS:
                    # Conservar el trainer elegido al refrescar (no resetear
                    # al default de la fila) — si no, el usuario perdería la
                    # selección de centro a las pocas horas.
                    g._refresh_jwt = issue_jwt(
                        row['id'], row['id_manager'], g.id_trainer,
                        row['perfil_id'], kind='usuario_web')
        except Exception:
            pass

        return fn(*args, **kwargs)
    return wrapper


def perfil_admin_required(fn):
    """Combina usuario_web_required + comprueba perfil.is_admin."""
    @wraps(fn)
    @usuario_web_required
    def wrapper(*args, **kwargs):
        if not g.usuario_web.get('perfil_is_admin'):
            return jsonify({'ok': False, 'error': 'admin_required'}), 403
        return fn(*args, **kwargs)
    return wrapper


# ─── Reglas de negocio ─────────────────────────────────────────────────────────
def password_expired(last_change: dt.datetime | None) -> bool:
    if last_change is None:
        return True
    if last_change.tzinfo is None:
        last_change = last_change.replace(tzinfo=dt.timezone.utc)
    age = dt.datetime.now(dt.timezone.utc) - last_change
    return age.days >= PASSWORD_TTL_DAYS
