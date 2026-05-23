"""One-shot: importar a Odoo + NoofitPro + categoría los clientes del banner
'esperando cobro' que tienen match en GestPlus.

Pasos:
  1. Login NoofitPro (trainer Málaga Centro) → getClienteSimple → filtrar
     pendientes del banner (sin categoría y sin atendido_banner).
  2. Login GestPlus → getClientes + getPagadores + getCursos + getRecibos.
  3. Match por email (lower-case).
  4. Para cada match:
       a. upsert_partner en Odoo (XML-RPC) → res.partner + res.partner.bank
       b. clientePlusv2 en NoofitPro → actualiza dni, mobile, address
       c. UPSERT en cliente_categoria con categoria_id=13 (Cliente)
  5. Reporta cursos GP de cada cliente (informativo, no importa cuotas).

Modo DRY-RUN por defecto. Para ejecutar de verdad: env IMPORT_APPLY=1.

Uso:
  IMPORT_APPLY=0 python -m scripts.import_banner_from_gestplus   # simulado
  IMPORT_APPLY=1 python -m scripts.import_banner_from_gestplus   # real
"""
import os, re, sys, json, hashlib, urllib3, logging
from urllib.parse import urljoin
from datetime import date
from collections import defaultdict
import requests

# La libreria Round debe estar disponible (ejecutar desde /opt/round_config_api)
sys.path.insert(0, '/opt/round_config_api')
from app import create_app
from app.db import get_conn
from app.odoo_alta import OdooAlta

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s [%(levelname)s] %(message)s')
log = logging.getLogger('import_banner')

APPLY = os.getenv('IMPORT_APPLY', '0') == '1'
MANAGER_ID  = '17675'
CATEGORIA_ID = 13       # "Cliente"
ID_TRAINER  = '17675'
GP_BASE = 'https://gestplus.okmas.net'
GP_INST = os.getenv('GESTPLUS_INSTALACION', 'B')
GP_YEAR = int(os.getenv('GESTPLUS_YEAR', str(date.today().year)))

NF_BASE = 'https://pro.wiemspro.com/wiemspro'
NF_APP  = '1.8.39'

RECIBO_COLS = ['numRec','codcli','nomcli','dniContr','codcur','cobrado',
               'importeInicial','importeFinal','importeBanco',
               'fechaDesde','fechaHasta','fechDevolucion','fechRecobro',
               'fechaBaja','estado']


def banner(s): print(f'\n{"=" * 70}\n{s}\n{"=" * 70}')


def norm(s): return re.sub(r'\s+', ' ', (s or '').strip().lower())


# ─── NoofitPro ─────────────────────────────────────────────────────────────

def nf_login(email, pwd):
    r = requests.post(f'{NF_BASE}/account/loginEasy',
        json={'email': email, 'appVersion': NF_APP,
              'password': hashlib.md5(pwd.encode()).hexdigest().upper()},
        headers={'Content-Type': 'application/json'},
        verify=False, timeout=30)
    return r.headers.get('X-CustomToken'), r.headers.get('X-TRAINER_MANAGER', '')


def nf_headers(tok, mgr):
    return {'X-CustomToken': tok, 'X-TRAINER_MANAGER': str(mgr or ''),
            'locale': 'es', 'appVersion': NF_APP, 'appId': '1',
            'Content-Type': 'application/json'}


def nf_get_clientes(tok, mgr):
    r = requests.get(f'{NF_BASE}/api/dispositivos/getClienteSimple',
                     headers=nf_headers(tok, mgr), verify=False, timeout=60)
    return (r.json() or {}).get('clientes', [])


def nf_actualizar_cliente(tok, mgr, cliente_nf, datos_gp, pagador_gp):
    """Llama a clientePlusv2 con toSend=False para actualizar SIN reenviar
    email de bienvenida. Sobrescribe: dni, cellPhone, address."""
    nuevo = dict(cliente_nf)
    nuevo['toSend'] = False
    # Solo sobreescribir si NF no lo tiene o está vacío
    if datos_gp.get('dni') and not nuevo.get('dni'):
        nuevo['dni'] = datos_gp['dni']
    if datos_gp.get('telefono') and not nuevo.get('cellPhone'):
        nuevo['cellPhone'] = datos_gp['telefono']
    if datos_gp.get('domicilio') and not (nuevo.get('address') or '').strip():
        nuevo['address'] = datos_gp['domicilio'].strip()[:120]
    r = requests.post(f'{NF_BASE}/api/dispositivos/clientePlusv2',
                      json=[nuevo], headers=nf_headers(tok, mgr),
                      verify=False, timeout=30)
    return r.status_code, (r.text or '')[:200]


