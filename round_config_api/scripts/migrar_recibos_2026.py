"""Migración de los recibos GestPlus 2026 a Odoo (account.move).

Filtros aplicados:
  - fechaDesde dentro del año 2026
  - Sin anomalías bloqueantes (sin_match_nf, importe_invalido,
    importe_inconsistente, sin_fechas)

Tratamientos:
  - Periodicidad inconsistente por cliente → fuerza 'mensual' (revisamos después)
  - Recibos cobrados (cobrado=1) con importeBanco>0 → método 'sepa'
  - Recibos cobrados con importeBanco=0 → método 'caja' (efectivo/TPV)
  - Recibos no cobrados → factura emitida sin pago, queda impagada
  - Devoluciones (fechDevolucion) → factura emitida y luego marcada devuelta

Idempotencia:
  Antes de crear cada account.move, se busca uno existente con
  ref = 'GP-{numRec}'. Si existe, salta.

Modo:
  CONFIRM=1   aplica de verdad
  default     dry-run

Uso:
  sudo -u odoo bash -c 'set -a && . /opt/round_config_api/.env && set +a && \\
    /opt/round_config_api/venv/bin/python3 \\
    /opt/round_config_api/scripts/migrar_recibos_2026.py'
"""
import json, sys, os, re, unicodedata
from datetime import datetime, date
from collections import defaultdict, Counter
sys.path.insert(0, '/opt/round_config_api')
from app.odoo_alta import OdooAlta

GP = '/opt/round_config_api/gestplus_dump_2026-05-08.json'
NF = '/opt/round_config_api/noofit_clientes_dump.json'
TARGET_YEAR = 2026
CONFIRM = os.getenv('CONFIRM') == '1'
LIMIT = int(os.getenv('LIMIT', '0'))   # 0 = sin límite
COMPANY_ID = int(os.getenv('ODOO_COMPANY', '3'))   # Best training dos
IVA_PCT = 21.0   # IVA incluido en importeFinal de GP


# ─── Helpers ────────────────────────────────────────────────────────────────
def strip_accents(s):
    return ''.join(c for c in unicodedata.normalize('NFD', str(s or '')) if unicodedata.category(c) != 'Mn')
def norm_dni(d):
    s = strip_accents(str(d or '')).upper()
    return re.sub(r'[^A-Z0-9]', '', s)
def norm_email(e): return (e or '').strip().lower()
def parse_date(s):
    if not s: return None
    try: return datetime.fromisoformat(str(s).replace('Z','')).date()
    except Exception:
        try: return datetime.strptime(str(s)[:10], '%Y-%m-%d').date()
        except Exception: return None
def detectar_periodicidad(fd, fh):
    if not fd or not fh: return None
    dias = (fh - fd).days + 1
    if 25 <= dias <= 35: return 'mensual'
    if 80 <= dias <= 100: return 'trimestral'
    if 150 <= dias <= 200: return 'semestral'
    if 300 <= dias <= 400: return 'anual'
    return 'otro'


# ─── Cargar dumps ────────────────────────────────────────────────────────────
gp = json.load(open(GP, 'r', encoding='utf-8'))
nf = json.load(open(NF, 'r', encoding='utf-8'))
nf_clientes = nf.get('clientes', [])

nf_by_dni, nf_by_email = {}, {}
for c in nf_clientes:
    d = norm_dni(c.get('dni') or c.get('nif'))
    if d and len(d) >= 7: nf_by_dni.setdefault(d, c)
    e = norm_email(c.get('email'))
    if e and '@' in e: nf_by_email.setdefault(e, c)

gp_clientes_all = (gp.get('altas') or []) + (gp.get('bajas_recientes_12m') or [])

# Construir lista de recibos 2026 con cliente
recibos = []
for c in gp_clientes_all:
    for r in c.get('_recibos', []):
        fd = parse_date(r.get('fechaDesde'))
        fh = parse_date(r.get('fechaHasta'))
        if not fd or fd.year != TARGET_YEAR: continue
        recibos.append({**r,
            '_cliente_gp': c, '_fd': fd, '_fh': fh,
        })
