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
// NoofitPro a veces devuelve user.manager = false en lugar de un id (cuando un
// trainer entra solo, sin manager parent). Por eso usamos `||` en lugar de `??`
// para tratar false como ausente.
export function getRoundIdentity(user) {
  if (!user) return { managerId: null, trainerId: null }
  if (user.originalSession) {
    return {
      managerId: String(user.originalSession.manager || user.originalSession.id || ''),
      trainerId: String(user.manager || user.id || ''),
    }
  }
  return {
    managerId: String(user.manager || user.id || ''),
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

// ── Modificaciones ──────────────────────────────────────────────────────────
export const modificacionesList  = (identity) => _request('GET',   '/modificaciones', identity).then(d => d.modificaciones)
export const modificacionCreate  = (identity, data) => _request('POST',  '/modificaciones', identity, data).then(d => d.modificacion)
export const modificacionUpdate  = (identity, id, data) => _request('PATCH', `/modificaciones/${id}`, identity, data).then(d => d.modificacion)
export const modificacionDelete  = (identity, id) => _request('DELETE', `/modificaciones/${id}`, identity)
