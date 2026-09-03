"""Tests de estado físico — cache local + sync incremental con NoofitPro.

Arquitectura:
  - Las lecturas (`/sessions`, `/dashboard`) leen SIEMPRE de la BD local
    (instantáneo) y al final del response disparan un sync en background si
    los datos del cliente / manager son antiguos.
  - Los endpoints `/sync/...` fuerzan el sync inmediato bloqueando.
  - Un cron diario (`round_estado_fisico_sync.timer`) hace sync masivo.

NoofitPro no soporta filtro por fecha en `getEstadoFisicoTestSessions`, así
que por cada cliente "antiguo" pedimos TODOS sus tests y hacemos UPSERT por
UUID. El sync es incremental en el sentido de que la mayoría de clientes
no tendrá tests nuevos y el UPSERT no escribe nada (es no-op).
"""
import datetime as dt
import hashlib
import json
import logging
import threading
import time

import requests
import urllib3
from flask import Blueprint, request, jsonify, g

from ..auth import auth_required, resolve_trainer_target
from ..db import get_conn

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

bp = Blueprint('estado_fisico', __name__)
log = logging.getLogger(__name__)

NF_BASE = 'https://pro.wiemspro.com/wiemspro'
APP_VER = '1.8.39'
# Anti-stampede para el sync masivo en background (dashboard global).
# Solo evitamos relanzarlo si ya hay otro en curso o si terminó hace menos
# de este intervalo. Es BARATO porque el bg es no-bloqueante.
SYNC_MASIVO_MIN_INTERVALO_SEG = 60
# Para la ficha individual NO usamos TTL: cada apertura sincroniza el
# cliente (1 request a NoofitPro ≈ 50-200 ms). Así los datos son siempre
# del segundo, no del último cron.

_bg_lock = threading.Lock()
_bg_running = set()    # (id_manager, id_trainer) en curso
_bg_last_run = {}      # (id_manager, id_trainer) → timestamp último fin

# Cache de tokens NoofitPro por trainer. El login tarda ~800-1500 ms.
# El token X-CustomToken vive ≈ 1h en NoofitPro, lo cacheamos 15 min para
# absorber la mayor parte de los hits sin riesgo de invalidación.
_TOK_TTL_SEG = 15 * 60
_tok_lock = threading.Lock()
_tok_cache = {}        # email → (token, manager_h, expira_at)


def _md5_upper(s: str) -> str:
    return hashlib.md5(s.encode()).hexdigest().upper()


def _login(email: str, pwd: str):
    """Login con cache en memoria. Re-loguea si el token cacheado expiró
    o el caller pasa pwd distinto al de la última vez."""
    now = time.time()
    with _tok_lock:
        hit = _tok_cache.get(email)
        if hit and hit[2] > now:
            return hit[0], hit[1]
    r = requests.post(f'{NF_BASE}/account/loginEasy',
        json={'email': email, 'appVersion': APP_VER, 'password': _md5_upper(pwd)},
        headers={'Content-Type': 'application/json'},
        verify=False, timeout=20)
    r.raise_for_status()
    tok = r.headers.get('X-CustomToken')
    mgr = r.headers.get('X-TRAINER_MANAGER', '')
    with _tok_lock:
        _tok_cache[email] = (tok, mgr, now + _TOK_TTL_SEG)
    return tok, mgr


def _headers(token: str, mgr: str) -> dict:
    return {'X-CustomToken': token, 'X-TRAINER_MANAGER': str(mgr or ''),
            'locale': 'es', 'appVersion': APP_VER, 'appId': '1',
            'Content-Type': 'application/json'}


def _trainers_creds(id_manager: str, id_trainer: str = None):
    out = []
    with get_conn() as conn, conn.cursor() as cur:
        sql = """SELECT id_trainer, noofit_email, noofit_password
                   FROM trainer_noofit_creds
                  WHERE id_manager=%s AND activo=TRUE"""
        params = [str(id_manager)]
        if id_trainer:
            sql += " AND id_trainer=%s"
            params.append(str(id_trainer))
        cur.execute(sql, params)
        for r in cur.fetchall():
            if r.get('noofit_email') and r.get('noofit_password'):
                out.append((str(r['id_trainer']),
                            r['noofit_email'], r['noofit_password']))
    return out


