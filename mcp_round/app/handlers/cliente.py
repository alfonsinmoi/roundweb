"""Eventos de cliente: alta, modificado, IBAN actualizado, baja."""
import logging
from datetime import datetime
from ..odoo_client import get_client
from .. import config

log = logging.getLogger(__name__)


def _resolve_trainer_analytic(odoo, trainer_email):
    """Resuelve la cuenta analítica a partir del email del trainer.
    Para el POC: si no hay match, usa la primera cuenta analítica de la empresa.
    """
    if not trainer_email:
        return False
    # Buscar por nombre que contenga el email o parte de él
    parts = trainer_email.split('@')[0]
    ids = odoo.call('account.analytic.account', 'search',
                    ['|', ('name', 'ilike', trainer_email),
                          ('name', 'ilike', parts)],
                    limit=1)
    return ids[0] if ids else False


def cliente_alta(payload):
    """Crea res.partner + round.subscription + (mandato SEPA si aplica) + 1ª factura."""
    odoo = get_client()
    cli = payload['cliente']
    cuota = payload['cuota']
    forma = payload.get('forma_pago', {}) or {}

    # 1) Partner
    partner_vals = {
        'name':       f"{cli['nombre']} {cli['apellidos']}".strip(),
        'email':      cli.get('email'),
        'phone':      cli.get('movil'),
        'customer_rank': 1,
        'id_noofit':  str(cli['id_noofit']),
        'company_id': config.DEFAULT_COMPANY_ID,
        'estado_facturacion': 'activo',
    }
    trainer_id = _resolve_trainer_analytic(odoo, payload.get('trainer'))
    if trainer_id:
        partner_vals['trainer_analytic_id'] = trainer_id

    partner_id, created = odoo.find_or_create_partner(cli['dni'], partner_vals)
    log.info(f"Partner {'creado' if created else 'actualizado'}: id={partner_id}")

    # 2) Cuota
    cuota_id = odoo.find_cuota_by_codigo(cuota['codigo'])
    if not cuota_id:
        cuota_id = odoo.call('round.cuota.catalogo', 'create', {
            'codigo': cuota['codigo'],
            'descripcion': cuota.get('descripcion', cuota['codigo']),
            'precio_mensual':    cuota['importe_base'] if cuota.get('periodicidad')=='mensual'    else 0,
            'precio_trimestral': cuota['importe_base'] if cuota.get('periodicidad')=='trimestral' else 0,
            'precio_semestral':  cuota['importe_base'] if cuota.get('periodicidad')=='semestral'  else 0,
            'precio_anual':      cuota['importe_base'] if cuota.get('periodicidad')=='anual'      else 0,
            'matricula': cuota.get('matricula', 0),
            'company_id': config.DEFAULT_COMPANY_ID,
        })
        log.info(f"Cuota auto-creada en catálogo: {cuota['codigo']} → {cuota_id}")

    # 3) Mandato SEPA (si forma_pago = sepa)
    mandate_id = False
    if forma.get('tipo') == 'sepa' and forma.get('iban'):
        # Crear cuenta bancaria del partner
        acc_ids = odoo.call('res.partner.bank', 'search',
            [('partner_id', '=', partner_id), ('acc_number', '=', forma['iban'])],
            limit=1)
        if acc_ids:
            acc_id = acc_ids[0]
        else:
            acc_id = odoo.call('res.partner.bank', 'create', {
                'partner_id': partner_id,
                'acc_number': forma['iban'],
                'company_id': config.DEFAULT_COMPANY_ID,
            })
        # Crear mandato
        mandato_data = forma.get('mandato', {}) or {}
        mandate_id = odoo.call('account.banking.mandate', 'create', {
            'partner_bank_id': acc_id,
            'partner_id': partner_id,
            'company_id': config.DEFAULT_COMPANY_ID,
            'format': 'sepa',
            'type': 'recurrent',
            'recurrent_sequence_type': 'first',
            'signature_date': mandato_data.get('fecha_firma', datetime.utcnow().isoformat())[:10],
            'state': 'draft',
        })
        odoo.call('account.banking.mandate', 'validate', [mandate_id])
        log.info(f"Mandato SEPA creado y validado: {mandate_id}")

    # 4) Suscripción
    sub_vals = {
        'partner_id': partner_id,
        'cuota_id':   cuota_id,
        'periodicidad': cuota.get('periodicidad', 'mensual'),
        'forma_pago': forma.get('tipo', 'sepa'),
        'mandate_id': mandate_id or False,
        'fecha_inicio': cli.get('fecha_alta', datetime.utcnow().date().isoformat()),
        'estado': 'activa',
        'trainer_analytic_id': trainer_id or False,
        'company_id': config.DEFAULT_COMPANY_ID,
    }
    # Aplicar descuentos
    desc_ids = []
    for d in payload.get('descuentos', []):
        did = odoo.find_descuento_by_codigo(d['codigo'])
        if did:
            desc_ids.append(did)
    if desc_ids:
        sub_vals['descuentos_activos_ids'] = [(6, 0, desc_ids)]

    sub_id = odoo.call('round.subscription', 'create', sub_vals)
    log.info(f"Suscripción creada: {sub_id}")

    return {
        'ok': True,
        'partner_id': partner_id,
        'subscription_id': sub_id,
        'mandate_id': mandate_id,
        'cuota_id': cuota_id,
    }


