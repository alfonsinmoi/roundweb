"""Provisioner modular de Odoo per-manager (Fase 6).

REFACTOR Fase 6: el provisioner original — que solo sabía activar TODO
de golpe — se descompone en 3 sub-provisioners independientes:

  - provision_crm(id_manager, datos)          → activa solo CRM
  - provision_cuotas(id_manager, datos)       → activa solo Cuotas
  - provision_contabilidad(id_manager, datos) → activa solo Contabilidad

Cada uno es IDEMPOTENTE — se puede llamar dos veces sin duplicar datos,
y se puede llamar DESPUÉS de haber activado otros módulos (la company
y los pasos comunes se reaprovechan).

Compatibilidad retro: la clase `OdooProvisioner` original se mantiene
para el flujo "Despliegue total" (activar los 3 a la vez), pero
internamente delega en los 3 sub-provisioners.

Diccionario de pasos:

  COMUNES (siempre, los necesita cualquier módulo):
    A. ensure_company       — crea res.company o reutiliza la existente
    B. ensure_adminround    — añade adminround a la lista de companies
    C. ensure_analytic      — plan "Round Trainers" + analytic GENERAL

  ESPECÍFICOS POR MÓDULO:
    Cuotas:
      D. ensure_chart       — plan contable PYMES (635 cuentas)
      E. ensure_journals    — Caja, Banco SEPA, TPV, Link
      F. ensure_bank        — IBAN principal (si se proporciona)
      G. ensure_sequence    — secuencia facturas con prefijo + último nº
      H. save_sistemas_cobro → guarda lista JSONB en manager_config
    Contabilidad:
      D. ensure_chart       — comparte el plan con Cuotas (idempotente)
      E. ensure_journals    — solo Caja (gastos puntuales)
    CRM:
      (ningún paso específico — basta con company + adminround)
"""
import json
import logging
import subprocess
import time

from . import config as cfg
from .db import get_conn
from .odoo_cuotas import get_cuotas

log = logging.getLogger(__name__)

ODOO_PYTHON = '/opt/odoo17/venv/bin/python'
ODOO_BIN    = '/opt/odoo17/odoo/odoo-bin'
ODOO_CONF   = '/etc/odoo17.conf'

# uid del usuario adminround en Odoo (al que añadiremos a la nueva company)
ADMINROUND_UID = 2

# country_id y currency_id de España/EUR en Odoo (fijos en esta instalación).
COUNTRY_ES = 68
CURRENCY_EUR = 126


class ProvisionerError(Exception):
    """Error en el provisioner. Lleva el step donde falló y los datos
    parciales (lo que sí se creó antes del fallo)."""

    def __init__(self, step, message, partial=None, original=None):
        self.step = step
        self.partial = partial or {}
        self.original = original
        super().__init__(f'[{step}] {message}')


# ═══════════════════════════════════════════════════════════════════════════
# HELPERS IDEMPOTENTES (cada uno comprueba antes de crear)
# ═══════════════════════════════════════════════════════════════════════════

def _log(steps, name, ok, data=None, error=None):
    """Append una entrada al log de pasos (lista compartida entre sub-provs)."""
    entry = {'step': name, 'ok': bool(ok), 'at_unix': int(time.time())}
    if data is not None:
        entry['data'] = data
    if error is not None:
        entry['error'] = str(error)[:500]
    if steps is not None:
        steps.append(entry)
    if ok:
        log.info(f'provisioner {name}: OK {data or ""}')
    else:
        log.warning(f'provisioner {name}: FAIL {error}')