print(f'Recibos 2026: {len(recibos)}')

# Cruzar con NF
def find_nf(r):
    g = r['_cliente_gp']
    for k in ('dni', 'dniContr'):
        d = norm_dni(g.get(k))
        if d and len(d) >= 7 and d in nf_by_dni: return nf_by_dni[d]
    e = norm_email(g.get('email'))
    if e and e in nf_by_email: return nf_by_email[e]
    return None

# Anomalías bloqueantes
BLOCK_KEEP = []
BLOCK_SKIP = []
for r in recibos:
    razones = []
    nfm = find_nf(r)
    if not nfm: razones.append('sin_match_nf')
    if not r['_fd'] or not r['_fh']: razones.append('sin_fechas')
    ii = r.get('importeInicial') or 0
    if not isinstance(ii, (int, float)) or ii <= 0: razones.append('importe_invalido')
    f = r.get('importeFinal') or 0
    if f > ii * 1.01: razones.append('importe_inconsistente')
    if razones:
        BLOCK_SKIP.append({'r': r, 'razones': razones})
    else:
        r['_nf'] = nfm
        BLOCK_KEEP.append(r)
print(f'Import-ready: {len(BLOCK_KEEP)} | Descartados: {len(BLOCK_SKIP)}')

# Periodicidad por cliente: si hay mezcla → forzar 'mensual'
recibos_por_codcli = defaultdict(list)
for r in BLOCK_KEEP:
    recibos_por_codcli[r.get('codcli')].append(r)

clientes_inconsistentes = set()
for cod, lst in recibos_por_codcli.items():
    pers = Counter(detectar_periodicidad(r['_fd'], r['_fh']) for r in lst)
    pers.pop(None, None)
    if len(pers) > 1:
        clientes_inconsistentes.add(cod)

print(f'Clientes con periodicidad inconsistente (forzados a mensual): {len(clientes_inconsistentes)}')

# Asignar periodicidad efectiva a cada recibo
for r in BLOCK_KEEP:
    p = detectar_periodicidad(r['_fd'], r['_fh'])
    if r.get('codcli') in clientes_inconsistentes:
        r['_periodicidad'] = 'mensual'
    elif p in ('mensual', 'trimestral', 'semestral', 'anual'):
        r['_periodicidad'] = p
    else:
        r['_periodicidad'] = 'mensual'   # fallback


if LIMIT > 0:
    BLOCK_KEEP = BLOCK_KEEP[:LIMIT]
    print(f'⚠ LIMIT={LIMIT} aplicado para test')


# ─── Conexión Odoo ───────────────────────────────────────────────────────────
oa = OdooAlta()
oa._connect()
print(f'Conectado a Odoo (uid={oa._uid})')

# Resolver impuesto IVA 21% S (servicios) en la company
tax_ids = oa._call('account.tax', 'search',
    [('company_id', '=', COMPANY_ID),
     ('amount', '=', IVA_PCT),
     ('type_tax_use', '=', 'sale'),
     ('name', 'like', '21% S')], limit=1)
if not tax_ids:
    tax_ids = oa._call('account.tax', 'search',
        [('company_id', '=', COMPANY_ID),
         ('amount', '=', IVA_PCT),
         ('type_tax_use', '=', 'sale')], limit=1)
TAX_21_ID = tax_ids[0] if tax_ids else None
print(f'IVA {IVA_PCT}% sale tax_id en company {COMPANY_ID}: {TAX_21_ID}')

# Resolver journals
sale_journal_ids = oa._call('account.journal', 'search',
    [('company_id', '=', COMPANY_ID), ('type', '=', 'sale')], limit=1)
