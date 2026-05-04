"""Borra todos los recibos (account.move out_invoice con round_subscription_id)
y payment.order asociados creados en un mes dado. SOLO PARA PRUEBAS.
Uso: python wipe_mes.py 2026-05
"""
import sys, xmlrpc.client
sys.path.insert(0, '/opt/round_config_api')
from app import config as cfg

mes = sys.argv[1] if len(sys.argv) > 1 else '2026-05'
y, mm = mes.split('-')
inicio = f'{mes}-01'
fin = f'{mes}-31'

print(f'URL={cfg.ODOO_URL} DB={cfg.ODOO_DB} USER={cfg.ODOO_USER} pwd_len={len(cfg.ODOO_PWD)}')
common = xmlrpc.client.ServerProxy(f'{cfg.ODOO_URL}/xmlrpc/2/common', allow_none=True)
uid = common.authenticate(cfg.ODOO_DB, cfg.ODOO_USER, cfg.ODOO_PWD, {})
print(f'uid={uid}')
if not uid:
    sys.exit('Auth failed')

m = xmlrpc.client.ServerProxy(f'{cfg.ODOO_URL}/xmlrpc/2/object', allow_none=True)
def call(model, method, *a, **kw):
    return m.execute_kw(cfg.ODOO_DB, uid, cfg.ODOO_PWD, model, method, list(a), kw)

inv_ids = call('account.move', 'search', [
    ('move_type', '=', 'out_invoice'),
    ('round_subscription_id', '!=', False),
    ('invoice_date', '>=', inicio),
    ('invoice_date', '<=', fin),
])
print(f'Recibos a limpiar: {len(inv_ids)}')

po_ids = call('account.payment.order', 'search', [('create_date', '>=', f'{mes}-01 00:00:00')])
print(f'Payment orders del mes: {len(po_ids)}')
for po in po_ids:
    info = call('account.payment.order', 'read', [po], ['state'])[0]
    state = info['state']
    print(f'  PO {po} state={state}')
    if state == 'generated':
        try: call('account.payment.order', 'generated2uploaded', [po])
        except Exception as e: print(f'    g2u: {e}')
    if state in ('open', 'generated', 'uploaded'):
        try: call('account.payment.order', 'action_cancel', [po])
        except Exception as e: print(f'    cancel: {e}')
    try:
        call('account.payment.order', 'unlink', [po])
        print('    unlinked')
    except Exception as e:
        print(f'    unlink: {e}')

# Borrar payment.line attachments primero
for inv in inv_ids:
    info = call('account.move', 'read', [inv], ['state', 'name'])[0]
    print(f"  inv {inv} {info['name']} state={info['state']}")
    if info['state'] == 'posted':
        try: call('account.move', 'button_draft', [inv])
        except Exception as e: print(f'    draft: {e}')
    try: call('account.move', 'button_cancel', [inv])
    except Exception as e: print(f'    cancel: {e}')
    try:
        call('account.move', 'unlink', [inv])
        print('    unlinked')
    except Exception as e:
        print(f'    unlink: {e}')

remain = call('account.move', 'search_count', [
    ('move_type', '=', 'out_invoice'),
    ('round_subscription_id', '!=', False),
    ('invoice_date', '>=', inicio),
    ('invoice_date', '<=', fin),
])
print(f'\nRestantes: {remain}')