def _read_manager_row(id_manager):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT id_manager, odoo_enabled, odoo_company_id,
                              odoo_analytic_plan_id, odoo_analytic_default_id,
                              odoo_crm_enabled, odoo_cuotas_enabled,
                              odoo_contabilidad_enabled, sistemas_cobro
                         FROM manager_config WHERE id_manager = %s""",
                    (str(id_manager),))
        return cur.fetchone()


# ─── A. ensure_company ────────────────────────────────────────────────────

def ensure_company(id_manager, datos, steps=None):
    """Devuelve `company_id` (creándola si no existe).

    Si `manager_config.odoo_company_id` ya está, se reutiliza (no-op).
    Si no, crea res.company en Odoo, guarda el id en manager_config y
    marca `odoo_enabled=true` + `odoo_activated_at=NOW()`.
    """
    row = _read_manager_row(id_manager)
    if not row:
        raise ProvisionerError('ensure_company',
                               f'manager {id_manager} no existe en manager_config',
                               partial={})
    if row.get('odoo_company_id'):
        _log(steps, 'ensure_company', True,
             {'company_id': row['odoo_company_id'], 'reused': True})
        return row['odoo_company_id']

    # Validar datos mínimos
    razon = (datos.get('razon_social') or '').strip()
    cif = (datos.get('cif') or '').strip().upper()
    if not razon or not cif:
        raise ProvisionerError('ensure_company',
                               'faltan razon_social o cif para crear la company',
                               partial={})

    vals = {
        'name':        razon,
        'vat':         cif,
        'currency_id': CURRENCY_EUR,
        'country_id':  COUNTRY_ES,
    }
    for src, dst in [('direccion','street'), ('cp','zip'),
                     ('poblacion','city'), ('telefono','phone'),
                     ('email_facturacion','email')]:
        if datos.get(src):
            vals[dst] = datos[src]

    oc = get_cuotas()
    company_id = oc._call('res.company', 'create', vals)

    # Guardar en manager_config
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""UPDATE manager_config
                          SET odoo_company_id = %s,
                              odoo_enabled = TRUE,
                              odoo_activated_at = NOW()
                        WHERE id_manager = %s""",
                    (company_id, str(id_manager)))

    _log(steps, 'ensure_company', True,
         {'company_id': company_id, 'reused': False, 'cif': cif})
    return company_id


# ─── B. ensure_adminround ─────────────────────────────────────────────────

def ensure_adminround(company_id, steps=None):
    """Asegura que adminround tiene esta company en su lista."""
    oc = get_cuotas()
    u = oc._call('res.users', 'read', [ADMINROUND_UID], ['company_ids'])[0]
    actuales = u.get('company_ids') or []
    if company_id in actuales:
        _log(steps, 'ensure_adminround', True,
             {'reused': True, 'company_ids': actuales})
        return
    oc._call('res.users', 'write', [ADMINROUND_UID],
             {'company_ids': [(4, company_id)]})
    u2 = oc._call('res.users', 'read', [ADMINROUND_UID], ['company_ids'])[0]
    _log(steps, 'ensure_adminround', True,
         {'reused': False, 'company_ids': u2.get('company_ids')})


# ─── C. ensure_analytic ───────────────────────────────────────────────────

