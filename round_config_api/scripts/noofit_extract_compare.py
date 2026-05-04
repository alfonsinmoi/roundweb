"""Extracción de NoofitPro + comparación con GestPlus dump.

Uso:
  NOOFIT_EMAIL=... NOOFIT_PASS=... \
  python noofit_extract_compare.py [path_dump_gestplus.json]
"""
import os, sys, json, hashlib
from datetime import datetime
from collections import defaultdict
import requests, urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
VERIFY = False  # cert de pro.wiemspro.com no validable desde aquí

BASE = 'https://pro.wiemspro.com/wiemspro'
APP_VERSION = '1.8.39'
APP_ID = '1'

EMAIL = os.getenv('NOOFIT_EMAIL', '')
PWD = os.getenv('NOOFIT_PASS', '')
if not EMAIL or not PWD:
    sys.exit('ERROR: define NOOFIT_EMAIL y NOOFIT_PASS')


def banner(s): print(f'\n{"="*60}\n{s}\n{"="*60}')


def login(email, password):
    banner('1) LOGIN NOOFIT')
    body = {'email': email, 'appVersion': APP_VERSION,
            'password': hashlib.md5(password.encode()).hexdigest().upper()}
    r = requests.post(f'{BASE}/account/loginEasy',
                      json=body, headers={'Content-Type': 'application/json'},
                      verify=VERIFY, timeout=30)
    print(f'  POST → {r.status_code}')
    if r.status_code != 200:
        print(f'  body: {r.text[:300]}')
        sys.exit('Login fallido')
    token = r.headers.get('X-CustomToken')
    manager = r.headers.get('X-TRAINER_MANAGER', '')
    print(f'  token: {(token or "")[:12]}... manager: {manager}')
    return token, manager


def auth_headers(token, manager):
    return {
        'X-CustomToken': token,
        'X-TRAINER_MANAGER': manager,
        'locale': 'es',
        'appVersion': APP_VERSION,
        'appId': APP_ID,
    }


def get_clientes(token, manager):
    banner('2) BULK CLIENTES NOOFIT')
    r = requests.get(f'{BASE}/api/dispositivos/getClienteSimple',
                     headers=auth_headers(token, manager),
                     verify=VERIFY, timeout=60)
    if r.status_code != 200:
        print(f'  status {r.status_code}: {r.text[:300]}')
        sys.exit('Fallo getClienteSimple')
    data = r.json()
    if data.get('mensaje') != 'OK':
        print('respuesta:', data)
        sys.exit('Mensaje no OK')
    cs = data.get('clientes') or []
    print(f'  Clientes en NoofitPro: {len(cs)}')
    if cs: print(f'  Sample keys: {sorted(cs[0].keys())[:25]}')
    return cs


def normaliza_dni(d):
    return (d or '').strip().upper().replace(' ', '').replace('-', '')


def normaliza_email(e):
    return (e or '').strip().lower()


