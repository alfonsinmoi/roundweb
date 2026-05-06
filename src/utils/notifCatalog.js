// Espejo del catálogo backend (round_config_api/app/notif_catalog.py).
// Si añades un tipo aquí, añádelo también en Python.

export const NOTIF_SECCIONES = [
  { id: 'cobros',   nombre: 'Cobros',   icon: 'receipt',     color: 'amber',  orden: 1 },
  { id: 'clases',   nombre: 'Clases',   icon: 'calendar',    color: 'blue',   orden: 2 },
  { id: 'centro',   nombre: 'Centro',   icon: 'building-2',  color: 'purple', orden: 3 },
  { id: 'noticias', nombre: 'Noticias', icon: 'newspaper',   color: 'green',  orden: 4 },
]

export const NOTIF_TIPOS = [
  // Cobros
  { id: 'impago_efectivo', seccion: 'cobros',   nombre: 'Recibo impagado (efectivo)', auto: true,  descripcion: 'Recibo emitido en efectivo y todavía sin cobrar el día configurado.' },
  { id: 'devolucion',      seccion: 'cobros',   nombre: 'Devolución SEPA',            auto: true,  descripcion: 'Tu banco ha devuelto un cobro SEPA.' },
  { id: 'enlace_pago',     seccion: 'cobros',   nombre: 'Enlace de pago',             auto: false, descripcion: 'Mandar un enlace para pagar online.' },
  { id: 'pago_alta',       seccion: 'cobros',   nombre: 'Pago de alta confirmado',    auto: true,  descripcion: 'Confirmación tras un pago exitoso.' },
  { id: 'cobros_otro',     seccion: 'cobros',   nombre: 'Otra (cobros)',              auto: false, descripcion: 'Mensaje libre de la sección cobros.' },
  // Clases
  { id: 'cambio_hora',     seccion: 'clases',   nombre: 'Cambio de hora',             auto: false },
  { id: 'cambio_monitor',  seccion: 'clases',   nombre: 'Cambio de monitor',          auto: false },
  { id: 'clase_cancelada', seccion: 'clases',   nombre: 'Clase cancelada',            auto: false },
  { id: 'clase_interes',   seccion: 'clases',   nombre: 'Información de interés',     auto: false },
  // Centro
  { id: 'cierre',          seccion: 'centro',   nombre: 'Cierre / festivo',           auto: false },
  { id: 'cambio_horario',  seccion: 'centro',   nombre: 'Cambio de horario',          auto: false },
  { id: 'evento',          seccion: 'centro',   nombre: 'Evento / actividad especial', auto: false },
  { id: 'centro_otro',     seccion: 'centro',   nombre: 'Otra (centro)',              auto: false },
  // Noticias
  { id: 'noticia',         seccion: 'noticias', nombre: 'Noticia',                    auto: false, descripcion: 'Comunicación con cuerpo HTML.' },
]

export const SECCION_BY_ID = Object.fromEntries(NOTIF_SECCIONES.map(s => [s.id, s]))
export const TIPO_BY_ID    = Object.fromEntries(NOTIF_TIPOS.map(t => [t.id, t]))

export function tiposDeSeccion(seccionId) {
  return NOTIF_TIPOS.filter(t => t.seccion === seccionId)
}