# ─── GestPlus ──────────────────────────────────────────────────────────────

def gp_login():
    sess = requests.Session()
    sess.headers['User-Agent'] = 'Mozilla/5.0 RoundImport/1.0'
    r = sess.get(f'{GP_BASE}/GestPlus/login.action', allow_redirects=True, timeout=20)
    forms = re.findall(r'<form[^>]*>[\s\S]*?</form>', r.text, re.I)
    main_form = next((f for f in forms if 'name="usuario"' in f
                      and 'name="password"' in f
                      and 'oldPassword' not in f and 'Monitor' not in f), None)
    m = re.search(r'<form[^>]+action="([^"]*)"', main_form, re.I)
    action_url = urljoin(f'{GP_BASE}/GestPlus/login.action', m.group(1)) if m and m.group(1) else f'{GP_BASE}/GestPlus/login.action'
    payload = {}
    for hidden in re.finditer(r'<input[^>]+type="hidden"[^>]*>', main_form, re.I):
        nm = re.search(r'name="([^"]+)"', hidden.group(0))
        vl = re.search(r'value="([^"]*)"', hidden.group(0))
        if nm: payload[nm.group(1)] = vl.group(1) if vl else ''
    payload['usuario'] = os.getenv('GESTPLUS_USER', '')
    payload['password'] = os.getenv('GESTPLUS_PASS', '')
    sess.post(action_url, data=payload,
              headers={'Referer': f'{GP_BASE}/GestPlus/login.action', 'Origin': GP_BASE},
              allow_redirects=True, timeout=30)
    return sess


def gp_dump(sess):
    r = sess.get(f'{GP_BASE}/GestPlus/getClientes.action',
                 params={'skip': 0, 'filter': '', 'typeFilter': '', 'filterSecond': ''}, timeout=60)
    clientes = r.json().get('listaClientes') or []
    sess.get(f'{GP_BASE}/GestPlus/detailCliente.action',
             params={'codClippal': clientes[0]['codclippal'],
                     'codigo': clientes[0]['codigo']}, timeout=20)
    r = sess.get(f'{GP_BASE}/GestPlus/getPagadores.action',
                 params={'codClippal': clientes[0]['codclippal'],
                         'codigo': clientes[0]['codigo']}, timeout=30)
    pagadores = r.json().get('listaPagadores') or []
    # Cursos catálogo (codigo → descripción del curso)
    sess.get(f'{GP_BASE}/GestPlus/openGestionCursos.action', timeout=15)
    r = sess.get(f'{GP_BASE}/GestPlus/getCursos.action', timeout=60)
    cursos_raw = r.json() if 'json' in r.headers.get('Content-Type', '') else {}
    cursos_lista = None
    for k, v in (cursos_raw or {}).items():
        if isinstance(v, list) and v and isinstance(v[0], dict):
            cursos_lista = v; break
    # Para cursos por cliente usamos /getCursosByCliente.action por cada
    # cliente match (ver gp_fetch_cursos_cliente). El listado global de
    # recibos lo dejamos vacío porque no aporta a la lógica de cursos
    # (el endpoint /getRecibosByInstalacion no devuelve JSON utilizable
    # desde nuestra sesión).
    return clientes, pagadores, (cursos_lista or []), []


