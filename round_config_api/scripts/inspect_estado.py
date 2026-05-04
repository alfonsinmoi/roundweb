"""Inspecciona estado de pago de los recibos del mes."""
import sys, xmlrpc.client
sys.path.insert(0, '/opt/round_config_api')
from app import config as cfg

common = xmlrpc.client.ServerProxy(f'{cfg.ODOO_URL}/xmlrpc/2/common', allow_none=True)
uid = common.authenticate(cfg.ODOO_DB, cfg.ODOO_USER, cfg.ODOO_PWD, {})
m = xmlrpc.client.ServerProxy(f'{cfg.ODOO_URL}/xmlrpc/2/object', allow_none=True)
def call(model, method, *a, **kw):
    return m.execute_kw(cfg.ODOO_DB, uid, cfg.ODOO_PWD, model, method, list(a), kw)

invs = call('account.move','search_read', [
    ('move_type','=','out_invoice'),
    ('round_subscription_id','!=', False),
    ('invoice_date','>=','2026-05-01'),
], ['id','name','state','payment_state','amount_total','round_subscription_id','partner_id'])
print(f'{len(invs)} recibos del mes:\n')
for i in invs:
    sub_id = i.get('round_subscription_id')
    if sub_id:
        s = call('round.subscription','read', [sub_id[0]], ['forma_pago'])[0]
        fp = s.get('forma_pago')
    else: fp = '?'
    print(f"  {i['name']} | state={i['state']:8s} | pay={i['payment_state']:10s} | fp={fp:15s} | total={i['amount_total']:.2f} | {i['partner_id'][1] if i.get('partner_id') else '?'}")

# Ver journals bank
print('\nJournals bank:')
js = call('account.journal','search_read',[('type','=','bank')],['id','name','company_id'])
for j in js:
    print(f"  {j['id']} {j['name']} company={j.get('company_id')}")

# Ver payments existentes
print('\nPayments del mes:')
ps = call('account.payment','search_read',
    [('date','>=','2026-05-01')],
    ['id','name','partner_id','amount','state','reconciled_invoice_ids','payment_type'])
for p in ps:
    print(f"  {p['name']} {p.get('payment_type')} state={p['state']} amount={p['amount']} reconciled={p.get('reconciled_invoice_ids')} partner={p['partner_id'][1] if p.get('partner_id') else '?'}")
