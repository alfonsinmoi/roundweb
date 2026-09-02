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


def _ip_de_la_persona():
    """IP real de quien está haciendo login, o None si no hay nadie detrás.

    NoofitPro limita a 10 POST por IP cada 15 minutos CUALQUIER ruta que
    contenga `/account/login` — o sea `loginEasy` y también `loginMobile`—,
    y el contador no distingue aciertos de fallos (backend, 02/09/2026).
    Como estas llamadas salen del VPS, sin esta cabecera TODOS los logins de
    la web comparten un único cupo: el undécimo de cada cuarto de hora
    recibiría un 429 aunque las credenciales fueran correctas.

    NoofitPro lee `X-Forwarded-For` y se queda con la primera IP, así que
    reenviando la del usuario el límite vuelve a ser por persona, que es lo
    que tiene sentido.

    Solo se rellena cuando hay una petición HTTP real detrás, es decir, una
    persona. Los crones y los scripts no mandan cabecera a propósito: su
    cupo es el del servidor, que es lo que son. Inventarles una IP sería
    saltarse un límite que existe por algo.
    """
    try:
        from flask import has_request_context, request
        if not has_request_context():
            return None
        return ((request.headers.get('X-Forwarded-For', '') or '')
                .split(',')[0].strip() or request.remote_addr or None)
    except Exception:                                         # noqa: BLE001
        return None


def _cabeceras_login():
    h = {'Content-Type': 'application/json'}
    ip = _ip_de_la_persona()
    if ip:
        h['X-Forwarded-For'] = ip
    return h


def _login(email, password):
    """Autentica contra NoofitPro y devuelve (token, manager_id_o_true).

    Usa `account/loginEasy` — endpoint del manager/trainer (admin web Round,
    mynoofit Beauty, etc.). Para clientes finales (mynoofit cliente) usa
    `login_cliente_final` que tira de `account/loginMobile`.
    """
    r = requests.post(f'{BASE}/account/loginEasy',
        json={'email': email, 'appVersion': APP_VERSION,
              'password': _md5_upper(password)},
        headers=_cabeceras_login(),
        timeout=15, verify=False)
    r.raise_for_status()
    token = r.headers.get('X-CustomToken')
    manager = r.headers.get('X-TRAINER_MANAGER', '')
    if not token: raise RuntimeError('no_token_in_response')
    return token, manager


def login_cliente_final(email, password):
    """Autentica un cliente NoofitPro (usuario final de mynoofit).

    Endpoint: `POST account/loginMobile` (descubierto vía
    docs/SERVICIOS_BACKEND.md — método C# `GetToken` en mynoofit MAUI).
    Distinto de `loginEasy` (manager/trainer/Beauty), que rechazaría a un
    cliente final con 401.

    Devuelve el `X-CustomToken` (JWT NoofitPro del cliente). No persiste
    nada — la sesión efectiva del cliente la lleva nuestro JWT propio
    `kind='cliente'`. Esto sólo valida las credenciales.

    Raises requests.HTTPError si NoofitPro rechaza.
    """
    r = requests.post(f'{BASE}/account/loginMobile',
        json={'email': email, 'appVersion': APP_VERSION,
              'password': _md5_upper(password)},
        headers=_cabeceras_login(),
        timeout=15, verify=False)
    r.raise_for_status()
    token = r.headers.get('X-CustomToken')
    if not token:
        raise RuntimeError('no_token_in_response')
    return token


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


def credenciales_validas(email, password):
    """True solo si NoofitPro ACEPTA (email, password) en loginEasy.

    NoofitPro es la única autoridad de las credenciales de manager/trainer.
    Round solo cachea (en trainer_noofit_creds / manager_config) la copia que
    NoofitPro valida — nunca un valor sin verificar. Si NoofitPro la rechaza
    (401) o está inalcanzable, devolvemos False y el llamador NO debe pisar la
    copia buena que ya tuviera guardada.
    """
    if not email or not password:
        return False
    try:
        tok, _ = _login(email, password)
        return bool(tok)
    except Exception as e:
        log.warning(f'credenciales_validas({email}): {e}')
        return False


