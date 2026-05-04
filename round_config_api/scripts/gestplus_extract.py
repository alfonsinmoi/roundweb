"""Extracción bulk de GestPlus → JSON dump.

Estrategia: 4-5 llamadas globales (no per-cliente):
  1. getClientes.action → 1495 clientes
  2. detailCliente + getPagadores.action → 1467 pagadores con CCC (IBAN)
  3. getCursos.action → catálogo cursos
  4. getRecibosByInstalacion.action (rango 2026 mes a mes para evitar 'fecha futura')
  5. (opcional) getRecibosImpagados.action

Filtra: altas + bajas en últimos 12 meses.
Cruza por dniContr ↔ pagador.dni para obtener IBAN.
Indexa recibos por codcli para asignar a cada cliente.

Credenciales en variables de entorno:
  GESTPLUS_USER, GESTPLUS_PASS
"""
import os, sys, json, re
from datetime import datetime, date, timedelta
from urllib.parse import urljoin
from collections import defaultdict
import requests

BASE = 'https://gestplus.okmas.net'
USER = os.getenv('GESTPLUS_USER', '')
PWD  = os.getenv('GESTPLUS_PASS', '')
INSTALACION = os.getenv('GESTPLUS_INSTALACION', 'B')
ANIO = int(os.getenv('GESTPLUS_YEAR', '2026'))

if not USER or not PWD:
    sys.exit('ERROR: define GESTPLUS_USER y GESTPLUS_PASS en el entorno.')


def banner(s): print(f'\n{"="*60}\n{s}\n{"="*60}')


def login(session):
    banner('1) LOGIN')
    r = session.get(BASE + '/GestPlus/login.action', allow_redirects=True, timeout=20)
    forms = re.findall(r'<form[^>]*>[\s\S]*?</form>', r.text, re.I)
    main_form = next((f for f in forms if 'name="usuario"' in f and 'name="password"' in f
                      and 'oldPassword' not in f and 'Monitor' not in f), None)
    if not main_form:
        sys.exit('No encuentro form principal de login')
    m = re.search(r'<form[^>]+action="([^"]*)"', main_form, re.I)
    action_url = urljoin(BASE + '/GestPlus/login.action', m.group(1)) if m and m.group(1) else BASE + '/GestPlus/login.action'

    payload = {}
    for hidden in re.finditer(r'<input[^>]+type="hidden"[^>]*>', main_form, re.I):
        nm = re.search(r'name="([^"]+)"', hidden.group(0))
        vl = re.search(r'value="([^"]*)"', hidden.group(0))
        if nm: payload[nm.group(1)] = vl.group(1) if vl else ''
    payload['usuario'] = USER
    payload['password'] = PWD

    r = session.post(action_url, data=payload,
                     headers={'Referer': BASE + '/GestPlus/login.action', 'Origin': BASE},
                     allow_redirects=True, timeout=30)
    rj = session.get(BASE + '/GestPlus/getClientes.action',
                     params={'skip':0,'filter':'','typeFilter':'','filterSecond':''}, timeout=30)
    if rj.headers.get('Content-Type','').startswith('application/json'):
        try:
            d = rj.json()
            if 'listaClientes' in d:
                print(f'  ✅ Login OK — {d.get("totalRecords")} clientes accesibles')
                return True
        except Exception: pass
    sys.exit('Login fallido')


def fetch_clientes(s):
    banner('2) BULK CLIENTES')
    r = s.get(BASE + '/GestPlus/getClientes.action',
              params={'skip':0,'filter':'','typeFilter':'','filterSecond':''}, timeout=60)
    r.raise_for_status()
    data = r.json()
    lista = data.get('listaClientes') or []
    print(f'  Recibidos {len(lista)} de {data.get("totalRecords")}')
    return lista


def fetch_pagadores(s, sample_cliente):
    """getPagadores.action devuelve los 1467 pagadores del centro completo,
    pero requiere haber hidratado el contexto via detailCliente.action."""
    banner('3) PAGADORES (IBAN)')
    s.get(BASE + '/GestPlus/detailCliente.action',
          params={'codClippal':sample_cliente['codclippal'],'codigo':sample_cliente['codigo']}, timeout=20)
    r = s.get(BASE + '/GestPlus/getPagadores.action',
              params={'codClippal':sample_cliente['codclippal'],'codigo':sample_cliente['codigo']}, timeout=30)
    r.raise_for_status()
    pgs = r.json().get('listaPagadores') or []
    print(f'  Pagadores: {len(pgs)}')
    return pgs


def fetch_cursos(s):
    banner('4) CURSOS (CATÁLOGO)')
    s.get(BASE + '/GestPlus/openGestionCursos.action', timeout=15)
    r = s.get(BASE + '/GestPlus/getCursos.action', timeout=60)
    r.raise_for_status()
    data = r.json()
    # Estructura desconocida — guardamos crudo
    keys = list(data.keys())
    print(f'  keys: {keys[:6]}, total len bytes: {len(r.text)}')
    # Buscar lista de cursos
    cursos = None
    for k in keys:
        v = data[k]
        if isinstance(v, list) and v and isinstance(v[0], dict):
            cursos = v
            print(f'  lista en clave "{k}": {len(v)} items, sample keys: {sorted(v[0].keys())[:15]}')
            break
    return data, cursos


