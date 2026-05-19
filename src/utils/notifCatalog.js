// Espejo del catálogo backend (round_config_api/app/notif_catalog.py).
// Si añades un tipo aquí, añádelo también en Python.

export const NOTIF_SECCIONES = [
  { id: 'cobros',   nombre: 'Cobros',   icon: 'receipt',     color: 'amber',  orden: 1 },
  { id: 'clases',   nombre: 'Clases',   icon: 'calendar',    color: 'blue',   orden: 2 },
  { id: 'centro',   nombre: 'Centro',   icon: 'building-2',  color: 'purple', orden: 3 },
  { id: 'noticias', nombre: 'Noticias', icon: 'newspaper',   color: 'green',  orden: 4 },
]

// Plantillas por defecto del sistema. Si el manager las deja vacías en
// Configuración → Notificaciones se usan estas. Mantener sincronizado con
// round_config_api/app/notif_catalog.py.
export const NOTIF_TIPOS = [
  // Cobros
  { id: 'impago_efectivo', seccion: 'cobros',   nombre: 'Recibo impagado (efectivo)', auto: true,
    descripcion: 'Recibo emitido en efectivo y todavía sin cobrar el día configurado.',
    plantilla_titulo: 'Recibo pendiente',
    plantilla_cuerpo: 'Tienes un recibo de {{importe}} € pendiente de cobro en efectivo. Pásate por el centro o paga con tarjeta.' },
  { id: 'devolucion',      seccion: 'cobros',   nombre: 'Devolución SEPA',            auto: true,
    descripcion: 'Tu banco ha devuelto un cobro SEPA.',
    plantilla_titulo: 'Recibo devuelto por tu banco',
    plantilla_cuerpo: 'Tu banco ha devuelto el recibo de {{importe}} €. Por favor regularízalo en el centro.' },
  { id: 'enlace_pago',     seccion: 'cobros',   nombre: 'Enlace de pago',             auto: false,
    descripcion: 'Mandar un enlace para pagar online.',
    plantilla_titulo: 'Enlace de pago',
    plantilla_cuerpo: 'Tienes un pago pendiente de {{importe}} €. Págalo aquí: {{url}}' },
  { id: 'pago_alta',       seccion: 'cobros',   nombre: 'Pago de alta confirmado',    auto: true,
    descripcion: 'Confirmación tras un pago exitoso.',
    plantilla_titulo: '¡Pago recibido!',
    plantilla_cuerpo: 'Hemos recibido tu pago de {{importe}} €. Ya puedes acceder al centro.' },
  { id: 'cobros_otro',     seccion: 'cobros',   nombre: 'Otra (cobros)',              auto: false,
    descripcion: 'Mensaje libre de la sección cobros.',
    plantilla_titulo: '', plantilla_cuerpo: '' },
  // Clases
  { id: 'cambio_hora',     seccion: 'clases',   nombre: 'Cambio de hora',             auto: false,
    plantilla_titulo: 'Cambio de hora en tu clase',
    plantilla_cuerpo: 'La clase {{clase}} del {{fecha}} pasa a las {{nueva_hora}}.' },
  { id: 'cambio_monitor',  seccion: 'clases',   nombre: 'Cambio de monitor',          auto: false,
    plantilla_titulo: 'Cambio de monitor',
    plantilla_cuerpo: 'La clase {{clase}} del {{fecha}} la imparte {{monitor}}.' },
  { id: 'clase_cancelada', seccion: 'clases',   nombre: 'Clase cancelada',            auto: false,
    plantilla_titulo: 'Clase cancelada',
    plantilla_cuerpo: 'Lo sentimos, la clase {{clase}} del {{fecha}} se ha cancelado.' },
  { id: 'clase_interes',   seccion: 'clases',   nombre: 'Información de interés',     auto: false,
    plantilla_titulo: '', plantilla_cuerpo: '' },
  // Centro
  { id: 'cierre',          seccion: 'centro',   nombre: 'Cierre / festivo',           auto: false,
    plantilla_titulo: 'Cierre del centro',
    plantilla_cuerpo: 'El {{fecha}} el centro permanecerá cerrado por {{motivo}}.' },
  { id: 'cambio_horario',  seccion: 'centro',   nombre: 'Cambio de horario',          auto: false,
    plantilla_titulo: 'Nuevo horario del centro',
    plantilla_cuerpo: 'A partir del {{fecha}} el centro abre de {{hora_apertura}} a {{hora_cierre}}.' },
  { id: 'evento',          seccion: 'centro',   nombre: 'Evento / actividad especial', auto: false,
    plantilla_titulo: '', plantilla_cuerpo: '' },
  { id: 'centro_otro',     seccion: 'centro',   nombre: 'Otra (centro)',              auto: false,
    plantilla_titulo: '', plantilla_cuerpo: '' },
  // Noticias
  { id: 'noticia',         seccion: 'noticias', nombre: 'Noticia',                    auto: false,
    descripcion: 'Comunicación con cuerpo HTML.',
    plantilla_titulo: '', plantilla_cuerpo: '' },
]

export const SECCION_BY_ID = Object.fromEntries(NOTIF_SECCIONES.map(s => [s.id, s]))
export const TIPO_BY_ID    = Object.fromEntries(NOTIF_TIPOS.map(t => [t.id, t]))

export function tiposDeSeccion(seccionId) {
  return NOTIF_TIPOS.filter(t => t.seccion === seccionId)
}
