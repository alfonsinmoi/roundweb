// ── Cliente API Round Configuración ──────────────────────────────────────────
// Backend Flask en /api/config/* que mantiene cuotas, descuentos y
// modificaciones por trainer. Token compartido en variable Vite.

import { handleAuthExpired, consumeNewToken, isAuthExpiredResponse } from './authState'

const BASE = '/api/config'

// Token compartido. Se inyecta en build vía Vite (.env: VITE_CONFIG_API_TOKEN)
const TOKEN = import.meta.env.VITE_CONFIG_API_TOKEN || ''

// Listas cerradas (espejo del backend)
export const FORMAS_PAGO = [
  { id: 'sepa',         label: 'SEPA' },
  { id: 'tpv',          label: 'TPV virtual' },
  { id: 'efectivo',     label: 'Efectivo' },
  { id: 'tokenizacion', label: 'Tarjeta tokenizada' },
]
export const PERIODICIDADES = [
  { id: 'mensual',     label: 'Mensual',     meses: 1 },
  { id: 'bimensual',   label: 'Bimensual',   meses: 2 },
  { id: 'trimestral',  label: 'Trimestral',  meses: 3 },
  { id: 'semestral',   label: 'Semestral',   meses: 6 },
  { id: 'anual',       label: 'Anual',       meses: 12 },
]
export const TIPOS_MODIFICACION = [
  { id: 'descuento',           label: 'Descuento puntual' },
  { id: 'cargo_extra',         label: 'Cargo extra' },
  { id: 'precio_alternativo',  label: 'Precio alternativo' },
]
export const TIPOS_DESCUENTO = [
  { id: 'porcentaje',    label: 'Descuento %' },
  { id: 'importe',       label: 'Restar €' },
  { id: 'varias_cuotas', label: 'Varias cuotas (precio combinado)' },
  { id: 'familiares',    label: 'Familiares (automático ≥2 miembros)' },
]

// ── Helpers de identidad ─────────────────────────────────────────────────────
// El "manager" es siempre quien hace login originalmente.
// Si NO está impersonando: trainerId = null (vista global de plantillas)
// Si SÍ está impersonando: trainerId = id del trainer actual
//
// NoofitPro a veces devuelve user.manager = false (boolean) o "false" (string)
// cuando un trainer entra solo, sin manager parent. `||` no salta la string
// "false" porque es truthy. Usamos un helper explícito.

function isAbsent(v) {
  return v == null || v === false || v === true || v === 0 ||
         v === '' || v === 'false' || v === 'null' || v === '0' ||
         v === 'true' || v === 'undefined'
}
function pickId(...candidates) {
  // Solo aceptamos un valor que se pueda convertir a un ID numérico/string razonable.
  for (const c of candidates) {
    if (isAbsent(c)) continue
    // Filtrar booleanos disfrazados (NoofitPro a veces devuelve true/false como flags)
    if (typeof c === 'boolean') continue
    return c
  }
  return ''
}

export function getRoundIdentity(user) {
  if (!user) return { managerId: null, trainerId: null }
  if (user.originalSession) {
    const o = user.originalSession
    return {
      managerId: String(pickId(o.manager, o.id)),
      trainerId: String(pickId(user.manager, user.id)),
    }
  }
  return {
    managerId: String(pickId(user.manager, user.id)),
    trainerId: null,   // Manager directo: opera con plantillas
  }
}

// Override del trainerId via selector global del header (admin).
// Si el admin elige un trainer concreto, sus llamadas se filtran como si
// estuviese impersonándolo. Si elige "Todos", no se manda el header.
function _trainerOverride() {
  try {
    const v = sessionStorage.getItem('round.trainer_filter')
    if (!v || v === 'all' || v === '*' || v === '') return null
    return v
  } catch { return null }
}

function headers(identity) {
  const h = {
    'Content-Type': 'application/json',
    'X-Round-Token': TOKEN,
    'X-Round-Manager-Id': identity.managerId || '',
  }
  // Prioridad: trainerId explícito de identity (impersonación clásica) > selector admin
  const tid = identity.trainerId || _trainerOverride()
  if (tid) h['X-Round-Trainer-Id'] = tid
  return h
}

async function _request(method, path, identity, body = null) {
  const init = { method, headers: headers(identity) }
  if (body) init.body = JSON.stringify(body)
  const res = await fetch(`${BASE}${path}`, init)
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = { error: text } }
  // Sesión expirada: limpiar y redirigir a /login (sólo si la respuesta
  // realmente apunta a auth — vía isAuthExpiredResponse).
  if (res.status === 401 && isAuthExpiredResponse(res.status, text)) {
    handleAuthExpired()
    throw new Error('Sesión expirada')
  }
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || `HTTP ${res.status}`)
  }
  // Sliding refresh: el backend pudo haber renovado el JWT.
  consumeNewToken(res)
  return data
}

