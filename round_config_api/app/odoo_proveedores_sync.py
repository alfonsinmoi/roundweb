"""Sincronización de facturas proveedor → Odoo (Fase 7, mayo 2026).

Reusa las reglas establecidas en el pipeline carajfam (memoria de proyecto):

  * Cuenta por defecto = 600000 (Compras de mercaderías). Otras válidas:
    622 reparaciones, 623 servicios profesionales, 625 seguros,
    626 servicios bancarios, 628 suministros, 629 otros servicios.
  * Total negativo → `move_type='in_refund'` (factura rectificativa);
    Odoo rechaza in_invoice con amount<0. Importes se ponen en valor
    absoluto y el signo lo da el move_type.
  * Partner: búsqueda por VAT (NIF/CIF/NIE). Si no existe se crea con
    `supplier_rank=1`, `company_type='company'`. Se reusa cross-company
    si ya está en otra company del mismo Odoo.
  * Move queda en `state='draft'` SIEMPRE. El admin valida manualmente
    (NO autopost). Igual que carajfam: drafts only.
  * PDF original (si se subió) se adjunta como ir.attachment vinculado al
    move para trazabilidad fiscal.
"""
import logging
import os
import base64
from decimal import Decimal
from .db import get_conn
from .odoo_cuotas import OdooCuotas

log = logging.getLogger(__name__)

# Cuentas válidas (PGC PYMES Spanish chart). Acepta cualquier prefijo 6xx
# pero estas son las "happy path" — el helper account_for resuelve por prefijo.
CUENTAS_VALIDAS_PREFIX = ('600', '602', '607',
                          '621', '622', '623', '624', '625', '626',
                          '627', '628', '629')


_purchase_tax_cache = {}


def _purchase_tax_for(o, company_id, iva_pct):
    """Busca tax de COMPRA (type_tax_use='purchase') sin price_include.
    Para facturas proveedor el precio_unit es BASE imponible y Odoo añade
    el IVA encima — NO usar el tax de venta price_include=True del TPV.

    Prefiere el tax 'NN% G' (G de mercaderías generales) sobre 'NN% S' o
    intracomunitarios. El plan l10n_es PYMES los crea por defecto.
    """
    key = (company_id, float(iva_pct))
    if key in _purchase_tax_cache:
        return _purchase_tax_cache[key]
    # Buscar todos los purchase del % indicado sin price_include
    ids = o._call('account.tax', 'search',
                  [('company_id', '=', company_id),
                   ('type_tax_use', '=', 'purchase'),
                   ('amount', '=', float(iva_pct)),
                   ('amount_type', '=', 'percent'),
                   ('price_include', '=', False)])
    if not ids:
        log.warning(f'No hay purchase tax {iva_pct}% en company {company_id}')
        return None
    # Preferir el que termina en " G" (mercaderías). Si no hay, el primero.
    names = o._call('account.tax', 'read', ids, ['name'])
    for n in names:
        nstr = n['name'] if isinstance(n['name'], str) else str(n['name'])
        if ' G' in nstr and 'EU' not in nstr:   # 21% G ≠ 21% EU G
            _purchase_tax_cache[key] = n['id']
            return n['id']
    _purchase_tax_cache[key] = ids[0]
    return ids[0]


def _partner_proveedor_for(o, company_id, nif, nombre, email=None):
    """Busca partner por VAT/NIF (campo `vat` en res.partner). Si no existe
    lo crea con supplier_rank=1. Reusa cross-company si ya está creado en
    otro company del mismo Odoo (ahorra duplicados).
    """
    nif = (nif or '').strip().upper()
    if not nif:
        raise ValueError('NIF obligatorio para crear/buscar proveedor')
    # 1) Por VAT en esta company
    ids = o._call('res.partner', 'search',
                  [('vat', '=', nif), ('company_id', '=', company_id)], limit=1)
    if ids:
        return ids[0]
    # 2) Por VAT cross-company (sin filtro de company)
    ids = o._call('res.partner', 'search', [('vat', '=', nif)], limit=1)
    if ids:
        # Reusamos pero verificamos que tiene supplier_rank
        try:
            o._call('res.partner', 'write', [ids[0]],
                    {'supplier_rank': 1})
        except Exception:
            pass
        return ids[0]
    # 3) Crear nuevo proveedor en esta company
    log.info(f'Creando proveedor en company {company_id}: {nombre} ({nif})')
    vals = {
        'name': nombre,
        'vat': nif,
        'supplier_rank': 1,
        'customer_rank': 0,
        'company_type': 'company',
        'company_id': company_id,
    }
    if email:
        vals['email'] = email
    return o._call('res.partner', 'create', vals)


