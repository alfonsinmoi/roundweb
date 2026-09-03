"""Informe de COMPETICIONES realizadas por los clientes (v2 — sep 2026).

Fuente REAL en NoofitPro: el namespace `/api/competicion/*` (no las salas):

  GET /api/competicion/ediciones/all      → ediciones oficiales (cada una con idCircuito)
  GET /api/competicion/circuitos/all      → 42 circuitos (oficial + wod + mygym)
                                            separables por flags `oficial` y `wod`.
  GET /api/competicion/participaciones/cliente/{idCliente}  → fila por participación,
                                            fuente autoritativa (una llamada por cliente).

Modalidad derivada del circuito:
  circuito.oficial=true → 'oficial'
  circuito.wod=true     → 'wod'
  resto                 → 'mygym'

Cache local en tres tablas:
  competicion_circuito         (id_manager, id_circuito)
  competicion_edicion          (id_manager, id_edicion)
  competicion_participacion    (id_manager, participacion_id)

Estado del barrido en competicion_sync (1 fila por manager).

La versión anterior (v1) consultaba `getSalasByManagerByRange` filtrando por
un flag `sala.competicion=true` que en la práctica nadie usa (0 salas con el
flag), por lo que el informe salía siempre vacío aunque hubiese cientos de
participaciones registradas en el namespace `/competicion/*`. La tabla
`competicion_realizada` de la v1 queda deprecated (0 filas).
"""
import datetime as dt
import logging
import threading
import time

import requests
from flask import Blueprint, request, jsonify, g

from functools import wraps
from ..auth import auth_required, resolve_trainer_target
from ..auth_usuario import usuario_web_required
from ..db import get_conn
from ..audit_log import log_action, actor_from_request

bp = Blueprint('informe_competiciones', __name__)
log = logging.getLogger(__name__)

NF_BASE = 'https://pro.wiemspro.com/wiemspro'
APP_VER = '1.8.39'

SYNC_MASIVO_MIN_INTERVALO_SEG = 60
SYNC_TTL_HORAS = 12
PARTICIPACIONES_TIMEOUT = 15   # segundos por cliente

_bg_lock = threading.Lock()
_bg_running = set()
_bg_last_run = {}


def either_auth(fn):
    """Acepta X-Round-Token (manager) o JWT Bearer (usuario_web)."""
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if request.headers.get('Authorization', '').startswith('Bearer '):
            return usuario_web_required(fn)(*args, **kwargs)
        return auth_required(fn)(*args, **kwargs)
    return wrapper


def _login(email, pwd):
    from .estado_fisico import _login as ef_login
    return ef_login(email, pwd)


def _trainers_creds(id_manager, id_trainer=None):
    from .estado_fisico import _trainers_creds as ef_creds
    return ef_creds(id_manager, id_trainer)


def _headers(token, mgr):
    return {'X-CustomToken': token, 'X-TRAINER_MANAGER': str(mgr or ''),
            'locale': 'es', 'appVersion': APP_VER, 'appId': '1',
            'Content-Type': 'application/json'}


def _epoch_to_ts(v):
    try:
        if isinstance(v, (int, float)) and v > 10 ** 10:
            return dt.datetime.fromtimestamp(v / 1000, dt.timezone.utc)
    except Exception:
        pass
    return None


def _parse_dt(v):
    """Parsea 'YYYY-MM-DD HH:MM:SS' o epoch ms a datetime UTC-aware."""
    if not v:
        return None
    if isinstance(v, (int, float)):
        return _epoch_to_ts(v)
    if isinstance(v, str):
        try:
            # Formato NoofitPro: 'YYYY-MM-DD HH:MM:SS'
            return dt.datetime.strptime(v[:19], '%Y-%m-%d %H:%M:%S').replace(tzinfo=dt.timezone.utc)
        except Exception:
            return None
    return None


def _modalidad(circuito):
    """Deriva la modalidad de un dict de circuito."""
    if circuito.get('oficial'):
        return 'oficial'
    if circuito.get('wod'):
        return 'wod'
    return 'mygym'


# ── Sync ────────────────────────────────────────────────────────────────────