// ── Cuotas ───────────────────────────────────────────────────────────────────
export const cuotasList   = (identity) => _request('GET',   '/cuotas', identity).then(d => d.cuotas)
export const cuotaCreate  = (identity, data) => _request('POST',  '/cuotas', identity, data).then(d => d.cuota)
export const cuotaUpdate  = (identity, id, data) => _request('PATCH', `/cuotas/${id}`, identity, data).then(d => d.cuota)
export const cuotaDelete  = (identity, id) => _request('DELETE', `/cuotas/${id}`, identity)
export const cuotaAdoptar = (identity, id) => _request('POST', `/cuotas/${id}/adoptar`, identity).then(d => d.cuota)

// ── Descuentos ──────────────────────────────────────────────────────────────
export const descuentosList   = (identity) => _request('GET',   '/descuentos', identity).then(d => d.descuentos)
export const descuentoCreate  = (identity, data) => _request('POST',  '/descuentos', identity, data).then(d => d.descuento)
export const descuentoUpdate  = (identity, id, data) => _request('PATCH', `/descuentos/${id}`, identity, data).then(d => d.descuento)
export const descuentoDelete  = (identity, id) => _request('DELETE', `/descuentos/${id}`, identity)
export const descuentoAdoptar = (identity, id) => _request('POST', `/descuentos/${id}/adoptar`, identity).then(d => d.descuento)

// ── Asignaciones de descuento a clientes ─────────────────────────────────────
// Para tipo='familiares' la respuesta no es {asignaciones:[]} sino
// {tipo:'familiares', familias:[{familia_id,nombre,miembros,aplica_a_n,aplica}]}.
// Devolvemos el objeto completo para que el caller pueda diferenciar.
export const asignacionesList   = (identity, descId) =>
  _request('GET', `/descuentos/${descId}/asignaciones`, identity)
export const asignacionCreate   = (identity, descId, body) =>
  _request('POST', `/descuentos/${descId}/asignaciones`, identity, body)
export const asignacionDelete   = (identity, descId, asigId) =>
  _request('DELETE', `/descuentos/${descId}/asignaciones/${asigId}`, identity)
// Lista descuentos asignados a un cliente concreto (con histórico)
export const asignacionesClienteList = (identity, idnoofit) =>
  _request('GET', `/descuentos/asignaciones/cliente/${encodeURIComponent(idnoofit)}`, identity)
    .then(d => d.asignaciones)

// ── Familias ────────────────────────────────────────────────────────────────
export const familiasList = (identity) =>
  _request('GET', '/familias', identity).then(d => d.familias)
export const familiaGet = (identity, id) =>
  _request('GET', `/familias/${id}`, identity).then(d => d.familia)
export const familiaCreate = (identity, body) =>
  _request('POST', '/familias', identity, body).then(d => d.familia)
export const familiaUpdate = (identity, id, body) =>
  _request('PATCH', `/familias/${id}`, identity, body).then(d => d.familia)
export const familiaDelete = (identity, id) =>
  _request('DELETE', `/familias/${id}`, identity)
export const familiaDeCliente = (identity, idnoofit) =>
  _request('GET', `/familias/cliente/${encodeURIComponent(idnoofit)}`, identity)
    .then(d => d.familia)
export const familiaAddCliente = (identity, idnoofit, body) =>
  _request('POST', `/familias/cliente/${encodeURIComponent(idnoofit)}`, identity, body)
export const familiaRemoveCliente = (identity, idnoofit) =>
  _request('DELETE', `/familias/cliente/${encodeURIComponent(idnoofit)}`, identity)

// ── Banner "Nuevos clientes esperando cobro" — dismiss persistente ─────────
// Usa /api/clientes-atendidos (no /api/config), de ahí el path completo
async function _requestRoot(method, path, identity, body = null) {
  const init = { method, headers: headers(identity) }
  if (body) init.body = JSON.stringify(body)
  const res = await fetch(path, init)
  const text = await res.text()
  let data; try { data = JSON.parse(text) } catch { data = { error: text } }
  if (res.status === 401 && isAuthExpiredResponse(res.status, text)) {
    handleAuthExpired(); throw new Error('Sesión expirada')
  }
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || `HTTP ${res.status}`)
  }
  consumeNewToken(res)
  return data
}
export const clientesAtendidosList = (identity) =>
  _requestRoot('GET', '/api/clientes-atendidos', identity).then(d => d.ids || [])
