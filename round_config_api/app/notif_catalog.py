"""Catálogo FIJO de secciones y tipos de notificación.

No es editable por managers — son enums hardcoded. Si se añade un tipo:
  1. Añadirlo aquí
  2. Espejarlo en `src/utils/notifCatalog.js`
  3. Si es automático, implementar la lógica que lo dispara

Diseño: las secciones son grupos visuales (Cobros / Clases / Centro / Noticias).
Los tipos viven dentro de una sección y describen el motivo concreto. La app
mynoofit puede agrupar la bandeja de notificaciones por sección con un icono.
"""

# ── SECCIONES ──────────────────────────────────────────────────────────────
SECCIONES = [
    {
        'id': 'cobros',
        'nombre': 'Cobros',
        'icon': 'receipt',
        'color': 'amber',
        'descripcion': 'Recibos, devoluciones, enlaces de pago',
        'orden': 1,
    },
    {
        'id': 'clases',
        'nombre': 'Clases',
        'icon': 'calendar',
        'color': 'blue',
        'descripcion': 'Cambios de hora, monitor, cancelaciones',
        'orden': 2,
    },
    {
        'id': 'centro',
        'nombre': 'Centro',
        'icon': 'building-2',
        'color': 'purple',
        'descripcion': 'Cierres, cambios de horario, eventos',
        'orden': 3,
    },
    {
        'id': 'noticias',
        'nombre': 'Noticias',
        'icon': 'newspaper',
        'color': 'green',
        'descripcion': 'Noticias y comunicaciones HTML',
        'orden': 4,
    },
]


