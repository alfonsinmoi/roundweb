// ── Mock Data for Round Fitness Management ──────────────────────────────────

export const CREDENTIALS = { username: 'admin', password: 'round2024' }

// ── Monitores ────────────────────────────────────────────────────────────────
export const monitores = [
  { id: 1, nombre: 'Carlos', apellidos: 'Ruiz Martínez', email: 'carlos@roundfit.es', telefono: '612 345 678', especialidad: 'EMS Personal', activo: true, clientes: 12, foto: null },
  { id: 2, nombre: 'Laura',  apellidos: 'Gómez Pérez',   email: 'laura@roundfit.es',  telefono: '623 456 789', especialidad: 'Funcional & HIIT', activo: true, clientes: 9, foto: null },
  { id: 3, nombre: 'Sergio', apellidos: 'Torres Vidal',  email: 'sergio@roundfit.es', telefono: '634 567 890', especialidad: 'Recuperación & Fisio', activo: false, clientes: 5, foto: null },
]

// ── Zonas corporales ─────────────────────────────────────────────────────────
export const zonasCorporales = [
  { id: 1, nombre: 'Pectorales' }, { id: 2, nombre: 'Dorsales' },
  { id: 3, nombre: 'Hombros' },    { id: 4, nombre: 'Bíceps' },
  { id: 5, nombre: 'Tríceps' },    { id: 6, nombre: 'Abdominales' },
  { id: 7, nombre: 'Lumbares' },   { id: 8, nombre: 'Glúteos' },
  { id: 9, nombre: 'Cuádriceps' }, { id: 10, nombre: 'Isquiotibiales' },
  { id: 11, nombre: 'Pantorrillas' },
]

// ── Ejercicios ───────────────────────────────────────────────────────────────
export const ejercicios = [
  { id: 1, nombre: 'Press de pecho', zona: 'Pectorales', tipo: 'Fuerza', material: 'Mancuernas', descripcion: 'Empuje horizontal de pecho con mancuernas', nivel: 'Medio', duracion: 45 },
  { id: 2, nombre: 'Sentadilla búlgara', zona: 'Cuádriceps', tipo: 'Fuerza', material: 'Banco', descripcion: 'Sentadilla unilateral con pie elevado', nivel: 'Avanzado', duracion: 50 },
  { id: 3, nombre: 'Plancha abdominal', zona: 'Abdominales', tipo: 'Resistencia', material: 'Sin material', descripcion: 'Posición isométrica de plancha', nivel: 'Básico', duracion: 60 },
  { id: 4, nombre: 'Hip Thrust', zona: 'Glúteos', tipo: 'Fuerza', material: 'Barra', descripcion: 'Empuje de cadera en banco', nivel: 'Medio', duracion: 45 },
  { id: 5, nombre: 'Remo con mancuerna', zona: 'Dorsales', tipo: 'Fuerza', material: 'Mancuernas', descripcion: 'Tirón unilateral en apoyo', nivel: 'Básico', duracion: 45 },
  { id: 6, nombre: 'Burpee', zona: 'Full Body', tipo: 'HIIT', material: 'Sin material', descripcion: 'Movimiento funcional completo', nivel: 'Avanzado', duracion: 30 },
  { id: 7, nombre: 'Press militar', zona: 'Hombros', tipo: 'Fuerza', material: 'Barra', descripcion: 'Empuje vertical sobre hombros', nivel: 'Medio', duracion: 45 },
  { id: 8, nombre: 'Curl de bíceps', zona: 'Bíceps', tipo: 'Fuerza', material: 'Mancuernas', descripcion: 'Flexión de codo con supinación', nivel: 'Básico', duracion: 40 },
  { id: 9, nombre: 'Extensión de tríceps', zona: 'Tríceps', tipo: 'Fuerza', material: 'Polea', descripcion: 'Extensión de codo en polea alta', nivel: 'Básico', duracion: 40 },
  { id: 10, nombre: 'Step Up', zona: 'Cuádriceps', tipo: 'Funcional', material: 'Banco', descripcion: 'Subida a banco unilateral', nivel: 'Básico', duracion: 45 },
  { id: 11, nombre: 'Peso muerto rumano', zona: 'Isquiotibiales', tipo: 'Fuerza', material: 'Barra', descripcion: 'Bisagra de cadera con barra', nivel: 'Medio', duracion: 50 },
  { id: 12, nombre: 'Mountain Climber', zona: 'Abdominales', tipo: 'HIIT', material: 'Sin material', descripcion: 'Escalador en posición de plancha', nivel: 'Medio', duracion: 30 },
]