def _upsert_circuitos(id_manager, circuitos):
    """UPSERT del catálogo de circuitos. Devuelve dict id→modalidad para el
    barrido de participaciones."""
    map_mod = {}
    map_nombre = {}
    if not circuitos:
        return map_mod, map_nombre
    import json
    with get_conn() as conn, conn.cursor() as cur:
        for c in circuitos:
            cid = c.get('id')
            if not cid:
                continue
            mod = _modalidad(c)
            map_mod[int(cid)] = mod
            map_nombre[int(cid)] = c.get('nombre') or ''
            cur.execute("""
                INSERT INTO competicion_circuito (
                    id_manager, id_circuito, nombre, descripcion,
                    oficial, wod, modalidad, dificultad, num_estaciones,
                    rondas, descanso_ronda, fecha_creacion, raw_data
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb)
                ON CONFLICT (id_manager, id_circuito) DO UPDATE SET
                    nombre           = EXCLUDED.nombre,
                    descripcion      = EXCLUDED.descripcion,
                    oficial          = EXCLUDED.oficial,
                    wod              = EXCLUDED.wod,
                    modalidad        = EXCLUDED.modalidad,
                    dificultad       = EXCLUDED.dificultad,
                    num_estaciones   = EXCLUDED.num_estaciones,
                    rondas           = EXCLUDED.rondas,
                    descanso_ronda   = EXCLUDED.descanso_ronda,
                    fecha_creacion   = EXCLUDED.fecha_creacion,
                    raw_data         = EXCLUDED.raw_data,
                    synced_at        = NOW()
            """, (str(id_manager), int(cid),
                  (c.get('nombre') or '').strip()[:240] or None,
                  c.get('descripcion') or None,
                  bool(c.get('oficial')), bool(c.get('wod')), mod,
                  c.get('dificultad'), c.get('numEstaciones'),
                  c.get('rondas'), c.get('descansoRonda'),
                  _parse_dt(c.get('fechaCreacion')),
                  json.dumps(c, ensure_ascii=False)))
    return map_mod, map_nombre


def _upsert_ediciones(id_manager, ediciones):
    """UPSERT del catálogo de ediciones. Devuelve nº guardadas."""
    if not ediciones:
        return 0
    import json
    n = 0
    with get_conn() as conn, conn.cursor() as cur:
        for e in ediciones:
            eid = e.get('id')
            if not eid:
                continue
            cur.execute("""
                INSERT INTO competicion_edicion (
                    id_manager, id_edicion, nombre, id_circuito, estado,
                    fecha_inicio, fecha_fin, fecha_cierre, ambito, tipo,
                    escala_por_sexo, raw_data
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb)
                ON CONFLICT (id_manager, id_edicion) DO UPDATE SET
                    nombre           = EXCLUDED.nombre,
                    id_circuito      = EXCLUDED.id_circuito,
                    estado           = EXCLUDED.estado,
                    fecha_inicio     = EXCLUDED.fecha_inicio,
                    fecha_fin        = EXCLUDED.fecha_fin,
                    fecha_cierre     = EXCLUDED.fecha_cierre,
                    ambito           = EXCLUDED.ambito,
                    tipo             = EXCLUDED.tipo,
                    escala_por_sexo  = EXCLUDED.escala_por_sexo,
                    raw_data         = EXCLUDED.raw_data,
                    synced_at        = NOW()
            """, (str(id_manager), int(eid),
                  (e.get('nombre') or '').strip()[:240] or None,
                  int(e['idCircuito']) if e.get('idCircuito') else None,
                  (e.get('estado') or '').strip()[:32] or None,
                  _parse_dt(e.get('fechaInicio')),
                  _parse_dt(e.get('fechaFin')),
                  _parse_dt(e.get('fechaCierre')),
                  (e.get('ambito') or '').strip()[:64] or None,
                  (e.get('tipo') or '').strip()[:64] or None,
                  bool(e.get('escalaPorSexo')) if e.get('escalaPorSexo') is not None else None,
                  json.dumps(e, ensure_ascii=False)))
            n += 1
    return n


def _resolve_circuito_ondemand(id_manager, cid, headers, map_mod, map_nombre, cache_fallidos):
    """Si `cid` no está en el catálogo local, lo pide a NoofitPro
    (GET /circuitos/{cid}) y lo guarda en `competicion_circuito`. Rellena
    los maps in-place. Idempotente por (id_manager, id_circuito).

    `cache_fallidos` es un set con los cids que ya fallaron para no reintentar.
    """
    if not cid or cid in map_mod or cid in cache_fallidos:
        return
    try:
        r = requests.get(f'{NF_BASE}/api/competicion/circuitos/{cid}',
                         headers=headers, verify=False, timeout=10)
        if r.status_code != 200 or not r.text:
            cache_fallidos.add(cid)
            return
        c = r.json()
        if not isinstance(c, dict):
            cache_fallidos.add(cid)
            return
    except Exception:
        cache_fallidos.add(cid)
        return
    _upsert_circuitos(id_manager, [c])
    map_mod[int(cid)] = _modalidad(c)
    map_nombre[int(cid)] = c.get('nombre') or ''