export const clientesAtendidosMark = (identity, clientes) =>
  _requestRoot('POST', '/api/clientes-atendidos', identity,
                Array.isArray(clientes) ? { clientes } : { cliente_idnoofit: clientes })
export const clientesAtendidosUnmark = (identity, idnoofit) =>
  _requestRoot('DELETE', `/api/clientes-atendidos/${encodeURIComponent(idnoofit)}`, identity)
export const clientesAtendidosReset = (identity) =>
  _requestRoot('DELETE', '/api/clientes-atendidos', identity)

// ── Recibos (BD local — incluye importados de GestPlus) ──────────────────
// GET /api/recibos?periodo=YYYY-MM&estado=...
// Pertenecen a la tabla local `recibo`, que ya tiene los recibos
// importados desde GestPlus (origen=gestplus_migracion) además de los
// emitidos vía preemision_v2.
export const recibosList = (identity, params = {}) => {
  const qs = new URLSearchParams()
  if (params.cliente) qs.set('cliente', params.cliente)
  if (params.estado)  qs.set('estado',  params.estado)
  if (params.metodo)  qs.set('metodo',  params.metodo)
  if (params.periodo) qs.set('periodo', params.periodo)
  if (params.desde)   qs.set('desde',   params.desde)
  if (params.hasta)   qs.set('hasta',   params.hasta)
  if (params.limit)   qs.set('limit',   String(params.limit))
  if (params.offset)  qs.set('offset',  String(params.offset))
  const suffix = qs.toString() ? `?${qs}` : ''
  return _requestRoot('GET', `/api/recibos${suffix}`, identity).then(d => d.recibos || [])
}

// ── Retos (NoofitPro proxy) ───────────────────────────────────────────────
// GET /api/retos — lista agregada de todos los trainers del manager.
// Params opcionales: {estado, id_trainer, force}
export const retosList = (identity, params = {}) => {
  const qs = new URLSearchParams()
  if (params.estado)     qs.set('estado', params.estado)
  if (params.id_trainer) qs.set('id_trainer', params.id_trainer)
  if (params.force)      qs.set('force', '1')
  const suffix = qs.toString() ? `?${qs}` : ''
  return _requestRoot('GET', `/api/retos${suffix}`, identity).then(d => d.retos || [])
}
export const retoGet = (identity, retoId) =>
  _requestRoot('GET', `/api/retos/${retoId}`, identity).then(d => d.reto)
export const retosSnapshot = (identity) =>
  _requestRoot('POST', '/api/retos/snapshot', identity)

// ── Estado físico (test sessions agregado vía NoofitPro) ───────────────
export const estadoFisicoDashboard = (identity, force = false) => {
  const q = force ? '?force=1' : ''
  return _requestRoot('GET', `/api/estado-fisico/dashboard${q}`, identity)
}
export const estadoFisicoSessions = (identity, force = false) => {
  const q = force ? '?force=1' : ''
  return _requestRoot('GET', `/api/estado-fisico/sessions${q}`, identity)
    .then(d => d.sessions || [])
}
// Sesiones de UN cliente concreto (usado por la ficha de cliente).
// Acepta `identity` como argumento (preferido) o lo deriva del sessionStorage
// como fallback para no romper callers existentes.
export async function estadoFisicoSessionsCliente(idCliente, identity = null) {
  if (!identity) {
    try {
      const raw = sessionStorage.getItem('round_session')
      const s = raw ? JSON.parse(raw) : {}
      // Construir identity mínimo desde los campos guardados
      identity = {
        managerId: s.id_manager || s.manager || s.managerNoofit || '',
        trainerId: s.id_trainer || s.trainer || null,
      }
    } catch { identity = { managerId: '', trainerId: null } }
  }
  return _requestRoot('GET', `/api/estado-fisico/sessions/${idCliente}`,
                       identity)
    .then(d => d.sessions || [])
}

// ── Modificaciones ──────────────────────────────────────────────────────────
// ── Proveedor de email transaccional (Resend / Postmark / SMTP / Gmail) ───
// Si trainerId omitido → config global del manager. Si pasa trainerId → override por centro.
export const emailGet = (identity, trainerId) => {
  const path = trainerId ? `/email?id_trainer=${encodeURIComponent(trainerId)}` : '/email'
  return _request('GET', path, identity).then(d => d.row)
}
export const emailListAll = (identity) =>
  _request('GET', '/email', identity).then(d => ({ row: d.row, rows: d.rows || [] }))
