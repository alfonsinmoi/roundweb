// API cliente del portal `/portal/*` (cliente NoofitPro logueado).
// Endpoint base: /api/cliente y /api/horario para fichaje.
//
// Auth: JWT propio `kind='cliente'` emitido por POST /api/cliente/login.
// Almacenado en sessionStorage con key separado del admin (round.portal.session).

const PORTAL_SESSION_KEY = 'round.portal.session'


export function getPortalSession() {
  try {
    const raw = sessionStorage.getItem(PORTAL_SESSION_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function setPortalSession(s) {
  try { sessionStorage.setItem(PORTAL_SESSION_KEY, JSON.stringify(s)) } catch { /* */ }
}

export function clearPortalSession() {
  try { sessionStorage.removeItem(PORTAL_SESSION_KEY) } catch { /* */ }
}


function _headers(token) {
  const h = { 'Content-Type': 'application/json' }
  if (token) h.Authorization = `Bearer ${token}`
  return h
}


async function _req(method, url, body = null, token = null) {
  const init = { method, headers: _headers(token) }
  if (body) init.body = JSON.stringify(body)
  const res = await fetch(url, init)
  const text = await res.text()
  let data; try { data = JSON.parse(text) } catch { data = { error: text } }
  if (!res.ok || data?.ok === false) {
    const err = new Error(data?.error || `HTTP ${res.status}`)
    err.status = res.status
    err.body = data
    throw err
  }
  return data
}


// ── Auth ────────────────────────────────────────────────────────────────────
export async function loginCliente(email, password, id_manager = null) {
  const body = { email, password }
  if (id_manager) body.id_manager = id_manager
  return _req('POST', '/api/cliente/login', body)
}

export async function meCliente(token) {
  return _req('GET', '/api/cliente/me', null, token)
}

export const miTrabajador = (token) =>
  _req('GET', '/api/cliente/mi-trabajador', null, token)

export const solicitarAltaTrabajador = (token, body) =>
  _req('POST', '/api/cliente/solicitar-alta-trabajador', body, token)


// ── Fichaje (reusa endpoints /api/horario/* — pasan con JWT cliente) ───────
export const fichajeEstado = (token) =>
  _req('GET', '/api/horario/estado', null, token)

export const fichajePost = (token, body) =>
  _req('POST', '/api/horario/fichaje', body, token)

export const fichajeMiJornada = (token) =>
  _req('GET', '/api/horario/mi-jornada/hoy', null, token)

export const fichajeCorreccion = (token, body) =>
  _req('POST', '/api/horario/correccion', body, token)

export const horarioMe = (token) =>
  _req('GET', '/api/horario/me', null, token)
