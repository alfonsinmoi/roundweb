// ── Cliente API Round Configuración ──────────────────────────────────────────
// Backend Flask en /api/config/* que mantiene cuotas, descuentos y
// modificaciones por trainer. Token compartido en variable Vite.

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
  { id: 'porcentaje', label: '%' },
  { id: 'importe',    label: '€' },
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

function headers(identity) {
  const h = {
    'Content-Type': 'application/json',
    'X-Round-Token': TOKEN,
    'X-Round-Manager-Id': identity.managerId || '',
  }
  if (identity.trainerId) h['X-Round-Trainer-Id'] = identity.trainerId
  return h
}

async function _request(method, path, identity, body = null) {
  const init = { method, headers: headers(identity) }
  if (body) init.body = JSON.stringify(body)
  const res = await fetch(`${BASE}${path}`, init)
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = { error: text } }
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || `HTTP ${res.status}`)
  }
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
export const asignacionesList   = (identity, descId) =>
  _request('GET', `/descuentos/${descId}/asignaciones`, identity).then(d => d.asignaciones)
export const asignacionCreate   = (identity, descId, body) =>
  _request('POST', `/descuentos/${descId}/asignaciones`, identity, body)
export const asignacionDelete   = (identity, descId, asigId) =>
  _request('DELETE', `/descuentos/${descId}/asignaciones/${asigId}`, identity)

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

export const modificacionesList  = (identity) => _request('GET',   '/modificaciones', identity).then(d => d.modificaciones)
export const modificacionCreate  = (identity, data) => _request('POST',  '/modificaciones', identity, data).then(d => d.modificacion)
export const modificacionUpdate  = (identity, id, data) => _request('PATCH', `/modificaciones/${id}`, identity, data).then(d => d.modificacion)
export const modificacionDelete  = (identity, id) => _request('DELETE', `/modificaciones/${id}`, identity)
