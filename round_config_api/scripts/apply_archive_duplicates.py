"""Archiva en NoofitPro los duplicados sin reservas.

Carga noofit_clientes_dump.json, redetecta duplicados (mismo criterio que el
script find_duplicates_noofit.py), consulta reservas y archiva los que están
sin reservas dentro de un grupo donde al menos OTRO cliente del grupo SÍ tiene
reservas (preferimos mantener al usado).

Si nadie del grupo tiene reservas → no se archiva ninguno (revisar manualmente).
Si todos tienen reservas → no se archiva ninguno.

Usa el mismo endpoint que el frontend: POST api/dispositivos/clientePlusv2
con [{...cliente, enabled: false, toSend: true, motivoArchivado: 'duplicado'}]

Variables de entorno:
  NOOFIT_EMAIL, NOOFIT_PASS
  DRY_RUN=1 (por defecto) — solo simula. Pon DRY_RUN=0 para aplicar.
"""
import os, sys, json, hashlib, time
from datetime import datetime
from collections import defaultdict
import requests, urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
VERIFY = False

BASE = 'https://pro.wiemspro.com/wiemspro'
APP_VERSION = '1.8.39'
APP_ID = '1'

EMAIL = os.getenv('NOOFIT_EMAIL', '')
PWD   = os.getenv('NOOFIT_PASS', '')
DRY   = os.getenv('DRY_RUN', '1') == '1'
if not EMAIL or not PWD: sys.exit('ERROR: define NOOFIT_EMAIL y NOOFIT_PASS')


def banner(s): print(f'\n{"="*60}\n{s}\n{"="*60}')


def login():
    body = {'email': EMAIL, 'appVersion': APP_VERSION,
            'password': hashlib.md5(PWD.encode()).hexdigest().upper()}
    r = requests.post(f'{BASE}/account/loginEasy', json=body, verify=VERIFY, timeout=30)
    if r.status_code != 200: sys.exit('Login fallido: ' + r.text[:200])
    return r.headers.get('X-CustomToken'), r.headers.get('X-TRAINER_MANAGER', '')


def hdrs(token, manager, extra=None):
    h = {
        'X-CustomToken': token, 'X-TRAINER_MANAGER': manager,
        'locale':'es', 'appVersion':APP_VERSION, 'appId':APP_ID,
        'Content-Type':'application/json',
    }
    if extra: h.update(extra)
    return h


def get_reservas(token, manager, id_cliente):
    r = requests.post(f'{BASE}/api/dispositivos/getReservasByUser',
                      json={'id': id_cliente},
                      headers=hdrs(token, manager, {'initialId': '0'}),
                      verify=VERIFY, timeout=30)
    if r.status_code != 200: return []
    try:
        d = r.json()
        if d.get('mensaje') != 'OK': return []
        return d.get('clases') or d.get('reservas') or []
    except Exception:
        return []


def archivar(token, manager, cliente, motivo='duplicado'):
    payload = [{**cliente, 'enabled': False, 'toSend': True, 'motivoArchivado': motivo}]
    r = requests.post(f'{BASE}/api/dispositivos/clientePlusv2',
                      json=payload, headers=hdrs(token, manager),
                      verify=VERIFY, timeout=30)
    try:
        d = r.json()
        ok = (r.status_code == 200) and (d.get('mensaje') == 'OK')
        return ok, d
    except Exception:
        return r.status_code == 200, {'raw': r.text[:200]}


def normaliza_dni(d):
    return (d or '').strip().upper().replace(' ', '').replace('-', '').replace('.', '')


def normaliza_email(e):
    return (e or '').strip().lower()


def normaliza_nombre(n):
    return (n or '').strip().upper().replace('  ', ' ')


def fullname(c):
    return f"{c.get('nombre') or c.get('name') or ''} {c.get('apellidos') or c.get('surname') or ''}".strip()


def encontrar_duplicados(clientes):
    activos_raw = [c for c in clientes if c.get('enabled') is not False and c.get('enabled') != 0]
    # Deduplicar por id literal (la API a veces los devuelve repetidos)
    seen = {}
    for c in activos_raw:
        if c['id'] not in seen: seen[c['id']] = c
    activos = list(seen.values())
    if len(activos) != len(activos_raw):
        print(f'  IDs literalmente duplicados (descartados): {len(activos_raw) - len(activos)}')
    by_dni, by_email, by_nombre = defaultdict(list), defaultdict(list), defaultdict(list)
    for c in activos:
        d = normaliza_dni(c.get('dni') or c.get('nif'))
        e = normaliza_email(c.get('email'))
        nm = normaliza_nombre(fullname(c))
        bd = (c.get('birthdate') or '')[:10]
        if d and len(d) >= 8: by_dni[d].append(c)
        if e and '@' in e:    by_email[e].append(c)
        if nm and bd:         by_nombre[f'{nm}|{bd}'].append(c)

    parent = {c['id']: c['id'] for c in activos}
    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb: parent[ra] = rb

    for groups in (by_dni.values(), by_email.values(), by_nombre.values()):
        for g in groups:
            if len(g) < 2: continue
            for c in g[1:]:
                union(g[0]['id'], c['id'])

    grupos_dict = defaultdict(list)
    for c in activos:
        grupos_dict[find(c['id'])].append(c)
    return [g for g in grupos_dict.values() if len(g) >= 2]