// ── Entrenamientos (programas) ────────────────────────────────────────────────
export const entrenamientos = [
  {
    id: 1, nombre: 'EMS Full Body Básico', descripcion: 'Programa de iniciación con EMS. Adaptación al estímulo eléctrico y fuerza general.',
    duracion: 20, frecuencia: '2x semana', nivel: 'Básico', ejercicios: [1, 3, 5, 8], sesiones: 8,
    creado: '2024-01-10', monitor: 1,
  },
  {
    id: 2, nombre: 'Hipertrofia EMS Avanzado', descripcion: 'Trabajo de fuerza e hipertrofia con corriente de media frecuencia.',
    duracion: 20, frecuencia: '2x semana', nivel: 'Avanzado', ejercicios: [1, 2, 4, 7, 11], sesiones: 12,
    creado: '2024-02-15', monitor: 1,
  },
  {
    id: 3, nombre: 'HIIT Metabólico', descripcion: 'Alta intensidad con intervalos cortos. Quema calórica máxima.',
    duracion: 30, frecuencia: '3x semana', nivel: 'Avanzado', ejercicios: [6, 12, 3, 10], sesiones: 16,
    creado: '2024-03-01', monitor: 2,
  },
  {
    id: 4, nombre: 'Rehabilitación Lumbar', descripcion: 'Fortalecimiento y movilidad para zona lumbar. Enfoque terapéutico.',
    duracion: 25, frecuencia: '2x semana', nivel: 'Básico', ejercicios: [3, 5, 7], sesiones: 8,
    creado: '2024-03-20', monitor: 3,
  },
]

// ── Actividades ───────────────────────────────────────────────────────────────
export const actividades = [
  { id: 1, nombre: 'EMS Personal', descripcion: 'Sesión individual con traje EMS', duracion: 20, aforo: 1, color: '#FF6B35', activa: true },
  { id: 2, nombre: 'EMS Duo', descripcion: 'Sesión para dos personas con EMS', duracion: 20, aforo: 2, color: '#4361EE', activa: true },
  { id: 3, nombre: 'HIIT Grupal', descripcion: 'Clase de alta intensidad en grupo', duracion: 45, aforo: 8, color: '#F59E0B', activa: true },
  { id: 4, nombre: 'Yoga & Movilidad', descripcion: 'Sesión de estiramiento y movilidad', duracion: 60, aforo: 10, color: '#22C55E', activa: true },
  { id: 5, nombre: 'Rehabilitación', descripcion: 'Sesión fisioterapéutica personalizada', duracion: 30, aforo: 1, color: '#8B5CF6', activa: false },
]

// ── Clases (cuotas/calendario) ────────────────────────────────────────────────
const hoy = new Date()
const fmt = (d) => d.toISOString().slice(0, 10)
const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r }

export const clases = [
  { id: 1, actividad: 1, monitor: 1, fecha: fmt(hoy), hora: '09:00', inscritos: 1, aforo: 1, sala: 'Sala EMS 1' },
  { id: 2, actividad: 1, monitor: 1, fecha: fmt(hoy), hora: '10:00', inscritos: 0, aforo: 1, sala: 'Sala EMS 1' },
  { id: 3, actividad: 2, monitor: 2, fecha: fmt(hoy), hora: '11:00', inscritos: 2, aforo: 2, sala: 'Sala EMS 2' },
  { id: 4, actividad: 3, monitor: 2, fecha: fmt(addDays(hoy, 1)), hora: '17:00', inscritos: 5, aforo: 8, sala: 'Sala Grupal' },
  { id: 5, actividad: 4, monitor: 3, fecha: fmt(addDays(hoy, 1)), hora: '09:30', inscritos: 7, aforo: 10, sala: 'Sala Grupal' },
  { id: 6, actividad: 1, monitor: 1, fecha: fmt(addDays(hoy, 2)), hora: '10:00', inscritos: 1, aforo: 1, sala: 'Sala EMS 1' },
  { id: 7, actividad: 3, monitor: 2, fecha: fmt(addDays(hoy, 3)), hora: '18:00', inscritos: 3, aforo: 8, sala: 'Sala Grupal' },
  { id: 8, actividad: 1, monitor: 1, fecha: fmt(addDays(hoy, -1)), hora: '09:00', inscritos: 1, aforo: 1, sala: 'Sala EMS 1' },
  { id: 9, actividad: 2, monitor: 1, fecha: fmt(addDays(hoy, -2)), hora: '11:00', inscritos: 2, aforo: 2, sala: 'Sala EMS 2' },
]

