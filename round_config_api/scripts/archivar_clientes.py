"""Archivar (enabled=False) clientes en NoofitPro.
Usa la sesión del manager guardada en manager_config.

Uso:
  IDS=1817687,1817688
  CONFIRM=1
  python3 archivar_clientes.py
"""
import os, sys, hashlib, json, requests, urllib3
sys.path.insert(0, '/opt/round_config_api')
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
from app.db import get_conn

IDS = [int(x) for x in os.getenv('IDS', '').replace(' ', '').split(',') if x]
CONFIRM = os.getenv('CONFIRM') == '1'
NF_DUMP = '/opt/round_config_api/noofit_clientes_dump.json'
BASE = 'https://pro.wiemspro.com/wiemspro'

if not IDS:
    sys.exit('Define IDS=1,2,3')

# Login manager
with get_conn() as c, c.cursor() as cur:
    cur.execute("SELECT noofit_email, noofit_password FROM manager_config WHERE activo=TRUE LIMIT 1")
    row = cur.fetchone()
b = {'email': row['noofit_email'], 'appVersion': '1.8.39',
     'password': hashlib.md5(row['noofit_password'].encode()).hexdigest().upper()}
r = requests.post(f'{BASE}/account/loginEasy', json=b, verify=False, timeout=20)
tok = r.headers.get('X-CustomToken'); mgr = r.headers.get('X-TRAINER_MANAGER', '')
print(f'Login OK manager={mgr}')

# Cargar dump y obtener objetos cliente
nf = json.load(open(NF_DUMP, 'r', encoding='utf-8'))
by_id = {c['id']: c for c in nf['clientes']}

print(f'\n=== A archivar ({len(IDS)}) ===')
for cid in IDS:
    c = by_id.get(cid)
    if not c:
        print(f'  ❌ {cid} no en dump local')
        continue
    nombre = f"{c.get('name','')} {c.get('surname','')}".strip()
    print(f'  → {cid} | {nombre} | email={c.get("email")} | enabled actual={c.get("enabled")}')

if not CONFIRM:
    print('\n[INFO] Modo dry-run. CONFIRM=1 para aplicar.')
    sys.exit(0)

print('\n=== APLICANDO ===')
h = {'X-CustomToken': tok, 'X-TRAINER_MANAGER': mgr,
     'locale': 'es', 'appVersion': '1.8.39', 'appId': '1',
     'Content-Type': 'application/json'}
for cid in IDS:
    c = by_id.get(cid)
    if not c: continue
    payload = dict(c); payload['enabled'] = False
    payload.pop('age', None)
    body = [{**payload, 'toSend': False}]
    r = requests.post(f'{BASE}/api/dispositivos/clientePlusv2',
                      json=body, headers=h, verify=False, timeout=30)
    ok = r.status_code == 200
    print(f'  {cid} → status={r.status_code} {"OK" if ok else r.text[:200]}')