def _upsert_participaciones(id_manager, participaciones, map_mod, map_nombre,
                            headers=None, cache_fallidos=None):
    """UPSERT participaciones de un cliente. Devuelve nº guardadas."""
    if not participaciones:
        return 0
    import json
    n = 0
    if cache_fallidos is None:
        cache_fallidos = set()
    with get_conn() as conn, conn.cursor() as cur:
        for p in participaciones:
            pid = p.get('id')
            cli = p.get('idCliente')
            if not pid or not cli:
                continue
            cid = p.get('idCircuito')
            if cid and headers is not None:
                _resolve_circuito_ondemand(id_manager, int(cid), headers,
                                           map_mod, map_nombre, cache_fallidos)
            mod = map_mod.get(int(cid)) if cid else None
            # Fallback: participación con idEdicion es siempre 'oficial'
            if not mod and p.get('idEdicion'):
                mod = 'oficial'
            circ_nombre = map_nombre.get(int(cid)) if cid else None
            cur.execute("""
                INSERT INTO competicion_participacion (
                    id_manager, participacion_id, id_cliente, cliente_nombre,
                    id_circuito, id_edicion, circuito_nombre, modalidad,
                    fecha_realizado, completado, publicado,
                    sexo_snapshot, edad_snapshot, grupo_edad_snapshot,
                    categoria_snapshot, num_estaciones_snapshot,
                    rondas_snapshot, dificultad_snapshot, id_manager_snapshot,
                    raw_data
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb)
                ON CONFLICT (id_manager, participacion_id) DO UPDATE SET
                    id_cliente             = EXCLUDED.id_cliente,
                    cliente_nombre         = EXCLUDED.cliente_nombre,
                    id_circuito            = EXCLUDED.id_circuito,
                    id_edicion             = EXCLUDED.id_edicion,
                    circuito_nombre        = EXCLUDED.circuito_nombre,
                    modalidad              = EXCLUDED.modalidad,
                    fecha_realizado        = EXCLUDED.fecha_realizado,
                    completado             = EXCLUDED.completado,
                    publicado              = EXCLUDED.publicado,
                    sexo_snapshot          = EXCLUDED.sexo_snapshot,
                    edad_snapshot          = EXCLUDED.edad_snapshot,
                    grupo_edad_snapshot    = EXCLUDED.grupo_edad_snapshot,
                    categoria_snapshot     = EXCLUDED.categoria_snapshot,
                    num_estaciones_snapshot= EXCLUDED.num_estaciones_snapshot,
                    rondas_snapshot        = EXCLUDED.rondas_snapshot,
                    dificultad_snapshot    = EXCLUDED.dificultad_snapshot,
                    id_manager_snapshot    = EXCLUDED.id_manager_snapshot,
                    raw_data               = EXCLUDED.raw_data,
                    synced_at              = NOW()
            """, (str(id_manager), int(pid), int(cli),
                  (p.get('nombreClienteSnapshot') or '').strip()[:240] or None,
                  int(cid) if cid else None,
                  int(p['idEdicion']) if p.get('idEdicion') else None,
                  (circ_nombre or '')[:240] or None,
                  mod,
                  _parse_dt(p.get('fechaRealizado')),
                  bool(p.get('completado')),
                  bool(p.get('publicado')) if p.get('publicado') is not None else None,
                  (p.get('sexoSnapshot') or '')[:2] or None,
                  p.get('edadSnapshot'),
                  (p.get('grupoEdadSnapshot') or '').strip()[:32] or None,
                  p.get('categoriaSnapshot'),
                  p.get('numEstacionesSnapshot'),
                  p.get('rondasSnapshot'),
                  p.get('dificultadSnapshot'),
                  str(p.get('idManagerSnapshot') or '') or None,
                  json.dumps(p, ensure_ascii=False)))
            n += 1
    return n


