"""Re-corrida selectiva: solo clientes Añoreta que les falte gender o cellPhone.
Lista de nombres ampliada (~600 nombres ES+internacional)."""
import openpyxl, re, json, sys, datetime as dt
import requests, hashlib, urllib3, psycopg
from psycopg.rows import dict_row
urllib3.disable_warnings()

XLSX = '/tmp/anyoreta_clientes.xlsx'
MGR = '17674'
TRAINER = '17674'
RE_EMAIL = re.compile(r'^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')

# Lista ampliada — ~600 nombres comunes (ES + internacional)
NOMBRES_F = {
  # España clásicos
  'ANA','MARIA','MARÍA','CARMEN','ISABEL','DOLORES','PILAR','TERESA','ROSA','CRISTINA','SARA',
  'LAURA','MARTA','BEATRIZ','BEA','ELENA','EVA','LUCIA','LUCÍA','PATRICIA','PAULA','SUSANA',
  'SANDRA','SILVIA','ANDREA','RAQUEL','SONIA','GLORIA','ESTHER','YOLANDA','CONCEPCION',
  'CONCEPCIÓN','CONCHA','ROCIO','ROCÍO','INMACULADA','INMA','MANUELA','MERCEDES','MERCHE',
  'ENCARNACION','ENCARNACIÓN','ENCARNA','ANTONIA','JOSEFA','PEPA','FRANCISCA','PAQUI','JUANA',
  'ANGELA','ÁNGELA','MARIBEL','ALMUDENA','CARLA','ADRIANA','OLGA','MONICA','MÓNICA','NATALIA',
  'VERONICA','VERÓNICA','MARINA','ALBA','NURIA','LOURDES','BEGOÑA','BEGO','LORENA','DANIELA',
  'IRENE','GEMMA','GEMA','LOLA','ESPERANZA','MAR','ASUNCION','ASUNCIÓN','CATALINA','LARA',
  'AURORA','INES','INÉS','REYES','CHARO','BELEN','BELÉN','BERTA','VANESSA','TAMARA','SHEILA',
  'AINHOA','AINARA','AITANA','ALICIA','AMELIA','AMPARO','ARIADNA','AROA','CARMELA','CHARI',
  'CHELO','CLARA','CORAL','EDITH','ELISA','EUGENIA','FERNANDA','GABRIELA','HILDA','IVANA',
  'JESSICA','JOAQUINA','JULIA','JULIANA','LINA','MAGDALENA','MARGARITA','MARIAN','MARISOL',
  'MIREIA','NAZARET','NEREA','NIEVES','NOELIA','PAMELA','PURIFICACION','PURIFICACIÓN','RUTH',
  'TANIA','TRINI','URSULA','ÚRSULA','YAIZA','ZAIRA','ZOE','ROSARIO','MELANIA','MELI','MARIOLA',
  'BARBARA','BÁRBARA','SUSI','JESSI','MIRYAM','JESI','KATHERIN','ROSALINDA','ANAÏS','ANAIS',
  'MIRIAM','MYRIAM','SANTI','MAMEN','LIVIA','OLIVIA','CLAUDIA','EMMA','VALERIA','CHLOE',
  'MARTINA','SOFIA','SOFÍA','LUNA','VEGA','CARLOTA','LEIRE','JIMENA','BERENICE','MIRELLA',
  'MELANIE','SAMANTA','SAMANTHA','TANIT','MAITE','MAITENA','MAIA','MAIDER','AROHA','AINOA',
  'DELIA','CELIA','XIMENA','LUZ','DALIA','HIBA','ALEJANDRA','DAFNE','HONORINA','RECAREDA',
  'PRECIOSA','SOL',
  # Hispanos / Latinos
  'ABIGAIL','ADELA','AILEN','AILYN','AIMARA','AIXA','ALDONZA','ALEJANDRINA','ALICIA','ALMA',
  'AMANDA','AMINA','AMIRA','ANABEL','ANGÉLICA','ANGELICA','ANGELINA','ANTONELLA','ARACELI',
  'ARLETTE','ARLETTE','ASIA','AYDA','AYELEN','BÁRBARA','BARBARA','BELINDA','BIBIANA','BLANCA',
  'BRENDA','BRIANA','BRIGIDA','CALA','CANDELA','CANDELARIA','CARMINA','CARMELITA','CAROL',
  'CAROLA','CAROLINA','CASILDA','CECILIA','CELESTE','CELINA','CELESTINA','CHADIA','CHENOA',
  'CHIARA','COLOMBA','COMET','CONSTANZA','CONSTANCE','CORINA','COVADONGA','CRISTAL','DAFNE',
  'DAISY','DANIELLA','DARLENE','DAYANA','DEISY','DIANA','DIVINA','DOLORS','DORA','DOROTEA',
  'EDURNE','ELOISA','ELOÍSA','ELOÍSA','ELOY','ELSA','ELVIRA','ELIANA','EMILIA','EMILIANA',
  'EMPERATRIZ','ERIKA','ERICKA','ERNESTINA','ESPERANZA','ESTEFANIA','ESTEFANÍA','ESTELA',
  'ESTRELLA','ETHEL','EUFRASIA','EULALIA','EUSTAQUIA','EVA','EVELIN','EVELYN','EVITA',
  'EZIA','FANNY','FATIMA','FÁTIMA','FATIHA','FELICIA','FELICIDAD','FILOMENA','FLORA','FLORINDA',
  'FRIDA','GABBY','GABRIELA','GENOVEVA','GIA','GINA','GIORGIA','GIORGINA','GISELE','GISELLE',
  'GLADYS','GLENDA','GUADALUPE','GUDRUN','HALIMA','HARI','HASNA','HEIDI','HELENA','HEMA',
  'HORTENSIA','HOUDA','HUMA','IBET','IBONE','ILDA','ILEANA','INDIRA','INGRID','IRENE','IRINA',
  'IRIS','IRMA','IVET','IVETTE','JADE','JAEL','JANE','JANET','JAQUELINE','JAZMIN','JIMENA',
  'JOANA','JOELY','JOLIETA','JONATHA','JORGELINA','JOSEFA','JOSEFINA','JOSELYN','JUANITA',
  'JULISSA','KARLA','KARINA','KAREN','KATHERINE','KARMA','KATIA','KAREN','LAILA','LAYLA',
  'LARISA','LAURA','LEILA','LEONOR','LESLY','LIDIA','LILIANA','LILY','LINDA','LISA','LIZ',
  'LIZBETH','LIZETH','LOLES','LOURDES','LUCIANA','LUDMILA','LUISA','LUNA','LYDIA','MADELEINE',
  'MADI','MAGALI','MAGDA','MAITE','MALENA','MALIKA','MARCELA','MARCELINA','MARIANA','MARIANNE',
  'MARILYN','MARIPOSA','MARISA','MARLENE','MATILDE','MAYRA','MELISA','MELLISA','MEREDITH',
  'MERY','MICHELLE','MILA','MILAGROS','MIREYA','MOIRA','MONIA','MONSE','MONSERRAT','MORGAN',
  'MORENA','MORENILA','MYRNA','NABILA','NADIA','NAIDA','NANCY','NARA','NATIVIDAD','NAYRA',
  'NICOLE','NIDIA','NINA','NOA','NOEMI','NOEMÍ','NORA','NORMA','NOUR','NUR','OFELIA','OLALLA',
  'OLAYA','ORIANA','ORNELLA','OYANCA','PAULINA','PAOLA','PALOMA','PATRI','PEPA','PETRA','PIA',
  'PILUCA','PRINCESA','PRISCILA','PRISCILLA','PURI','RAFAELA','REBECA','REGINA','REINA',
  'REMEDIOS','ROCÍO','ROMI','ROMINA','ROMINA','ROSANA','ROSAMUNDE','ROSARIO','ROSAURA','ROSAVA',
  'RUFINA','SAEEDA','SAFI','SALIMA','SALOMÉ','SAMIRA','SARAH','SARAY','SAUL','SHAKIRA','SHARA',
  'SHARON','SHEYLA','SILA','SIMONA','SOLEDAD','SOPHIE','STELLA','SUSANNA','SUSI','TANIA',
  'TANIT','THAIS','THANIA','THEA','TICA','TIANA','TINA','TINEKA','TRINIDAD','VALENTINA',
  'VICTORIA','VICKY','VIDA','VIRGINIA','WANDA','WAFA','XANA','YAGO','YANA','YANINA','YANIRA',
  'YASMINA','YESENIA','YOLI','ZAIDA','ZARA','ZENAIDA','ZAINAB',
}
NOMBRES_M = {
  # España clásicos
  'JOSE','JOSÉ','ANTONIO','MANUEL','FRANCISCO','PACO','DAVID','JUAN','JAVIER','JAVI',
  'DANIEL','DANI','JESUS','JESÚS','CARLOS','ALEJANDRO','ALEX','ALEJANDRO','MIGUEL','RAFAEL',
  'RAFA','PEDRO','PABLO','SERGIO','JORGE','ALBERTO','LUIS','ANGEL','ÁNGEL','FERNANDO','FER',
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
  'JOEL','LIAM','GAEL','IZAN','IKER','NICOLAS','NICOLÁS','NICO','LUCA','LAUTARO','AMADO',
  'RAIMUNDO','DARIO','DARÍO','SAMUEL','SAMI','LEVI','BILAL','SERGI','PAU','GUILLEM','ESTEFAN',
  'STEPHAN','STEFAN','BENITO','EVARISTO','GENARO','ELIAS','ELÍAS','TADEO','EZEQUIEL','HARRY',
  'HENRY','BRAULIO',
  # Latinos / Internacionales
  'ABDOULAYE','ABRAHAM','AGUSTIN','AGUSTÍN','AHMAD','AHMED','AITOR','ALDO','ALFONSO','ALFREDO',
  'ALONSO','ALVARO','ÁLVARO','AMADO','AMADEO','AMARO','AMERICO','ANIBAL','ANSELMO','ANXO',
  'APOLINAR','ARMANDO','ARTURO','AURELIO','BACHIR','BADER','BAHA','BALDOMERO','BARTOLOMÉ',
  'BARTOLOMEO','BELTRAN','BENJI','BIENVENIDO','BLAS','BORIS','BRIAN','CAMILO','CASIMIRO',
  'CAYETANO','CESAR','CÉSAR','CIPRIANO','CIRO','CLAUDIO','CLEMENTE','CONRADO','CONSTANTIN',
  'COSME','CRISTOBAL','CRISTÓBAL','DAGOBERTO','DARIUS','DECLAN','DEMETRIO','DIONISIO',
  'DOMINGO','DOMINIK','EDUARD','EDWIN','ELIO','ELISEO','ELOY','EMILIANO','EMILIO','ERNESTO',
  'EVERARDO','FABIAN','FABIÁN','FABIO','FACUNDO','FARID','FAUSTINO','FAUSTO','FAZIL','FELIPE',
  'FERMIN','FERMÍN','FIDEL','FLABIO','FLAVIO','FORTUNATO','FRANCO','FROILAN','FROILÁN',
  'GASPAR','GERARDO','GIANCARLO','GIANNI','GIANLUCA','GILBERTO','GINO','GIOVANNI','GREGORIO',
  'GUSTAVO','HAMID','HANNES','HEDIN','HENRIK','HERIBERTO','HERMENEGILDO','HERNAN','HERNÁN',
  'HILARIO','HIPOLITO','HIRAM','HORACIO','HUMBERTO','IDRISSA','ILYAS','IMRAN','INDALECIO',
  'INOCENCIO','ISIDORO','ISRAEL','JAFAR','JALIL','JEFFERSON','JEREMIAS','JEREMÍAS','JESHUA',
  'JIMMY','JOAB','JONATAN','JONNATHAN','JORDAN','JUDAS','JULIO','KAMAL','KEVIN','KHALED',
  'KIKO','LARS','LEONEL','LIO','LISANDRO','LORENZO','LUCIANO','LUDOVICO','MAHMOUD','MAMADOU',
  'MANOLO','MANSUR','MARCO','MARCUS','MARWAN','MARWIN','MARZIO','MASSIMO','MEHDI','MERLIN',
  'MIKE','MILCO','MILES','MOAD','MORENO','MUSTAFA','NAEL','NANO','NASIR','NAZARETH','NIKLAS',
  'NIKOLA','NILS','NOEL','OBED','ODIN','ORLANDO','OSWALDO','OTHMAN','PEPE','PERICLES','PEYO',
  'PHILIPPE','PIO','PÍO','PLACIDO','PRIMOZ','QUIM','RACHID','RAJ','RAMZI','REGINALDO','REMIGIO',
  'REYNALDO','RICARDO','ROBINSON','ROCCO','RODOLFO','RODRIGO','ROGER','ROLANDO','ROLAND',
  'ROMAN','ROMÁN','ROMUALDO','ROSENDO','RUDY','SALEM','SALVATORE','SAMER','SANSON','SAULO',
  'SEBASTIAN','SEBASTIÁN','SIMON','SIMÓN','SINDO','SOLIMAN','SVEN','TANO','TEDDY','TEODORO',
  'THEO','TIBOR','TIM','TIRSO','TORIBIO','ULISES','USAMA','VALENTIN','VALENTÍN','VALERIO',
  'VALERY','VICTORIANO','VINICIO','VITO','VLADIMIR','VOLODYMYR','WALDO','WALI','WAQAR',
  'WALTER','WILFREDO','WILSON','XAVIER','YOEL','YOSHUA','YOUNES','YOUSSEF','YURI','ZACARIAS',
  'ZACARÍAS','ZAYNE','ZENOBIO','ZIAD',
}

