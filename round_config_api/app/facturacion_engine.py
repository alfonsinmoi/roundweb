"""Motor de facturación Round (2 sistemas, SIEMPRE partner por cliente).

GATED: solo actúa si `facturacion_config.activo=true`. Si no, no hace nada →
el flujo de facturación actual (preemision_v2/facturacion_trimestre) queda
intacto. NO toca esos módulos.

Modelo (definitivo, simplificado):
- 2 sistemas: 'inmediata' (cada cobro/devolución/recobro → factura) y
  'fin_de_mes' (relación seleccionable → factura por cliente).
- SIEMPRE `out_invoice` con partner = cliente; cuenta a cobrar = 430XXX de su
  trainer (el cliente es tercero dentro; la 430XXX se asigna al partner en la
  provisión, no aquí); IVA de la cuota; analítica del trainer.
- Draft-first: crea el asiento en BORRADOR y valida antes de postear.
- Idempotente por `ref`: reintentos no duplican.
"""
import logging
import datetime as dt

from .db import get_conn
from .odoo_alta import OdooAlta
from . import odoo_facturacion as F

log = logging.getLogger(__name__)


def config_activa(id_manager):
    """Devuelve dict {sistema, activo} o None. El motor solo opera si activo."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT sistema, activo FROM facturacion_config
                        WHERE id_manager=%s ORDER BY id LIMIT 1""", (str(id_manager),))
        return cur.fetchone()


def _trainer_cfg(id_manager, id_trainer):
    """Config de facturación del trainer (430 sufijo + serie)."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT ft.cuenta_430_sufijo, ft.serie_id,
                   fs.clave AS serie_clave, fs.prefijo AS serie_prefijo
              FROM facturacion_trainer ft
              LEFT JOIN facturacion_serie fs ON fs.id = ft.serie_id
             WHERE ft.id_manager=%s AND ft.id_trainer=%s
        """, (str(id_manager), str(id_trainer)))
        return cur.fetchone()


def _iva_pct_de_cuota(id_manager, cuota_codigo, id_trainer):
    """% de IVA de la cuota (vía cuota.tipo_iva_id → facturacion_tipo_iva).
    Por defecto 21 si no hay tipo asignado."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT ti.pct
              FROM cuota c
              JOIN facturacion_tipo_iva ti ON ti.id = c.tipo_iva_id
             WHERE c.id_manager=%s AND c.codigo=%s AND c.id_trainer=%s
             LIMIT 1
        """, (str(id_manager), cuota_codigo, str(id_trainer)))
        r = cur.fetchone()
    return float(r['pct']) if r and r.get('pct') is not None else 21.0


