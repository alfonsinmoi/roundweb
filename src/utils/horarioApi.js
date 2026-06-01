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
  // Override del selector global (admin) tiene prioridad sobre identity.trainerId.
  const tid = _trainerOverride() || identity?.trainerId
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
export const ausenciaCrearAdmin = (identity, body) =>
  _req('POST', '/ausencias', identity, body).then(d => d.solicitud)


// ══════════════════════════════════════════════════════════════════════════
// PLANIFICACIÓN (Fase 2 B.1)
// ══════════════════════════════════════════════════════════════════════════

// Temporadas
export const temporadasList = (identity) =>
  _req('GET', '/temporadas', identity).then(d => d.temporadas)
export const temporadaCreate = (identity, body) =>
  _req('POST', '/temporadas', identity, body).then(d => d.temporada)
export const temporadaUpdate = (identity, id, body) =>
  _req('PATCH', `/temporadas/${id}`, identity, body).then(d => d.temporada)
export const temporadaDelete = (identity, id) =>
  _req('DELETE', `/temporadas/${id}`, identity)
export const aperturaGet = (identity, tid) =>
  _req('GET', `/temporadas/${tid}/apertura`, identity).then(d => d.apertura)
export const aperturaSave = (identity, tid, apertura) =>
  _req('PUT', `/temporadas/${tid}/apertura`, identity, { apertura })

// Puestos
export const puestosList = (identity) =>
  _req('GET', '/puestos', identity).then(d => d.puestos)
export const puestoCreate = (identity, body) =>
  _req('POST', '/puestos', identity, body).then(d => d.puesto)
export const puestoUpdate = (identity, id, body) =>
  _req('PATCH', `/puestos/${id}`, identity, body).then(d => d.puesto)
export const puestoDelete = (identity, id) =>
  _req('DELETE', `/puestos/${id}`, identity)
export const compatibilidadesGet = (identity) =>
  _req('GET', '/puestos/compatibilidades', identity).then(d => d.pares)
export const compatibilidadesSave = (identity, pares) =>
  _req('PUT', '/puestos/compatibilidades', identity, { pares })
export const demandaGet = (identity, pid, temporadaId) => {
  const qs = temporadaId ? `?temporada_id=${temporadaId}` : ''
  return _req('GET', `/puestos/${pid}/demanda${qs}`, identity).then(d => d.demanda)
}
export const demandaSave = (identity, pid, filas) =>
  _req('PUT', `/puestos/${pid}/demanda`, identity, { filas })

// Trabajador: capacidades + preferencias
export const trabajadorPuestosGet = (identity, tid) =>
  _req('GET', `/trabajadores/${tid}/puestos`, identity).then(d => d.puestos)
export const trabajadorPuestosSave = (identity, tid, puestos) =>
  _req('PUT', `/trabajadores/${tid}/puestos`, identity, { puestos })
export const trabajadorPreferenciasGet = (identity, tid) =>
  _req('GET', `/trabajadores/${tid}/preferencias`, identity).then(d => d.preferencias)
export const trabajadorPreferenciasSave = (identity, tid, prefs) =>
  _req('PUT', `/trabajadores/${tid}/preferencias`, identity, prefs)
export const trabajadorVincularTrainer = (identity, id, body) =>
  _req('POST', `/trabajadores/${id}/trainers`, identity, body)
export const trabajadorDesvincularTrainer = (identity, id, vinculoId) =>
  _req('DELETE', `/trabajadores/${id}/trainers/${vinculoId}`, identity)


// ── Planificación B.2: plantillas + asignaciones + cobertura ───────────────
export const plantillasList = (identity) =>
  _req('GET', '/turno-plantillas', identity).then(d => d.plantillas)
export const plantillaGet = (identity, id) =>
  _req('GET', `/turno-plantillas/${id}`, identity).then(d => d.plantilla)
export const plantillaCreate = (identity, body) =>
  _req('POST', '/turno-plantillas', identity, body).then(d => d.plantilla)
export const plantillaUpdate = (identity, id, body) =>
  _req('PATCH', `/turno-plantillas/${id}`, identity, body).then(d => d.plantilla)
export const plantillaDelete = (identity, id) =>
  _req('DELETE', `/turno-plantillas/${id}`, identity)
export const plantillaBloquesSave = (identity, id, bloques) =>
  _req('PUT', `/turno-plantillas/${id}/bloques`, identity, { bloques })

export const asignacionesSemana = (identity, fechaLunes) =>
  _req('GET', `/turno-asignaciones?fecha_lunes=${fechaLunes}`, identity)
export const asignacionesBulk = (identity, ops) =>
  _req('PUT', '/turno-asignaciones/bulk', identity, { ops })

export const coberturaSemana = (identity, fechaLunes, temporadaId = null) => {
  const qs = new URLSearchParams({ fecha_lunes: fechaLunes })
  if (temporadaId) qs.set('temporada_id', String(temporadaId))
  return _req('GET', `/cobertura?${qs.toString()}`, identity)
}

export const calendarioTrabajador = (identity, fechaLunes) =>
  _req('GET', `/calendario-trabajador?fecha_lunes=${fechaLunes}`, identity)

export const equilibrioSemana = (identity, fechaLunes) =>
  _req('GET', `/equilibrio?fecha_lunes=${fechaLunes}`, identity)

export const copiarSemana = (identity, body) =>
  _req('POST', '/turno-asignaciones/copiar-semana', identity, body)
export const replicarSemana = (identity, body) =>
  _req('POST', '/turno-asignaciones/replicar', identity, body)
export const aplicarPatronRotativo = (identity, body) =>
  _req('POST', '/turno-asignaciones/patron-rotativo', identity, body)

export const asignacionesMes = (identity, mes) =>
  _req('GET', `/turno-asignaciones-mes?mes=${mes}`, identity)


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