def detectar_sexo(nombre):
    if not nombre: return None
    parts = re.split(r'\s+', nombre.strip().upper())
    if not parts: return None
    primer = parts[0]
    if primer in NOMBRES_F: return 'F'
    if primer in NOMBRES_M: return 'M'
    # Buscar también en segundo token si es nombre compuesto (María José, Jose Manuel)
    if len(parts) >= 2:
        if parts[1] in NOMBRES_F: return 'F'
        if parts[1] in NOMBRES_M: return 'M'
    return None

# ── Cargar datos del Excel + cache local ────────────────────────────────
wb = openpyxl.load_workbook(XLSX, data_only=True)
ws = wb['Clientes alta']
rows = list(ws.iter_rows(values_only=True))
headers = list(rows[0])
data = [dict(zip(headers, r)) for r in rows[1:] if any(r)]
dni_to_row = {(r.get('DNI') or '').strip().upper(): r for r in data}

conn = psycopg.connect(host='/var/run/postgresql', dbname='round_config', user='odoo', row_factory=dict_row)
cur = conn.cursor()
cur.execute("SELECT noofit_email, noofit_password FROM trainer_noofit_creds WHERE id_manager=%s AND id_trainer=%s",
            (MGR, TRAINER))
creds = cur.fetchone()
em_nf, pw_nf = creds['noofit_email'], creds['noofit_password']

