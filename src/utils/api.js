import md5 from 'md5'

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
    return { token: session.token ?? '', manager: session.manager ?? '', trainerId: session.id }
  } catch {
    return { token: '', manager: '', trainerId: null }
  }
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

export async function apiGet(path, { abortKey } = {}) {
  const { token, manager } = getSession()
  const signal = getSignal(abortKey)
  const res = await fetch(`${BASE}/${path}`, {
    method: 'GET',
    headers: authHeaders(token, manager),
    signal,
  })
  if (!res.ok) throw new Error(userFriendlyError(`Error ${res.status}`))
  const data = await res.json()
  if (data?.mensaje !== 'OK') throw new Error(userFriendlyError(data?.mensaje, 'Error en la respuesta'))
  return data
}

export async function apiGetRaw(path, { abortKey } = {}) {
  const { token, manager } = getSession()
  const signal = getSignal(abortKey)
  const res = await fetch(`${BASE}/${path}`, {
    method: 'GET',
    headers: authHeaders(token, manager),
    signal,
  })
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
  const signal = getSignal(abortKey)
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: { ...authHeaders(token, manager), 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(stripNulls(body)),
    signal,
  })
  if (!res.ok) throw new Error(userFriendlyError(`Error ${res.status}`))
  const data = await res.json()
  if (data?.mensaje !== 'OK') throw new Error(userFriendlyError(data?.mensaje, 'Error en la operación'))
  return data
}

// Variante que NO filtra por mensaje — devuelve la respuesta completa para
// poder leer el error real del backend en el caller.
export async function apiPostRaw(path, body = {}, extraHeaders = {}) {
  const { token, manager } = getSession()
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: { ...authHeaders(token, manager), 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(stripNulls(body)),
  })
  let body_text = ''
  try { body_text = await res.text() } catch {}
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
  const res = await fetch(`${BASE}/${path}`, init)
  let body_text = ''
  try { body_text = await res.text() } catch {}
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

function cached(key, fetcher) {
  const entry = _cache.get(key)
  if (entry && Date.now() - entry.ts < CACHE_TTL) return Promise.resolve(entry.data)
  return fetcher().then(data => {
    _cache.set(key, { data, ts: Date.now() })
    evictOldest()
    return data
  })
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

export const getClientes = () =>
  cached('clientes', () =>
    apiGet('api/dispositivos/getClienteSimple').then(d => {
      const list = d.clientes ?? []
      // Persistimos para pintado instantáneo en recargas posteriores (F5)
      setPersistedCache('clientes', list)
      return list
    })
  )

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

export const guardarActividad = (actividad) =>
  apiPost('api/dispositivos/guardarActividad', actividad)

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

export const getSalas = () =>
  cached('salas', () => {
    try {
      const raw = sessionStorage.getItem('round_session')
      const session = raw ? JSON.parse(raw) : {}
      const managerId = session.entrenador?.managerId ?? session.manager ?? ''
      return apiPost('api/dispositivos/getSalasByManager', { idManager: managerId }, { initialId: '0' }).then(d => d.salas ?? [])
    } catch {
      return Promise.resolve([])
    }
  })

export const getSalasRango = (fechaDesde, fechaHasta) =>
  cached(`salas-${fechaDesde}-${fechaHasta}`, () => {
    try {
      const raw = sessionStorage.getItem('round_session')
      const session = raw ? JSON.parse(raw) : {}
      const managerId = session.entrenador?.managerId ?? session.manager ?? ''
      return apiPost(
        'api/dispositivos/getSalasByManager',
        { idManager: managerId, fechaDesde, fechaHasta },
        { initialId: '0' },
      ).then(d => d.salas ?? [])
    } catch {
      return Promise.resolve([])
    }
  })

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
  const key = `salas-range:${fechaDesde.toISOString().slice(0, 10)}:${fechaHasta.toISOString().slice(0, 10)}`
  return cached(key, () =>
    apiPost('api/dispositivos/getSalasByManagerByRange', {
      fechaDesde: isoWithOffset(fechaDesde),
      fechaHasta: isoWithOffset(fechaHasta),
    }).then(d => (d.salas ?? []).filter(s => s.enabled !== false))
  )
}

export function invalidateSalasCache() {
  for (const key of [..._cache.keys()]) {
    if (key === 'salas' || key.startsWith('salas-') || key.startsWith('salas-range:')) _cache.delete(key)
  }
}

export const postClientes = (clienteList) =>
  apiPost('api/dispositivos/clientePlusv2', clienteList.map(c => ({ ...c, toSend: true }))).then(r => {
    invalidateCache('clientes')
    clearPersistedCache('clientes')
    return r
  })

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