def _epoch_to_ts(v):
    if not v: return None
    try:
        if isinstance(v, (int, float)) and v > 10**10:
            return dt.datetime.fromtimestamp(v / 1000)
    except Exception:
        pass
    return None


def _tecnico_int(v):
    """idTecnico de NoofitPro → int o None. Es el id del técnico que administra
    el test (catálogo aparte de NoofitPro; su nombre se resuelve en
    `_tecnicos_nombres`)."""
    try:
        return int(v) if v is not None and str(v).strip() != '' else None
    except (TypeError, ValueError):
        return None


def _tecnicos_nombres(id_manager, ids):
    """Resuelve un conjunto de idTecnico → nombre legible.

    NoofitPro expone el catálogo de técnicos en un endpoint aún por confirmar
    (pendiente: nombre exacto). Hasta integrarlo, devolvemos lo que haya en la
    tabla local `tecnico_noofit` (si el manager rellena nombres) y el resto
    queda sin resolver → el frontend muestra 'Técnico #<id>'.

    Estructura pensada para enchufar el endpoint NoofitPro en un único punto:
    basta con poblar `out` desde la respuesta del catálogo.
    """
    ids = {int(i) for i in ids if i is not None}
    if not ids:
        return {}
    out = {}
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT id_tecnico, nombre FROM tecnico_noofit
                 WHERE id_manager = %s AND id_tecnico = ANY(%s)
            """, (str(id_manager), list(ids)))
            for r in cur.fetchall():
                if r.get('nombre'):
                    out[int(r['id_tecnico'])] = r['nombre']
    except Exception as e:
        log.info(f'_tecnicos_nombres (tabla opcional): {e}')
    # TODO: cuando NoofitPro confirme el endpoint del catálogo de técnicos,
    # resolver aquí los ids que falten (los que no estén ya en `out`).
    return out


def _upsert_sessions(id_manager: str, id_trainer: str, user_id: int,
                      nombre: str, email: str, sessions: list):
    """UPSERT en test_estado_fisico. Idempotente por UUID."""
    n = 0
    with get_conn() as conn, conn.cursor() as cur:
        for s in sessions:
            uuid_str = s.get('id')
            if not uuid_str: continue
            cur.execute("""
                INSERT INTO test_estado_fisico (
                    id, id_manager, id_trainer, user_id,
                    cliente_nombre, cliente_email,
                    test_date, edad, peso_kg, sexo, categoria,
                    has_squat_jump, has_box_squat, has_flamenco,
                    has_plancha, has_push_up,
                    observations, is_completed, puntuacion, id_tecnico,
                    last_modified_date, raw_data
                ) VALUES (
                    %s::uuid, %s, %s, %s,
                    %s, %s,
                    %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s,
                    %s, %s, %s, %s,
                    %s, %s::jsonb
                )
                ON CONFLICT (id) DO UPDATE SET
                    id_trainer        = EXCLUDED.id_trainer,
                    cliente_nombre    = EXCLUDED.cliente_nombre,
                    cliente_email     = EXCLUDED.cliente_email,
                    test_date         = EXCLUDED.test_date,
                    edad              = EXCLUDED.edad,
                    peso_kg           = EXCLUDED.peso_kg,
                    sexo              = EXCLUDED.sexo,
                    categoria         = EXCLUDED.categoria,
                    has_squat_jump    = EXCLUDED.has_squat_jump,
                    has_box_squat     = EXCLUDED.has_box_squat,
                    has_flamenco      = EXCLUDED.has_flamenco,
                    has_plancha       = EXCLUDED.has_plancha,
                    has_push_up       = EXCLUDED.has_push_up,
                    observations      = EXCLUDED.observations,
                    is_completed      = EXCLUDED.is_completed,
                    puntuacion        = EXCLUDED.puntuacion,
                    id_tecnico        = EXCLUDED.id_tecnico,
                    last_modified_date= EXCLUDED.last_modified_date,
                    raw_data          = EXCLUDED.raw_data,
                    synced_at         = NOW()
            """, (
                uuid_str, str(id_manager), str(id_trainer or '') or None, int(user_id),
                nombre, email,
                _epoch_to_ts(s.get('testDate')),
                s.get('edad'), s.get('pesoKg'), s.get('sexo'), s.get('categoria'),
                bool(s.get('hasSquatJump')), bool(s.get('hasBoxSquat')),
                bool(s.get('hasFlamenco')), bool(s.get('hasPlancha')),
                bool(s.get('hasPushUp')),
                s.get('observations'),
                bool(s.get('isCompleted')),
                s.get('puntuacion'),
                _tecnico_int(s.get('idTecnico')),
                _epoch_to_ts(s.get('lastModifiedDate')),
                json.dumps(s, ensure_ascii=False, default=str),
            ))
            n += 1
        # Actualizar sync_cliente
        cur.execute("""
            INSERT INTO test_estado_fisico_sync_cliente
                (id_manager, id_trainer, user_id, synced_at, n_tests, ultima_falla)
            VALUES (%s, %s, %s, NOW(), %s, NULL)
            ON CONFLICT (id_manager, user_id) DO UPDATE SET
                id_trainer = EXCLUDED.id_trainer,
                synced_at = NOW(),
                n_tests = EXCLUDED.n_tests,
                ultima_falla = NULL
        """, (str(id_manager), str(id_trainer or '') or None,
              int(user_id), len(sessions)))
    return n


def _sync_cliente(id_manager: str, id_trainer: str, user_id: int,
                   trainer_creds: tuple = None,
                   nombre: str = None, email: str = None):
    """Sincroniza un cliente concreto. Devuelve nº de sesiones procesadas."""
    if not trainer_creds:
        creds = _trainers_creds(id_manager, id_trainer)
        if not creds: return 0
        # Buscar el trainer correcto
        trainer_creds = creds[0]
    tid, email_cred, pwd = trainer_creds
    try:
        tok, mgr_h = _login(email_cred, pwd)
    except Exception as e:
        log.warning(f'login fail trainer={tid}: {e}')
        return 0
    try:
        r = requests.post(f'{NF_BASE}/api/dispositivos/getEstadoFisicoTestSessions',
                          json={'idUser': int(user_id)},
                          headers=_headers(tok, mgr_h),
                          verify=False, timeout=15)
        d = r.json() if r.text else {}
        sessions = (d.get('TestEstadoFisicoSessions')
                    or d.get('testEstadoFisicoSessions') or [])
    except Exception as e:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                INSERT INTO test_estado_fisico_sync_cliente
                    (id_manager, id_trainer, user_id, synced_at, n_tests, ultima_falla)
                VALUES (%s, %s, %s, NOW(), 0, %s)
                ON CONFLICT (id_manager, user_id) DO UPDATE SET
                    ultima_falla = EXCLUDED.ultima_falla
            """, (str(id_manager), str(id_trainer or '') or None,
                  int(user_id), str(e)[:300]))
        log.warning(f'getEstadoFisico cli={user_id}: {e}')
        return 0
    return _upsert_sessions(id_manager, tid, user_id,
                             nombre, email, sessions)


