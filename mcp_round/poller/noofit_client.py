"""Cliente HTTP para llamar a NoofitPro y al servicio de push."""
import logging
import requests
from . import config as poller_config

log = logging.getLogger(__name__)


class NoofitClient:
    """Cliente HTTP para los dos servicios externos:

    - NoofitPro API: registra estado de cobranza por cliente
    - Push service:  envía notificación HTML al cliente vía mynoofit
    """

    def __init__(self):
        self.api_url    = poller_config.NOOFIT_API_URL
        self.api_token  = poller_config.NOOFIT_API_TOKEN
        self.push_url   = poller_config.PUSH_API_URL
        self.push_token = poller_config.PUSH_API_TOKEN
        self.dry_run    = poller_config.DRY_RUN

    def registrar_estado(self, id_noofit, estado, recibo_periodo, importe,
                         fecha=None, codigo_devolucion=None, mensaje=None,
                         link_pago=None):
        """Llama a POST /cobranza/cliente/{id_noofit}/estado en NoofitPro.

        Si DRY_RUN está activo o falta config, solo loggea.
        """
        body = {
            'estado': estado,
            'recibo_periodo': recibo_periodo,
            'importe': importe,
            'fecha': fecha,
            'codigo_devolucion': codigo_devolucion,
            'mensaje_push': mensaje,
            'link_pago': link_pago,
        }
        # Filtrar None
        body = {k: v for k, v in body.items() if v is not None}

        if self.dry_run or not self.api_url:
            log.info(f"[DRY_RUN] NoofitPro POST /cobranza/cliente/{id_noofit}/estado: {body}")
            return {'ok': True, 'dry_run': True, 'body': body}

        try:
            url = f"{self.api_url.rstrip('/')}/cobranza/cliente/{id_noofit}/estado"
            r = requests.post(
                url,
                json=body,
                headers={
                    'Authorization': f'Bearer {self.api_token}',
                    'Content-Type': 'application/json',
                },
                timeout=10,
                verify=True,
            )
            r.raise_for_status()
            return {'ok': True, 'response': r.json() if r.content else {}}
        except Exception as e:
            log.error(f"NoofitPro registrar_estado fallo: {e}")
            return {'ok': False, 'error': str(e)}

    def push(self, id_noofit, asunto, cuerpo_html, categoria='facturacion'):
        """Envía push HTML al cliente vía servicio noofit."""
        body = {
            'asunto': asunto,
            'cuerpo_html': cuerpo_html,
            'categoria': categoria,
        }
        if self.dry_run or not self.push_url:
            log.info(f"[DRY_RUN] Push a cliente {id_noofit}: {asunto}")
            return {'ok': True, 'dry_run': True, 'body': body}

        try:
            url = f"{self.push_url.rstrip('/')}/cliente/{id_noofit}"
            r = requests.post(
                url,
                json=body,
                headers={
                    'Authorization': f'Bearer {self.push_token}',
                    'Content-Type': 'application/json',
                },
                timeout=10,
                verify=True,
            )
            r.raise_for_status()
            return {'ok': True, 'response': r.json() if r.content else {}}
        except Exception as e:
            log.error(f"Push a cliente {id_noofit} fallo: {e}")
            return {'ok': False, 'error': str(e)}


_singleton = None
def get_noofit_client():
    global _singleton
    if _singleton is None:
        _singleton = NoofitClient()
    return _singleton
