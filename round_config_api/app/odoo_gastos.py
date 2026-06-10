"""Integración Odoo para gastos / facturas de proveedor.

Cuando el manager valida un `gasto_documento` en Round, llamamos a
`crear_factura_proveedor()` que:
  1. Resuelve el partner (proveedor) por VAT, name o crea si no existe.
  2. Resuelve la `account_id` (cuenta contable) por code.
  3. Resuelve la `tax_id` (IVA soportado) por porcentaje.
  4. Crea `account.move` move_type='in_invoice' como DRAFT (sin postear).
     El user revisará en Odoo y posteará cuando esté conforme — más seguro
     que postear automáticamente cuando estamos dependiendo del LLM.
  5. Devuelve {move_id, partner_id, state, …}.

Defensive: si cualquier lookup falla, el doc se queda validado en Round y
guarda el error en `gasto_documento.notas` o un campo dedicado.
"""
import logging
from . import config as cfg
from .odoo_cuotas import get_cuotas

log = logging.getLogger(__name__)


def _normalizar_vat(vat):
    if not vat:
        return None
    s = str(vat).strip().upper().replace(' ', '').replace('-', '').replace('.', '')
    return s or None


def _find_or_create_supplier(oc, nombre, vat):
    """Busca un proveedor por VAT o name. Si no existe lo crea como
    res.partner con company_type='company' y supplier_rank=1.
    """
    vat_n = _normalizar_vat(vat)
    partner_id = None
    # CRÍTICO multi-company: buscar proveedor scoped a la company del manager.
    # Si no, dos managers que compartan VAT del mismo proveedor (típico:
    # luz, telefonía nacional) cogerían el partner del primero.
    if vat_n:
        ids = oc._call_scoped('res.partner', 'search', [('vat','=',vat_n)], limit=1)
        if ids: partner_id = ids[0]
    if not partner_id and nombre:
        ids = oc._call_scoped('res.partner', 'search',
                       [('name','=ilike',nombre.strip()),('is_company','=',True)],
                       limit=1)
        if ids: partner_id = ids[0]
    if partner_id:
        # Asegurar supplier_rank >= 1
        try:
            p = oc._call('res.partner', 'read', [partner_id],
                         ['supplier_rank', 'company_type'])[0]
            if (p.get('supplier_rank') or 0) < 1 or p.get('company_type') != 'company':
                upd = {}
                if (p.get('supplier_rank') or 0) < 1: upd['supplier_rank'] = 1
                if p.get('company_type') != 'company': upd['company_type'] = 'company'
                if upd: oc._call('res.partner', 'write', [partner_id], upd)
        except Exception:
            pass
        return partner_id

    vals = {
        'name': (nombre or '').strip() or 'Proveedor (sin nombre)',
        'is_company': True,
        'company_type': 'company',
        'supplier_rank': 1,
        'company_id': oc.company_id,   # multi-company: amarrar a la del manager
    }
    if vat_n:
        vals['vat'] = vat_n
    partner_id = oc._call('res.partner', 'create', vals)
    log.info(f'Proveedor Odoo creado id={partner_id} name={nombre} vat={vat_n}')
    return partner_id


def _find_account_by_code(oc, code):
    """Devuelve account.account.id cuyo code = X (o startswith). None si no existe."""
    if not code:
        return None
    code = str(code).strip()
    # 1) match exacto
    ids = oc._call('account.account', 'search',
                   [('code','=', code), ('company_id','=', oc.company_id)],
                   limit=1)
    if ids: return ids[0]
    # 2) startswith (cuando viene 6 cifras y la cuenta es de 4)
    ids = oc._call('account.account', 'search',
                   [('code','=like', f'{code}%'), ('company_id','=', oc.company_id)],
                   limit=1)
    if ids: return ids[0]
    # 3) buscar la 4-prefijo (ej. 6280 si nos pasaron 628000)
    if len(code) >= 4:
        ids = oc._call('account.account', 'search',
                       [('code','=like', f'{code[:4]}%'), ('company_id','=', oc.company_id)],
                       limit=1)
        if ids: return ids[0]
    return None