def gp_fetch_cursos_cliente(sess, cod_cliente, cursos_idx):
    """Devuelve la lista de cursos del cliente con descripción del catálogo."""
    try:
        sess.get(f'{GP_BASE}/GestPlus/detailCliente.action',
                 params={'codClippal': cod_cliente, 'codigo': cod_cliente},
                 timeout=20)
        sess.get(f'{GP_BASE}/GestPlus/mostrarTabCurso.action',
                 params={'codClippal': cod_cliente, 'codigo': cod_cliente},
                 timeout=15)
        r = sess.get(f'{GP_BASE}/GestPlus/getCursosByCliente.action',
                     params={'id': ''},
                     headers={'X-Requested-With': 'XMLHttpRequest',
                              'Accept': 'application/json',
                              'Referer': f'{GP_BASE}/GestPlus/mostrarTabCurso.action'
                                         f'?codClippal={cod_cliente}&codigo={cod_cliente}'},
                     timeout=20)
        d = r.json()
    except Exception as e:
        log.warning(f'  getCursosByCliente cod={cod_cliente}: {e}')
        return [], False
    lista = d.get('listaCursosCliente') or []
    cols_def = d.get('stringColumnasCursos') or []
    keys = [c.get('key') for c in cols_def] if (isinstance(cols_def, list)
        and cols_def and isinstance(cols_def[0], dict)) else None
    out = []
    for fila in lista:
        fd = dict(zip(keys, fila)) if (keys and isinstance(fila, list)) else (fila if isinstance(fila, dict) else {})
        cod_curso = fd.get('codcurcli') or fd.get('codigo') or fd.get('codcur')
        curso_meta = cursos_idx.get(str(cod_curso), {}) if cod_curso else {}
        out.append({
            'codigo': cod_curso,
            'descripcion': curso_meta.get('descripcion') or curso_meta.get('nombre')
                            or curso_meta.get('denominacion') or '',
            'fecha_alta': fd.get('fechaAlta'),
            'fecha_baja': fd.get('fechaBaja'),
            'activo': not fd.get('anulado'),
            'tipo_pago': fd.get('tipoPago'),
        })
    return out, bool(d.get('tieneCursoPrincipal'))


def gp_curso_label(curso_dict):
    """Devuelve un texto descriptivo del curso GestPlus.
    El formato concreto del dict varía; usamos las keys más comunes."""
    if not curso_dict: return ''
    for k in ('descripcion', 'nombre', 'denominacion', 'nomCurso'):
        v = curso_dict.get(k)
        if v: return str(v)
    return json.dumps(curso_dict, default=str)[:80]


# ─── Main ──────────────────────────────────────────────────────────────────

