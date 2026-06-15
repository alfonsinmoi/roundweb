"""Informe de EJERCICIOS realizados — ranking de consumo para el gestor.

Fuente: NoofitPro `POST /api/dispositivos/getTrainingsUser` (sesiones del
cliente con la lista hija `informe` = ejercicios realmente ejecutados:
nombre, orden, reps, duración…). Se cachea en local (`ejercicio_realizado`)
con sync INCREMENTAL por cliente vía header `initialId` (= max id de sesión
ya vista), clonando el patrón de routes/estado_fisico.py.

La demografía (sexo / edad) NO se duplica: se cruza en la query con
`cliente_cache.raw_data` (gender, birthdate). Mapeo gender verificado contra
datos reales (jun 2026): 'M' y 'H' → hombre, 'F' → mujer, resto → sin dato.

Endpoints (registrados bajo /informes y /api/informes):
  GET  /ejercicios          → agregado con filtros + group_by
  GET  /ejercicios/estado   → estado del sync (filas, última pasada)
  POST /ejercicios/sync     → fuerza sync (bloqueante con ?force=1, si no bg)

Filtros GET /ejercicios:
  desde, hasta              YYYY-MM-DD (default: últimos 90 días)
  sexo                      hombre | mujer
  franja_edad               menos18 | 18_29 | 30_44 | 45_59 | 60mas
  dia_semana                1..7 (ISO: 1=lunes)
  franja_horaria            manana (6-12) | mediodia (12-16) | tarde (16-21)
                            | noche (21-6)
  id_trainer                scope a un centro
  group_by                  sexo | edad | dia | hora  (desglose por dimensión)
  limit                     nº máx ejercicios del ranking (default 100)
"""
import datetime as dt
import json
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

bp = Blueprint('informe_ejercicios', __name__)
log = logging.getLogger(__name__)

NF_BASE = 'https://pro.wiemspro.com/wiemspro'
APP_VER = '1.8.39'

# Anti-stampede del sync masivo en background (mismo esquema que estado_fisico)
SYNC_MASIVO_MIN_INTERVALO_SEG = 60
# TTL para considerar "fresco" a un cliente en el sync de fondo. Los
# entrenamientos cambian como mucho unas pocas veces al día por cliente.
SYNC_TTL_HORAS = 6

_bg_lock = threading.Lock()
_bg_running = set()
_bg_last_run = {}


def either_auth(fn):
    """Acepta tanto X-Round-Token (manager) como JWT Bearer (usuario_web)."""
    @wraps(fn)
    def wrapper(*args, **kwargs):
        auth_header = request.headers.get('Authorization', '')
        if auth_header.startswith('Bearer '):
            return usuario_web_required(fn)(*args, **kwargs)
        return auth_required(fn)(*args, **kwargs)
    return wrapper


# ── Login per-trainer (reusa el cache de tokens de estado_fisico) ───────────

def _login(email, pwd):
    from .estado_fisico import _login as ef_login
    return ef_login(email, pwd)


def _headers(token, mgr, initial_id=0):
    return {'X-CustomToken': token, 'X-TRAINER_MANAGER': str(mgr or ''),
            'locale': 'es', 'appVersion': APP_VER, 'appId': '1',
            'initialId': str(initial_id or 0),
            'Content-Type': 'application/json'}


def _trainers_creds(id_manager, id_trainer=None):
    from .estado_fisico import _trainers_creds as ef_creds
    return ef_creds(id_manager, id_trainer)


def _epoch_to_ts(v):
    try:
        if isinstance(v, (int, float)) and v > 10**10:
            return dt.datetime.fromtimestamp(v / 1000, dt.timezone.utc)
    except Exception:
        pass
    return None


# ── Sync ─────────────────────────────────────────────────────────────────────

