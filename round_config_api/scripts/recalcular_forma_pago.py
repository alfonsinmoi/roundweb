"""Recalcula forma_pago_cliente según la regla:
   - Cliente GP con IBAN real → sepa + IBAN copiado
   - Cliente GP sin IBAN o placeholder → efectivo

Solo para clientes en ALTA en GP (estado=1). Idempotente: si la forma activa
ya coincide con la regla (incluido el IBAN para SEPA), NO se toca.

Si difiere: cierra la activa (estado=cancelada, fecha_fin=hoy) y crea nueva.

Modo: CONFIRM=1 para aplicar; default dry-run.
"""
import os, sys, json, re, unicodedata
from datetime import date
sys.path.insert(0, '/opt/round_config_api')
from app.db import get_conn

CONFIRM = os.getenv('CONFIRM') == '1'
ID_MANAGER = '17677'
GP = '/opt/round_config_api/gestplus_dump_2026-05-08.json'
NF = '/opt/round_config_api/noofit_clientes_dump.json'

def strip_accents(s):
    return ''.join(c for c in unicodedata.normalize('NFD', str(s or '')) if unicodedata.category(c) != 'Mn')
def norm_dni(d): return re.sub(r'[^A-Z0-9]', '', strip_accents(str(d or '')).upper())
def norm_email(e): return (e or '').strip().lower()
def norm_iban(i):
    s = re.sub(r'[^A-Z0-9]', '', str(i or '').upper())
    if not s or s.startswith('ES000') or s == 'ES' * 12:
        return ''
    return s


# ─── Cargar dumps ─────────────────────────────────────────────────────────────
gp = json.load(open(GP, 'r', encoding='utf-8'))
nf = json.load(open(NF, 'r', encoding='utf-8'))

nf_by_dni = {}; nf_by_email = {}
for c in nf.get('clientes', []):
    d = norm_dni(c.get('dni') or c.get('nif'))
    if d and len(d) >= 7: nf_by_dni.setdefault(d, c)
    e = norm_email(c.get('email'))
    if e and '@' in e: nf_by_email.setdefault(e, c)


# Forma activa actual por cliente
with get_conn() as conn, conn.cursor() as cur:
    cur.execute("""SELECT cliente_idnoofit, forma_pago, iban
                     FROM forma_pago_cliente
                    WHERE id_manager=%s AND estado='activa'""", (ID_MANAGER,))
    activos = {r['cliente_idnoofit']: r for r in cur.fetchall()}
print(f'Formas activas actuales: {len(activos)}')


# Iterar clientes GP
gp_clientes_alta = [c for c in (gp.get('altas') or []) if c.get('estado') == 1]
print(f'Clientes GP en alta: {len(gp_clientes_alta)}')

cambios = []     # (idnoofit, accion, motivo, datos_nuevos)
sin_match = 0
ya_ok = 0

for cli in gp_clientes_alta:
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
    nombre = f"{cli.get('nombre','')} {cli.get('apellidos','')}".strip()

    iban_real = norm_iban(cli.get('_iban'))
    if iban_real:
        forma_nueva = 'sepa'
        iban_nuevo = iban_real
    else:
        forma_nueva = 'efectivo'
        iban_nuevo = None

    actual = activos.get(idnoofit)
    actual_forma = actual['forma_pago'] if actual else None
    actual_iban = (actual['iban'] or '') if actual else ''

    # Comparar
    if actual:
        misma_forma = actual_forma == forma_nueva
        mismo_iban = (actual_iban or '').replace(' ', '') == (iban_nuevo or '').replace(' ', '')
        if misma_forma and mismo_iban:
            ya_ok += 1
            continue
        cambios.append({
            'idnoofit': idnoofit, 'nombre': nombre,
            'accion': 'reemplazar',
            'antes': {'forma': actual_forma, 'iban': actual_iban or ''},
            'ahora': {'forma': forma_nueva, 'iban': iban_nuevo or ''},
        })
    else:
        cambios.append({
            'idnoofit': idnoofit, 'nombre': nombre,
            'accion': 'crear',
            'antes': None,
            'ahora': {'forma': forma_nueva, 'iban': iban_nuevo or ''},
        })


print(f'\n=== Resumen ===')
print(f'Ya correctos:        {ya_ok}')
print(f'A cambiar/crear:     {len(cambios)}')
print(f'Sin match NoofitPro: {sin_match}')

# Distribución
from collections import Counter
acc = Counter((c['accion'], c['ahora']['forma']) for c in cambios)
print(f'\nDesglose:')
for (a, f), n in acc.most_common():
    print(f'  {a:10s}  {f:10s}: {n}')

if not CONFIRM:
    print('\n[DRY-RUN] Sample 5:')
    for c in cambios[:5]:
        print(f'  {c["idnoofit"]:>8} {c["nombre"][:30]:30s}  {c["accion"]}: {c.get("antes")} → {c["ahora"]}')
    print('\nCONFIRM=1 para aplicar.')
    exit()

# APLICAR
print('\n=== APLICANDO ===')
hoy = date.today().isoformat()
inserted = 0
errors = 0
for c in cambios:
    try:
        with get_conn() as conn, conn.cursor() as cur:
            # Cerrar la activa actual (si hay)
            if c['accion'] == 'reemplazar':
                cur.execute("""UPDATE forma_pago_cliente
                                  SET estado='cancelada', fecha_fin=%s,
                                      motivo_cambio='Reclasificación según IBAN GP',
                                      updated_by='recalcular_forma_pago'
                                WHERE id_manager=%s AND cliente_idnoofit=%s AND estado='activa'""",
                            (hoy, ID_MANAGER, c['idnoofit']))
            # Crear la nueva
            cur.execute("""
                INSERT INTO forma_pago_cliente
                  (id_manager, cliente_idnoofit, forma_pago, iban,
                   estado, fecha_inicio, motivo_cambio, created_by, updated_by)
                VALUES (%s, %s, %s, %s, 'activa', %s, %s, 'recalcular_forma_pago', 'recalcular_forma_pago')
            """, (ID_MANAGER, c['idnoofit'], c['ahora']['forma'], c['ahora']['iban'] or None,
                  hoy, 'Reclasificación según IBAN GP'))
        inserted += 1
    except Exception as e:
        errors += 1
        if errors <= 5:
            print(f'  ⚠ {c["idnoofit"]}: {e}')

print(f'\n✓ Aplicados: {inserted}  Errores: {errors}')
