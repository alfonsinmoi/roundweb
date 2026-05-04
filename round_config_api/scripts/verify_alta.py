"""Verifica el estado de la última alta de cliente en Odoo."""
import sys, xmlrpc.client
sys.path.insert(0, '/opt/round_config_api')
from app import config as cfg

common = xmlrpc.client.ServerProxy(f'{cfg.ODOO_URL}/xmlrpc/2/common', allow_none=True)
uid = common.authenticate(cfg.ODOO_DB, cfg.ODOO_USER, cfg.ODOO_PWD, {})
m = xmlrpc.client.ServerProxy(f'{cfg.ODOO_URL}/xmlrpc/2/object', allow_none=True)
def call(model, method, *a, **kw):
    return m.execute_kw(cfg.ODOO_DB, uid, cfg.ODOO_PWD, model, method, list(a), kw)

print('=== ULTIMA SUBSCRIPTION ===')
subs = call('round.subscription','search_read',[],
    fields=['id','partner_id','cuota_id','periodicidad','forma_pago','estado','fecha_inicio'],
    order='id desc', limit=3)
for s in subs:
    print(f"  sub#{s['id']} partner={s.get('partner_id')} cuota={s.get('cuota_id')} per={s.get('periodicidad')} fp={s.get('forma_pago')} estado={s.get('estado')} desde={s.get('fecha_inicio')}")

print('\n=== ULTIMOS RECIBOS ===')
invs = call('account.move','search_read',
    [('move_type','=','out_invoice'),('round_subscription_id','!=',False)],
    fields=['id','name','partner_id','round_subscription_id','amount_total','state','payment_state','invoice_date','narration'],
    order='id desc', limit=5)
for i in invs:
    print(f"  inv#{i['id']} {i['name']} {i['partner_id'][1] if i.get('partner_id') else '?'} sub={i.get('round_subscription_id')} total={i['amount_total']} state={i['state']} payment_state={i['payment_state']} date={i['invoice_date']}")
    if i.get('narration'): print(f"     narration: {i['narration'][:100]}")

print('\n=== ULTIMOS PAYMENTS ===')
pays = call('account.payment','search_read',[],
    fields=['id','name','partner_id','amount','state','journal_id','date','reconciled_invoice_ids'],
    order='id desc', limit=5)
for p in pays:
    print(f"  pay#{p['id']} {p['name']} {p.get('partner_id')} amount={p['amount']} state={p['state']} journal={p.get('journal_id')} reconc={p.get('reconciled_invoice_ids')}")

print('\n=== CUOTAS catalogo ===')
cuotas = call('round.cuota.catalogo','search_read',[],
    fields=['id','codigo','descripcion','precio_mensual'], order='id desc')
for c in cuotas:
    print(f"  cuota#{c['id']} {c['codigo']} - {c['descripcion']} - {c['precio_mensual']}€/mes")
