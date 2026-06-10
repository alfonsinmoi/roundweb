"""Backfill A3 — crea la fila `recibo` (round_config) para cada account.move de
ALTA (narration 'Alta cliente%') que NO tiene recibo BD ("huérfano").

Mismo esquema que el keystone `OdooAlta._crear_recibo_bd_alta`:
  origen='alta_cliente', origen_ref=str(sub_id), estado pagado|emitido,
  account_move_id enlazado. Idempotente (salta los que ya tienen recibo, por
  account_move_id o por (id_manager,origen,origen_ref)).

Uso:
  DRY-RUN:  python3 scripts/backfill_recibos_alta.py
  APLICAR:  CONFIRM=1 python3 scripts/backfill_recibos_alta.py
"""
import os, sys
sys.path.insert(0, '/opt/round_config_api')
from datetime import date
from app.odoo_alta import OdooAlta
from app.db import get_conn

COMPANY_ID = int(os.getenv('ODOO_COMPANY', '3'))
ID_MANAGER = os.getenv('ID_MANAGER', '17675')   # tenant Round
CONFIRM = os.getenv('CONFIRM') == '1'

METODO_DEFAULT = 'caja_efectivo'   # altas migradas sin forma_pago conocida

oa = OdooAlta(); oa._connect()
oa._id_manager = ID_MANAGER       # para _id_trainer_de_idnoofit
print(f'Odoo uid={oa._uid}  company={COMPANY_ID}  id_manager={ID_MANAGER}')

# 1) Moves de alta posteados
moves = oa._call('account.move', 'search_read',
    [('move_type', '=', 'out_invoice'), ('company_id', '=', COMPANY_ID),
     ('narration', 'like', 'Alta cliente%'), ('state', '=', 'posted')],
    ['id', 'name', 'round_subscription_id', 'partner_id', 'payment_state',
     'amount_total', 'amount_untaxed', 'amount_tax', 'invoice_date'])
print(f'Moves de alta posteados: {len(moves)}')

# 2) account_move_id ya con recibo BD (idempotencia)
with get_conn() as conn, conn.cursor() as cur:
    cur.execute("SELECT account_move_id FROM recibo WHERE account_move_id IS NOT NULL")
    ya_amove = {r['account_move_id'] for r in cur.fetchall()}
    cur.execute("""SELECT origen_ref FROM recibo
                    WHERE id_manager=%s AND origen='alta_cliente'""", (ID_MANAGER,))
    ya_origen = {r['origen_ref'] for r in cur.fetchall()}

to_create = []
for m in moves:
    if m['id'] in ya_amove:
        continue
    sub = m.get('round_subscription_id')
    sub_id = sub[0] if isinstance(sub, (list, tuple)) else sub
    if sub_id and str(sub_id) in ya_origen:
        continue
    # idnoofit del partner
    pid = m['partner_id'][0] if isinstance(m['partner_id'], (list, tuple)) else m['partner_id']
    pinfo = oa._call('res.partner', 'read', [pid], ['id_noofit', 'name'])[0]
    idnoofit = str(pinfo.get('id_noofit') or '') or ''
    # cuota (display name de la sub)
    cuota_codigo = None
    if sub_id:
        srow = oa._call('round.subscription', 'read', [sub_id], ['cuota_id'])
        cu = (srow[0] if srow else {}).get('cuota_id')
        cuota_codigo = cu[1] if isinstance(cu, (list, tuple)) and len(cu) > 1 else None
    # trainer real del cliente
    id_trainer = oa._id_trainer_de_idnoofit(idnoofit) if idnoofit else None

    base = float(m.get('amount_untaxed') or 0)
    iva = float(m.get('amount_tax') or 0)
    total = float(m.get('amount_total') or 0)
    iva_pct = round(iva / base * 100, 2) if base else 21.00
    inv_date = str(m.get('invoice_date') or date.today())
    pagado = m.get('payment_state') in ('paid', 'in_payment')
    estado = 'pagado' if pagado else 'emitido'

    to_create.append({
        'id_manager': ID_MANAGER,
        'id_trainer': str(id_trainer) if id_trainer else None,
        'cliente_idnoofit': idnoofit,
        'cliente_nombre': pinfo.get('name'),
        'cuota_id': None, 'cuota_codigo': cuota_codigo,
        'cuota_descripcion': cuota_codigo,
        'periodo': inv_date[:7],
        'fecha_desde': inv_date, 'fecha_hasta': None, 'periodicidad': None,
        'importe_base': base, 'importe_iva': iva, 'importe_total': total,
        'iva_pct': iva_pct,
        'metodo_pago': METODO_DEFAULT, 'estado': estado,
        'fecha_emision': inv_date,
        'fecha_pago': inv_date if pagado else None,
        'account_move_id': m['id'], 'account_move_ref': m.get('name'),
        'origen': 'alta_cliente', 'origen_ref': str(sub_id) if sub_id else f'move-{m["id"]}',
        'notas': (f"Backfill A3 alta huérfana · move {m.get('name')} · "
                  f"payment_state={m.get('payment_state')} · {date.today().isoformat()}"),
    })

print(f'\nHuérfanos a crear: {len(to_create)}')
for r in to_create:
    print(f"  move={r['account_move_id']:>5} | {(r['cliente_nombre'] or '')[:24]:24s} | "
          f"trainer={r['id_trainer']} | {r['periodo']} | {r['importe_total']:>7.2f}€ | "
          f"iva={r['iva_pct']}% | {r['estado']:8s} | cuota={r['cuota_codigo']}")

if not to_create:
    print('\nNada que hacer.'); sys.exit()
if not CONFIRM:
    print('\n[DRY-RUN] CONFIRM=1 para aplicar.'); sys.exit()

print('\n=== APLICANDO ===')
inserted = errors = 0
with get_conn() as conn, conn.cursor() as cur:
    for r in to_create:
        try:
            cur.execute("""
                INSERT INTO recibo
                  (id_manager, id_trainer, cliente_idnoofit, cliente_nombre,
                   cuota_id, cuota_codigo, cuota_descripcion,
                   periodo, fecha_desde, fecha_hasta, periodicidad,
                   importe_base, importe_iva, importe_total, iva_pct,
                   metodo_pago, estado, fecha_emision, fecha_pago,
                   account_move_id, account_move_ref,
                   origen, origen_ref, notas, sync_status, created_by, updated_by)
                VALUES (%(id_manager)s, %(id_trainer)s, %(cliente_idnoofit)s, %(cliente_nombre)s,
                        %(cuota_id)s, %(cuota_codigo)s, %(cuota_descripcion)s,
                        %(periodo)s, %(fecha_desde)s, %(fecha_hasta)s, %(periodicidad)s,
                        %(importe_base)s, %(importe_iva)s, %(importe_total)s, %(iva_pct)s,
                        %(metodo_pago)s, %(estado)s, %(fecha_emision)s, %(fecha_pago)s,
                        %(account_move_id)s, %(account_move_ref)s,
                        %(origen)s, %(origen_ref)s, %(notas)s, 'synced',
                        'backfill_alta', 'backfill_alta')
            """, r)
            inserted += 1
        except Exception as e:
            errors += 1
            print(f"  ⚠ move={r['account_move_id']}: {e}")
print(f'\n✓ Insertadas: {inserted}  Errores: {errors}')
