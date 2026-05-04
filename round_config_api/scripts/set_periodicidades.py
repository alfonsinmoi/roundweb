"""Cambia la periodicidad de algunas suscripciones para test:
- 1 → trimestral (90 €/trim)
- 1 → anual (300 €/anual)
Resto siguen mensuales.
"""
import sys, xmlrpc.client
sys.path.insert(0, '/opt/round_config_api')
from app import config as cfg

common = xmlrpc.client.ServerProxy(f'{cfg.ODOO_URL}/xmlrpc/2/common', allow_none=True)
uid = common.authenticate(cfg.ODOO_DB, cfg.ODOO_USER, cfg.ODOO_PWD, {})
m = xmlrpc.client.ServerProxy(f'{cfg.ODOO_URL}/xmlrpc/2/object', allow_none=True)
def call(model, method, *a, **kw):
    return m.execute_kw(cfg.ODOO_DB, uid, cfg.ODOO_PWD, model, method, list(a), kw)

# Asegurar que las cuotas tienen precio trimestral / anual
cuotas = call('round.cuota.catalogo','search_read',[],
    ['id','codigo','precio_mensual','precio_trimestral','precio_anual'])
print('Cuotas:')
for c in cuotas:
    print(f"  {c['codigo']}: m={c.get('precio_mensual')} t={c.get('precio_trimestral')} a={c.get('precio_anual')}")
    # Garantizar precios para periodicidades > mensual
    update = {}
    if not c.get('precio_trimestral'):
        update['precio_trimestral'] = float(c.get('precio_mensual') or 0) * 3 * 0.95  # 5% descuento por pago adelantado
    if not c.get('precio_anual'):
        update['precio_anual'] = float(c.get('precio_mensual') or 0) * 12 * 0.90  # 10% descuento
    if update:
        call('round.cuota.catalogo','write',[c['id']], update)
        print(f"   → actualizado: {update}")

subs = call('round.subscription','search_read',[('estado','=','activa')],
    ['id','partner_id','cuota_id','periodicidad','forma_pago'])
print(f"\n{len(subs)} suscripciones activas")
for s in subs:
    print(f"  sub {s['id']} {s.get('partner_id', [None,'?'])[1]} "
          f"cuota={s.get('cuota_id', [None,'?'])[1]} "
          f"per={s.get('periodicidad')} fp={s.get('forma_pago')}")

# Cambiar las dos primeras: una a trimestral, otra a anual
if len(subs) >= 2:
    s1 = subs[0]
    s2 = subs[1]
    call('round.subscription','write',[s1['id']],{'periodicidad':'trimestral'})
    print(f"\n✅ sub {s1['id']} ({s1.get('partner_id', [None,'?'])[1]}) → trimestral")
    call('round.subscription','write',[s2['id']],{'periodicidad':'anual'})
    print(f"✅ sub {s2['id']} ({s2.get('partner_id', [None,'?'])[1]}) → anual")