def _sync_all(id_manager: str, id_trainer: str = None,
               only_stale: bool = True):
    """Recorre todos los clientes activos de los trainers del manager y los
    sincroniza. Si `only_stale=True`, solo sincroniza los que no se han
    sincronizado en las últimas SYNC_TTL_HORAS horas."""
    key = (str(id_manager), str(id_trainer or ''))
    # Anti-stampede: evitar concurrencia + lanzamientos consecutivos.
    now = time.time()
    with _bg_lock:
        if key in _bg_running:
            log.info(f'sync_all ya en curso para {key}, salgo')
            return {'skipped': True, 'reason': 'in_progress'}
        last = _bg_last_run.get(key, 0)
        if only_stale and (now - last) < SYNC_MASIVO_MIN_INTERVALO_SEG:
            log.info(f'sync_all reciente ({int(now-last)}s) para {key}, salgo')
            return {'skipped': True, 'reason': 'too_recent'}
        _bg_running.add(key)
    try:
        total = 0
        creds_list = _trainers_creds(id_manager, id_trainer)
        for tid, email, pwd in creds_list:
            try:
                tok, mgr_h = _login(email, pwd)
            except Exception as e:
                log.warning(f'login trainer={tid}: {e}'); continue
            try:
                r = requests.get(f'{NF_BASE}/api/dispositivos/getClienteSimple',
                                 headers=_headers(tok, mgr_h),
                                 verify=False, timeout=60)
                clientes = (r.json() or {}).get('clientes') or []
            except Exception as e:
                log.warning(f'getClienteSimple trainer={tid}: {e}'); continue
            clientes = [c for c in clientes if c.get('enabled') is not False]
            # Filtrar los "stale". El sync masivo en background salta los
            # clientes sincronizados en la última hora — así detecta nuevos
            # tests del día sin spamear a NoofitPro. El cron nocturno y los
            # `/sync?force=1` ignoran este filtro.
            if only_stale:
                limite = dt.datetime.now() - dt.timedelta(hours=1)
                with get_conn() as conn, conn.cursor() as cur:
                    cur.execute("""
                        SELECT user_id FROM test_estado_fisico_sync_cliente
                         WHERE id_manager=%s AND synced_at >= %s
                    """, (str(id_manager), limite))
                    recientes = {r['user_id'] for r in cur.fetchall()}
                clientes_pendientes = [c for c in clientes
                                        if c.get('id') and c['id'] not in recientes]
            else:
                clientes_pendientes = clientes

            log.info(f'sync_all trainer={tid}: {len(clientes_pendientes)} clientes a sincronizar '
                     f'(de {len(clientes)} totales)')

            for c in clientes_pendientes:
                cid = c.get('id')
                if not cid: continue
                nombre = (f"{c.get('name','')} {c.get('surname','')}").strip()
                email = c.get('email')
                # Reusar la sesión token ya autenticada
                try:
                    r = requests.post(f'{NF_BASE}/api/dispositivos/getEstadoFisicoTestSessions',
                                      json={'idUser': cid},
                                      headers=_headers(tok, mgr_h),
                                      verify=False, timeout=15)
                    d = r.json() if r.text else {}
                    sessions = (d.get('TestEstadoFisicoSessions')
                                or d.get('testEstadoFisicoSessions') or [])
                    _upsert_sessions(id_manager, tid, cid, nombre, email, sessions)
                    total += len(sessions)
                except Exception as e:
                    with get_conn() as conn, conn.cursor() as cur:
                        cur.execute("""
                            INSERT INTO test_estado_fisico_sync_cliente
                                (id_manager, id_trainer, user_id, synced_at, n_tests, ultima_falla)
                            VALUES (%s, %s, %s, NOW(), 0, %s)
                            ON CONFLICT (id_manager, user_id) DO UPDATE SET
                                ultima_falla = EXCLUDED.ultima_falla,
                                synced_at = NOW()
                        """, (str(id_manager), str(tid or '') or None,
                              int(cid), str(e)[:300]))
                    log.warning(f'cli={cid}: {e}')
        return {'ok': True, 'total_sesiones_procesadas': total}
    finally:
        with _bg_lock:
            _bg_running.discard(key)
            _bg_last_run[key] = time.time()


