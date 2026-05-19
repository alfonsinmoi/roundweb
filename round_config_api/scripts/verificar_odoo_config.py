"""Verifica config Odoo antes de importar recibos."""
import sys
sys.path.insert(0, '/opt/round_config_api')
from app.odoo_alta import OdooAlta

oa = OdooAlta()
oa._connect()
print(f'Conectado uid={oa._uid}\n')

# 1. Compañías
print('=== COMPAÑÍAS ===')
companies = oa._call('res.company', 'search_read', [],
                     ['id', 'name', 'vat', 'currency_id'])
for c in companies:
    print(f'  id={c["id"]:>3}  {c["name"]}  · VAT={c.get("vat")}  · curr={c.get("currency_id")}')
print()

# 2. Impuestos venta
print('=== IMPUESTOS DE VENTA (active=true) ===')
taxes = oa._call('account.tax', 'search_read',
                 [('type_tax_use','=','sale'),('active','=',True)],
                 ['id','name','amount','price_include','company_id'])
for t in taxes:
    print(f'  id={t["id"]:>3}  {t["name"][:50]:50s}  · {t["amount"]}%  · price_include={t["price_include"]}  · company={t["company_id"]}')
print()

# 3. Diarios
print('=== DIARIOS ===')
journals = oa._call('account.journal', 'search_read',
                    [('type','in',['sale','bank','cash'])],
                    ['id','name','type','code','company_id'])
for j in journals:
    print(f'  id={j["id"]:>3}  {j["type"]:5s}  {j["code"]:6s}  {j["name"]}  · company={j["company_id"]}')
print()

# 4. Conteo facturas existentes con ref GP-*
print('=== FACTURAS GP-* ya existentes ===')
n = oa._call('account.move', 'search_count',
             [('move_type','=','out_invoice'),('ref','like','GP-%')])
print(f'  Total: {n}')

# 5. Partners con id_noofit
print('=== PARTNERS res.partner ===')
n_total = oa._call('res.partner', 'search_count', [])
n_with_id = oa._call('res.partner', 'search_count', [('id_noofit','!=',False)])
print(f'  Total partners: {n_total}')
print(f'  Con id_noofit:  {n_with_id}')
