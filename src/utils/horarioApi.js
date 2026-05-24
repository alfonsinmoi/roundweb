// Cliente del módulo Control horario (Fase 1).
// Endpoints en /api/horario/* del backend Round Config.
//
// Mismo patrón que configApi.js: X-Round-Token + identity (manager+trainer).

import {
  handleAuthExpired, consumeNewToken, isAuthExpiredResponse, getStoredJwt,
} from './authState'

const BASE = '/api/horario'
const TOKEN = import.meta.env.VITE_CONFIG_API_TOKEN || ''


function _withBearer(h) {
  const jwt = getStoredJwt()
  if (jwt) h.Authorization = `Bearer ${jwt}`
  return h
}

function _trainerOverride() {
  try {
    const v = sessionStorage.getItem('round.trainer_filter')
    if (!v || v === 'all' || v === '*' || v === '') return null
    return v
  } catch { return null }
}

function _headers(identity) {
  const h = {
    'Content-Type': 'application/json',
    'X-Round-Token': TOKEN,
    'X-Round-Manager-Id': identity?.managerId || '',
  }
  const tid = identity?.trainerId || _trainerOverride()
  if (tid) h['X-Round-Trainer-Id'] = tid
  return _withBearer(h)
}

async function _req(method, path, identity, body = null) {
  const init = { method, headers: _headers(identity) }
  if (body) init.body = JSON.stringify(body)
  const res = await fetch(`${BASE}${path}`, init)
  const text = await res.text()
  let data; try { data = JSON.parse(text) } catch { data = { error: text } }
  if (res.status === 401 && isAuthExpiredResponse(res.status, text)) {
    handleAuthExpired(); throw new Error('Sesión expirada')
  }
  if (!res.ok || data?.ok === false) {
    const err = new Error(data?.error || `HTTP ${res.status}`)
    err.body = data
    throw err
  }
  consumeNewToken(res)
  return data
}


// ── Activación del módulo ───────────────────────────────────────────────────
export const activarHorario   = (identity) => _req('POST', '/activar',   identity)
export const desactivarHorario = (identity) => _req('POST', '/desactivar', identity)


// ── Convenios + empresa ──────────────────────────────────────────────────────
export const convenios = (identity) =>
  _req('GET', '/convenios', identity).then(d => d.convenios)

export const empresasList = (identity) =>
  _req('GET', '/trainer-empresa', identity).then(d => d.empresas)
export const empresaGet = (identity, idTrainer) =>
  _req('GET', `/trainer-empresa/${encodeURIComponent(idTrainer)}`, identity).then(d => d.empresa)
export const empresaUpsert = (identity, idTrainer, body) =>
  _req('PUT', `/trainer-empresa/${encodeURIComponent(idTrainer)}`, identity, body).then(d => d.empresa)


// ── Motivos de pausa ────────────────────────────────────────────────────────
export const motivosPausa = (identity) =>
  _req('GET', '/pausa-motivos', identity).then(d => d.motivos)
export const motivoCreate = (identity, body) =>
  _req('POST', '/pausa-motivos', identity, body).then(d => d.motivo)
export const motivoUpdate = (identity, id, body) =>
  _req('PATCH', `/pausa-motivos/${id}`, identity, body).then(d => d.motivo)
export const motivoDelete = (identity, id) =>
  _req('DELETE', `/pausa-motivos/${id}`, identity)


// ── Trabajadores ────────────────────────────────────────────────────────────
export const trabajadoresList = (identity, params = {}) => {
  const qs = new URLSearchParams(params).toString()
  return _req('GET', `/trabajadores${qs ? '?' + qs : ''}`, identity)
    .then(d => d.trabajadores)
}
export const trabajadoresPendientes = (identity) =>
  _req('GET', '/trabajadores/pendientes', identity).then(d => d.pendientes)
export const trabajadorAlta = (identity, body) =>
  _req('POST', '/trabajadores', identity, body).then(d => d.trabajador)
export const trabajadorGet = (identity, id) =>
  _req('GET', `/trabajadores/${id}`, identity).then(d => d.trabajador)
export const trabajadorUpdate = (identity, id, body) =>
  _req('PATCH', `/trabajadores/${id}`, identity, body).then(d => d.trabajador)
export const trabajadorBaja = (identity, id, body) =>
  _req('POST', `/trabajadores/${id}/baja`, identity, body)
export const trabajadorReactivar = (identity, id) =>
  _req('POST', `/trabajadores/${id}/reactivar`, identity)
export const trabajadorAutorizar = (identity, id, body) =>
  _req('POST', `/trabajadores/${id}/autorizar`, identity, body)
export const trabajadorRechazar = (identity, id, body) =>
  _req('POST', `/trabajadores/${id}/rechazar`, identity, body)
export const trabajadorHistorial = (identity, id) =>
  _req('GET', `/trabajadores/${id}/historial`, identity).then(d => d.historial)

export const trabajadorHorario = (identity, id) =>
  _req('GET', `/trabajadores/${id}/horario`, identity).then(d => d.horario)
export const trabajadorHorarioSave = (identity, id, horario) =>
  _req('PUT', `/trabajadores/${id}/horario`, identity, { horario })

// ── Ausencias (admin) ──────────────────────────────────────────────────────
export const ausenciasList = (identity, params = {}) => {
  const qs = new URLSearchParams(params).toString()
  return _req('GET', `/ausencias${qs ? '?' + qs : ''}`, identity).then(d => d.solicitudes)
}
export const ausenciaAprobar = (identity, id, body = {}) =>
  _req('POST', `/ausencias/${id}/aprobar`, identity, body)
export const ausenciaRechazar = (identity, id, body = {}) =>
  _req('POST', `/ausencias/${id}/rechazar`, identity, body)
export const trabajadorSaldoAusencias = (identity, id, ano) =>
  _req('GET', `/trabajadores/${id}/saldo-ausencias?ano=${ano}`, identity)
export const trabajadorVincularTrainer = (identity, id, body) =>
  _req('POST', `/trabajadores/${id}/trainers`, identity, body)
export const trabajadorDesvincularTrainer = (identity, id, vinculoId) =>
  _req('DELETE', `/trabajadores/${id}/trainers/${vinculoId}`, identity)


// ── Fichajes + correcciones + QR ────────────────────────────────────────────
export const qrActual = (identity, idTrainer) =>
  _req('GET', `/qr-actual/${encodeURIComponent(idTrainer)}`, identity)

export const eventosList = (identity, params = {}) => {
  const qs = new URLSearchParams(params).toString()
  return _req('GET', `/eventos${qs ? '?' + qs : ''}`, identity).then(d => d.eventos)
}

export const correccionesList = (identity, estado = 'pendiente') =>
  _req('GET', `/correcciones?estado=${encodeURIComponent(estado)}`, identity)
    .then(d => d.correcciones)
export const correccionAprobar = (identity, id, body = {}) =>
  _req('POST', `/correcciones/${id}/aprobar`, identity, body)
export const correccionRechazar = (identity, id, body = {}) =>
  _req('POST', `/correcciones/${id}/rechazar`, identity, body)
export const correccionDirecta = (identity, body) =>
  _req('POST', '/eventos/correccion', identity, body)

export const verifyChain = (identity, trabajadorId) =>
  _req('GET', `/verify-chain/${trabajadorId}`, identity)
