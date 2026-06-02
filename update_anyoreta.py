"""Actualiza datos faltantes de los clientes de Añoreta ya importados:
   - cellPhone (móvil)
   - birthdate (fecha de nacimiento) — con +1 día para compensar timezone
   - address (domicilio + población concatenada)
   - postal_code (CP)
   - gender (detectado por primer nombre)
Actualiza en NoofitPro + cliente_cache.raw_data + Odoo res.partner."""
import openpyxl, re, json, sys, time
import datetime as dt
import requests, hashlib, urllib3
import psycopg
from psycopg.rows import dict_row
urllib3.disable_warnings()

XLSX = '/tmp/anyoreta_clientes.xlsx'
MGR = '17674'
TRAINER = '17674'
RE_EMAIL = re.compile(r'^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')

# ── Lista de nombres → sexo (común en España) ────────────────────────────
NOMBRES_F = {
  'ANA','MARIA','CARMEN','ISABEL','DOLORES','PILAR','TERESA','ROSA','CRISTINA','SARA',
  'LAURA','MARTA','BEATRIZ','BEA','ELENA','EVA','LUCIA','LUCÍA','PATRICIA','PAULA','SUSANA',
  'SANDRA','SILVIA','ANDREA','RAQUEL','SONIA','GLORIA','ESTHER','YOLANDA','CONCEPCION',
  'CONCEPCIÓN','CONCHA','ROCIO','ROCÍO','INMACULADA','INMA','MANUELA','MERCEDES','MERCHE',
  'ENCARNACION','ENCARNACIÓN','ENCARNA','ANTONIA','JOSEFA','PEPA','FRANCISCA','PAQUI','JUANA',
  'ANGELA','ÁNGELA','MARIBEL','ALMUDENA','CARLA','ADRIANA','OLGA','MONICA','MÓNICA','NATALIA',
  'VERONICA','VERÓNICA','MARINA','ALBA','NURIA','LOURDES','BEGOÑA','LORENA','DANIELA','IRENE',
  'GEMMA','GEMA','LOLA','ESPERANZA','MAR','ASUNCION','ASUNCIÓN','CATALINA','LARA','AURORA',
  'INES','INÉS','REYES','CHARO','BELEN','BELÉN','BERTA','VANESSA','TAMARA','SHEILA','AINHOA',
  'AINARA','AITANA','ALICIA','AMELIA','AMPARO','ARIADNA','AROA','CARMELA','CHARI','CHELO',
  'CLARA','CORAL','EDITH','ELISA','EUGENIA','FERNANDA','GABRIELA','HILDA','IVANA','JESSICA',
  'JOAQUINA','JULIA','JULIANA','LINA','MAGDALENA','MARGARITA','MARIAN','MARISOL','MIREIA',
  'NAZARET','NEREA','NIEVES','NOELIA','PAMELA','PURIFICACION','PURIFICACIÓN','RUTH','TANIA',
  'TRINI','URSULA','ÚRSULA','YAIZA','ZAIRA','ZOE','ROSARIO','MELANIA','MELI','MARIOLA','GEMA',
  'BARBARA','BÁRBARA','SUSI','JESSI','MIRYAM','MARÍA JESÚS','MARIA JESUS','JESI','KATHERIN',
  'ROSALINDA','ANAÏS','ANAIS','MIRIAM','MYRIAM','SANTI','BEGO','MAMEN','LIVIA','OLIVIA',
  'CLAUDIA','EMMA','VALERIA','CHLOE','MARTINA','SOFIA','SOFÍA','LUNA','VEGA','CARLOTA','LEIRE',
  'JIMENA','BERENICE','MIRELLA','MELANIE','SAMANTA','SAMANTHA','TANIT','MAITE','MAITENA','MAIA',
  'MAIDER','AROHA','AINOA','DELIA','CELIA','XIMENA','LUZ','DALIA','HIBA','ALEJANDRA','DAFNE',
  'JIMENA','HONORINA','RECAREDA','PRECIOSA','SOL',
}
NOMBRES_M = {
  'JOSE','JOSÉ','ANTONIO','MANUEL','FRANCISCO','PACO','DAVID','JUAN','JAVIER','JAVI',
  'DANIEL','DANI','JESUS','JESÚS','CARLOS','ALEJANDRO','ALEX','MIGUEL','RAFAEL','RAFA',
  'PEDRO','PABLO','SERGIO','JORGE','ALBERTO','LUIS','ANGEL','ÁNGEL','FERNANDO','FER',
  'DIEGO','ADRIAN','ADRIÁN','RAUL','RAÚL','IVAN','IVÁN','MARIO','ENRIQUE','ANDRES','ANDRÉS',
  'RAMON','RAMÓN','JOAQUIN','JOAQUÍN','VICENTE','GABRIEL','EDUARDO','EDU','ROBERTO','MARCOS',
  'VICTOR','VÍCTOR','OSCAR','ÓSCAR','RUBEN','RUBÉN','SALVADOR','CRISTIAN','CHRISTIAN','HUGO',
  'IGNACIO','NACHO','TOMAS','TOMÁS','FELIPE','ESTEBAN','MARIANO','MARC','ALBERT','MOHAMED',
  'ALI','OMAR','HASSAN','MARTIN','MARTÍN','MARCELO','GUILLERMO','GERMAN','GERMÁN','ANGELO',
  'FRAN','LUCAS','LEO','LEONARDO','MATEO','MATIAS','MATÍAS','BRUNO','ALAN','BENJAMIN',
  'BENJAMÍN','TIAGO','THIAGO','SAUL','SAÚL','SANTIAGO','SANTI','JAIME','GONZALO','BORJA',
  'TONI','RAMI','ESTANISLAO','ESTANIS','ABEL','ABDEL','YUSUF','YASSER','GORKA','UNAI','XABI',
  'XAVI','OIER','BIEL','POL','GUIM','ERIC','ARNAU','JORDI','TONY','MOI','MOISES','MOISÉS',
  'JONATHAN','JONI','EDGAR','EFREN','EFRÉN','HECTOR','HÉCTOR','LEANDRO','GERARD','BRYAN',
  'JOEL','LIAM','GAEL','IZAN','IKER','NICOLAS','NICOLÁS','NICO','LUCA','THIAGO','LAUTARO',
  'AMADO','RAIMUNDO','DARIO','DARÍO','SAMUEL','SAMI','GAEL','LEVI','OMAR','BILAL','SERGI',
  'PAU','GUILLEM','ESTEFAN','STEPHAN','STEFAN','BENITO','EVARISTO','GENARO','ELIAS','ELÍAS',
  'TADEO','EZEQUIEL','HARRY','HENRY','BRAULIO','RAMI',
}

