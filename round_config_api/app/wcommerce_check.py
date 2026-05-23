"""Cliente mínimo para wcommerce.wiemspro.com.

Único propósito en Round: dado un `wcommerce_cliente_id`, devolver el
`tipoPago` del cliente B2B. Esto se usa como gate para permitir desplegar
el Odoo del manager:

  - tipoPago = "S"  → elegible. Botón "Desplegar Contabilidad" activo.
  - tipoPago != "S" → no elegible. Mensaje "Contacta con Wiemspro".

NO replicamos el cliente completo de GestionNoofit — solo lo justo. Si
hace falta cualquier otra cosa de wcommerce, el sitio canónico para
ampliar es `gestionnoofit_api/app/wcommerce_client.py`.
"""
import logging
import threading
import time

import requests
import urllib3

from . import config as cfg

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
log = logging.getLogger(__name__)

SESSION_TTL_SECONDS = 25 * 60   # Wcommerce tomcat ~30 min; renovamos antes.

_lock = threading.Lock()
_state = {
    'session': None,
    'expires_at': 0,
}


def _new_session_login():
    """Crea una requests.Session nueva, hace login y devuelve la sesión.

    Wcommerce usa form-login: campo 'usuario' (NO 'email') + 'password'.
    Devuelve 200 incluso con credenciales erróneas, así que verificamos
    llamando a `/getAlmacenUser` que solo responde JSON cuando hay sesión.
    """
    if not cfg.WCOMMERCE_EMAIL or not cfg.WCOMMERCE_PASSWORD:
        raise RuntimeError('WCOMMERCE_EMAIL/WCOMMERCE_PASSWORD no configurados')
    s = requests.Session()
    s.verify = False
    # 1) Welcome para cookie inicial (no crítico)
    try:
        s.get(f'{cfg.WCOMMERCE_BASE}/welcome', timeout=15)
    except Exception:
        pass
    # 2) Login
    s.post(f'{cfg.WCOMMERCE_BASE}/login',
           data={'usuario': cfg.WCOMMERCE_EMAIL,
                 'password': cfg.WCOMMERCE_PASSWORD},
           timeout=20, allow_redirects=True)
    # 3) Verificar sesión
    r2 = s.get(f'{cfg.WCOMMERCE_BASE}/getAlmacenUser', timeout=15)
    ok = False
    try:
        body = r2.json()
        ok = isinstance(body, dict) and body.get('almacenUser') == 'success'
    except Exception:
        ok = False
    if not ok:
        raise RuntimeError(f'wcommerce_login_failed verify_status={r2.status_code}')
    log.info('wcommerce_check: login OK')
    return s


def _get_session():
    """Devuelve la sesión activa (login lazy + renovación si caducó)."""
    with _lock:
        now = time.time()
        s = _state.get('session')
        if s is not None and _state.get('expires_at', 0) > now:
            return s
        s = _new_session_login()
        _state['session'] = s
        _state['expires_at'] = now + SESSION_TTL_SECONDS
        return s


def _get_json(path, params=None, _retry=False):
    """GET autenticado al endpoint wcommerce. Reintenta tras login si la
    sesión caduca silenciosamente (wcommerce a veces devuelve HTML del
    login en vez de JSON)."""
    s = _get_session()
    r = s.get(f'{cfg.WCOMMERCE_BASE}/{path}',
              params=params or {}, timeout=30)
    if r.status_code != 200:
        raise RuntimeError(f'wcommerce {path} HTTP {r.status_code}')
    # Si volvió HTML (sesión caducada), reintentamos UNA vez con login fresco
    ct = r.headers.get('Content-Type', '')
    if 'json' not in ct:
        if _retry:
            raise RuntimeError(f'wcommerce {path}: no JSON tras relogin')
        with _lock:
            _state['session'] = None
            _state['expires_at'] = 0
        return _get_json(path, params, _retry=True)
    return r.json()


def _norm_codigo(value) -> str:
    """Normaliza un código wcommerce a 8 dígitos con ceros a la izquierda.

    Acepta '4645', 4645, '00004645'… y devuelve '00004645' (formato canónico
    en que wcommerce los almacena en el campo `codigo`)."""
    if value is None:
        return ''
    s = str(value).strip()
    if not s:
        return ''
    # Si vienen solo dígitos, padd a 8. Si tiene letras u otros, dejar tal cual.
    if s.isdigit():
        return s.zfill(8)
    return s


def get_cliente(wcommerce_cliente_id):
    """Devuelve el dict del cliente B2B identificado por su `codigo` en
    wcommerce (p. ej. '00004645'). Acepta también el código sin ceros a
    la izquierda ('4645').

    wcommerce no tiene endpoint per-id, así que descargamos toda la lista
    y filtramos en memoria. Para 2.6k clientes basta una sola llamada.
    """
    target = _norm_codigo(wcommerce_cliente_id)
    if not target:
        return None
    try:
        d = _get_json('getClientes', params={'start': 0, 'limit': 10000})
    except Exception as e:
        log.warning(f'wcommerce get_cliente({wcommerce_cliente_id}): {e}')
        return None
    lista = next((v for v in (d or {}).values() if isinstance(v, list)), [])
    for c in lista:
        if _norm_codigo(c.get('codigo')) == target:
            return c
    return None


def get_tipo_pago(wcommerce_cliente_id):
    """Devuelve {'tipo_pago', 'cliente'} o {'tipo_pago': None, 'error': ...}.

    Output minimal — el caller solo necesita la letra para el gate.
    """
    if not wcommerce_cliente_id:
        return {'tipo_pago': None, 'error': 'no_wcommerce_id'}
    try:
        c = get_cliente(wcommerce_cliente_id)
    except Exception as e:
        return {'tipo_pago': None, 'error': f'wcommerce_unreachable:{e}'}
    if not c:
        return {'tipo_pago': None, 'error': 'cliente_not_found'}
    tp = str(c.get('tipoPago') or '').strip().upper() or None
    return {
        'tipo_pago': tp,
        'cliente': {
            'codigo':          c.get('codigo'),  # id canónico ('00004645')
            'nombre':          c.get('nombre'),
            'personaJuridica': c.get('personaJuridica'),
            'cif':             c.get('CIF') or c.get('cif'),
            'email':           c.get('email'),
            'pais':            c.get('pais'),
        },
    }