def _marcar_sync(id_manager, *, n_circ=0, n_edi=0, n_comp=0, n_part=0, falla=None):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            INSERT INTO competicion_sync
                (id_manager, synced_at, n_circuitos, n_ediciones,
                 n_competiciones, n_participaciones, ultima_falla)
            VALUES (%s, NOW(), %s, %s, %s, %s, %s)
            ON CONFLICT (id_manager) DO UPDATE SET
                synced_at         = NOW(),
                n_circuitos       = EXCLUDED.n_circuitos,
                n_ediciones       = EXCLUDED.n_ediciones,
                n_competiciones   = EXCLUDED.n_competiciones,
                n_participaciones = EXCLUDED.n_participaciones,
                ultima_falla      = EXCLUDED.ultima_falla
        """, (str(id_manager), n_circ, n_edi, n_comp, n_part,
              (str(falla)[:300] if falla else None)))


def _sync_all(id_manager, id_trainer=None, only_stale=True, desde=None, hasta=None):
    """Barre circuitos + ediciones + participaciones. Los rangos `desde/hasta`
    se ignoran (el endpoint /participaciones/cliente/{id} no acepta ventana);
    se persisten TODAS las participaciones históricas del cliente y luego el
    endpoint agregado filtra en SQL."""
    key = (str(id_manager), str(id_trainer or ''))
    now = time.time()
    with _bg_lock:
        if key in _bg_running:
            return {'skipped': True, 'reason': 'in_progress'}
        last = _bg_last_run.get(key, 0)
        if only_stale and (now - last) < SYNC_MASIVO_MIN_INTERVALO_SEG:
            return {'skipped': True, 'reason': 'too_recent'}
        _bg_running.add(key)
    try:
        creds = list(_trainers_creds(id_manager, None))
        if not creds:
            _marcar_sync(id_manager, falla='sin_credenciales_trainer')
            return {'ok': False, 'error': 'sin_credenciales'}
        tid, email, pwd = creds[0]
        try:
            tok, mgr_h = _login(email, pwd)
        except Exception as e:
            _marcar_sync(id_manager, falla=e)
            log.warning(f'competiciones login manager={id_manager}: {e}')
            return {'ok': False, 'error': 'login'}

        H = _headers(tok, mgr_h)

        # 1) Circuitos
        try:
            r = requests.get(f'{NF_BASE}/api/competicion/circuitos/all',
                             headers=H, verify=False, timeout=30)
            circuitos = r.json() if r.text else []
            if not isinstance(circuitos, list):
                circuitos = []
        except Exception as e:
            _marcar_sync(id_manager, falla=f'circuitos:{e}')
            return {'ok': False, 'error': 'fetch_circuitos'}
        map_mod, map_nombre = _upsert_circuitos(id_manager, circuitos)
        n_circ = len(circuitos)

        # 2) Ediciones
        try:
            r = requests.get(f'{NF_BASE}/api/competicion/ediciones/all',
                             headers=H, verify=False, timeout=30)
            ediciones = r.json() if r.text else []
            if not isinstance(ediciones, list):
                ediciones = []
        except Exception as e:
            log.warning(f'competiciones ediciones/all manager={id_manager}: {e}')
            ediciones = []
        n_edi = _upsert_ediciones(id_manager, ediciones)

        # 3) Participaciones: barrer todos los clientes del manager (o del
        # trainer si se filtró). El endpoint por cliente devuelve el histórico
        # completo — el rango se aplica en SQL al leer.
        with get_conn() as conn, conn.cursor() as cur:
            if id_trainer:
                cur.execute("SELECT id FROM cliente_cache "
                            "WHERE id_manager=%s AND id_trainer::text=%s",
                            (str(id_manager), str(id_trainer)))
            else:
                cur.execute("SELECT id FROM cliente_cache WHERE id_manager=%s",
                            (str(id_manager),))
            cliente_ids = [r['id'] for r in cur.fetchall()]

        n_part = 0
        errores = 0
        cache_fallidos = set()
        for cid in cliente_ids:
            try:
                r = requests.get(
                    f'{NF_BASE}/api/competicion/participaciones/cliente/{cid}',
                    headers=H, verify=False, timeout=PARTICIPACIONES_TIMEOUT)
                if r.status_code != 200:
                    continue
                parts = r.json() if r.text else []
                if not isinstance(parts, list) or not parts:
                    continue
                n_part += _upsert_participaciones(id_manager, parts,
                                                  map_mod, map_nombre,
                                                  headers=H,
                                                  cache_fallidos=cache_fallidos)
            except Exception as e:
                errores += 1
                if errores <= 3:
                    log.warning(f'competiciones part cliente={cid} mgr={id_manager}: {e}')
                if errores > 20:
                    break

        # Contadores totales acumulados para el estado
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""SELECT COUNT(DISTINCT id_circuito) c, COUNT(*) p
                             FROM competicion_participacion
                            WHERE id_manager=%s""",
                        (str(id_manager),))
            row = cur.fetchone() or {}
        _marcar_sync(id_manager, n_circ=n_circ, n_edi=n_edi,
                     n_comp=row.get('c') or 0, n_part=row.get('p') or 0)
        return {'ok': True,
                'circuitos_barridos': n_circ,
                'ediciones_barridas': n_edi,
                'clientes_barridos': len(cliente_ids),
                'participaciones_upsert': n_part,
                'errores_por_cliente': errores}
    finally:
        with _bg_lock:
            _bg_running.discard(key)
            _bg_last_run[key] = time.time()


