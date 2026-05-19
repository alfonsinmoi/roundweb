"""Proxy a NoofitPro getRetos.

NoofitPro expone `/api/dispositivos/getRetos` SOLO en el espacio de cada
trainer (la cuenta manager devuelve 0 retos). Este blueprint autentica
como cada trainer activo del manager y agrega la lista completa.

Endpoints:
  GET /api/retos                  — lista TODOS los retos del manager
                                    (acumula los de cada trainer)
  GET /api/retos/<reto_id>        — detalle de un reto concreto
                                    (busca en todos los trainers)
  POST /api/retos/snapshot        — fuerza guardado de snapshot diario
                                    (lo usa el cron)

Cache en memoria: 5 min por manager (evita martillear NoofitPro).
"""
import datetime as dt
import hashlib
import logging
import threading
import time

import requests
import urllib3
from flask import Blueprint, request, jsonify, g

from ..auth import auth_required
from ..db import get_conn

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

bp = Blueprint('retos', __name__)
log = logging.getLogger(__name__)

NF_BASE = 'https://pro.wiemspro.com/wiemspro'
APP_VER = '1.8.39'
CACHE_TTL_SECONDS = 300  # 5 min

_cache_lock = threading.Lock()
_retos_cache: dict = {}   # {id_manager: (timestamp, [retos])}


def _md5_upper(s: str) -> str:
    return hashlib.md5(s.encode()).hexdigest().upper()


def _login(email: str, pwd: str):
    """Login en NoofitPro. Devuelve (token, manager_hdr)."""
    r = requests.post(f'{NF_BASE}/account/loginEasy',
        json={'email': email, 'appVersion': APP_VER, 'password': _md5_upper(pwd)},
        headers={'Content-Type': 'application/json'},
        verify=False, timeout=20)
    r.raise_for_status()
    return r.headers.get('X-CustomToken'), r.headers.get('X-TRAINER_MANAGER', '')


def _headers(token: str, mgr: str) -> dict:
    return {'X-CustomToken': token, 'X-TRAINER_MANAGER': str(mgr or ''),
            'locale': 'es', 'appVersion': APP_VER, 'appId': '1'}