def _upsert_trainings(id_manager, id_trainer, user_id, trainings):
    """UPSERT de los ejercicios (lista hija `informe`) de cada sesión.
    Devuelve (n_sesiones, n_ejercicios, max_sesion_id)."""
    n_ses = n_ej = 0
    max_id = 0
    with get_conn() as conn, conn.cursor() as cur:
        for t in trainings:
            sid = t.get('id') or 0
            if sid > max_id:
                max_id = sid
            n_ses += 1
            fecha = _epoch_to_ts(t.get('date'))
            snombre = (t.get('name') or '').strip() or None
            for i in (t.get('informe') or []):
                iid = i.get('id')
                if not iid:
                    continue
                nombre = (i.get('nombre') or '').strip()
                if not nombre:
                    nombre = snombre or '(sin nombre)'
                cur.execute("""
                    INSERT INTO ejercicio_realizado (
                        id_manager, id_trainer, user_id, informe_id,
                        sesion_id, sesion_fecha, sesion_nombre, orden,
                        ejercicio_id, nombre, reps, duracion_seg, calorias
                    ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT (id_manager, informe_id) DO UPDATE SET
                        id_trainer   = EXCLUDED.id_trainer,
                        sesion_fecha = EXCLUDED.sesion_fecha,
                        nombre       = EXCLUDED.nombre,
                        reps         = EXCLUDED.reps,
                        duracion_seg = EXCLUDED.duracion_seg,
                        calorias     = EXCLUDED.calorias,
                        synced_at    = NOW()
                """, (str(id_manager), str(id_trainer or '') or None,
                      int(user_id), int(iid), int(sid), fecha, snombre,
                      i.get('orden'), i.get('ejercicio'), nombre[:240],
                      i.get('reps'), i.get('duracion'), i.get('calorias')))
                n_ej += 1
    return n_ses, n_ej, max_id


def _marcar_sync(id_manager, id_trainer, user_id, *, last_sesion_id=None,
                 n_sesiones=0, n_ejercicios=0, falla=None):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            INSERT INTO ejercicio_sync_cliente
                (id_manager, id_trainer, user_id, last_sesion_id,
                 synced_at, n_sesiones, n_ejercicios, ultima_falla)
            VALUES (%s,%s,%s,COALESCE(%s,0),NOW(),%s,%s,%s)
            ON CONFLICT (id_manager, user_id) DO UPDATE SET
                id_trainer     = EXCLUDED.id_trainer,
                last_sesion_id = GREATEST(ejercicio_sync_cliente.last_sesion_id,
                                          COALESCE(%s, ejercicio_sync_cliente.last_sesion_id)),
                synced_at      = NOW(),
                n_sesiones     = ejercicio_sync_cliente.n_sesiones + EXCLUDED.n_sesiones,
                n_ejercicios   = ejercicio_sync_cliente.n_ejercicios + EXCLUDED.n_ejercicios,
                ultima_falla   = EXCLUDED.ultima_falla
        """, (str(id_manager), str(id_trainer or '') or None, int(user_id),
              last_sesion_id, n_sesiones, n_ejercicios,
              (str(falla)[:300] if falla else None), last_sesion_id))


def _sync_all(id_manager, id_trainer=None, only_stale=True):
    """Recorre los clientes (cliente_cache) de los trainers del manager y
    sincroniza sus entrenamientos de forma incremental (initialId)."""
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
        total_ses = total_ej = 0
        # last_sesion_id conocido por cliente + clientes recientes a saltar
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""SELECT user_id, last_sesion_id, synced_at
                             FROM ejercicio_sync_cliente WHERE id_manager=%s""",
                        (str(id_manager),))
            estado = {r['user_id']: r for r in cur.fetchall()}
        limite_fresco = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=SYNC_TTL_HORAS)

        for tid, email, pwd in _trainers_creds(id_manager, id_trainer):
            try:
                tok, mgr_h = _login(email, pwd)
            except Exception as e:
                log.warning(f'login trainer={tid}: {e}')
                continue
            # Clientes del trainer desde la cache local (rápido, sin NF)
            with get_conn() as conn, conn.cursor() as cur:
                cur.execute("""SELECT id FROM cliente_cache
                                WHERE id_manager=%s AND (id_trainer=%s OR %s IS NULL)""",
                            (str(id_manager), int(tid) if str(tid).isdigit() else None,
                             int(tid) if str(tid).isdigit() else None))
                clientes = [r['id'] for r in cur.fetchall()]
            for cid in clientes:
                st = estado.get(cid)
                if only_stale and st and st['synced_at'] and st['synced_at'] >= limite_fresco:
                    continue
                initial = (st or {}).get('last_sesion_id') or 0
                try:
                    r = requests.post(f'{NF_BASE}/api/dispositivos/getTrainingsUser',
                                      json={'id': int(cid)},
                                      headers=_headers(tok, mgr_h, initial),
                                      verify=False, timeout=30)
                    d = r.json() if r.text else {}
                    trainings = d.get('trainings') or []
                    n_ses, n_ej, max_id = _upsert_trainings(id_manager, tid, cid, trainings)
                    _marcar_sync(id_manager, tid, cid,
                                 last_sesion_id=(max_id or initial),
                                 n_sesiones=n_ses, n_ejercicios=n_ej)
                    total_ses += n_ses
                    total_ej += n_ej
                except Exception as e:
                    _marcar_sync(id_manager, tid, cid, falla=e)
                    log.warning(f'getTrainingsUser cli={cid}: {e}')
        return {'ok': True, 'sesiones': total_ses, 'ejercicios': total_ej}
    finally:
        with _bg_lock:
            _bg_running.discard(key)
            _bg_last_run[key] = time.time()


