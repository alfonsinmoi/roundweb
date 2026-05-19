"""Para los IDs sospechosos de duplicado:
   1817687 (estrella albala) — archivar directamente
   1756235 (Eva Flores)      — duplicado, archivar el que NO tenga reservas
   1818757 (María Jesús Jiménez Chicón)
   1748915 (María José Aranda)
   1770518 (uriel ro)

Estrategia:
   1. Buscar en el dump NoofitPro (descargado fresco) candidatos por
      nombre+apellidos similar (Levenshtein-like) o email/dni igual.
   2. Para cada par, contar reservas vía /api/dispositivos/getReservasByUser.
   3. Imprimir tabla informativa.
"""
import json, os, sys, hashlib, re, unicodedata, time
sys.path.insert(0, '/opt/round_config_api')
import requests, urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
from app.db import get_conn

NF_DUMP = '/opt/round_config_api/noofit_clientes_dump.json'

# IDs concretos a investigar
TARGETS = [
    {'id': 1817687, 'nota': 'archivar (Estrella Albala)'},
    {'id': 1756235, 'nota': 'duplicado: Eva Flores'},
    {'id': 1818757, 'nota': 'duplicado: María Jesús Jiménez Chicón'},
    {'id': 1748915, 'nota': 'duplicado: María José Aranda'},
    {'id': 1770518, 'nota': 'duplicado: uriel ro'},
]

# ─── Helpers ─────────────────────────────────────────────────────────────────
def strip_accents(s):
    return ''.join(c for c in unicodedata.normalize('NFD', str(s or '')) if unicodedata.category(c) != 'Mn')
def norm(s):
    return re.sub(r'[^A-Z0-9]', '', strip_accents(s).upper())
def name_tokens(s):
    s = strip_accents(s).upper()
    s = re.sub(r'[^A-Z ]+', ' ', s).strip()
    SW = {'DE','DA','DEL','LA','LAS','LOS','EL','MC','MAC','VAN','VON','DI','DOS','DAS','MARIA'}
    return {t for t in s.split() if len(t) > 1 and t not in SW}

# ─── Cargar dump ─────────────────────────────────────────────────────────────
nf = json.load(open(NF_DUMP, 'r', encoding='utf-8'))
clientes = nf.get('clientes', [])
by_id = {c['id']: c for c in clientes}

# ─── Login NoofitPro para getReservasByUser ──────────────────────────────────
def loginEasy_via_manager():
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT noofit_email, noofit_password FROM manager_config WHERE activo=TRUE LIMIT 1")
        row = cur.fetchone()
    body = {'email': row['noofit_email'], 'appVersion': '1.8.39',
            'password': hashlib.md5(row['noofit_password'].encode()).hexdigest().upper()}
    r = requests.post('https://pro.wiemspro.com/wiemspro/account/loginEasy',
                      json=body, verify=False, timeout=20)
    return r.headers.get('X-CustomToken'), r.headers.get('X-TRAINER_MANAGER', '')

def get_reservas_count(token, manager, id_cliente):
    h = {'X-CustomToken': token, 'X-TRAINER_MANAGER': manager,
         'locale': 'es', 'appVersion': '1.8.39', 'appId': '1', 'initialId': '0',
         'Content-Type': 'application/json'}
    try:
        r = requests.post('https://pro.wiemspro.com/wiemspro/api/dispositivos/getReservasByUser',
                          json={'id': id_cliente}, headers=h, verify=False, timeout=20)
        if r.status_code != 200: return -1
        d = r.json()
        if d.get('mensaje') != 'OK': return -1
        return len(d.get('clases') or d.get('reservas') or [])
    except Exception:
        return -1

token, mgr = loginEasy_via_manager()
print(f'Login NoofitPro OK manager={mgr}\n')

# ─── Buscar duplicados ───────────────────────────────────────────────────────
results = []
for t in TARGETS:
    target_id = t['id']
    target = by_id.get(target_id)
    if not target:
        print(f'❌ {target_id} no en dump: {t["nota"]}')
        continue

    nombre_target = f"{target.get('name','')} {target.get('surname','')}".strip()
    dni = (target.get('dni') or target.get('nif') or '').strip().upper()
    email = (target.get('email') or '').lower()

    # Buscar candidatos
    target_toks = name_tokens(nombre_target)
    candidates = []
    for c in clientes:
        if c['id'] == target_id: continue
        c_dni = (c.get('dni') or c.get('nif') or '').strip().upper()
        c_email = (c.get('email') or '').lower()
        match_reasons = []
        if dni and norm(dni) == norm(c_dni) and len(dni) >= 7:
            match_reasons.append(f'DNI={dni}')
        if email and email == c_email:
            match_reasons.append(f'email={email}')
        c_toks = name_tokens(f"{c.get('name','')} {c.get('surname','')}")
        if len(target_toks & c_toks) >= 2:
            match_reasons.append(f'tokens={target_toks & c_toks}')
        if match_reasons:
            candidates.append((c, match_reasons))

    print(f'─ {target_id} {nombre_target} ({t["nota"]})')
    print(f'   dni={dni} email={email} enabled={target.get("enabled")}')
    n_target = get_reservas_count(token, mgr, target_id); time.sleep(0.05)
    print(f'   reservas: {n_target}')
    for c, reasons in candidates:
        n = get_reservas_count(token, mgr, c['id']); time.sleep(0.05)
        nombre = f"{c.get('name','')} {c.get('surname','')}".strip()
        print(f'   ↪  duplicado id={c["id"]:>10} {nombre[:30]:30s} | enabled={c.get("enabled")} | reservas={n} | match: {", ".join(reasons)}')
        results.append({
            'principal_id': target_id,
            'principal_nombre': nombre_target,
            'principal_reservas': n_target,
            'principal_enabled': target.get('enabled'),
            'duplicado_id': c['id'],
            'duplicado_nombre': nombre,
            'duplicado_reservas': n,
            'duplicado_enabled': c.get('enabled'),
            'razones': reasons,
        })
    if not candidates:
        print('   (sin candidatos detectados — la nota dice duplicado pero no encuentro otro)')
    print()

print('\n=== Resumen ===')
print(f'Pares detectados: {len(results)}')
print('\nPropuesta (archivar el que tenga MENOS reservas):')
for r in results:
    if r['principal_reservas'] < 0 or r['duplicado_reservas'] < 0:
        print(f'  ⚠ {r["principal_id"]} vs {r["duplicado_id"]} — fallo en getReservas, decide manualmente')
        continue
    if r['principal_reservas'] >= r['duplicado_reservas']:
        archivar = r['duplicado_id']; mantener = r['principal_id']
        archivar_nombre = r['duplicado_nombre']
    else:
        archivar = r['principal_id']; mantener = r['duplicado_id']
        archivar_nombre = r['principal_nombre']
    print(f'  ARCHIVAR {archivar} ({archivar_nombre}) — mantener {mantener}')
