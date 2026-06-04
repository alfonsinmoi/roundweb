"""Pobla forma_pago_cliente para los 328 clientes Añoreta importados.
Forma B → 'sepa' con IBAN del Excel.
Forma C → 'efectivo' sin IBAN."""
import openpyxl, re, datetime as dt
import psycopg
from psycopg.rows import dict_row

XLSX = '/tmp/anyoreta_clientes.xlsx'
MGR = '17674'
RE_EMAIL = re.compile(r'^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
RE_IBAN_ES = re.compile(r'^ES\d{22}$')
HOY = dt.date.today()

FORMA_MAP = {'B': 'sepa', 'C': 'efectivo'}

wb = openpyxl.load_workbook(XLSX, data_only=True)
ws = wb['Clientes alta']
rows = list(ws.iter_rows(values_only=True))
headers = list(rows[0])
data = [dict(zip(headers, r)) for r in rows[1:] if any(r)]

conn = psycopg.connect(host='/var/run/postgresql', dbname='round_config', user='odoo', row_factory=dict_row)
cur = conn.cursor()
# DNI → id_noofit
cur.execute("SELECT id, raw_data->>'dni' AS dni FROM cliente_cache WHERE id_manager=%s", (MGR,))
dni_to_id = {(r['dni'] or '').upper(): r['id'] for r in cur.fetchall() if r['dni']}

n_ok = n_skip = n_err = 0
for c in data:
    dni = (c.get('DNI') or '').strip().upper()
    email = (c.get('Email') or '').strip().lower()
    forma_excel = (c.get('Forma pago pagador') or '').strip().upper()
    forma_pago = FORMA_MAP.get(forma_excel)
    iban_raw = (c.get('IBAN') or '').strip().upper().replace(' ', '')
    iban = iban_raw if RE_IBAN_ES.match(iban_raw) else None
    titular = (c.get('Titular pago (nombre)') or '').strip()

    if not RE_EMAIL.match(email) or not forma_pago:
        n_skip += 1; continue
    id_noofit = dni_to_id.get(dni)
    if not id_noofit:
        n_skip += 1; continue

    try:
        # Idempotente: cierra activas previas + crea nueva
        cur.execute("""UPDATE forma_pago_cliente
                          SET estado='cancelada', fecha_fin=%s, updated_at=NOW()
                        WHERE id_manager=%s AND cliente_idnoofit=%s AND estado='activa'""",
                    (HOY, MGR, str(id_noofit)))
        cur.execute("""INSERT INTO forma_pago_cliente
                         (id_manager, cliente_idnoofit, forma_pago, iban, iban_titular,
                          estado, fecha_inicio, created_by)
                       VALUES (%s, %s, %s, %s, %s, 'activa', %s, 'import_anyoreta')""",
                    (MGR, str(id_noofit), forma_pago,
                     iban if forma_pago == 'sepa' else None,
                     titular if forma_pago == 'sepa' else None,
                     HOY))
        n_ok += 1
    except Exception as e:
        n_err += 1
        if n_err <= 3: print(f'Error {dni}: {e}')

conn.commit()
print(f'\nForma de pago cargada: {n_ok} | Skip: {n_skip} | Err: {n_err}')

# Verificación
cur.execute("""SELECT forma_pago, COUNT(*) AS n
                 FROM forma_pago_cliente
                WHERE id_manager=%s AND estado='activa'
                GROUP BY forma_pago""", (MGR,))
print('\nDistribución actual:')
for r in cur.fetchall():
    print(f'  {r["forma_pago"]}: {r["n"]}')
