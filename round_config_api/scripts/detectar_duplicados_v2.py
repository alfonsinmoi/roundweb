"""Búsqueda más laxa de duplicados: por email exacto, dni igual,
   o por al menos 1 apellido normalizado idéntico.
"""
import json, sys, re, unicodedata
sys.path.insert(0, '/opt/round_config_api')

NF_DUMP = '/opt/round_config_api/noofit_clientes_dump.json'

TARGETS = [
    {'id': 1817687, 'nota': 'Estrella Albala — archivar directo'},
    {'id': 1756235, 'nota': 'Eva Flores — duplicado'},
    {'id': 1818757, 'nota': 'María Jesús Jiménez Chicón — duplicado'},
    {'id': 1748915, 'nota': 'María José Aranda — duplicado'},
    {'id': 1770518, 'nota': 'uriel ro — duplicado'},
]

def strip_accents(s):
    return ''.join(c for c in unicodedata.normalize('NFD', str(s or '')) if unicodedata.category(c) != 'Mn')
def norm(s):
    return re.sub(r'[^A-Z0-9]', '', strip_accents(s).upper())
def name_tokens(s):
    s = strip_accents(s).upper()
    s = re.sub(r'[^A-Z ]+', ' ', s).strip()
    SW = {'DE','DA','DEL','LA','LAS','LOS','EL','MC','MAC','VAN','VON','DI','DOS','DAS','MARIA','JOSE','JESUS'}
    return {t for t in s.split() if len(t) > 1 and t not in SW}

nf = json.load(open(NF_DUMP, 'r', encoding='utf-8'))
clientes = nf.get('clientes', [])
by_id = {c['id']: c for c in clientes}
print(f'Dump: {len(clientes)} clientes\n')

for t in TARGETS:
    target = by_id.get(t['id'])
    if not target:
        print(f'❌ {t["id"]} no en dump')
        continue
    nombre_target = f"{target.get('name','')} {target.get('surname','')}".strip()
    dni = (target.get('dni') or '').strip().upper()
    email = (target.get('email') or '').lower()
    target_toks = name_tokens(nombre_target)

    print(f'─ {t["id"]:>10} {nombre_target} | dni={dni} email={email} enabled={target.get("enabled")}')
    print(f'   nota: {t["nota"]}')

    candidates = []
    for c in clientes:
        if c['id'] == t['id']: continue
        c_dni = (c.get('dni') or '').strip().upper()
        c_email = (c.get('email') or '').lower()
        c_toks = name_tokens(f"{c.get('name','')} {c.get('surname','')}")
        reasons = []
        # email exacto (ignorar emails muy genéricos / vacíos)
        if email and email == c_email and len(email) > 5:
            reasons.append('email')
        # dni exacto y razonable (>= 8 chars)
        if dni and len(dni) >= 8 and norm(dni) == norm(c_dni) and not dni.startswith('20'):
            reasons.append('dni')
        # name tokens — al menos 2 en común
        common = target_toks & c_toks
        if len(common) >= 2:
            reasons.append(f'tokens={sorted(common)}')
        # name tokens — 1 muy específico (>= 6 chars y no común)
        if not reasons and len(target_toks & c_toks) == 1:
            tok = list(target_toks & c_toks)[0]
            if len(tok) >= 6:
                reasons.append(f'token-largo={tok}')
        if reasons:
            candidates.append((c, reasons))

    if not candidates:
        print('   (sin candidatos en este dump — posiblemente está en otro trainer)')
    for c, reasons in candidates:
        nombre = f"{c.get('name','')} {c.get('surname','')}".strip()
        print(f'   ↪ id={c["id"]:>10} {nombre[:35]:35s} | dni={c.get("dni") or ""} | enabled={c.get("enabled")} | {", ".join(reasons)}')
    print()
