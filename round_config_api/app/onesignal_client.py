"""Cliente mínimo para la REST API de OneSignal.

Documentación: https://documentation.onesignal.com/reference/create-notification

Configuración por variables de entorno (.env del backend):
  ONESIGNAL_APP_ID       — UUID del app OneSignal de mynoofit
  ONESIGNAL_API_KEY      — REST API Key (con IP whitelist a la IP del VPS)
  ONESIGNAL_STUB         — '1' para no enviar real (escribe en log y devuelve mock)

Estrategia de identificación de clientes:
  Asumimos que NoofitPro registra a cada cliente en OneSignal con
  `external_user_id = id_NoofitPro` (el id numérico que devuelve
  `getClienteSimple`). Si confirma otra estrategia (alias, tags, etc.) se
  ajusta el método `_audience_filter`.
"""
import os
import logging
import requests

log = logging.getLogger(__name__)


class OneSignalError(Exception):
    pass


class OneSignalClient:
    BASE = 'https://onesignal.com/api/v1'

    def __init__(self, app_id=None, api_key=None, stub=None):
        self.app_id = app_id or os.getenv('ONESIGNAL_APP_ID', '').strip()
        self.api_key = api_key or os.getenv('ONESIGNAL_API_KEY', '').strip()
        # stub explícito > env > falta de credenciales (auto-stub)
        if stub is not None:
            self.stub = bool(stub)
        else:
            env_stub = os.getenv('ONESIGNAL_STUB', '').lower() in ('1', 'true', 'yes')
            self.stub = env_stub or not (self.app_id and self.api_key)

    @property
    def configurado(self) -> bool:
        return bool(self.app_id and self.api_key)

    def _headers(self):
        return {
            'Authorization': f'Basic {self.api_key}',
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        }

    # ────────────────────────────────────────────────────────────────────────
    # Crear notificación
    # ────────────────────────────────────────────────────────────────────────
    def enviar(self, titulo: str, cuerpo: str = '', *,
               external_user_ids: list = None,
               player_ids: list = None,
               segments: list = None,
               filters: list = None,
               url: str = None,
               data: dict = None,
               cuerpo_html: str = None,
               heading_lang: str = 'es') -> dict:
        """Crea una notificación. Una de estas opciones:
          - external_user_ids: lista de external IDs (recomendado per-cliente)
          - player_ids: lista de player IDs OneSignal
          - segments: ['Subscribed Users', 'All', ...] para broadcast
          - filters: lista de filtros OneSignal (por tag, etc.)

        Retorna {id: '<onesignal_id>', recipients: N, ...} o lanza OneSignalError.

        Si modo stub, escribe en log y devuelve un dict simulado para que el
        resto del flujo (BD, UI) pueda probarse sin OneSignal real.
        """
        if not titulo:
            raise OneSignalError('titulo requerido')

        # Audiencia mínima
        if not (external_user_ids or player_ids or segments or filters):
            raise OneSignalError('audiencia vacía: pasa external_user_ids, player_ids, segments o filters')

        # OneSignal exige siempre un fallback en 'en'. Si el lenguaje
        # principal NO es 'en', duplicamos el texto en 'en' como fallback.
        headings = {heading_lang: titulo}
        contents = {heading_lang: cuerpo or titulo}
        if heading_lang != 'en':
            headings.setdefault('en', titulo)
            contents.setdefault('en', cuerpo or titulo)
        payload = {
            'app_id': self.app_id or 'STUB-APP',
            'headings': headings,
            'contents': contents,
        }
        if external_user_ids:
            payload['include_external_user_ids'] = [str(x) for x in external_user_ids]
            # Limitar al canal push: si el user tiene también email/SMS subs en
            # OneSignal, sin esto la API rechaza con "You may only send to one
            # delivery channel at a time".
            payload['channel_for_external_user_ids'] = 'push'
        if player_ids:
            payload['include_player_ids'] = list(player_ids)
        if segments:
            payload['included_segments'] = segments
        if filters:
            payload['filters'] = filters
        if url:
            payload['url'] = url
        if data is not None:
            payload['data'] = data
        # Cuerpo HTML para webview de la app — OneSignal lo recibe en `big_picture`/`web_buttons`
        # u otros campos avanzados; aquí lo pasamos como `data.html` para que la app lo
        # renderice en su webview cuando abra la notificación.
        if cuerpo_html:
            payload.setdefault('data', {})
            payload['data']['html'] = cuerpo_html

        if self.stub:
            log.info(f'[OneSignal STUB] enviar payload={payload}')
            return {
                'id': f'stub-{int(__import__("time").time() * 1000)}',
                'recipients': len(external_user_ids or []) or len(player_ids or []) or 1,
                'stub': True,
            }

        try:
            r = requests.post(
                f'{self.BASE}/notifications',
                json=payload,
                headers=self._headers(),
                timeout=20,
            )
            try:
                d = r.json()
            except Exception:
                raise OneSignalError(f'OneSignal respuesta no-JSON status={r.status_code} body={r.text[:300]}')
        except OneSignalError:
            raise
        except Exception as e:
            log.exception('onesignal post')
            raise OneSignalError(f'OneSignal HTTP error: {e}')

        if r.status_code >= 400 or d.get('errors'):
            raise OneSignalError(f"OneSignal error status={r.status_code} body={d}")
        if not d.get('id'):
            raise OneSignalError(f'OneSignal no devolvió id: {d}')

        log.info(f'OneSignal enviado id={d.get("id")} recipients={d.get("recipients")}')
        return d

    # ────────────────────────────────────────────────────────────────────────
    # Cancelar notificación programada (futuro: send_after)
    # ────────────────────────────────────────────────────────────────────────
    def cancelar(self, notification_id: str) -> dict:
        if self.stub:
            log.info(f'[OneSignal STUB] cancelar {notification_id}')
            return {'success': True, 'stub': True}
        if not self.configurado:
            raise OneSignalError('OneSignal no configurado')
        try:
            r = requests.delete(
                f'{self.BASE}/notifications/{notification_id}?app_id={self.app_id}',
                headers=self._headers(),
                timeout=15,
            )
            return r.json() if r.text else {'status': r.status_code}
        except Exception as e:
            raise OneSignalError(f'OneSignal cancel error: {e}')


# Singleton
_client = None


def get_client() -> OneSignalClient:
    global _client
    if _client is None:
        _client = OneSignalClient()
        log.info(f'OneSignal client inicializado stub={_client.stub} configurado={_client.configurado}')
    return _client
