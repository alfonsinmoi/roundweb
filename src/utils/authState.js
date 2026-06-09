// Gestión central del estado de sesión, complementa AuthContext.
//
// Dos responsabilidades:
//   1. `handleAuthExpired()` — limpia la sesión y manda al usuario a /login
//      cuando alguna petición devuelve 401 (token expirado o inválido).
//   2. `consumeNewToken(response)` — lee la cabecera `X-New-Token` que el
//      backend añade cuando renueva el JWT en cada petición (sliding refresh),
//      y actualiza el `jwt` guardado en sessionStorage de forma transparente.
//
// Estas utilidades se llaman desde las capas de fetch (`api.js`,
// `configApi.js`, etc.), no desde los componentes — para que cualquier fallo
// de auth se gestione de forma uniforme.

const STORAGE_KEY = 'round_session'

let _expiring = false   // evita bucles de redirect


// Lee el JWT actual de sessionStorage (si la sesión es de un usuario_web).
// Para sesiones de manager NoofitPro clásico (login directo en NoofitPro) NO
// hay JWT — devuelve '' y los endpoints siguen autenticando con el token
// compartido X-Round-Token + headers.
export function getStoredJwt() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return ''
    const s = JSON.parse(raw)
    return (s && typeof s === 'object' && typeof s.jwt === 'string') ? s.jwt : ''
  } catch { return '' }
}

// JWT firmado de la sesión de MANAGER NoofitPro (H1 paso 1). Distinto del
// `jwt` de usuario_web. Vincula el tenant para que las peticiones no dependan
// solo de la cabecera X-Round-Manager-Id. Si no hay (sesión vieja sin
// bootstrap nuevo) devuelve '' y se mantiene el comportamiento por cabecera.
export function getStoredManagerJwt() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return ''
    const s = JSON.parse(raw)
    return (s && typeof s === 'object' && typeof s.managerJwt === 'string') ? s.managerJwt : ''
  } catch { return '' }
}

export function handleAuthExpired() {
  if (_expiring) return
  _expiring = true
  try { sessionStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
  // Aviso al AuthContext (si está montado) para que vacíe `user`.
  try { window.dispatchEvent(new CustomEvent('round:auth-expired')) } catch { /* ignore */ }
  // Hard redirect: garantiza que cualquier vista que dependa de auth se reinicia.
  try {
    if (window.location && window.location.pathname !== '/login') {
      const ret = encodeURIComponent(window.location.pathname + window.location.search)
      window.location.href = `/login?return=${ret}`
    }
  } catch { /* ignore */ }
}

// Llamar tras cada `fetch` autenticado exitoso. Si el backend renovó el JWT,
// lo guarda en sessionStorage para que las próximas llamadas lo usen.
export function consumeNewToken(response) {
  try {
    const newToken = response?.headers?.get?.('X-New-Token')
    if (!newToken) return
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const s = JSON.parse(raw)
    if (s && typeof s === 'object' && s.jwt !== newToken) {
      s.jwt = newToken
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s))
    }
  } catch { /* ignore */ }
}

// Helper para decidir si un response 401 corresponde a expiración real (vs 401
// "datos inválidos" que algún endpoint usa erróneamente). Conservador: si el
// body contiene 'invalid_token', 'missing_token', 'invalid credentials' o no
// es JSON parseable, lo tratamos como expiración.
export function isAuthExpiredResponse(status, bodyText) {
  if (status !== 401) return false
  const t = (bodyText || '').toLowerCase()
  if (!t) return true
  // Credenciales mal escritas en el formulario de login NO son expiración.
  if (t.includes('invalid_credentials') || t.includes('credenciales')) return false
  return t.includes('invalid_token')
      || t.includes('missing_token')
      || t.includes('token')
      || t.includes('unauthorized')
      || t.includes('expir')
}


// ── Interceptor global de fetch ─────────────────────────────────────────────
// Monkey-patch `window.fetch` para que CUALQUIER llamada autenticada de la
// app, sin importar dónde, se beneficie de:
//   - sliding refresh (lee `X-New-Token` de la respuesta)
//   - redirect a /login si el backend responde 401 + parece auth expirado
//
// Lo activamos UNA vez al arrancar la app (ver main.jsx). Filtra para que
// 401 de un POST a /login (sin Authorization header) NO dispare redirect —
// eso es simplemente "credenciales mal escritas".
let _installed = false

export function installAuthInterceptor() {
  if (_installed) return
  if (typeof window === 'undefined' || !window.fetch) return
  _installed = true
  const original = window.fetch.bind(window)

  window.fetch = async function patchedFetch(input, init = {}) {
    const res = await original(input, init)
    try {
      // 1) Sliding refresh — actualizar JWT silenciosamente
      consumeNewToken(res)
      // 2) Detección de expiración → redirect global
      if (res.status === 401) {
        // ¿Era una request autenticada? Si no, es un 401 "credenciales malas"
        // de un formulario público y lo dejamos pasar.
        const hdrs = (init && init.headers) || {}
        const headerStr = (() => {
          try {
            if (hdrs instanceof Headers) {
              return [hdrs.get('Authorization') || '',
                      hdrs.get('X-CustomToken') || ''].join(' ')
            }
            const auth = hdrs['Authorization'] || hdrs['authorization'] || ''
            const ctok = hdrs['X-CustomToken'] || hdrs['x-customtoken'] || ''
            return `${auth} ${ctok}`
          } catch { return '' }
        })()
        const wasAuthenticated = headerStr.includes('Bearer ')
                                || headerStr.trim().length > 1
        if (wasAuthenticated) {
          let body = ''
          try { body = await res.clone().text() } catch { /* ignore */ }
          if (isAuthExpiredResponse(res.status, body)) {
            handleAuthExpired()
          }
        }
      }
    } catch { /* el interceptor nunca debe romper la app */ }
    return res
  }
}