def detectar_sexo(nombre):
    if not nombre: return None
    # Primer token (puede ser compuesto: "Jose Manuel" → JOSE)
    parts = re.split(r'\s+', nombre.strip().upper())
    if not parts: return None
    primer = parts[0]
    if primer in NOMBRES_F: return 'F'
    if primer in NOMBRES_M: return 'M'
    # Heurística "termina en a" para F, pero solo si nombre desconocido (es flojo)
    # Mejor dejar None y reportar
    return None

# ── Datos del Excel ────────────────────────────────────────────────────
wb = openpyxl.load_workbook(XLSX, data_only=True)
ws = wb['Clientes alta']
rows = list(ws.iter_rows(values_only=True))
headers = list(rows[0])
data = [dict(zip(headers, r)) for r in rows[1:] if any(r)]

# ── Cache local: DNI → id NoofitPro ─────────────────────────────────────
conn = psycopg.connect(host='/var/run/postgresql', dbname='round_config', user='odoo', row_factory=dict_row)
cur = conn.cursor()
cur.execute("SELECT id, raw_data->>'dni' AS dni, email FROM cliente_cache WHERE id_manager=%s", (MGR,))
dni_to_id = {(r['dni'] or '').upper(): r['id'] for r in cur.fetchall() if r['dni']}
cur.execute("SELECT noofit_email, noofit_password FROM trainer_noofit_creds WHERE id_manager=%s AND id_trainer=%s",
            (MGR, TRAINER))
creds = cur.fetchone()
em_nf, pw_nf = creds['noofit_email'], creds['noofit_password']

# ── Login NoofitPro como trainer ────────────────────────────────────────
BASE = 'https://pro.wiemspro.com/wiemspro'
r = requests.post(f'{BASE}/account/loginEasy',
    json={'email':em_nf,'appVersion':'1.8.39','password':hashlib.md5(pw_nf.encode()).hexdigest().upper()},
    timeout=15, verify=False)
tok = r.headers['X-CustomToken']; mh = r.headers.get('X-TRAINER_MANAGER','')
H = {'X-CustomToken':tok,'locale':'es','appVersion':'1.8.39','appId':'1',
     'X-TRAINER_MANAGER':str(mh) if mh else 'true','Content-Type':'application/json'}

# Listado actual NF (para tener todos los campos a la hora de hacer update)
r = requests.get(f'{BASE}/api/dispositivos/getClienteSimple', headers=H, timeout=30, verify=False)
nf_clientes = (r.json() or {}).get('clientes') or []
nf_by_id = {c['id']: c for c in nf_clientes}