def main():
    banner('1) Login NoofitPro')
    token, manager = login()
    print(f'  manager: {manager}')

    banner('2) Cargar dump y detectar duplicados')
    with open('noofit_clientes_dump.json', 'r', encoding='utf-8') as f:
        clientes = (json.load(f).get('clientes')) or []
    grupos = encontrar_duplicados(clientes)
    print(f'  grupos: {len(grupos)}')

    banner('3) Consultar reservas')
    reservas = {}
    todos = sorted({c['id'] for g in grupos for c in g})
    for i, cid in enumerate(todos, 1):
        reservas[cid] = len(get_reservas(token, manager, cid))
        if i % 10 == 0: print(f'  {i}/{len(todos)}')
        time.sleep(0.05)

    banner('4) Decidir y aplicar')
    print(f'  DRY_RUN = {DRY}\n')
    a_archivar = []
    skip_todos_iguales = []  # ningún criterio claro
    skip_ambiguos = []       # varios con reservas

    for gi, g in enumerate(grupos, 1):
        decorated = [(reservas.get(c['id'], 0), c) for c in g]
        decorated.sort(key=lambda x: -x[0])
        max_res = decorated[0][0]

        if max_res > 0:
            # Caso 1: alguien tiene reservas → mantener los con max_res, archivar los con 0
            keep = [c for n, c in decorated if n == max_res]
            drop = [c for n, c in decorated if n == 0]
            ambig = [c for n, c in decorated if 0 < n < max_res]
            if ambig:
                skip_ambiguos.append({'grupo': gi, 'keep': keep, 'drop': drop, 'ambig': ambig})
        else:
            # Caso 2: nadie tiene reservas → solo archivar duplicados claros (mismo DNI o email)
            dnis = {normaliza_dni(c.get('dni') or c.get('nif')) for n,c in decorated}
            dnis.discard('')
            emails = {normaliza_email(c.get('email')) for n,c in decorated}
            emails.discard('')
            mismo_dni = len(dnis) == 1
            mismo_email = len(emails) == 1
            if not (mismo_dni or mismo_email):
                # Coincidencia solo por nombre+birthdate → revisar manualmente
                skip_todos_iguales.append(g)
                continue
            # Mantener el ID MÁS BAJO (más antiguo), archivar los demás
            sorted_by_id = sorted(g, key=lambda c: c.get('id', 1e18))
            keep = [sorted_by_id[0]]
            drop = sorted_by_id[1:]

        for c in drop:
            a_archivar.append({'grupo': gi, 'id': c['id'],
                               'nombre': fullname(c), 'dni': c.get('dni') or c.get('nif') or '',
                               'email': c.get('email') or '', 'cliente': c,
                               'mantener_id': keep[0]['id']})

    print(f'  Total a archivar: {len(a_archivar)}')
    print(f'  Grupos sin reservas (skip):  {len(skip_todos_iguales)}')
    print(f'  Grupos ambiguos (skip drop): {len(skip_ambiguos)}')

    if not a_archivar:
        print('\nNada que archivar — revisa los grupos manualmente.')
        return

    print('\nLista a archivar:')
    for x in a_archivar:
        print(f'  - id={x["id"]:>8d} → mantener id={x["mantener_id"]:>8d} | {x["nombre"][:30]:<30s} dni={x["dni"]:<11s} (grupo {x["grupo"]})')

    if DRY:
        print('\n(DRY_RUN=1 → no se aplica. Re-ejecuta con DRY_RUN=0 para archivar.)')
        return

    banner('5) Aplicando archivado en NoofitPro')
    log = []
    ok = err = 0
    for x in a_archivar:
        success, resp = archivar(token, manager, x['cliente'])
        if success: ok += 1
        else: err += 1
        log.append({'id':x['id'],'nombre':x['nombre'],'ok':success,'resp':resp})
        print(f'  {"✅" if success else "❌"} id={x["id"]} {x["nombre"][:30]}')
        time.sleep(0.1)
    print(f'\n  Archivados OK: {ok} · Errores: {err}')
    with open('archive_log.json', 'w', encoding='utf-8') as f:
        json.dump({'at': datetime.utcnow().isoformat()+'Z', 'log': log, 'skipped': {
            'sin_reservas': [[c['id'] for c in g] for g in skip_todos_iguales],
            'ambiguos': skip_ambiguos,
        }}, f, ensure_ascii=False, indent=2, default=str)
    print('  → archive_log.json guardado')


if __name__ == '__main__':
    main()
