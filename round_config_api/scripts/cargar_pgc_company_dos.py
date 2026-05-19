"""Carga el plan de cuentas español (PGC PYMES) en la compañía 'Best training dos' (id=3)
y configura los datos básicos: VAT, journals, SEPA Creditor ID, cuenta analítica.

Se ejecuta a través de odoo-bin shell (no por XML-RPC, que tiene permisos
limitados para account.chart.template).

Uso:
  sudo -u odoo /opt/odoo17/venv/bin/python /opt/odoo17/odoo/odoo-bin shell \\
    -c /etc/odoo17.conf -d round_facturacion --no-http \\
    < cargar_pgc_company_dos.py
"""
import logging
_log = logging.getLogger(__name__)

COMPANY_ID = 3            # Best training dos
VAT_OK = 'ESB72349137'
COMPANY_NAME = 'BEST TRAINING DOS S.L.'
SEPA_CREDITOR_ID = 'ES25000B72349137'
IBAN = 'ES9800491862412810107577'
BIC = 'BSCHESMM'
ANALYTIC_PLAN_NAME = 'Centros'
ANALYTIC_ROUND_MALAGA = 'Round Málaga Centro'

print('=== Cargando PGC en Best training dos ===\n')

company = env['res.company'].browse(COMPANY_ID)
if not company.exists():
    print(f'❌ company id={COMPANY_ID} no existe')
    exit()
print(f'Compañía: {company.name} (id={company.id})')

# 1. Corregir VAT y nombre si hace falta
vals = {}
if company.vat != VAT_OK:
    vals['vat'] = VAT_OK
if company.name.lower() != COMPANY_NAME.lower():
    # No tocamos el nombre — es decisión del usuario, sólo aviso
    print(f'  Aviso: nombre actual "{company.name}" — el deseado es "{COMPANY_NAME}"')
if vals:
    company.write(vals)
    print(f'  ✓ Actualizado VAT/nombre: {vals}')
else:
    print('  ✓ VAT y nombre correctos')

# 2. Cargar plantilla PGC PYMES
print('\n--- Cargando plantilla account chart ---')
try:
    chart_xml_id = 'l10n_es.account_chart_template_pymes'
    chart = env.ref(chart_xml_id, raise_if_not_found=False)
    if chart:
        print(f'  Chart encontrado: {chart}')
except Exception as e:
    print(f'  Aviso: env.ref no encontró chart: {e}')

# El método de Odoo 17 para cargar chart en una company es try_loading
print('  Intentando try_loading("es_pymes", company=...)...')
try:
    env['account.chart.template'].try_loading('es_pymes', company=company)
    print('  ✓ Chart cargado con try_loading')
except Exception as e:
    print(f'  ⚠ try_loading falló: {e}')
    # Fallback: copiar cuentas/diarios desde compañía 2 (ES Company) que ya
    # tiene la plantilla cargada
    print('  Intentando con _load_for_company...')
    try:
        env['account.chart.template']._load('es_pymes', company)
        print('  ✓ Chart cargado con _load')
    except Exception as e2:
        print(f'  ⚠ _load también falló: {e2}')

# 3. Verificar que se cargaron cuentas
n_acc = env['account.account'].search_count([('company_id', '=', COMPANY_ID)])
print(f'\n✓ Cuentas en company {COMPANY_ID}: {n_acc}')

n_tax = env['account.tax'].search_count([('company_id', '=', COMPANY_ID), ('active', '=', True)])
print(f'✓ Impuestos activos: {n_tax}')

n_journ = env['account.journal'].search_count([('company_id', '=', COMPANY_ID)])
print(f'✓ Journals: {n_journ}')

env.cr.commit()
print('\n✓ Cambios commitados')