def hermanos_trainer_ids(email, password):
    """Conjunto de id (str) de los trainers que comparten manager NoofitPro
    (endpoint `getTrainersByManager`) para las credenciales dadas.

    En NoofitPro todos los centros de un mismo cliente (p.ej. los 4 ROUND
    bajo el distribuidor 7673) son "hermanos": getTrainersByManager devuelve
    el mismo grupo para cualquiera de ellos. Sirve para el blindaje
    anti-manager-fantasma de `round-bootstrap`: si el que entra es hermano de
    un manager Round ya existente, es un trainer de ese grupo, no un manager.

    Devuelve set() si el login o la llamada fallan (el llamador hace fallback
    a su lógica local — nunca rompe el bootstrap).
    """
    try:
        tok, mgr = _login(email, password)
        r = requests.get(f'{BASE}/api/dispositivos/getTrainersByManager',
                         headers=_auth_headers(tok, mgr or 'true'),
                         timeout=15, verify=False)
        r.raise_for_status()
        ents = (r.json() or {}).get('entrenadores') or []
        return {str(e.get('id')) for e in ents if e.get('id') is not None}
    except Exception as e:
        log.warning(f'hermanos_trainer_ids({email}): {e}')
        return set()


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


def get_reservas_confirmadas_with_creds(fecha_desde, fecha_hasta,
                                        email, password):
    """Variante de `get_reservas_confirmadas` autenticada con credenciales
    explícitas (manager o trainer). Útil para crons multi-tenant que
    iteran managers/trainers sin depender del token por defecto del .env.
    """
    import datetime as _dt
    tok, mgr = _login_as(email, password)
    body = {'fechaDesde': fecha_desde, 'fechaHasta': fecha_hasta}
    r = _request_as(tok, mgr, 'POST',
                    '/api/dispositivos/getSalasByManagerByRange', json=body)
    r.raise_for_status()
    data = r.json() if r.text else {}
    salas = (data.get('salas') or [])
    salas = [s for s in salas if s.get('enabled') is not False]
    out = []
    for s in salas:
        ms = s.get('dateStart')
        dt = None
        try:
            if ms is not None:
                dt = _dt.datetime.fromtimestamp(int(ms) / 1000)
        except Exception:
            dt = None
        fecha = dt.date().isoformat() if dt else None
        hora = dt.strftime('%H:%M') if dt else None
        sala_id = s.get('id') or s.get('idSala')
        act_id = s.get('idActividad')
        act_nombre = (s.get('actividad') or s.get('nameActividad')
                      or s.get('name') or '')
        trainer = s.get('idTrainer')
        for u in (s.get('users') or []):
            if u.get('enabled') is False:
                continue
            cid = u.get('idClient') or u.get('idCliente') or u.get('idUsuario')
            if not cid:
                continue
            out.append({
                'sala_id': str(sala_id) if sala_id is not None else None,
                'actividad_id': act_id,
                'actividad_nombre': act_nombre,
                'id_trainer': trainer,
                'fecha': fecha,
                'hora': hora,
                'cliente_id': str(cid),
                'cliente_nombre': (u.get('nameClient') or '').strip() or None,
            })
    return out


def get_reservas_confirmadas(fecha_desde, fecha_hasta):
    """Reservas CONFIRMADAS (no anuladas) por cliente entre dos fechas.

    Las instancias de clase de `get_clases_por_rango` ya traen embebida la
    lista `users` con los reservados (cada uno con `enabled`). Una reserva
    confirmada = usuario con `enabled` != False.

    Devuelve lista de dicts:
      {sala_id, actividad_id, actividad_nombre, id_trainer,
       fecha (ISO date), hora ('HH:MM'), cliente_id (str)}
    """
    import datetime as _dt
    salas = get_clases_por_rango(fecha_desde, fecha_hasta) or []
    out = []
    for s in salas:
        ms = s.get('dateStart')
        dt = None
        try:
            if ms is not None:
                dt = _dt.datetime.fromtimestamp(int(ms) / 1000)
        except Exception:
            dt = None
        fecha = dt.date().isoformat() if dt else None
        hora = dt.strftime('%H:%M') if dt else None
        sala_id = s.get('id') or s.get('idSala')
        act_id = s.get('idActividad')
        act_nombre = (s.get('actividad') or s.get('nameActividad')
                      or s.get('name') or '')
        trainer = s.get('idTrainer')
        for u in (s.get('users') or []):
            if u.get('enabled') is False:
                continue
            # CRITICAL: `idClient` es el id real del cliente en la web admin
            # (rango 1.8M+ para Round). `id` es el id del JOIN sala-usuario
            # (rango 100k, espacio histórico mynoofit) — NO usar como id de
            # cliente. nameClient es el nombre del cliente.
            cid = u.get('idClient') or u.get('idCliente') or u.get('idUsuario')
            if not cid:
                continue
            out.append({
                'sala_id': str(sala_id) if sala_id is not None else None,
                'actividad_id': act_id,
                'actividad_nombre': act_nombre,
                'id_trainer': trainer,
                'fecha': fecha,
                'hora': hora,
                'cliente_id': str(cid),
                # `nameClient` viene en el payload de la sala. Útil para el
                # informe de integridad cuando el cliente NO está en nuestra
                # cache (cliente de otro centro NoofitPro reservando aquí).
                'cliente_nombre': (u.get('nameClient') or '').strip() or None,
            })
    return out