# ── Odoo ─────────────────────────────────────────────────────────────
from app.odoo_cuotas import get_cuotas
oc = get_cuotas()

def parse_fecha_excel(v):
    """Devuelve string 'YYYY-MM-DD' o None. Soporta:
       - datetime/date object (openpyxl ya lo da)
       - string 'YYYY-MM-DD'
    """
    if v is None: return None
    if isinstance(v, dt.datetime): return v.date().isoformat()
    if isinstance(v, dt.date): return v.isoformat()
    s = str(v).strip()
    if re.match(r'^\d{4}-\d{2}-\d{2}', s): return s[:10]
    return None

def fecha_mas_uno(iso):
    """Devuelve fecha +1 día para compensar timezone bug NF."""
    if not iso: return None
    d = dt.date.fromisoformat(iso)
    return (d + dt.timedelta(days=1)).isoformat()

# ── Procesar ────────────────────────────────────────────────────────────
n_upd = n_skip = n_err = 0
sin_sexo = []

print(f'{len(data)} filas a procesar')
for i, c in enumerate(data, 1):
    nombre = (c.get('Nombre') or '').strip()
    apellidos = (c.get('Apellidos') or '').strip()
    email = (c.get('Email') or '').strip().lower()
    dni = (c.get('DNI') or '').strip().upper()
    movil = re.sub(r'\D', '', (c.get('Móvil') or '').strip())
    fnac = parse_fecha_excel(c.get('F. nacimiento'))
    fnac_nf = fecha_mas_uno(fnac) if fnac else None
    sexo = detectar_sexo(nombre)
    domicilio = (c.get('Domicilio') or '').strip()
    cp = str(c.get('CP') or '').strip()
    poblacion = (c.get('Población') or '').strip()
    # Concatenar población en address ya que NF no acepta `town`
    full_address = domicilio
    if poblacion: full_address = f'{domicilio}, {poblacion}'.strip(', ')

    if not RE_EMAIL.match(email):
        n_skip += 1; continue
    id_nf = dni_to_id.get(dni)
    if not id_nf:
        n_skip += 1; continue

    current = nf_by_id.get(id_nf)
    if not current:
        n_skip += 1; continue
    if sexo is None:
        sin_sexo.append((id_nf, nombre, dni))

    # Construir payload merge sobre los datos actuales
    payload = {**current,
        'cellPhone': movil or None,
        'birthdate': fnac_nf,
        'gender': sexo,
        'address': full_address or None,
        'postal_code': cp or None,
        'toSend': False,
        'enabled': True,
    }
    try:
        r = requests.post(f'{BASE}/api/dispositivos/clientePlusv2', headers=H,
                          json=[payload], timeout=15, verify=False)
        r.raise_for_status()
        n_upd += 1
    except Exception as e:
        n_err += 1
        if n_err <= 5: print(f'  ❌ NF {dni}: {e}')
        continue

    # Actualizar Odoo res.partner (mobile + birthdate)
    try:
        partner_ids = oc._call('res.partner', 'search', [('id_noofit','=',str(id_nf))], limit=1)
        if partner_ids:
            vals = {}
            if movil: vals['mobile'] = movil
            if fnac:  vals['comment'] = f'Fecha nac: {fnac}'  # Odoo no tiene campo birthdate por defecto
            if poblacion: vals['city'] = poblacion
            if vals:
                oc._call('res.partner', 'write', [partner_ids[0]], vals)
    except Exception as e:
        pass  # Odoo error no es bloqueante

    # Actualizar cliente_cache.raw_data
    try:
        cur.execute("""UPDATE cliente_cache
                          SET raw_data = raw_data || %s::jsonb, synced_at = NOW()
                        WHERE id = %s AND id_manager = %s""",
                    (json.dumps({'cellPhone': movil, 'birthdate': fnac, 'gender': sexo,
                                 'address_full': full_address}), id_nf, MGR))
        conn.commit()
    except Exception as e:
        conn.rollback()

    if i % 30 == 0: print(f'  ... {i}/{len(data)} (actualizados={n_upd})')

print(f'\n=== RESULTADO ===')
print(f'  Actualizados:    {n_upd}')
print(f'  Skip (no match): {n_skip}')
print(f'  Errores:         {n_err}')
print(f'  Sin sexo detectado: {len(sin_sexo)} (nombres no en lista)')
print('  Primeros 15 sin sexo:')
for s in sin_sexo[:15]: print(f'    id={s[0]} nombre={s[1]!r} dni={s[2]}')