def _sync_background(id_manager, id_trainer=None):
    threading.Thread(target=_sync_all, args=(id_manager, id_trainer),
                     kwargs={'only_stale': True}, daemon=True).start()


def _parse_fecha(v, default):
    try:
        return dt.date.fromisoformat((v or '').strip())
    except Exception:
        return default


# ── Endpoints ────────────────────────────────────────────────────────────────

@bp.route('/competiciones', methods=['GET'])
@either_auth
def informe_competiciones():
    hoy = dt.date.today()
    desde = _parse_fecha(request.args.get('desde'), hoy - dt.timedelta(days=365))
    hasta = _parse_fecha(request.args.get('hasta'), hoy)
    limit = min(int(request.args.get('limit', 100) or 100), 500)
    modalidad = (request.args.get('modalidad') or '').strip().lower()
    if modalidad and modalidad not in ('oficial', 'mygym', 'wod'):
        modalidad = ''
    sexo = (request.args.get('sexo') or '').strip().upper()
    if sexo not in ('M', 'F'):
        sexo = ''
    try:
        categoria_id = int(request.args.get('categoria') or 0) or None
    except (TypeError, ValueError):
        categoria_id = None

    where = ["p.id_manager = %s",
             "p.fecha_realizado >= %s",
             "p.fecha_realizado < %s::date + 1"]
    vals = [str(g.id_manager), desde, hasta]

    id_trainer, forbidden = resolve_trainer_target(request.args.get('id_trainer'))
    if forbidden:
        return jsonify({'ok': False, 'error': 'trainer_forbidden'}), 403
    if id_trainer:
        # participacion no tiene id_trainer; filtramos por clientes del trainer
        where.append("""p.id_cliente IN (
            SELECT id FROM cliente_cache
             WHERE id_manager = %s AND id_trainer::text = %s
        )""")
        vals.extend([str(g.id_manager), str(id_trainer)])

    if modalidad:
        where.append("p.modalidad = %s")
        vals.append(modalidad)

    if sexo:
        where.append("p.sexo_snapshot = %s")
        vals.append(sexo)

    if categoria_id:
        # categoría de cliente Round (tabla cliente_categoria). El campo
        # cliente_idnoofit está como VARCHAR, id_cliente en la participación
        # es BIGINT, por eso el CAST.
        where.append("""p.id_cliente::text IN (
            SELECT cliente_idnoofit FROM cliente_categoria
             WHERE id_manager = %s AND categoria_id = %s
        )""")
        vals.extend([str(g.id_manager), categoria_id])

    base = f"FROM competicion_participacion p WHERE {' AND '.join(where)}"

    with get_conn() as conn, conn.cursor() as cur:
        # Totales globales del filtro
        cur.execute(f"""SELECT COUNT(DISTINCT p.id_circuito) AS competiciones,
                               COUNT(*) AS participaciones,
                               COUNT(DISTINCT p.id_cliente) AS clientes
                        {base}""", vals)
        totales = dict(cur.fetchone() or {})

        # Totales por modalidad
        cur.execute(f"""SELECT p.modalidad,
                               COUNT(DISTINCT p.id_circuito) AS competiciones,
                               COUNT(*) AS participaciones,
                               COUNT(DISTINCT p.id_cliente) AS clientes
                        {base}
                        GROUP BY p.modalidad""", vals)
        por_modalidad = [dict(r) for r in cur.fetchall()]

        # Ranking de competiciones (cada circuito) por participaciones
        cur.execute(f"""SELECT p.id_circuito,
                               MAX(p.circuito_nombre) AS nombre,
                               MAX(p.modalidad)       AS modalidad,
                               MAX(p.fecha_realizado) AS fecha,
                               COUNT(*)               AS participantes,
                               COUNT(DISTINCT p.id_cliente) AS clientes_distintos
                        {base}
                        GROUP BY p.id_circuito
                        ORDER BY fecha DESC NULLS LAST
                        LIMIT %s""", vals + [limit])
        competiciones = [dict(r) for r in cur.fetchall()]

        # Clientes participantes (TODOS los que aparecen en el filtro).
        # Ordenación por defecto: competiciones desc, participaciones desc.
        # El frontend permite reordenar client-side.
        cur.execute(f"""SELECT p.id_cliente,
                               MAX(p.cliente_nombre) AS nombre,
                               MAX(p.sexo_snapshot)  AS sexo,
                               MAX(p.grupo_edad_snapshot) AS grupo_edad,
                               COUNT(DISTINCT p.id_circuito) AS competiciones,
                               COUNT(*)                       AS participaciones,
                               MAX(p.fecha_realizado)         AS ultima_fecha
                        {base}
                        GROUP BY p.id_cliente
                        ORDER BY competiciones DESC, participaciones DESC""",
                    vals)
        top_clientes = [dict(r) for r in cur.fetchall()]
        for r in top_clientes:
            if isinstance(r.get('ultima_fecha'), dt.datetime):
                r['ultima_fecha'] = r['ultima_fecha'].isoformat()

        # Serie diaria (día → participaciones + clientes distintos)
        cur.execute(f"""SELECT DATE(p.fecha_realizado) AS dia,
                               COUNT(*) AS participaciones,
                               COUNT(DISTINCT p.id_cliente) AS clientes
                        {base}
                        GROUP BY DATE(p.fecha_realizado)
                        ORDER BY dia""", vals)
        serie_diaria_raw = [dict(r) for r in cur.fetchall()]

        # Por día de la semana (DOW en Postgres: 0=domingo … 6=sábado).
        cur.execute(f"""SELECT EXTRACT(DOW FROM p.fecha_realizado)::int AS dow,
                               COUNT(*) AS participaciones,
                               COUNT(DISTINCT p.id_cliente) AS clientes
                        {base}
                        GROUP BY EXTRACT(DOW FROM p.fecha_realizado)
                        ORDER BY dow""", vals)
        pdw_raw = {int(r['dow']): dict(r) for r in cur.fetchall()}

    for coll in (competiciones,):
        for r in coll:
            if isinstance(r.get('fecha'), dt.datetime):
                r['fecha'] = r['fecha'].isoformat()

    # Serie diaria: relleno de días sin participaciones con 0 (para pintar
    # una línea continua sin huecos raros).
    serie_por_dia = {}
    for r in serie_diaria_raw:
        d = r.get('dia')
        if isinstance(d, dt.date):
            serie_por_dia[d.isoformat()] = r
    serie_diaria = []
    if desde and hasta:
        cur_dia = desde
        while cur_dia <= hasta:
            iso = cur_dia.isoformat()
            row = serie_por_dia.get(iso)
            serie_diaria.append({
                'dia': iso,
                'participaciones': int(row['participaciones']) if row else 0,
                'clientes': int(row['clientes']) if row else 0,
            })
            cur_dia += dt.timedelta(days=1)

    # Por día de la semana: normalizado a lunes-primero.
    # dow_map: entero PostgreSQL (0=dom … 6=sáb) → índice lunes-primero (0..6)
    DIAS_ES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
    PG_TO_LUN = {1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 0: 6}
    por_dia_semana = [{'dow': i, 'nombre': DIAS_ES[i],
                       'participaciones': 0, 'clientes': 0}
                      for i in range(7)]
    for pg_dow, r in pdw_raw.items():
        idx = PG_TO_LUN.get(pg_dow)
        if idx is None:
            continue
        por_dia_semana[idx]['participaciones'] = int(r['participaciones'])
        por_dia_semana[idx]['clientes'] = int(r['clientes'])

    return jsonify({'ok': True,
                    'desde': desde.isoformat(), 'hasta': hasta.isoformat(),
                    'modalidad': modalidad or None,
                    'sexo': sexo or None,
                    'categoria_id': categoria_id,
                    'totales': totales,
                    'por_modalidad': por_modalidad,
                    'competiciones': competiciones,
                    'top_clientes': top_clientes,
                    'serie_diaria': serie_diaria,
                    'por_dia_semana': por_dia_semana})


