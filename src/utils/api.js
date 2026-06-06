import md5 from 'md5'
import { handleAuthExpired, consumeNewToken, isAuthExpiredResponse } from './authState'

const BASE = '/wiemspro'
const APP_VERSION = '1.8.39'
const APP_ID = '1'
const CACHE_TTL = 5 * 60_000 // 5 minutes
const CACHE_MAX_ENTRIES = 50

// NOTE: MD5 hashing is a backend API protocol constraint.
// The server expects MD5-hashed passwords — this is NOT a secure design choice.
const hashPassword = (pass) => md5(pass).toUpperCase()

const authHeaders = (token, manager) => ({
  'X-CustomToken': token,
  'locale': 'es',
  'appVersion': APP_VERSION,
  'appId': APP_ID,
  ...(manager ? { 'X-TRAINER_MANAGER': manager } : {}),
})

function getSession() {
  try {
    const raw = sessionStorage.getItem('round_session')
    const session = raw ? JSON.parse(raw) : {}
    // Para X-TRAINER_MANAGER (NoofitPro) preferimos managerNoofit si existe
    // (caso usuario_web auto-logueado en NoofitPro). Si no, fallback a manager.
    return {
      token: session.token ?? '',
      manager: session.managerNoofit ?? session.manager ?? '',
      trainerId: session.id,
    }
  } catch {
    return { token: '', manager: '', trainerId: null }
  }
}

// Si el usuario logueado es un usuario_web con id_trainer asignado,
// devuelve ese id como FILTRO. Las llamadas que devuelven datos cross-trainer
// (clientes, salas) deben filtrar a este id para que el usuario_web solo vea
// los datos del centro al que pertenece.
function getTrainerFilter() {
  try {
    const raw = sessionStorage.getItem('round_session')
    const s = raw ? JSON.parse(raw) : {}
    if (s?.kind === 'usuario_web' && s?.id_trainer) {
      // Comparable con cliente.idTrainer (suele ser numérico)
      return Number(s.id_trainer) || String(s.id_trainer)
    }
  } catch { /* ignore */ }
  return null
}

// Devuelve { jwt, isUsuarioWeb } para decidir si usar el proxy backend
// (que filtra server-side) en lugar de NoofitPro directamente.
function getProxyAuth() {
  try {
    const raw = sessionStorage.getItem('round_session')
    const s = raw ? JSON.parse(raw) : {}
    if (s?.kind === 'usuario_web' && s?.jwt) {
      return { jwt: s.jwt, isUsuarioWeb: true }
    }
  } catch { /* ignore */ }
  return { jwt: null, isUsuarioWeb: false }
}

// ── User-friendly error mapping ─────────────────────────────────────────────

function userFriendlyError(rawMessage, fallback = 'Error en la operación') {
  if (!rawMessage) return fallback
  const msg = String(rawMessage).toLowerCase()
  if (msg.includes('unauthorized') || msg.includes('401')) return 'Sesión expirada. Vuelve a iniciar sesión'
  if (msg.includes('forbidden') || msg.includes('403')) return 'No tienes permisos para esta acción'
  if (msg.includes('not found') || msg.includes('404')) return 'Recurso no encontrado'
  if (msg.includes('timeout') || msg.includes('network')) return 'Error de conexión. Comprueba tu red'
  if (msg.includes('500') || msg.includes('internal')) return 'Error del servidor. Inténtalo más tarde'
  return fallback
}

// ── AbortController registry for request cancellation ───────────────────────

const _controllers = new Map()

export function abortRequests(key) {
  if (key) {
    _controllers.get(key)?.abort()
    _controllers.delete(key)
  } else {
    _controllers.forEach(c => c.abort())
    _controllers.clear()
  }
}

function getSignal(key) {
  if (!key) return undefined
  _controllers.get(key)?.abort()
  const controller = new AbortController()
  _controllers.set(key, controller)
  return controller.signal
}

// ── Estado de NoofitPro (proxy /wiemspro) ───────────────────────────────────
// Todas las llamadas de este módulo van a NoofitPro. Con un timeout detectamos
// "lento/caído" y avisamos a la UI vía evento global (NoofitStatusBanner lo
// escucha). Así un trainer ya verificado sigue gestionando los datos LOCALES
// de Round (van por otro backend) aunque NoofitPro no responda, y se le avisa
// al consultar datos que sí dependen de NoofitPro.
const NOOFIT_TIMEOUT_MS = 15000