def _find_purchase_tax(oc, iva_pct):
    """Devuelve account.tax.id de IVA soportado al porcentaje X.

    Busca un type_tax_use='purchase' con amount==X y company_id==COMPANY.
    """
    if iva_pct is None:
        return None
    try:
        amt = float(iva_pct)
    except Exception:
        return None
    ids = oc._call('account.tax', 'search', [
        ('type_tax_use','=','purchase'),
        ('amount','=', amt),
        ('company_id','=', oc.company_id),
        ('active','=', True),
    ], limit=1)
    if ids: return ids[0]
    # Si amount=0, tolerar exento
    if amt == 0:
        return None
    return None


def crear_factura_proveedor(doc: dict, post: bool = False) -> dict:
    """Crea account.move (in_invoice) para un gasto_documento validado.

    `doc` es el row de gasto_documento + opcionalmente la categoría unida.
    Devuelve {ok, move_id, partner_id, state, error?}.

    Si `post=True`, también postea la factura. Default False (queda como draft
    para revisión humana en Odoo).
    """
    try:
        # Instancia ligada al manager del documento (gasto_documento.id_manager)
        # — con la default, el gasto se contabilizaría en la company de Round.
        oc = get_cuotas(doc.get('id_manager'))
        # 1. Partner
        partner_id = _find_or_create_supplier(oc,
                                              doc.get('proveedor') or '',
                                              doc.get('proveedor_vat'))
        # 2. Cuenta contable (a partir de la categoría)
        cuenta_code = doc.get('cuenta_contable_odoo')
        account_id = _find_account_by_code(oc, cuenta_code) if cuenta_code else None
        # 3. Tax
        tax_id = _find_purchase_tax(oc, doc.get('iva_pct'))

        # 4. Construir línea
        importe_base = float(doc.get('importe_base') or 0)
        importe_total = float(doc.get('importe_total') or 0)
        # Si solo tenemos total, usarlo como base sin tax
        line_price = importe_base if importe_base > 0 else importe_total

        line_vals = {
            'name': (doc.get('concepto') or '')[:200] or doc.get('proveedor') or 'Gasto',
            'quantity': 1,
            'price_unit': line_price,
        }
        if account_id:
            line_vals['account_id'] = account_id
        if tax_id:
            line_vals['tax_ids'] = [(6, 0, [tax_id])]
        else:
            line_vals['tax_ids'] = [(6, 0, [])]   # sin impuestos

        # 5. account.move
        # invoice_date debe ser string ISO; XML-RPC no acepta datetime.date.
        fecha = doc.get('fecha_documento')
        try:
            from datetime import date, datetime as _dt
            if isinstance(fecha, (date, _dt)):
                fecha = fecha.strftime('%Y-%m-%d')
        except Exception:
            pass
        move_vals = {
            'move_type': 'in_invoice',
            'partner_id': partner_id,
            'invoice_date': fecha or False,
            'company_id': oc.company_id,
            'invoice_line_ids': [(0, 0, line_vals)],
        }
        if doc.get('num_factura'):
            move_vals['ref'] = str(doc['num_factura'])[:64]
        if doc.get('concepto'):
            move_vals['narration'] = doc['concepto']

        move_id = oc._call('account.move', 'create', move_vals)
        state = 'draft'

        if post:
            try:
                oc._call('account.move', 'action_post', [move_id])
                state = 'posted'
            except Exception as e:
                log.warning(f'action_post falló move={move_id}: {e}')

        log.info(f'gasto_documento → account.move id={move_id} state={state} '
                 f'partner={partner_id} account={account_id} tax={tax_id} '
                 f'amount={line_price}')

        return {
            'ok': True,
            'move_id': move_id,
            'partner_id': partner_id,
            'account_id': account_id,
            'tax_id': tax_id,
            'state': state,
        }
    except Exception as e:
        log.exception('crear_factura_proveedor')
        return {'ok': False, 'error': str(e)[:500]}