export const emailUpsert = (identity, data, trainerId) =>
  _request('PUT', '/email', identity, { ...data, id_trainer: trainerId || null }).then(d => d.row)
export const emailDelete = (identity, trainerId) =>
  _request('DELETE', `/email?id_trainer=${encodeURIComponent(trainerId)}`, identity)
export const emailTest = (identity, dest_email, trainerId) =>
  _request('POST', '/email/test', identity, { dest_email, id_trainer: trainerId || null })

// ── Plantillas de email transaccional ─────────────────────────────────────
export const emailTemplatesList = (identity) =>
  _request('GET',  '/email-templates', identity).then(d => d.rows || [])
export const emailTemplatesEvents = (identity) =>
  _request('GET',  '/email-templates/events', identity).then(d => d)
export const emailTemplateCreate = (identity, data) =>
  _request('POST', '/email-templates', identity, data).then(d => d.row)
export const emailTemplateUpdate = (identity, id, data) =>
  _request('PUT',  `/email-templates/${id}`, identity, data).then(d => d.row)
export const emailTemplateDelete = (identity, id) =>
  _request('DELETE', `/email-templates/${id}`, identity)
export const emailTemplatesSeed = (identity) =>
  _request('POST', '/email-templates/seed', identity)
export const emailTemplateTest = (identity, id, dest_email) =>
  _request('POST', `/email-templates/${id}/test`, identity, { dest_email })

// ── Centros / contactos por trainer (CRM, leads...) ───────────────────────
export const centrosList = (identity) =>
  _request('GET',  '/centros', identity).then(d => d.rows || [])
export const centroUpsert = (identity, idTrainer, data) =>
  _request('PUT',  `/centros/${idTrainer}`, identity, data).then(d => d.row)
export const centroDelete = (identity, idTrainer) =>
  _request('DELETE', `/centros/${idTrainer}`, identity)

// ── Credenciales NoofitPro por trainer (proxy server-side) ─────────────────
export const trainerCredsList = (identity) =>
  _request('GET', '/trainer-creds', identity).then(d => d.creds || [])
export const trainerCredsUpsert = (identity, idTrainer, data) =>
  _request('PUT', `/trainer-creds/${idTrainer}`, identity, data).then(d => d.cred)
export const trainerCredsDelete = (identity, idTrainer) =>
  _request('DELETE', `/trainer-creds/${idTrainer}`, identity)
export const trainerCredsTest = (identity, idTrainer) =>
  _request('POST', `/trainer-creds/${idTrainer}/test`, identity, {})

// ── CRM (leads) ─────────────────────────────────────────────────────────────
// Nota: el endpoint base es /api/crm (no /api/config/crm), por eso construimos
// la URL absoluta sin pasar por _request (que usa /api/config como prefix).
async function _crmRequest(method, path, identity, body = null) {
  const TOKEN = import.meta.env.VITE_CONFIG_API_TOKEN || ''
  const init = { method, headers: {
    'Content-Type': 'application/json',
    'X-Round-Token': TOKEN,
    'X-Round-Manager-Id': identity?.managerId || '',
  }}
  if (identity?.trainerId) init.headers['X-Round-Trainer-Id'] = identity.trainerId
  if (body) init.body = JSON.stringify(body)
  const res = await fetch(`/api/crm${path}`, init)
  const text = await res.text()
  let data; try { data = JSON.parse(text) } catch { data = { error: text } }
  if (!res.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${res.status}`)
  return data
}
export const leadsList = (identity) =>
  _crmRequest('GET', '/leads', identity).then(d => d.leads || [])
export const leadUpdate = (identity, leadId, vals) =>
  _crmRequest('PATCH', `/leads/${leadId}`, identity, vals).then(d => d.lead)
export const crmStages = (identity) =>
  _crmRequest('GET', '/stages', identity).then(d => d.stages || [])
export const crmLostReasons = (identity) =>
  _crmRequest('GET', '/lost-reasons', identity).then(d => d.reasons || [])
export const crmFunnel = (identity) =>
  _crmRequest('GET', '/funnel', identity).then(d => d)

// ── Cambios de estado de clientes (log activo↔archivado) ──────────────────
async function _clientesRequest(method, path, identity) {
  const TOKEN = import.meta.env.VITE_CONFIG_API_TOKEN || ''
  const res = await fetch(`/api/clientes${path}`, { method, headers: {
    'Content-Type': 'application/json', 'X-Round-Token': TOKEN,
    'X-Round-Manager-Id': identity?.managerId || '',
    ...(identity?.trainerId ? { 'X-Round-Trainer-Id': identity.trainerId } : {}),
  }})
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${res.status}`)
  return data
}
export const fechaBajaPorCliente = (identity) =>
  _clientesRequest('GET', '/estado-log?solo_baja=1', identity)
    .then(d => d.fecha_baja_por_cliente || {})
