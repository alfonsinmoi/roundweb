"""Proxy de datos NoofitPro filtrados por trainer.

El usuario_web (con id_trainer) solo debe ver datos de su centro. NoofitPro no
soporta filtro server-side por trainer en getClienteSimple/getSalasByManager,
así que aquí actuamos de proxy.

**Clientes**: se sirven SIEMPRE desde la tabla local `cliente_cache` (lectura
~50 ms). Al cargar se dispara un sync en background (anti-stampede 60 s) y un
cron horario refresca la cache. La primera carga del día ya no requiere
login + getClienteSimple en el camino crítico.

**Salas**: aún se piden a NoofitPro con cache en memoria 5 min.

Endpoints:
  GET  /api/trainer-data/clientes          — lista clientes (BD local)
  POST /api/trainer-data/clientes/sync     — fuerza refresco desde NoofitPro
  POST /api/trainer-data/salas             — body opcional {fechaDesde, fechaHasta}
  DELETE /api/trainer-data/cache           — invalida cache en memoria de salas
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

from ..auth import require_seccion
from ..auth_usuario import usuario_web_required
from ..db import get_conn

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

bp = Blueprint('trainer_data', __name__)
log = logging.getLogger(__name__)

NOOFIT_BASE = 'https://pro.wiemspro.com/wiemspro'
NOOFIT_APP_VERSION = '1.8.39'
CACHE_TTL_SECONDS = 300  # 5 min (salas)
# Anti-stampede del sync background de clientes — si ya hay uno corriendo o
# acaba de terminar, no relanzamos.
CLIENTES_SYNC_MIN_INTERVALO_SEG = 60

# Cache en memoria de salas. Estructura:
#   _cache[(manager_id, trainer_id, key)] = { 'ts': datetime, 'data': [...] }
_cache: dict = {}
_cache_lock = threading.Lock()
# Login NoofitPro tokens cacheados también
_nf_tokens: dict = {}   # (manager_id, trainer_id) -> {'token':..., 'manager_header':..., 'ts':...}

# Anti-stampede del sync background de cliente_cache
_clientes_bg_lock = threading.Lock()
_clientes_bg_running = set()   # set de id_manager con sync en curso
_clientes_bg_last_run = {}     # id_manager -> timestamp de último fin


def _now():
    return dt.datetime.now(dt.timezone.utc)


def _login_noofit(id_manager: str, id_trainer: str = None):
    """Login en NoofitPro:
       - Si hay credenciales en trainer_noofit_creds para (manager, trainer) → usa esas
       - Si no, fallback a manager_config (sesión gestor)
    Cache de tokens por (manager_id, trainer_id) durante 30 min.
    """
    cache_key = (str(id_manager), str(id_trainer or ''))
    with _cache_lock:
        cached = _nf_tokens.get(cache_key)
        if cached and (_now() - cached['ts']).total_seconds() < 1800:
            return cached['token'], cached['manager_header']
    try:
        # 1) Buscar credenciales específicas del trainer
        creds = None
        if id_trainer:
            with get_conn() as conn, conn.cursor() as cur:
                cur.execute("""
                    SELECT noofit_email, noofit_password
                      FROM trainer_noofit_creds
                     WHERE id_manager=%s AND id_trainer=%s AND activo=TRUE
                    LIMIT 1
                """, (str(id_manager), str(id_trainer)))
                creds = cur.fetchone()
        # 2) Fallback al manager_config (gestor)
        if not creds:
            with get_conn() as conn, conn.cursor() as cur:
                cur.execute("""
                    SELECT noofit_email, noofit_password
                      FROM manager_config
                     WHERE id_manager=%s AND activo=TRUE
                    LIMIT 1
                """, (str(id_manager),))
                creds = cur.fetchone()
            if not creds:
                with get_conn() as conn, conn.cursor() as cur:
                    cur.execute("SELECT noofit_email, noofit_password FROM manager_config WHERE activo=TRUE LIMIT 1")
                    creds = cur.fetchone()
        if not creds or not creds['noofit_email'] or not creds['noofit_password']:
            return None, None
        body = {'email': creds['noofit_email'], 'appVersion': NOOFIT_APP_VERSION,
                'password': hashlib.md5(creds['noofit_password'].encode()).hexdigest().upper()}
        r = requests.post(f'{NOOFIT_BASE}/account/loginEasy',
                          json=body, headers={'Content-Type': 'application/json'},
                          verify=False, timeout=20)
        if r.status_code != 200:
            log.warning(f'_login_noofit: fallo login {creds["noofit_email"]} status={r.status_code}')
            return None, None
        tok = r.headers.get('X-CustomToken')
        mgr = r.headers.get('X-TRAINER_MANAGER', '')
        with _cache_lock:
            _nf_tokens[cache_key] = {'token': tok, 'manager_header': mgr, 'ts': _now()}
        log.info(f'_login_noofit OK como {creds["noofit_email"]} (manager={id_manager} trainer={id_trainer})')
        return tok, mgr
    except Exception as e:
        log.warning(f'_login_noofit error: {e}')
        return None, None


def _nf_headers(token, manager_header, extra=None):
    h = {'X-CustomToken': token, 'X-TRAINER_MANAGER': str(manager_header or ''),
         'locale': 'es', 'appVersion': NOOFIT_APP_VERSION, 'appId': '1',
         'Content-Type': 'application/json'}
    if extra: h.update(extra)
    return h


def _cache_get(manager_id: str, trainer_id: str, key: str):
    with _cache_lock:
        entry = _cache.get((manager_id, trainer_id or '', key))
        if entry and (_now() - entry['ts']).total_seconds() < CACHE_TTL_SECONDS:
            return entry['data']
    return None


def _cache_set(manager_id: str, trainer_id: str, key: str, data):
    with _cache_lock:
        _cache[(manager_id, trainer_id or '', key)] = {'ts': _now(), 'data': data}


def _filter_by_trainer(items, id_trainer, key='idTrainer'):
    """Filtra una lista por idTrainer. Si id_trainer es falsy, no filtra."""
    if not id_trainer:
        return items
    tf = str(id_trainer)
    return [x for x in items if str(x.get(key, '') or x.get('trainerId', '')) == tf]


# ─── Cache de clientes en BD local ─────────────────────────────────────────

def _upsert_clientes(id_manager: str, clientes: list, *, full_sync: bool,
                     solo_id_trainer: str = None):
    """UPSERT masivo en cliente_cache. Devuelve nº de clientes escritos.

    `full_sync=True`  → además, BORRA de cliente_cache los ids del manager
                        que NO aparecen en `clientes`. Solo activarlo cuando
                        la lista representa el conjunto COMPLETO del manager
                        (todas las credenciales NF dieron respuesta OK).
    `full_sync=False` → solo INSERT/UPDATE. Útil para syncs parciales (p. ej.
                        si una de las cuentas fallo y no queremos perder los
                        clientes que esa cuenta veía)."""
    with get_conn() as conn, conn.cursor() as cur:
        ids_actuales = set()
        for c in clientes:
            cid = c.get('id')
            if cid is None: continue
            ids_actuales.add(int(cid))
            cur.execute("""
                INSERT INTO cliente_cache (
                    id, id_manager, id_trainer, enabled, name, surname, email,
                    dt_edition_date, raw_data, synced_at
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, NOW()
                )
                ON CONFLICT (id_manager, id) DO UPDATE SET
                    id_trainer      = EXCLUDED.id_trainer,
                    enabled         = EXCLUDED.enabled,
                    name            = EXCLUDED.name,
                    surname         = EXCLUDED.surname,
                    email           = EXCLUDED.email,
                    dt_edition_date = EXCLUDED.dt_edition_date,
                    raw_data        = EXCLUDED.raw_data,
                    synced_at       = NOW()
            """, (
                int(cid), str(id_manager),
                int(c['idTrainer']) if c.get('idTrainer') is not None else None,
                bool(c.get('enabled', True)),
                (c.get('name') or '')[:160] or None,
                (c.get('surname') or '')[:240] or None,
                (c.get('email') or '')[:160] or None,
                int(c['dtEditionDate']) if c.get('dtEditionDate') else None,
                json.dumps(c, ensure_ascii=False, default=str),
            ))
        if full_sync and ids_actuales:
            if solo_id_trainer:
                # Sync de UN solo trainer → solo purgamos clientes obsoletos de
                # ESE trainer; los de otros trainers del manager se respetan
                # (antes el DELETE era manager-wide y borraba los demás centros).
                cur.execute("""
                    DELETE FROM cliente_cache
                     WHERE id_manager=%s AND id_trainer=%s AND id <> ALL(%s)
                """, (str(id_manager), str(solo_id_trainer), list(ids_actuales)))
            else:
                cur.execute("""
                    DELETE FROM cliente_cache
                     WHERE id_manager=%s AND id <> ALL(%s)
                """, (str(id_manager), list(ids_actuales)))
        cur.execute("""
            INSERT INTO cliente_cache_sync (id_manager, synced_at, n_clientes, ultima_falla)
            VALUES (%s, NOW(), %s, NULL)
            ON CONFLICT (id_manager) DO UPDATE SET
                synced_at = NOW(),
                n_clientes = EXCLUDED.n_clientes,
                ultima_falla = NULL
        """, (str(id_manager), len(clientes)))
    return len(clientes)


def _credenciales_a_usar(id_manager: str, id_trainer: str = None):
    """Devuelve la lista de credenciales NF a iterar para sincronizar el
    manager. Política:

      • Si `id_trainer` se pasa → solo esa credencial.
      • Si no:
          - Si hay filas activas en `trainer_noofit_creds` del manager →
            iterar TODAS (preferimos cuentas trainer porque ven más clientes
            que el manager top-level).
          - Si NO hay ninguna → fallback al manager (manager_config).

    Devuelve: [(id_trainer_o_None, email, password), ...]"""
    out = []
    with get_conn() as conn, conn.cursor() as cur:
        if id_trainer:
            cur.execute("""
                SELECT id_trainer, noofit_email, noofit_password
                  FROM trainer_noofit_creds
                 WHERE id_manager=%s AND id_trainer=%s AND activo=TRUE
                 LIMIT 1""", (str(id_manager), str(id_trainer)))
            r = cur.fetchone()
            if r and r['noofit_email']:
                return [(str(r['id_trainer']), r['noofit_email'], r['noofit_password'])]
            # Fallback al manager si la credencial trainer no existe
        # Iterar TODOS los trainers activos
        cur.execute("""
            SELECT id_trainer, noofit_email, noofit_password
              FROM trainer_noofit_creds
             WHERE id_manager=%s AND activo=TRUE
             ORDER BY id_trainer""", (str(id_manager),))
        for r in cur.fetchall():
            if r['noofit_email']:
                out.append((str(r['id_trainer']), r['noofit_email'], r['noofit_password']))
        if out:
            return out
        # Fallback manager_config
        cur.execute("""
            SELECT noofit_email, noofit_password
              FROM manager_config
             WHERE id_manager=%s AND activo=TRUE
             LIMIT 1""", (str(id_manager),))
        r = cur.fetchone()
        if r and r['noofit_email']:
            return [(None, r['noofit_email'], r['noofit_password'])]
    return []


def _sync_clientes_manager(id_manager: str, id_trainer: str = None):
    """Hace login + getClienteSimple para CADA cuenta NF del manager y
    unifica los clientes en cliente_cache (UPSERT por id). Las cuentas de
    trainer ven cada una el subconjunto de clientes asignados a su centro;
    al iterar y consolidar tenemos la lista completa.

    Devuelve {'ok': bool, 'n_clientes': int, 'n_cuentas_ok': int,
              'n_cuentas': int, 'error': str?}."""
    creds = _credenciales_a_usar(id_manager, id_trainer)
    if not creds:
        msg = 'sin_credenciales_nf'
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                INSERT INTO cliente_cache_sync (id_manager, synced_at, n_clientes, ultima_falla)
                VALUES (%s, NOW(), 0, %s)
                ON CONFLICT (id_manager) DO UPDATE SET
                    ultima_falla = EXCLUDED.ultima_falla,
                    synced_at = NOW()
            """, (str(id_manager), msg))
        return {'ok': False, 'n_clientes': 0, 'n_cuentas_ok': 0,
                'n_cuentas': 0, 'error': msg}

    # Consolidar clientes de todas las cuentas (UPSERT por id, primera gana)
    todos_dict = {}        # id → cliente raw
    fallos = []
    for (tid, email, pwd) in creds:
        # _login_noofit ya tiene su propio cache, lo reutilizamos si está
        # caliente. Si no, hace login.
        tok, mgr_h = _login_noofit(id_manager, tid)
        if not tok:
            fallos.append(f'{email}: login_failed')
            continue
        try:
            r = requests.get(f'{NOOFIT_BASE}/api/dispositivos/getClienteSimple',
                             headers=_nf_headers(tok, mgr_h),
                             verify=False, timeout=60)
            if r.status_code != 200:
                fallos.append(f'{email}: HTTP {r.status_code}')
                continue
            clientes = (r.json() or {}).get('clientes', []) or []
            log.info(f'_sync_clientes_manager {email} (trainer={tid}): {len(clientes)} clientes')
            for c in clientes:
                cid = c.get('id')
                if cid is not None and cid not in todos_dict:
                    todos_dict[cid] = c
        except Exception as e:
            fallos.append(f'{email}: {e}')

    n_ok = len(creds) - len(fallos)
    full = (n_ok == len(creds))   # solo DELETE si TODAS las cuentas OK
    if not todos_dict and fallos:
        # Sin resultados y con fallos → reportar y abortar (no toques la BD)
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                INSERT INTO cliente_cache_sync (id_manager, synced_at, n_clientes, ultima_falla)
                VALUES (%s, NOW(), 0, %s)
                ON CONFLICT (id_manager) DO UPDATE SET
                    ultima_falla = EXCLUDED.ultima_falla,
                    synced_at = NOW()
            """, (str(id_manager), '; '.join(fallos)[:300]))
        return {'ok': False, 'n_clientes': 0, 'n_cuentas_ok': 0,
                'n_cuentas': len(creds), 'error': '; '.join(fallos)}

    # Si el sync es de un solo trainer (id_trainer dado), el DELETE de
    # full_sync debe limitarse a ese trainer — no borrar los clientes de los
    # otros centros del manager.
    n = _upsert_clientes(id_manager, list(todos_dict.values()), full_sync=full,
                         solo_id_trainer=(str(id_trainer) if id_trainer else None))
    if fallos:
        log.warning(f'_sync_clientes_manager {id_manager}: parciales, fallos={fallos}')
    return {'ok': True, 'n_clientes': n,
            'n_cuentas_ok': n_ok, 'n_cuentas': len(creds),
            'parciales': fallos or None}


def _sync_clientes_background(id_manager: str, id_trainer: str = None):
    """Lanza _sync_clientes_manager en daemon thread con anti-stampede."""
    key = str(id_manager)
    now = time.time()
    with _clientes_bg_lock:
        if key in _clientes_bg_running:
            return False
        last = _clientes_bg_last_run.get(key, 0)
        if (now - last) < CLIENTES_SYNC_MIN_INTERVALO_SEG:
            return False
        _clientes_bg_running.add(key)

    def _run():
        try:
            r = _sync_clientes_manager(id_manager, id_trainer)
            log.info(f'sync_clientes_background {id_manager}: {r}')
        finally:
            with _clientes_bg_lock:
                _clientes_bg_running.discard(key)
                _clientes_bg_last_run[key] = time.time()

    threading.Thread(target=_run, daemon=True).start()
    return True


def _read_clientes_local(id_manager: str):
    """Lee de cliente_cache (instantáneo). Devuelve la lista de raw_data."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT raw_data FROM cliente_cache
             WHERE id_manager = %s
             ORDER BY surname NULLS LAST, name NULLS LAST
        """, (str(id_manager),))
        rows = cur.fetchall()
    out = []
    for r in rows:
        d = r['raw_data']
        if isinstance(d, str):
            try: d = json.loads(d)
            except Exception: continue
        out.append(d)
    return out


def _clientes_sync_state(id_manager: str):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT synced_at, n_clientes, ultima_falla
              FROM cliente_cache_sync
             WHERE id_manager = %s
        """, (str(id_manager),))
        r = cur.fetchone()
    if not r:
        return {'synced_at': None, 'n_clientes': 0, 'ultima_falla': None,
                'edad_seg': None}
    edad = None
    if r['synced_at']:
        edad = (dt.datetime.now(r['synced_at'].tzinfo) - r['synced_at']).total_seconds()
    return {
        'synced_at': r['synced_at'].isoformat() if r['synced_at'] else None,
        'n_clientes': r['n_clientes'] or 0,
        'ultima_falla': r['ultima_falla'],
        'edad_seg': int(edad) if edad is not None else None,
    }


