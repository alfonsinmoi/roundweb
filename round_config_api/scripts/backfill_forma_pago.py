"""Backfill forma_pago_cliente desde dump GestPlus.

Lee dump GP. Para cada cliente con NoofitPro id resuelto, mira el campo
_pagador_formaPago y mapea:
  'B' (banco) o 'D' (domiciliado) → sepa (con IBAN si existe)
  'T' (tarjeta) → tarjeta_token
  'E' (efectivo) o 'C' (caja) → efectivo

Idempotente: si cliente ya tiene forma activa, salta.
"""
import os, sys, json, re, unicodedata
sys.path.insert(0, '/opt/round_config_api')
from app.db import get_conn

CONFIRM = os.getenv('CONFIRM') == '1'
ID_MANAGER = '17677'

GP = '/opt/round_config_api/gestplus_dump_2026-05-08.json'
NF = '/opt/round_config_api/noofit_clientes_dump.json'

MAPPING = {
    'B': 'sepa', 'D': 'sepa',
    'T': 'tarjeta_token',
    'E': 'efectivo', 'C': 'efectivo',
}


def strip_accents(s):
    return ''.join(c for c in unicodedata.normalize('NFD', str(s or '')) if unicodedata.category(c) != 'Mn')
def norm_dni(d): return re.sub(r'[^A-Z0-9]', '', strip_accents(str(d or '')).upper())
def norm_email(e): return (e or '').strip().lower()


gp = json.load(open(GP, 'r', encoding='utf-8'))
nf = json.load(open(NF, 'r', encoding='utf-8'))

nf_by_dni = {}; nf_by_email = {}
for c in nf.get('clientes', []):
    d = norm_dni(c.get('dni') or c.get('nif'))
    if d and len(d) >= 7: nf_by_dni.setdefault(d, c)
    e = norm_email(c.get('email'))
    if e and '@' in e: nf_by_email.setdefault(e, c)

# Forma de pago activa actual por cliente
with get_conn() as conn, conn.cursor() as cur:
    cur.execute("""SELECT cliente_idnoofit FROM forma_pago_cliente
                    WHERE id_manager=%s AND estado='activa'""", (ID_MANAGER,))
    ya_tienen = {r['cliente_idnoofit'] for r in cur.fetchall()}
print(f'Clientes con forma_pago activa: {len(ya_tienen)}')


to_create = []
sin_match = 0
sin_codigo = 0

for cli in (gp.get('altas') or []) + (gp.get('bajas_recientes_12m') or []):
    # Solo activos en GP
    if cli.get('estado') != 1: continue
    fp_code = cli.get('_pagador_formaPago') or 'C'
    forma = MAPPING.get(fp_code, 'efectivo')

    # Resolver NF id
    nfm = None
    for k in ('dni', 'dniContr'):
        d = norm_dni(cli.get(k))
        if d and len(d) >= 7 and d in nf_by_dni:
            nfm = nf_by_dni[d]; break
    if not nfm:
        e = norm_email(cli.get('email'))
        if e in nf_by_email: nfm = nf_by_email[e]
    if not nfm:
        sin_match += 1
        continue
    idnoofit = str(nfm['id'])
    if idnoofit in ya_tienen:
        continue

    iban = cli.get('_iban') or ''
    if iban.startswith('ES000'): iban = ''
    to_create.append({
        'cliente_idnoofit': idnoofit,
        'cliente_nombre': f"{cli.get('nombre','')} {cli.get('apellidos','')}".strip(),
        'forma_pago': forma,
        'iban': iban or None,
        'iban_titular': None, 'bic': None,
        'mandate_ref': None,
        'card_token': None, 'card_brand': None, 'card_last4': None,
        'fecha_inicio': '2026-01-01',
        'motivo_cambio': 'Backfill desde GestPlus',
    })

print(f'\nA crear: {len(to_create)}')
print(f'Sin match NF:  {sin_match}')
from collections import Counter
dist = Counter(r['forma_pago'] for r in to_create)
print(f'Distribución: {dict(dist)}')

if not CONFIRM:
    print('\n[DRY-RUN] CONFIRM=1 para aplicar')
    exit()

inserted = 0
errors = 0
with get_conn() as conn, conn.cursor() as cur:
    for r in to_create:
        try:
            cur.execute("""
                INSERT INTO forma_pago_cliente
                  (id_manager, cliente_idnoofit, forma_pago, iban,
                   estado, fecha_inicio, motivo_cambio, created_by, updated_by)
                VALUES (%s, %s, %s, %s, 'activa', %s, %s, 'backfill', 'backfill')
            """, (ID_MANAGER, r['cliente_idnoofit'], r['forma_pago'], r['iban'],
                  r['fecha_inicio'], r['motivo_cambio']))
            inserted += 1
        except Exception as e:
            errors += 1
            print(f'  ⚠ {r["cliente_idnoofit"]}: {e}')
            if errors > 5: break

print(f'\n✓ Insertadas: {inserted}  Errores: {errors}')
