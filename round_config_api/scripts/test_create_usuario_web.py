"""Crea un usuario_web de prueba para validar el flujo de auth.

Uso (como user odoo, con .env cargado):
  sudo -u odoo bash -c 'set -a && . /opt/round_config_api/.env && set +a && \
    /opt/round_config_api/venv/bin/python3 /opt/round_config_api/scripts/test_create_usuario_web.py'
"""
import sys, os
sys.path.insert(0, '/opt/round_config_api')
from app.db import get_conn, seed_perfiles_for_manager
from app.auth_usuario import hash_password, random_token

EMAIL = 'test_auth@round.local'
ID_MANAGER = '17675'
ID_TRAINER = '17675'
PERFIL_NOMBRE = 'Trainer'
INITIAL_PWD = 'initialpwd123'

seed_perfiles_for_manager(ID_MANAGER)

with get_conn() as conn, conn.cursor() as cur:
    cur.execute("DELETE FROM usuario_web WHERE email=%s", (EMAIL,))
    cur.execute("SELECT id FROM perfil WHERE id_manager=%s AND nombre=%s",
                (ID_MANAGER, PERFIL_NOMBRE))
    perfil_id = cur.fetchone()['id']
    cur.execute("""
        INSERT INTO usuario_web
          (id_manager, id_trainer, perfil_id, email, nombre, apellidos,
           telefono, password_hash, must_change_password)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, TRUE)
        RETURNING id
    """, (ID_MANAGER, ID_TRAINER, perfil_id, EMAIL,
          'Test', 'User', '+34000000000',
          hash_password(INITIAL_PWD)))
    uid = cur.fetchone()['id']

print(f'Usuario creado id={uid} email={EMAIL} pwd={INITIAL_PWD}')
print('Para probar login: POST /api/auth/usuario-web/login {"email":"...", "password":"..."}')
print('  -- esperado: must_change_password=True, manda email reset a la cuenta.')
