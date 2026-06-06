"""Importa clientes de Añoreta a NoofitPro + cliente_cache + Odoo res.partner.
Las cuotas activas se guardan en raw_data para referencia; la asignación
formal (subscription Odoo) se hace después con el flujo Alta ERP del web."""
import openpyxl, re, json, sys, time
from app.db import get_conn
from app.noofit_client import post_cliente_as_trainer, get_trainer_creds, _login_as, _request_as
from app.odoo_alta import get_alta
import psycopg.types.json as pjson


def get_clientes_as_trainer(email, pwd):
    """Lista TODOS los clientes del trainer, autenticado con su cuenta."""
    tok, mgr = _login_as(email, pwd)
    r = _request_as(tok, mgr, 'GET', '/api/dispositivos/getClienteSimple')
    r.raise_for_status()
    return (r.json() or {}).get('clientes') or []

XLSX = '/tmp/anyoreta_clientes.xlsx'
MGR = '17674'
TRAINER = '17674'
LIMIT = int(sys.argv[1]) if len(sys.argv) > 1 else None  # None = todos

RE_EMAIL = re.compile(r'^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
RE_IBAN_ES = re.compile(r'^ES\d{22}$')

# Catálogo cuotas
with get_conn() as conn, conn.cursor() as cur:
    cur.execute("SELECT id, codigo FROM cuota WHERE id_manager=%s AND scope='trainer' AND id_trainer=%s",
                (MGR, TRAINER))
    CUOTAS = {r['codigo']: r['id'] for r in cur.fetchall()}
    cur.execute("SELECT id::TEXT FROM cliente_cache WHERE id_manager=%s", (MGR,))
    EXISTENTES = {r['id'] for r in cur.fetchall()}

def normalizar_cuotas(raw):
    if not raw: return []
    items = [x.strip() for x in raw.split('|')]
    out, tipos = [], set()
    for item in items:
        base = re.split(r'\s*\(', item)[0].strip()
        if not base or base.upper() == 'SIN MATCH': continue
        tipo = 'RT' if 'RT' in base.upper() else ('MG' if 'MYGYM' in base.upper() else '?')
        if tipo in tipos: continue
        for code, cid in CUOTAS.items():
            if code.lower() == base.lower():
                out.append({'codigo': code, 'id': cid})
                tipos.add(tipo); break
    return out

def parse_fecha(v):
    if v is None: return None
    if hasattr(v, 'isoformat'): return v.isoformat()
    s = str(v).strip()
    return s if re.match(r'^\d{4}-\d{2}-\d{2}', s) else None

# Credenciales trainer Añoreta
email_nf, pwd_nf = get_trainer_creds(MGR, TRAINER)
if not email_nf:
    sys.exit('ERROR: sin credenciales NoofitPro para trainer 17674')
print(f'Login NoofitPro como: {email_nf}')

# Pre-cargar lista actual de clientes NF del trainer (para dedup por DNI)
print('Cargando snapshot inicial de clientes NoofitPro...')
nf_snapshot = get_clientes_as_trainer(email_nf, pwd_nf)
nf_by_dni = {(c.get('dni') or '').upper(): c for c in nf_snapshot if c.get('dni')}
print(f'  {len(nf_by_dni)} clientes ya existentes en NF')

# Leer Excel
wb = openpyxl.load_workbook(XLSX, data_only=True)
ws = wb['Clientes alta']
rows = list(ws.iter_rows(values_only=True))
headers = list(rows[0])
data = [dict(zip(headers, r)) for r in rows[1:] if any(r)]
print(f'Filas Excel: {len(data)}')

oa = get_alta()
n_ok = n_skip = n_err = n_odoo_err = 0
errores = []

def ts(): return time.strftime('%H:%M:%S')

for i, c in enumerate(data, 1):
    if LIMIT and n_ok >= LIMIT: break
    nombre    = (c.get('Nombre') or '').strip()
    apellidos = (c.get('Apellidos') or '').strip()
    email     = (c.get('Email') or '').strip().lower()
    dni       = (c.get('DNI') or '').strip().upper()
    movil     = (c.get('Móvil') or '').strip()
    fnac      = parse_fecha(c.get('F. nacimiento'))
    domicilio = (c.get('Domicilio') or '').strip()
    cp        = str(c.get('CP') or '').strip()
    poblacion = (c.get('Población') or '').strip()
    provincia = (c.get('Provincia') or '').strip()
    iban_raw  = (c.get('IBAN') or '').strip().upper().replace(' ', '')
    iban      = iban_raw if RE_IBAN_ES.match(iban_raw) else ''
    forma     = (c.get('Forma pago pagador') or '').strip()
    cod_gp    = (c.get('Cod GP') or '').strip()
    cuotas_norm = normalizar_cuotas(c.get('Cuotas (match NF)') or '')

    # Skip si email inválido
    if not RE_EMAIL.match(email):
        n_skip += 1
        continue

    print(f'[{ts()}] {i:3d}/{len(data)} DNI={dni} {nombre[:25]:<25} ', end='', flush=True)

    # ── 1. ¿Ya existe el cliente con ese DNI en NF? (idempotencia) ─────
    existing_nf = nf_by_dni.get(dni)
    id_nf = None
    if existing_nf:
        id_nf = existing_nf.get('id')
        print(f'(ya existe id={id_nf}) ', end='', flush=True)

    # ── 2. Si no existe, crear en NoofitPro y luego buscar por DNI ─────
    if not id_nf:
        try:
            nf_payload = {
                'name': nombre, 'surname': apellidos, 'email': email,
                'tlf': movil, 'dni': dni,
            }
            if fnac:      nf_payload['birthday'] = fnac
            if domicilio: nf_payload['direccion'] = domicilio
            if cp:        nf_payload['cp'] = cp
            if poblacion: nf_payload['poblacion'] = poblacion
            if provincia: nf_payload['provincia'] = provincia
            post_cliente_as_trainer([nf_payload], email_nf, pwd_nf, send_welcome=False)
            # NoofitPro devuelve un id incorrecto en clientePlusv2 → re-listar y buscar por DNI
            nf_snapshot2 = get_clientes_as_trainer(email_nf, pwd_nf)
            nf_by_dni.update({(c.get('dni') or '').upper(): c for c in nf_snapshot2 if c.get('dni')})
            match = nf_by_dni.get(dni)
            if not match:
                raise RuntimeError(f'cliente no aparece en NF tras crear (dni={dni})')
            id_nf = match.get('id')
        except Exception as e:
            n_err += 1
            errores.append({'fila': i+1, 'dni': dni, 'nombre': nombre, 'paso': 'NoofitPro', 'error': str(e)[:200]})
            print(f'  ❌ NF: {str(e)[:80]}')
            continue

    # ── 2. cliente_cache ──────────────────────────────────────────────
    raw_data = {
        'id': id_nf,
        'name': nombre, 'surname': apellidos,
        'email': email, 'tlf': movil, 'dni': dni,
        'birthday': fnac, 'direccion': domicilio,
        'cp': cp, 'poblacion': poblacion, 'provincia': provincia,
        'iban': iban, 'forma_pago': forma,
        'cod_gp': cod_gp,
        'cuotas_importadas': cuotas_norm,
        'origen': 'import_anyoreta_2026-06',
    }
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""INSERT INTO cliente_cache
                            (id, id_manager, id_trainer, enabled, name, surname, email, raw_data, synced_at)
                            VALUES (%s, %s, %s, TRUE, %s, %s, %s, %s::jsonb, NOW())
                            ON CONFLICT (id_manager, id) DO UPDATE
                              SET name=EXCLUDED.name, surname=EXCLUDED.surname,
                                  email=EXCLUDED.email, raw_data=EXCLUDED.raw_data,
                                  synced_at=NOW()""",
                        (id_nf, MGR, int(TRAINER), nombre, apellidos, email,
                         json.dumps(raw_data, ensure_ascii=False)))
    except Exception as e:
        n_err += 1
        errores.append({'fila': i+1, 'dni': dni, 'paso': 'cliente_cache', 'error': str(e)[:200]})
        print(f'  ❌ cache: {str(e)[:80]}')
        continue

    # ── 3. Odoo res.partner (multi-company company_id=3) ──────────────
    odoo_partner_id = None
    try:
        odoo_partner_id = oa.upsert_partner({
            'nombre': nombre, 'apellidos': apellidos, 'dni': dni,
            'email': email, 'movil': movil,
            'direccion': domicilio, 'localidad': poblacion, 'cp': cp,
            'fecha_nacimiento': fnac, 'sexo': None,
            'idnoofit': str(id_nf),
            'iban': iban or None,
        })
    except Exception as e:
        n_odoo_err += 1
        errores.append({'fila': i+1, 'dni': dni, 'paso': 'Odoo', 'error': str(e)[:200]})
        print(f'  ⚠️  Odoo: {str(e)[:60]}')
        # Sigue — cliente queda en NF + cache aunque Odoo falle

    n_ok += 1
    print(f'  ✓ NF id={id_nf} Odoo={odoo_partner_id or "-"}'
          f' cuotas={[q["codigo"] for q in cuotas_norm]}')

print(f'\n=== RESULTADO ===')
print(f'  OK:                   {n_ok}')
print(f'  Skip (email):         {n_skip}')
print(f'  Error NoofitPro:      {n_err - n_odoo_err}')
print(f'  Error Odoo (cliente creado):  {n_odoo_err}')
print(f'  Total intentados:     {n_ok + n_err}')
if errores:
    print('\nPrimeros 10 errores:')
    for e in errores[:10]:
        print(f'  fila {e.get("fila")} {e.get("dni")} [{e.get("paso")}] {e.get("error")[:120]}')

# Guardar errores en JSON
import datetime as _dt
out_path = f'/tmp/import_errors_{_dt.datetime.now().strftime("%H%M%S")}.json'
with open(out_path, 'w') as f:
    json.dump(errores, f, indent=2, ensure_ascii=False, default=str)
print(f'\nErrores completos en: {out_path}')
