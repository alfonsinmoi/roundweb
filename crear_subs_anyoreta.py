"""Crea round.subscription en Odoo para cada cliente Añoreta importado.
Reglas decididas:
  - periodicidad: del Excel (columna 'periodicidad' → mensual/trimestral)
  - forma_pago: B → 'sepa', C → 'efectivo'
  - fecha_inicio: HOY (2026-06-02)
  - sin descuento (ningún tipo Excel coincide con catálogo Añoreta web)
  - NO genera recibos
  - Idempotente: crear_subscription tiene anti-duplicado interno
"""
import openpyxl, re, json, datetime as dt
import psycopg
from psycopg.rows import dict_row
from app.odoo_alta import get_alta

XLSX = '/tmp/anyoreta_clientes.xlsx'
MGR = '17674'
TRAINER = '17674'

# ── Mapping ─────────────────────────────────────────────────────────────
FORMA_MAP = {'B': 'sepa', 'C': 'efectivo'}
PERIO_VALIDAS = {'mensual', 'bimensual', 'trimestral', 'semestral', 'anual'}

def normalizar_cuotas(raw, catalogo_codigos):
    """De 'RT 2 dias (s=0.85) | I MYGYM (s=0.95)' devuelve ['RT 2 dias', 'I MYGYM']
    deduplicado por categoría (1 RT máx + 1 MyGym máx)."""
    if not raw: return []
    items = [x.strip() for x in raw.split('|')]
    out, tipos = [], set()
    for item in items:
        base = re.split(r'\s*\(', item)[0].strip()
        if not base or base.upper() == 'SIN MATCH': continue
        tipo = 'RT' if 'RT' in base.upper() else ('MG' if 'MYGYM' in base.upper() else '?')
        if tipo in tipos: continue
        # match case-insensitive en catalogo
        match = next((c for c in catalogo_codigos if c.lower() == base.lower()), None)
        if not match: continue
        tipos.add(tipo)
        out.append(match)
    return out

# ── Cargar Excel ────────────────────────────────────────────────────────
wb = openpyxl.load_workbook(XLSX, data_only=True)
ws = wb['Clientes alta']
rows = list(ws.iter_rows(values_only=True))
headers = list(rows[0])
data = [dict(zip(headers, r)) for r in rows[1:] if any(r)]

# ── BD local ────────────────────────────────────────────────────────────
conn = psycopg.connect(host='/var/run/postgresql', dbname='round_config', user='odoo', row_factory=dict_row)
cur = conn.cursor()

# Catálogo cuotas locales (códigos + precios)
cur.execute("""SELECT codigo, precio_mensual, precio_trimestral, precio_semestral, precio_anual,
                      matricula
                 FROM cuota WHERE id_manager=%s AND scope='trainer' AND id_trainer=%s""",
            (MGR, TRAINER))
CATALOGO = {r['codigo']: r for r in cur.fetchall()}

# DNI → id_noofit (cliente_cache local)
cur.execute("""SELECT id, raw_data->>'dni' AS dni FROM cliente_cache WHERE id_manager=%s""", (MGR,))
dni_to_id = {(r['dni'] or '').upper(): r['id'] for r in cur.fetchall() if r['dni']}

# ── Odoo ────────────────────────────────────────────────────────────────
oa = get_alta()

def reconectar():
    """Reinstancia cliente Odoo si la conexión murió."""
    global oa
    # Limpiar el singleton REAL: _instances (dict) — antes ponía _inst que no existe
    import app.odoo_alta as _oalt
    _oalt._instances = {}
    import app.odoo_cuotas as _ocu
    _ocu._instances = {}
    oa = get_alta()
    # Forzar reconexión XML-RPC limpiando uid y models
    oa._uid = None
    oa._models = None

def call_seguro(model, method, *args, **kwargs):
    """Llama Odoo con reintento si el cliente murió."""
    for intento in range(3):
        try:
            return oa._call(model, method, *args, **kwargs)
        except Exception as e:
            msg = str(e)
            if 'no disponible' in msg or 'NoneType' in msg:
                reconectar()
                continue
            raise
    raise RuntimeError('Odoo no responde tras 3 intentos')
HOY = dt.date.today().isoformat()
print(f'Fecha inicio subscriptions: {HOY}')
print(f'Catálogo local Añoreta: {list(CATALOGO.keys())}')
print(f'Clientes en cache: {len(dni_to_id)}')
print(f'Filas Excel: {len(data)}')

n_ok = n_sub_creadas = n_skip_email = n_skip_partner = n_err = 0
n_sin_cuotas = 0
errores = []

def ts(): return dt.datetime.now().strftime('%H:%M:%S')

