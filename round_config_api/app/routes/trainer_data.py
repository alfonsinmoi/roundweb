"""Proxy de datos NoofitPro filtrados por trainer.

El usuario_web (con id_trainer) solo debe ver datos de su centro. NoofitPro no
soporta filtro server-side por trainer en getClienteSimple/getSalasByManager,
así que aquí actuamos de proxy:

  1. Recibimos petición autenticada por JWT (usuario_web_required)
  2. Hacemos auto-login en NoofitPro con credenciales del manager (cache token)
  3. Llamamos al endpoint NoofitPro y CACHEAMOS la respuesta completa por
     manager_id (5 min TTL) — todos los usuarios_web del mismo manager
     comparten cache, así no se duplica carga
  4. Filtramos en memoria por id_trainer del usuario logueado
  5. Devolvemos al frontend SOLO los datos que le tocan

Endpoints:
  GET  /api/trainer-data/clientes          — lista clientes filtrada
  POST /api/trainer-data/salas             — body opcional {fechaDesde, fechaHasta}
"""
import datetime as dt
import hashlib
import logging
import threading

import requests
import urllib3
from flask import Blueprint, request, jsonify, g

from ..auth_usuario import usuario_web_required
from ..db import get_conn

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

bp = Blueprint('trainer_data', __name__)
log = logging.getLogger(__name__)

NOOFIT_BASE = 'https://pro.wiemspro.com/wiemspro'
NOOFIT_APP_VERSION = '1.8.39'
CACHE_TTL_SECONDS = 300  # 5 min

# Cache en memoria. Estructura:
#   _cache[(manager_id, key)] = { 'ts': datetime, 'data': [...] }
_cache: dict = {}
_cache_lock = threading.Lock()
# Login NoofitPro tokens cacheados también
_nf_tokens: dict = {}   # manager_id -> {'token': str, 'manager_header': str, 'ts': datetime}


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


# ─── Endpoints ─────────────────────────────────────────────────────────────────

@bp.route('/clientes', methods=['GET'])
@usuario_web_required
def clientes():
    """Devuelve la lista de clientes filtrada por id_trainer del usuario.

    Excepción: si el usuario tiene perfil con is_admin=true (Administrador del
    manager) NO se filtra por trainer → ve TODOS los clientes del manager.
    Esto permite que un admin que casualmente esté ligado a un id_trainer
    (por necesidad de credenciales NF) no vea solo los de su centro.
    """
    id_manager = g.id_manager
    id_trainer = g.id_trainer
    is_admin = bool(g.usuario_web.get('perfil_is_admin'))
    # Override admin: ?id_trainer=X permite ver solo los clientes de un trainer
    # concreto (selector de cabecera). Si pasa "all" o no se pasa → todos.
    override = (request.args.get('id_trainer') or '').strip()
    if is_admin:
        if override and override.lower() not in ('all', '*', ''):
            trainer_filtro = override
        else:
            trainer_filtro = None    # admin sin override → todos
    else:
        trainer_filtro = id_trainer  # no-admin: siempre su trainer
    cache_key = 'clientes'

    # 1. Mirar cache (lista completa del manager)
    full = _cache_get(id_manager, id_trainer, cache_key)
    if full is None:
        # 2. Login NoofitPro
        tok, mgr_h = _login_noofit(id_manager, id_trainer)
        if not tok:
            return jsonify({'ok': False, 'error': 'noofit_login_failed'}), 502
        # 3. GET getClienteSimple
        try:
            r = requests.get(f'{NOOFIT_BASE}/api/dispositivos/getClienteSimple',
                             headers=_nf_headers(tok, mgr_h),
                             verify=False, timeout=60)
            if r.status_code != 200:
                return jsonify({'ok': False, 'error': f'noofit_status_{r.status_code}'}), 502
            d = r.json()
            full = d.get('clientes', [])
            _cache_set(id_manager, id_trainer, cache_key, full)
        except Exception as e:
            log.exception('proxy clientes')
            return jsonify({'ok': False, 'error': str(e)}), 502

    filtered = _filter_by_trainer(full, trainer_filtro)
    return jsonify({'ok': True, 'mensaje': 'OK', 'clientes': filtered,
                    'total_full': len(full), 'total_filtered': len(filtered),
                    'is_admin': is_admin})


@bp.route('/salas', methods=['POST'])
@usuario_web_required
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
    # Override admin via body o querystring
    override = (d.get('id_trainer') or request.args.get('id_trainer') or '').strip()
    if is_admin:
        if override and override.lower() not in ('all', '*', ''):
            trainer_filtro = override
        else:
            trainer_filtro = None
    else:
        trainer_filtro = id_trainer
    filtered = _filter_by_trainer(full, trainer_filtro)
    return jsonify({'ok': True, 'mensaje': 'OK', 'salas': filtered,
                    'total_full': len(full), 'total_filtered': len(filtered),
                    'is_admin': is_admin})


@bp.route('/cache', methods=['DELETE'])
@usuario_web_required
def invalidate_cache():
    """Invalida la cache del manager actual (útil tras crear/editar cliente)."""
    id_manager = g.id_manager
    with _cache_lock:
        keys_to_del = [k for k in _cache if k[0] == id_manager]
        for k in keys_to_del:
            _cache.pop(k, None)
    return jsonify({'ok': True, 'invalidated': len(keys_to_del)})
