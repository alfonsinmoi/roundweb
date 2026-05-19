"""Sync NoofitPro → round.subscription Odoo.

Lee NoofitPro: para cada cliente con enabled=False, cancela TODAS sus
subscriptions activas en Odoo (fecha_fin=hoy, estado=cancelada).

Idempotente: subs ya canceladas no se tocan.

Modo:
  CONFIRM=1 para aplicar
  default = dry-run
  Sin parámetros = lee dump local NoofitPro
"""
import os, sys, json, hashlib, requests, urllib3, datetime
sys.path.insert(0, '/opt/round_config_api')
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
from app.db import get_conn
from app.odoo_alta import OdooAlta

CONFIRM = os.getenv('CONFIRM') == '1'
COMPANY_ID = int(os.getenv('ODOO_COMPANY', '3'))
NF_DUMP = os.getenv('NF_DUMP', '/opt/round_config_api/noofit_clientes_dump.json')
USE_LIVE = os.getenv('USE_LIVE') == '1'  # si true, llama API en vivo


def get_clientes_nf():
    """Devuelve lista de clientes NF. Si USE_LIVE, hace login y getClienteSimple,
    si no, lee del dump local."""
    if USE_LIVE:
        # Login con credenciales del manager
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("SELECT noofit_email, noofit_password FROM manager_config WHERE activo=TRUE LIMIT 1")
            row = cur.fetchone()
        if not row: return []
        body = {'email': row['noofit_email'], 'appVersion': '1.8.39',
                'password': hashlib.md5(row['noofit_password'].encode()).hexdigest().upper()}
        r = requests.post('https://pro.wiemspro.com/wiemspro/account/loginEasy',
                          json=body, verify=False, timeout=30)
        tok = r.headers.get('X-CustomToken')
        mgr = r.headers.get('X-TRAINER_MANAGER', '')
        h = {'X-CustomToken': tok, 'X-TRAINER_MANAGER': mgr,
             'locale': 'es', 'appVersion': '1.8.39', 'appId': '1'}
        r = requests.get('https://pro.wiemspro.com/wiemspro/api/dispositivos/getClienteSimple',
                         headers=h, verify=False, timeout=60)
        d = r.json()
        return d.get('clientes', [])
    # Modo dump
    return json.load(open(NF_DUMP, 'r', encoding='utf-8')).get('clientes', [])


clientes = get_clientes_nf()
print(f'Clientes NoofitPro: {len(clientes)}')

# IDs de inactivos
inactivos = [str(c['id']) for c in clientes if c.get('enabled') is False]
print(f'Inactivos (enabled=False): {len(inactivos)}')

# Conectar Odoo
o = OdooAlta(); o._connect()

# Mapping idnoofit → partner_id
partners = o._call('res.partner', 'search_read',
    [('id_noofit', 'in', inactivos)], ['id', 'name', 'id_noofit'])
print(f'Partners Odoo encontrados (de los inactivos): {len(partners)}')

partner_ids = [p['id'] for p in partners]
if not partner_ids:
    print('No hay partners en Odoo a los que cancelar subs.')
    exit()

subs = o._call('round.subscription', 'search_read',
    [('partner_id', 'in', partner_ids), ('estado', '=', 'activa'),
     ('company_id', '=', COMPANY_ID)],
    ['id', 'partner_id', 'cuota_id', 'estado'])
print(f'Subs activas a cancelar: {len(subs)}')

if not subs:
    print('Nada que cancelar.')
    exit()

if not CONFIRM:
    print('\n[DRY-RUN] Sample 5:')
    for s in subs[:5]:
        cuota = s.get('cuota_id', [None, '?'])[1] if s.get('cuota_id') else '?'
        print(f'  sub id={s["id"]} partner={s["partner_id"][1]} cuota={cuota}')
    print('\nCONFIRM=1 para aplicar.')
    exit()

# Aplicar
hoy = datetime.date.today().isoformat()
sub_ids = [s['id'] for s in subs]
o._call('round.subscription', 'write', [sub_ids],
    {'fecha_fin': hoy, 'estado': 'cancelada'})

# Audit log
with get_conn() as conn, conn.cursor() as cur:
    for s in subs:
        cur.execute("""
            INSERT INTO accion_log
              (id_manager, actor_kind, actor_label, entidad, entidad_id, accion, resumen)
            VALUES (%s, 'cron', 'sync_nf_subs', 'subscription', %s, 'cancel',
                    %s)
        """, ('17677', str(s['id']),
              f'Cancelada por cron — cliente NF inactivo (partner_id={s["partner_id"][0]})'))

print(f'\n✓ {len(sub_ids)} subs canceladas.')
