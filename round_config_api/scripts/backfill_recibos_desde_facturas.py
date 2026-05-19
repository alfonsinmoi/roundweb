"""Backfill: por cada account.move (out_invoice) creado por la migración GP,
crea una fila en `recibo` enlazada y en estado='facturado'.

Lee del dump GestPlus el numRec → encuentra la factura Odoo (ref='GP-X') →
encuentra los datos GP originales (codcli, fechas, importes, método) →
crea recibo en BD round_config.

Idempotente: salta los account.move que ya tienen recibo asociado.
Modo: CONFIRM=1 para aplicar; default dry-run.
"""
import os, sys, json
sys.path.insert(0, '/opt/round_config_api')
from datetime import datetime
from app.odoo_alta import OdooAlta
from app.db import get_conn

GP = '/opt/round_config_api/gestplus_dump_2026-05-08.json'
COMPANY_ID = int(os.getenv('ODOO_COMPANY', '3'))
CONFIRM = os.getenv('CONFIRM') == '1'
ID_MANAGER = '17677'    # corresponde a la sesión actual gestor
ID_TRAINER = None       # null = corporativo (los recibos son del manager, no de un trainer)


def parse_date(s):
    if not s: return None
    try: return datetime.fromisoformat(str(s).replace('Z','')).date()
    except Exception:
        try: return datetime.strptime(str(s)[:10], '%Y-%m-%d').date()
        except Exception: return None


# Cargar dump GP — index numRec → recibo + cliente
gp = json.load(open(GP, 'r', encoding='utf-8'))
recibos_by_numrec = {}
for c in (gp.get('altas') or []) + (gp.get('bajas_recientes_12m') or []):
    for r in c.get('_recibos', []):
        recibos_by_numrec[str(r.get('numRec'))] = {**r, '_cli': c}
print(f'Recibos GP indexados: {len(recibos_by_numrec)}')


# Conectar Odoo y traer facturas GP
oa = OdooAlta(); oa._connect()
print(f'Odoo uid={oa._uid}')

facturas = oa._call('account.move', 'search_read',
    [('ref', 'like', 'GP-%'), ('move_type', '=', 'out_invoice'),
     ('company_id', '=', COMPANY_ID)],
    ['id', 'name', 'ref', 'state', 'partner_id', 'amount_untaxed',
     'amount_tax', 'amount_total', 'invoice_date', 'invoice_date_due',
     'payment_state'])
print(f'Facturas GP en Odoo (company {COMPANY_ID}): {len(facturas)}')


def metodo_de(r):
    """Determina metodo_pago canónico desde el recibo GP."""
    cobrado = r.get('cobrado') == 1
    importeBanco = float(r.get('importeBanco') or 0)
    if cobrado and importeBanco > 0: return 'sepa'
    if cobrado and importeBanco == 0: return 'caja_efectivo'
    if r.get('fechDevolucion'): return 'sepa'   # devuelto = era sepa
    # No cobrado y sin información clara → asumir caja
    return 'caja_efectivo'


def estado_de(r):
    """Determina estado canónico (después de la migración: facturado)."""
    return 'facturado'   # todas estas facturas ya están posteadas en Odoo


# Cargar recibos ya importados (idempotencia)
with get_conn() as conn, conn.cursor() as cur:
    cur.execute("""SELECT origen_ref FROM recibo
                    WHERE id_manager=%s AND origen='gestplus_migracion'
                      AND origen_ref IS NOT NULL""", (ID_MANAGER,))
    ya_importados = {r['origen_ref'] for r in cur.fetchall()}
print(f'Recibos ya en BD (gestplus_migracion): {len(ya_importados)}')


# Cliente → cliente_idnoofit lookup vía dump NF (los partners ya creados tienen id_noofit)
nf = json.load(open('/opt/round_config_api/noofit_clientes_dump.json', 'r', encoding='utf-8'))
nf_by_dni = {}
nf_by_email = {}
import re, unicodedata
def strip_accents(s):
    return ''.join(c for c in unicodedata.normalize('NFD', str(s or '')) if unicodedata.category(c) != 'Mn')
def norm_dni(d): return re.sub(r'[^A-Z0-9]', '', strip_accents(str(d or '')).upper())
def norm_email(e): return (e or '').strip().lower()
for c in nf.get('clientes', []):
    d = norm_dni(c.get('dni') or c.get('nif'))
    if d and len(d) >= 7: nf_by_dni.setdefault(d, c)
    e = norm_email(c.get('email'))
    if e and '@' in e: nf_by_email.setdefault(e, c)