// ── Dispositivos ──────────────────────────────────────────────────────────────
export const dispositivos = [
  { id: 1, nombre: 'EMS Pro X1', serial: 'EMX-001-2023', firmware: '3.2.1', bateria: 87, minutosComprados: 500, minutosConsumidos: 324, estado: 'Activo', ultimoUso: '2024-03-19', cliente: null },
  { id: 2, nombre: 'EMS Pro X1', serial: 'EMX-002-2023', firmware: '3.2.1', bateria: 45, minutosComprados: 300, minutosConsumidos: 298, estado: 'Activo', ultimoUso: '2024-03-20', cliente: 2 },
  { id: 3, nombre: 'EMS Pro X2', serial: 'EMX-003-2024', firmware: '4.0.0', bateria: 92, minutosComprados: 1000, minutosConsumidos: 12, estado: 'Activo', ultimoUso: '2024-03-18', cliente: null },
  { id: 4, nombre: 'HR Monitor', serial: 'HRM-021-2023', firmware: '2.1.0', bateria: 100, minutosComprados: null, minutosConsumidos: null, estado: 'Activo', ultimoUso: '2024-03-20', cliente: 1 },
  { id: 5, nombre: 'EMS Pro X1', serial: 'EMX-005-2022', firmware: '3.1.0', bateria: 12, minutosComprados: 200, minutosConsumidos: 200, estado: 'Mantenimiento', ultimoUso: '2024-02-28', cliente: null },
]

