// ── Cliente API Cuotas / Recibos (Odoo via round_config_api) ────────────────

const BASE = '/api/cuotas'
const TOKEN = import.meta.env.VITE_CONFIG_API_TOKEN || ''

function headers(identity) {
  const h = {
    'Content-Type': 'application/json',
    'X-Round-Token': TOKEN,
    'X-Round-Manager-Id': identity?.managerId || '',
  }
  if (identity?.trainerId) h['X-Round-Trainer-Id'] = identity.trainerId
  return h
}

async function _request(method, path, identity, body = null, raw = false) {
  const init = { method, headers: headers(identity) }
  if (body) init.body = JSON.stringify(body)
  const res = await fetch(`${BASE}${path}`, init)
  if (raw) return res
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = { error: text } }
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || `HTTP ${res.status}`)
  }
  return data
}

// ── Por cliente (perfil cliente, pestaña Cuotas) ────────────────────────────
export const cuotasCliente = (identity, idNoofit) =>
  _request('GET', `/cliente/${idNoofit}`, identity).then(d => d.recibos)

// ── Listado filtrable (Cuotas clientes, sub-tab Listado) ────────────────────
export const cuotasList = (identity, params = {}) => {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([_, v]) => v != null && v !== ''))
  ).toString()
  return _request('GET', qs ? `/?${qs}` : '/', identity).then(d => d.recibos)
}

// ── Preemisión (Generar remesa) ─────────────────────────────────────────────
export const preemisionGenerar = (identity, mes) =>
  _request('POST', `/preemision/${mes}`, identity)

export const preemisionListar = (identity, mes) =>
  _request('GET', `/preemision/${mes}`, identity).then(d => d.borradores)

export const preemisionModificar = (identity, invoiceId, vals) =>
  _request('PATCH', `/preemision/recibo/${invoiceId}`, identity, vals).then(d => d.recibo)

export const preemisionEliminar = (identity, invoiceId) =>
  _request('DELETE', `/preemision/recibo/${invoiceId}`, identity)

// ── Alta cliente (crea partner + sub + recibo + pago en Odoo) ──────────────
export const altaCliente = (identity, payload) =>
  _request('POST', '/alta-cliente', identity, payload)

// ── Enviar factura por email con PDF adjunto ──────────────────────────────
export const enviarFactura = (identity, invoiceId, dest_email = null, mensaje = '') =>
  _request('POST', `/recibo/${invoiceId}/enviar`, identity,
           { dest_email, mensaje })

// ── Devoluciones ────────────────────────────────────────────────────────────
export const procesarDevoluciones = (identity, rows) =>
  _request('POST', '/devoluciones', identity, { rows })

// ── Emisión + descarga SEPA ─────────────────────────────────────────────────
export const emitirRemesa = (identity, mes) =>
  _request('POST', `/emitir/${mes}`, identity)

// ── v2 (modo α: recibo + trimestral) ──────────────────────────────────────
export const preemisionV2Generar = (identity, mes) =>
  _request('POST', `/preemision-v2/${mes}`, identity)
export const preemisionV2Listar = (identity, mes) =>
  _request('GET', `/preemision-v2/${mes}`, identity)
export const preemisionV2BorrarRecibo = (identity, mes, rid) =>
  _request('DELETE', `/preemision-v2/${mes}/recibo/${rid}`, identity)
export const emitirV2 = (identity, mes) =>
  _request('POST', `/emitir-v2/${mes}`, identity)

// ── Facturación trimestral ────────────────────────────────────────────────
export const facturacionTrimestrePreview = (identity, trim) =>
  _request('GET', `/facturacion-trimestre/${trim}`, identity)
export const facturacionTrimestreFacturar = (identity, trim, recibo_ids, agrupar = true) =>
  _request('POST', `/facturacion-trimestre/${trim}/facturar`, identity,
           { recibo_ids, agrupar_por_cliente: agrupar })

export function urlDescargaSepa(attachmentId) {
  // El endpoint requiere headers de auth; el usuario lo abre vía fetch + blob (helper abajo)
  return `${BASE}/sepa/${attachmentId}`
}

export async function descargarSepa(identity, attachmentId, filename = 'remesa.xml') {
  const res = await _request('GET', `/sepa/${attachmentId}`, identity, null, true)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// ── Helpers de formato ──────────────────────────────────────────────────────
export const FORMA_PAGO_LABELS = {
  sepa:           'SEPA',
  tarjeta_token:  'Tarjeta tokenizada',
  enlace_pago:    'Enlace de pago / efectivo',
  efectivo:       'Efectivo',
  tokenizacion:   'Tarjeta tokenizada',
}

export const PAYMENT_STATE_LABELS = {
  not_paid:    { label: 'Pendiente',  color: 'amber' },
  in_payment:  { label: 'En cobro',   color: 'blue' },
  paid:        { label: 'Cobrado',    color: 'green' },
  partial:     { label: 'Parcial',    color: 'amber' },
  reversed:    { label: 'Devuelto',   color: 'red' },
  invoicing_legacy: { label: 'Legacy', color: 'gray' },
}

export const STATE_LABELS = {
  draft:    { label: 'Borrador',  color: 'gray' },
  posted:   { label: 'Emitido',   color: 'blue' },
  cancel:   { label: 'Cancelado', color: 'red' },
}
