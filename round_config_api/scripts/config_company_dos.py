"""Configuración avanzada de 'Best training dos' tras cargar PGC.
- SEPA Creditor ID
- Banco Santander journal con IBAN
- Cuenta analítica Round Málaga Centro
- Vincula módulo round_facturacion (si aplica)
- Resumen final
"""
COMPANY_ID = 3
SEPA_CREDITOR_ID = 'ES25000B72349137'
IBAN = 'ES9800491862412810107577'
BIC = 'BSCHESMM'
BANK_NAME = 'Banco Santander'

print('=== CONFIG COMPLEMENTARIA Best training dos ===\n')
company = env['res.company'].browse(COMPANY_ID)
print(f'Compañía: {company.name}')

# 1. SEPA Creditor ID — depende del módulo SEPA Direct Debit
print('\n--- SEPA ---')
if hasattr(company, 'sdd_creditor_identifier'):
    if company.sdd_creditor_identifier != SEPA_CREDITOR_ID:
        company.sdd_creditor_identifier = SEPA_CREDITOR_ID
        print(f'  ✓ SEPA Creditor ID = {SEPA_CREDITOR_ID}')
    else:
        print(f'  ✓ SEPA Creditor ID ya configurado')
else:
    print('  ⚠ Campo sdd_creditor_identifier no existe (revisar módulo SEPA)')

# 2. Cuenta bancaria + diario Banco Santander
print('\n--- Banco Santander ---')
# Buscar res.partner.bank de la compañía
partner_id = company.partner_id.id
existing_iban = env['res.partner.bank'].search([
    ('partner_id', '=', partner_id), ('acc_number', 'ilike', IBAN.replace(' ', ''))
], limit=1)

if not existing_iban:
    bank = env['res.bank'].search([('name', 'ilike', 'santander')], limit=1)
    bank_vals = {
        'partner_id': partner_id,
        'acc_number': IBAN,
    }
    if bank:
        bank_vals['bank_id'] = bank.id
    new_bank = env['res.partner.bank'].create(bank_vals)
    print(f'  ✓ Cuenta bancaria creada: {new_bank.acc_number}')
    bank_account_id = new_bank.id
else:
    print(f'  ✓ Cuenta bancaria ya existe: {existing_iban.acc_number}')
    bank_account_id = existing_iban.id

# Buscar journal bank de la compañía. Si existe, vincular el bank account
journal_bank = env['account.journal'].search([
    ('company_id', '=', COMPANY_ID), ('type', '=', 'bank'),
], limit=1)
if journal_bank:
    if not journal_bank.bank_account_id:
        journal_bank.bank_account_id = bank_account_id
        print(f'  ✓ Journal {journal_bank.name} vinculado a cuenta bancaria')
    if BANK_NAME.lower() not in (journal_bank.name or '').lower():
        journal_bank.name = BANK_NAME
        journal_bank.code = 'BSAN'
        print(f'  ✓ Journal renombrado a {BANK_NAME} (code BSAN)')
    print(f'  Journal banco actual: {journal_bank.name} ({journal_bank.code})')
else:
    print('  ⚠ No hay journal de tipo bank — se debe crear desde Odoo Settings')

# 3. Cuenta analítica
print('\n--- Cuenta analítica Round Málaga Centro ---')
# Plan analítico (no tiene company_id en Odoo 17 — es global)
plan = env['account.analytic.plan'].search([('name', '=', 'Centros')], limit=1)
if not plan:
    plan = env['account.analytic.plan'].create({'name': 'Centros'})
    print(f'  ✓ Plan analítico Centros creado (id={plan.id})')
else:
    print(f'  ✓ Plan analítico Centros ya existe (id={plan.id})')

# Cuenta analítica Round Málaga Centro para esta compañía
existing_analytic = env['account.analytic.account'].search([
    ('name', '=', 'Round Málaga Centro'),
    ('company_id', '=', COMPANY_ID),
], limit=1)
if not existing_analytic:
    analytic = env['account.analytic.account'].create({
        'name': 'Round Málaga Centro',
        'plan_id': plan.id,
        'company_id': COMPANY_ID,
    })
    print(f'  ✓ Cuenta analítica creada (id={analytic.id})')
else:
    print(f'  ✓ Cuenta analítica ya existe (id={existing_analytic.id})')

# 4. Resumen completo
print('\n=== RESUMEN config Best training dos ===')
print(f'  Compañía:        {company.name}')
print(f'  VAT:             {company.vat}')
print(f'  Moneda:          {company.currency_id.name}')
print(f'  País:            {company.country_id.name}')
print(f'  SEPA creditor:   {getattr(company, "sdd_creditor_identifier", "N/A")}')
print()

# Cuentas
n_acc = env['account.account'].search_count([('company_id', '=', COMPANY_ID)])
n_tax = env['account.tax'].search_count([('company_id', '=', COMPANY_ID), ('active', '=', True)])
print(f'  Cuentas:         {n_acc}')
print(f'  Impuestos activ: {n_tax}')

# Journals
print(f'\n  Journals:')
journals = env['account.journal'].search([('company_id', '=', COMPANY_ID)])
for j in journals:
    bank_str = f" → {j.bank_account_id.acc_number}" if j.type == 'bank' and j.bank_account_id else ''
    print(f'    [{j.type:6s}] {j.code:6s} {j.name}{bank_str}')

# Tax 21% disponible
tax21 = env['account.tax'].search([
    ('company_id', '=', COMPANY_ID), ('amount', '=', 21.0),
    ('type_tax_use', '=', 'sale'), ('active', '=', True),
], limit=3)
print(f'\n  Tax 21% sale disponibles: {len(tax21)}')
for t in tax21:
    print(f'    id={t.id}  {t.name}  · price_include={t.price_include}')

# Analytic
analytic_all = env['account.analytic.account'].search([('company_id', '=', COMPANY_ID)])
print(f'\n  Cuentas analíticas: {len(analytic_all)}')
for a in analytic_all:
    print(f'    id={a.id}  {a.name}')

env.cr.commit()
print('\n✓ Cambios commitados')