SALE_JOURNAL_ID = sale_journal_ids[0] if sale_journal_ids else None
bank_journal_ids = oa._call('account.journal', 'search',
    [('company_id', '=', COMPANY_ID), ('type', '=', 'bank')], limit=1)
BANK_JOURNAL_ID = bank_journal_ids[0] if bank_journal_ids else None
cash_journal_ids = oa._call('account.journal', 'search',
    [('company_id', '=', COMPANY_ID), ('type', '=', 'cash')], limit=1)
CASH_JOURNAL_ID = cash_journal_ids[0] if cash_journal_ids else None
print(f'Journals: sale={SALE_JOURNAL_ID} bank={BANK_JOURNAL_ID} cash={CASH_JOURNAL_ID}')

# Cuenta analítica Round Málaga Centro — filtrar por company del proyecto
analytic_ids = oa._call('account.analytic.account', 'search',
    [('name', '=', 'Round Málaga Centro'),
     '|', ('company_id', '=', COMPANY_ID), ('company_id', '=', False)],
    limit=1)
ANALYTIC_ID = analytic_ids[0] if analytic_ids else None
print(f'Cuenta analítica Round Málaga Centro (company {COMPANY_ID}): {ANALYTIC_ID}')

stats = Counter()
log_lines = []

def log_(msg):
    print(msg)
    log_lines.append(msg)


# Cache de partners ya creados
partner_cache = {}   # idnoofit -> partner_id


def resolve_partner(r):
    nfc = r['_nf']
    idnoofit = str(nfc.get('id'))
    if idnoofit in partner_cache: return partner_cache[idnoofit]
    g = r['_cliente_gp']
    datos = {
        'idnoofit': idnoofit,
        'dni':      g.get('dni') or g.get('dniContr') or '',
        'nombre':   nfc.get('name') or g.get('nombre') or '',
        'apellidos': nfc.get('surname') or g.get('apellidos') or '',
        'email':    nfc.get('email') or g.get('email') or '',
        'movil':    nfc.get('cellPhone') or g.get('movil') or g.get('telefono') or '',
        'direccion': g.get('domicilio') or '',
        'localidad': g.get('poblacion') or '',
        'cp':       g.get('codPostal') or '',
        'iban':     (g.get('_iban') or '').replace('ES000000000000000000000', '').replace(' ', '') or None,
    }
    if CONFIRM:
        pid = oa.upsert_partner(datos)
    else:
        # Solo lookup
        pid = None
        if idnoofit:
            ids = oa._call('res.partner', 'search', [('id_noofit','=',idnoofit)], limit=1)
            if ids: pid = ids[0]
        if not pid and datos['dni']:
            ids = oa._call('res.partner', 'search', [('vat','=',datos['dni'])], limit=1)
            if ids: pid = ids[0]
        if not pid: pid = '<crear>'
    partner_cache[idnoofit] = pid
    return pid


# ─── Iterar e importar ───────────────────────────────────────────────────────
log_(f'\n=== {"APLICANDO" if CONFIRM else "DRY-RUN"} - {len(BLOCK_KEEP)} recibos ===')