def ensure_analytic(id_manager, company_id, razon_social, steps=None):
    """Crea plan "Round Trainers" (si no existe globalmente) + analytic
    default para esta company, y los guarda en manager_config.

    Si ya hay `odoo_analytic_default_id` en la fila, no-op.
    """
    row = _read_manager_row(id_manager)
    if row and row.get('odoo_analytic_default_id'):
        _log(steps, 'ensure_analytic', True,
             {'reused': True,
              'plan_id': row.get('odoo_analytic_plan_id'),
              'analytic_default_id': row.get('odoo_analytic_default_id')})
        return {'plan_id': row.get('odoo_analytic_plan_id'),
                'analytic_default_id': row.get('odoo_analytic_default_id')}

    oc = get_cuotas()
    plan_name = 'Round Trainers'
    plan_ids = oc._call('account.analytic.plan', 'search',
                        [('name', '=', plan_name)], limit=1)
    if plan_ids:
        plan_id = plan_ids[0]
    else:
        plan_id = oc._call('account.analytic.plan', 'create',
                           {'name': plan_name,
                            'default_applicability': 'optional'})

    analytic_name = f'GENERAL {(razon_social or "")[:50]}'.strip()
    analytic_id = oc._call('account.analytic.account', 'create',
        {'name': analytic_name,
         'plan_id': plan_id,
         'company_id': company_id,
         'code': f'GEN-{company_id}'})

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""UPDATE manager_config
                          SET odoo_analytic_plan_id = %s,
                              odoo_analytic_default_id = %s
                        WHERE id_manager = %s""",
                    (plan_id, analytic_id, str(id_manager)))

    out = {'plan_id': plan_id, 'analytic_default_id': analytic_id,
           'analytic_name': analytic_name}
    _log(steps, 'ensure_analytic', True, out)
    return out


# ─── D. ensure_chart ──────────────────────────────────────────────────────

def ensure_chart(company_id, plan='es_pymes', steps=None):
    """Aplica el plan contable PYMES (635 cuentas). Idempotente: si la
    company ya tiene >100 account.account, no-op.

    Usa subprocess al `odoo-bin shell` porque `account.chart.template`
    no es accesible vía XML-RPC.
    """
    if plan not in ('es_pymes', 'es_full', 'es_assoc'):
        plan = 'es_pymes'

    oc = get_cuotas()
    n_existente = oc._call('account.account', 'search_count',
                           [('company_id', '=', company_id)])
    if n_existente and n_existente > 100:
        _log(steps, 'ensure_chart', True,
             {'plan': plan, 'reused': True, 'n_accounts': n_existente})
        return {'n_accounts': n_existente, 'reused': True}

    script = (
        "import logging; logging.disable(logging.CRITICAL)\n"
        f"_c = env['res.company'].browse({int(company_id)})\n"
        f"env['account.chart.template'].try_loading('{plan}', "
        f"company=_c, install_demo=False)\n"
        "env.cr.commit()\n"
        "_n = env['account.account'].search_count("
        f"  [('company_id', '=', {int(company_id)})])\n"
        "print(f'CHART_OK n_accounts={_n}')\n"
    )
    result = subprocess.run(
        [ODOO_PYTHON, ODOO_BIN, 'shell',
         '-d', cfg.ODOO_DB, '-c', ODOO_CONF,
         '--no-http', '--logfile=/dev/null'],
        input=script.encode('utf-8'),
        capture_output=True, timeout=120,
    )
    stdout = (result.stdout or b'').decode('utf-8', errors='replace')
    stderr = (result.stderr or b'').decode('utf-8', errors='replace')
    n_accounts = None
    for line in stdout.splitlines():
        if line.startswith('CHART_OK'):
            try: n_accounts = int(line.split('=')[1])
            except Exception: pass
            break
    if n_accounts is None or n_accounts < 100:
        raise ProvisionerError(
            'ensure_chart',
            f'plan_contable_no_aplicado n_accounts={n_accounts} '
            f'stderr={stderr[-300:]}',
            partial={'company_id': company_id},
        )
    _log(steps, 'ensure_chart', True,
         {'plan': plan, 'reused': False, 'n_accounts': n_accounts})
    return {'n_accounts': n_accounts, 'reused': False}


# ─── E. ensure_journals ───────────────────────────────────────────────────

# Default sets per module
_JOURNALS_CUOTAS = [
    ('Caja',           'CAJA',   'cash'),
    ('Banco SEPA',     'BNSEPA', 'bank'),
    ('TPV',            'TPV',    'cash'),
    ('Enlace de pago', 'LINK',   'cash'),
]

_JOURNALS_CONTAB = [
    ('Caja',           'CAJA',   'cash'),
]


def ensure_journals(company_id, journals, steps=None):
    """Crea cada (name, code, type) si no existe ya para la company."""
    oc = get_cuotas()
    creados = []
    for name, code, jtype in journals:
        existing = oc._call('account.journal', 'search',
            [('company_id', '=', company_id), ('code', '=', code)],
            limit=1)
        if existing:
            creados.append({'code': code, 'id': existing[0], 'reused': True})
            continue
        try:
            jid = oc._call('account.journal', 'create',
                           {'name': name, 'code': code, 'type': jtype,
                            'company_id': company_id})
            creados.append({'code': code, 'id': jid, 'reused': False})
        except Exception as e:
            log.warning(f'  journal {code} falló: {str(e)[:150]}')
            creados.append({'code': code, 'error': str(e)[:200]})
    _log(steps, 'ensure_journals', True, {'journals': creados})
    return creados


# ─── F. ensure_bank (IBAN) ────────────────────────────────────────────────

def ensure_bank(company_id, datos, steps=None):
    """Crea res.partner.bank con el IBAN principal si no existe ya."""
    iban = (datos.get('iban_principal') or '').replace(' ', '').upper()
    if not iban:
        _log(steps, 'ensure_bank', True, {'skipped': 'no_iban'})
        return None

    oc = get_cuotas()
    existing = oc._call('res.partner.bank', 'search',
        [('company_id', '=', company_id), ('acc_number', '=', iban)],
        limit=1)
    if existing:
        _log(steps, 'ensure_bank', True,
             {'bank_id': existing[0], 'reused': True,
              'iban_last4': iban[-4:]})
        return existing[0]

    cmp = oc._call('res.company', 'read', [company_id], ['partner_id'])[0]
    pid = cmp['partner_id'][0]
    vals = {'partner_id': pid, 'acc_number': iban, 'company_id': company_id}
    banco_nombre = (datos.get('banco_nombre') or '').strip()
    if banco_nombre:
        bid = oc._call('res.bank', 'search',
                       [('name', '=ilike', banco_nombre)], limit=1)
        if bid:
            vals['bank_id'] = bid[0]
        else:
            vals['bank_id'] = oc._call('res.bank', 'create',
                                        {'name': banco_nombre})
    bank_id = oc._call('res.partner.bank', 'create', vals)
    _log(steps, 'ensure_bank', True,
         {'bank_id': bank_id, 'reused': False, 'iban_last4': iban[-4:]})
    return bank_id


# ─── G. ensure_sequence ───────────────────────────────────────────────────

def ensure_sequence(company_id, datos, steps=None):
    """Crea ir.sequence para facturas de esta company. Si ya existe (por
    code), no-op."""
    oc = get_cuotas()
    code = f'account.move.invoice.{company_id}'
    existing = oc._call('ir.sequence', 'search',
        [('code', '=', code), ('company_id', '=', company_id)], limit=1)
    if existing:
        _log(steps, 'ensure_sequence', True,
             {'sequence_id': existing[0], 'reused': True})
        return existing[0]

    prefijo = (datos.get('factura_secuencia_prefijo') or '').strip()
    next_num = int(datos.get('factura_ultimo_numero') or 0) + 1
    vals = {
        'name': f'Facturas company {company_id}',
        'code': code,
        'prefix': prefijo or False,
        'padding': 4,
        'number_next': next_num,
        'number_increment': 1,
        'implementation': 'standard',
        'company_id': company_id,
    }
    seq_id = oc._call('ir.sequence', 'create', vals)
    _log(steps, 'ensure_sequence', True,
         {'sequence_id': seq_id, 'reused': False,
          'next': next_num, 'prefijo': prefijo})
    return seq_id


# ─── H. save_sistemas_cobro ───────────────────────────────────────────────

# Lista canónica de sistemas de cobro (espejo en el frontend)
SISTEMAS_COBRO_VALIDOS = {
    'sepa', 'tpv_virtual', 'link_pago', 'efectivo',
    'transferencia_manual', 'tokenizacion_tarjeta',
}


def save_sistemas_cobro(id_manager, sistemas, steps=None):
    """Guarda lista JSONB de sistemas de cobro en manager_config. Filtra
    valores desconocidos para evitar basura."""
    sistemas = sistemas or []
    if not isinstance(sistemas, (list, tuple)):
        sistemas = []
    limpios = [s for s in sistemas if s in SISTEMAS_COBRO_VALIDOS]
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""UPDATE manager_config
                          SET sistemas_cobro = %s::jsonb
                        WHERE id_manager = %s""",
                    (json.dumps(limpios), str(id_manager)))
    _log(steps, 'save_sistemas_cobro', True, {'sistemas': limpios})
    return limpios