def _sync_background(id_manager, id_trainer=None):
    threading.Thread(target=_sync_all, args=(id_manager, id_trainer),
                     kwargs={'only_stale': True}, daemon=True).start()


# ── Dimensiones SQL (derivadas, comparten definición filtro/desglose) ───────

SEXO_SQL = """CASE WHEN cc.raw_data->>'gender' IN ('M','H') THEN 'hombre'
                   WHEN cc.raw_data->>'gender' = 'F' THEN 'mujer'
                   ELSE 'sin_dato' END"""

EDAD_SQL = """CASE
    WHEN cc.raw_data->>'birthdate' IS NULL OR cc.raw_data->>'birthdate' = ''
         THEN 'sin_dato'
    WHEN EXTRACT(YEAR FROM age(er.sesion_fecha, (cc.raw_data->>'birthdate')::date)) < 18 THEN 'menos18'
    WHEN EXTRACT(YEAR FROM age(er.sesion_fecha, (cc.raw_data->>'birthdate')::date)) < 30 THEN '18_29'
    WHEN EXTRACT(YEAR FROM age(er.sesion_fecha, (cc.raw_data->>'birthdate')::date)) < 45 THEN '30_44'
    WHEN EXTRACT(YEAR FROM age(er.sesion_fecha, (cc.raw_data->>'birthdate')::date)) < 60 THEN '45_59'
    ELSE '60mas' END"""

DIA_SQL = "EXTRACT(ISODOW FROM er.sesion_fecha AT TIME ZONE 'Europe/Madrid')::int::text"

HORA_SQL = """CASE
    WHEN EXTRACT(HOUR FROM er.sesion_fecha AT TIME ZONE 'Europe/Madrid') BETWEEN 6  AND 11 THEN 'manana'
    WHEN EXTRACT(HOUR FROM er.sesion_fecha AT TIME ZONE 'Europe/Madrid') BETWEEN 12 AND 15 THEN 'mediodia'
    WHEN EXTRACT(HOUR FROM er.sesion_fecha AT TIME ZONE 'Europe/Madrid') BETWEEN 16 AND 20 THEN 'tarde'
    ELSE 'noche' END"""

GROUP_DIMS = {'sexo': SEXO_SQL, 'edad': EDAD_SQL, 'dia': DIA_SQL, 'hora': HORA_SQL}


def _parse_fecha(v, default):
    try:
        return dt.date.fromisoformat((v or '').strip())
    except Exception:
        return default


# ── Endpoints ────────────────────────────────────────────────────────────────