function _emitNoofitStatus(ok, reason) {
  try {
    window.dispatchEvent(new CustomEvent('round.noofit-status',
      { detail: { ok, reason: reason || null, ts: Date.now() } }))
  } catch { /* SSR / no window */ }
}

// fetch a NoofitPro con timeout + detección de caída. Combina el signal de
// cancelación por abortKey (navegación) con un timeout. Emite el estado.
async function _fetchNF(url, init = {}, abortKey) {
  let signal
  try {
    const timeoutSig = AbortSignal.timeout(NOOFIT_TIMEOUT_MS)
    if (abortKey) {
      const keySig = getSignal(abortKey)
      signal = (typeof AbortSignal.any === 'function')
        ? AbortSignal.any([keySig, timeoutSig]) : timeoutSig
    } else {
      signal = timeoutSig
    }
  } catch { signal = getSignal(abortKey) }  // navegadores sin AbortSignal.timeout
  try {
    const res = await fetch(url, { ...init, signal })
    // 502/503/504 = gateway/proxy: NoofitPro no disponible
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      _emitNoofitStatus(false, `http_${res.status}`)
    } else {
      _emitNoofitStatus(true)  // respondió → NoofitPro operativo
    }
    return res
  } catch (e) {
    const name = e?.name || ''
    const isTimeout = name === 'TimeoutError'
    const isManualAbort = name === 'AbortError' && !isTimeout  // cancelado por navegación
    if (!isManualAbort) _emitNoofitStatus(false, isTimeout ? 'timeout' : 'network')
    throw e
  }
}

// Helper: chequea status 401 y, si parece auth expirado, redirige a /login
// devolviendo true para que el caller pueda interrumpir el flujo.
async function _checkAuthExpired(res) {
  if (res.status !== 401) return false
  let body = ''
  try { body = await res.clone().text() } catch { /* ignore */ }
  if (isAuthExpiredResponse(res.status, body)) {
    handleAuthExpired()
    return true
  }
  return false
}

export async function apiGet(path, { abortKey } = {}) {
  const { token, manager } = getSession()
  const res = await _fetchNF(`${BASE}/${path}`, {
    method: 'GET',
    headers: authHeaders(token, manager),
  }, abortKey)
  if (await _checkAuthExpired(res)) throw new Error('Sesión expirada')
  if (!res.ok) throw new Error(userFriendlyError(`Error ${res.status}`))
  const data = await res.json()
  if (data?.mensaje !== 'OK') throw new Error(userFriendlyError(data?.mensaje, 'Error en la respuesta'))
  return data
}

export async function apiGetRaw(path, { abortKey } = {}) {
  const { token, manager } = getSession()
  const res = await _fetchNF(`${BASE}/${path}`, {
    method: 'GET',
    headers: authHeaders(token, manager),
  }, abortKey)
  if (await _checkAuthExpired(res)) throw new Error('Sesión expirada')
  if (!res.ok) throw new Error(userFriendlyError(`Error ${res.status}`))
  return res.json()
}

function stripNulls(obj) {
  if (Array.isArray(obj)) return obj.map(stripNulls)
  if (obj && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => [k, stripNulls(v)])
    )
  }
  return obj
}

