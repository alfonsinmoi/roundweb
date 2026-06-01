// Cliente para /api/subscriptions/* y catálogos relacionados.
import { getRoundIdentity } from './configApi'

const TOKEN = import.meta.env.VITE_CONFIG_API_TOKEN || ''

function headers(identity) {
  return {
    'Content-Type': 'application/json',
    'X-Round-Token': TOKEN,
    'X-Round-Manager-Id': String(identity?.managerId || ''),
    ...(identity?.trainerId ? { 'X-Round-Trainer-Id': String(identity.trainerId) } : {}),
  }
}

async function _fetchJson(url, opts = {}) {
  const r = await fetch(url, opts)
  let body = null; try { body = await r.json() } catch {}
  if (!r.ok || (body && body.ok === false)) {
    const err = new Error((body && body.error) || `HTTP ${r.status}`); err.body = body; throw err
  }
  return body
}

export async function listSubsByCliente(identity, idnoofit) {
  const r = await _fetchJson(`/api/subscriptions/cliente/${encodeURIComponent(idnoofit)}`, {
    headers: headers(identity),
  })
  return { subs: r.subscriptions || [], partner_id: r.partner_id }
}

/**
 * Lista cuotas del catálogo Odoo filtradas por trainer (centro).
 *
 * @param identity {Object} { managerId, trainerId, ... }
 * @param trainerId {string|number} id NoofitPro del trainer cuyo catálogo
 *   queremos (suele ser el `idTrainer` del cliente para el dropdown del perfil).
 *   Si no se pasa, devuelve solo las cuotas legacy del manager (compat retro).
 * @returns {Promise<Array>} lista de cuotas
 */
export async function cuotasCatalogo(identity, trainerId = null) {
  const qs = trainerId ? `?trainer=${encodeURIComponent(String(trainerId))}` : ''
  const r = await _fetchJson(`/api/subscriptions/cuotas-catalogo${qs}`, { headers: headers(identity) })
  return r.cuotas || []
}

export async function descuentosCatalogo(identity) {
  const r = await _fetchJson(`/api/subscriptions/descuentos-catalogo`, { headers: headers(identity) })
  return r.descuentos || []
}

export async function createSub(identity, payload) {
  return _fetchJson(`/api/subscriptions/`, {
    method: 'POST', headers: headers(identity), body: JSON.stringify(payload),
  })
}

export async function replaceSub(identity, sid, payload) {
  return _fetchJson(`/api/subscriptions/${sid}/replace`, {
    method: 'POST', headers: headers(identity), body: JSON.stringify(payload),
  })
}

export async function cancelSub(identity, sid, payload = {}) {
  return _fetchJson(`/api/subscriptions/${sid}/cancel`, {
    method: 'POST', headers: headers(identity), body: JSON.stringify(payload),
  })
}

export { getRoundIdentity }


// ── Forma de pago del cliente ────────────────────────────────────────────
export async function listFormasPagoCliente(identity, idnoofit) {
  const r = await _fetchJson(`/api/forma-pago/cliente/${encodeURIComponent(idnoofit)}`, {
    headers: headers(identity),
  })
  return r.formas_pago || []
}

export async function createFormaPago(identity, payload) {
  return _fetchJson(`/api/forma-pago/`, {
    method: 'POST', headers: headers(identity), body: JSON.stringify(payload),
  })
}

export async function cancelFormaPago(identity, fid, payload = {}) {
  return _fetchJson(`/api/forma-pago/${fid}/cancel`, {
    method: 'POST', headers: headers(identity), body: JSON.stringify(payload),
  })
}