@bp.route('/ejercicios', methods=['GET'])
@either_auth
def informe_ejercicios():
    hoy = dt.date.today()
    desde = _parse_fecha(request.args.get('desde'), hoy - dt.timedelta(days=90))
    hasta = _parse_fecha(request.args.get('hasta'), hoy)
    limit = min(int(request.args.get('limit', 100) or 100), 500)

    where = ["er.id_manager = %s",
             "er.sesion_fecha >= %s",
             "er.sesion_fecha < %s::date + 1"]
    vals = [str(g.id_manager), desde, hasta]

    # Anti cross-trainer leak (Sprint 4 #C3): un usuario_web atado a un
    # centro no puede pedir otro id_trainer por query string.
    id_trainer, forbidden = resolve_trainer_target(request.args.get('id_trainer'))
    if forbidden:
        return jsonify({'ok': False, 'error': 'trainer_forbidden'}), 403
    if id_trainer:
        where.append("er.id_trainer = %s")
        vals.append(str(id_trainer))

    sexo = (request.args.get('sexo') or '').strip()
    if sexo in ('hombre', 'mujer', 'sin_dato'):
        where.append(f"{SEXO_SQL} = %s")
        vals.append(sexo)

    franja_edad = (request.args.get('franja_edad') or '').strip()
    if franja_edad in ('menos18', '18_29', '30_44', '45_59', '60mas', 'sin_dato'):
        where.append(f"{EDAD_SQL} = %s")
        vals.append(franja_edad)

    dia = (request.args.get('dia_semana') or '').strip()
    if dia in tuple('1234567'):
        where.append(f"{DIA_SQL} = %s")
        vals.append(dia)

    franja_h = (request.args.get('franja_horaria') or '').strip()
    if franja_h in ('manana', 'mediodia', 'tarde', 'noche'):
        where.append(f"{HORA_SQL} = %s")
        vals.append(franja_h)

    group_by = (request.args.get('group_by') or '').strip()
    dim_sql = GROUP_DIMS.get(group_by)

    base = f"""
        FROM ejercicio_realizado er
        LEFT JOIN cliente_cache cc
               ON cc.id_manager = er.id_manager AND cc.id = er.user_id
        WHERE {' AND '.join(where)}
    """

    with get_conn() as conn, conn.cursor() as cur:
        # Totales del periodo (con filtros aplicados)
        cur.execute(f"""
            SELECT COUNT(*) AS ejecuciones,
                   COUNT(DISTINCT er.nombre) AS ejercicios_distintos,
                   COUNT(DISTINCT er.user_id) AS clientes,
                   COUNT(DISTINCT er.sesion_id) AS sesiones
            {base}
        """, vals)
        totales = dict(cur.fetchone() or {})

        # Ranking por ejercicio
        cur.execute(f"""
            SELECT er.nombre,
                   COUNT(*) AS veces,
                   COUNT(DISTINCT er.user_id) AS clientes,
                   COUNT(DISTINCT er.sesion_id) AS sesiones,
                   ROUND(AVG(NULLIF(er.reps,0)))::int AS reps_media,
                   SUM(COALESCE(er.reps,0))::bigint AS reps_total,
                   ROUND(AVG(NULLIF(er.duracion_seg,0)))::int AS dur_media_seg,
                   SUM(COALESCE(er.duracion_seg,0))::bigint AS dur_total_seg
            {base}
            GROUP BY er.nombre
            ORDER BY veces DESC, er.nombre
            LIMIT %s
        """, vals + [limit])
        ranking = [dict(r) for r in cur.fetchall()]

        desglose = None
        if dim_sql:
            cur.execute(f"""
                SELECT er.nombre, {dim_sql} AS bucket, COUNT(*) AS veces
                {base}
                GROUP BY er.nombre, bucket
            """, vals)
            desglose = {}
            for r in cur.fetchall():
                desglose.setdefault(r['nombre'], {})[r['bucket']] = r['veces']

    return jsonify({'ok': True,
                    'desde': desde.isoformat(), 'hasta': hasta.isoformat(),
                    'totales': totales, 'ranking': ranking,
                    'group_by': group_by or None, 'desglose': desglose})


@bp.route('/ejercicios/estado', methods=['GET'])
@either_auth
def estado_sync():
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT COUNT(*) AS filas,
                   MIN(sesion_fecha) AS fecha_min,
                   MAX(sesion_fecha) AS fecha_max
              FROM ejercicio_realizado WHERE id_manager=%s
        """, (str(g.id_manager),))
        datos = dict(cur.fetchone() or {})
        cur.execute("""
            SELECT COUNT(*) AS clientes_sincronizados,
                   MAX(synced_at) AS ultimo_sync
              FROM ejercicio_sync_cliente WHERE id_manager=%s
        """, (str(g.id_manager),))
        sync = dict(cur.fetchone() or {})
    for d in (datos, sync):
        for k, v in d.items():
            if isinstance(v, dt.datetime):
                d[k] = v.isoformat()
    return jsonify({'ok': True, **datos, **sync})


@bp.route('/ejercicios/sync', methods=['POST'])
@either_auth
def forzar_sync():
    """force=1 → bloqueante e ignora TTL (primera carga / cron manual).
    Sin force → dispara sync en background y responde al instante."""
    force = (request.args.get('force') or '') in ('1', 'true')
    log_action(actor_from_request(), 'ejercicio_realizado', 'sync',
               resumen=f'Sync informe ejercicios (force={force})')
    if force:
        res = _sync_all(g.id_manager, g.id_trainer, only_stale=False)
        return jsonify({'ok': True, **(res or {})})
    _sync_background(g.id_manager, g.id_trainer)
    return jsonify({'ok': True, 'background': True})