export async function apiPost(path, body = {}, extraHeaders = {}, { abortKey } = {}) {
  const { token, manager } = getSession()
  const res = await _fetchNF(`${BASE}/${path}`, {
    method: 'POST',
    headers: { ...authHeaders(token, manager), 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(stripNulls(body)),
  }, abortKey)
  if (await _checkAuthExpired(res)) throw new Error('Sesión expirada')
  if (!res.ok) throw new Error(userFriendlyError(`Error ${res.status}`))
  const data = await res.json()
  if (data?.mensaje !== 'OK') throw new Error(userFriendlyError(data?.mensaje, 'Error en la operación'))
  return data
}

// Variante que NO filtra por mensaje — devuelve la respuesta completa para
// poder leer el error real del backend en el caller.
export async function apiPostRaw(path, body = {}, extraHeaders = {}) {
  const { token, manager } = getSession()
  const res = await _fetchNF(`${BASE}/${path}`, {
    method: 'POST',
    headers: { ...authHeaders(token, manager), 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(stripNulls(body)),
  })
  let body_text = ''
  try { body_text = await res.text() } catch {}
  // Detectar sesión expirada antes de devolver (no rompemos el caller,
  // pero disparamos la redirección global).
  if (res.status === 401 && isAuthExpiredResponse(res.status, body_text)) {
    handleAuthExpired()
  }
  let data = null
  try { data = JSON.parse(body_text) } catch {}
  return { status: res.status, ok: res.ok, data, text: body_text }
}

// HTTP DELETE arbitrario (con o sin body)
export async function apiDeleteRaw(path, body = null) {
  const { token, manager } = getSession()
  const init = {
    method: 'DELETE',
    headers: { ...authHeaders(token, manager), 'Content-Type': 'application/json' },
  }
  if (body) init.body = JSON.stringify(stripNulls(body))
  const res = await _fetchNF(`${BASE}/${path}`, init)
  let body_text = ''
  try { body_text = await res.text() } catch {}
  if (res.status === 401 && isAuthExpiredResponse(res.status, body_text)) {
    handleAuthExpired()
  }
  let data = null
  try { data = JSON.parse(body_text) } catch {}
  return { status: res.status, ok: res.ok, data, text: body_text }
}

// ── In-memory cache with Map for O(1) eviction ─────────────────────────────
const _cache = new Map()

function evictOldest() {
  if (_cache.size <= CACHE_MAX_ENTRIES) return
  // Map iterates in insertion order — first key is oldest
  const oldest = _cache.keys().next().value
  _cache.delete(oldest)
}

// Mapa de promesas en vuelo para evitar lanzar dos peticiones idénticas
// en paralelo (p.ej. prefetch en hover + click del usuario al mismo tiempo).
const _inflight = new Map()

function cached(key, fetcher) {
  const entry = _cache.get(key)
  if (entry && entry.data && Date.now() - entry.ts < CACHE_TTL) return Promise.resolve(entry.data)
  const pending = _inflight.get(key)
  if (pending) return pending
  const promise = fetcher().then(data => {
    _cache.set(key, { data, ts: Date.now() })
    evictOldest()
    _inflight.delete(key)
    return data
  }).catch(err => {
    _inflight.delete(key)
    throw err
  })
  _inflight.set(key, promise)
  return promise
}

export function invalidateCache(key) {
  if (key) _cache.delete(key)
  else _cache.clear()
}

// Peek síncrono a la caché (stale-while-revalidate): devuelve el dato en caché
// aunque esté caducado. Útil para pintar al instante mientras se refresca en
// segundo plano. Retorna null si nunca se ha cacheado.
export function peekCache(key) {
  const entry = _cache.get(key)
  return entry ? entry.data : null
}

// ── Persistencia en sessionStorage (sobrevive a F5) ────────────────────────
// Para endpoints grandes y costosos: persisimos el payload + timestamp.
// En la próxima sesión seguirá vivo; lo usamos para pintar al instante.
const PERSIST_KEY = (key) => `round:cache:${key}`
const PERSIST_MAX_AGE = 30 * 60_000 // 30 min — más allá preferimos refetch

export function peekPersistedCache(key) {
  // 1) cache en memoria (caliente) → devuélvelo
  const mem = peekCache(key)
  if (mem != null) return mem
  // 2) sessionStorage (sobrevive a F5)
  try {
    const raw = sessionStorage.getItem(PERSIST_KEY(key))
    if (!raw) return null
    const { data, ts } = JSON.parse(raw)
    if (!data || typeof ts !== 'number') return null
    if (Date.now() - ts > PERSIST_MAX_AGE) return null
    // Rehidratar cache en memoria para próximas lecturas
    _cache.set(key, { data, ts })
    return data
  } catch { return null }
}

export function setPersistedCache(key, data) {
  try {
    sessionStorage.setItem(PERSIST_KEY(key), JSON.stringify({ data, ts: Date.now() }))
  } catch { /* quota o serialización — ignoramos */ }
}

export function clearPersistedCache(key) {
  try {
    if (key) sessionStorage.removeItem(PERSIST_KEY(key))
    else {
      for (const k of Object.keys(sessionStorage)) {
        if (k.startsWith('round:cache:')) sessionStorage.removeItem(k)
      }
    }
  } catch { /* no-op */ }
}

// ── Named endpoint helpers ──────────────────────────────────────────────────

// Normaliza la URL de la foto del cliente probando varios nombres de campo
// que el backend ha usado en distintas versiones.
function pickImgUrl(c) {
  return (
    c?.imgUrl ??
    c?.urlImagen ??
    c?.imagenUrl ??
    c?.pictureUrl ??
    c?.pictureClient ??
    c?.picture ??
    c?.fotoUrl ??
    c?.foto ??
    c?.photo ??
    c?.imagen ??
    c?.avatar ??
    ''
  ) || ''
}

// Helper: lee el filtro de trainer del admin (sessionStorage 'round.trainer_filter')
// Devuelve string id_trainer o null si "Todos".
function getTrainerFilterFromStorage() {
  try {
    const v = sessionStorage.getItem('round.trainer_filter')
    if (!v || v === 'all' || v === '*' || v === '') return null
    return v
  } catch { return null }
}

export const getClientes = () => {
  const trainerFiltro = getTrainerFilterFromStorage()
  const cacheKey = trainerFiltro ? `clientes:${trainerFiltro}` : 'clientes'
  return cached(cacheKey, async () => {
    const { jwt, isUsuarioWeb } = getProxyAuth()
    let list
    if (isUsuarioWeb) {
      // Backend filtra por id_trainer del JWT — admin puede pasar override
      // ?id_trainer=X para ver solo los de un centro concreto.
      const url = trainerFiltro
        ? `/api/trainer-data/clientes?id_trainer=${encodeURIComponent(trainerFiltro)}`
        : '/api/trainer-data/clientes'
      const r = await fetch(url, {
        headers: { 'Authorization': `Bearer ${jwt}` },
      })
      if (await _checkAuthExpired(r)) throw new Error('Sesión expirada')
      if (!r.ok) throw new Error(userFriendlyError(`Error ${r.status}`))
      consumeNewToken(r)
      const d = await r.json()
      list = (d.clientes ?? []).map(c => ({ ...c, imgUrl: pickImgUrl(c) }))
    } else {
      // Manager NoofitPro: directo a NoofitPro (sesión clásica)
      const d = await apiGet('api/dispositivos/getClienteSimple')
      list = (d.clientes ?? []).map(c => ({ ...c, imgUrl: pickImgUrl(c) }))
      if (trainerFiltro) {
        list = list.filter(c => String(c.idTrainer || c.trainerId || '') === String(trainerFiltro))
      }
    }
    setPersistedCache(cacheKey, list)
    return list
  })
}

export const getEntrenadores = () =>
  cached('entrenadores', () => apiGet('api/dispositivos/getTrainersByManager').then(d => d.entrenadores ?? []))

export const getEjercicios = () =>
  cached('ejercicios', () => apiGet('api/dispositivos/getEjercicios').then(d => d.ejercicios ?? []))

export const getPlanesEntrenamiento = () =>
  cached('planes', () => apiGet('api/dispositivos/getPlanesEntrenamientosEasy').then(d => d.planesEntrenamiento ?? []))

export const getActividades = () =>
  cached('actividades', () => apiGet('api/dispositivos/getActividades').then(d => d.actividades ?? []))

export const getCuotas = () =>
  apiGet('api/dispositivos/getCuotas').then(d => d.cuotas ?? [])

// guardarActividad: NoofitPro guarda bien pero NO devuelve mensaje='OK'
// (devuelve la actividad u otro shape), así que apiPost lanzaba "error"
// falso aunque la modificación se aplicaba. Usamos apiPostRaw y tratamos
// cualquier 2xx como éxito; solo lanzamos si hay error HTTP o un mensaje
// de error explícito.
export const guardarActividad = async (actividad) => {
  const r = await apiPostRaw('api/dispositivos/guardarActividad', actividad)
  if (!r.ok) {
    const msg = r.data?.mensaje || r.text || `Error ${r.status}`
    throw new Error(userFriendlyError(msg, 'No se pudo guardar la actividad'))
  }
  const m = r.data?.mensaje
  if (typeof m === 'string' && m && m.toUpperCase() !== 'OK' && /error|fallo|inval|no\s|deneg/i.test(m)) {
    throw new Error(userFriendlyError(m, 'No se pudo guardar la actividad'))
  }
  invalidateCache('actividades')   // refrescar la lista tras crear/editar
  return r.data ?? {}
}

export const getSensores = () => {
  try {
    const raw = sessionStorage.getItem('round_session')
    const session = raw ? JSON.parse(raw) : {}
    const managerId = session.entrenador?.managerId ?? session.manager ?? ''
    return apiPost('api/dispositivos/getSensorsByManager', { managerId }).then(d => d.sensores ?? [])
  } catch {
    return Promise.resolve([])
  }
}

async function _proxySalas(body = {}) {
  const { jwt } = getProxyAuth()
  const trainerFiltro = getTrainerFilterFromStorage()
  if (trainerFiltro) body = { ...body, id_trainer: trainerFiltro }
  const r = await fetch('/api/trainer-data/salas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${jwt}` },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const d = await r.json()
  return d.salas ?? []
}

// Trainer efectivo para filtrar clases en login NoofitPro DIRECTO:
// override del selector admin, o el trainer de la sesión (roundTrainerId, que
// fija el fix de identidad por X-TRAINER_MANAGER). null = manager/todos.
// (El usuario_web NO pasa por aquí: filtra el proxy server-side por su JWT.)
function effectiveTrainerId() {
  const override = getTrainerFilterFromStorage()
  if (override) return override
  try {
    const raw = sessionStorage.getItem('round_session')
    const s = raw ? JSON.parse(raw) : {}
    return s?.roundTrainerId ? String(s.roundTrainerId) : null
  } catch { return null }
}

function _filtrarSalasPorTrainer(salas) {
  const tf = effectiveTrainerId()
  if (!tf) return salas
  return salas.filter(s => String(s.idTrainer || s.trainerId || '') === String(tf))
}

export const getSalas = () => {
  const tf = effectiveTrainerId()
  const key = tf ? `salas:${tf}` : 'salas'
  return cached(key, () => {
    const { isUsuarioWeb } = getProxyAuth()
    if (isUsuarioWeb) return _proxySalas({}).catch(() => [])
    try {
      const raw = sessionStorage.getItem('round_session')
      const session = raw ? JSON.parse(raw) : {}
      const managerId = session.entrenador?.managerId ?? session.manager ?? ''
      return apiPost('api/dispositivos/getSalasByManager', { idManager: managerId }, { initialId: '0' })
        .then(d => _filtrarSalasPorTrainer(d.salas ?? []))
    } catch {
      return Promise.resolve([])
    }
  })
}

export const getSalasRango = (fechaDesde, fechaHasta) => {
  const tf = effectiveTrainerId()
  const key = `salas-${fechaDesde}-${fechaHasta}` + (tf ? `:${tf}` : '')
  return cached(key, () => {
    const { isUsuarioWeb } = getProxyAuth()
    if (isUsuarioWeb) return _proxySalas({ fechaDesde, fechaHasta }).catch(() => [])
    try {
      const raw = sessionStorage.getItem('round_session')
      const session = raw ? JSON.parse(raw) : {}
      const managerId = session.entrenador?.managerId ?? session.manager ?? ''
      return apiPost(
        'api/dispositivos/getSalasByManager',
        { idManager: managerId, fechaDesde, fechaHasta },
        { initialId: '0' },
      ).then(d => _filtrarSalasPorTrainer(d.salas ?? []))
    } catch {
      return Promise.resolve([])
    }
  })
}

// Endpoint específico para rango de fechas con histórico
function isoWithOffset(date) {
  const pad = n => String(Math.abs(n)).padStart(2, '0')
  const tz = -date.getTimezoneOffset()
  const sign = tz >= 0 ? '+' : '-'
  const tzH = pad(Math.floor(Math.abs(tz) / 60))
  const tzM = pad(Math.abs(tz) % 60)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${tzH}:${tzM}`
}

export const getSalasByRange = (fechaDesde, fechaHasta) => {
  const tfKey = effectiveTrainerId() || 'all'
  const key = `salas-range:${fechaDesde.toISOString().slice(0, 10)}:${fechaHasta.toISOString().slice(0, 10)}:${tfKey}`
  return cached(key, async () => {
    const { isUsuarioWeb } = getProxyAuth()
    if (isUsuarioWeb) {
      const list = await _proxySalas({
        fechaDesde: isoWithOffset(fechaDesde),
        fechaHasta: isoWithOffset(fechaHasta),
      }).catch(() => [])
      return list.filter(s => s.enabled !== false)
    }
    // Login NoofitPro directo: NoofitPro NO filtra por trainer (devuelve todas
    // las del manager) → filtramos por el trainer de la sesión para aislar.
    return apiPost('api/dispositivos/getSalasByManagerByRange', {
      fechaDesde: isoWithOffset(fechaDesde),
      fechaHasta: isoWithOffset(fechaHasta),
    }).then(d => _filtrarSalasPorTrainer((d.salas ?? []).filter(s => s.enabled !== false)))
  })
}

export function invalidateSalasCache() {
  for (const key of [..._cache.keys()]) {
    if (key === 'salas' || key.startsWith('salas-') || key.startsWith('salas-range:')) _cache.delete(key)
  }
}

export const postClientes = async (clienteList) => {
  // Usamos apiPostRaw para conservar el mensaje exacto de NoofitPro
  // (apiPost lo aplasta con userFriendlyError → no veríamos "DNI inválido",
  // "email ya existe", etc.).
  const r = await apiPostRaw(
    'api/dispositivos/clientePlusv2',
    clienteList.map(c => ({ ...c, toSend: true }))
  )
  if (!r.ok || (r.data && r.data.mensaje && r.data.mensaje !== 'OK')) {
    const noofitMsg = r.data?.mensaje || r.data?.error || `HTTP ${r.status}`
    const err = new Error(noofitMsg)
    err.noofitMessage = noofitMsg
    err.body = r.data
    err.status = r.status
    throw err
  }
  invalidateCache('clientes')
  clearPersistedCache('clientes')
  // Tras crear/editar en NoofitPro, refrescar la cache local del backend
  // para que el banner de "Nuevos clientes" y el listado lo detecten al
  // instante (no haya que esperar al sync background de 60 s ni al cron).
  // Solo aplica a usuario_web — el manager nativo no usa cache de backend.
  try {
    const { jwt, isUsuarioWeb } = getProxyAuth()
    if (isUsuarioWeb && jwt) {
      await fetch('/api/trainer-data/clientes/sync', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${jwt}` },
      })
    }
  } catch {
    /* Si el sync falla no rompemos el alta: la BD local se refrescará en
       el siguiente polling (≤ 30 s) o en el cron horario. */
  }
  return r
}