to_create = []
saltados_ya = 0
saltados_sin_gp = 0
for f in facturas:
    numrec = (f['ref'] or '').replace('GP-', '')
    if numrec in ya_importados:
        saltados_ya += 1
        continue
    gp_r = recibos_by_numrec.get(numrec)
    if not gp_r:
        saltados_sin_gp += 1
        continue

    cli = gp_r['_cli']
    # Resolver cliente_idnoofit vía DNI/email
    nfc = None
    for k in ('dni', 'dniContr'):
        d = norm_dni(cli.get(k))
        if d and len(d) >= 7 and d in nf_by_dni:
            nfc = nf_by_dni[d]; break
    if not nfc:
        e = norm_email(cli.get('email'))
        if e in nf_by_email: nfc = nf_by_email[e]
    cliente_idnoofit = str(nfc.get('id')) if nfc else ''

    fd = parse_date(gp_r.get('fechaDesde'))
    fh = parse_date(gp_r.get('fechaHasta'))
    periodo = fd.strftime('%Y-%m') if fd else None
    # Periodicidad
    dias = (fh - fd).days + 1 if fd and fh else None
    if dias is None: per = None
    elif 25 <= dias <= 35: per = 'mensual'
    elif 80 <= dias <= 100: per = 'trimestral'
    elif 150 <= dias <= 200: per = 'semestral'
    elif 300 <= dias <= 400: per = 'anual'
    else: per = 'otro'

    nombre_cli = f"{cli.get('nombre','')} {cli.get('apellidos','')}".strip()
    importe_total = float(gp_r.get('importeFinal') or 0)
    importe_base = round(importe_total / 1.21, 2)
    importe_iva = round(importe_total - importe_base, 2)

    fecha_pago = None
    if gp_r.get('cobrado') == 1:
        fecha_pago = (gp_r.get('fechaDesde') or '')[:10] or None

    fecha_devolucion = (gp_r.get('fechDevolucion') or None)
    if fecha_devolucion: fecha_devolucion = fecha_devolucion[:10]

    to_create.append({
        'id_manager': ID_MANAGER,
        'id_trainer': ID_TRAINER,
        'cliente_idnoofit': cliente_idnoofit or '0',  # placeholder si no encontrado
        'cliente_nombre': nombre_cli or None,
        'cuota_codigo': gp_r.get('codcur'),
        'cuota_descripcion': gp_r.get('codcur'),
        'periodo': periodo, 'fecha_desde': fd.isoformat() if fd else None,
        'fecha_hasta': fh.isoformat() if fh else None, 'periodicidad': per,
        'importe_base': importe_base, 'importe_iva': importe_iva,
        'importe_total': importe_total, 'iva_pct': 21.00,
        'metodo_pago': metodo_de(gp_r), 'estado': estado_de(gp_r),
        'fecha_emision': fd.isoformat() if fd else None,
        'fecha_pago': fecha_pago,
        'fecha_devolucion': fecha_devolucion,
        'fecha_facturacion': str(f['invoice_date']) if f.get('invoice_date') else None,
        'account_move_id': f['id'],
        'account_move_ref': f.get('name'),
        'origen': 'gestplus_migracion',
        'origen_ref': numrec,
        'notas': f"Migrado de GestPlus numRec={numrec} · backfill {datetime.now().strftime('%Y-%m-%d')}",
    })

print(f'\nA crear: {len(to_create)}')
print(f'Saltados ya importados: {saltados_ya}')
print(f'Saltados sin recibo GP: {saltados_sin_gp}')

if not to_create:
    print('\nNada que hacer.')
    exit()

if not CONFIRM:
    print('\n[DRY-RUN] Sample 5:')
    for r in to_create[:5]:
        print(f"  {r['origen_ref']:>12} | {r['cliente_nombre'][:25]:25s} | {r['periodo']} | {r['importe_total']}€ | {r['metodo_pago']} | move_id={r['account_move_id']}")
    print('\nCONFIRM=1 para aplicar.')
    exit()


# APLICAR
print('\n=== APLICANDO ===')
inserted = 0
errors = 0
with get_conn() as conn, conn.cursor() as cur:
    for r in to_create:
        try:
            cur.execute("""
                INSERT INTO recibo
                  (id_manager, id_trainer, cliente_idnoofit, cliente_nombre,
                   cuota_codigo, cuota_descripcion,
                   periodo, fecha_desde, fecha_hasta, periodicidad,
                   importe_base, importe_iva, importe_total, iva_pct,
                   metodo_pago, estado, fecha_emision, fecha_pago,
                   fecha_devolucion, fecha_facturacion,
                   account_move_id, account_move_ref,
                   origen, origen_ref, notas)
                VALUES (%(id_manager)s, %(id_trainer)s, %(cliente_idnoofit)s, %(cliente_nombre)s,
                        %(cuota_codigo)s, %(cuota_descripcion)s,
                        %(periodo)s, %(fecha_desde)s, %(fecha_hasta)s, %(periodicidad)s,
                        %(importe_base)s, %(importe_iva)s, %(importe_total)s, %(iva_pct)s,
                        %(metodo_pago)s, %(estado)s, %(fecha_emision)s, %(fecha_pago)s,
                        %(fecha_devolucion)s, %(fecha_facturacion)s,
                        %(account_move_id)s, %(account_move_ref)s,
                        %(origen)s, %(origen_ref)s, %(notas)s)
            """, r)
            inserted += 1
        except Exception as e:
            errors += 1
            print(f"  ⚠ {r['origen_ref']}: {e}")
            if errors > 5:
                print('  ... abortando, demasiados errores')
                break

print(f'\n✓ Inseradas: {inserted}  Errores: {errors}')