export const historialEstadoCliente = (identity, clienteId) =>
  _clientesRequest('GET', `/estado-log/${clienteId}`, identity)
    .then(d => d.historial || [])
export const syncClienteOdoo = (identity, idNoofit) =>
  _clientesRequest('POST', `/${idNoofit}/sync-odoo`, identity)
// Fechas clave del cliente (primera alta, alta actual, fecha inactivo)
export const clienteFechas = (identity, idNoofit) =>
  _clientesRequest('GET', `/${idNoofit}/fechas`, identity).then(d => ({
    estado_actual: d.estado_actual,
    fecha_primera_alta: d.fecha_primera_alta,
    fecha_alta_actual: d.fecha_alta_actual,
    fecha_inactivo: d.fecha_inactivo,
    fecha_creacion_noofit: d.fecha_creacion_noofit,
  }))

// ── Notificaciones (OneSignal + BD local) ──────────────────────────────────
async function _notifRequest(method, path, identity, body = null) {
  const TOKEN = import.meta.env.VITE_CONFIG_API_TOKEN || ''
  const init = { method, headers: {
    'Content-Type': 'application/json',
    'X-Round-Token': TOKEN,
    'X-Round-Manager-Id': identity?.managerId || '',
  }}
  if (identity?.trainerId) init.headers['X-Round-Trainer-Id'] = identity.trainerId
  if (body) init.body = JSON.stringify(body)
  const res = await fetch(`/api/notif${path}`, init)
  const text = await res.text()
  let data; try { data = JSON.parse(text) } catch { data = { error: text } }
  if (!res.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${res.status}`)
  return data
}

export const notifCatalog = (identity) =>
  _notifRequest('GET', '/catalog', identity).then(d => ({
    secciones: d.secciones || [],
    tipos: d.tipos || [],
  }))

export const notifEnviosList = (identity, filters = {}) => {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, v)
  }
  const path = qs.toString() ? `/envios?${qs}` : '/envios'
  return _notifRequest('GET', path, identity).then(d => d.envios || [])
}
export const notifEnvioGet = (identity, id) =>
  _notifRequest('GET', `/envios/${id}`, identity)
export const notifEnvioCreate = (identity, data) =>
  _notifRequest('POST', '/envios', identity, data)
export const notifEnvioCancel = (identity, id) =>
  _notifRequest('DELETE', `/envios/${id}`, identity)
export const notifPorCliente = (identity, idNoofit, filters = {}) => {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, v)
  }
  const path = qs.toString() ? `/cliente/${idNoofit}?${qs}` : `/cliente/${idNoofit}`
  return _notifRequest('GET', path, identity).then(d => d.notificaciones || [])
}
export const notifConfigGet = (identity) =>
  _notifRequest('GET', '/config', identity).then(d => d.config)
export const notifConfigPut = (identity, data) =>
  _notifRequest('PUT', '/config', identity, data).then(d => d.config)

// ── Contabilidad (gastos / nóminas / extractos / impuestos) ─────────────────
async function _contabRequest(method, path, identity, body = null, isForm = false) {
  const TOKEN = import.meta.env.VITE_CONFIG_API_TOKEN || ''
  const init = { method, headers: {
    'X-Round-Token': TOKEN,
    'X-Round-Manager-Id': identity?.managerId || '',
  }}
  if (identity?.trainerId) init.headers['X-Round-Trainer-Id'] = identity.trainerId
  if (body && !isForm) {
    init.headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body)
  } else if (body && isForm) {
    init.body = body  // FormData
  }
  const res = await fetch(`/api/contab${path}`, init)
  const text = await res.text()
  let data; try { data = JSON.parse(text) } catch { data = { error: text } }
  if (!res.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${res.status}`)
  return data
}

// Toggle "controla contabilidad" per trainer
export const contabConfigGet  = (identity) => _contabRequest('GET', '/config', identity).then(d => d.trainers || [])
export const contabConfigPut  = (identity, idTrainer, data) =>
  _contabRequest('PUT', `/config/${idTrainer}`, identity, data).then(d => d.config)