export const saveSala = (sala) =>
  apiPost('api/dispositivos/saveSala', sala).then(d => d.sala ?? null)

export const removeSala = (id) =>
  apiPost('api/dispositivos/userRemoveSala', { id })

export const getUsuariosBySala = (salaId) =>
  apiPost('api/dispositivos/getUsuariosBySala', { id: salaId }, { initialId: '0' }).then(d => d.usuarios ?? [])

export const updateUsuarioSala = (usuario) =>
  apiPost('api/dispositivos/saveUsuarioSalaModelNotif', usuario)

export const userJoinSalas = (model) =>
  apiPost('api/dispositivos/userJoinSalas', model)

export const userRemoveSala = (id) =>
  apiPost('api/dispositivos/userRemoveSala', { id })

export const desvinculaCliente = (idCliente) =>
  apiPost('api/dispositivos/desvinculaCliente', { idCliente })

export const getTrainingsUser = (idCliente) =>
  apiPost('api/dispositivos/getTrainingsUser', { id: idCliente }, { initialId: '0' }).then(d => d.trainings ?? [])

/**
 * Derive training history from salas (classes) the client attended.
 * Uses getSalasByRange + getUsuariosBySala. Returns an array of "training-like"
 * entries with { id, dateStart, name, duration, verify }.
 */