def sync_factura_proveedor(id_manager, factura_id):
    """Crea (o reusa por idempotency ref) el account.move tipo in_invoice /
    in_refund en Odoo a partir de pos_factura_proveedor. Queda en DRAFT.

    Idempotency: usa `ref = f'PROV-{factura_id}-{numero_factura or ""}'`.
    Si el move ya existe, lo reusa.

    Returns dict con resultado tipo sync_venta:
      {ok, move_id, partner_id}  / {ok, already_synced}  /
      {ok, skipped, reason}      / {ok, busy}  / {ok:False, error}
    """
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT f.*, m.odoo_cuotas_enabled
                         FROM pos_factura_proveedor f
                    LEFT JOIN manager_config m ON m.id_manager = f.id_manager
                        WHERE f.id = %s AND f.id_manager = %s""",
                    (factura_id, str(id_manager)))
        f = cur.fetchone()
        if not f:
            return {'ok': False, 'error': 'factura_not_found'}
        if not f['odoo_cuotas_enabled']:
            cur.execute("""UPDATE pos_factura_proveedor
                              SET sync_status='skipped', sync_error='manager_sin_odoo',
                                  sync_attempted_at=NOW()
                            WHERE id=%s""", (factura_id,))
            conn.commit()
            return {'ok': True, 'skipped': True, 'reason': 'manager_sin_odoo'}
        if f['estado'] == 'anulada':
            return {'ok': False, 'error': 'factura_anulada'}
        if f['odoo_move_id']:
            return {'ok': True, 'already_synced': True,
                    'move_id': f['odoo_move_id']}

        # Lock optimista (mismo patrón Audit #7)
        cur.execute("""UPDATE pos_factura_proveedor
                          SET sync_status='syncing', sync_attempted_at=NOW()
                        WHERE id=%s AND id_manager=%s
                          AND (sync_status NOT IN ('syncing','synced')
                               OR (sync_status='syncing'
                                   AND sync_attempted_at < NOW() - INTERVAL '5 minutes'))
                       RETURNING id""",
                    (factura_id, str(id_manager)))
        if not cur.fetchone():
            conn.commit()
            return {'ok': True, 'busy': True}
        conn.commit()

    o = OdooCuotas(id_manager=id_manager)
    try:
        from .odoo_pos_sync import _account_for
        company_id = o.company_id
        partner_id = _partner_proveedor_for(o, company_id,
                                             f['proveedor_nif'],
                                             f['proveedor_nombre'],
                                             f.get('proveedor_email'))

        # Reglas carajfam: si total<0 → in_refund con valor absoluto
        total = Decimal(str(f['total']))
        es_refund = total < 0
        move_type = 'in_refund' if es_refund else 'in_invoice'

        # Idempotency search por ref
        ref = f'PROV-{factura_id}'
        if f.get('numero_factura'):
            ref += f'-{f["numero_factura"][:20]}'
        existing = o._call('account.move', 'search',
                           [('ref', '=', ref),
                            ('move_type', '=', move_type),
                            ('company_id', '=', company_id),
                            ('state', '!=', 'cancel')], limit=1)
        if existing:
            move_id = existing[0]
            log.info(f'sync factura_proveedor {factura_id}: reusando '
                     f'move existente {move_id}')
        else:
            iva_pct = float(f['iva_pct'] or 0)
            tax_id = _purchase_tax_for(o, company_id, iva_pct) if iva_pct > 0 else None
            account_id = _account_for(o, company_id, f['cuenta_contable'])
            if account_id is None:
                raise RuntimeError(
                    f"No existe la cuenta {f['cuenta_contable']} en company "
                    f"{company_id}. Verifica el plan de cuentas en Odoo.")

            # Una sola línea con base imponible (sin IVA) y el tax aparte
            # — NO usamos price_include aquí porque las facturas de proveedor
            # normalmente vienen ya desglosadas (base + IVA explícitos).
            base_abs = abs(float(f['base']))
            line_name = f['concepto'][:200]
            line = {
                'name': line_name,
                'quantity': 1.0,
                'price_unit': base_abs,
                'account_id': account_id,
            }
            if tax_id:
                line['tax_ids'] = [(6, 0, [tax_id])]
            move_vals = {
                'move_type': move_type,
                'partner_id': partner_id,
                'invoice_date': str(f['fecha'])[:10],
                'invoice_line_ids': [(0, 0, line)],
                'company_id': company_id,
                'ref': ref,
                'narration': (f'Factura proveedor TPV · {f["proveedor_nombre"]} '
                              + (f'· nº ext: {f["numero_factura"]} ' if f.get('numero_factura') else '')
                              + (f'\n{f["notas"]}' if f.get('notas') else '')),
            }
            # Nº externo del proveedor → invoice_origin (campo libre Odoo)
            if f.get('numero_factura'):
                move_vals['payment_reference'] = f['numero_factura'][:60]
            move_id = o._call('account.move', 'create', move_vals)
            # NO action_post — queda en DRAFT para validación manual
            # (regla carajfam: drafts only)
            log.info(f'sync factura_proveedor {factura_id}: creado move {move_id} '
                     f'tipo={move_type} draft')

        # Adjuntar PDF al move si está presente
        if f.get('pdf_url'):
            try:
                _attach_pdf(o, move_id, f['pdf_url'], f.get('numero_factura'))
            except Exception as e:
                log.warning(f'No se pudo adjuntar PDF: {e}')

        # Persistir IDs
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""UPDATE pos_factura_proveedor
                              SET odoo_move_id=%s, odoo_partner_id=%s,
                                  sync_status='synced', sync_error=NULL,
                                  estado='sincronizada',
                                  sync_attempted_at=NOW(), updated_at=NOW()
                            WHERE id=%s""",
                        (move_id, partner_id, factura_id))
            conn.commit()
        return {'ok': True, 'move_id': move_id, 'partner_id': partner_id,
                'move_type': move_type, 'draft': True}

    except Exception as e:
        log.exception(f'sync_factura_proveedor {factura_id}')
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""UPDATE pos_factura_proveedor
                              SET sync_status='error', sync_error=%s,
                                  sync_attempted_at=NOW()
                            WHERE id=%s""",
                        (str(e)[:500], factura_id))
            conn.commit()
        return {'ok': False, 'error': str(e)}


def _attach_pdf(o, move_id, pdf_url, numero_factura=None):
    """Crea ir.attachment vinculado al account.move con el PDF en base64.
    pdf_url es relativo: '/uploads/pos/<manager>/<uuid>.pdf'

    Sprint 3b — idempotente: busca ir.attachment con res_model+res_id+name
    antes de crear. Si ya existe, no duplica. Permite reintentar la sync
    sin generar attachments huérfanos en cada intento.
    """
    # Convertir URL relativa a path filesystem
    if not pdf_url.startswith('/uploads/'):
        log.warning(f'pdf_url no es local: {pdf_url}')
        return
    # Anti path-traversal defensivo: bloquear '..' aunque ya pasó por upload
    if '..' in pdf_url or pdf_url.startswith('/uploads/..'):
        log.warning(f'pdf_url con path traversal: {pdf_url}')
        return
    fs_path = '/var/www/round' + pdf_url
    # Verificar que el path real queda bajo /var/www/round/uploads/
    try:
        real = os.path.realpath(fs_path)
        if not real.startswith('/var/www/round/uploads/'):
            log.warning(f'pdf_url escapa de uploads/: {real}')
            return
    except Exception:
        return
    if not os.path.isfile(fs_path):
        log.warning(f'PDF no existe: {fs_path}')
        return

    fname = numero_factura or os.path.basename(pdf_url)
    if not fname.lower().endswith('.pdf'):
        fname += '.pdf'
    att_name = f'Factura {fname}'

    # IDEMPOTENCY: si ya hay attachment con mismo nombre vinculado a este
    # move, no creamos otro. Cubre el caso de retry tras error post-attach.
    existing = o._call('ir.attachment', 'search',
                       [('res_model', '=', 'account.move'),
                        ('res_id', '=', move_id),
                        ('name', '=', att_name)], limit=1)
    if existing:
        log.info(f'_attach_pdf move={move_id}: attachment "{att_name}" '
                 f'ya existe ({existing[0]}) — no duplica')
        return existing[0]

    with open(fs_path, 'rb') as fh:
        data = fh.read()
    att_id = o._call('ir.attachment', 'create', {
        'name': att_name,
        'datas': base64.b64encode(data).decode('ascii'),
        'res_model': 'account.move',
        'res_id': move_id,
        'mimetype': 'application/pdf',
    })
    return att_id


def revertir_factura_proveedor(id_manager, factura_id, motivo=''):
    """Crea una factura rectificativa (in_refund) con `reversed_entry_id`
    apuntando al move original, en lugar de cancelar el invoice (que
    desreconcilia y rompe SII).

    Sprint 1 fix #1 (audit prof. mayo 2026):
      * Si el invoice original está DRAFT → button_cancel directo (no se
        ha presentado a SII todavía, lo que se cancela aquí no ha
        existido fiscalmente).
      * Si está POSTED → crear in_refund con reversed_entry_id, líneas
        copiadas del original, queda en DRAFT esperando validación admin
        (regla carajfam: drafts only para proveedores).

    Idempotente: search por ref='REV-PROV-{factura_id}' antes de crear.
    """
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT * FROM pos_factura_proveedor
                        WHERE id=%s AND id_manager=%s""",
                    (factura_id, str(id_manager)))
        f = cur.fetchone()
    if not f:
        return {'ok': False, 'error': 'factura_not_found'}
    if not f.get('odoo_move_id'):
        return {'ok': True, 'sin_odoo': True}

    o = OdooCuotas(id_manager=id_manager)
    company_id = o.company_id
    move_id = f['odoo_move_id']

    try:
        # Leer estado del invoice original
        inv = o._call('account.move', 'read', [move_id],
                      ['state', 'move_type', 'partner_id'])
        if not inv:
            log.warning(f'revertir_factura_proveedor {factura_id}: '
                        f'move {move_id} no existe en Odoo')
            return {'ok': True, 'move_borrado': True}
        state = inv[0]['state']
        original_move_type = inv[0]['move_type']

        # Caso 1: DRAFT → simplemente cancelar. No hay rectificativa que crear
        # porque la factura nunca llegó a postear (no entró a SII).
        if state == 'draft':
            # Sprint 5 #4 — limpiar ir.attachment vinculados al move antes
            # de cancelar. El _attach_pdf es idempotente al crear, pero los
            # PDF adjuntos quedan huérfanos en Odoo tras cancelaciones
            # repetidas si no se purgan.
            try:
                att_ids = o._call('ir.attachment', 'search',
                                  [('res_model', '=', 'account.move'),
                                   ('res_id', '=', move_id)])
                if att_ids:
                    o._call('ir.attachment', 'unlink', [att_ids])
                    log.info(f'revertir_factura_proveedor {factura_id}: '
                             f'eliminados {len(att_ids)} ir.attachment '
                             f'del move draft {move_id}')
            except Exception as e:
                log.warning(f'unlink attachments move {move_id}: {e}')
            o._call('account.move', 'button_cancel', [move_id])
            log.info(f'revertir_factura_proveedor {factura_id}: '
                     f'move {move_id} estaba draft, cancelado')
            return {'ok': True, 'cancelled_draft': True, 'move_id': move_id}

        # Caso 2: CANCEL (ya cancelado) — no-op
        if state == 'cancel':
            return {'ok': True, 'ya_cancelado': True, 'move_id': move_id}

        # Caso 3: POSTED → rectificativa con reversed_entry_id
        # Idempotency
        refund_ref = f'REV-PROV-{factura_id}'
        existing = o._call('account.move', 'search',
                           [('ref', '=', refund_ref),
                            ('company_id', '=', company_id),
                            ('state', '!=', 'cancel')], limit=1)
        if existing:
            log.info(f'revertir_factura_proveedor {factura_id}: '
                     f'rectificativa ya existe {existing[0]}')
            return {'ok': True, 'already_reverted': True,
                    'refund_id': existing[0]}

        # Tipo opuesto: in_invoice → in_refund; in_refund → in_invoice
        # (rectificativa de rectificativa = factura positiva del proveedor)
        refund_move_type = ('in_refund' if original_move_type == 'in_invoice'
                            else 'in_invoice')

        # Copiar líneas del original (excluyendo tax/payment_term)
        lines_data = o._call('account.move.line', 'search_read',
                             [('move_id', '=', move_id),
                              ('display_type', 'not in',
                               ['tax', 'payment_term', 'line_section', 'line_note'])],
                             ['name', 'quantity', 'price_unit', 'tax_ids',
                              'account_id'])
        refund_lines = []
        for l in lines_data:
            tax_ids = list(l.get('tax_ids') or [])
            refund_lines.append((0, 0, {
                'name': f'[REV] {l["name"][:180]}',
                'quantity': l['quantity'],
                'price_unit': l['price_unit'],
                'tax_ids': [(6, 0, tax_ids)],
                'account_id': (l['account_id'][0] if isinstance(l['account_id'], list)
                               else l['account_id']),
            }))

        refund_id = o._call('account.move', 'create', {
            'move_type': refund_move_type,
            'partner_id': (inv[0]['partner_id'][0] if isinstance(inv[0]['partner_id'], list)
                           else inv[0]['partner_id']),
            'invoice_date': str(f['fecha'])[:10],
            'invoice_line_ids': refund_lines,
            'company_id': company_id,
            'ref': refund_ref,
            'narration': f'Rectificativa factura proveedor {f["proveedor_nombre"]}'
                         + (f' (orig nº {f["numero_factura"]})' if f.get('numero_factura') else '')
                         + (f' · motivo: {motivo}' if motivo else ''),
            'reversed_entry_id': move_id,
        })
        # NO action_post — queda DRAFT (regla carajfam: validación humana)
        log.info(f'revertir_factura_proveedor {factura_id}: rectificativa '
                 f'{refund_id} creada DRAFT (reversed_entry_id={move_id})')

        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""UPDATE pos_factura_proveedor
                              SET sync_error=NULL, sync_attempted_at=NOW(),
                                  notas = COALESCE(notas,'') ||
                                          E'\n[RECTIFICATIVA] move ' || %s
                            WHERE id=%s""",
                        (str(refund_id), factura_id))
            conn.commit()
        return {'ok': True, 'refund_id': refund_id, 'move_type': refund_move_type,
                'draft': True}

    except Exception as e:
        log.exception(f'revertir_factura_proveedor {factura_id}')
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""UPDATE pos_factura_proveedor
                              SET sync_error=%s, sync_attempted_at=NOW()
                            WHERE id=%s""",
                        (f'revert_proveedor_failed: {str(e)[:400]}', factura_id))
            conn.commit()
        return {'ok': False, 'error': str(e)}


def sync_async_factura(id_manager, factura_id):
    """Lanza la sync en thread daemon (no bloquea la respuesta)."""
    import threading
    def _bg():
        try:
            sync_factura_proveedor(id_manager, factura_id)
        except Exception:
            log.exception(f'sync_async_factura {factura_id}')
    t = threading.Thread(target=_bg, daemon=True,
                         name=f'pos-fact-prov-{factura_id}')
    t.start()
    return True