# ─── Flag setters ────────────────────────────────────────────────────────

def _set_flag(id_manager, column):
    """Activa una columna booleana en manager_config."""
    # Whitelist para evitar SQL injection (la columna viene de constante)
    assert column in ('odoo_crm_enabled', 'odoo_cuotas_enabled',
                       'odoo_contabilidad_enabled')
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"""UPDATE manager_config
                           SET {column} = TRUE
                         WHERE id_manager = %s""",
                    (str(id_manager),))


# ═══════════════════════════════════════════════════════════════════════════
# SUB-PROVISIONERS — uno por módulo
# ═══════════════════════════════════════════════════════════════════════════

def provision_crm(id_manager, datos, steps=None) -> dict:
    """Activa el módulo CRM para un manager.

    Idempotente. Si ya está activado y la company existe, se limita a
    re-marcar `odoo_crm_enabled=true` (no-op real).

    Datos mínimos (solo si es la primera vez que se crea la company):
      - razon_social, cif

    Devuelve:
      {'company_id', 'analytic', 'modulo': 'crm', 'enabled': True}
    """
    steps = steps if steps is not None else []
    partial = {}
    try:
        partial['company_id'] = ensure_company(id_manager, datos, steps)
        ensure_adminround(partial['company_id'], steps)
        try:
            partial['analytic'] = ensure_analytic(
                id_manager, partial['company_id'],
                datos.get('razon_social', ''), steps)
        except Exception as e:
            # Analytic no es crítico; loguear y continuar
            log.warning(f'provision_crm[{id_manager}] analytic falló: {e}')
            _log(steps, 'ensure_analytic', False, error=e)
        _set_flag(id_manager, 'odoo_crm_enabled')
        _log(steps, 'provision_crm.done', True, {'company_id': partial['company_id']})
        return {'company_id': partial['company_id'],
                'analytic': partial.get('analytic'),
                'modulo': 'crm', 'enabled': True}
    except ProvisionerError:
        raise
    except Exception as e:
        raise ProvisionerError('provision_crm', str(e), partial, e)


