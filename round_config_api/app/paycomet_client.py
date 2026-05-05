"""Cliente mínimo para PayComet REST API v2.

Crea enlaces de pago hospedados (formularios) que se envían al cliente para
cobro online. PayComet llama al endpoint de notificación cuando el pago se
completa (o falla) y nuestro backend marca el recibo como pagado en Odoo.

Configuración por variables de entorno (.env del backend):
  PAYCOMET_API_TOKEN     — token de API generado en panel PayComet
  PAYCOMET_TERMINAL      — número de terminal (FUC)
  PAYCOMET_URL_OK        — URL de redirección al éxito (lado cliente)
  PAYCOMET_URL_KO        — URL de redirección al fallo
  PAYCOMET_URL_NOTIF     — URL del webhook server-to-server
  PAYCOMET_SANDBOX       — '1' para usar sandbox
"""
import os, logging
import requests

log = logging.getLogger(__name__)


class PayCometError(Exception):
    pass


class PayCometClient:
    # PayComet REST API v1 — única URL para producción y sandbox.
    # La diferencia entre "test" y "real" la marcan el API Key + terminal
    # (los terminales sandbox como 86879 BANKSTORE TEST no llaman al banco).
    # Endpoint /v2 NO existe; PayComet sigue en v1 a fecha 2026-05.
    REST_BASE = 'https://rest.paycomet.com/v1'
    # Compat
    REST_PROD = REST_BASE
    REST_SANDBOX = REST_BASE

    def __init__(
        self,
        api_token=None,
        terminal=None,
        url_ok=None,
        url_ko=None,
        url_notif=None,
        sandbox=None,
    ):
        self.api_token = api_token or os.getenv('PAYCOMET_API_TOKEN', '')
        self.terminal = int(terminal or os.getenv('PAYCOMET_TERMINAL', '0') or '0')
        self.url_ok = url_ok or os.getenv('PAYCOMET_URL_OK', 'https://round.wiemspro.com/cuotas-clientes')
        self.url_ko = url_ko or os.getenv('PAYCOMET_URL_KO', 'https://round.wiemspro.com/cuotas-clientes')
        self.url_notif = url_notif or os.getenv(
            'PAYCOMET_URL_NOTIF',
            'https://round.wiemspro.com/api/cuotas/paycomet-callback'
        )
        self.sandbox = (str(sandbox or os.getenv('PAYCOMET_SANDBOX', '0')).lower() in ('1', 'true', 'yes'))

    @property
    def base(self):
        return self.REST_SANDBOX if self.sandbox else self.REST_PROD

    @property
    def configurado(self):
        return bool(self.api_token) and self.terminal > 0

    def _headers(self):
        return {
            'PAYCOMET-API-TOKEN': self.api_token,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        }

    # ──────────────────────────────────────────────────────────────────────────
    # Crear formulario de pago (devuelve URL para enviar al cliente)
    # https://docs.paycomet.com/recursos/api/api-rest/v2/form
    # ──────────────────────────────────────────────────────────────────────────
    def crear_enlace_pago(self, amount_eur, order_ref, productDescription='',
                          methods=None, currency='EUR', operationType=1):
        """amount_eur: float en euros. order_ref: string único (ej. INV/2026/00100).
        methods: lista de métodos PayComet (None = todos los activos en terminal).
                 1=Tarjeta, 6=Paypal, 8=Bizum, etc.
        operationType: 1 = autorización + cobro inmediato.
        Retorna URL para redirigir/enviar al cliente.

        Si no hay credenciales (modo stub), devuelve una URL a la página
        de pago simulado del propio backend para poder probar el flujo
        completo sin cuenta PayComet.
        """
        if not self.configurado:
            # Modo stub: la URL apunta a nuestra página de pago simulado
            base = os.getenv('ROUND_PUBLIC_BASE', 'https://round.wiemspro.com')
            return f'{base}/api/cuotas/paycomet-stub/{order_ref}?amount={amount_eur:.2f}'

        amount_cents = str(int(round(float(amount_eur) * 100)))
        # PayComet v1 espera el envelope { operationType, language, payment: {...} }
        # Los campos del payment van anidados dentro de "payment".
        payment = {
            'terminal': int(self.terminal),
            'order': str(order_ref)[:50],
            'amount': amount_cents,
            'currency': currency,
            'productDescription': productDescription[:100],
            'urlOk': self.url_ok,
            'urlKo': self.url_ko,
            'secure': 1,
        }
        if methods:
            payment['methods'] = methods
        payload = {
            'operationType': operationType,
            'language': 'es',
            'payment': payment,
        }
        # urlNotification se configura en panel PayComet por terminal, no en el body.
        try:
            r = requests.post(f'{self.base}/form', json=payload,
                              headers=self._headers(), timeout=30)
            try:
                d = r.json()
            except Exception:
                # Body no-JSON: incluye texto en el error para diagnosticar
                raise PayCometError(f'PayComet respuesta no-JSON status={r.status_code} body={r.text[:300]}')
        except PayCometError:
            raise
        except Exception as e:
            log.exception('paycomet form')
            raise PayCometError(f'PayComet HTTP error: {e}')

        err = d.get('errorCode') or 0
        if err:
            raise PayCometError(f"PayComet error {err}: {d.get('errorMessage') or d}")
        url = d.get('challengeUrl') or d.get('url')
        if not url:
            raise PayCometError(f'PayComet no devolvió URL: {d}')
        return url


_singleton = None
def get_client():
    global _singleton
    if _singleton is None:
        _singleton = PayCometClient()
    return _singleton


def get_client_for(id_manager, id_trainer):
    """Devuelve un PayCometClient con credenciales del trainer (BD).
    Si no hay configuración para ese trainer, cae a las variables de
    entorno globales (modo legacy / pruebas)."""
    try:
        from .routes.pasarelas import get_credenciales
        creds = get_credenciales(id_manager, id_trainer, 'paycomet')
    except Exception:
        creds = None
    if not creds:
        return get_client()
    return PayCometClient(
        api_token=creds.get('api_token'),
        terminal=creds.get('terminal'),
        url_ok=creds.get('url_ok'),
        url_ko=creds.get('url_ko'),
        url_notif=creds.get('url_notif'),
        sandbox=creds.get('sandbox'),
    )
