"""Handlers para los 11 eventos NoofitPro → Odoo.

Cada handler recibe un dict `payload` con la info del webhook y devuelve
un dict con el resultado para devolver a NoofitPro.
"""
from . import cliente, cuota, modificacion, descuento

HANDLERS = {
    # 11 eventos del documento de arquitectura, sección 4.1
    'cliente.alta':              cliente.cliente_alta,
    'cliente.modificado':        cliente.cliente_modificado,
    'cliente.iban_actualizado':  cliente.cliente_iban_actualizado,
    'cliente.baja':              cliente.cliente_baja,
    'cuota.asignada':            cuota.cuota_asignada,
    'cuota.cambio':              cuota.cuota_cambio,
    'cuota.baja':                cuota.cuota_baja,
    'modificacion.creada':       modificacion.modificacion_creada,
    'modificacion.eliminada':    modificacion.modificacion_eliminada,
    'descuento.activado':        descuento.descuento_activado,
    'descuento.desactivado':     descuento.descuento_desactivado,
}


def get_handler(evento):
    return HANDLERS.get(evento)