export const getTrainingsFromSalas = async (idCliente, { dias = 365 } = {}) => {
  const hasta = new Date()
  const desde = new Date(); desde.setDate(desde.getDate() - dias)
  const salas = await getSalasByRange(desde, hasta)
  const results = await Promise.all(
    salas.map(s => getUsuariosBySala(s.id).then(us => ({ s, us })).catch(() => ({ s, us: [] })))
  )
  const trainings = []
  results.forEach(({ s, us }) => {
    const u = us.find(x => x.idClient === idCliente)
    if (!u) return
    trainings.push({
      id: s.id,
      dateStart: s.dateStart,
      name: s.nameTraining || s.name,
      duration: s.duration ?? s.tiempo ?? null,
      verify: !!u.verify,
      sala: s,
    })
  })
  return trainings
}

export const getPlanesCliente = (idCliente) =>
  apiPost('api/dispositivos/getPlanesEntrenamientosCliente', { id: idCliente }, { initialId: '0' }).then(d => d.planesEntrenamientoCliente ?? [])

export const getClasesCliente = (idCliente) =>
  apiPost('api/dispositivos/getReservasByUser', { id: idCliente }, { initialId: '0' })
    .then(d => d.clases ?? d.reservas ?? [])

// Test de Estado Físico — re-export desde configApi (que tira de nuestro
// backend proxy autenticado como trainer, cachea 10 min, y soporta usuarios
// web sin sesión NoofitPro directa).
export { estadoFisicoSessionsCliente as getEstadoFisicoSessions } from './configApi'