@bp.route('/competiciones/estado', methods=['GET'])
@either_auth
def estado_sync():
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT COUNT(*) AS filas,
                              COUNT(DISTINCT id_circuito) AS competiciones,
                              COUNT(DISTINCT id_cliente)  AS clientes,
                              MIN(fecha_realizado) AS fecha_min,
                              MAX(fecha_realizado) AS fecha_max
                         FROM competicion_participacion
                        WHERE id_manager=%s""",
                    (str(g.id_manager),))
        datos = dict(cur.fetchone() or {})
        cur.execute("""SELECT modalidad,
                              COUNT(DISTINCT id_circuito) AS competiciones,
                              COUNT(*) AS participaciones,
                              COUNT(DISTINCT id_cliente) AS clientes
                         FROM competicion_participacion
                        WHERE id_manager=%s
                        GROUP BY modalidad""",
                    (str(g.id_manager),))
        por_modalidad = [dict(r) for r in cur.fetchall()]
        cur.execute("""SELECT synced_at AS ultimo_sync,
                              n_circuitos, n_ediciones,
                              n_competiciones, n_participaciones,
                              ultima_falla
                         FROM competicion_sync WHERE id_manager=%s""",
                    (str(g.id_manager),))
        sync = dict(cur.fetchone() or {})
    for d in (datos, sync):
        for k, v in list(d.items()):
            if isinstance(v, dt.datetime):
                d[k] = v.isoformat()
    return jsonify({'ok': True, 'por_modalidad': por_modalidad,
                    **datos, **sync})


@bp.route('/competiciones/cliente/<int:idnoofit>', methods=['GET'])
@either_auth
def competiciones_cliente(idnoofit):
    """Historial de competiciones de un cliente (lee BD; dispara barrido bg si stale)."""
    _sync_background(g.id_manager, g.id_trainer)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT participacion_id, id_circuito, id_edicion,
                              circuito_nombre, modalidad,
                              fecha_realizado, completado,
                              sexo_snapshot, edad_snapshot,
                              grupo_edad_snapshot, categoria_snapshot,
                              num_estaciones_snapshot,
                              COALESCE(
                                  (raw_data->>'tiempoTotalMs')::bigint,
                                  ((raw_data->>'tiempoTotalSegundos')::float * 1000)::bigint
                              ) AS tiempo_total_ms,
                              (raw_data->>'puntosTotales')::float AS puntos_totales,
                              (raw_data->>'repsValidasTotales')::int AS reps_validas
                         FROM competicion_participacion
                        WHERE id_manager=%s AND id_cliente=%s
                        ORDER BY fecha_realizado DESC NULLS LAST""",
                    (str(g.id_manager), int(idnoofit)))
        rows = [dict(r) for r in cur.fetchall()]
    for r in rows:
        for k in ('fecha_realizado',):
            if isinstance(r.get(k), dt.datetime):
                r[k] = r[k].isoformat()
    return jsonify({'ok': True, 'competiciones': rows, 'total': len(rows),
                    'fuente': 'local'})