# ── Login + listado NF ──────────────────────────────────────────────────
BASE = 'https://pro.wiemspro.com/wiemspro'
r = requests.post(f'{BASE}/account/loginEasy',
    json={'email':em_nf,'appVersion':'1.8.39','password':hashlib.md5(pw_nf.encode()).hexdigest().upper()},
    timeout=15, verify=False)
tok = r.headers['X-CustomToken']; mh = r.headers.get('X-TRAINER_MANAGER','')
H = {'X-CustomToken':tok,'locale':'es','appVersion':'1.8.39','appId':'1',
     'X-TRAINER_MANAGER':str(mh) if mh else 'true','Content-Type':'application/json'}
r = requests.get(f'{BASE}/api/dispositivos/getClienteSimple', headers=H, timeout=30, verify=False)
nf_clientes = (r.json() or {}).get('clientes') or []

# Filtrar SOLO los que les falte gender o cellPhone
faltantes = [c for c in nf_clientes
             if not c.get('gender') or not c.get('cellPhone')]
print(f'Total NF: {len(nf_clientes)} | a re-procesar: {len(faltantes)}')

def parse_fecha_excel(v):
    if v is None: return None
    if isinstance(v, dt.datetime): return v.date().isoformat()
    if isinstance(v, dt.date): return v.isoformat()
    s = str(v).strip()
    if re.match(r'^\d{4}-\d{2}-\d{2}', s): return s[:10]
    return None