// ── Clientes ──────────────────────────────────────────────────────────────────
export const clientes = [
  {
    id: 1,
    nombre: 'María', apellidos: 'López Fernández',
    email: 'maria.lopez@email.com', telefono: '666 111 222',
    fechaNacimiento: '1990-05-12', genero: 'F',
    altura: 165, peso: 62, imc: 22.8,
    objetivo: 'Tonificación y pérdida de grasa',
    nivelConocimiento: 'Básico',
    monitor: 1, activo: true, archivado: false,
    fechaAlta: '2023-09-15',
    // PAR-Q / médico
    parQ: { cardiopatia: false, dolores: false, desmayos: false, diabetes: false, embarazo: false, medicacion: 'Ninguna', observaciones: '' },
    fcReposo: 68, fcMax: 185, vo2max: 38,
    foto: null,
    // Entrenamientos recientes
    entrenamientosRecientes: [
      { id: 101, fecha: '2024-03-19', programa: 'EMS Full Body Básico', duracionReal: 22, fcMedia: 142, fcMax: 171, calorias: 380, completado: true },
      { id: 102, fecha: '2024-03-15', programa: 'EMS Full Body Básico', duracionReal: 20, fcMedia: 138, fcMax: 168, calorias: 355, completado: true },
      { id: 103, fecha: '2024-03-12', programa: 'EMS Full Body Básico', duracionReal: 19, fcMedia: 135, fcMax: 162, calorias: 320, completado: true },
      { id: 104, fecha: '2024-03-08', programa: 'EMS Full Body Básico', duracionReal: 20, fcMedia: 130, fcMax: 158, calorias: 310, completado: true },
      { id: 105, fecha: '2024-03-05', programa: 'EMS Full Body Básico', duracionReal: 18, fcMedia: 128, fcMax: 155, calorias: 298, completado: false },
    ],
    // Planes asignados
    planesAsignados: [
      { id: 201, entrenamiento: 1, fechaInicio: '2024-01-15', fechaFin: '2024-03-15', sesionesTotal: 16, sesionesCompletadas: 16, estado: 'Completado' },
      { id: 202, entrenamiento: 1, fechaInicio: '2024-03-20', fechaFin: '2024-05-15', sesionesTotal: 16, sesionesCompletadas: 2, estado: 'En curso' },
    ],
    // Test físicos
    testsFisicos: [
      { id: 301, fecha: '2024-01-10', tipo: 'Test inicial', edad: 33, pruebas: [
        { nombre: 'Fuerza de prensión (dcha)', valor: 28, unidad: 'kg', puntuacion: 6 },
        { nombre: 'Fuerza de prensión (izq)', valor: 25, unidad: 'kg', puntuacion: 5 },
        { nombre: 'Flexibilidad (sit & reach)', valor: 18, unidad: 'cm', puntuacion: 7 },
        { nombre: 'Resistencia (2km marcha)', valor: 14.5, unidad: 'min', puntuacion: 6 },
        { nombre: 'Equilibrio (monopodal)', valor: 35, unidad: 'seg', puntuacion: 8 },
      ]},
      { id: 302, fecha: '2024-03-15', tipo: 'Test progreso 3m', edad: 34, pruebas: [
        { nombre: 'Fuerza de prensión (dcha)', valor: 31, unidad: 'kg', puntuacion: 7 },
        { nombre: 'Fuerza de prensión (izq)', valor: 28, unidad: 'kg', puntuacion: 6 },
        { nombre: 'Flexibilidad (sit & reach)', valor: 22, unidad: 'cm', puntuacion: 8 },
        { nombre: 'Resistencia (2km marcha)', valor: 13.2, unidad: 'min', puntuacion: 7 },
        { nombre: 'Equilibrio (monopodal)', valor: 48, unidad: 'seg', puntuacion: 9 },
      ]},
    ],
    // Reservas clases
    reservasClases: [
      { id: 401, claseId: 1, actividad: 'EMS Personal', fecha: fmt(hoy), hora: '09:00', asistencia: null },
      { id: 402, claseId: 8, actividad: 'EMS Personal', fecha: fmt(addDays(hoy, -1)), hora: '09:00', asistencia: true },
      { id: 403, claseId: 9, actividad: 'EMS Duo', fecha: fmt(addDays(hoy, -2)), hora: '11:00', asistencia: true },
    ],
    // Reservas a largo plazo (bonos / suscripciones)
    reservasLargoPlazo: [
      { id: 501, tipo: 'Bono 8 sesiones EMS', fechaInicio: '2024-03-20', fechaFin: '2024-05-20', sesionesTotal: 8, sesionesUsadas: 0, precio: 280, estado: 'Activo' },
      { id: 502, tipo: 'Bono 16 sesiones EMS', fechaInicio: '2024-01-15', fechaFin: '2024-03-15', sesionesTotal: 16, sesionesUsadas: 16, precio: 480, estado: 'Completado' },
    ],
  },
  {
    id: 2,
    nombre: 'Javier', apellidos: 'Martín García',
    email: 'javier.martin@email.com', telefono: '677 333 444',
    fechaNacimiento: '1985-11-30', genero: 'M',
    altura: 178, peso: 88, imc: 27.8,
    objetivo: 'Pérdida de peso y salud cardiovascular',
    nivelConocimiento: 'Medio',
    monitor: 1, activo: true, archivado: false,
    fechaAlta: '2023-06-01',
    parQ: { cardiopatia: false, dolores: true, desmayos: false, diabetes: false, embarazo: false, medicacion: 'Ibuprofeno ocasional', observaciones: 'Dolor crónico en rodilla derecha' },
    fcReposo: 72, fcMax: 179, vo2max: 35,
    foto: null,
    entrenamientosRecientes: [
      { id: 106, fecha: '2024-03-20', programa: 'Hipertrofia EMS Avanzado', duracionReal: 20, fcMedia: 155, fcMax: 178, calorias: 420, completado: true },
      { id: 107, fecha: '2024-03-16', programa: 'Hipertrofia EMS Avanzado', duracionReal: 20, fcMedia: 150, fcMax: 175, calorias: 410, completado: true },
    ],
    planesAsignados: [
      { id: 203, entrenamiento: 2, fechaInicio: '2024-02-01', fechaFin: '2024-04-30', sesionesTotal: 24, sesionesCompletadas: 14, estado: 'En curso' },
    ],
    testsFisicos: [
      { id: 303, fecha: '2024-02-01', tipo: 'Test inicial', edad: 38, pruebas: [
        { nombre: 'Fuerza de prensión (dcha)', valor: 38, unidad: 'kg', puntuacion: 7 },
        { nombre: 'Flexibilidad (sit & reach)', valor: 8, unidad: 'cm', puntuacion: 4 },
        { nombre: 'Resistencia (2km marcha)', valor: 16.0, unidad: 'min', puntuacion: 4 },
      ]},
    ],
    reservasClases: [
      { id: 404, claseId: 2, actividad: 'EMS Personal', fecha: fmt(hoy), hora: '10:00', asistencia: null },
    ],
    reservasLargoPlazo: [
      { id: 503, tipo: 'Suscripción mensual EMS', fechaInicio: '2024-03-01', fechaFin: '2024-03-31', sesionesTotal: 8, sesionesUsadas: 5, precio: 220, estado: 'Activo' },
    ],
  },
  {
    id: 3,
    nombre: 'Ana', apellidos: 'Sánchez Torres',
    email: 'ana.sanchez@email.com', telefono: '688 555 666',
    fechaNacimiento: '1995-03-20', genero: 'F',
    altura: 170, peso: 58, imc: 20.1,
    objetivo: 'Alto rendimiento y competición',
    nivelConocimiento: 'Avanzado',
    monitor: 2, activo: true, archivado: false,
    fechaAlta: '2024-01-08',
    parQ: { cardiopatia: false, dolores: false, desmayos: false, diabetes: false, embarazo: false, medicacion: 'Ninguna', observaciones: 'Deportista de nivel regional en atletismo' },
    fcReposo: 52, fcMax: 192, vo2max: 52,
    foto: null,
    entrenamientosRecientes: [
      { id: 108, fecha: '2024-03-20', programa: 'HIIT Metabólico', duracionReal: 31, fcMedia: 172, fcMax: 191, calorias: 520, completado: true },
      { id: 109, fecha: '2024-03-18', programa: 'HIIT Metabólico', duracionReal: 30, fcMedia: 168, fcMax: 188, calorias: 498, completado: true },
      { id: 110, fecha: '2024-03-15', programa: 'HIIT Metabólico', duracionReal: 30, fcMedia: 165, fcMax: 185, calorias: 480, completado: true },
    ],
    planesAsignados: [
      { id: 204, entrenamiento: 3, fechaInicio: '2024-01-08', fechaFin: '2024-04-08', sesionesTotal: 36, sesionesCompletadas: 28, estado: 'En curso' },
    ],
    testsFisicos: [
      { id: 304, fecha: '2024-01-08', tipo: 'Test inicial', edad: 28, pruebas: [
        { nombre: 'Fuerza de prensión (dcha)', valor: 32, unidad: 'kg', puntuacion: 8 },
        { nombre: 'Flexibilidad (sit & reach)', valor: 28, unidad: 'cm', puntuacion: 9 },
        { nombre: 'Resistencia (2km marcha)', valor: 11.2, unidad: 'min', puntuacion: 10 },
        { nombre: 'Equilibrio (monopodal)', valor: 60, unidad: 'seg', puntuacion: 10 },
      ]},
    ],
    reservasClases: [
      { id: 405, claseId: 4, actividad: 'HIIT Grupal', fecha: fmt(addDays(hoy, 1)), hora: '17:00', asistencia: null },
    ],
    reservasLargoPlazo: [
      { id: 504, tipo: 'Bono 20 sesiones HIIT', fechaInicio: '2024-01-08', fechaFin: '2024-06-08', sesionesTotal: 20, sesionesUsadas: 12, precio: 320, estado: 'Activo' },
    ],
  },
  {
    id: 4,
    nombre: 'Roberto', apellidos: 'Díaz Blanco',
    email: 'roberto.diaz@email.com', telefono: '699 777 888',
    fechaNacimiento: '1978-08-05', genero: 'M',
    altura: 182, peso: 95, imc: 28.7,
    objetivo: 'Rehabilitación y vuelta al deporte',
    nivelConocimiento: 'Básico',
    monitor: 3, activo: false, archivado: true,
    fechaAlta: '2023-04-20',
    parQ: { cardiopatia: false, dolores: true, desmayos: false, diabetes: true, embarazo: false, medicacion: 'Metformina 850mg', observaciones: 'Operado de menisco en 2022. Diabetes tipo 2 controlada.' },
    fcReposo: 78, fcMax: 170, vo2max: 29,
    foto: null,
    entrenamientosRecientes: [
      { id: 111, fecha: '2024-01-30', programa: 'Rehabilitación Lumbar', duracionReal: 25, fcMedia: 118, fcMax: 142, calorias: 210, completado: true },
    ],
    planesAsignados: [
      { id: 205, entrenamiento: 4, fechaInicio: '2023-11-01', fechaFin: '2024-01-31', sesionesTotal: 16, sesionesCompletadas: 12, estado: 'Interrumpido' },
    ],
    testsFisicos: [],
    reservasClases: [],
    reservasLargoPlazo: [],
  },
]

// ── KPIs para Dashboard ───────────────────────────────────────────────────────
export const kpis = {
  clientesActivos: 3,
  clientesTotal: 4,
  sesionesHoy: 3,
  sesionesSemana: 14,
  ocupacionMedia: 78,
  ingresosMes: 1480,
}