# Mapping de columnas que devuelve getRecibosByInstalacion.action (array no objeto)
RECIBO_COLS = ['numRec','codcli','nomcli','dniContr','codcur','cobrado',
               'importeInicial','importeFinal','importeBanco',
               'fechaDesde','fechaHasta','fechDevolucion','fechRecobro','fechaBaja','estado']


def fetch_recibos(s, anio):
    """Obtiene TODOS los recibos del año en una sola llamada.
    GestPlus exige fechaHasta >= hoy, así que usamos hoy como límite superior."""
    banner(f'5) RECIBOS {anio} (instalación {INSTALACION})')
    s.get(BASE + '/GestPlus/openRecibosCentral.action', timeout=15)
    hoy = date.today()
    fd = date(anio, 1, 1).strftime('%d/%m/%Y')
    fh = hoy.strftime('%d/%m/%Y')
    params = {'instalacion': INSTALACION, 'fechaDesde': fd, 'fechaHasta': fh}
    r = s.get(BASE + '/GestPlus/getRecibosByInstalacion.action', params=params, timeout=120)
    if 'json' not in r.headers.get('Content-Type',''):
        print(f'  ERROR: respuesta no-json. Body: {r.text[:300]}')
        return []
    j = r.json()
    recs = j.get('listaRecibos') or []
    print(f'  Rango {fd} → {fh}: {len(recs)} recibos')
    decoded = [dict(zip(RECIBO_COLS, x)) for x in recs]
    return decoded


def clasificar(lista):
    banner('6) CLASIFICACIÓN')
    hoy = date.today()
    hace_12m = hoy - timedelta(days=365)
    altas, bajas_rec, bajas_old = [], [], []
    for c in lista:
        if c.get('estado') == 1:
            altas.append(c); continue
        fb = c.get('fechaBaja')
        try:
            d = datetime.fromisoformat(fb.replace('Z','')).date() if fb else None
        except Exception: d = None
        if d and d >= hace_12m: bajas_rec.append(c)
        else: bajas_old.append(c)
    print(f'  Alta:                    {len(altas)}')
    print(f'  Baja en últimos 12 m:    {len(bajas_rec)}')
    print(f'  Baja > 12 m (descartar): {len(bajas_old)}')
    return altas, bajas_rec, bajas_old


def cruzar(clientes, pagadores, recibos):
    """Anota cada cliente con su iban (vía dniContr) y lista de recibos del año."""
    banner('7) CROSS-REFERENCE')
    pagador_by_dni = {p['dni']: p for p in pagadores}
    recibos_by_codcli = defaultdict(list)
    for r in recibos:
        recibos_by_codcli[r.get('codcli')].append(r)

    enriched_iban = enriched_recibos = 0
    for c in clientes:
        # IBAN
        p = pagador_by_dni.get(c.get('dniContr'))
        if p:
            c['_iban'] = p.get('ccc')
            c['_pagador_formaPago'] = p.get('formaPago')
            c['_pagador_dni'] = p.get('dni')
            c['_pagador_id'] = p.get('id')
            if c['_iban'] and not c['_iban'].startswith('ES000'):
                enriched_iban += 1
        # Recibos
        c['_recibos'] = recibos_by_codcli.get(c.get('codigo'), [])
        if c['_recibos']: enriched_recibos += 1
    print(f'  Clientes con IBAN real: {enriched_iban}')
    print(f'  Clientes con recibos:   {enriched_recibos}')


def main():
    s = requests.Session()
    s.headers['User-Agent'] = 'Mozilla/5.0 RoundMigration/1.0'
    login(s)
    clientes = fetch_clientes(s)
    pagadores = fetch_pagadores(s, clientes[0])
    cursos_raw, cursos_lista = fetch_cursos(s)
    recibos = fetch_recibos(s, ANIO)
    cruzar(clientes, pagadores, recibos)
    altas, bajas_rec, bajas_old = clasificar(clientes)

    out = {
        'extracted_at': datetime.utcnow().isoformat() + 'Z',
        'instalacion': INSTALACION,
        'year_recibos': ANIO,
        'totals': {
            'all': len(clientes),
            'altas': len(altas),
            'bajas_recientes': len(bajas_rec),
            'bajas_descartadas': len(bajas_old),
            'pagadores': len(pagadores),
            'recibos': len(recibos),
            'cursos_catalogo': len(cursos_lista or []),
        },
        'altas': altas,
        'bajas_recientes_12m': bajas_rec,
        'bajas_descartadas': [{'codigo':b['codigo'],'fechaBaja':b.get('fechaBaja')} for b in bajas_old],
        'pagadores': pagadores,
        'cursos_catalogo': cursos_lista or [],
    }
    fname = f'gestplus_dump_{date.today().isoformat()}.json'
    with open(fname, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=2, default=str)
    banner(f'✅ Volcado guardado en {fname}')
    print(json.dumps(out['totals'], indent=2))


if __name__ == '__main__':
    main()