def _sync_background(id_manager: str, id_trainer: str = None):
    """Lanza _sync_all en un thread daemon. NO bloquea el response."""
    threading.Thread(
        target=_sync_all,
        args=(id_manager, id_trainer),
        kwargs={'only_stale': True},
        daemon=True,
    ).start()


# ─── Lectura de BD local ───────────────────────────────────────────────────

def _row_to_session(r):
    """Convierte un row de test_estado_fisico al shape que espera el frontend
    (basado en la respuesta original de NoofitPro)."""
    raw = r.get('raw_data') or {}
    if isinstance(raw, str):
        try: raw = json.loads(raw)
        except Exception: raw = {}
    # Si raw está vacío, reconstruimos los campos top-level desde columnas
    if not raw:
        raw = {
            'id': str(r['id']),
            'userId': r['user_id'],
            'testDate': int(r['test_date'].timestamp() * 1000) if r['test_date'] else None,
            'edad': r['edad'],
            'pesoKg': float(r['peso_kg']) if r['peso_kg'] is not None else None,
            'sexo': r['sexo'],
            'categoria': r['categoria'],
            'hasSquatJump': r['has_squat_jump'],
            'hasBoxSquat': r['has_box_squat'],
            'hasFlamenco': r['has_flamenco'],
            'hasPlancha': r['has_plancha'],
            'hasPushUp': r['has_push_up'],
            'observations': r['observations'],
            'isCompleted': r['is_completed'],
            'puntuacion': float(r['puntuacion']) if r['puntuacion'] is not None else 0,
            'lastModifiedDate': int(r['last_modified_date'].timestamp() * 1000) if r['last_modified_date'] else None,
        }
    raw['_cliente_nombre'] = r.get('cliente_nombre') or ''
    raw['_cliente_email']  = r.get('cliente_email') or ''
    raw['_id_trainer_round'] = r.get('id_trainer') or ''
    raw['_synced_at'] = r['synced_at'].isoformat() if r.get('synced_at') else None
    # idTecnico: preferimos el valor del raw; si falta o es null, la columna.
    if raw.get('idTecnico') is None:
        raw['idTecnico'] = r.get('id_tecnico')
    return raw


