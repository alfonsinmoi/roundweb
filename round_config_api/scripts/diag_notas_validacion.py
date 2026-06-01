"""Diagnóstico de cada caso anotado por el usuario en la validación de junio."""
from app.db import get_conn
from app.odoo_alta import OdooAlta
import datetime as dt

CASOS = {
    1817398: 'Andres Franco — no sale cuota RT',
    1817935: 'fernando gordo — falta modificacion + dudas descuento RT+MYGYM',
    1820717: 'Priya Sahota — sale dos veces',
    1817768: 'Roberto Guillén — falta modificacion',
    1817716: 'Teresa Bravo — falta modificacion',
}

o = OdooAlta(); o._connect()
company_id = 3
mes = '2026-06'

# Modifs activas en BD junio
primer = dt.date(2026, 6, 1)
ultimo = dt.date(2026, 6, 30)

for cid, label in CASOS.items():
    print(f'\n══ {label} (idnoofit={cid}) ══')

    # 1) Partner Odoo
    pids = o._call('res.partner', 'search', [('id_noofit', '=', str(cid))], limit=2)
    partners = o._call('res.partner', 'read', pids, ['id', 'name', 'company_id', 'active', 'id_noofit'])
    for p in partners:
        cmp = p.get('company_id')
        cmp_id = cmp[0] if isinstance(cmp, list) else cmp
        cmp_nm = cmp[1] if isinstance(cmp, list) else ''
        print(f'  Partner Odoo id={p["id"]} name={p["name"]} active={p["active"]} '
              f'company={cmp_id} ({cmp_nm}) id_noofit={p["id_noofit"]}')

    # 2) Subs activas company=3
    subs = o._call('round.subscription', 'search_read',
        [('partner_id', 'in', [p['id'] for p in partners]),
         ('estado', '=', 'activa'),
         ('company_id', '=', company_id)],
        ['id', 'partner_id', 'cuota_id', 'periodicidad', 'forma_pago',
         'fecha_inicio', 'fecha_fin', 'estado'])
    print(f'  Subs activas en company={company_id}: {len(subs)}')
    for s in subs:
        cuota = s.get('cuota_id')
        cn = cuota[1] if isinstance(cuota, list) else cuota
        per = s.get('periodicidad')
        # Precio catálogo
        cinfo = o._call('round.cuota.catalogo', 'read', [cuota[0]],
            ['codigo', 'precio_mensual', 'precio_trimestral',
             'precio_semestral', 'precio_anual']) if cuota else []
        cinfo = cinfo[0] if cinfo else {}
        prec_field = f'precio_{per}'
        prec = cinfo.get(prec_field, '?')
        print(f'    sub id={s["id"]:>4}  cuota={cn:<24}  '
              f'periodicidad={per:<11}  fecha_inicio={s.get("fecha_inicio")}  '
              f'precio_catalogo[{prec_field}]={prec}')

    # 3) Modificaciones en BD local (round_config) que se aplicarían en junio
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT id, tipo, valor, cuota_id, razon, fecha_desde, fecha_hasta,
                   estado, odoo_id
              FROM modificacion
             WHERE id_manager=%s AND cliente_idnoofit=%s
               AND estado='activa'
               AND fecha_desde <= %s
               AND (fecha_hasta IS NULL OR fecha_hasta >= %s)
        """, ('17675', str(cid), ultimo, primer))
        mods = cur.fetchall()
    print(f'  Modificaciones BD local activas para junio: {len(mods)}')
    for m in mods:
        print(f'    mod id={m["id"]}  tipo={m["tipo"]}  valor={m["valor"]}  '
              f'cuota_id={m["cuota_id"]}  razon={m["razon"]!r}  estado={m["estado"]}')

    # 4) Modificaciones en Odoo (round.modificacion.recibo)
    sub_ids = [s['id'] for s in subs]
    if sub_ids:
        mods_odoo = o._call('round.modificacion.recibo', 'search_read',
            [('subscription_id', 'in', sub_ids), ('estado', '=', 'activa'),
             ('fecha_desde', '<=', str(ultimo)),
             '|', ('fecha_hasta', '=', False),
             ('fecha_hasta', '>=', str(primer))],
            ['id', 'tipo', 'valor', 'subscription_id', 'razon', 'fecha_desde',
             'fecha_hasta', 'estado'])
        print(f'  Modificaciones Odoo activas para junio: {len(mods_odoo)}')
        for m in mods_odoo:
            sub = m.get('subscription_id')
            print(f'    mod id={m["id"]}  tipo={m["tipo"]}  valor={m["valor"]}  '
                  f'sub={sub[1] if isinstance(sub, list) else sub}  '
                  f'razon={m["razon"]!r}')