def provision_cuotas(id_manager, datos, steps=None) -> dict:
    """Activa el módulo Cuotas (suscripciones + recibos + cobros).

    Idempotente — los pasos que ya estén hechos se saltan.

    Datos:
      - razon_social, cif (si es la primera vez)
      - iban_principal, banco_nombre (opcionales pero recomendados)
      - factura_secuencia_prefijo, factura_ultimo_numero (opcionales)
      - sistemas_cobro: lista (ej. ['sepa','tpv_virtual','link_pago'])
      - plan_contable: 'es_pymes' (default) | 'es_full' | 'es_assoc'

    Devuelve dict con todo lo creado.
    """
    steps = steps if steps is not None else []
    partial = {}
    try:
        partial['company_id'] = ensure_company(id_manager, datos, steps)
        company_id = partial['company_id']
        partial['chart'] = ensure_chart(
            company_id, datos.get('plan_contable') or 'es_pymes', steps)
        partial['journals'] = ensure_journals(company_id, _JOURNALS_CUOTAS, steps)
        partial['bank_id'] = ensure_bank(company_id, datos, steps)
        partial['sequence_id'] = ensure_sequence(company_id, datos, steps)
        ensure_adminround(company_id, steps)
        try:
            partial['analytic'] = ensure_analytic(
                id_manager, company_id, datos.get('razon_social', ''), steps)
        except Exception as e:
            log.warning(f'provision_cuotas[{id_manager}] analytic falló: {e}')
            _log(steps, 'ensure_analytic', False, error=e)
        partial['sistemas_cobro'] = save_sistemas_cobro(
            id_manager, datos.get('sistemas_cobro') or [], steps)
        _set_flag(id_manager, 'odoo_cuotas_enabled')
        _log(steps, 'provision_cuotas.done', True, {'company_id': company_id})
        return {**partial, 'modulo': 'cuotas', 'enabled': True}
    except ProvisionerError as e:
        # Propagar con el partial actualizado
        e.partial = {**e.partial, **partial}
        raise
    except Exception as e:
        raise ProvisionerError('provision_cuotas', str(e), partial, e)


