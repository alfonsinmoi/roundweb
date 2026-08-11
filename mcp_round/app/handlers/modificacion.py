"""Eventos de modificación de recibo: creada, eliminada."""
from ..odoo_client import get_client
from .. import config


def modificacion_creada(payload):
    """Crea round.modificacion.recibo con vigencia desde/hasta sobre la suscripción."""
    odoo = get_client()
    cli = payload['cliente']
    mod = payload['modificacion']

    pid = odoo.find_partner_by_dni(cli['dni'])
    if not pid:
        return {'ok': False, 'error': 'partner_not_found'}

    # Buscar suscripción afectada
    sub_id = mod.get('subscription_id_noofit')
    if sub_id:
        subs = odoo.call('round.subscription', 'search',
            [('id_noofit_subscription', '=', str(sub_id))], limit=1)
    else:
        subs = odoo.call('round.subscription', 'search',
            [('partner_id', '=', pid), ('estado', '=', 'activa')], limit=1)
    if not subs:
        return {'ok': False, 'error': 'subscription_not_found'}

    mid = odoo.call('round.modificacion.recibo', 'create', {
        'subscription_id': subs[0],
        'fecha_desde': mod['fecha_desde'],
        'fecha_hasta': mod.get('fecha_hasta'),
        'tipo': mod.get('tipo', 'descuento'),
        'valor': mod['valor'],
        'razon': mod.get('razon'),
        'id_noofit_modificacion': str(mod.get('id_noofit')),
        'estado': 'activa',
    })
    return {'ok': True, 'modificacion_id': mid, 'subscription_id': subs[0]}


def modificacion_eliminada(payload):
    """Marca como cancelada una modificación pendiente."""
    odoo = get_client()
    id_mod_noofit = payload['modificacion']['id_noofit']

    mods = odoo.call('round.modificacion.recibo', 'search',
        [('id_noofit_modificacion', '=', str(id_mod_noofit))])
    if not mods:
        return {'ok': False, 'error': 'modificacion_not_found'}

    odoo.call('round.modificacion.recibo', 'action_cancelar', mods)
    return {'ok': True, 'modificaciones_canceladas': mods}