def _crear_factura_cliente(oc, id_manager, cliente_idnoofit, id_trainer,
                           lineas, ref, fecha=None, postear=False):
    """Crea (o reutiliza por `ref`) una out_invoice DRAFT para el cliente.

    lineas = [{concepto, base, iva_pct}]. Devuelve dict {ok, move_id, ...}.
    Draft-first: por defecto NO postea (postear=False) — se valida antes.
    """
    fecha = fecha or dt.date.today().isoformat()
    company_id = oc.resolve_company(id_manager, id_trainer)
    oc._require_company(company_id)

    # Partner del cliente (1 idnoofit = 1 partner global, B2)
    pids = oc._call('res.partner', 'search', [('id_noofit', '=', str(cliente_idnoofit))], limit=1)
    if not pids:
        return {'ok': False, 'error': f'partner_no_encontrado_{cliente_idnoofit}'}
    pid = pids[0]

    # Idempotencia por ref
    ex = oc._call('account.move', 'search',
                  [('ref', '=', ref), ('company_id', '=', company_id), ('state', '!=', 'cancel')], limit=1)
    if ex:
        return {'ok': True, 'move_id': ex[0], 'reused': True}

    analytic_id = oc._resolve_analytic_for_partner(pid)
    sale_ids = oc._call('account.journal', 'search',
                        [('company_id', '=', company_id), ('type', '=', 'sale')], limit=1)
    if not sale_ids:
        return {'ok': False, 'error': 'sin_journal_venta'}

    line_ids = []
    for ln in lineas:
        tax_id = F.ensure_iva_tax(oc, company_id, ln.get('iva_pct', 21))
        line = {
            'name': ln.get('concepto') or 'Cuota',
            'quantity': 1,
            'price_unit': float(ln['base']),
            'tax_ids': [(6, 0, [tax_id])],
        }
        if analytic_id:
            line['analytic_distribution'] = {str(analytic_id): 100.0}
        line_ids.append((0, 0, line))

    vals = {
        'partner_id': pid,
        'move_type': 'out_invoice',
        'invoice_date': str(fecha)[:10],
        'company_id': company_id,
        'journal_id': sale_ids[0],
        'ref': ref,
        'invoice_line_ids': line_ids,
    }
    move_id = oc._call('account.move', 'create', vals)

    # Validación draft-first: releer importes antes de (opcionalmente) postear
    mv = oc._call('account.move', 'read', [move_id], ['amount_total', 'state', 'partner_id'])[0]
    if not mv.get('amount_total') or mv['amount_total'] <= 0:
        log.warning(f'_crear_factura_cliente: move {move_id} importe<=0 (ref={ref}); queda draft')
        return {'ok': True, 'move_id': move_id, 'state': mv['state'], 'aviso': 'importe_cero'}

    if postear:
        st = (oc._call('account.move', 'read', [move_id], ['state']) or [{}])[0].get('state')
        if st != 'posted':
            oc._call('account.move', 'action_post', [move_id])
            st = (oc._call('account.move', 'read', [move_id], ['state']) or [{}])[0].get('state')
        return {'ok': st == 'posted', 'move_id': move_id, 'state': st}

    return {'ok': True, 'move_id': move_id, 'state': mv['state']}


# ─────────────────────────── Entradas del motor ──────────────────────────
def facturar_inmediata(id_manager, cliente_idnoofit, id_trainer, lineas, mov_ref, postear=True):
    """Sistema INMEDIATO: una factura por cada cobro/devolución/recobro.
    Gated: no hace nada si el manager no tiene sistema='inmediata' activo."""
    cfg = config_activa(id_manager)
    if not (cfg and cfg.get('activo') and cfg.get('sistema') == 'inmediata'):
        return {'ok': False, 'skipped': 'no_activo_o_no_inmediata'}
    oc = OdooAlta(id_manager=str(id_manager)); oc._connect()
    ref = f'FACT-INM-{mov_ref}-{cliente_idnoofit}'
    return _crear_factura_cliente(oc, id_manager, cliente_idnoofit, id_trainer,
                                  lineas, ref, postear=postear)


def facturar_mes(id_manager, periodo, items, postear=False):
    """Sistema FIN DE MES: genera una factura por cliente con las líneas
    seleccionadas. `items` = [{cliente_idnoofit, id_trainer, lineas:[...]}].
    Gated: requiere sistema='fin_de_mes' activo. Draft-first por defecto."""
    cfg = config_activa(id_manager)
    if not (cfg and cfg.get('activo') and cfg.get('sistema') == 'fin_de_mes'):
        return {'ok': False, 'skipped': 'no_activo_o_no_fin_de_mes'}
    oc = OdooAlta(id_manager=str(id_manager)); oc._connect()
    creadas, errores = [], []
    for it in items:
        ref = f'FACT-MES-{periodo}-{it["cliente_idnoofit"]}'
        r = _crear_factura_cliente(oc, id_manager, it['cliente_idnoofit'],
                                   it['id_trainer'], it['lineas'], ref,
                                   fecha=f'{periodo}-01', postear=postear)
        (creadas if r.get('ok') else errores).append({**r, 'cliente': it['cliente_idnoofit']})
    return {'ok': True, 'creadas': len(creadas), 'errores': len(errores),
            'detalle_errores': errores}
