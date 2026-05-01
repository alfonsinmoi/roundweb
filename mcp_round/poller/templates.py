"""Plantillas HTML para los push del cliente."""

# Variables disponibles: {nombre}, {centro}, {centro_telefono}, {importe}, {mes},
#                        {año}, {fecha_emision}, {fecha_cargo}, {forma_pago},
#                        {link}, {caducidad}, {codigo_devolucion}

PLANTILLAS = {
    'recibo.cobrado_sepa': {
        'asunto': 'Pago registrado',
        'cuerpo': """
            <p>Hola {nombre},</p>
            <p>Hemos registrado tu pago de <strong>{importe} €</strong> de {mes}.</p>
            <p>Gracias.</p>
            <p><em>{centro}</em></p>
        """,
    },
    'recibo.cobrado_tarjeta': {
        'asunto': 'Pago con tarjeta confirmado',
        'cuerpo': """
            <p>Hola {nombre},</p>
            <p>Tu pago con tarjeta de <strong>{importe} €</strong> ({mes}) se ha confirmado.</p>
            <p>Recibirás el justificante por email.</p>
            <p><em>{centro}</em></p>
        """,
    },
    'recibo.devolucion_sepa': {
        'asunto': 'Tu pago ha sido devuelto',
        'cuerpo': """
            <p>Hola {nombre},</p>
            <p>Tu cuota de {mes} (<strong>{importe} €</strong>) ha sido devuelta por el banco
               (código <code>{codigo_devolucion}</code>).</p>
            <p>Para regularizar, accede a la app y elige una forma de pago alternativa,
               o contacta con tu centro:</p>
            <p>📞 <strong>{centro_telefono}</strong></p>
            <p><em>{centro}</em></p>
        """,
    },
    'recibo.impagado': {
        'asunto': 'Recibo pendiente',
        'cuerpo': """
            <p>Hola {nombre},</p>
            <p>Tenemos pendiente tu cuota de {mes} (<strong>{importe} €</strong>).</p>
            <p>Por favor regulariza desde la app o contacta con tu centro:</p>
            <p>📞 <strong>{centro_telefono}</strong></p>
            <p><em>{centro}</em></p>
        """,
    },
    'cliente.suspender': {
        'asunto': 'Acceso suspendido',
        'cuerpo': """
            <p>Hola {nombre},</p>
            <p>Tu acceso al centro ha sido suspendido por impago.
               Para regularizar contacta con tu centro:</p>
            <p>📞 <strong>{centro_telefono}</strong></p>
            <p><em>{centro}</em></p>
        """,
    },
    'cliente.reactivar': {
        'asunto': 'Acceso reactivado',
        'cuerpo': """
            <p>Hola {nombre},</p>
            <p>¡Bienvenido de vuelta! Tu acceso al centro ha sido reactivado.</p>
            <p><em>{centro}</em></p>
        """,
    },
}


def render(template_id, vars_dict):
    """Renderiza una plantilla. Devuelve (asunto, cuerpo_html) o (None, None)."""
    tpl = PLANTILLAS.get(template_id)
    if not tpl:
        return None, None
    safe_vars = {k: '' for k in [
        'nombre', 'centro', 'centro_telefono', 'importe', 'mes', 'año',
        'fecha_emision', 'fecha_cargo', 'forma_pago', 'link', 'caducidad',
        'codigo_devolucion',
    ]}
    safe_vars.update({k: ('' if v is None else v) for k, v in vars_dict.items()})
    return (
        tpl['asunto'].format(**safe_vars),
        tpl['cuerpo'].format(**safe_vars).strip(),
    )