def provision_contabilidad(id_manager, datos, steps=None) -> dict:
    """Activa el módulo Contabilidad (gastos + facturas manuales).

    Idempotente. Comparte plan contable con Cuotas si ya está activo.

    Datos:
      - razon_social, cif (si es la primera vez)
      - plan_contable: 'es_pymes' (default)
    """
    steps = steps if steps is not None else []
    partial = {}
    try:
        partial['company_id'] = ensure_company(id_manager, datos, steps)
        company_id = partial['company_id']
        partial['chart'] = ensure_chart(
            company_id, datos.get('plan_contable') or 'es_pymes', steps)
        partial['journals'] = ensure_journals(company_id, _JOURNALS_CONTAB, steps)
        ensure_adminround(company_id, steps)
        try:
            partial['analytic'] = ensure_analytic(
                id_manager, company_id, datos.get('razon_social', ''), steps)
        except Exception as e:
            log.warning(f'provision_contabilidad[{id_manager}] analytic falló: {e}')
            _log(steps, 'ensure_analytic', False, error=e)
        _set_flag(id_manager, 'odoo_contabilidad_enabled')
        _log(steps, 'provision_contabilidad.done', True, {'company_id': company_id})
        return {**partial, 'modulo': 'contabilidad', 'enabled': True}
    except ProvisionerError as e:
        e.partial = {**e.partial, **partial}
        raise
    except Exception as e:
        raise ProvisionerError('provision_contabilidad', str(e), partial, e)


# ═══════════════════════════════════════════════════════════════════════════
# COMPATIBILIDAD RETRO — clase OdooProvisioner original
# ═══════════════════════════════════════════════════════════════════════════

class OdooProvisioner:
    """Wrapper retro: activa los 3 módulos (CRM + Cuotas + Contabilidad).

    Mantiene la API original (`.run()`, `.log_steps`) que usa el endpoint
    /api/manager/solicitud-despliegue del wizard "Despliegue total".
    Internamente delega en los 3 sub-provisioners.
    """

    def __init__(self, id_manager, datos):
        self.id_manager = str(id_manager)
        self.datos = datos
        self.log_steps = []

    def run(self):
        partial = {}
        # 1) Cuotas — el más completo (chart + journals + bank + sequence).
        #    Lo hacemos primero porque "siembra" el chart que comparten ambos.
        try:
            cuotas = provision_cuotas(self.id_manager, self.datos,
                                       steps=self.log_steps)
            partial.update({k: v for k, v in cuotas.items()
                            if k not in ('modulo', 'enabled')})
        except ProvisionerError as e:
            raise ProvisionerError(e.step,
                                   f'provision_cuotas: {e}',
                                   {**partial, **(e.partial or {})}, e)

        # 2) Contabilidad — reutiliza chart de Cuotas (idempotente).
        try:
            provision_contabilidad(self.id_manager, self.datos,
                                    steps=self.log_steps)
        except ProvisionerError as e:
            raise ProvisionerError(e.step,
                                   f'provision_contabilidad: {e}',
                                   {**partial, **(e.partial or {})}, e)

        # 3) CRM — no añade pasos nuevos (todo lo necesario ya está).
        try:
            provision_crm(self.id_manager, self.datos,
                          steps=self.log_steps)
        except ProvisionerError as e:
            raise ProvisionerError(e.step,
                                   f'provision_crm: {e}',
                                   {**partial, **(e.partial or {})}, e)

        return partial


# ═══════════════════════════════════════════════════════════════════════════
# Sync inicial de partners desde cliente_cache (Fase 3)
# ═══════════════════════════════════════════════════════════════════════════