# ─── Endpoints ─────────────────────────────────────────────────────────────────

@bp.route('/clientes', methods=['GET'])
@usuario_web_required
@require_seccion('clientes')
def clientes():
    """Devuelve la lista de clientes del manager, leyendo SIEMPRE de la cache
    local en BD (~50 ms). Si la cache está vacía o es muy antigua, sincroniza
    en background; si está vacía Y nunca se ha sincronizado, hace el sync de
    forma SÍNCRONA en esta petición (primer arranque del manager).

    Filtrado por id_trainer:
      - Admin del manager: sin filtro, o con `?id_trainer=X` para ver uno
      - Usuario_web normal: siempre filtrado por su id_trainer del JWT
    """
    id_manager = g.id_manager
    id_trainer = g.id_trainer
    is_admin = bool(g.usuario_web.get('perfil_is_admin'))
    override = (request.args.get('id_trainer') or '').strip()
    # Nueva regla (mayo 2026): si el usuario eligió un centro al login (su JWT
    # lleva id_trainer), queda BLOQUEADO a ese centro durante la sesión —
    # tiene que hacer logout para cambiar. Solo el manager bare (sin id_trainer
    # en el JWT) puede ver "Todos los centros" o filtrar por ?id_trainer=X.
    if id_trainer:
        trainer_filtro = id_trainer
    elif is_admin:
        trainer_filtro = override if (override and override.lower() not in ('all', '*', '')) else None
    else:
        trainer_filtro = None

    full = _read_clientes_local(id_manager)
    state = _clientes_sync_state(id_manager)

    # Caso degenerado: BD vacía Y nunca sincronizado → sync síncrono para no
    # devolver una lista vacía la primera vez que se abre.
    if not full and not state['synced_at']:
        log.info(f'cliente_cache vacía para manager={id_manager}, sync síncrono')
        _sync_clientes_manager(id_manager, id_trainer)
        full = _read_clientes_local(id_manager)
        state = _clientes_sync_state(id_manager)
    else:
        # Caso normal: devolver instantáneo + refrescar en background.
        _sync_clientes_background(id_manager, id_trainer)

    filtered = _filter_by_trainer(full, trainer_filtro)
    return jsonify({'ok': True, 'mensaje': 'OK', 'clientes': filtered,
                    'total_full': len(full), 'total_filtered': len(filtered),
                    'is_admin': is_admin, 'sync': state, 'fuente': 'local'})


