"""Ampliación: TODOS los fantasmas reservando en trainer 17675 (365d) +
clasificación heurística (Round real vs demo NoofitPro)."""
import re
from datetime import date, timedelta
from collections import Counter
from app.db import get_conn
from app import noofit_client as nc

ID_MANAGER = '17675'
TRAINER = 17675

# Cache local
with get_conn() as conn, conn.cursor() as cur:
    cur.execute("SELECT id FROM cliente_cache WHERE id_manager=%s", (ID_MANAGER,))
    cache_ids = {int(r['id']) for r in cur.fetchall()}

# Reservas 365d
hoy = date.today()
desde = (hoy - timedelta(days=365)).isoformat() + 'T00:00:00+02:00'
hasta = (hoy + timedelta(days=1)).isoformat() + 'T00:00:00+02:00'
reservas = nc.get_reservas_confirmadas(desde, hasta) or []
reservas_t = [r for r in reservas if str(r.get('id_trainer')) == str(TRAINER)]
print(f'reservas trainer {TRAINER} (365d): {len(reservas_t)}')

# Agrupar por cliente
por_cli = {}
for r in reservas_t:
    cid = int(r['cliente_id'])
    por_cli.setdefault(cid, []).append(r)

fantasmas = sorted(set(por_cli) - cache_ids)
print(f'fantasmas (reservan + no en cache): {len(fantasmas)}')

# Cross-manager
with get_conn() as conn, conn.cursor() as cur:
    if fantasmas:
        ph = ','.join(['%s']*len(fantasmas))
        cur.execute(f"SELECT id, id_manager FROM cliente_cache WHERE id IN ({ph})", list(fantasmas))
        cross = {int(r['id']): r['id_manager'] for r in cur.fetchall()}
    else:
        cross = {}

# Heurísticas
PATRON_DEMO = re.compile(r'(noofit|barbi|prueba|display|muestra|descarga|presentaci|^moi-|^ed$|^lajara$|^ana\s?[mp]$|R4W$)', re.IGNORECASE)
PATRON_DEMO_ACT = re.compile(r'(prueba|display|muestra|descarga|presentaci|sala ciclo oficina|vídeo|video|moi)', re.IGNORECASE)

# Para cada fantasma: nombre, reservas, actividades, ¿probable Round real?
probables_round = []
probables_demo = []
ambiguos = []

for cid in fantasmas:
    rs = por_cli[cid]
    nombre = next((r.get('cliente_nombre') for r in rs if r.get('cliente_nombre')), '')
    acts = sorted({r.get('actividad_nombre') for r in rs if r.get('actividad_nombre')})
    fechas = sorted({r.get('fecha') for r in rs if r.get('fecha')})
    is_cross = cid in cross
    # Heurística:
    #   demo si el nombre o las actividades casan con patrones de demo,
    #     o si el nombre no tiene espacio (sin apellido).
    #   probable Round si tiene nombre+apellido real (un espacio) y todas
    #     las actividades son RT / Ciclo by NooFit estándar / R4W,
    #     y no casa con patrones demo en el nombre.
    n = (nombre or '').strip()
    es_demo_nombre = bool(PATRON_DEMO.search(n)) if n else False
    es_demo_act = any(PATRON_DEMO_ACT.search(a or '') for a in acts)
    tiene_apellido = ' ' in n and len(n.split()) >= 2 and all(p.isalpha() or p in ('-', '.') for p in n.replace(' ','').replace('-','').replace('.','')) if n else False
    # Si NoNoOf o demo claro
    if is_cross:
        ambiguos.append((cid, n, len(rs), acts, fechas, f'CROSS:{cross[cid]}'))
    elif es_demo_nombre or all(PATRON_DEMO_ACT.search(a or '') for a in acts) and acts:
        probables_demo.append((cid, n, len(rs), acts, fechas))
    elif tiene_apellido and not es_demo_nombre and not es_demo_act:
        probables_round.append((cid, n, len(rs), acts, fechas, 'apellido+act_real'))
    elif n and n.endswith(('-ga','-Ál','-Ji','-Ra','-Ro','-Ru','-Lo','-Lá','-La','-Al')):
        # sufijo Round-style → muy probable
        probables_round.append((cid, n, len(rs), acts, fechas, 'sufijo_round'))
    else:
        ambiguos.append((cid, n, len(rs), acts, fechas, 'sin_clasificar'))

print(f'\n=== PROBABLES Round Málaga (reales): {len(probables_round)} ===')
for cid, n, nr, acts, fechas, why in probables_round:
    print(f'  {cid}  {n!r:35}  reservas={nr:>3}  {fechas[0] if fechas else "?":>10} → {fechas[-1] if fechas else "?":>10}  [{why}]')
    print(f'     acts: {acts}')

print(f'\n=== PROBABLES Demo NoofitPro: {len(probables_demo)} ===')
for cid, n, nr, acts, fechas in probables_demo:
    print(f'  {cid}  {n!r:30}  reservas={nr:>3}  acts={acts}')

print(f'\n=== AMBIGUOS / cross-manager: {len(ambiguos)} ===')
for cid, n, nr, acts, fechas, why in ambiguos:
    print(f'  {cid}  {n!r:30}  reservas={nr:>3}  [{why}]  acts={acts[:3]}')