def _read_sessions_local(id_manager: str, id_trainer: str = None,
                          user_id: int = None):
    """Lee de la BD local. NO llama a NoofitPro."""
    wheres = ['id_manager = %s']
    params = [str(id_manager)]
    if id_trainer:
        wheres.append('(id_trainer = %s OR id_trainer IS NULL)')
        params.append(str(id_trainer))
    if user_id:
        wheres.append('user_id = %s')
        params.append(int(user_id))
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"""
            SELECT * FROM test_estado_fisico
             WHERE {' AND '.join(wheres)}
             ORDER BY test_date DESC NULLS LAST
        """, params)
        rows = cur.fetchall()
    return [_row_to_session(r) for r in rows]


def _sync_state(id_manager: str, id_trainer: str = None):
    """Devuelve info del estado de sync para mostrar en frontend."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT COUNT(*) AS n_clientes,
                   COUNT(*) FILTER (WHERE synced_at > NOW() - INTERVAL '1 hour') AS n_recientes,
                   MIN(synced_at) AS oldest,
                   MAX(synced_at) AS newest
              FROM test_estado_fisico_sync_cliente
             WHERE id_manager = %s
        """, (str(id_manager),))
        r = cur.fetchone()
    return {
        'clientes_sincronizados': r['n_clientes'] or 0,
        'clientes_recientes':     r['n_recientes'] or 0,
        'sync_mas_antiguo':       r['oldest'].isoformat() if r.get('oldest') else None,
        'sync_mas_nuevo':         r['newest'].isoformat() if r.get('newest') else None,
    }


# ─── Endpoints ─────────────────────────────────────────────────────────────

@bp.route('/sessions', methods=['GET'])
@auth_required
def list_sessions():
    """Lectura local de TODAS las sesiones del manager/trainer.
    Dispara SIEMPRE un sync en background (con anti-stampede de 60 s) para
    que la próxima carga refleje cualquier test nuevo del día. La
    respuesta actual es instantánea con los datos del último sync."""
    sessions = _read_sessions_local(g.id_manager, g.id_trainer)
    state = _sync_state(g.id_manager)
    _sync_background(g.id_manager, g.id_trainer)
    return jsonify({'ok': True, 'sessions': sessions, 'total': len(sessions),
                    'sync': state, 'fuente': 'local'})


@bp.route('/sessions/<int:id_cliente>', methods=['GET'])
@auth_required
def list_sessions_cliente(id_cliente):
    """Lectura local de las sesiones de un cliente, garantizando datos
    frescos: SIEMPRE sincroniza ese cliente contra NoofitPro antes de
    devolver (1 petición ≈ 50-200 ms). Así, al abrir la ficha, el
    informe refleja al instante los tests realizados hoy.

    Si NoofitPro falla, devolvemos el cache local de todos modos."""
    creds = _trainers_creds(g.id_manager, g.id_trainer)
    sync_ok = False
    if creds:
        try:
            _sync_cliente(g.id_manager, creds[0][0], id_cliente,
                          trainer_creds=creds[0])
            sync_ok = True
        except Exception as e:
            log.warning(f'sync síncrono cli={id_cliente} falló: {e}')
    sessions = _read_sessions_local(g.id_manager, g.id_trainer, id_cliente)
    return jsonify({'ok': True, 'sessions': sessions, 'total': len(sessions),
                    'fuente': 'local', 'sync_realizado': sync_ok})