def fecha_mas_uno(iso):
    if not iso: return None
    return (dt.date.fromisoformat(iso) + dt.timedelta(days=1)).isoformat()

n_upd = n_err = n_skip = 0
sin_sexo_aun = []

for i, current in enumerate(faltantes, 1):
    dni_nf = (current.get('dni') or '').upper()
    row = dni_to_row.get(dni_nf)
    if not row:
        n_skip += 1; continue
    movil = re.sub(r'\D', '', (row.get('Móvil') or '').strip())
    fnac = parse_fecha_excel(row.get('F. nacimiento'))
    fnac_nf = fecha_mas_uno(fnac) if fnac else None
    sexo = detectar_sexo((row.get('Nombre') or '').strip())
    domicilio = (row.get('Domicilio') or '').strip()
    cp = str(row.get('CP') or '').strip()
    poblacion = (row.get('Población') or '').strip()
    full_address = domicilio
    if poblacion: full_address = f'{domicilio}, {poblacion}'.strip(', ')
    if sexo is None:
        sin_sexo_aun.append((current['id'], row.get('Nombre'), dni_nf))

    payload = {**current,
        'cellPhone': movil or current.get('cellPhone'),
        'birthdate': fnac_nf or current.get('birthdate'),
        'gender': sexo or current.get('gender'),
        'address': full_address or current.get('address'),
        'postal_code': cp or current.get('postal_code'),
        'toSend': False, 'enabled': True,
    }
    try:
        r = requests.post(f'{BASE}/api/dispositivos/clientePlusv2', headers=H,
                          json=[payload], timeout=30, verify=False)
        r.raise_for_status()
        n_upd += 1
    except Exception as e:
        n_err += 1
        if n_err <= 5: print(f'  ❌ {dni_nf}: {str(e)[:80]}', flush=True)
    if i % 25 == 0: print(f'  {i}/{len(faltantes)} (upd={n_upd})', flush=True)

print(f'\n=== RESULTADO ===')
print(f'  Actualizados: {n_upd}')
print(f'  Errores:      {n_err}')
print(f'  Skip:         {n_skip}')
print(f'  Sin sexo aún: {len(sin_sexo_aun)}')
for s in sin_sexo_aun: print(f'    id={s[0]} nombre={s[1]!r} dni={s[2]}')
