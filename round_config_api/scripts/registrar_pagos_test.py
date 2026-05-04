"""Llama a _registrar_pagos_auto sobre los recibos del mes para depurar."""
import sys, logging
sys.path.insert(0, '/opt/round_config_api')
logging.basicConfig(level=logging.DEBUG, format='%(asctime)s [%(levelname)s] %(name)s: %(message)s')

from app.odoo_cuotas import OdooCuotas
oc = OdooCuotas()

# Listar recibos del mes
inicio, fin = oc._periodos_mes('2026-05')
borradores = oc._call('account.move','search',
    [('state','=','posted'),('move_type','=','out_invoice'),
     ('invoice_date','>=',str(inicio)),('invoice_date','<=',str(fin)),
     ('round_subscription_id','!=',False)])
print(f'Recibos posted del mes: {len(borradores)}')

# Buscar journal
from app import config as cfg
journals = oc._call('account.journal','search_read',
    [('type','=','bank'),('company_id','=',cfg.ODOO_COMPANY)],
    ['id','name','default_account_id'])
print(f'Journals bank company={cfg.ODOO_COMPANY}: {journals}')

if not journals:
    print('NO HAY JOURNAL BANK PARA LA COMPANY → ESE ES EL PROBLEMA')
    print(f'cfg.ODOO_COMPANY = {cfg.ODOO_COMPANY}')
else:
    cobrados = oc._registrar_pagos_auto(borradores)
    print(f'Cobrados: {cobrados}')
