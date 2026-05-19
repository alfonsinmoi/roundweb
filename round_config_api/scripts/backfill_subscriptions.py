"""Backfill round.subscription para los clientes con recibos 2026 GP.

Para cada cliente:
  - Lee sus recibos 2026 del dump GP
  - Agrupa por mapping de codcur → cuota Odoo:
      RT 1D...      → cuota id=1 (RT 1D)
      RT LX/MJ...   → cuota id=5 (RT 2 dias 52.5€)
      I MYGYM...    → cuota id=2 (I MYGYM)
  - Por cada cuota detectada del cliente, crea 1 round.subscription:
      partner_id, cuota_id, periodicidad (inferida), forma_pago (sepa/efectivo),
      fecha_inicio (primer recibo de esa cuota), estado='activa'
  - Si ya existe subscription para (partner, cuota) → la skipea (idempotente)

Modo: CONFIRM=1 para aplicar; default dry-run.
Manager: COMPANY_ID=3.
"""
import os, sys, json, re, unicodedata
from datetime import datetime
from collections import defaultdict, Counter
sys.path.insert(0, '/opt/round_config_api')
from app.odoo_alta import OdooAlta

GP = '/opt/round_config_api/gestplus_dump_2026-05-08.json'
NF = '/opt/round_config_api/noofit_clientes_dump.json'
COMPANY_ID = int(os.getenv('ODOO_COMPANY', '3'))
CONFIRM = os.getenv('CONFIRM') == '1'
TARGET_YEAR = 2026

# Mapping codcur GP → cuota Odoo
def mapear_cuota(codcur):
    if not codcur: return None
    c = codcur.upper().strip()
    if c.startswith('RT 1D'):    return ('RT 1D',      1)
    if c.startswith('RT LX'):    return ('RT 2 dias',  5)
    if c.startswith('RT MJ'):    return ('RT 2 dias',  5)
    if c.startswith('I MYGYM'):  return ('I MYGYM',    2)
    return None


def parse_date(s):
    if not s: return None
    try: return datetime.fromisoformat(str(s).replace('Z','')).date()
    except Exception:
        try: return datetime.strptime(str(s)[:10], '%Y-%m-%d').date()
        except Exception: return None

def detectar_periodicidad(fd, fh):
    if not fd or not fh: return 'mensual'
    dias = (fh - fd).days + 1
    if 25 <= dias <= 35: return 'mensual'
    if 80 <= dias <= 100: return 'trimestral'
    if 150 <= dias <= 200: return 'semestral'
    if 300 <= dias <= 400: return 'anual'
    return 'mensual'

def strip_accents(s):
    return ''.join(c for c in unicodedata.normalize('NFD', str(s or '')) if unicodedata.category(c) != 'Mn')
def norm_dni(d): return re.sub(r'[^A-Z0-9]', '', strip_accents(str(d or '')).upper())
def norm_email(e): return (e or '').strip().lower()


# ─── Cargar dumps ────────────────────────────────────────────────────────────
gp = json.load(open(GP, 'r', encoding='utf-8'))
nf = json.load(open(NF, 'r', encoding='utf-8'))
nf_clientes = nf.get('clientes', [])
nf_by_dni = {}
nf_by_email = {}
for c in nf_clientes:
    d = norm_dni(c.get('dni') or c.get('nif'))
    if d and len(d) >= 7: nf_by_dni.setdefault(d, c)
    e = norm_email(c.get('email'))
    if e and '@' in e: nf_by_email.setdefault(e, c)


# ─── Conectar Odoo ───────────────────────────────────────────────────────────
oa = OdooAlta(); oa._connect()
print(f'Odoo uid={oa._uid} (company {COMPANY_ID})')


# Cargar subscriptions existentes (idempotencia)
existing_subs = oa._call('round.subscription', 'search_read',
    [('company_id', '=', COMPANY_ID)],
    ['id', 'partner_id', 'cuota_id', 'estado'])
exist_by_partner_cuota = set()
for s in existing_subs:
    pid = s['partner_id'][0] if s['partner_id'] else None
    cid = s['cuota_id'][0] if s['cuota_id'] else None
    if pid and cid:
        exist_by_partner_cuota.add((pid, cid))
print(f'Subscriptions ya existentes: {len(existing_subs)}')


# Cliente NoofitPro id → Odoo partner_id
def odoo_partner_for_idnoofit(idnoofit):
    ids = oa._call('res.partner', 'search',
        [('id_noofit', '=', str(idnoofit)), ('company_id', '=', COMPANY_ID)], limit=1)
    if not ids:
        # fallback: busca cualquier company
        ids = oa._call('res.partner', 'search',
            [('id_noofit', '=', str(idnoofit))], limit=1)
    return ids[0] if ids else None