// ERP
export const getERPConfiguraciones = () =>
  cached('erp-configs', () =>
    apiGetRaw('api/erp/configuracion').then(d => {
      if (!d) return []
      if (Array.isArray(d)) return d
      // Forma { id, nombre, campos: [...] } → envolver en array
      if ((d.id !== undefined || d.idConfiguracion !== undefined) && d.campos !== undefined) return [d]
      return d.configuraciones ?? d.data ?? []
    })
  )

export const getERPConfiguracionDetalle = (idConfiguracion) =>
  cached(`erp-config-${idConfiguracion}`, () =>
    apiGetRaw(`api/erp/erpconfiguracion/${idConfiguracion}`)
  )

export const getERPConfiguracionCampos = (idConfiguracion) =>
  cached(`erp-campos-${idConfiguracion}`, () =>
    apiGetRaw(`api/erp/erpconfiguracioncampo/${idConfiguracion}`).then(d => {
      if (Array.isArray(d)) return d
      return d?.campos ?? d?.data ?? []
    })
  )

// Guarda la configuración seleccionada por el gestor
export const postERPConfiguracion = (body) =>
  apiPost('api/erp/erpconfiguracion', body)

// Guarda los campos seleccionados por el gestor para una configuración
export const postERPConfiguracionCampos = (body) =>
  apiPost('api/erp/erpconfiguracioncampo', body)

export const getERPDatosCliente = (idCliente) =>
  apiGetRaw(`api/erp/datos/${idCliente}`)

export const postERPDatosCliente = (idCliente, campos) =>
  apiPost(`api/erp/datos/${idCliente}`, { campos })

/**
 * Step 1: POST account/loginEasy
 */
export async function loginEasy(email, password) {
  const body = {
    email,
    appVersion: APP_VERSION,
    password: hashPassword(password),
  }
  const res = await fetch(`${BASE}/account/loginEasy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error('Credenciales incorrectas')
  const token = res.headers.get('X-CustomToken')
  if (!token) throw new Error('No se recibió token de autenticación')
  const manager = res.headers.get('X-TRAINER_MANAGER') ?? ''
  return { token, manager }
}

/**
 * Step 2: GET api/dispositivos/entrenador
 */
export async function getEntrenador(token, manager) {
  const res = await fetch(`${BASE}/api/dispositivos/entrenador`, {
    method: 'GET',
    headers: authHeaders(token, manager),
  })
  if (!res.ok) throw new Error('Error cargando perfil')
  const data = await res.json()
  if (data?.mensaje !== 'OK') throw new Error('Perfil no disponible')
  return data.entrenador
}
