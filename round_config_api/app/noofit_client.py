"""Cliente NoofitPro / Wiemspro para uso desde el backend.

Autenticación basada en `X-CustomToken`. Hacemos `loginEasy` con un usuario
de servicio (env `NOOFIT_EMAIL` + `NOOFIT_PASSWORD`) y cacheamos el token
durante 50 min (los JWT NoofitPro caducan ~1h).

Por compatibilidad con la SPA frontend, replicamos el flujo:
  POST /wiemspro/account/loginEasy   {email, appVersion, password=md5}
       → cabeceras X-CustomToken + X-TRAINER_MANAGER

Para llamadas autenticadas se manda:
  X-CustomToken, locale, appVersion, appId, X-TRAINER_MANAGER (id manager)

Nota SSL: pro.wiemspro.com no envía la cadena intermedia, así que usamos
verify=False solo para este host. No expone datos del usuario.
"""
import os, hashlib, time, logging, threading
import requests, urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
log = logging.getLogger(__name__)

BASE = os.getenv('NOOFIT_BASE', 'https://pro.wiemspro.com/wiemspro')
APP_VERSION = '1.8.39'
APP_ID = '1'
TOKEN_TTL_SECONDS = 50 * 60  # JWT de NoofitPro caduca ~1h, refrescamos antes

_lock = threading.Lock()
_state = {
    'token': None,
    'manager_id': None,           # id real del manager (no el "true" booleano)
    'expires_at': 0,
}


def _md5_upper(s):
    return hashlib.md5(s.encode()).hexdigest().upper()


def _login(email, password):
    """Autentica contra NoofitPro y devuelve (token, manager_id_o_true)."""
    r = requests.post(f'{BASE}/account/loginEasy',
        json={'email': email, 'appVersion': APP_VERSION,
              'password': _md5_upper(password)},
        headers={'Content-Type': 'application/json'},
        timeout=15, verify=False)
    r.raise_for_status()
    token = r.headers.get('X-CustomToken')
    manager = r.headers.get('X-TRAINER_MANAGER', '')
    if not token: raise RuntimeError('no_token_in_response')
    return token, manager


def _resolver_manager_id(token, manager_hdr):
    """Devuelve el managerId real del entrenador (campo .managerId del perfil).
    El header X-TRAINER_MANAGER trae 'true' cuando el user puede actuar como
    manager, pero NoofitPro espera el id numérico del manager en idManager."""
    try:
        r = requests.get(f'{BASE}/api/dispositivos/entrenador',
            headers=_auth_headers(token, manager_hdr or 'true'),
            timeout=15, verify=False)
        r.raise_for_status()
        ent = (r.json() or {}).get('entrenador') or {}
        # NoofitPro: ent.managerId es el id del manager (suele ser distinto al ent.id)
        mgr = ent.get('managerId') or ent.get('manager') or ent.get('id')
        return str(mgr or '')
    except Exception as e:
        log.warning(f'resolver_manager_id: {e}')
        return manager_hdr or ''


def _auth_headers(token, manager):
    return {
        'X-CustomToken': token,
        'locale': 'es',
        'appVersion': APP_VERSION,
        'appId': APP_ID,
        'X-TRAINER_MANAGER': str(manager) if manager else '',
        'Content-Type': 'application/json',
    }


def get_token():
    """Devuelve token cacheado o renueva si está cerca de expirar."""
    with _lock:
        now = time.time()
        if _state['token'] and now < _state['expires_at']:
            return _state['token'], _state['manager_id']

        email = os.getenv('NOOFIT_EMAIL', '')
        pwd   = os.getenv('NOOFIT_PASSWORD', '')
        if not email or not pwd:
            raise RuntimeError('NOOFIT_EMAIL/NOOFIT_PASSWORD no configurado')

        token, manager_hdr = _login(email, pwd)
        manager_id = _resolver_manager_id(token, manager_hdr)
        _state.update({
            'token': token,
            'manager_id': manager_id,
            'expires_at': now + TOKEN_TTL_SECONDS,
        })
        log.info(f'NoofitPro login OK manager_id={manager_id}')
        return token, manager_id


def _request(method, path, **kw):
    token, manager = get_token()
    kw.setdefault('timeout', 20)
    kw['verify'] = False
    headers = kw.pop('headers', {}) or {}
    headers.update(_auth_headers(token, manager))
    kw['headers'] = headers
    r = requests.request(method, f'{BASE}{path}', **kw)
    # Renovar y reintentar UNA VEZ si 401
    if r.status_code == 401:
        log.info('NoofitPro 401 → renovando token')
        with _lock:
            _state['token'] = None
            _state['expires_at'] = 0
        token, manager = get_token()
        headers.update(_auth_headers(token, manager))
        r = requests.request(method, f'{BASE}{path}', **kw)
    return r


