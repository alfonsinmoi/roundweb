"""Eventos de descuento: activado, desactivado."""
from ..odoo_client import get_client
from .. import config


def descuento_activado(payload):
    """Añade un descuento del catálogo a las suscripciones activas del cliente."""
    odoo = get_client()
    cli = payload['cliente']
    cod = payload['descuento']['codigo']

    pid = odoo.find_partner_by_dni(cli['dni'])
    if not pid:
        return {'ok': False, 'error': 'partner_not_found'}

    desc_id = odoo.find_descuento_by_codigo(cod)
    if not desc_id:
        return {'ok': False, 'error': f'descuento_no_existe: {cod}'}

    subs = odoo.call('round.subscription', 'search',
        [('partner_id', '=', pid), ('estado', '=', 'activa')])
    if not subs:
        return {'ok': False, 'error': 'no_active_subscriptions'}

    odoo.call('round.subscription', 'write', subs,
        {'descuentos_activos_ids': [(4, desc_id)]})
    return {'ok': True, 'subs_updated': subs, 'descuento_id': desc_id}


def descuento_desactivado(payload):
    odoo = get_client()
    cli = payload['cliente']
    cod = payload['descuento']['codigo']

    pid = odoo.find_partner_by_dni(cli['dni'])
    if not pid:
        return {'ok': False, 'error': 'partner_not_found'}

    desc_id = odoo.find_descuento_by_codigo(cod)
    if not desc_id:
        return {'ok': False, 'error': f'descuento_no_existe: {cod}'}

    subs = odoo.call('round.subscription', 'search',
        [('partner_id', '=', pid), ('estado', 'in', ['activa', 'suspendida'])])
    odoo.call('round.subscription', 'write', subs,
        {'descuentos_activos_ids': [(3, desc_id)]})
    return {'ok': True, 'subs_updated': subs, 'descuento_id': desc_id}
