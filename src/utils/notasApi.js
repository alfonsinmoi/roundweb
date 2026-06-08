// Cliente para /api/notas/* + /api/config/audit.
// Las llamadas autenticadas como manager usan X-Round-Token + X-Round-Manager-Id.
// Las llamadas como usuario_web usan Authorization: Bearer <jwt>.
// Detecto automáticamente cuál usar según el user.

import { getRoundIdentity } from './configApi'

const CONFIG_API_TOKEN = import.meta.env.VITE_CONFIG_API_TOKEN || ''

function buildHeaders(user) {
  // Para usuario_web usamos el JWT propio (campo `jwt`), no el token NoofitPro
  // que está en `token` (utilizado por la API clásica).
  if (user?.kind === 'usuario_web' && (user.jwt || user.token)) {
    return { 'Content-Type': 'application/json',
             'Authorization': `Bearer ${user.jwt || user.token}` }
  }
  // Manager (login NoofitPro). Usamos getRoundIdentity (de configApi) en
  // vez de `user.manager ?? user.id` directo, porque NoofitPro a veces
  // devuelve user.manager como boolean true (no es el id real); pickId
  // descarta esos casos y elige el id correcto.
  const identity = getRoundIdentity(user)
  return {
    'Content-Type': 'application/json',
    'X-Round-Token': CONFIG_API_TOKEN,
    'X-Round-Manager-Id': identity.managerId || '',
    ...(identity.trainerId ? { 'X-Round-Trainer-Id': String(identity.trainerId) } : {}),
  }
}

async function fetchJson(url, options = {}) {
  const r = await fetch(url, options)
  let body = null; try { body = await r.json() } catch { /* ignore */ }
  if (!r.ok || (body && body.ok === false)) {
    const err = new Error((body && body.error) || `HTTP ${r.status}`)
    err.body = body
    throw err
  }
  return body
}

// ─── CRUD notas ─────────────────────────────────────────────────────────────
export async function listarNotasCliente(user, idnoofit, { limit = 100, archivadas = false } = {}) {
  const params = new URLSearchParams()
  if (limit) params.set('limit', limit)
  if (archivadas) params.set('archivadas', '1')
  const r = await fetchJson(`/api/notas/cliente/${encodeURIComponent(idnoofit)}?${params}`, {
    headers: buildHeaders(user),
  })
  return r.notas || []
}

export async function crearNota(user, idnoofit, payload) {
  const r = await fetchJson(`/api/notas/cliente/${encodeURIComponent(idnoofit)}`, {
    method: 'POST', headers: buildHeaders(user), body: JSON.stringify(payload),
  })
  return r.nota
}

export async function editarNota(user, id, payload) {
  const r = await fetchJson(`/api/notas/${id}`, {
    method: 'PATCH', headers: buildHeaders(user), body: JSON.stringify(payload),
  })
  return r.nota
}

export async function archivarNota(user, id) {
  const r = await fetchJson(`/api/notas/${id}/archivar`, {
    method: 'POST', headers: buildHeaders(user),
  })
  return r.nota
}

export async function recordatorioNota(user, id, horas) {
  const r = await fetchJson(`/api/notas/${id}/recordatorio`, {
    method: 'POST', headers: buildHeaders(user), body: JSON.stringify({ horas }),
  })
  return r.nota
}

export async function responderNota(user, id, contenido, { cerrarPadre = true } = {}) {
  const r = await fetchJson(`/api/notas/${id}/responder`, {
    method: 'POST', headers: buildHeaders(user),
    body: JSON.stringify({ contenido, cerrar_padre: cerrarPadre }),
  })
  return r.nota
}

export async function borrarNota(user, id) {
  await fetchJson(`/api/notas/${id}`, { method: 'DELETE', headers: buildHeaders(user) })
}

// POST /api/notas/enviar — crea N notas en bloque para receptores variados
// (trabajadores y/o clientes). Endpoint nuevo mayo 2026 para soportar el
// botón "Nueva nota" general desde la página /notas.
//   payload = { contenido, destinatarios: [{tipo, id}], fecha_entrega?, fecha_vencimiento? }
export async function enviarNota(user, payload) {
  return fetchJson('/api/notas/enviar', {
    method: 'POST', headers: buildHeaders(user), body: JSON.stringify(payload),
  })
}

// GET /api/notas/destinatarios — usuarios web candidatos AGRUPADOS por trainer
// y ya SCOPEADOS por el backend (manager → todos sus trainers; trainer → solo
// el suyo). Devuelve { trainers:[{id_trainer,label,usuarios:[...]}], corporativos:[...] }.
export async function destinatariosNota(user) {
  const r = await fetchJson('/api/notas/destinatarios', { headers: buildHeaders(user) })
  return { trainers: r.trainers || [], corporativos: r.corporativos || [],
           scopedTrainer: r.scoped_trainer || null }
}

// POST /api/notas/<id>/leer — acuse de lectura del destinatario (idempotente).
export async function marcarLeidaNota(user, id) {
  return fetchJson(`/api/notas/${id}/leer`, { method: 'POST', headers: buildHeaders(user) })
}

// ─── Endpoints "yo" (banner + página /notas) ─────────────────────────────────
export async function misNotasBanner(user) {
  const r = await fetchJson(`/api/notas/me/banner`, { headers: buildHeaders(user) })
  return r.notas || []
}

export async function misNotas(user, filtros = {}) {
  const params = new URLSearchParams()
  if (filtros.rol) params.set('rol', filtros.rol)
  if (filtros.estado) params.set('estado', filtros.estado)
  if (filtros.cliente) params.set('cliente', filtros.cliente)
  const r = await fetchJson(`/api/notas/me?${params}`, { headers: buildHeaders(user) })
  return r.notas || []
}

// ─── Audit log ───────────────────────────────────────────────────────────────
export async function listarAudit(user, filtros = {}) {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(filtros)) {
    if (v !== undefined && v !== '' && v !== null) params.set(k, v)
  }
  const r = await fetchJson(`/api/config/audit?${params}`, { headers: buildHeaders(user) })
  return r.audit || []
}