def _trainers_creds(id_manager: str):
    """Lista (id_trainer, email, password) para los trainers de un manager."""
    out = []
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT id_trainer, noofit_email, noofit_password
              FROM trainer_noofit_creds
             WHERE id_manager=%s AND activo=TRUE
        """, (str(id_manager),))
        for r in cur.fetchall():
            if r.get('noofit_email') and r.get('noofit_password'):
                out.append((str(r['id_trainer']),
                            r['noofit_email'], r['noofit_password']))
    return out


def _fetch_retos_manager(id_manager: str):
    """Llama a getRetos por cada trainer del manager y devuelve la lista
    agregada (con `id_trainer_round` añadido a cada reto)."""
    with _cache_lock:
        cached = _retos_cache.get(str(id_manager))
        if cached and time.time() - cached[0] < CACHE_TTL_SECONDS:
            return cached[1]

    retos = []
    for id_trainer, email, pwd in _trainers_creds(id_manager):
        try:
            tok, mgr = _login(email, pwd)
        except Exception as e:
            log.warning(f'login {email}: {e}')
            continue
        try:
            r = requests.get(f'{NF_BASE}/api/dispositivos/getRetos',
                             headers=_headers(tok, mgr),
                             verify=False, timeout=30)
            d = r.json() if r.text else {}
            arr = d.get('Retos') or d.get('retos') or []
            for item in arr:
                item['_id_trainer_round'] = id_trainer
            retos.extend(arr)
        except Exception as e:
            log.warning(f'getRetos trainer={id_trainer}: {e}')

    with _cache_lock:
        _retos_cache[str(id_manager)] = (time.time(), retos)
    return retos


@bp.route('', methods=['GET'])
@bp.route('/', methods=['GET'])
@auth_required
def list_retos():
    """Lista todos los retos del manager (agregados de todos sus trainers).

    Filtros:
      ?estado=activo|inactivo     filtra por campo `estado` del reto
      ?id_trainer=<id>            sólo retos de un trainer concreto
      ?force=1                    bypassa cache (refrescar manual)
    """
    if request.args.get('force') == '1':
        with _cache_lock:
            _retos_cache.pop(str(g.id_manager), None)

    retos = _fetch_retos_manager(g.id_manager)

    # Filtros opcionales
    estado = (request.args.get('estado') or '').strip()
    id_trainer = (request.args.get('id_trainer') or '').strip()
    if estado:
        retos = [r for r in retos if str(r.get('estado','')).lower() == estado.lower()]
    if id_trainer:
        retos = [r for r in retos if str(r.get('_id_trainer_round')) == id_trainer]

    # Si hay g.id_trainer (impersonando trainer), filtramos por él
    if g.id_trainer and not id_trainer:
        retos = [r for r in retos if str(r.get('_id_trainer_round')) == str(g.id_trainer)]

    # Convertir timestamps si vienen en ms desde epoch
    for r in retos:
        for k in ('fechaInicio', 'fechaFin'):
            v = r.get(k)
            if isinstance(v, (int, float)) and v > 10**10:
                try:
                    r[f'{k}_iso'] = dt.datetime.fromtimestamp(v / 1000).isoformat()
                except Exception:
                    pass

    return jsonify({'ok': True, 'retos': retos, 'total': len(retos)})


@bp.route('/<int:reto_id>', methods=['GET'])
@auth_required
def get_reto(reto_id):
    """Detalle de un reto concreto (busca en la lista cacheada)."""
    retos = _fetch_retos_manager(g.id_manager)
    reto = next((r for r in retos if r.get('id') == reto_id), None)
    if not reto:
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    return jsonify({'ok': True, 'reto': reto})


# ─── SNAPSHOT (cron) ────────────────────────────────────────────────────────

def snapshot_retos_manager(id_manager: str):
    """Guarda el estado de los retos del manager en `reto_snapshot`.
    Idempotente por (id_manager, reto_id, fecha): un solo snapshot por día."""
    retos = _fetch_retos_manager(id_manager)
    if not retos: return 0

    today = dt.date.today()
    n_ins = 0
    with get_conn() as conn, conn.cursor() as cur:
        for r in retos:
            cur.execute("""
                INSERT INTO reto_snapshot
                  (id_manager, id_trainer, reto_id, fecha, nombre, descripcion,
                   tipo_reto, tipo_metrica, estado,
                   fecha_inicio, fecha_fin,
                   n_participantes, n_equipos, datos_raw)
                VALUES (%s,%s,%s,%s,%s,%s, %s,%s,%s, %s,%s, %s,%s, %s::jsonb)
                ON CONFLICT (id_manager, reto_id, fecha) DO UPDATE SET
                  n_participantes = EXCLUDED.n_participantes,
                  n_equipos       = EXCLUDED.n_equipos,
                  estado          = EXCLUDED.estado,
                  datos_raw       = EXCLUDED.datos_raw,
                  updated_at      = NOW()
            """, (
                str(id_manager),
                str(r.get('_id_trainer_round') or ''),
                int(r.get('id') or 0),
                today,
                r.get('nombre') or '',
                r.get('descripcion') or '',
                int(r.get('tipoReto') or 0),
                int(r.get('tipoMetrica') or 0),
                str(r.get('estado') or ''),
                _epoch_to_iso(r.get('fechaInicio')),
                _epoch_to_iso(r.get('fechaFin')),
                len(r.get('participantes') or []),
                len(r.get('equipos') or []),
                __import__('json').dumps(r, default=str, ensure_ascii=False),
            ))
            n_ins += 1
    return n_ins


def _epoch_to_iso(v):
    if isinstance(v, (int, float)) and v > 10**10:
        try:
            return dt.datetime.fromtimestamp(v / 1000).date().isoformat()
        except Exception:
            return None
    return None


@bp.route('/snapshot', methods=['POST'])
@auth_required
def snapshot():
    """Fuerza el snapshot diario para este manager. Lo usa el cron."""
    n = snapshot_retos_manager(g.id_manager)
    return jsonify({'ok': True, 'snapshots': n})


# ─── Helper para el módulo de "Clientes en riesgo" ──────────────────────────

def retos_completados_por_cliente(id_manager: str, dias: int = 90):
    """Devuelve {idnoofit_cliente: nº_retos_completados_o_activos} en los
    últimos `dias` días. Se usa como señal en el score de "Clientes en riesgo":
    un cliente con retos completados tiene engagement alto → su score baja.

    Implementación: extrae participantes de retos cuya fechaInicio sea
    posterior a (hoy - dias).
    """
    retos = _fetch_retos_manager(id_manager)
    if not retos: return {}

    limite = dt.date.today() - dt.timedelta(days=dias)
    contador = {}
    for r in retos:
        # Filtrar por ventana
        fi = r.get('fechaInicio')
        if isinstance(fi, (int, float)) and fi > 10**10:
            fi_date = dt.datetime.fromtimestamp(fi / 1000).date()
            if fi_date < limite: continue
        # Acumular participantes
        for p in (r.get('participantes') or []):
            if not isinstance(p, dict): continue
            cli = p.get('idClient') or p.get('clienteId') or p.get('idCliente')
            if cli:
                contador[str(cli)] = contador.get(str(cli), 0) + 1
    return contador