# ── TIPOS (per sección) ────────────────────────────────────────────────────
# Cada tipo declara:
#   id, seccion, nombre, descripcion, auto (si lo dispara un cron/webhook),
#   plantilla_titulo y plantilla_cuerpo (con variables {{var}}).
TIPOS = [
    # ─── Cobros ───
    {
        'id': 'impago_efectivo',
        'seccion': 'cobros',
        'nombre': 'Recibo impagado (efectivo)',
        'descripcion': 'Recibo emitido en efectivo y todavía sin cobrar el día configurado.',
        'auto': True,
        'plantilla_titulo': 'Recibo pendiente',
        'plantilla_cuerpo': 'Tienes un recibo de {{importe}} € pendiente de cobro en efectivo. Pásate por el centro o paga con tarjeta.',
    },
    {
        'id': 'devolucion',
        'seccion': 'cobros',
        'nombre': 'Devolución SEPA',
        'descripcion': 'Tu banco ha devuelto un cobro SEPA. Hay que regularizar.',
        'auto': True,
        'plantilla_titulo': 'Recibo devuelto por tu banco',
        'plantilla_cuerpo': 'Tu banco ha devuelto el recibo de {{importe}} €. Por favor regularízalo en el centro.',
    },
    {
        'id': 'enlace_pago',
        'seccion': 'cobros',
        'nombre': 'Enlace de pago',
        'descripcion': 'Te mandamos un enlace para pagar online.',
        'auto': False,  # se manda manualmente al generar el link PayComet
        'plantilla_titulo': 'Enlace de pago',
        'plantilla_cuerpo': 'Tienes un pago pendiente de {{importe}} €. Págalo aquí: {{url}}',
    },
    {
        'id': 'pago_alta',
        'seccion': 'cobros',
        'nombre': 'Pago de alta confirmado',
        'descripcion': 'Confirmación tras un pago exitoso (alta nueva o renovación).',
        'auto': True,  # disparado por callback PayComet
        'plantilla_titulo': '¡Pago recibido!',
        'plantilla_cuerpo': 'Hemos recibido tu pago de {{importe}} €. Ya puedes acceder al centro.',
    },
    {
        'id': 'cobros_otro',
        'seccion': 'cobros',
        'nombre': 'Otra notificación de cobros',
        'descripcion': 'Mensaje libre dentro de la sección cobros.',
        'auto': False,
        'plantilla_titulo': '',
        'plantilla_cuerpo': '',
    },

    # ─── Clases ───
    {
        'id': 'cambio_hora',
        'seccion': 'clases',
        'nombre': 'Cambio de hora',
        'descripcion': 'Una clase a la que estás apuntado cambia de hora.',
        'auto': False,
        'plantilla_titulo': 'Cambio de hora en tu clase',
        'plantilla_cuerpo': 'La clase {{clase}} del {{fecha}} pasa a las {{nueva_hora}}.',
    },
    {
        'id': 'cambio_monitor',
        'seccion': 'clases',
        'nombre': 'Cambio de monitor',
        'descripcion': 'El monitor titular de una clase cambia.',
        'auto': False,
        'plantilla_titulo': 'Cambio de monitor',
        'plantilla_cuerpo': 'La clase {{clase}} del {{fecha}} la imparte {{monitor}}.',
    },
    {
        'id': 'clase_cancelada',
        'seccion': 'clases',
        'nombre': 'Clase cancelada',
        'descripcion': 'Una clase a la que estás apuntado se cancela.',
        'auto': False,
        'plantilla_titulo': 'Clase cancelada',
        'plantilla_cuerpo': 'Lo sentimos, la clase {{clase}} del {{fecha}} se ha cancelado.',
    },
    {
        'id': 'clase_interes',
        'seccion': 'clases',
        'nombre': 'Información de interés',
        'descripcion': 'Mensaje libre relativo a clases.',
        'auto': False,
        'plantilla_titulo': '',
        'plantilla_cuerpo': '',
    },

    # ─── Centro ───
    {
        'id': 'cierre',
        'seccion': 'centro',
        'nombre': 'Cierre / festivo',
        'descripcion': 'El centro cierra un día concreto.',
        'auto': False,
        'plantilla_titulo': 'Cierre del centro',
        'plantilla_cuerpo': 'El {{fecha}} el centro permanecerá cerrado por {{motivo}}.',
    },
    {
        'id': 'cambio_horario',
        'seccion': 'centro',
        'nombre': 'Cambio de horario',
        'descripcion': 'Cambio de horarios del centro.',
        'auto': False,
        'plantilla_titulo': 'Nuevo horario del centro',
        'plantilla_cuerpo': 'A partir del {{fecha}} el centro abre de {{hora_apertura}} a {{hora_cierre}}.',
    },
    {
        'id': 'evento',
        'seccion': 'centro',
        'nombre': 'Evento / actividad especial',
        'descripcion': 'Anuncio de eventos, actividades especiales, etc.',
        'auto': False,
        'plantilla_titulo': '',
        'plantilla_cuerpo': '',
    },
    {
        'id': 'centro_otro',
        'seccion': 'centro',
        'nombre': 'Otra notificación del centro',
        'descripcion': 'Mensaje libre.',
        'auto': False,
        'plantilla_titulo': '',
        'plantilla_cuerpo': '',
    },

    # ─── Noticias ───
    {
        'id': 'noticia',
        'seccion': 'noticias',
        'nombre': 'Noticia',
        'descripcion': 'Comunicación con cuerpo HTML para webview.',
        'auto': False,
        'plantilla_titulo': '',
        'plantilla_cuerpo': '',
    },
]


# ── Helpers de lookup ──────────────────────────────────────────────────────
SECCIONES_BY_ID = {s['id']: s for s in SECCIONES}
TIPOS_BY_ID = {t['id']: t for t in TIPOS}


def is_seccion_valida(seccion_id: str) -> bool:
    return seccion_id in SECCIONES_BY_ID


def is_tipo_valido(tipo_id: str, seccion_id: str = None) -> bool:
    t = TIPOS_BY_ID.get(tipo_id)
    if not t:
        return False
    if seccion_id and t['seccion'] != seccion_id:
        return False
    return True


def get_plantilla(tipo_id: str) -> dict:
    """Devuelve {titulo, cuerpo} default del tipo. Si no existe, vacío."""
    t = TIPOS_BY_ID.get(tipo_id)
    if not t:
        return {'titulo': '', 'cuerpo': ''}
    return {'titulo': t.get('plantilla_titulo', ''), 'cuerpo': t.get('plantilla_cuerpo', '')}


def render_plantilla(plantilla: str, vars_dict: dict) -> str:
    """Sustituye {{var}} por su valor. Variables no presentes se dejan vacías."""
    if not plantilla:
        return ''
    out = plantilla
    for k, v in (vars_dict or {}).items():
        out = out.replace('{{' + k + '}}', str(v) if v is not None else '')
    # limpieza de variables no resueltas
    import re
    out = re.sub(r'\{\{[a-zA-Z_][a-zA-Z0-9_]*\}\}', '', out)
    return out
