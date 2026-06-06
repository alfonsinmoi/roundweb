"""CRUD de credenciales NoofitPro por trainer.

GET    /api/config/trainer-creds            — lista de trainers + (estado de creds)
PUT    /api/config/trainer-creds/<id_trainer>  — guardar/actualizar
DELETE /api/config/trainer-creds/<id_trainer>  — borrar
POST   /api/config/trainer-creds/<id_trainer>/test  — probar login NoofitPro

La password se devuelve enmascarada por seguridad. Solo se actualiza si se
envía explícitamente.
"""
import hashlib
import logging
import requests
import urllib3
from flask import Blueprint, request, jsonify, g

from ..auth import auth_required, require_permission
from ..db import get_conn
from ..audit_log import log_action, actor_from_request

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

bp = Blueprint('trainer_creds', __name__)
log = logging.getLogger(__name__)

NOOFIT_BASE = 'https://pro.wiemspro.com/wiemspro'


def _mask(s):
    if not s: return ''
    if len(s) <= 4: return '****'
    return '*' * (len(s) - 4) + s[-4:]


@bp.route('', methods=['GET'])
@bp.route('/', methods=['GET'])
@auth_required
def list_creds():
    """Lista las credenciales del manager. Password siempre enmascarada."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT id_trainer, noofit_email, noofit_password, activo,
                   created_at, updated_at, notas
              FROM trainer_noofit_creds
             WHERE id_manager = %s
             ORDER BY id_trainer
        """, (str(g.id_manager),))
        rows = cur.fetchall()
    # Enmascarar password
    for r in rows:
        r['password_masked'] = _mask(r.pop('noofit_password', ''))
        r['has_password'] = bool(r['password_masked'])
    return jsonify({'ok': True, 'creds': rows})


@bp.route('/<id_trainer>', methods=['PUT'])
@auth_required
@require_permission('configuracion.trainer_creds.editar')
def upsert_creds(id_trainer):
    """Guarda/actualiza credenciales. Password vacía → no se sobrescribe."""
    d = request.get_json() or {}
    email = (d.get('noofit_email') or '').strip()
    password = d.get('noofit_password') or ''
    activo = bool(d.get('activo', True))
    notas = d.get('notas')
    if not email or '@' not in email:
        return jsonify({'ok': False, 'error': 'email_invalid'}), 400

    with get_conn() as conn, conn.cursor() as cur:
        # Si NO viene password, mantener la que ya hay
        if password:
            cur.execute("""
                INSERT INTO trainer_noofit_creds
                  (id_manager, id_trainer, noofit_email, noofit_password, activo, notas)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (id_manager, id_trainer) DO UPDATE
                  SET noofit_email = EXCLUDED.noofit_email,
                      noofit_password = EXCLUDED.noofit_password,
                      activo = EXCLUDED.activo,
                      notas = EXCLUDED.notas,
                      updated_at = CURRENT_TIMESTAMP
                RETURNING id_trainer, noofit_email, activo
            """, (str(g.id_manager), str(id_trainer), email, password, activo, notas))
        else:
            cur.execute("""
                UPDATE trainer_noofit_creds
                   SET noofit_email = %s, activo = %s, notas = %s,
                       updated_at = CURRENT_TIMESTAMP
                 WHERE id_manager = %s AND id_trainer = %s
                RETURNING id_trainer, noofit_email, activo
            """, (email, activo, notas, str(g.id_manager), str(id_trainer)))
        row = cur.fetchone()
    if not row:
        return jsonify({'ok': False, 'error': 'no_password_provided_for_new_record'}), 400

    log_action(actor_from_request(), entidad='trainer_creds',
               entidad_id=id_trainer, accion='update' if not password else 'set_password',
               resumen=f"Credenciales NoofitPro guardadas para trainer {id_trainer} ({email})")
    return jsonify({'ok': True, 'cred': row})


@bp.route('/<id_trainer>', methods=['DELETE'])
@auth_required
@require_permission('configuracion.trainer_creds.editar')
def delete_creds(id_trainer):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            DELETE FROM trainer_noofit_creds
             WHERE id_manager = %s AND id_trainer = %s
            RETURNING id_trainer
        """, (str(g.id_manager), str(id_trainer)))
        row = cur.fetchone()
    if not row:
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    log_action(actor_from_request(), entidad='trainer_creds',
               entidad_id=id_trainer, accion='delete',
               resumen=f"Credenciales NoofitPro borradas para trainer {id_trainer}")
    return jsonify({'ok': True})


@bp.route('/<id_trainer>/test', methods=['POST'])
@auth_required
@require_permission('configuracion.trainer_creds.editar')
def test_creds(id_trainer):
    """Prueba el login NoofitPro con las credenciales guardadas."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT noofit_email, noofit_password
              FROM trainer_noofit_creds
             WHERE id_manager = %s AND id_trainer = %s
        """, (str(g.id_manager), str(id_trainer)))
        row = cur.fetchone()
    if not row:
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    body = {'email': row['noofit_email'], 'appVersion': '1.8.39',
            'password': hashlib.md5(row['noofit_password'].encode()).hexdigest().upper()}
    try:
        r = requests.post(f'{NOOFIT_BASE}/account/loginEasy',
                          json=body, headers={'Content-Type': 'application/json'},
                          verify=False, timeout=15)
        ok = r.status_code == 200
        return jsonify({
            'ok': ok,
            'status': r.status_code,
            'manager_header': r.headers.get('X-TRAINER_MANAGER', '') if ok else None,
            'token_received': bool(r.headers.get('X-CustomToken')) if ok else False,
            'message': 'Login NoofitPro OK' if ok else f'Login falló: {r.text[:200]}',
        })
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500
