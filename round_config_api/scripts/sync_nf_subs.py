"""Sync NoofitPro → round.subscription Odoo (bidireccional).

Regla (ago 2026): un cliente inactivo/pausado NUNCA pierde su suscripción.
  - cliente con enabled=False → PAUSA sus subs activas (estado='suspendida').
  - cliente con enabled=True  → REACTIVA sus subs suspendidas (→ 'activa').
Así, al volver un cliente (fin de pausa temporal, reactivación en NF), su
cuota se recupera sola. (Antes se CANCELABA y el cliente quedaba sin cuota
al reactivarse — caso Emilio Vílchez, jul 2026.)

Itera TODOS los managers activos (manager_config) y todos sus trainers
(trainer_noofit_creds) para obtener una lista completa de clientes. Cada
manager/trainer en NoofitPro tiene su propio espacio de clientes; sin
iterar nos perdemos los clientes que pertenecen al espacio del trainer
hijo y no del manager parent.

Idempotente en ambos sentidos. La reactivación respeta el índice único
(partner, cuota) WHERE estado='activa': no reactiva una suspendida si ya
hay otra activa de la misma cuota.

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

# IDs por estado NoofitPro
inactivos = [str(c['id']) for c in clientes if c.get('enabled') is False]
activos   = [str(c['id']) for c in clientes if c.get('enabled') is True]
print(f'Inactivos (enabled=False): {len(inactivos)}  ·  Activos (enabled=True): {len(activos)}')

# Conectar Odoo
o = OdooAlta(); o._connect()


def _partner_ids_de(idnoofits):
    if not idnoofits:
        return []
    ps = o._call('res.partner', 'search_read',
                 [('id_noofit', 'in', idnoofits)], ['id']) or []
    return [p['id'] for p in ps]


# ── 1) Clientes INACTIVOS → PAUSAR sus subs activas (estado='suspendida') ─────
# Regla (ago 2026): NUNCA cancelar. Se pausa para conservar la suscripción;
# al reactivarse el cliente (pass 2) se devuelve a 'activa'. Esto evita que un
# cliente en pausa temporal / archivado pierda su cuota para siempre (caso
# Emilio Vílchez: la pausa de julio archivó al cliente y el cron canceló sus
# 4 subs → al volver, quedó sin cuota).
pausar_pids = _partner_ids_de(inactivos)
subs_pausar = o._call('round.subscription', 'search_read',
    [('partner_id', 'in', pausar_pids), ('estado', '=', 'activa'),
     ('company_id', '=', COMPANY_ID)],
    ['id', 'partner_id', 'cuota_id']) if pausar_pids else []
print(f'Subs a PAUSAR (activa→suspendida): {len(subs_pausar)}')

# ── 2) Clientes ACTIVOS → REACTIVAR sus subs suspendidas (suspendida→activa) ──
# Reconciliador general: cualquier cliente que vuelva a estar enabled=True en
# NoofitPro recupera automáticamente su suscripción. Respeta el índice único
# (partner, cuota) WHERE activa: si ya hay otra sub activa de esa cuota, la
# suspendida no se reactiva.
react_pids = _partner_ids_de(activos)
subs_susp = o._call('round.subscription', 'search_read',
    [('partner_id', 'in', react_pids), ('estado', '=', 'suspendida'),
     ('company_id', '=', COMPANY_ID)],
    ['id', 'partner_id', 'cuota_id']) if react_pids else []
# (partner, cuota) que YA tienen una activa → no reactivar duplicado
subs_act = o._call('round.subscription', 'search_read',
    [('partner_id', 'in', react_pids), ('estado', '=', 'activa'),
     ('company_id', '=', COMPANY_ID)],
    ['partner_id', 'cuota_id']) if react_pids else []
ya_activa = {(a['partner_id'][0], a['cuota_id'][0]) for a in subs_act
             if a.get('partner_id') and a.get('cuota_id')}
subs_reactivar = [s for s in subs_susp
                  if not (s.get('partner_id') and s.get('cuota_id')
                          and (s['partner_id'][0], s['cuota_id'][0]) in ya_activa)]
print(f'Subs a REACTIVAR (suspendida→activa): {len(subs_reactivar)}')

if not subs_pausar and not subs_reactivar:
    print('Nada que pausar ni reactivar.')
    exit()

if not CONFIRM:
    print('\n[DRY-RUN] Pausar (sample 5):')
    for s in subs_pausar[:5]:
        cuota = s.get('cuota_id', [None, '?'])[1] if s.get('cuota_id') else '?'
        print(f'  sub id={s["id"]} partner={s["partner_id"][1]} cuota={cuota}')
    print('[DRY-RUN] Reactivar (sample 5):')
    for s in subs_reactivar[:5]:
        cuota = s.get('cuota_id', [None, '?'])[1] if s.get('cuota_id') else '?'
        print(f'  sub id={s["id"]} partner={s["partner_id"][1]} cuota={cuota}')
    print('\nCONFIRM=1 para aplicar.')
    exit()

# Aplicar. NOTA _call(model,'write',ids,vals) espera la LISTA de ids directa
# (convención odoo_alta). NO envolver en otra lista (rompía con "unhashable
# type: list").
if subs_pausar:
    o._call('round.subscription', 'write', [s['id'] for s in subs_pausar],
            {'estado': 'suspendida'})
if subs_reactivar:
    o._call('round.subscription', 'write', [s['id'] for s in subs_reactivar],
            {'estado': 'activa'})

# Audit log
with get_conn() as conn, conn.cursor() as cur:
    cur.execute("""SELECT id_manager FROM manager_config
                    WHERE activo=TRUE ORDER BY id_manager LIMIT 1""")
    row = cur.fetchone()
    actor_mgr = str(row['id_manager']) if row else ''
    for s in subs_pausar:
        cur.execute("""
            INSERT INTO accion_log
              (id_manager, actor_kind, actor_label, entidad, entidad_id, accion, resumen)
            VALUES (%s, 'cron', 'sync_nf_subs', 'subscription', %s, 'pausar', %s)
        """, (actor_mgr, str(s['id']),
              f'Pausada por cron — cliente NF inactivo (partner_id={s["partner_id"][0]})'))
    for s in subs_reactivar:
        cur.execute("""
            INSERT INTO accion_log
              (id_manager, actor_kind, actor_label, entidad, entidad_id, accion, resumen)
            VALUES (%s, 'cron', 'sync_nf_subs', 'subscription', %s, 'reactivar', %s)
        """, (actor_mgr, str(s['id']),
              f'Reactivada por cron — cliente NF activo de nuevo (partner_id={s["partner_id"][0]})'))

print(f'\n✓ {len(subs_pausar)} subs pausadas · {len(subs_reactivar)} subs reactivadas.')