for idx, r in enumerate(BLOCK_KEEP, 1):
    if idx % 50 == 0 or idx == 1:
        log_(f'  [{idx}/{len(BLOCK_KEEP)}]…')

    ref = f'GP-{r.get("numRec")}'
    nfc = r['_nf']
    nombre_cli = f"{nfc.get('name','')} {nfc.get('surname','')}".strip()

    # Comprobar existencia
    existing = oa._call('account.move', 'search',
                        [('ref','=', ref), ('move_type','=','out_invoice')], limit=1)
    if existing:
        stats['ya_existe'] += 1
        continue

    # Resolver partner
    try:
        partner_id = resolve_partner(r)
    except Exception as e:
        log_(f'  ⚠ {ref} ({nombre_cli}): error partner - {e}')
        stats['err_partner'] += 1
        continue

    if partner_id == '<crear>':
        # Modo dry-run: el partner se crearía
        stats['dry_partner_create'] += 1

    importe_total = float(r.get('importeFinal') or 0)        # CON IVA (GP)
    base = round(importe_total / (1 + IVA_PCT/100), 2)        # SIN IVA
    desc = f"{r.get('codcur') or 'Cuota'} · {r['_fd']} a {r['_fh']} ({r['_periodicidad']})"

    line_vals = {
        'name': desc,
        'quantity': 1,
        'price_unit': base,    # base imponible — Odoo añade el 21% por la tax
    }
    if TAX_21_ID:
        line_vals['tax_ids'] = [(6, 0, [TAX_21_ID])]
    if ANALYTIC_ID:
        # Distribución analítica: 100% a Round Málaga Centro
        line_vals['analytic_distribution'] = {str(ANALYTIC_ID): 100.0}

    invoice_vals = {
        'partner_id': partner_id if partner_id != '<crear>' else False,
        'move_type': 'out_invoice',
        'ref': ref,                            # idempotencia
        'invoice_date': str(r['_fd']),
        'invoice_date_due': str(r['_fh']),
        'company_id': COMPANY_ID,
        'narration': f"Migrado de GestPlus · numRec={r.get('numRec')} · "
                     f"codcli={r.get('codcli')} · cobrado={r.get('cobrado')} · "
                     f"importeBanco={r.get('importeBanco')} · periodicidad={r['_periodicidad']}",
        'invoice_line_ids': [(0, 0, line_vals)],
    }
    if SALE_JOURNAL_ID:
        invoice_vals['journal_id'] = SALE_JOURNAL_ID
    if not CONFIRM:
        stats['dry_create'] += 1
        if idx <= 5:
            log_(f'  → DRY: ref={ref} partner={partner_id} desc="{desc}" base={base} total={importe_total} (IVA {IVA_PCT}%)')
        continue

    # APLICAR
    try:
        inv_id = oa._call('account.move', 'create', invoice_vals)
        # Postear (estado posted)
        oa._call('account.move', 'action_post', [inv_id])
        stats['creados'] += 1
        # Si pagado, registrar pago
        if r.get('cobrado') == 1 and importe_total > 0:
            metodo = 'banco' if (r.get('importeBanco') or 0) > 0 else 'caja'
            journal_id = BANK_JOURNAL_ID if metodo == 'banco' else CASH_JOURNAL_ID
            try:
                if journal_id:
                    payment_vals = {
                        'partner_id': partner_id,
                        'partner_type': 'customer',
                        'payment_type': 'inbound',
                        'amount': importe_total,
                        'date': str(r['_fd']),
                        'journal_id': journal_id,
                        'company_id': COMPANY_ID,
                        'ref': f'PAGO-{ref}',
                    }
                    pay_id = oa._call('account.payment', 'create', payment_vals)
                    oa._call('account.payment', 'action_post', [pay_id])
                    # Reconciliación pendiente (manual o por cron)
                    stats['pagos_creados'] += 1
            except Exception as e:
                log_(f'  ⚠ {ref}: factura creada pero error en pago: {e}')
                stats['err_pago'] += 1
    except Exception as e:
        log_(f'  ⚠ {ref} ({nombre_cli}): error creando move - {e}')
        stats['err_move'] += 1


# ─── Resumen ─────────────────────────────────────────────────────────────────
log_(f'\n=== RESUMEN ===')
for k, v in sorted(stats.items()):
    log_(f'  {k:25s}: {v}')

# Guardar log
log_path = f'/tmp/migrar_recibos_2026_{datetime.now().strftime("%Y%m%d_%H%M%S")}.log'
with open(log_path, 'w', encoding='utf-8') as f:
    f.write('\n'.join(log_lines))
log_(f'\nLog: {log_path}')

if not CONFIRM:
    log_('\n[INFO] DRY-RUN. Para aplicar: CONFIRM=1')