@bp.route('/dashboard', methods=['GET'])
@auth_required
def dashboard():
    """KPIs del dashboard global. Lee de BD local + dispara SIEMPRE sync
    background (anti-stampede 60 s). Próxima carga tendrá los nuevos
    tests del día.

    Acepta ?id_trainer=<id> para que un manager pueda ver el dashboard
    de uno de sus trainers (o el consolidado si no lo pasa). Los usuarios
    con scope de trainer (usuario_web ligado a un centro) no pueden
    saltarse su scope — resolve_trainer_target lo aplica.
    """
    id_trainer_q, forbidden = resolve_trainer_target(request.args.get('id_trainer'))
    if forbidden:
        return jsonify({'ok': False, 'error': 'trainer_forbidden'}), 403
    id_trainer = id_trainer_q or g.id_trainer
    sessions = _read_sessions_local(g.id_manager, id_trainer)
    state = _sync_state(g.id_manager)
    _sync_background(g.id_manager, id_trainer)
    return jsonify({'ok': True, **_compute_dashboard(sessions, g.id_manager),
                    'sync': state, 'fuente': 'local',
                    'id_trainer': id_trainer,
                    'sample_session_keys': list(sessions[0].keys()) if sessions else []})


@bp.route('/sync', methods=['POST'])
@auth_required
def sync_masivo():
    """Fuerza un sync masivo de todos los clientes (bloquea hasta terminar).
    Usar con cuidado — tarda 10-30s con 300 clientes."""
    force = request.args.get('force') in ('1', 'true', 'yes')
    result = _sync_all(g.id_manager, g.id_trainer, only_stale=not force)
    return jsonify({'ok': True, **result})


@bp.route('/sync/<int:id_cliente>', methods=['POST'])
@auth_required
def sync_cliente_endpoint(id_cliente):
    """Fuerza sync de un cliente concreto."""
    creds = _trainers_creds(g.id_manager, g.id_trainer)
    if not creds:
        return jsonify({'ok': False, 'error': 'sin_credenciales_trainer'}), 400
    n = _sync_cliente(g.id_manager, creds[0][0], id_cliente, trainer_creds=creds[0])
    sessions = _read_sessions_local(g.id_manager, g.id_trainer, id_cliente)
    return jsonify({'ok': True, 'sessions': sessions, 'total': len(sessions),
                    'sync_procesado': n})


# ─── KPIs computados ──────────────────────────────────────────────────────

