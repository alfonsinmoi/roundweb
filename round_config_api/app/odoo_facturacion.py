"""Helpers Odoo (XML-RPC) para materializar la estructura de facturación Round
desde la config de `facturacion_*` (punto 3 lado Odoo).

Todo IDEMPOTENTE (ensure_*): se puede llamar N veces sin duplicar. Se invoca
SOLO cuando el manager configura/activa (gate `facturacion_config.activo`); no
toca nada del flujo actual.

Modelo:
- Cuenta 430XXX por trainer (`account.account`, código `430`+sufijo a 3 díg.,
  tipo cobrar). El cliente es TERCERO dentro de ella (su
  `property_account_receivable_id` apunta al 430XXX de su trainer).
- Serie de numeración por `ir.sequence` (compartible entre trainers).
- Tipo de IVA → `account.tax` de venta con ese %.

`oc` = instancia OdooCuotas/OdooAlta conectada (lleva company del manager, B1).
"""
import logging

log = logging.getLogger(__name__)


def cuenta_430_code(sufijo):
    """430 + sufijo a 3 dígitos (1..999) → '430001'..'430999'."""
    s = int(sufijo)
    if not (1 <= s <= 999):
        raise ValueError(f'sufijo 430 fuera de rango: {sufijo}')
    return f'430{s:03d}'


def ensure_cuenta_430(oc, company_id, sufijo, nombre):
    """Crea (o reutiliza) la cuenta 430XXX del trainer en la company. Devuelve id.
    Idempotente: busca por (code, company_id)."""
    code = cuenta_430_code(sufijo)
    ids = oc._call('account.account', 'search',
                   [('code', '=', code), ('company_id', '=', company_id)], limit=1)
    if ids:
        return ids[0]
    vals = {
        'code': code,
        'name': nombre or f'Clientes {code}',
        'account_type': 'asset_receivable',   # cuenta a cobrar (Odoo 17)
        'reconcile': True,
        'company_id': company_id,
    }
    aid = oc._call('account.account', 'create', vals)
    log.info(f'ensure_cuenta_430: creada {code} id={aid} company={company_id}')
    return aid


def ensure_serie_sequence(oc, company_id, id_manager, clave, prefijo=None, padding=4):
    """Crea (o reutiliza) la ir.sequence de una serie. Compartible entre
    trainers (la serie es del manager). Devuelve id. Idempotente por code."""
    code = f'round.fact.serie.{id_manager}.{clave}'
    ids = oc._call('ir.sequence', 'search',
                   [('code', '=', code), ('company_id', '=', company_id)], limit=1)
    if ids:
        return ids[0]
    vals = {
        'name': f'Round serie {clave}',
        'code': code,
        'prefix': (prefijo or False),
        'padding': padding,
        'number_next': 1,
        'number_increment': 1,
        'implementation': 'standard',
        'company_id': company_id,
    }
    sid = oc._call('ir.sequence', 'create', vals)
    log.info(f'ensure_serie_sequence: creada {code} id={sid}')
    return sid


def ensure_iva_tax(oc, company_id, pct):
    """Devuelve el id de un account.tax de VENTA con ese %. Reutiliza el que
    exista; si no, lo crea (sin price_include: el IVA va sobre la base).
    Idempotente."""
    pct = float(pct)
    ids = oc._call('account.tax', 'search',
                   [('company_id', '=', company_id), ('amount', '=', pct),
                    ('type_tax_use', '=', 'sale'), ('price_include', '=', False)], limit=1)
    if ids:
        return ids[0]
    vals = {
        'name': f'IVA {pct:g}% (venta)',
        'amount': pct,
        'amount_type': 'percent',
        'type_tax_use': 'sale',
        'price_include': False,
        'company_id': company_id,
    }
    tid = oc._call('account.tax', 'create', vals)
    log.info(f'ensure_iva_tax: creado IVA {pct}% id={tid} company={company_id}')
    return tid


def set_partner_receivable(oc, partner_id, account_id):
    """Asigna la cuenta a cobrar (430XXX del trainer) al partner del cliente.
    Solo se llama al provisionar/configurar (cambia la contabilidad futura del
    cliente). Idempotente (no escribe si ya está)."""
    cur = oc._call('res.partner', 'read', [partner_id], ['property_account_receivable_id'])
    actual = (cur[0].get('property_account_receivable_id') if cur else None)
    actual_id = actual[0] if isinstance(actual, (list, tuple)) else actual
    if actual_id == account_id:
        return False
    oc._call('res.partner', 'write', [partner_id],
             {'property_account_receivable_id': account_id})
    return True