def comparar(gestplus_path, noofit_clientes):
    banner('3) CRUCE GESTPLUS ↔ NOOFIT')
    with open(gestplus_path, 'r', encoding='utf-8') as f:
        gp = json.load(f)
    altas = gp['altas']
    bajas = gp['bajas_recientes_12m']

    # Indexar NoofitPro por DNI y email
    noofit_by_dni = {}
    noofit_by_email = {}
    for c in noofit_clientes:
        d = normaliza_dni(c.get('dni') or c.get('nif'))
        if d: noofit_by_dni[d] = c
        e = normaliza_email(c.get('email'))
        if e: noofit_by_email[e] = c

    def find_in_noofit(g):
        d = normaliza_dni(g.get('dni'))
        if d and d in noofit_by_dni: return noofit_by_dni[d], 'dni'
        d2 = normaliza_dni(g.get('dniContr'))
        if d2 and d2 in noofit_by_dni: return noofit_by_dni[d2], 'dniContr'
        e = normaliza_email(g.get('email'))
        if e and e in noofit_by_email: return noofit_by_email[e], 'email'
        return None, None

    # ALTAS — tienen que estar en NoofitPro activos
    alta_ok = []
    alta_falta_en_noofit = []
    alta_archivado_en_noofit = []
    for g in altas:
        n, by = find_in_noofit(g)
        if not n:
            alta_falta_en_noofit.append({'codigo':g['codigo'],'dni':g.get('dni'),
                                         'nombre':f"{g.get('nombre','')} {g.get('apellidos','')}".strip(),
                                         'email':g.get('email')})
        else:
            # NoofitPro: enabled=false → archivado
            if n.get('enabled') is False or n.get('enabled') == 0:
                alta_archivado_en_noofit.append({'codigo':g['codigo'],'dni':g.get('dni'),
                                                  'noofit_id':n.get('id'),'matched_by':by})
            else:
                alta_ok.append({'codigo':g['codigo'],'noofit_id':n.get('id'),'matched_by':by})

    # BAJAS recientes — pueden estar archivadas o activas en NoofitPro
    baja_a_archivar = []   # están activas en NoofitPro pero baja en GestPlus → hay que archivar
    baja_correcta = []     # ya archivadas en NoofitPro
    baja_no_existe = []    # no están en NoofitPro
    for g in bajas:
        n, by = find_in_noofit(g)
        if not n:
            baja_no_existe.append({'codigo':g['codigo'],'dni':g.get('dni'),
                                   'nombre':f"{g.get('nombre','')} {g.get('apellidos','')}".strip(),
                                   'fechaBaja':g.get('fechaBaja')})
        elif n.get('enabled') is False or n.get('enabled') == 0:
            baja_correcta.append({'codigo':g['codigo'],'noofit_id':n.get('id'),'matched_by':by})
        else:
            baja_a_archivar.append({'codigo':g['codigo'],'dni':g.get('dni'),
                                    'noofit_id':n.get('id'),'matched_by':by,
                                    'nombre':f"{g.get('nombre','')} {g.get('apellidos','')}".strip(),
                                    'fechaBaja':g.get('fechaBaja')})

    # Clientes en NoofitPro activos que no están en GestPlus alta (huérfanos)
    gp_dnis = set()
    gp_emails = set()
    for g in altas + bajas:
        if g.get('dni'): gp_dnis.add(normaliza_dni(g['dni']))
        if g.get('dniContr'): gp_dnis.add(normaliza_dni(g['dniContr']))
        if g.get('email'): gp_emails.add(normaliza_email(g['email']))
    huerfanos_noofit = []
    for c in noofit_clientes:
        if c.get('enabled') is False: continue  # solo activos
        d = normaliza_dni(c.get('dni') or c.get('nif'))
        e = normaliza_email(c.get('email'))
        if (d and d in gp_dnis) or (e and e in gp_emails): continue
        huerfanos_noofit.append({'noofit_id':c.get('id'),'dni':c.get('dni'),'email':c.get('email'),
                                  'nombre':f"{c.get('nombre','') or c.get('name','')} {c.get('apellidos','') or c.get('surname','')}".strip()})

    print(f'\n  ALTAS ({len(altas)}):')
    print(f'    ✅ correctas (alta en ambos):       {len(alta_ok)}')
    print(f'    ⚠️  alta GP pero archivada NoofitPro:{len(alta_archivado_en_noofit)}')
    print(f'    ❌ falta crear en NoofitPro:        {len(alta_falta_en_noofit)}')
    print(f'\n  BAJAS RECIENTES ({len(bajas)}):')
    print(f'    ✅ ya archivadas en NoofitPro:      {len(baja_correcta)}')
    print(f'    ⚠️  ACTIVAS en NoofitPro → archivar:{len(baja_a_archivar)}')
    print(f'    ➖  no están en NoofitPro:          {len(baja_no_existe)}')
    print(f'\n  HUÉRFANOS NoofitPro (activos sin match en GestPlus): {len(huerfanos_noofit)}')

    return {
        'extracted_at': datetime.utcnow().isoformat() + 'Z',
        'gestplus_dump': gestplus_path,
        'noofit_total': len(noofit_clientes),
        'noofit_activos': sum(1 for c in noofit_clientes if c.get('enabled') is not False),
        'alta_ok': alta_ok,
        'alta_archivado_en_noofit': alta_archivado_en_noofit,
        'alta_falta_en_noofit': alta_falta_en_noofit,
        'baja_correcta': baja_correcta,
        'baja_a_archivar': baja_a_archivar,
        'baja_no_existe': baja_no_existe,
        'huerfanos_noofit': huerfanos_noofit,
    }


def main():
    token, manager = login(EMAIL, PWD)
    noofit = get_clientes(token, manager)
    gp_path = sys.argv[1] if len(sys.argv) > 1 else f'gestplus_dump_{datetime.now().date().isoformat()}.json'
    if not os.path.exists(gp_path):
        sys.exit(f'No existe dump: {gp_path}')
    report = comparar(gp_path, noofit)
    with open('comparacion_gestplus_noofit.json', 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2, default=str)
    # Guardar bulk noofit
    with open('noofit_clientes_dump.json', 'w', encoding='utf-8') as f:
        json.dump({'extracted_at': datetime.utcnow().isoformat()+'Z',
                   'total': len(noofit), 'clientes': noofit},
                  f, ensure_ascii=False, indent=2, default=str)
    banner('✅ Reportes guardados: comparacion_gestplus_noofit.json + noofit_clientes_dump.json')


if __name__ == '__main__':
    main()
