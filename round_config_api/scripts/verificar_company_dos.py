"""Verificar el estado de Odoo respecto a 'Best training dos' y la
configuración necesaria para enlazarla con Round."""
import sys
sys.path.insert(0, '/opt/round_config_api')
from app.odoo_alta import OdooAlta

oa = OdooAlta()
oa._connect()
print(f'Conectado uid={oa._uid}\n')

# 1. Compañías existentes
print('=== TODAS LAS COMPAÑÍAS ===')
companies = oa._call('res.company', 'search_read', [],
                     ['id', 'name', 'vat', 'currency_id', 'country_id', 'partner_id'])
for c in companies:
    cur = c['currency_id'][1] if c.get('currency_id') else '?'
    cou = c['country_id'][1] if c.get('country_id') else '?'
    print(f'  id={c["id"]:>3}  {c["name"]:60s}  · VAT={c.get("vat") or "—":15s} · {cur} · {cou}')
print()

# 2. Buscar específicamente "Best training dos"
target = oa._call('res.company', 'search_read',
                  [('name','ilike','best training dos')],
                  ['id', 'name', 'vat', 'currency_id', 'country_id', 'parent_id', 'chart_template'])
print(f'\n=== BEST TRAINING DOS ===')
if not target:
    print('  ❌ NO EXISTE — el usuario dijo que la creó pero no aparece')
    print('     Necesita crearse desde Odoo Settings → Companies')
else:
    for c in target:
        print(f'  id={c["id"]}')
        print(f'  name={c["name"]}')
        print(f'  vat={c.get("vat")}')
        print(f'  currency={c.get("currency_id")}')
        print(f'  country={c.get("country_id")}')
        print(f'  parent={c.get("parent_id")}')
        print(f'  chart_template={c.get("chart_template")}')
print()

# 3. Plan de cuentas instalado en cada compañía
print('=== Cuentas account.account (cuántas tiene cada compañía) ===')
for c in companies:
    n = oa._call('account.account', 'search_count',
                 [('company_id','=', c['id'])])
    print(f'  Company {c["id"]:>3} ({c["name"][:40]:40s}): {n} cuentas')
print()

# 4. Módulos l10n_es disponibles
print('=== MÓDULOS l10n_es (España) ===')
mods = oa._call('ir.module.module', 'search_read',
                [('name','like','l10n_es')],
                ['name', 'state', 'shortdesc'])
for m in mods:
    print(f'  {m["state"]:12s}  {m["name"]:35s}  {m["shortdesc"][:50]}')
print()

# 5. Account chart templates disponibles
print('=== Chart templates (plantillas plan de cuentas) ===')
try:
    cts = oa._call('account.chart.template', 'search_read',
                   [('country_id.code','=','ES')] if False else [],
                   ['name', 'currency_id'], limit=20)
    for t in cts:
        print(f'  {t.get("name")}  · {t.get("currency_id")}')
except Exception as e:
    print(f'  No se pudo listar chart templates: {e}')