def sync_partners_from_cache(id_manager, solicitud_id=None):
    """Replica todos los clientes activos de `cliente_cache` (lo que está
    en NoofitPro filtrado a este manager) a `res.partner` de la company
    del manager en Odoo. Idempotente — `upsert_partner` busca por
    `id_noofit` antes de crear, así que llamarlo dos veces no duplica.

    Si pasas `solicitud_id`, vamos actualizando el progreso en
    `odoo_solicitud_despliegue.partners_synced` para que el frontend
    pueda mostrarlo en tiempo real.

    Devuelve: {'total': N, 'synced': M, 'errors': [{idnoofit, error}, ...]}
    """
    from .odoo_alta import get_alta
    oa = get_alta(id_manager=id_manager)

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT id, raw_data FROM cliente_cache
             WHERE id_manager = %s AND enabled = TRUE
             ORDER BY id
        """, (str(id_manager),))
        rows = cur.fetchall()
    total = len(rows)

    if solicitud_id:
        _mark_partners_sync_started(solicitud_id, total)

    log.info(f'sync_partners[{id_manager}]: arrancando con {total} clientes')

    synced = 0
    errors = []

    for r in rows:
        c = r['raw_data'] if isinstance(r['raw_data'], dict) else {}
        try:
            payload = {
                'idnoofit':   str(r['id']),
                'nombre':     c.get('name') or '',
                'apellidos':  c.get('surname') or '',
                'dni':        c.get('dni') or '',
                'email':      c.get('email') or '',
                'movil':      c.get('cellPhone') or '',
                'direccion':  c.get('address') or '',
                'localidad':  c.get('town') or '',
                'cp':         c.get('postal_code') or '',
                'fecha_nacimiento': c.get('birthdate') or '',
                'sexo':       c.get('gender') or '',
            }
            oa.upsert_partner(payload)
            synced += 1
        except Exception as e:
            errors.append({'idnoofit': r['id'],
                           'error':    str(e)[:200]})
            log.warning(f'sync_partners[{id_manager}] cliente {r["id"]}: {e}')

        if solicitud_id and synced and synced % 25 == 0:
            _update_partners_sync_progress(solicitud_id, total, synced, errors)

    if solicitud_id:
        _mark_partners_sync_finished(solicitud_id, total, synced, errors)
    log.info(f'sync_partners[{id_manager}]: OK total={total} synced={synced} '
             f'errors={len(errors)}')
    return {'total': total, 'synced': synced, 'errors': errors}


def _mark_partners_sync_started(solicitud_id, total):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE odoo_solicitud_despliegue
               SET partners_sync_started_at = NOW(),
                   partners_total = %s,
                   partners_synced = 0,
                   partners_errors = '[]'::jsonb,
                   updated_at = NOW()
             WHERE id = %s
        """, (total, solicitud_id))


def _update_partners_sync_progress(solicitud_id, total, synced, errors):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE odoo_solicitud_despliegue
               SET partners_total = %s,
                   partners_synced = %s,
                   partners_errors = %s::jsonb,
                   updated_at = NOW()
             WHERE id = %s
        """, (total, synced,
              json.dumps(errors[-50:], ensure_ascii=False, default=str),
              solicitud_id))


def _mark_partners_sync_finished(solicitud_id, total, synced, errors):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE odoo_solicitud_despliegue
               SET partners_sync_finished_at = NOW(),
                   partners_total = %s,
                   partners_synced = %s,
                   partners_errors = %s::jsonb,
                   updated_at = NOW()
             WHERE id = %s
        """, (total, synced,
              json.dumps(errors[-100:], ensure_ascii=False, default=str),
              solicitud_id))


# ═══════════════════════════════════════════════════════════════════════════
# Rollback (best-effort) — solo aplicable al primer despliegue, NO
# a reactivaciones parciales (porque si Cuotas estaba activa y fallamos
# activando Contabilidad, no podemos archivar la company sin romper Cuotas).
# ═══════════════════════════════════════════════════════════════════════════

def rollback(partial):
    """Intenta deshacer la creación de la company (solo si es la primera vez
    que la creamos — si ya existía y fallamos en pasos posteriores, NO la
    archivamos).

    Devuelve dict con lo que se pudo hacer.
    """
    out = {'attempted': True}
    company_id = partial.get('company_id')
    if not company_id:
        return out
    oc = get_cuotas()
    try:
        oc._call('res.users', 'write', [ADMINROUND_UID],
                 {'company_ids': [(3, company_id)]})
        out['removed_adminround'] = True
    except Exception as e:
        out['removed_adminround'] = f'failed: {str(e)[:100]}'
    try:
        cmp = oc._call('res.company', 'read', [company_id], ['name'])[0]
        oc._call('res.company', 'write', [company_id], {
            'active': False,
            'name': f'ZZZ_ROLLBACK_{cmp["name"]}',
        })
        out['archived'] = True
    except Exception as e:
        out['archived'] = f'failed: {str(e)[:100]}'
    return out