# ── API pública del cliente ──────────────────────────────────────────────────

def get(path, params=None):
    r = _request('GET', path, params=params)
    r.raise_for_status()
    return r.json() if r.text else {}


def post(path, body=None):
    r = _request('POST', path, json=body or {})
    r.raise_for_status()
    return r.json() if r.text else {}


def get_clases(fecha_desde, fecha_hasta):
    """Plantillas de clases del manager (sin filtro fecha real, solo el catálogo)."""
    _, manager_id = get_token()
    body = {'idManager': int(manager_id) if manager_id else None,
            'fechaDesde': fecha_desde, 'fechaHasta': fecha_hasta}
    data = post('/api/dispositivos/getSalasByManager', body) or {}
    return data.get('salas') or []


def get_clases_por_rango(fecha_desde, fecha_hasta):
    """Instancias de clases programadas entre dos fechas (con fecha/hora real).
    fecha_* en ISO con offset, ej. '2026-05-03T00:00:00+02:00'."""
    body = {'fechaDesde': fecha_desde, 'fechaHasta': fecha_hasta}
    data = post('/api/dispositivos/getSalasByManagerByRange', body) or {}
    salas = data.get('salas') or []
    return [s for s in salas if s.get('enabled') is not False]


def get_usuarios_sala(sala_id):
    """Asistentes de una sala/clase concreta."""
    data = post('/api/dispositivos/getUsuariosBySala', {'idSala': sala_id}) or {}
    return data.get('usuarios') or []


def get_clientes():
    """Lista de clientes simplificada (incluye id, name, surname, email, dni...)."""
    r = _request('GET', '/api/dispositivos/getClienteSimple')
    r.raise_for_status()
    data = r.json() if r.text else {}
    return data.get('clientes') or []


def post_cliente(payload, send_welcome=False):
    """Crea uno o varios clientes en NoofitPro.

    payload: dict con {name, surname, email, tlf, dni} o lista de dicts.
    send_welcome: si True, NoofitPro envía su email automático de
        "verifica tu cuenta Wiemspro" al cliente. Por defecto False
        para flujos de lead/prueba (queremos que solo lleguen nuestros
        emails con plantilla del centro). Pon True solo cuando un
        admin crea manualmente un cliente real."""
    if isinstance(payload, dict): payload = [payload]
    body = [{**c, 'toSend': bool(send_welcome), 'enabled': True} for c in payload]
    return post('/api/dispositivos/clientePlusv2', body)


def reactivar_cliente(cliente_id):
    """Reactiva un cliente archivado en NoofitPro (enabled=True, motivo=null).
    Devuelve True si OK, False si falló o no se encontró."""
    try:
        clis = get_clientes() or []
        cli = next((c for c in clis if c.get('id') == int(cliente_id)), None)
        if not cli:
            log.warning(f'reactivar_cliente {cliente_id}: no encontrado')
            return False
        if cli.get('enabled') is True:
            return True  # ya estaba activo
        # postear todos los datos con enabled=True y motivoArchivado=None
        body = [{**cli, 'enabled': True, 'motivoArchivado': None, 'toSend': False}]
        post('/api/dispositivos/clientePlusv2', body)
        log.info(f'cliente {cliente_id} reactivado en NoofitPro')
        return True
    except Exception as e:
        log.exception(f'reactivar_cliente {cliente_id}')
        return False


def reservar_clase(sala_id, cliente_id, nombre_cliente=''):
    """Apunta a un cliente en una sala (clase)."""
    body = {
        'idClient':    cliente_id,
        'nameClient':  nombre_cliente or '',
        'pictureClient': '',
        'verify':      False,
        'isPause':     False,
        'idSalaJoin':  sala_id,
        'idsSala':     [sala_id],
        'ems':         False,
        'tem':         False,
        'pulsometro':  False,
        'idEquipoJoin': 0,
        'posicion':    0,
    }
    return post('/api/dispositivos/userJoinSalas', body)


def cancelar_reserva_por_join_id(id_sala_join):
    """Cancela usando el id de la fila join (que viene en users[].id de la sala)."""
    return post('/api/dispositivos/userRemoveSala', {'id': id_sala_join})


def cancelar_reserva(sala_id, cliente_id):
    """Cancela una reserva. Busca primero el id del join en la sala."""
    sala_users = get_usuarios_sala(sala_id) or []
    join_id = None
    for u in sala_users:
        if u.get('idClient') == cliente_id:
            join_id = u.get('id'); break
    if not join_id:
        log.warning(f'cancelar_reserva: no se encontró join sala={sala_id} cliente={cliente_id}')
        return None
    return cancelar_reserva_por_join_id(join_id)