def get_clientes():
    """Lista de clientes simplificada (incluye id, name, surname, email, dni...)."""
    r = _request('GET', '/api/dispositivos/getClienteSimple')
    r.raise_for_status()
    data = r.json() if r.text else {}
    return data.get('clientes') or []


def post_cliente(payload, send_welcome=False):
    """Crea uno o varios clientes en NoofitPro (autenticado como manager).

    payload: dict con {name, surname, email, tlf, dni} o lista de dicts.
    send_welcome: si True, NoofitPro envía su email automático de
        "verifica tu cuenta Wiemspro" al cliente. Por defecto False
        para flujos de lead/prueba (queremos que solo lleguen nuestros
        emails con plantilla del centro). Pon True solo cuando un
        admin crea manualmente un cliente real."""
    if isinstance(payload, dict): payload = [payload]
    body = [{**c, 'toSend': bool(send_welcome), 'enabled': True} for c in payload]
    return post('/api/dispositivos/clientePlusv2', body)


# ── Variante autenticada como TRAINER (importante para que el cliente quede
#    "dentro" de la cuenta del trainer, no en la del manager). NoofitPro
#    tiene espacios de clientes separados por cuenta, y no expone API para
#    cambiar de trainer a posteriori. ──────────────────────────────────────

def _login_as(email, pwd):
    """Login en NoofitPro con credenciales arbitrarias.
    Devuelve (token, manager_header_value).
    NO cachea (las llamadas con un trainer concreto son puntuales)."""
    token, manager_hdr = _login(email, pwd)
    return token, manager_hdr


def _request_as(token, manager_hdr, method, path, **kw):
    kw.setdefault('timeout', 30); kw['verify'] = False
    h = kw.pop('headers', {}) or {}
    h.update(_auth_headers(token, manager_hdr))
    kw['headers'] = h
    return requests.request(method, f'{BASE}{path}', **kw)


def get_clientes_as_trainer(trainer_email, trainer_password):
    """Lista de clientes que ve la cuenta del trainer indicada (espacio propio)."""
    tok, mgr = _login_as(trainer_email, trainer_password)
    r = _request_as(tok, mgr, 'GET', '/api/dispositivos/getClienteSimple')
    r.raise_for_status()
    return ((r.json() or {}).get('clientes')) or []


def post_cliente_as_trainer(payload, trainer_email, trainer_password,
                              send_welcome=False):
    """Crea cliente(s) en NoofitPro autenticado como TRAINER.
    Esto hace que el cliente quede en la cuenta de ese trainer (no en la
    del manager). Devuelve el dict de respuesta tal cual de NoofitPro
    (incluye `clientes: [{id,...}]` con el id real generado).
    """
    if isinstance(payload, dict): payload = [payload]
    body = [{**c, 'toSend': bool(send_welcome), 'enabled': True} for c in payload]
    tok, mgr = _login_as(trainer_email, trainer_password)
    r = _request_as(tok, mgr, 'POST', '/api/dispositivos/clientePlusv2', json=body)
    r.raise_for_status()
    return r.json() if r.text else {}