# ── Detalle expandible: participaciones filtradas ─────────────────────────
# Se usan desde las tablas del informe (drilldown al desplegar una fila).
# Reciben los mismos filtros (fechas, modalidad, sexo, categoría, id_trainer)
# para que el detalle sea coherente con la vista agregada.

def _filtro_where_participaciones(id_manager, args, extra_where=None, extra_vals=None):
    """Construye WHERE + values comunes a los endpoints de detalle."""
    hoy = dt.date.today()
    desde = _parse_fecha(args.get('desde'), hoy - dt.timedelta(days=365))
    hasta = _parse_fecha(args.get('hasta'), hoy)
    modalidad = (args.get('modalidad') or '').strip().lower()
    if modalidad and modalidad not in ('oficial', 'mygym', 'wod'):
        modalidad = ''
    sexo = (args.get('sexo') or '').strip().upper()
    if sexo not in ('M', 'F'):
        sexo = ''
    try:
        categoria_id = int(args.get('categoria') or 0) or None
    except (TypeError, ValueError):
        categoria_id = None

    where = ["p.id_manager = %s",
             "p.fecha_realizado >= %s",
             "p.fecha_realizado < %s::date + 1"]
    vals = [str(id_manager), desde, hasta]

    id_trainer, forbidden = resolve_trainer_target(args.get('id_trainer'))
    if forbidden:
        return None, None, 'trainer_forbidden'
    if id_trainer:
        where.append("""p.id_cliente IN (
            SELECT id FROM cliente_cache
             WHERE id_manager = %s AND id_trainer::text = %s
        )""")
        vals.extend([str(id_manager), str(id_trainer)])

    if modalidad:
        where.append("p.modalidad = %s"); vals.append(modalidad)
    if sexo:
        where.append("p.sexo_snapshot = %s"); vals.append(sexo)
    if categoria_id:
        where.append("""p.id_cliente::text IN (
            SELECT cliente_idnoofit FROM cliente_categoria
             WHERE id_manager = %s AND categoria_id = %s
        )""")
        vals.extend([str(id_manager), categoria_id])

    if extra_where:
        where.append(extra_where)
        vals.extend(extra_vals or [])
    return where, vals, None


