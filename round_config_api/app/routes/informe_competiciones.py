"""Informe de COMPETICIONES realizadas por los clientes.

Fuente: NoofitPro `POST /api/dispositivos/getSalasByManagerByRange` (instancias
de clase en un rango de fechas). Una "competición" es una sala con
`competicion=true`; sus participantes vienen embebidos en `sala.users[]`
(cada uno con `idClient`, `nameClient`, `personalRank`, `globalRank`, `verify`).

Se cachea en local (`competicion_realizada`, 1 fila por participación) mediante
un BARRIDO por ventana de fechas (no incremental por cliente, porque el dato es
por sala). Idempotente por `(id_manager, participacion_id)` = `user.id` del join
sala↔cliente. Estado del barrido en `competicion_sync` (1 fila por manager).

Reutiliza el login/token cacheado de estado_fisico (no pasa por noofit_client).
Espejo del feature Ejercicios (routes/informe_ejercicios.py).

Endpoints (bajo /informes y /api/informes):
  GET  /competiciones                 → agregado (totales + ranking + top clientes)
  GET  /competiciones/estado          → estado del barrido
  GET  /competiciones/cliente/<idn>   → competiciones de un cliente (historial)
  POST /competiciones/sync            → fuerza barrido (?force=1 bloqueante)

NOTA (jul 2026): hoy Round no usa la modalidad competición (0 salas con el flag).
El módulo queda listo: en cuanto se creen clases de competición en NoofitPro, el
barrido las recogerá y el informe/ficha las mostrará. Estados vacíos por diseño.
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

# Ventana de barrido por defecto (días hacia atrás). Las competiciones, cuando
# se activen, serán recientes; ampliable vía ?desde/?hasta en /sync.
VENTANA_DIAS = 540
SYNC_MASIVO_MIN_INTERVALO_SEG = 60
SYNC_TTL_HORAS = 12

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


def _iso(d):
    return d.strftime('%Y-%m-%dT00:00:00+00:00')


# ── Sync (barrido por rango) ──────────────────────────────────────────────────

def _upsert_participaciones(id_manager, salas, id_trainer_filter=None):
    """UPSERT de las participaciones de las salas tipo competición.
    Devuelve (n_competiciones, n_participaciones)."""
    n_comp = n_part = 0
    with get_conn() as conn, conn.cursor() as cur:
        for s in salas:
            if not s.get('competicion'):
                continue
            s_trainer = s.get('idTrainer')
            if id_trainer_filter and str(s_trainer or '') != str(id_trainer_filter):
                continue
            n_comp += 1
            sala_id = s.get('id')
            nombre = (s.get('name') or '').strip()[:240] or '(competición)'
            fecha = _epoch_to_ts(s.get('dateStart'))
            for u in (s.get('users') or []):
                pid = u.get('id')
                cli = u.get('idClient')
                if not pid or not cli:
                    continue
                cur.execute("""
                    INSERT INTO competicion_realizada (
                        id_manager, id_trainer, participacion_id, sala_id,
                        cliente_idnoofit, cliente_nombre, competicion_nombre,
                        fecha, personal_rank, global_rank, verify
                    ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT (id_manager, participacion_id) DO UPDATE SET
                        id_trainer         = EXCLUDED.id_trainer,
                        sala_id            = EXCLUDED.sala_id,
                        cliente_idnoofit   = EXCLUDED.cliente_idnoofit,
                        cliente_nombre     = EXCLUDED.cliente_nombre,
                        competicion_nombre = EXCLUDED.competicion_nombre,
                        fecha              = EXCLUDED.fecha,
                        personal_rank      = EXCLUDED.personal_rank,
                        global_rank        = EXCLUDED.global_rank,
                        verify             = EXCLUDED.verify,
                        synced_at          = NOW()
                """, (str(id_manager), str(s_trainer or '') or None, int(pid),
                      int(sala_id) if sala_id else None, int(cli),
                      (u.get('nameClient') or '').strip()[:240] or None,
                      nombre, fecha, u.get('personalRank'), u.get('globalRank'),
                      bool(u.get('verify'))))
                n_part += 1
    return n_comp, n_part


def _marcar_sync(id_manager, *, n_comp=0, n_part=0, falla=None):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            INSERT INTO competicion_sync
                (id_manager, synced_at, n_competiciones, n_participaciones, ultima_falla)
            VALUES (%s, NOW(), %s, %s, %s)
            ON CONFLICT (id_manager) DO UPDATE SET
                synced_at         = NOW(),
                n_competiciones   = EXCLUDED.n_competiciones,
                n_participaciones = EXCLUDED.n_participaciones,
                ultima_falla      = EXCLUDED.ultima_falla
        """, (str(id_manager), n_comp, n_part,
              (str(falla)[:300] if falla else None)))