def main():
    banner(f'IMPORT BANNER → GESTPLUS  (modo={"APPLY" if APPLY else "DRY-RUN"})')
    app = create_app()
    with app.app_context():
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""SELECT noofit_email, noofit_password
                             FROM trainer_noofit_creds
                            WHERE id_trainer = %s LIMIT 1""", (ID_TRAINER,))
            cred = cur.fetchone()
            cur.execute("""SELECT cliente_idnoofit FROM cliente_categoria
                            WHERE id_manager = %s""", (MANAGER_ID,))
            con_cat = {r['cliente_idnoofit'] for r in cur.fetchall()}
            cur.execute("""SELECT cliente_idnoofit FROM cliente_atendido_banner
                            WHERE id_manager = %s""", (MANAGER_ID,))
            atendidos = {r['cliente_idnoofit'] for r in cur.fetchall()}

    log.info(f'NoofitPro login {cred["noofit_email"]}')
    tok, mgr_h = nf_login(cred['noofit_email'], cred['noofit_password'])
    clientes_nf = nf_get_clientes(tok, mgr_h)
    pendientes = [c for c in clientes_nf if c.get('enabled') is not False
                  and str(c.get('id')) not in con_cat
                  and str(c.get('id')) not in atendidos]
    log.info(f'NF clientes: {len(clientes_nf)}, pendientes banner: {len(pendientes)}')

    log.info('GestPlus login + dump…')
    gp_sess = gp_login()
    gp_clientes, gp_pagadores, gp_cursos, _gp_recibos = gp_dump(gp_sess)
    log.info(f'GP clientes={len(gp_clientes)} pagadores={len(gp_pagadores)} '
             f'cursos_catalogo={len(gp_cursos)}')

    # Índices
    gp_by_email = {}
    for c in gp_clientes:
        e = norm(c.get('email'))
        if e: gp_by_email.setdefault(e, []).append(c)
    pgs_by_dni = {norm(p.get('dni')): p for p in gp_pagadores if p.get('dni')}
    # cursos catálogo: codigo → dict
    cursos_idx = {}
    for cu in gp_cursos:
        # Heurística sobre el codigo: probamos varias keys
        for k in ('codigo', 'codCurso', 'codcur', 'idCurso'):
            v = cu.get(k)
            if v is not None:
                cursos_idx[str(v)] = cu; break

    # Conexión Odoo (compartida)
    oa = OdooAlta() if APPLY else None
    if APPLY:
        oa._connect()
        log.info(f'Odoo conectado: uid={oa._uid}')

    # ─── Procesar cada pendiente ──────────────────────────────────────────
    procesados, errores = [], []
    for c in pendientes:
        em = norm(c.get('email'))
        matches = gp_by_email.get(em, [])
        info = {
            'nf_id': c.get('id'),
            'nf_nombre': f'{c.get("name","")} {c.get("surname","")}'.strip(),
            'nf_email': c.get('email'),
            'gp_codigo': None,
            'gp_dni': None,
            'gp_iban': None,
            'gp_domicilio': None,
            'gp_telefono': None,
            'gp_cursos': [],
            'acciones': [],
            'error': None,
        }
        if not matches:
            info['acciones'].append('skip: sin match GP')
            procesados.append(info); continue

        gpc = matches[0]
        info['gp_codigo'] = gpc.get('codigo')
        info['gp_dni'] = gpc.get('dni') or gpc.get('dniContr')
        info['gp_telefono'] = gpc.get('telefono')
        info['gp_domicilio'] = gpc.get('domicilio')
        pgd = pgs_by_dni.get(norm(gpc.get('dniContr') or gpc.get('dni')))
        iban = (pgd or {}).get('ccc')
        if iban and not iban.startswith('ES000'):
            info['gp_iban'] = iban
        # Cursos vía getCursosByCliente.action (más fiable que cruzar recibos)
        cursos_cli, tiene_principal = gp_fetch_cursos_cliente(
            gp_sess, gpc.get('codigo'), cursos_idx)
        info['gp_cursos'] = cursos_cli
        info['gp_tiene_curso_principal'] = tiene_principal

        # ── 1) Odoo upsert_partner ──────────────────────────────────────
        odoo_payload = {
            'idnoofit':   str(c.get('id')),
            'nombre':     c.get('name') or '',
            'apellidos':  c.get('surname') or '',
            'dni':        info['gp_dni'] or c.get('dni') or '',
            'email':      c.get('email') or '',
            'movil':      info['gp_telefono'] or c.get('cellPhone') or '',
            'direccion':  info['gp_domicilio'] or '',
            'iban':       info['gp_iban'] or '',
        }
        if APPLY:
            try:
                pid = oa.upsert_partner(odoo_payload)
                info['acciones'].append(f'odoo: partner_id={pid}')
            except Exception as e:
                info['error'] = f'odoo: {e}'
                errores.append(info); continue
        else:
            info['acciones'].append(f'odoo: would upsert_partner({odoo_payload})')

        # ── 2) NoofitPro clientePlusv2 ──────────────────────────────────
        gp_datos = {
            'dni':       info['gp_dni'],
            'telefono':  info['gp_telefono'],
            'domicilio': info['gp_domicilio'],
        }
        if APPLY:
            try:
                code, body = nf_actualizar_cliente(tok, mgr_h, c, gp_datos, pgd)
                info['acciones'].append(f'noofit: HTTP {code}')
            except Exception as e:
                info['error'] = f'noofit: {e}'
                errores.append(info); continue
        else:
            info['acciones'].append(f'noofit: would clientePlusv2(dni={gp_datos["dni"]}, '
                                    f'tel={gp_datos["telefono"]}, addr={gp_datos["domicilio"]})')

        # ── 3) Categoría "Cliente" ──────────────────────────────────────
        if APPLY:
            try:
                with get_conn() as conn, conn.cursor() as cur:
                    cur.execute("""
                        INSERT INTO cliente_categoria
                            (id_manager, cliente_idnoofit, categoria_id)
                        VALUES (%s, %s, %s)
                        ON CONFLICT (id_manager, cliente_idnoofit) DO UPDATE
                            SET categoria_id = EXCLUDED.categoria_id,
                                updated_at = NOW()
                    """, (MANAGER_ID, str(c.get('id')), CATEGORIA_ID))
                info['acciones'].append('categoria: Cliente asignada')
            except Exception as e:
                info['error'] = f'categoria: {e}'
                errores.append(info); continue
        else:
            info['acciones'].append(f'categoria: would assign Cliente(id={CATEGORIA_ID})')

        procesados.append(info)

    # ─── Reporte final ────────────────────────────────────────────────────
    banner('REPORTE')
    print(json.dumps({'procesados': procesados, 'errores': errores},
                     ensure_ascii=False, indent=2, default=str))
    n_match = sum(1 for p in procesados if p['gp_codigo'])
    n_skip  = sum(1 for p in procesados if not p['gp_codigo'])
    print(f'\nResumen: pendientes={len(pendientes)}  match_GP={n_match}  '
          f'sin_match={n_skip}  errores={len(errores)}  '
          f'mode={"APPLY" if APPLY else "DRY-RUN"}')


if __name__ == '__main__':
    main()