@bp.route('/competiciones/detalle-cliente/<int:id_cliente>', methods=['GET'])
@either_auth
def detalle_participaciones_cliente(id_cliente):
    """Participaciones detalladas de un cliente en el rango+filtros actuales.
    Se llama al desplegar una fila del listado de clientes del informe."""
    where, vals, err = _filtro_where_participaciones(
        g.id_manager, request.args,
        extra_where="p.id_cliente = %s", extra_vals=[int(id_cliente)])
    if err:
        return jsonify({'ok': False, 'error': err}), 403
    sql = f"""
        SELECT p.participacion_id, p.id_circuito, p.id_edicion,
               p.circuito_nombre, p.modalidad,
               p.fecha_realizado, p.completado,
               p.num_estaciones_snapshot,
               COALESCE(
                   (p.raw_data->>'tiempoTotalMs')::bigint,
                   ((p.raw_data->>'tiempoTotalSegundos')::float * 1000)::bigint
               ) AS tiempo_total_ms,
               (p.raw_data->>'puntosTotales')::float AS puntos_totales,
               (p.raw_data->>'repsValidasTotales')::int AS reps_validas
          FROM competicion_participacion p
         WHERE {' AND '.join(where)}
         ORDER BY p.fecha_realizado DESC NULLS LAST
    """
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(sql, vals)
        rows = [dict(r) for r in cur.fetchall()]
    for r in rows:
        if isinstance(r.get('fecha_realizado'), dt.datetime):
            r['fecha_realizado'] = r['fecha_realizado'].isoformat()
    return jsonify({'ok': True, 'total': len(rows), 'participaciones': rows})


@bp.route('/competiciones/detalle-circuito/<int:id_circuito>', methods=['GET'])
@either_auth
def detalle_participaciones_circuito(id_circuito):
    """Participaciones detalladas de un circuito en el rango+filtros actuales.
    Se llama al desplegar una fila del listado de competiciones."""
    where, vals, err = _filtro_where_participaciones(
        g.id_manager, request.args,
        extra_where="p.id_circuito = %s", extra_vals=[int(id_circuito)])
    if err:
        return jsonify({'ok': False, 'error': err}), 403
    sql = f"""
        SELECT p.participacion_id, p.id_cliente, p.cliente_nombre,
               p.circuito_nombre, p.modalidad,
               p.fecha_realizado, p.completado,
               p.sexo_snapshot, p.edad_snapshot, p.grupo_edad_snapshot,
               p.categoria_snapshot, p.num_estaciones_snapshot,
               COALESCE(
                   (p.raw_data->>'tiempoTotalMs')::bigint,
                   ((p.raw_data->>'tiempoTotalSegundos')::float * 1000)::bigint
               ) AS tiempo_total_ms,
               (p.raw_data->>'puntosTotales')::float AS puntos_totales,
               (p.raw_data->>'repsValidasTotales')::int AS reps_validas
          FROM competicion_participacion p
         WHERE {' AND '.join(where)}
         ORDER BY p.fecha_realizado DESC NULLS LAST
    """
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(sql, vals)
        rows = [dict(r) for r in cur.fetchall()]
    for r in rows:
        if isinstance(r.get('fecha_realizado'), dt.datetime):
            r['fecha_realizado'] = r['fecha_realizado'].isoformat()
    return jsonify({'ok': True, 'total': len(rows), 'participaciones': rows})


@bp.route('/competiciones/sync', methods=['POST'])
@either_auth
def forzar_sync():
    force = (request.args.get('force') or '') in ('1', 'true')
    log_action(actor_from_request(), 'competicion_participacion', 'sync',
               resumen=f'Sync informe competiciones v2 (force={force})')
    if force:
        res = _sync_all(g.id_manager, g.id_trainer, only_stale=False)
        return jsonify({'ok': True, **(res or {})})
    _sync_background(g.id_manager, g.id_trainer)
    return jsonify({'ok': True, 'background': True})
