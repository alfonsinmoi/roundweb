"""Importa recibos GestPlus 2026 de Añoreta a tabla local `recibo`.
Reglas decididas:
  - Solo fecha >= 2026-01-01
  - _cli_iban == 'ES0000000000000000000000' → metodo_pago='efectivo' (caja)
  - resto → metodo_pago='sepa' (banco, susceptible de devolución)
  - mapeo codcur por patrón automático:
      LX/MJ presente → RT 2 dias
      MYGYM presente → I MYGYM
      'RT 1' presente → RT 1D
      otros → null (reportar al final)
  - estado:
      anulado=1 → 'anulado'
      motivoDevolucion presente → 'devuelto'
      cobrado=1 → 'pagado'
      cobrado=0 (y no anulado/devuelto) → 'emitido'
  - Idempotente: origen='gestplus_2026', origen_ref=numRec
"""
import openpyxl, re, sys, datetime as dt
import psycopg
from psycopg.rows import dict_row
from collections import Counter

XLSX = '/tmp/recibos_2026.xlsx'
MGR = '17674'
TRAINER = '17674'
IBAN_VACIO = 'ES0000000000000000000000'
LIMIT = int(sys.argv[1]) if len(sys.argv) > 1 else None

def mapear_codcur(c):
    """Mapea codcur GestPlus a código de cuota Round Añoreta."""
    if not c: return None
    s = c.upper()
    if 'MYGYM' in s: return 'I MYGYM'
    if 'R4W' in s:   return 'R4W'
    if 'RT 1' in s and 'LX 1' not in s:  return 'RT 1D'
    if re.search(r'\bLX\b', s) or re.search(r'\bMJ\b', s):
        return 'RT 2 dias'
    return None

def parse_fecha(v):
    """Excel suele dar 'YYYY-MM-DDTHH:MM:SS' string. Devuelve datetime.date."""
    if v is None: return None
    if isinstance(v, dt.datetime): return v.date()
    if isinstance(v, dt.date): return v
    s = str(v).strip()
    m = re.match(r'^(\d{4})-(\d{2})-(\d{2})', s)
    if m: return dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    return None

def parse_dt(v):
    """Devuelve datetime con tz UTC o None."""
    if v is None: return None
    if isinstance(v, dt.datetime): return v
    s = str(v).strip()
    try:
        return dt.datetime.fromisoformat(s.replace('Z',''))
    except Exception:
        return None

def f(x):
    try: return float(x)
    except: return 0.0

# ── Leer Excel ──────────────────────────────────────────────────────────
wb = openpyxl.load_workbook(XLSX, data_only=True)
ws = wb['Recibos GP 2026']
rows = list(ws.iter_rows(values_only=True))
headers = list(rows[0])
data = [dict(zip(headers, r)) for r in rows[1:] if any(r)]
print(f'Filas Excel: {len(data)}')

# Filtrar 2026
data_2026 = [r for r in data if (parse_fecha(r.get('fecha')) or dt.date(2000,1,1)).year >= 2026]
print(f'Filtrados 2026+: {len(data_2026)}')

# ── BD ──────────────────────────────────────────────────────────────────
conn = psycopg.connect(host='/var/run/postgresql', dbname='round_config', user='odoo', row_factory=dict_row)
cur = conn.cursor()

# Catálogo cuotas locales (codigo → id)
cur.execute("""SELECT id, codigo FROM cuota
                WHERE id_manager=%s AND scope='trainer' AND id_trainer=%s""", (MGR, TRAINER))
CUOTAS = {r['codigo']: r['id'] for r in cur.fetchall()}
print(f'Catálogo: {list(CUOTAS.keys())}')

# DNI → id_noofit
cur.execute("SELECT id, raw_data->>'dni' AS dni, name||' '||COALESCE(surname,'') AS nombre FROM cliente_cache WHERE id_manager=%s", (MGR,))
dni_to_cli = {(r['dni'] or '').upper(): (r['id'], r['nombre']) for r in cur.fetchall() if r['dni']}

# Idempotencia: recibos ya importados
cur.execute("SELECT origen_ref FROM recibo WHERE id_manager=%s AND origen='gestplus_2026'", (MGR,))
ya_importados = {r['origen_ref'] for r in cur.fetchall()}
print(f'Ya importados antes: {len(ya_importados)}')

# ── Procesar ────────────────────────────────────────────────────────────
n_ok = n_skip_cli = n_skip_cuota = n_skip_existe = n_err = 0
sin_cuota = Counter()  # códigos que no se mapean
errores = []

