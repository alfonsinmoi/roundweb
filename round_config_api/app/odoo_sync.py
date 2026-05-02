"""Sincronización round_config (Postgres) → Odoo (round_facturacion).

Cada CREATE/UPDATE/DELETE en Postgres se replica en Odoo:
- cuota         → round.cuota.catalogo
- descuento     → round.descuento.catalogo
- modificacion  → round.modificacion.recibo

Si Odoo está caído o devuelve error, se logea pero NO se rompe la operación
(Postgres es la fuente de verdad; Odoo es secundario). El campo `odoo_id`
en Postgres mantiene la referencia para updates/deletes.
"""
import logging
import xmlrpc.client
from . import config as cfg

log = logging.getLogger(__name__)


class OdooSync:
    def __init__(self):
        self._uid = None
        self._models = None

    def _connect(self):
        if self._uid is not None:
            return True
        try:
            common = xmlrpc.client.ServerProxy(f'{cfg.ODOO_URL}/xmlrpc/2/common', allow_none=True)
            self._uid = common.authenticate(cfg.ODOO_DB, cfg.ODOO_USER, cfg.ODOO_PWD, {})
            if not self._uid:
                log.warning('Odoo: autenticación devolvió uid vacío')
                return False
            self._models = xmlrpc.client.ServerProxy(f'{cfg.ODOO_URL}/xmlrpc/2/object', allow_none=True)
            log.info(f'Odoo conectado uid={self._uid}')
            return True
        except Exception as e:
            log.warning(f'Odoo: no se pudo conectar: {e}')
            return False

    def _call(self, model, method, *args, **kwargs):
        if not self._connect():
            return None
        try:
            return self._models.execute_kw(
                cfg.ODOO_DB, self._uid, cfg.ODOO_PWD,
                model, method, list(args), kwargs
            )
        except xmlrpc.client.Fault as e:
            if 'cannot marshal None' in str(e):
                return True   # método retornó None, ejecución OK
            log.warning(f'Odoo {model}.{method} fault: {str(e)[:200]}')
            return None
        except Exception as e:
            log.warning(f'Odoo {model}.{method} error: {e}')
            return None

    # ── Cuotas ───────────────────────────────────────────────────────────────
    def cuota_create(self, postgres_row):
        if not cfg.ODOO_SYNC_ENABLED: return None
        vals = self._cuota_vals(postgres_row)
        # Intentar buscar por código primero (idempotencia)
        existing = self._call('round.cuota.catalogo', 'search',
                              [('codigo', '=', vals['codigo']), ('company_id', '=', cfg.ODOO_COMPANY)],
                              limit=1)
        if existing:
            self._call('round.cuota.catalogo', 'write', [existing[0]], vals)
            return existing[0]
        return self._call('round.cuota.catalogo', 'create', vals)

    def cuota_update(self, odoo_id, postgres_row):
        if not cfg.ODOO_SYNC_ENABLED or not odoo_id: return None
        vals = self._cuota_vals(postgres_row)
        return self._call('round.cuota.catalogo', 'write', [odoo_id], vals)

    def cuota_delete(self, odoo_id):
        if not cfg.ODOO_SYNC_ENABLED or not odoo_id: return None
        return self._call('round.cuota.catalogo', 'unlink', [odoo_id])

    def _cuota_vals(self, r):
        # Construye dict de valores Odoo desde una row de postgres
        return {
            'codigo':            r['codigo'],
            'descripcion':       r.get('descripcion') or '',
            'precio_mensual':    float(r.get('precio_mensual')    or 0),
            'precio_trimestral': float(r.get('precio_trimestral') or 0),
            'precio_semestral':  float(r.get('precio_semestral')  or 0),
            'precio_anual':      float(r.get('precio_anual')      or 0),
            'matricula':         float(r.get('matricula')         or 0),
            'activo':            bool(r.get('active', True)),
            'actividades_descripcion': self._build_acts_desc(r),
            'company_id':        cfg.ODOO_COMPANY,
        }

    def _build_acts_desc(self, r):
        # Texto libre con info útil (Odoo no tiene array de int)
        parts = []
        if r.get('formas_pago'):
            parts.append(f"Pago: {','.join(r['formas_pago'])}")
        if r.get('periodicidades'):
            parts.append(f"Periodos: {','.join(r['periodicidades'])}")
        if r.get('actividades_idnoofit'):
            parts.append(f"Acts NoofitPro: {','.join(map(str, r['actividades_idnoofit']))}")
        return ' · '.join(parts)

    # ── Descuentos ───────────────────────────────────────────────────────────
    def descuento_create(self, r):
        if not cfg.ODOO_SYNC_ENABLED: return None
        vals = self._descuento_vals(r)
        existing = self._call('round.descuento.catalogo', 'search',
                              [('codigo', '=', vals['codigo']), ('company_id', '=', cfg.ODOO_COMPANY)],
                              limit=1)
        if existing:
            self._call('round.descuento.catalogo', 'write', [existing[0]], vals)
            return existing[0]
        return self._call('round.descuento.catalogo', 'create', vals)

    def descuento_update(self, odoo_id, r):
        if not cfg.ODOO_SYNC_ENABLED or not odoo_id: return None
        return self._call('round.descuento.catalogo', 'write', [odoo_id], self._descuento_vals(r))

    def descuento_delete(self, odoo_id):
        if not cfg.ODOO_SYNC_ENABLED or not odoo_id: return None
        return self._call('round.descuento.catalogo', 'unlink', [odoo_id])

    def _descuento_vals(self, r):
        return {
            'codigo':      r['codigo'],
            'descripcion': r.get('descripcion') or '',
            'tipo':        r['tipo'],
            'valor':       float(r.get('valor') or 0),
            'activo':      bool(r.get('active', True)),
            'company_id':  cfg.ODOO_COMPANY,
        }

    # ── Modificaciones ───────────────────────────────────────────────────────
    # round.modificacion.recibo requiere una subscription_id que no existe en
    # Postgres (es a nivel cliente concreto). Para el espejo, intentamos
    # vincularla a la primera suscripción del cliente_idnoofit si está; si
    # no, dejamos sin sincronizar (log warning).
    def modificacion_create(self, r):
        if not cfg.ODOO_SYNC_ENABLED: return None
        sub_id = self._find_subscription(r.get('cliente_idnoofit'))
        if not sub_id:
            log.info(f"Modificación pg.{r.get('id')} sin suscripción Odoo asociada — skip")
            return None
        vals = {
            'subscription_id': sub_id,
            'fecha_desde':     str(r['fecha_desde']) if r.get('fecha_desde') else False,
            'fecha_hasta':     str(r['fecha_hasta']) if r.get('fecha_hasta') else False,
            'tipo':            r['tipo'],
            'valor':           float(r.get('valor') or 0),
            'razon':           r.get('razon') or '',
            'estado':          r.get('estado', 'activa'),
            'id_noofit_modificacion': str(r['id']),
        }
        return self._call('round.modificacion.recibo', 'create', vals)

    def modificacion_update(self, odoo_id, r):
        if not cfg.ODOO_SYNC_ENABLED or not odoo_id: return None
        vals = {
            'fecha_desde': str(r['fecha_desde']) if r.get('fecha_desde') else False,
            'fecha_hasta': str(r['fecha_hasta']) if r.get('fecha_hasta') else False,
            'tipo':        r['tipo'],
            'valor':       float(r.get('valor') or 0),
            'razon':       r.get('razon') or '',
            'estado':      r.get('estado', 'activa'),
        }
        return self._call('round.modificacion.recibo', 'write', [odoo_id], vals)

    def modificacion_delete(self, odoo_id):
        if not cfg.ODOO_SYNC_ENABLED or not odoo_id: return None
        return self._call('round.modificacion.recibo', 'unlink', [odoo_id])

    def _find_subscription(self, cliente_idnoofit):
        if not cliente_idnoofit:
            return None
        # Buscar partner por id_noofit
        partner_ids = self._call('res.partner', 'search', [('id_noofit', '=', str(cliente_idnoofit))], limit=1)
        if not partner_ids:
            return None
        sub_ids = self._call('round.subscription', 'search',
                             [('partner_id', '=', partner_ids[0]), ('estado', '=', 'activa')],
                             limit=1)
        return sub_ids[0] if sub_ids else None


_singleton = None
def get_sync():
    global _singleton
    if _singleton is None:
        _singleton = OdooSync()
    return _singleton