// Listados visibilidad
export const contabListadosGet = (identity) => _contabRequest('GET', '/config/listados', identity)
export const contabListadoVisPut = (identity, idTrainer, listadoId, visible) =>
  _contabRequest('PUT', `/config/listados/${idTrainer}/${listadoId}`, identity, { visible })

// Categorías
export const contabCatsList   = (identity) => _contabRequest('GET', '/categorias', identity)
export const contabCatCreate  = (identity, data) => _contabRequest('POST', '/categorias', identity, data).then(d => d.categoria)
export const contabCatUpdate  = (identity, id, data) => _contabRequest('PATCH', `/categorias/${id}`, identity, data).then(d => d.categoria)
export const contabCatDelete  = (identity, id) => _contabRequest('DELETE', `/categorias/${id}`, identity)
export const contabCatVisPut  = (identity, catId, idTrainer, visible) =>
  _contabRequest('PUT', `/categorias/${catId}/visibilidad/${idTrainer}`, identity, { visible })

// Documentos
export const contabDocsList = (identity, filters = {}) => {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, v)
  }
  const path = qs.toString() ? `/documentos?${qs}` : '/documentos'
  return _contabRequest('GET', path, identity).then(d => d.documentos || [])
}
export const contabDocGet     = (identity, id) => _contabRequest('GET', `/documentos/${id}`, identity).then(d => d.documento)
export const contabDocUpload  = (identity, formData) => _contabRequest('POST', '/documentos', identity, formData, true).then(d => d.documento)
export const contabDocPatch   = (identity, id, data) => _contabRequest('PATCH', `/documentos/${id}`, identity, data).then(d => d.documento)
export const contabDocEscanear = (identity, id) =>
  _contabRequest('POST', `/documentos/${id}/escanear`, identity, {})
export const contabDocValidar = (identity, id, opts = {}) =>
  _contabRequest('POST', `/documentos/${id}/validar`, identity, opts).then(d => d.documento)
export const contabDocRechazar= (identity, id, motivo) => _contabRequest('POST', `/documentos/${id}/rechazar`, identity, { motivo }).then(d => d.documento)
// Asiento contable (propuesto si borrador, definitivo si validado)
export const contabDocAsiento = (identity, id) =>
  _contabRequest('GET', `/documentos/${id}/asiento`, identity)
// Devuelve un documento VALIDADO a estado borrador (intenta deshacer asiento Odoo si lo había)
export const contabDocABorrador = (identity, id, motivo) =>
  _contabRequest('POST', `/documentos/${id}/a-borrador`, identity, { motivo: motivo || '' })
export const contabDocDelete  = (identity, id) => _contabRequest('DELETE', `/documentos/${id}`, identity)
// Banco — extractos + matching
export const contabBancoImportar = (identity, formData) =>
  _contabRequest('POST', '/banco/importar', identity, formData, true)
export const contabBancoMovs = (identity, filters = {}) => {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, v)
  }
  return _contabRequest('GET', `/banco/movimientos?${qs}`, identity).then(d => d.movimientos || [])
}
export const contabBancoLink = (identity, movId, data) =>
  _contabRequest('PATCH', `/banco/movimientos/${movId}`, identity, data).then(d => d.movimiento)
export const contabBancoMatching = (identity, autoApply = false) =>
  _contabRequest('POST', '/banco/matching', identity, { auto_apply: autoApply })

// Listados
export const contabTotales = (identity, filters = {}) => {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, v)
  }
  return _contabRequest('GET', `/listados/totales?${qs}`, identity)
}
export const contabFaltantes = (identity, params = {}) => {
  const { meses = 6, tipo_deteccion = 'all', incluir_ignorados = false } = params
  const qs = new URLSearchParams({
    meses, tipo_deteccion,
    incluir_ignorados: incluir_ignorados ? '1' : '0',
  })
  return _contabRequest('GET', `/listados/faltantes?${qs}`, identity)
}
export const contabFaltanteIgnorar = (identity, categoria_id, periodo_faltante, motivo) =>
  _contabRequest('POST', '/listados/faltantes/ignorar', identity,
                 { categoria_id, periodo_faltante, motivo })
export const contabFaltanteRestaurar = (identity, categoria_id, periodo) =>
  _contabRequest('DELETE', `/listados/faltantes/ignorar/${categoria_id}/${encodeURIComponent(periodo)}`, identity)
