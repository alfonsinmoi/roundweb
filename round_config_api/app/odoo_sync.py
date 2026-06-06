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
    """Cliente XML-RPC de sincronización. Multi-company aware igual que
    OdooCuotas (ver doc allí). Si Odoo está caído devuelve None en vez de
    levantar excepción (sync es secundario, Postgres es la fuente)."""

    def __init__(self, id_manager=None):
        self._uid = None
        self._models = None
        self._id_manager = str(id_manager) if id_manager else None
        self._company_id = None
        self._odoo_url = None

    def resolve_company(self, id_manager=None, id_trainer=None):
        """B1/B10 — Empresa Odoo por (manager, trainer). int | None.
        Trainer con entidad propia → su company; si no → la del manager.
        Lanza si la company resuelta es legacy/prohibida."""
        idm = str(id_manager) if id_manager else (self._id_manager or None)
        comp = None
        from .db import get_conn
        with get_conn() as conn, conn.cursor() as cur:
            if idm and id_trainer:
                cur.execute("SELECT odoo_company_id FROM trainer_empresa "
                            "WHERE id_manager=%s AND id_trainer=%s", (idm, str(id_trainer)))
                r = cur.fetchone()
                if r and r.get('odoo_company_id'):
                    comp = int(r['odoo_company_id'])
            if comp is None and idm:
                cur.execute("SELECT odoo_company_id FROM manager_config WHERE id_manager=%s", (idm,))
                r = cur.fetchone()
                if r and r.get('odoo_company_id'):
                    comp = int(r['odoo_company_id'])
        if comp is None and not idm:
            comp = int(cfg.ODOO_COMPANY)
        if comp is not None and comp in cfg.ODOO_LEGACY_COMPANY_IDS:
            raise RuntimeError(f'company {comp} es legacy/prohibida (manager={idm}, trainer={id_trainer})')
        return comp

    def _ensure_identity(self):
        if self._company_id is not None:
            return
        if self._id_manager:
            try:
                from .db import get_conn
                with get_conn() as conn, conn.cursor() as cur:
                    cur.execute("SELECT odoo_url FROM manager_config WHERE id_manager=%s",
                                (self._id_manager,))
                    row = cur.fetchone()
                self._odoo_url = ((row or {}).get('odoo_url') or '').strip() or None
            except Exception as e:
                log.warning(f'OdooSync: error resolviendo odoo_url: {e}')
        comp = self.resolve_company(self._id_manager)
        if comp is None and not self._id_manager:
            comp = int(cfg.ODOO_COMPANY)
        self._company_id = comp  # puede ser None para manager sin provisionar

    @property
    def company_id(self):
        self._ensure_identity()
        return self._company_id

    @property
    def odoo_url(self):
        self._ensure_identity()
        return self._odoo_url or cfg.ODOO_URL

    def _connect(self):
        if self._uid is not None:
            return True
        try:
            url = self.odoo_url
            common = xmlrpc.client.ServerProxy(f'{url}/xmlrpc/2/common', allow_none=True)
            self._uid = common.authenticate(cfg.ODOO_DB, cfg.ODOO_USER, cfg.ODOO_PWD, {})
            if not self._uid:
                log.warning('Odoo: autenticación devolvió uid vacío')
                return False
            self._models = xmlrpc.client.ServerProxy(f'{url}/xmlrpc/2/object', allow_none=True)
            log.info(f'Odoo conectado uid={self._uid}')
            return True
        except Exception as e:
            log.warning(f'Odoo: no se pudo conectar: {e}')
            return False

    # ── Helper defensivo multi-company (igual que OdooCuotas) ──────────────
    @staticmethod
    def _domain_has_company(domain):
        if not domain:
            return False
        for term in domain:
            if isinstance(term, (list, tuple)) and len(term) >= 1 and term[0] == 'company_id':
                return True
        return False

    def _call_scoped(self, model, method, domain, *args, **kwargs):
        if not self._domain_has_company(domain):
            domain = [('company_id', '=', self.company_id)] + list(domain or [])
        return self._call(model, method, domain, *args, **kwargs)

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
        # Idempotencia: buscar por (codigo, company, id_trainer). Cada centro
        # tiene su propia cuota con mismo código (Málaga "I MYGYM" ≠ Añoreta "I MYGYM").
        search_dom = [('codigo', '=', vals['codigo']),
                      ('company_id', '=', vals['company_id'])]
        tr = vals.get('id_trainer') or False
        search_dom.append(('id_trainer', '=', tr))
        existing = self._call('round.cuota.catalogo', 'search', search_dom, limit=1)
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
        # Construye dict de valores Odoo desde una row de postgres.
        # id_trainer espeja la columna local — permite scope per-centro.
        id_trainer = r.get('id_trainer')
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
            'company_id':        self.resolve_company(self._id_manager, id_trainer),  # B10: por trainer
            'id_trainer':        str(id_trainer) if id_trainer else False,
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
                              [('codigo', '=', vals['codigo']), ('company_id', '=', vals['company_id'])],
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
            'company_id':  self.resolve_company(self._id_manager, r.get('id_trainer')),  # B10: por trainer
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

    def _find_subscriptions_active(self, cliente_idnoofit):
        """Devuelve lista de IDs de TODAS las suscripciones activas del cliente."""
        if not cliente_idnoofit:
            return []
        partner_ids = self._call('res.partner', 'search', [('id_noofit', '=', str(cliente_idnoofit))], limit=1)
        if not partner_ids:
            return []
        return self._call('round.subscription', 'search',
                          [('partner_id', '=', partner_ids[0]), ('estado', '=', 'activa')]) or []

    # ── Asignaciones de descuento a cliente ──────────────────────────────────
    # En Odoo no hay un objeto "asignación" — se modela añadiendo el descuento
    # al campo many2many `descuentos_activos_ids` de cada suscripción del cliente.
    def asignacion_apply(self, descuento_odoo_id, cliente_idnoofit):
        """Añade el descuento (por su id en round.descuento.catalogo) a las
        suscripciones activas del cliente."""
        if not cfg.ODOO_SYNC_ENABLED or not descuento_odoo_id:
            return None
        sub_ids = self._find_subscriptions_active(cliente_idnoofit)
        if not sub_ids:
            log.info(f'asignacion_apply: cliente {cliente_idnoofit} sin suscripciones activas')
            return None
        # (4, id) = link many2many sin reemplazar el resto
        for sub in sub_ids:
            self._call('round.subscription', 'write', [sub],
                       {'descuentos_activos_ids': [(4, descuento_odoo_id)]})
        return sub_ids

    def asignacion_revoke(self, descuento_odoo_id, cliente_idnoofit):
        """Quita el descuento de las suscripciones del cliente (puede ya no estar activas)."""
        if not cfg.ODOO_SYNC_ENABLED or not descuento_odoo_id:
            return None
        partner_ids = self._call('res.partner', 'search', [('id_noofit', '=', str(cliente_idnoofit))], limit=1)
        if not partner_ids:
            return None
        sub_ids = self._call('round.subscription', 'search', [('partner_id', '=', partner_ids[0])]) or []
        # (3, id) = unlink many2many sin borrar
        for sub in sub_ids:
            self._call('round.subscription', 'write', [sub],
                       {'descuentos_activos_ids': [(3, descuento_odoo_id)]})
        return sub_ids


# Cache de instancias por manager — ver get_cuotas() para detalles.
_instances = {}
def get_sync(id_manager=None):
    """Devuelve la instancia OdooSync para el manager dado.

    - `get_sync()` → instancia default (legacy).
    - `get_sync(id_manager='17675')` → ligada a ese manager."""
    key = str(id_manager or 'default')
    inst = _instances.get(key)
    if inst is None:
        inst = OdooSync(id_manager=id_manager)
        _instances[key] = inst
    return inst
