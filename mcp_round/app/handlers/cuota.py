"""Eventos de cuota: asignada, cambio, baja."""
import logging
from datetime import datetime
from ..odoo_client import get_client
from .. import config

log = logging.getLogger(__name__)


def cuota_asignada(payload):
    """Crea una nueva suscripción para el cliente con la cuota indicada."""
    odoo = get_client()
    cli = payload['cliente']
    cuota = payload['cuota']
    forma = payload.get('forma_pago', {}) or {}

    pid = odoo.find_partner_by_dni(cli['dni'])
    if not pid:
        return {'ok': False, 'error': 'partner_not_found'}

    cuota_id = odoo.find_cuota_by_codigo(cuota['codigo'])
    if not cuota_id:
        return {'ok': False, 'error': f"cuota_no_existe: {cuota['codigo']}"}

    # Mandato (si SEPA y aún no tiene)
    mandate_id = False
    if forma.get('tipo') == 'sepa':
        existing = odoo.call('account.banking.mandate', 'search',
            [('partner_id', '=', pid), ('state', '=', 'valid')], limit=1)
        if existing:
            mandate_id = existing[0]

    sub_id = odoo.call('round.subscription', 'create', {
        'partner_id': pid,
        'cuota_id': cuota_id,
        'periodicidad': cuota.get('periodicidad', 'mensual'),
        'forma_pago': forma.get('tipo', 'sepa'),
        'mandate_id': mandate_id or False,
        'fecha_inicio': datetime.utcnow().date().isoformat(),
        'estado': 'activa',
        'company_id': config.DEFAULT_COMPANY_ID,
    })
    return {'ok': True, 'subscription_id': sub_id, 'partner_id': pid}


def cuota_cambio(payload):
    """Cliente cambia de cuota: cierra la antigua, abre una nueva."""
    odoo = get_client()
    cli = payload['cliente']
    cuota_anterior = payload['cuota_anterior']  # codigo
    cuota_nueva    = payload['cuota_nueva']     # dict con codigo, periodicidad, …

    pid = odoo.find_partner_by_dni(cli['dni'])
    if not pid:
        return {'ok': False, 'error': 'partner_not_found'}

    cuota_anterior_id = odoo.find_cuota_by_codigo(cuota_anterior)
    # Cerrar suscripción anterior
    subs = odoo.call('round.subscription', 'search',
        [('partner_id', '=', pid), ('cuota_id', '=', cuota_anterior_id),
         ('estado', '=', 'activa')])
    for s in subs:
        odoo.call('round.subscription', 'action_cancelar', [s])

    # Crear nueva
    cuota_nueva_id = odoo.find_cuota_by_codigo(cuota_nueva['codigo'])
    if not cuota_nueva_id:
        return {'ok': False, 'error': f"cuota_nueva_no_existe: {cuota_nueva['codigo']}"}

    forma = payload.get('forma_pago', {}) or {}
    mandate_id = False
    if forma.get('tipo') == 'sepa':
        existing = odoo.call('account.banking.mandate', 'search',
            [('partner_id', '=', pid), ('state', '=', 'valid')], limit=1)
        if existing:
            mandate_id = existing[0]

    sub_id = odoo.call('round.subscription', 'create', {
        'partner_id': pid,
        'cuota_id': cuota_nueva_id,
        'periodicidad': cuota_nueva.get('periodicidad', 'mensual'),
        'forma_pago': forma.get('tipo', 'sepa'),
        'mandate_id': mandate_id or False,
        'fecha_inicio': datetime.utcnow().date().isoformat(),
        'estado': 'activa',
        'company_id': config.DEFAULT_COMPANY_ID,
    })
    return {'ok': True, 'subs_cerradas': subs, 'subscription_nueva_id': sub_id}


def cuota_baja(payload):
    """Cliente cancela una cuota concreta (sigue activo en otras)."""
    odoo = get_client()
    cli = payload['cliente']
    cuota_codigo = payload['cuota']['codigo']

    pid = odoo.find_partner_by_dni(cli['dni'])
    if not pid:
        return {'ok': False, 'error': 'partner_not_found'}

    cuota_id = odoo.find_cuota_by_codigo(cuota_codigo)
    subs = odoo.call('round.subscription', 'search',
        [('partner_id', '=', pid), ('cuota_id', '=', cuota_id),
         ('estado', '=', 'activa')])
    for s in subs:
        odoo.call('round.subscription', 'action_cancelar', [s])

    return {'ok': True, 'subs_cerradas': subs}