for i, r in enumerate(data_2026, 1):
    if LIMIT and n_ok >= LIMIT: break
    num_rec = str(r.get('numRec') or '').strip()
    if not num_rec:
        n_err += 1
        errores.append({'fila':i+1,'err':'sin numRec'})
        continue
    if num_rec in ya_importados:
        n_skip_existe += 1; continue

    dni = (r.get('_cli_dni') or '').strip().upper()
    cli = dni_to_cli.get(dni)
    if not cli:
        n_skip_cli += 1; continue
    id_noofit, cli_nombre = cli

    codcur = r.get('codcur') or ''
    cuota_round = mapear_codcur(codcur)
    if not cuota_round:
        sin_cuota[codcur] += 1
        n_skip_cuota += 1; continue
    cuota_id = CUOTAS.get(cuota_round)

    # Caja vs Banco
    iban_cliente = (r.get('_cli_iban') or '').strip().upper().replace(' ', '')
    metodo = 'efectivo' if iban_cliente == IBAN_VACIO else 'sepa'

    # Estado
    anulado = str(r.get('anulado') or '0') in ('1','True','true')
    devuelto = bool(r.get('motivoDevolucion'))
    cobrado = str(r.get('cobrado') or '0') in ('1','True','true')
    if anulado:   estado = 'anulado'
    elif devuelto: estado = 'devuelto'
    elif cobrado:  estado = 'pagado'
    else:           estado = 'emitido'

    # Fechas
    fdesde = parse_fecha(r.get('fechaDesde'))
    fhasta = parse_fecha(r.get('fechaHasta'))
    femis = parse_fecha(r.get('fecha')) or dt.date.today()
    fpago = parse_dt(r.get('fechaEnvio')) if cobrado else None
    fdev = parse_dt(r.get('fechDevolucion')) if devuelto else None
    periodo = femis.strftime('%Y-%m')

    importe_final = f(r.get('importeFinal'))
    importe_inicial = f(r.get('importeInicial'))
    iva_pct = 21.0  # default España; el Excel tiene `iva` casi siempre vacío
    importe_base = round(importe_final / (1 + iva_pct/100), 2)
    importe_iva = round(importe_final - importe_base, 2)

    # Determinar periodicidad real desde fechas (fdesde→fhasta)
    periodicidad = 'mensual'
    if fdesde and fhasta:
        meses = (fhasta.year - fdesde.year) * 12 + (fhasta.month - fdesde.month) + 1
        if meses >= 11: periodicidad = 'anual'
        elif meses >= 5: periodicidad = 'semestral'
        elif meses >= 2: periodicidad = 'trimestral'

    nota_extra = []
    if r.get('descu'): nota_extra.append(f"descu GP: {r['descu']}")
    if r.get('cantidadDescuento'): nota_extra.append(f"dto: {r['cantidadDescuento']}")
    if r.get('motivoDevolucion'): nota_extra.append(f"motivoDev: {r['motivoDevolucion']}")
    if r.get('nota'): nota_extra.append(str(r['nota']))
    notas = ' | '.join(nota_extra) or None

    try:
        cur.execute("""INSERT INTO recibo
            (id_manager, id_trainer, cliente_idnoofit, cliente_nombre,
             cuota_id, cuota_codigo, cuota_descripcion,
             periodo, fecha_desde, fecha_hasta, periodicidad,
             importe_base, importe_iva, importe_total, iva_pct,
             metodo_pago, estado, fecha_emision, fecha_pago, fecha_devolucion,
             origen, origen_ref, notas, created_by)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    'gestplus_2026', %s, %s, 'import_recibos_gp')""",
            (MGR, TRAINER, str(id_noofit), cli_nombre,
             cuota_id, cuota_round, codcur,
             periodo, fdesde, fhasta, periodicidad,
             importe_base, importe_iva, importe_final, iva_pct,
             metodo, estado, femis, fpago, fdev,
             num_rec, notas))
        n_ok += 1
    except Exception as e:
        n_err += 1
        conn.rollback()
        if len(errores) < 5: errores.append({'numRec':num_rec,'dni':dni,'err':str(e)[:200]})
        continue

    if i % 200 == 0:
        conn.commit()
        print(f'  {i}/{len(data_2026)} ok={n_ok} skip_cli={n_skip_cli} sin_cuota={n_skip_cuota}', flush=True)

conn.commit()
print(f'\n=== RESULTADO ===')
print(f'  Importados:               {n_ok}')
print(f'  Skip (cliente no cache):  {n_skip_cli}')
print(f'  Skip (sin mapeo cuota):   {n_skip_cuota}')
print(f'  Skip (ya importado):      {n_skip_existe}')
print(f'  Errores:                  {n_err}')
if sin_cuota:
    print(f'\nCódigos codcur sin mapeo ({len(sin_cuota)} únicos):')
    for k, v in sin_cuota.most_common(15):
        print(f'  {v:4d}× {k!r}')
if errores:
    print('\nPrimeros errores:')
    for e in errores: print(f'  {e}')

# Resumen por estado/metodo
cur.execute("""SELECT estado, metodo_pago, COUNT(*) n, SUM(importe_total) total
                 FROM recibo WHERE id_manager=%s AND origen='gestplus_2026'
                 GROUP BY estado, metodo_pago ORDER BY estado, metodo_pago""", (MGR,))
print('\nResumen tabla recibo:')
for row in cur.fetchall():
    print(f"  {row['estado']:<12} {row['metodo_pago']:<10} {row['n']:>4} recibos  {float(row['total']):>10.2f} €")
