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


def ensure_serie_journal(oc, company_id, id_manager, clave, prefijo=None):
    """Crea (o reutiliza) un journal de VENTA por serie. En Odoo 17 el nº de
    factura lo da el journal → una serie = un journal (compartible entre
    trainers; la analítica los distingue). Idempotente por code.

    El `code` del journal es corto (máx 5 en Odoo); usamos un derivado estable
    de la clave. El prefijo de numeración se aplica al postear la 1ª factura
    (engine), aquí solo garantizamos el journal."""
    code = (clave or 'FACT')[:5].upper()
    ids = oc._call('account.journal', 'search',
                   [('company_id', '=', company_id), ('type', '=', 'sale'),
                    ('code', '=', code)], limit=1)
    if ids:
        return ids[0]
    vals = {
        'name': f'Ventas serie {clave}',
        'code': code,
        'type': 'sale',
        'company_id': company_id,
    }
    jid = oc._call('account.journal', 'create', vals)
    log.info(f'ensure_serie_journal: creado journal {code} id={jid} company={company_id}')
    return jid


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


def provision_estructura(id_manager):
    """Materializa en Odoo la estructura de facturación desde la config del
    manager: 430XXX por trainer + journal por serie. IDEMPOTENTE. NO toca
    partners (la asignación de receivable es un paso aparte/explícito).
    Devuelve un report con lo creado/reusado."""
    from .db import get_conn
    from .odoo_alta import OdooAlta
    oc = OdooAlta(id_manager=str(id_manager)); oc._connect()
    report = {'cuentas': [], 'journals': [], 'errores': []}
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT ft.id_trainer, ft.cuenta_430_sufijo,
                   fs.clave AS serie_clave, fs.prefijo AS serie_prefijo
              FROM facturacion_trainer ft
              LEFT JOIN facturacion_serie fs ON fs.id = ft.serie_id
             WHERE ft.id_manager=%s
        """, (str(id_manager),))
        rows = cur.fetchall()
    for r in rows:
        comp = oc.resolve_company(id_manager, r['id_trainer'])
        if not comp:
            report['errores'].append({'trainer': r['id_trainer'], 'error': 'sin_company'})
            continue
        try:
            if r.get('cuenta_430_sufijo'):
                aid = ensure_cuenta_430(oc, comp, r['cuenta_430_sufijo'],
                                        f'Clientes trainer {r["id_trainer"]}')
                report['cuentas'].append({'trainer': r['id_trainer'],
                                          'cuenta': cuenta_430_code(r['cuenta_430_sufijo']),
                                          'id': aid})
            if r.get('serie_clave'):
                jid = ensure_serie_journal(oc, comp, id_manager,
                                           r['serie_clave'], r.get('serie_prefijo'))
                report['journals'].append({'serie': r['serie_clave'], 'journal_id': jid})
        except Exception as e:
            report['errores'].append({'trainer': r['id_trainer'], 'error': str(e)[:150]})
    return report