import sys
LIMIT = int(sys.argv[1]) if len(sys.argv) > 1 else None
for i, c in enumerate(data, 1):
    if LIMIT and n_ok >= LIMIT: break
    dni = (c.get('DNI') or '').strip().upper()
    email = (c.get('Email') or '').strip().lower()
    periodicidad = (c.get('periodicidad') or '').strip().lower()
    forma_excel = (c.get('Forma pago pagador') or '').strip().upper()
    forma_pago = FORMA_MAP.get(forma_excel, 'efectivo')   # default efectivo
    cuotas_raw = c.get('Cuotas (match NF)') or ''
    cuotas_codigos = normalizar_cuotas(cuotas_raw, CATALOGO.keys())

    # Validaciones de salto
    if not re.match(r'^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$', email):
        n_skip_email += 1; continue
    id_noofit = dni_to_id.get(dni)
    if not id_noofit:
        n_skip_partner += 1; continue
    if periodicidad not in PERIO_VALIDAS:
        periodicidad = 'mensual'  # fallback
    if not cuotas_codigos:
        n_sin_cuotas += 1; continue

    # Buscar partner_id Odoo por id_noofit
    try:
        partner_ids = call_seguro('res.partner', 'search', [('id_noofit','=',str(id_noofit))], limit=1)
        if not partner_ids:
            n_skip_partner += 1
            errores.append({'fila':i+1,'dni':dni,'paso':'partner','err':f'no partner para id_noofit={id_noofit}'})
            continue
        partner_id = partner_ids[0]
    except Exception as e:
        n_err += 1
        errores.append({'fila':i+1,'dni':dni,'paso':'search partner','err':str(e)[:200]})
        continue

    # Crear suscripción por cada cuota
    n_cli_ok = 0
    for codigo in cuotas_codigos:
        cat_row = CATALOGO[codigo]
        campo_precio = {
            'mensual':    cat_row['precio_mensual'],
            'trimestral': cat_row['precio_trimestral'] or cat_row['precio_mensual'],
            'semestral':  cat_row['precio_semestral'] or cat_row['precio_mensual'],
            'anual':      cat_row['precio_anual'] or cat_row['precio_mensual'],
        }.get(periodicidad, cat_row['precio_mensual'])
        sub_creada = False
        for intento in range(3):
            try:
                cuota_odoo = oa.get_or_create_cuota(codigo, fallback_precio=float(campo_precio or 0),
                                                     fallback_periodicidad=periodicidad)
                if not cuota_odoo:
                    raise RuntimeError(f'cuota Odoo {codigo} no se pudo crear')
                sub_id = oa.crear_subscription(
                    partner_id=partner_id,
                    cuota_id=cuota_odoo['id'],
                    periodicidad=periodicidad,
                    forma_pago=forma_pago,
                    fecha_inicio=HOY,
                    descuentos_codigos=None,
                )
                n_sub_creadas += 1
                n_cli_ok += 1
                sub_creada = True
                break
            except Exception as e:
                msg = str(e)
                if 'no disponible' in msg or 'NoneType' in msg:
                    reconectar()
                    continue
                n_err += 1
                errores.append({'fila':i+1,'dni':dni,'cuota':codigo,'paso':'subscription','err':msg[:200]})
                break
        if not sub_creada and not any(e['dni']==dni and e['cuota']==codigo for e in errores):
            n_err += 1
            errores.append({'fila':i+1,'dni':dni,'cuota':codigo,'paso':'subscription','err':'fallo tras 3 reintentos'})

    if n_cli_ok > 0:
        n_ok += 1

    if i % 25 == 0:
        print(f'[{ts()}] {i}/{len(data)} cli_ok={n_ok} subs={n_sub_creadas} err={n_err}', flush=True)

print(f'\n=== RESULTADO ===')
print(f'  Clientes procesados:   {n_ok}')
print(f'  Subscriptions creadas: {n_sub_creadas}')
print(f'  Skip por email:        {n_skip_email}')
print(f'  Skip por partner:      {n_skip_partner}')
print(f'  Sin cuotas asignadas:  {n_sin_cuotas}')
print(f'  Errores:               {n_err}')
if errores:
    print('\nPrimeros 10 errores:')
    for e in errores[:10]:
        print(f"  fila {e.get('fila')} {e.get('dni')} cuota={e.get('cuota','?')} [{e['paso']}] {e['err']}")
import datetime as _dt
out = f'/tmp/subs_errors_{_dt.datetime.now().strftime("%H%M%S")}.json'
with open(out,'w') as f: json.dump(errores, f, indent=2, ensure_ascii=False, default=str)
print(f'\nErrores completos: {out}')
