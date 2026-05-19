"""Diagnóstico: comprueba qué clientes ve la sesión de login del manager_config."""
import sys, hashlib, requests, urllib3
sys.path.insert(0, '/opt/round_config_api')
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
from collections import Counter
from app.db import get_conn

with get_conn() as c, c.cursor() as cur:
    cur.execute("SELECT noofit_email, noofit_password FROM manager_config LIMIT 1")
    row = cur.fetchone()
print(f'Login con: {row["noofit_email"]}')
b = {'email': row['noofit_email'], 'appVersion': '1.8.39',
     'password': hashlib.md5(row['noofit_password'].encode()).hexdigest().upper()}
r = requests.post('https://pro.wiemspro.com/wiemspro/account/loginEasy',
                  json=b, verify=False)
tok = r.headers.get('X-CustomToken'); mgr = r.headers.get('X-TRAINER_MANAGER')
print(f'Status: {r.status_code} | X-TRAINER_MANAGER: {mgr}')

h = {'X-CustomToken': tok, 'X-TRAINER_MANAGER': mgr, 'locale': 'es',
     'appVersion': '1.8.39', 'appId': '1'}
r2 = requests.get('https://pro.wiemspro.com/wiemspro/api/dispositivos/getClienteSimple',
                  headers=h, verify=False)
d = r2.json()
cs = d.get('clientes', [])
print(f'Clientes devueltos: {len(cs)}')
print(f'idTrainer breakdown:', dict(Counter(str(c.get('idTrainer')) for c in cs)))

# También probar getTrainersByManager
r3 = requests.get('https://pro.wiemspro.com/wiemspro/api/dispositivos/getTrainersByManager',
                  headers=h, verify=False)
d3 = r3.json()
trs = d3.get('entrenadores') or d3.get('trainers') or []
print(f'\nTrainers visibles: {len(trs)}')
for t in trs[:10]:
    nombre = f"{t.get('nombre') or t.get('name','')} {t.get('apellidos') or t.get('surname','')}".strip()
    print(f'  id={t.get("id"):>10} {nombre[:30]:30s} email={t.get("email","")}')
