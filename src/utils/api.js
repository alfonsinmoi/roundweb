import md5 from 'md5'

const BASE = '/wiemspro'
const APP_VERSION = '1.8.39'
const APP_ID = '1'

const hashPassword = (pass) => md5(pass).toUpperCase()

const authHeaders = (token, manager) => ({
  'X-CustomToken': token,
  'locale': 'es',
  'appVersion': APP_VERSION,
  'appId': APP_ID,
  ...(manager ? { 'X-TRAINER_MANAGER': manager } : {}),
})

function getSession() {
  const token = sessionStorage.getItem('round_token') ?? ''
  try {
    const raw = sessionStorage.getItem('round_session')
    const session = raw ? JSON.parse(raw) : {}
    return { token, manager: session.manager ?? '', trainerId: session.id }
  } catch {
    return { token, manager: '', trainerId: null }
  }
}

export async function apiGet(path) {
  const { token, manager } = getSession()
  const res = await fetch(`${BASE}/${path}`, {
    method: 'GET',
    headers: authHeaders(token, manager),
  })
  if (!res.ok) throw new Error(`Error ${res.status}`)
  const data = await res.json()
  if (data?.mensaje !== 'OK') throw new Error(data?.mensaje ?? 'Error en la respuesta')
  return data
}

// Remove null/undefined keys from object (like NooFitPro's NullValueHandling.Ignore)
function stripNulls(obj) {
  if (Array.isArray(obj)) return obj.map(stripNulls)
  if (obj && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => [k, stripNulls(v)])
    )
  }
  return obj
}

export async function apiPost(path, body = {}, extraHeaders = {}) {
  const { token, manager } = getSession()
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: { ...authHeaders(token, manager), 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(stripNulls(body)),
  })
  if (!res.ok) throw new Error(`Error ${res.status}`)
  const data = await res.json()
  if (data?.mensaje !== 'OK') throw new Error(data?.mensaje ?? 'Error en la respuesta')
  return data
}

// Named endpoint helpers

export const getClientes = () =>
  apiGet('api/dispositivos/getClienteSimple').then(d => d.clientes ?? [])

export const getEntrenadores = () =>
  apiGet('api/dispositivos/getTrainersByManager').then(d => d.entrenadores ?? [])

export const getEjercicios = () =>
  apiGet('api/dispositivos/getEjercicios').then(d => d.ejercicios ?? [])

export const getPlanesEntrenamiento = () =>
  apiGet('api/dispositivos/getPlanesEntrenamientosEasy').then(d => d.planesEntrenamiento ?? [])

export const getActividades = () =>
  apiGet('api/dispositivos/getActividades').then(d => d.actividades ?? [])

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

export const getSalas = () => {
  try {
    const raw = sessionStorage.getItem('round_session')
    const session = raw ? JSON.parse(raw) : {}
    const managerId = session.entrenador?.managerId ?? session.manager ?? ''
    return apiPost('api/dispositivos/getSalasByManager', { idManager: managerId }).then(d => d.salas ?? [])
  } catch {
    return Promise.resolve([])
  }
}

export const postClientes = (clienteList) =>
  apiPost('api/dispositivos/clientePlusv2', clienteList.map(c => ({ ...c, toSend: true })))

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

export const getPlanesCliente = (idCliente) =>
  apiPost('api/dispositivos/getPlanesEntrenamientosCliente', { id: idCliente }, { initialId: '0' }).then(d => d.planesEntrenamientoCliente ?? [])

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
  if (!res.ok) throw new Error(`Error cargando perfil (${res.status})`)
  const data = await res.json()
  if (data?.mensaje !== 'OK') throw new Error(`Perfil no disponible: ${data?.mensaje ?? 'sin respuesta'}`)
  return data.entrenador
}