def get_trainer_creds(id_manager, id_trainer):
    """Resuelve credenciales NoofitPro para un trainer concreto (espacio
    propio) a partir de la tabla `trainer_noofit_creds`. Devuelve
    (email, password) o (None, None) si no hay."""
    from .db import get_conn
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT noofit_email, noofit_password
                         FROM trainer_noofit_creds
                        WHERE id_manager=%s AND id_trainer=%s AND activo=TRUE
                        LIMIT 1""", (str(id_manager), str(id_trainer)))
        r = cur.fetchone()
    if not r or not r.get('noofit_email') or not r.get('noofit_password'):
        return None, None
    return r['noofit_email'], r['noofit_password']


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


def archivar_cliente(cliente_id, motivo: str = None):
    """Archiva un cliente en NoofitPro (enabled=False, motivoArchivado=<motivo>).
    Usa la cuenta del MANAGER por defecto (la del .env). Sólo funciona si el
    cliente pertenece a la propia cuenta del manager — para clientes de un
    TRAINER hijo usa `archivar_cliente_as_trainer`. Devuelve True/False.
    """
    try:
        clis = get_clientes() or []
        cli = next((c for c in clis if c.get('id') == int(cliente_id)), None)
        if not cli:
            log.warning(f'archivar_cliente {cliente_id}: no encontrado')
            return False
        if cli.get('enabled') is False:
            return True  # ya estaba archivado
        body = [{**cli, 'enabled': False,
                 'motivoArchivado': motivo or '',
                 'toSend': False}]
        post('/api/dispositivos/clientePlusv2', body)
        log.info(f'cliente {cliente_id} archivado en NoofitPro (motivo: {motivo!r})')
        return True
    except Exception as e:
        log.exception(f'archivar_cliente {cliente_id}: {e}')
        return False


def archivar_cliente_as_trainer(cliente_id, motivo, trainer_email, trainer_password):
    """Variante autenticada como TRAINER (necesario para archivar clientes que
    pertenecen al espacio del trainer y no al manager parent). NoofitPro
    devuelve el cliente con `getClienteSimple` autenticado como el trainer
    correcto y permite hacer el POST de archivar.

    Devuelve True si archivó (o si ya estaba archivado), False si no encontró
    el cliente o la operación falló.
    """
    try:
        tok, mgr = _login_as(trainer_email, trainer_password)
        r = _request_as(tok, mgr, 'GET', '/api/dispositivos/getClienteSimple')
        r.raise_for_status()
        clis = ((r.json() or {}).get('clientes')) or []
        cli = next((c for c in clis if c.get('id') == int(cliente_id)), None)
        if not cli:
            log.warning(f'archivar_cliente_as_trainer {cliente_id}: no en espacio del trainer {trainer_email}')
            return False
        if cli.get('enabled') is False:
            return True  # ya archivado (idempotente)
        body = [{**cli, 'enabled': False,
                 'motivoArchivado': motivo or '',
                 'toSend': False}]
        r2 = _request_as(tok, mgr, 'POST',
                         '/api/dispositivos/clientePlusv2', json=body)
        r2.raise_for_status()
        log.info(f'cliente {cliente_id} archivado en NoofitPro como trainer '
                 f'{trainer_email} (motivo: {motivo!r})')
        return True
    except Exception as e:
        log.exception(f'archivar_cliente_as_trainer {cliente_id} '
                      f'({trainer_email}): {e}')
        return False


def reactivar_cliente_as_trainer(cliente_id, trainer_email, trainer_password):
    """Reactiva (enabled=True) un cliente del espacio de un TRAINER. Espejo de
    `archivar_cliente_as_trainer`. Devuelve True si reactivó (o ya estaba
    activo), False si no lo encontró o falló."""
    try:
        tok, mgr = _login_as(trainer_email, trainer_password)
        r = _request_as(tok, mgr, 'GET', '/api/dispositivos/getClienteSimple')
        r.raise_for_status()
        clis = ((r.json() or {}).get('clientes')) or []
        cli = next((c for c in clis if c.get('id') == int(cliente_id)), None)
        if not cli:
            log.warning(f'reactivar_cliente_as_trainer {cliente_id}: no en espacio del trainer')
            return False
        if cli.get('enabled') is True:
            return True  # ya activo (idempotente)
        body = [{**cli, 'enabled': True, 'motivoArchivado': None, 'toSend': False}]
        r2 = _request_as(tok, mgr, 'POST', '/api/dispositivos/clientePlusv2', json=body)
        r2.raise_for_status()
        log.info(f'cliente {cliente_id} reactivado en NoofitPro como trainer {trainer_email}')
        return True
    except Exception as e:
        log.exception(f'reactivar_cliente_as_trainer {cliente_id} ({trainer_email}): {e}')
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
    """Cancela una reserva (token por defecto). Busca primero el id del join."""
    sala_users = get_usuarios_sala(sala_id) or []
    join_id = None
    for u in sala_users:
        if u.get('idClient') == cliente_id:
            join_id = u.get('id'); break
    if not join_id:
        log.warning(f'cancelar_reserva: no se encontró join sala={sala_id} cliente={cliente_id}')
        return None
    return cancelar_reserva_por_join_id(join_id)


def cancelar_reserva_with_creds(sala_id, cliente_id, email, password):
    """Variante autenticada con credenciales explícitas. Usar en crons multi-
    tenant para cancelar reservas del manager/trainer que las creó.
    """
    tok, mgr = _login_as(email, password)
    # Buscar join_id en los usuarios de la sala
    r = _request_as(tok, mgr, 'POST', '/api/dispositivos/getUsuariosBySala',
                    json={'idSala': sala_id})
    r.raise_for_status()
    usuarios = ((r.json() or {}).get('usuarios')) or []
    join_id = None
    for u in usuarios:
        if u.get('idClient') == cliente_id:
            join_id = u.get('id'); break
    if not join_id:
        log.warning(f'cancelar_reserva_with_creds: no se encontró join '
                    f'sala={sala_id} cliente={cliente_id} (auth={email})')
        return None
    r2 = _request_as(tok, mgr, 'POST', '/api/dispositivos/userRemoveSala',
                     json={'id': join_id})
    r2.raise_for_status()
    return r2.json() if r2.text else None
