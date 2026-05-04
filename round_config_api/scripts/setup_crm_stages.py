"""Renombra/crea las etapas del pipeline CRM en español."""
import sys, xmlrpc.client
sys.path.insert(0, '/opt/round_config_api')
from app import config as cfg

common = xmlrpc.client.ServerProxy(f'{cfg.ODOO_URL}/xmlrpc/2/common', allow_none=True)
uid = common.authenticate(cfg.ODOO_DB, cfg.ODOO_USER, cfg.ODOO_PWD, {})
m = xmlrpc.client.ServerProxy(f'{cfg.ODOO_URL}/xmlrpc/2/object', allow_none=True)
def call(model, method, *a, **kw):
    return m.execute_kw(cfg.ODOO_DB, uid, cfg.ODOO_PWD, model, method, list(a), kw)

deseadas = [
    (1,  'Nuevo',      10, False),
    (2,  'Contactado', 20, False),
    (3,  'Visita',     30, False),
    (None, 'Prueba',   40, False),
    (4,  'Alta',       50, True),
]
existing_ids = call('crm.stage', 'search', [])

for pre_id, name, seq, won in deseadas:
    if pre_id and pre_id in existing_ids:
        call('crm.stage', 'write', [pre_id], {'name': name, 'sequence': seq, 'is_won': won})
        print(f'renombrada #{pre_id} → {name}')
    else:
        new_id = call('crm.stage', 'create', {'name': name, 'sequence': seq, 'is_won': won})
        print(f'creada #{new_id} {name}')

ids = call('crm.stage', 'search', [], order='sequence')
stages = call('crm.stage', 'read', ids, fields=['id', 'name', 'sequence', 'is_won'])
print('\nPipeline final:')
for s in stages:
    won_label = 'WON' if s['is_won'] else ''
    print(f'  #{s["id"]:<4d} seq={s["sequence"]:<4d} {s["name"]:<15s} {won_label}')