@bp.route('/clientes/sync', methods=['POST'])
@usuario_web_required
def clientes_sync():
    """Fuerza un refresco inmediato desde NoofitPro. Usar tras altas/edits."""
    id_manager = g.id_manager
    id_trainer = g.id_trainer
    result = _sync_clientes_manager(id_manager, id_trainer)
    state = _clientes_sync_state(id_manager)
    return jsonify({'ok': result['ok'], 'n_clientes': result['n_clientes'],
                    'error': result.get('error'), 'sync': state})


@bp.route('/salas', methods=['POST'])
@usuario_web_required
@require_seccion('clientes')
def salas():
    """Devuelve salas (clases) filtradas por id_trainer.
    Body opcional: {fechaDesde, fechaHasta} — si no, sin filtro de fechas."""
    d = request.get_json() or {}
    id_manager = g.id_manager
    id_trainer = g.id_trainer
    fd = d.get('fechaDesde'); fh = d.get('fechaHasta')

    cache_key = f'salas:{fd or ""}:{fh or ""}'
    full = _cache_get(id_manager, id_trainer, cache_key)
    if full is None:
        tok, mgr_h = _login_noofit(id_manager, id_trainer)
        if not tok:
            return jsonify({'ok': False, 'error': 'noofit_login_failed'}), 502
        body = {}
        if fd: body['fechaDesde'] = fd
        if fh: body['fechaHasta'] = fh
        # Endpoint distinto si vienen rangos
        endpoint = '/api/dispositivos/getSalasByManagerByRange' if (fd and fh) else '/api/dispositivos/getSalasByManager'
        if endpoint.endswith('getSalasByManager'):
            body['idManager'] = mgr_h
        try:
            r = requests.post(f'{NOOFIT_BASE}{endpoint}', json=body,
                              headers=_nf_headers(tok, mgr_h, {'initialId': '0'}),
                              verify=False, timeout=60)
            if r.status_code != 200:
                return jsonify({'ok': False, 'error': f'noofit_status_{r.status_code}',
                                'body': r.text[:300]}), 502
            full = (r.json().get('salas') or [])
            _cache_set(id_manager, id_trainer, cache_key, full)
        except Exception as e:
            log.exception('proxy salas')
            return jsonify({'ok': False, 'error': str(e)}), 502

    is_admin = bool(g.usuario_web.get('perfil_is_admin'))
    # Override admin via body o querystring (solo si JWT no lleva centro fijo).
    override = (d.get('id_trainer') or request.args.get('id_trainer') or '').strip()
    if id_trainer:
        # Usuario eligió centro en login → bloqueado durante la sesión.
        trainer_filtro = id_trainer
    elif is_admin:
        if override and override.lower() not in ('all', '*', ''):
            trainer_filtro = override
        else:
            trainer_filtro = None
    else:
        trainer_filtro = None
    filtered = _filter_by_trainer(full, trainer_filtro)
    return jsonify({'ok': True, 'mensaje': 'OK', 'salas': filtered,
                    'total_full': len(full), 'total_filtered': len(filtered),
                    'is_admin': is_admin})


@bp.route('/cache', methods=['DELETE'])
@usuario_web_required
def invalidate_cache():
    """Invalida la cache de salas en memoria del manager actual."""
    id_manager = g.id_manager
    with _cache_lock:
        keys_to_del = [k for k in _cache if k[0] == id_manager]
        for k in keys_to_del:
            _cache.pop(k, None)
    return jsonify({'ok': True, 'invalidated': len(keys_to_del)})