def cliente_modificado(payload):
    """Actualiza datos del partner (email, teléfono, etc.)."""
    odoo = get_client()
    cli = payload['cliente']
    pid = odoo.find_partner_by_dni(cli['dni'])
    if not pid:
        return {'ok': False, 'error': 'partner_not_found'}
    update = {}
    if 'email' in cli:        update['email']        = cli['email']
    if 'movil' in cli:        update['phone']        = cli['movil']
    if 'nombre' in cli:       update['name']         = f"{cli['nombre']} {cli.get('apellidos', '')}".strip()
    if update:
        odoo.call('res.partner', 'write', [pid], update)
    return {'ok': True, 'partner_id': pid, 'updated': list(update.keys())}


def cliente_iban_actualizado(payload):
    """Cambia IBAN: revoca mandato anterior, crea uno nuevo."""
    odoo = get_client()
    cli = payload['cliente']
    nuevo_iban = payload['iban']
    pid = odoo.find_partner_by_dni(cli['dni'])
    if not pid:
        return {'ok': False, 'error': 'partner_not_found'}

    # Revocar mandatos válidos anteriores
    mandatos_viejos = odoo.call('account.banking.mandate', 'search',
        [('partner_id', '=', pid), ('state', '=', 'valid')])
    for m in mandatos_viejos:
        odoo.call('account.banking.mandate', 'cancel', [m])

    # Crear cuenta bancaria nueva
    acc_id = odoo.call('res.partner.bank', 'create', {
        'partner_id': pid,
        'acc_number': nuevo_iban,
        'company_id': config.DEFAULT_COMPANY_ID,
    })
    mandato_data = payload.get('mandato', {}) or {}
    new_mandate = odoo.call('account.banking.mandate', 'create', {
        'partner_bank_id': acc_id,
        'partner_id': pid,
        'company_id': config.DEFAULT_COMPANY_ID,
        'format': 'sepa',
        'type': 'recurrent',
        'recurrent_sequence_type': 'first',
        'signature_date': mandato_data.get('fecha_firma', datetime.utcnow().date().isoformat())[:10],
        'state': 'draft',
    })
    odoo.call('account.banking.mandate', 'validate', [new_mandate])

    # Actualizar suscripciones SEPA del partner
    subs = odoo.call('round.subscription', 'search',
        [('partner_id', '=', pid), ('forma_pago', '=', 'sepa'),
         ('estado', 'in', ['activa', 'suspendida'])])
    if subs:
        odoo.call('round.subscription', 'write', subs, {'mandate_id': new_mandate})

    return {
        'ok': True, 'partner_id': pid, 'old_mandates_canceled': mandatos_viejos,
        'new_mandate_id': new_mandate, 'subscriptions_updated': subs,
    }


def cliente_baja(payload):
    """Marca el partner como baja, cancela todas sus suscripciones."""
    odoo = get_client()
    cli = payload['cliente']
    pid = odoo.find_partner_by_dni(cli['dni'])
    if not pid:
        return {'ok': False, 'error': 'partner_not_found'}

    # Cancelar todas las suscripciones activas
    subs = odoo.call('round.subscription', 'search',
        [('partner_id', '=', pid), ('estado', 'in', ['activa', 'suspendida'])])
    for s in subs:
        odoo.call('round.subscription', 'action_cancelar', [s])

    odoo.call('res.partner', 'write', [pid], {
        'estado_facturacion': 'baja',
        'fecha_baja_facturacion': datetime.utcnow().date().isoformat(),
    })
    return {'ok': True, 'partner_id': pid, 'subs_cancelled': subs}