export const contabResultados = (identity, params) => {
  const qs = new URLSearchParams()
  if (params?.periodos?.length) qs.set('periodos', params.periodos.join(','))
  else {
    if (params?.desde) qs.set('desde', params.desde)
    if (params?.hasta) qs.set('hasta', params.hasta)
  }
  if (params?.ingresos) qs.set('ingresos', params.ingresos)
  if (params?.incluir_no_contabilizados) qs.set('incluir_no_contabilizados', '1')
  return _contabRequest('GET', `/listados/resultados?${qs}`, identity)
}
export const contabResultadosDisponibles = (identity) =>
  _contabRequest('GET', '/listados/resultados/disponibles', identity)

// URL para descargar/visualizar el binario. Como el navegador no manda
// headers en un <a href>, pasamos auth via query string (auth_required acepta
// ambas formas).
export const contabDocFileUrl = (id, identity) => {
  const TOKEN = import.meta.env.VITE_CONFIG_API_TOKEN || ''
  const qs = new URLSearchParams({
    token: TOKEN,
    manager: identity?.managerId || '',
    ...(identity?.trainerId ? { trainer: identity.trainerId } : {}),
  })
  return `/api/contab/documentos/${id}/file?${qs}`
}

// ── Redes sociales (cuentas Meta + agenda de posts) ───────────────────────
async function _socialRequest(method, path, identity, body = null) {
  const TOKEN = import.meta.env.VITE_CONFIG_API_TOKEN || ''
  const init = { method, headers: {
    'Content-Type': 'application/json', 'X-Round-Token': TOKEN,
    'X-Round-Manager-Id': identity?.managerId || '',
    ...(identity?.trainerId ? { 'X-Round-Trainer-Id': identity.trainerId } : {}),
  }}
  if (body) init.body = JSON.stringify(body)
  const res = await fetch(`/api/social${path}`, init)
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${res.status}`)
  return data
}
export const socialCuentasList   = (identity) =>
  _socialRequest('GET',  '/cuentas', identity).then(d => d.rows || [])
export const socialCuentaUpsert  = (identity, data) =>
  _socialRequest('PUT',  '/cuentas', identity, data).then(d => d.row)
export const socialCuentaDelete  = (identity, cuentaId) =>
  _socialRequest('DELETE', `/cuentas/${cuentaId}`, identity)
export const socialCuentaInfo    = (identity, cuentaId) =>
  _socialRequest('GET',  `/cuentas/${cuentaId}/info`, identity).then(d => d.info)
export const socialPostsList     = (identity, params = {}) => {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([_, v]) => v != null && v !== ''))
  ).toString()
  return _socialRequest('GET', qs ? `/posts?${qs}` : '/posts', identity).then(d => d.rows || [])
}
export const socialPostCreate    = (identity, data) =>
  _socialRequest('POST', '/posts', identity, data).then(d => d.row)
export const socialPostUpdate    = (identity, id, data) =>
  _socialRequest('PATCH', `/posts/${id}`, identity, data).then(d => d.row)
export const socialPostDelete    = (identity, id) =>
  _socialRequest('DELETE', `/posts/${id}`, identity)
export const socialPostPublishNow = (identity, id) =>
  _socialRequest('POST', `/posts/${id}/publicar-ya`, identity)

// ── Pasarelas de pago por trainer (PayComet, Redsys...) ────────────────────
export const pasarelasList = (identity) =>
  _request('GET',  '/pasarelas', identity).then(d => d.rows || [])
export const pasarelaUpsert = (identity, idTrainer, data) =>
  _request('PUT',  `/pasarelas/${idTrainer}`, identity, data).then(d => d.row)
export const pasarelaDelete = (identity, idTrainer, proveedor = 'paycomet') =>
  _request('DELETE', `/pasarelas/${idTrainer}?proveedor=${proveedor}`, identity)

// ── Cliente Gympass (extensión local — NoofitPro no persiste gympassId) ────
export const clienteGympassList = (identity) =>
  _request('GET',  '/cliente-gympass', identity).then(d => d.mapa || {})
export const clienteGympassUpsert = (identity, idNoofit, gympass_id, notas) =>
  _request('PUT',  `/cliente-gympass/${idNoofit}`, identity, { gympass_id, notas })
export const clienteGympassDelete = (identity, idNoofit) =>
  _request('DELETE', `/cliente-gympass/${idNoofit}`, identity)
export const clienteGympassBulk = (identity, items) =>
  _request('POST', '/cliente-gympass/bulk', identity, { items })

// ── Categorías de cliente (Gympass / Trabajador / Invitado / …) ────────────
export const categoriasList = (identity) =>
  _request('GET', '/categorias', identity).then(d => d.categorias || [])
export const categoriaCreate = (identity, data) =>
  _request('POST', '/categorias', identity, data).then(d => d.categoria)
export const categoriaUpdate = (identity, id, data) =>
  _request('PATCH', `/categorias/${id}`, identity, data).then(d => d.categoria)
export const categoriaDelete = (identity, id, hard = false) =>
  _request('DELETE', `/categorias/${id}${hard ? '?hard=1' : ''}`, identity)
export const categoriaConteo = (identity) =>
  _request('GET', '/categorias/conteo-clientes', identity).then(d => d.conteo || [])
// Asignaciones cliente↔categoría — devuelve mapa idnoofit → {id, nombre, color, …}
export const categoriasAsignaciones = (identity) =>
  _request('GET', '/categorias/asignaciones', identity).then(d => d.mapa || {})
export const categoriaClienteSet = (identity, idNoofit, categoria_id) =>
  _request('PUT', `/categorias/clientes/${idNoofit}`, identity, { categoria_id })
export const categoriaClienteDel = (identity, idNoofit) =>
  _request('DELETE', `/categorias/clientes/${idNoofit}`, identity)


export const modificacionesList  = (identity, params = {}) => {
  const qs = new URLSearchParams()
  if (params.cliente) qs.set('cliente', params.cliente)
  if (params.estado)  qs.set('estado',  params.estado)
  const suffix = qs.toString() ? `?${qs}` : ''
  return _request('GET', `/modificaciones${suffix}`, identity).then(d => d.modificaciones)
}
export const modificacionCreate  = (identity, data) => _request('POST',  '/modificaciones', identity, data).then(d => d.modificacion)
export const modificacionUpdate  = (identity, id, data) => _request('PATCH', `/modificaciones/${id}`, identity, data).then(d => d.modificacion)
export const modificacionDelete  = (identity, id) => _request('DELETE', `/modificaciones/${id}`, identity)


// ── Estado del Odoo per-manager (Fase 1: gate y wcommerce check) ──────────
// Endpoints vive en /api/manager/ (no /api/config/), por eso _requestRoot.
export const managerOdooStatus = (identity) =>
  _requestRoot('GET', '/api/manager/odoo-status', identity)

/** Consulta wcommerce on-demand. Si wcId está, sobreescribe el guardado en BD.
 *  Devuelve { ok, ya_desplegado, tipo_pago, elegible, cliente, error, motivo }. */
export const managerWcCheck = (identity, wcommerce_cliente_id = null) =>
  _requestRoot('POST', '/api/manager/wc-check', identity,
               wcommerce_cliente_id ? { wcommerce_cliente_id } : {})

/** Guarda el id wcommerce del manager (admin). */
export const managerSetWcommerceId = (identity, wcommerce_cliente_id) =>
  _requestRoot('PATCH', '/api/manager/wcommerce-cliente', identity,
               { wcommerce_cliente_id })

/** Devuelve la solicitud de despliegue activa del manager (o null). */
export const managerGetSolicitudDespliegue = (identity) =>
  _requestRoot('GET', '/api/manager/solicitud-despliegue', identity)
    .then(d => d.solicitud)

/** Crea una nueva solicitud de despliegue de Odoo. Lanza error si:
 *  - faltan campos obligatorios (razon_social, cif)
 *  - el manager ya tiene Odoo desplegado
 *  - el manager no es elegible (tipoPago != 'S')
 *  - ya hay otra solicitud pendiente/en_proceso  */
export const managerSolicitudDespliegue = (identity, datos) =>
  _requestRoot('POST', '/api/manager/solicitud-despliegue', identity, datos)

/** Activa un módulo concreto (crm / cuotas / contabilidad). Idempotente.
 *  Body: payload del wizard correspondiente. Devuelve {ok, modulo, company_id,
 *  mensaje, log}. */
export const managerProvisionModulo = (identity, modulo, datos = {}) =>
  _requestRoot('POST', `/api/manager/provision/${modulo}`, identity, datos)

/** Lista la config analytic per-trainer del manager (Fase 4).
 *  Devuelve { trainers: [...], manager_analytic_default_id }. */
export const managerTrainersContabilidad = (identity) =>
  _requestRoot('GET', '/api/manager/trainers-contabilidad', identity)

/** Cambia el modo (heredar contabilidad sí/no) de un trainer.
 *  Si heredar=false → crea analytic propio para ese trainer. */
export const managerSetTrainerContabilidad = (identity, idTrainer, heredar, nombreTrainer = '') =>
  _requestRoot('PATCH', `/api/manager/trainers-contabilidad/${idTrainer}`, identity,
               { heredar_contabilidad: heredar, nombre_trainer: nombreTrainer })