def _sync_all(id_manager, id_trainer=None, only_stale=True, desde=None, hasta=None):
    """Barre las salas del grupo en la ventana [desde, hasta] y persiste las
    participaciones de las que son competición. getSalasByManagerByRange
    devuelve TODO el grupo con un solo login (basta la 1ª credencial)."""
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
        hasta = hasta or dt.date.today()
        desde = desde or (hasta - dt.timedelta(days=VENTANA_DIAS))
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
        try:
            r = requests.post(f'{NF_BASE}/api/dispositivos/getSalasByManagerByRange',
                              json={'fechaDesde': _iso(desde), 'fechaHasta': _iso(hasta)},
                              headers=_headers(tok, mgr_h), verify=False, timeout=60)
            salas = (r.json() if r.text else {}).get('salas') or []
        except Exception as e:
            _marcar_sync(id_manager, falla=e)
            log.warning(f'competiciones getSalas manager={id_manager}: {e}')
            return {'ok': False, 'error': 'fetch'}
        n_comp, n_part = _upsert_participaciones(id_manager, salas, id_trainer)
        # totales acumulados en BD para el estado
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""SELECT COUNT(DISTINCT sala_id) c, COUNT(*) p
                             FROM competicion_realizada WHERE id_manager=%s""",
                        (str(id_manager),))
            row = cur.fetchone() or {}
        _marcar_sync(id_manager, n_comp=row.get('c') or 0, n_part=row.get('p') or 0)
        return {'ok': True, 'competiciones_barridas': n_comp,
                'participaciones': n_part,
                'ventana': [desde.isoformat(), hasta.isoformat()]}
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

    where = ["cr.id_manager = %s", "cr.fecha >= %s", "cr.fecha < %s::date + 1"]
    vals = [str(g.id_manager), desde, hasta]

    id_trainer, forbidden = resolve_trainer_target(request.args.get('id_trainer'))
    if forbidden:
        return jsonify({'ok': False, 'error': 'trainer_forbidden'}), 403
    if id_trainer:
        where.append("cr.id_trainer = %s")
        vals.append(str(id_trainer))

    base = f"FROM competicion_realizada cr WHERE {' AND '.join(where)}"
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"""SELECT COUNT(DISTINCT cr.sala_id) AS competiciones,
                               COUNT(*) AS participaciones,
                               COUNT(DISTINCT cr.cliente_idnoofit) AS clientes
                        {base}""", vals)
        totales = dict(cur.fetchone() or {})
        # Ranking de competiciones (cada sala) por nº de participantes
        cur.execute(f"""SELECT cr.sala_id, MAX(cr.competicion_nombre) AS nombre,
                               MAX(cr.fecha) AS fecha,
                               COUNT(*) AS participantes
                        {base}
                        GROUP BY cr.sala_id
                        ORDER BY fecha DESC NULLS LAST
                        LIMIT %s""", vals + [limit])
        competiciones = [dict(r) for r in cur.fetchall()]
        # Top clientes por nº de competiciones
        cur.execute(f"""SELECT cr.cliente_idnoofit,
                               MAX(cr.cliente_nombre) AS nombre,
                               COUNT(DISTINCT cr.sala_id) AS competiciones,
                               MIN(cr.personal_rank) AS mejor_puesto
                        {base}
                        GROUP BY cr.cliente_idnoofit
                        ORDER BY competiciones DESC
                        LIMIT %s""", vals + [limit])
        top_clientes = [dict(r) for r in cur.fetchall()]
    for coll in (competiciones,):
        for r in coll:
            if isinstance(r.get('fecha'), dt.datetime):
                r['fecha'] = r['fecha'].isoformat()
    return jsonify({'ok': True, 'desde': desde.isoformat(), 'hasta': hasta.isoformat(),
                    'totales': totales, 'competiciones': competiciones,
                    'top_clientes': top_clientes})


@bp.route('/competiciones/estado', methods=['GET'])
@either_auth
def estado_sync():
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT COUNT(*) AS filas,
                              COUNT(DISTINCT sala_id) AS competiciones,
                              COUNT(DISTINCT cliente_idnoofit) AS clientes,
                              MIN(fecha) AS fecha_min, MAX(fecha) AS fecha_max
                         FROM competicion_realizada WHERE id_manager=%s""",
                    (str(g.id_manager),))
        datos = dict(cur.fetchone() or {})
        cur.execute("""SELECT synced_at AS ultimo_sync, ultima_falla
                         FROM competicion_sync WHERE id_manager=%s""",
                    (str(g.id_manager),))
        sync = dict(cur.fetchone() or {})
    for d in (datos, sync):
        for k, v in list(d.items()):
            if isinstance(v, dt.datetime):
                d[k] = v.isoformat()
    return jsonify({'ok': True, **datos, **sync})


@bp.route('/competiciones/cliente/<int:idnoofit>', methods=['GET'])
@either_auth
def competiciones_cliente(idnoofit):
    """Historial de competiciones de un cliente (lee BD; dispara barrido bg si stale)."""
    _sync_background(g.id_manager, g.id_trainer)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT sala_id, competicion_nombre, fecha,
                              personal_rank, global_rank, verify, id_trainer
                         FROM competicion_realizada
                        WHERE id_manager=%s AND cliente_idnoofit=%s
                        ORDER BY fecha DESC NULLS LAST""",
                    (str(g.id_manager), int(idnoofit)))
        rows = [dict(r) for r in cur.fetchall()]
    for r in rows:
        if isinstance(r.get('fecha'), dt.datetime):
            r['fecha'] = r['fecha'].isoformat()
    return jsonify({'ok': True, 'competiciones': rows, 'total': len(rows),
                    'fuente': 'local'})


@bp.route('/competiciones/sync', methods=['POST'])
@either_auth
def forzar_sync():
    force = (request.args.get('force') or '') in ('1', 'true')
    desde = _parse_fecha(request.args.get('desde'), None)
    hasta = _parse_fecha(request.args.get('hasta'), None)
    log_action(actor_from_request(), 'competicion_realizada', 'sync',
               resumen=f'Sync informe competiciones (force={force})')
    if force:
        res = _sync_all(g.id_manager, g.id_trainer, only_stale=False,
                        desde=desde, hasta=hasta)
        return jsonify({'ok': True, **(res or {})})
    _sync_background(g.id_manager, g.id_trainer)
    return jsonify({'ok': True, 'background': True})