# ─── Iterar clientes GP ──────────────────────────────────────────────────────
gp_clientes = (gp.get('altas') or []) + (gp.get('bajas_recientes_12m') or [])

por_partner = defaultdict(lambda: defaultdict(list))   # {partner_id: {cuota_id: [recibos]}}

for cli in gp_clientes:
    # Resolver Odoo partner via NoofitPro
    nfm = None
    for k in ('dni', 'dniContr'):
        d = norm_dni(cli.get(k))
        if d and len(d) >= 7 and d in nf_by_dni:
            nfm = nf_by_dni[d]; break
    if not nfm:
        e = norm_email(cli.get('email'))
        if e in nf_by_email: nfm = nf_by_email[e]
    if not nfm: continue

    odoo_pid = odoo_partner_for_idnoofit(nfm['id'])
    if not odoo_pid: continue

    # Recoger recibos 2026 con codcur válido y agrupar por cuota
    for r in cli.get('_recibos', []):
        fd = parse_date(r.get('fechaDesde'))
        if not fd or fd.year != TARGET_YEAR: continue
        if (r.get('importeFinal') or 0) <= 0: continue   # excluir importes inválidos
        m = mapear_cuota(r.get('codcur'))
        if not m: continue
        _, cuota_id = m
        por_partner[odoo_pid][cuota_id].append({
            **r, '_fd': fd, '_fh': parse_date(r.get('fechaHasta')),
            '_cli': cli, '_nfm': nfm,
        })


# Construir subscriptions a crear
to_create = []
already = 0
for pid, cuotas in por_partner.items():
    for cuota_id, recibos in cuotas.items():
        if (pid, cuota_id) in exist_by_partner_cuota:
            already += 1
            continue
        # Calcular datos
        recibos_ord = sorted(recibos, key=lambda r: r['_fd'])
        primer = recibos_ord[0]
        ultimo = recibos_ord[-1]
        # Periodicidad dominante (entre los recibos del cliente para esa cuota)
        per_counts = Counter(detectar_periodicidad(r['_fd'], r['_fh']) for r in recibos_ord)
        periodicidad = per_counts.most_common(1)[0][0]
        # Forma de pago: si hay algún recibo con importeBanco>0 → sepa, sino efectivo
        algun_banco = any((r.get('importeBanco') or 0) > 0 for r in recibos_ord)
        forma_pago = 'sepa' if algun_banco else 'efectivo'
        # Estado: si cliente activo → activa, si baja → cancelada
        cli = primer['_cli']
        cli_activo = cli.get('estado') == 1
        estado = 'activa' if cli_activo else 'cancelada'
        # Fechas
        fecha_inicio = primer['_fd'].isoformat()
        fecha_fin = None
        if not cli_activo and cli.get('fechaBaja'):
            fecha_fin = (cli.get('fechaBaja') or '')[:10]
        elif not cli_activo:
            fecha_fin = ultimo['_fh'].isoformat() if ultimo['_fh'] else fecha_inicio

        to_create.append({
            'partner_id': pid,
            'cuota_id': cuota_id,
            'fecha_inicio': fecha_inicio,
            'fecha_fin': fecha_fin,
            'periodicidad': periodicidad,
            'forma_pago': forma_pago,
            'estado': estado,
            'company_id': COMPANY_ID,
        })

print(f'\nPartners únicos: {len(por_partner)}')
print(f'Subscriptions a crear: {len(to_create)}')
print(f'Ya existentes (skip): {already}')

# Distribución
dist_cuota = Counter(s['cuota_id'] for s in to_create)
print(f'\nPor cuota:')
for cid, n in dist_cuota.most_common():
    print(f'  cuota_id={cid}: {n}')
dist_per = Counter(s['periodicidad'] for s in to_create)
print(f'\nPor periodicidad: {dict(dist_per)}')
dist_pay = Counter(s['forma_pago'] for s in to_create)
print(f'Por forma_pago: {dict(dist_pay)}')

if not CONFIRM:
    print('\n[DRY-RUN] Sample 5:')
    for s in to_create[:5]:
        print(f'  {s}')
    print('\nCONFIRM=1 para aplicar.')
    exit()

# APLICAR
print('\n=== APLICANDO ===')
created = 0
errors = 0
for s in to_create:
    try:
        sid = oa._call('round.subscription', 'create', s)
        created += 1
    except Exception as e:
        errors += 1
        print(f'  ⚠ partner={s["partner_id"]} cuota={s["cuota_id"]}: {e}')
        if errors > 5:
            print('  ... abortando')
            break

print(f'\n✓ Creadas: {created}  Errores: {errors}')
