"""Sync NoofitPro → round.subscription Odoo.

Lee NoofitPro: para cada cliente con enabled=False, cancela TODAS sus
subscriptions activas en Odoo (fecha_fin=hoy, estado=cancelada).

Itera TODOS los managers activos (manager_config) y todos sus trainers
(trainer_noofit_creds) para obtener una lista completa de clientes. Cada
manager/trainer en NoofitPro tiene su propio espacio de clientes; sin
iterar nos perdemos los clientes que pertenecen al espacio del trainer
hijo y no del manager parent.

Idempotente: subs ya canceladas no se tocan.

Modo:
  CONFIRM=1 para aplicar
  default = dry-run
  USE_LIVE=1 → API en vivo (todos los managers/trainers)
  USE_LIVE!=1 → lee dump local
"""
import os, sys, json, urllib3, datetime
sys.path.insert(0, '/opt/round_config_api')
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
from app.db import get_conn
from app.odoo_alta import OdooAlta
from app import noofit_client as nc

CONFIRM = os.getenv('CONFIRM') == '1'
COMPANY_ID = int(os.getenv('ODOO_COMPANY', '3'))
NF_DUMP = os.getenv('NF_DUMP', '/opt/round_config_api/noofit_clientes_dump.json')
USE_LIVE = os.getenv('USE_LIVE') == '1'  # si true, llama API en vivo


def get_clientes_nf():
    """Devuelve lista deduplicada de clientes NF (mezclando todos los
    managers activos + sus trainers con credenciales)."""
    if not USE_LIVE:
        return json.load(open(NF_DUMP, 'r', encoding='utf-8')).get('clientes', [])

    # 1) Managers activos
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT id_manager, noofit_email, noofit_password
                         FROM manager_config WHERE activo=TRUE""")
        managers = cur.fetchall()

    all_clientes = {}  # id_cliente → dict (el último gana, prevalece trainer)
    for m in managers:
        idm = str(m['id_manager'])
        # 1a) Como manager parent
        try:
            tok, mhdr = nc._login(m['noofit_email'], m['noofit_password'])
            r = nc._request_as(tok, mhdr, 'GET', '/api/dispositivos/getClienteSimple')
            r.raise_for_status()
            clis = ((r.json() or {}).get('clientes')) or []
            for c in clis:
                if c.get('id') is not None:
                    all_clientes[int(c['id'])] = c
            print(f'  manager {idm}: {len(clis)} clientes (parent)')
        except Exception as e:
            print(f'  manager {idm}: ERROR {e}')

        # 1b) Como cada trainer con credenciales
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""SELECT id_trainer, noofit_email, noofit_password
                             FROM trainer_noofit_creds
                            WHERE id_manager=%s AND activo=TRUE""", (idm,))
            trainers = cur.fetchall()
        for t in trainers:
            try:
                clis_t = nc.get_clientes_as_trainer(
                    t['noofit_email'], t['noofit_password']) or []
                for c in clis_t:
                    if c.get('id') is not None:
                        all_clientes[int(c['id'])] = c
                print(f'  trainer {t["id_trainer"]} ({idm}): {len(clis_t)} clientes')
            except Exception as e:
                print(f'  trainer {t["id_trainer"]} ({idm}): ERROR {e}')

    return list(all_clientes.values())


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

# Audit log: id_manager por suscripción (vía company → manager).
# Para simplicidad: usamos el primer manager activo como label, pero el
# resumen indica el partner_id real para trazabilidad.
with get_conn() as conn, conn.cursor() as cur:
    cur.execute("""SELECT id_manager FROM manager_config
                    WHERE activo=TRUE ORDER BY id_manager LIMIT 1""")
    row = cur.fetchone()
    actor_mgr = str(row['id_manager']) if row else ''
    for s in subs:
        cur.execute("""
            INSERT INTO accion_log
              (id_manager, actor_kind, actor_label, entidad, entidad_id, accion, resumen)
            VALUES (%s, 'cron', 'sync_nf_subs', 'subscription', %s, 'cancel',
                    %s)
        """, (actor_mgr, str(s['id']),
              f'Cancelada por cron — cliente NF inactivo (partner_id={s["partner_id"][0]})'))

print(f'\n✓ {len(sub_ids)} subs canceladas.')
