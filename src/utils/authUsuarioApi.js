// Cliente para los endpoints /api/auth/usuario-web/* y /api/config/perfiles |
// usuarios-web.
//
// Las peticiones autenticadas como usuario_web mandan
//   Authorization: Bearer <jwt>
// Las peticiones autenticadas como manager (config) usan los headers ya
// existentes X-Round-Token + X-Round-Manager-Id (ver utils/configApi.js).

const BASE = '/api/auth/usuario-web'

async function jsonOrThrow(res) {
  let body = null
  try { body = await res.json() } catch { /* no body */ }
  if (!res.ok || (body && body.ok === false)) {
    const err = new Error((body && body.error) || `HTTP ${res.status}`)
    err.status = res.status
    err.body = body
    throw err
  }
  return body
}

export async function loginUsuarioWeb(email, password) {
  const r = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  // Caso especial: 200 OK con must_change_password=true (no es error real)
  const body = await r.json().catch(() => null)
  if (r.ok && body && body.must_change_password) {
    return { ok: false, mustChangePassword: true, ...body }
  }
  if (!r.ok || (body && body.ok === false)) {
    const err = new Error((body && body.error) || `HTTP ${r.status}`)
    err.status = r.status
    err.body = body
    throw err
  }
  return body
}

export async function meUsuarioWeb(jwt) {
  const r = await fetch(`${BASE}/me`, {
    headers: { 'Authorization': `Bearer ${jwt}` },
  })
  return jsonOrThrow(r)
}

export async function requestResetUsuarioWeb(email) {
  const r = await fetch(`${BASE}/request-reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  return jsonOrThrow(r)
}

export async function changePasswordWithToken(token, password) {
  const r = await fetch(`${BASE}/change-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password }),
  })
  return jsonOrThrow(r)
}

export async function verifyEmailWithToken(token, password) {
  const r = await fetch(`${BASE}/verify-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password }),
  })
  return jsonOrThrow(r)
}

export async function changePasswordSelf(jwt, oldPassword, newPassword) {
  const r = await fetch(`${BASE}/change-password-self`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${jwt}` },
    body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
  })
  return jsonOrThrow(r)
}

// ── CRUD perfiles + usuarios web (config endpoint, header manager auth) ─────
const CONFIG_API_TOKEN = import.meta.env.VITE_CONFIG_API_TOKEN || ''
function configHeaders(identity) {
  return {
    'Content-Type': 'application/json',
    'X-Round-Token': CONFIG_API_TOKEN,
    'X-Round-Manager-Id': String(identity.managerId || ''),
    ...(identity.trainerId ? { 'X-Round-Trainer-Id': String(identity.trainerId) } : {}),
  }
}

export async function perfilesList(identity) {
  const r = await fetch('/api/config/perfiles', { headers: configHeaders(identity) })
  return jsonOrThrow(r)
}
export async function perfilCreate(identity, payload) {
  const r = await fetch('/api/config/perfiles', {
    method: 'POST', headers: configHeaders(identity), body: JSON.stringify(payload),
  })
  return jsonOrThrow(r)
}
export async function perfilUpdate(identity, id, payload) {
  const r = await fetch(`/api/config/perfiles/${id}`, {
    method: 'PATCH', headers: configHeaders(identity), body: JSON.stringify(payload),
  })
  return jsonOrThrow(r)
}
export async function perfilDelete(identity, id) {
  const r = await fetch(`/api/config/perfiles/${id}`, {
    method: 'DELETE', headers: configHeaders(identity),
  })
  return jsonOrThrow(r)
}

export async function usuariosWebList(identity, trainerId) {
  const url = trainerId ? `/api/config/usuarios-web?trainer=${trainerId}` : '/api/config/usuarios-web'
  const r = await fetch(url, { headers: configHeaders(identity) })
  return jsonOrThrow(r)
}
export async function usuarioWebCreate(identity, payload) {
  const r = await fetch('/api/config/usuarios-web', {
    method: 'POST', headers: configHeaders(identity), body: JSON.stringify(payload),
  })
  return jsonOrThrow(r)
}
export async function usuarioWebUpdate(identity, id, payload) {
  const r = await fetch(`/api/config/usuarios-web/${id}`, {
    method: 'PATCH', headers: configHeaders(identity), body: JSON.stringify(payload),
  })
  return jsonOrThrow(r)
}
export async function usuarioWebResetPassword(identity, id) {
  const r = await fetch(`/api/config/usuarios-web/${id}/reset-password`, {
    method: 'POST', headers: configHeaders(identity),
  })
  return jsonOrThrow(r)
}
export async function usuarioWebResendVerification(identity, id) {
  const r = await fetch(`/api/config/usuarios-web/${id}/resend-verification`, {
    method: 'POST', headers: configHeaders(identity),
  })
  return jsonOrThrow(r)
}
export async function usuarioWebDelete(identity, id, hard = false) {
  const url = hard ? `/api/config/usuarios-web/${id}?hard=1` : `/api/config/usuarios-web/${id}`
  const r = await fetch(url, { method: 'DELETE', headers: configHeaders(identity) })
  return jsonOrThrow(r)
}
