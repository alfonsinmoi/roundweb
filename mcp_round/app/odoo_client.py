"""Cliente XML-RPC a Odoo round_facturacion.

Wrapper minimal que evita ciclos de autenticación en cada call.
"""
import xmlrpc.client
import logging
from . import config

log = logging.getLogger(__name__)


class OdooClient:
    def __init__(self, url=None, db=None, user=None, pwd=None):
        self.url  = url or config.ODOO_URL
        self.db   = db  or config.ODOO_DB
        self.user = user or config.ODOO_USER
        self.pwd  = pwd or config.ODOO_PWD
        self._uid = None
        self._models = None
        self._common = None

    def _connect(self):
        if self._uid is None:
            self._common = xmlrpc.client.ServerProxy(
                f'{self.url}/xmlrpc/2/common', allow_none=True
            )
            self._uid = self._common.authenticate(self.db, self.user, self.pwd, {})
            if not self._uid:
                raise RuntimeError(f'Odoo authentication failed for user {self.user}')
            self._models = xmlrpc.client.ServerProxy(
                f'{self.url}/xmlrpc/2/object', allow_none=True
            )
            log.info(f'Odoo connected as {self.user} (uid {self._uid})')

    def call(self, model, method, *args, **kwargs):
        self._connect()
        try:
            return self._models.execute_kw(
                self.db, self._uid, self.pwd, model, method, list(args), kwargs
            )
        except xmlrpc.client.Fault as e:
            # Odoo no marshalla None en respuestas. Algunos métodos (validate, write,
            # action_*…) devuelven None y dan error de serialización aunque hayan
            # ejecutado bien. Tratamos ese caso como éxito.
            if 'cannot marshal None' in str(e):
                return True
            raise

    # ── Helpers de alto nivel ────────────────────────────────────────────────

    def find_partner_by_dni(self, dni):
        """Busca partner por DNI/NIF (campo vat). Devuelve id o False."""
        # En NoofitPro guardan DNI sin prefijo país; en Odoo con 'ES' prefijado
        # Probamos ambos
        candidates = [dni, f'ES{dni}', dni.replace('ES', '', 1)]
        for c in candidates:
            ids = self.call('res.partner', 'search', [('vat', '=', c)], limit=1)
            if ids:
                return ids[0]
        return False

    def find_or_create_partner(self, dni, vals):
        """Busca por DNI o crea. vals = dict con name, email, etc."""
        pid = self.find_partner_by_dni(dni)
        if pid:
            self.call('res.partner', 'write', [pid], vals)
            return pid, False
        # Crear
        vals['vat'] = dni if dni.startswith('ES') else f'ES{dni}'
        return self.call('res.partner', 'create', vals), True

    def find_cuota_by_codigo(self, codigo, company_id=None):
        company_id = company_id or config.DEFAULT_COMPANY_ID
        ids = self.call('round.cuota.catalogo', 'search',
                        [('codigo', '=', codigo), ('company_id', '=', company_id)],
                        limit=1)
        return ids[0] if ids else False

    def find_descuento_by_codigo(self, codigo, company_id=None):
        company_id = company_id or config.DEFAULT_COMPANY_ID
        ids = self.call('round.descuento.catalogo', 'search',
                        [('codigo', '=', codigo), ('company_id', '=', company_id)],
                        limit=1)
        return ids[0] if ids else False

    def log_webhook(self, vals):
        """Crea entrada en round.log.webhook."""
        return self.call('round.log.webhook', 'create', vals)

    def log_webhook_already_processed(self, webhook_id):
        """Devuelve el log existente o None si no existe."""
        if not webhook_id:
            return None
        ids = self.call('round.log.webhook', 'search', [('webhook_id', '=', webhook_id)], limit=1)
        if not ids:
            return None
        return self.call('round.log.webhook', 'read', [ids[0]],
                         ['estado', 'response', 'invoice_id', 'subscription_id'])[0]


_singleton = None
def get_client():
    global _singleton
    if _singleton is None:
        _singleton = OdooClient()
    return _singleton