def _compute_dashboard(sessions, id_manager=None):
    """Calcula KPIs a partir de la lista de sesiones. `id_manager` se usa solo
    para resolver los nombres de técnico (opcional)."""
    if not sessions:
        return {
            'total_tests': 0, 'clientes_con_test': 0,
            'tasa_completitud': 0, 'puntuacion_media': 0,
            'media_dias_entre_tests': 0, 'tests_repetidos_pct': 0,
            'por_mes': [], 'por_tipo': {}, 'distribucion_repeticion': {},
            'demografico': {'por_sexo': {}, 'por_edad_bucket': {}},
            'top_clientes': [], 'ranking_puntuacion': [],
            'progreso_clientes': [],
            'por_dia': [], 'por_dia_semana': [],
            'por_tecnico': [], 'tecnicos': {},
            'fidelizacion_tecnico': {'clientes_evaluables': 0, 'mismo_tecnico': 0,
                                     'distinto_tecnico': 0, 'pct_mismo': 0},
        }
    total_tests = len(sessions)
    clientes_dict = {}
    for s in sessions:
        uid = s.get('userId')
        if not uid: continue
        if uid not in clientes_dict:
            clientes_dict[uid] = {
                'id': uid,
                'nombre': s.get('_cliente_nombre') or f'#{uid}',
                'email': s.get('_cliente_email'),
                'tests': [],
            }
        clientes_dict[uid]['tests'].append(s)
    clientes_con_test = len(clientes_dict)
    for v in clientes_dict.values():
        v['tests'].sort(key=lambda x: x.get('testDate') or 0)

    completos = sum(1 for s in sessions if s.get('isCompleted'))
    tasa_completitud = round(100 * completos / total_tests, 1) if total_tests else 0
    puntuaciones = [float(s.get('puntuacion') or 0) for s in sessions if s.get('puntuacion')]
    puntuacion_media = round(sum(puntuaciones) / len(puntuaciones), 2) if puntuaciones else 0

    by_mes = {}
    for s in sessions:
        ts = s.get('testDate')
        if not ts: continue
        d = dt.datetime.fromtimestamp(ts / 1000)
        mes = d.strftime('%Y-%m')
        by_mes.setdefault(mes, {'mes': mes, 'tests': 0, 'clientes': set()})
        by_mes[mes]['tests'] += 1
        by_mes[mes]['clientes'].add(s.get('userId'))
    por_mes = [{'mes': m['mes'], 'tests': m['tests'], 'clientes': len(m['clientes'])}
               for m in by_mes.values()]
    por_mes.sort(key=lambda x: x['mes'])

    por_tipo = {
        'SquatJump': sum(1 for s in sessions if s.get('hasSquatJump')),
        'BoxSquat':  sum(1 for s in sessions if s.get('hasBoxSquat')),
        'Flamenco':  sum(1 for s in sessions if s.get('hasFlamenco')),
        'Plancha':   sum(1 for s in sessions if s.get('hasPlancha')),
        'PushUp':    sum(1 for s in sessions if s.get('hasPushUp')),
    }

    distribucion_repeticion = {'1 test': 0, '2 tests': 0, '3-5 tests': 0, '6+ tests': 0}
    for v in clientes_dict.values():
        n = len(v['tests'])
        if n == 1: distribucion_repeticion['1 test'] += 1
        elif n == 2: distribucion_repeticion['2 tests'] += 1
        elif n <= 5: distribucion_repeticion['3-5 tests'] += 1
        else: distribucion_repeticion['6+ tests'] += 1

    por_sexo, por_edad = {}, {}
    def _bucket_edad(e):
        if not e: return 'Sin edad'
        if e < 25: return '<25'
        if e < 35: return '25-34'
        if e < 45: return '35-44'
        if e < 55: return '45-54'
        if e < 65: return '55-64'
        return '65+'
    for s in sessions:
        sx = s.get('sexo') or 'Sin sexo'
        por_sexo[sx] = por_sexo.get(sx, 0) + 1
        eb = _bucket_edad(s.get('edad'))
        por_edad[eb] = por_edad.get(eb, 0) + 1

    top_clientes = sorted(clientes_dict.values(),
                          key=lambda v: -len(v['tests']))[:10]
    top_clientes = [{
        'id': v['id'], 'nombre': v['nombre'], 'email': v['email'],
        'n_tests': len(v['tests']),
        'ultimo_test': max((s.get('testDate') or 0) for s in v['tests']),
        'puntuacion_actual': float(v['tests'][-1].get('puntuacion') or 0) if v['tests'] else 0,
    } for v in top_clientes]

    ranking = []
    for v in clientes_dict.values():
        if not v['tests']: continue
        last = v['tests'][-1]
        p = float(last.get('puntuacion') or 0)
        if p > 0:
            ranking.append({'id': v['id'], 'nombre': v['nombre'],
                            'puntuacion': p, 'fecha': last.get('testDate')})
    ranking.sort(key=lambda x: -x['puntuacion'])
    ranking_puntuacion = ranking[:10]

    progreso = []
    for v in clientes_dict.values():
        if len(v['tests']) < 2: continue
        p_ini = float(v['tests'][0].get('puntuacion') or 0)
        p_fin = float(v['tests'][-1].get('puntuacion') or 0)
        if p_ini == 0 and p_fin == 0: continue
        progreso.append({
            'id': v['id'], 'nombre': v['nombre'], 'n_tests': len(v['tests']),
            'puntuacion_inicial': p_ini, 'puntuacion_actual': p_fin,
            'delta': round(p_fin - p_ini, 2),
            'delta_pct': round(((p_fin - p_ini) / p_ini) * 100, 1) if p_ini > 0 else None,
        })
    progreso.sort(key=lambda x: -(x['delta'] or 0))

    dias_entre_tests = []
    for v in clientes_dict.values():
        ts = sorted([s.get('testDate') or 0 for s in v['tests']])
        for i in range(1, len(ts)):
            if ts[i] and ts[i-1]:
                d = (ts[i] - ts[i-1]) / (1000 * 86400)
                dias_entre_tests.append(d)
    media_dias = round(sum(dias_entre_tests) / len(dias_entre_tests), 1) if dias_entre_tests else 0

    # ── Actividad por día + día de la semana ────────────────────────────────
    # por_dia: un punto por cada día CON tests (fecha + etiqueta con día de la
    # semana). por_dia_semana: agregado Lun..Dom para ver qué días se hace más.
    DOW = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']  # weekday(): Lun=0
    DOW_ABBR = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
    by_dia = {}
    dow_counts = [0] * 7
    for s in sessions:
        ts = s.get('testDate')
        if not ts:
            continue
        d = dt.datetime.fromtimestamp(ts / 1000)
        wd = d.weekday()
        key = d.strftime('%Y-%m-%d')
        if key not in by_dia:
            by_dia[key] = {'fecha': key,
                           'label': f'{DOW_ABBR[wd]} {d.day:02d}/{d.month:02d}',
                           'dow': DOW_ABBR[wd], 'tests': 0, 'clientes': set()}
        by_dia[key]['tests'] += 1
        if s.get('userId'):
            by_dia[key]['clientes'].add(s.get('userId'))
        dow_counts[wd] += 1
    por_dia = [{'fecha': v['fecha'], 'label': v['label'], 'dow': v['dow'],
                'tests': v['tests'], 'clientes': len(v['clientes'])}
               for v in by_dia.values()]
    por_dia.sort(key=lambda x: x['fecha'])
    por_dia_semana = [{'dia': DOW[i], 'dia_abbr': DOW_ABBR[i],
                       'es_finde': i >= 5, 'tests': dow_counts[i]} for i in range(7)]

    # ── Técnicos (idTecnico) ────────────────────────────────────────────────
    # Tests realizados por cada técnico (id + nº tests + nº clientes distintos).
    tec_stats = {}
    for s in sessions:
        it = _tecnico_int(s.get('idTecnico'))
        key = it if it is not None else '__none__'
        st = tec_stats.setdefault(key, {'id_tecnico': it, 'n_tests': 0, 'clientes': set()})
        st['n_tests'] += 1
        if s.get('userId'):
            st['clientes'].add(s.get('userId'))
    por_tecnico = [{'id_tecnico': v['id_tecnico'], 'n_tests': v['n_tests'],
                    'n_clientes': len(v['clientes'])} for v in tec_stats.values()]
    por_tecnico.sort(key=lambda x: -x['n_tests'])

    # Fidelización al técnico: de los clientes con ≥2 tests que tengan técnico
    # asignado en ≥2 de ellos, cuántos repiten SIEMPRE con el mismo técnico.
    fidel = {'clientes_evaluables': 0, 'mismo_tecnico': 0, 'distinto_tecnico': 0, 'pct_mismo': 0}
    for v in clientes_dict.values():
        tecs = [_tecnico_int(s.get('idTecnico')) for s in v['tests']]
        tecs = [t for t in tecs if t is not None]
        if len(tecs) < 2:
            continue
        fidel['clientes_evaluables'] += 1
        if len(set(tecs)) == 1:
            fidel['mismo_tecnico'] += 1
        else:
            fidel['distinto_tecnico'] += 1
    if fidel['clientes_evaluables']:
        fidel['pct_mismo'] = round(100 * fidel['mismo_tecnico'] / fidel['clientes_evaluables'], 1)

    ids_tec = [v['id_tecnico'] for v in por_tecnico if v['id_tecnico'] is not None]
    nombres_tec = _tecnicos_nombres(id_manager, ids_tec) if (id_manager and ids_tec) else {}
    tecnicos_map = {str(k): v for k, v in nombres_tec.items()}

    return {
        'total_tests': total_tests,
        'clientes_con_test': clientes_con_test,
        'tasa_completitud': tasa_completitud,
        'puntuacion_media': puntuacion_media,
        'media_dias_entre_tests': media_dias,
        'tests_repetidos_pct': round(
            100 * sum(1 for v in clientes_dict.values() if len(v['tests']) > 1)
                  / clientes_con_test, 1) if clientes_con_test else 0,
        'por_mes': por_mes, 'por_tipo': por_tipo,
        'distribucion_repeticion': distribucion_repeticion,
        'demografico': {'por_sexo': por_sexo, 'por_edad_bucket': por_edad},
        'top_clientes': top_clientes,
        'ranking_puntuacion': ranking_puntuacion,
        'progreso_clientes': progreso,
        'por_dia': por_dia,
        'por_dia_semana': por_dia_semana,
        'por_tecnico': por_tecnico,
        'fidelizacion_tecnico': fidel,
        'tecnicos': tecnicos_map,
    }
