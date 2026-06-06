import { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react'
import { loginEasy, getEntrenador, invalidateCache, abortRequests, clearPersistedCache } from '../utils/api'
import { loginUsuarioWeb, meUsuarioWeb } from '../utils/authUsuarioApi'
import { getRoundIdentity } from '../utils/configApi'

const AuthContext = createContext(null)

const STORAGE_KEY = 'round_session'

// ── Auto-registro multimanager ─────────────────────────────────────────────
// Tras un login NoofitPro exitoso, llamamos a /api/auth/round-bootstrap
// para asegurar que el manager (+ trainer) están en BD local. Fire-and-forget
// — si falla no rompemos el login (los siguientes endpoints fallarán con
// 403 odoo_not_enabled o mostrarán el banner "no registrado" cuando toque).
const ROUND_API_TOKEN = import.meta.env.VITE_CONFIG_API_TOKEN || ''
async function _roundBootstrap(payload) {
  if (!ROUND_API_TOKEN) return null  // no hay token compartido configurado
  try {
    const r = await fetch('/api/auth/round-bootstrap', {
      method: 'POST',
      headers: {
        'X-Round-Token': ROUND_API_TOKEN,
        'X-Round-Manager-Id': String(payload.id_manager || ''),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    const d = await r.json().catch(() => null)
    // El backend resuelve el TENANT (id_manager) y el ROL (id_trainer) por el
    // flag X-TRAINER_MANAGER. Usamos el tenant resuelto para invalidar caches.
    const mid = (d && d.id_manager) ? d.id_manager : payload.id_manager
    try { sessionStorage.removeItem(`round.odoo_status:${mid}`) } catch { /* noop */ }
    try {
      window.dispatchEvent(new CustomEvent('round.odoo-status-changed',
                                            { detail: { id_manager: mid } }))
    } catch { /* noop */ }
    return d
  } catch { return null }
}

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)
  const [loading, setLoading] = useState(true)

  // Escucha el evento global emitido por `authState.handleAuthExpired()` (lo
  // dispara el interceptor de fetch cuando el backend devuelve 401 + token
  // expirado). Al recibirlo, vaciamos `user` para que `RequireAuth` redirija
  // automáticamente al /login.
  useEffect(() => {
    const onExpired = () => {
      try { sessionStorage.removeItem(STORAGE_KEY) } catch {}
      invalidateCache(); abortRequests(); clearPersistedCache()
      setUser(null)
    }
    window.addEventListener('round:auth-expired', onExpired)
    return () => window.removeEventListener('round:auth-expired', onExpired)
  }, [])

  useEffect(() => {
    const saved = sessionStorage.getItem(STORAGE_KEY)
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        setUser(parsed)
        // Si es usuario_web, intentamos refrescar el /me en background.
        // ⚠ usamos `jwt` (no `token`) porque token ya guarda el NoofitPro.
        if (parsed?.kind === 'usuario_web' && parsed?.jwt) {
          meUsuarioWeb(parsed.jwt).then(d => {
            if (d?.ok) {
              const refreshed = { ...parsed, perfil: d.perfil, usuarioWebData: d.usuario }
              sessionStorage.setItem(STORAGE_KEY, JSON.stringify(refreshed))
              setUser(refreshed)
            }
          }).catch(() => { /* JWT expirado: forzar logout suave */
            sessionStorage.removeItem(STORAGE_KEY); setUser(null)
          })
        }
        // Bootstrap "soft" para sesiones que arrancaron ANTES del
        // auto-registro multimanager: sin password (no se puede sin login
        // fresh), solo crea/actualiza placeholder de manager_config para
        // que el banner "no registrado" desaparezca. La próxima vez que
        // el usuario haga login fresh, se completarán las creds NF.
        if (parsed?.kind === 'manager') {
          try {
            const identity = getRoundIdentity(parsed)
            if (identity?.managerId && parsed?.email) {
              _roundBootstrap({
                id_user:    String(parsed?.id ?? identity.managerId),
                id_manager: String(identity.managerId),
                email:      parsed.email,
                password:   '',  // soft mode (sin password)
                nombre:     parsed?.nombre || null,
              })
            }
          } catch { /* noop */ }
        }
      } catch { sessionStorage.removeItem(STORAGE_KEY) }
    }
    setLoading(false)
  }, [])

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function buildUserData(token, manager, entrenador, email, extra = {}) {
    return {
      kind: 'manager',  // login NoofitPro clásico
      token,
      manager,
      email,
      nombre:    entrenador?.name    ?? email,
      apellidos: entrenador?.surname ?? '',
      imgUrl:    entrenador?.imgUrl  ?? '',
      id:        entrenador?.id,
      role:      'trainer',
      entrenador,
      originalSession: null,
      perfil: null,                   // sin perfil = control total (manager)
      ...extra,
    }
  }

  // ── Login dual: detecta automáticamente usuario_web vs NoofitPro ─────────
  // 1. Intenta primero usuario_web (email del propio sistema Round con perfil)
  //    - Si responde must_change_password → propaga a UI para llevar a cambio
  //    - Si responde 401 con error 'invalid_credentials' o 'missing_fields' →
  //      cae a NoofitPro (puede ser email del manager/trainer)
  // 2. Si NoofitPro funciona → login clásico
  const login = useCallback(async (email, password, idTrainer = null) => {
    invalidateCache()
    abortRequests()
    clearPersistedCache()

    // Intento 1: usuario_web
    try {
      const res = await loginUsuarioWeb(email, password, idTrainer)
      if (res.mustChangePassword) {
        // Devolvemos info para que la UI redirija al flujo de cambio
        return {
          ok: false,
          mustChangePassword: true,
          reason: res.reason,
          message: res.message || 'Debes cambiar tu contraseña antes de continuar.',
        }
      }
      if (res.multiTrainer) {
        // El usuario tiene acceso a varios centros — la UI debe pedirle que
        // elija uno y volver a llamar a `login(email, password, idTrainerElegido)`.
        return {
          ok: false,
          multiTrainer: true,
          trainers: res.trainers || [],
          usuario: res.usuario,
          message: res.message || 'Selecciona el centro al que quieres acceder.',
        }
      }
      if (res.ok && res.token) {
        // Cargar perfil completo
        const me = await meUsuarioWeb(res.token).catch(() => null)
        // El backend nos devuelve un token NoofitPro generado con las
        // credenciales del manager. Lo usamos para los endpoints clásicos
        // (clientes, clases, etc.) — la app no se entera del cambio.
        const nfToken = res.noofit?.token || null
        const nfManagerHeader = res.noofit?.manager || ''
        // Para X-Round-Manager-Id (nuestro backend) usamos SIEMPRE el id_manager
        // de la BD (numérico). Para X-TRAINER_MANAGER (NoofitPro) usamos el que
        // devolvió NoofitPro (puede ser "true" o el id real, NoofitPro lo acepta).
        const userData = {
          kind: 'usuario_web',
          // ⚠ token = el NoofitPro que usan las llamadas X-CustomToken
          token: nfToken || res.token,
          // jwt = nuestro JWT propio para /api/auth/usuario-web/*, /api/notas/*, etc.
          jwt: res.token,
          email: res.usuario.email,
          nombre: res.usuario.nombre,
          apellidos: res.usuario.apellidos || '',
          id: res.usuario.id,
          // manager para X-Round-Manager-Id (nuestro backend, BD)
          manager: res.usuario.id_manager,
          // managerNoofit = el header X-TRAINER_MANAGER que envía la API NoofitPro
          managerNoofit: nfManagerHeader || res.usuario.id_manager,
          id_trainer: res.usuario.id_trainer,
          perfil_id: res.usuario.perfil_id,
          perfil: me?.perfil || null,
          usuarioWebData: me?.usuario || res.usuario,
          originalSession: null,
          role: 'usuario_web',
        }
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(userData))
        setUser(userData)
        return { ok: true }
      }
    } catch (err) {
      // 401 invalid_credentials → puede ser que el usuario sea un manager
      // NoofitPro. Caemos al login clásico. Cualquier otro error: lo
      // reportamos como fallo.
      if (err.status !== 401 && err.status !== 400) {
        return { ok: false, error: err.message ?? 'Error de autenticación' }
      }
    }

    // Intento 2: login NoofitPro (manager / trainer existente)
    try {
      const { token, manager } = await loginEasy(email, password)
      const entrenador = await getEntrenador(token, manager)
      // X-TRAINER_MANAGER: "true" = MANAGER (ve todos los centros del grupo),
      // "false" = TRAINER (scopeado a su propio centro). Es un BOOLEANO, no un id.
      const esManager = ['true', '1', 'yes'].includes(String(manager).trim().toLowerCase())
      const idUser = String(entrenador?.id ?? '')
      // El backend resuelve el TENANT (id_manager) desde trainer_noofit_creds y
      // el ROL desde el flag. Esperamos su respuesta para fijar la identidad real
      // (sin esto, un trainer entraba como "su propio manager" y veía datos de
      // otros centros del grupo — caso roundmalagacentro/Añoreta).
      const boot = await _roundBootstrap({
        id_user: idUser,
        id_manager: idUser,            // pista; el backend lo recalcula
        es_manager: esManager,
        email, password,
        nombre: entrenador?.name
                  ? `${entrenador.name} ${entrenador.surname || ''}`.trim()
                  : null,
      })
      // Cuenta NoofitPro que NO pertenece a ningún manager Round (p.ej. cuenta
      // de otro gimnasio ajeno) → no se le crea tenant; se rechaza el acceso.
      if (boot && boot.ok === false && boot.error === 'trainer_sin_manager') {
        return { ok: false, error: boot.mensaje
                 || 'Tu cuenta NoofitPro no pertenece a ningún manager de Round.' }
      }
      const userData = buildUserData(token, manager, entrenador, email, {
        roundManagerId: (boot && boot.id_manager) ? String(boot.id_manager) : null,
        roundTrainerId: (boot && boot.id_trainer) ? String(boot.id_trainer) : null,
        esManager,
      })
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(userData))
      setUser(userData)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err.message ?? 'Credenciales incorrectas' }
    }
  }, [])

  // ── Login como trainer (impersonar — sólo aplicable a managers NoofitPro) ─
  const loginAsTrainer = useCallback(async (trainerEmail, password) => {
    if (!user) return { ok: false, error: 'Sin sesión activa' }
    if (user.kind === 'usuario_web') return { ok: false, error: 'No disponible para usuarios web' }
    try {
      invalidateCache(); abortRequests(); clearPersistedCache()
      const { token, manager } = await loginEasy(trainerEmail, password)
      const entrenador = await getEntrenador(token, manager)
      const esManager = ['true', '1', 'yes'].includes(String(manager).trim().toLowerCase())
      const idUser = String(entrenador?.id ?? '')
      const originalSession = user.originalSession ?? {
        token: user.token, manager: user.manager, email: user.email,
        nombre: user.nombre, apellidos: user.apellidos, imgUrl: user.imgUrl,
        id: user.id, entrenador: user.entrenador,
        roundManagerId: user.roundManagerId, roundTrainerId: user.roundTrainerId,
        esManager: user.esManager,
      }
      // Registrar/resolver al trainer impersonado (el backend devuelve tenant + rol).
      const boot = await _roundBootstrap({
        id_user: idUser,
        id_manager: idUser,
        es_manager: esManager,
        email: trainerEmail, password,
        nombre: entrenador?.name
                  ? `${entrenador.name} ${entrenador.surname || ''}`.trim()
                  : null,
      })
      const newUser = { ...buildUserData(token, manager, entrenador, trainerEmail, {
        roundManagerId: (boot && boot.id_manager) ? String(boot.id_manager) : null,
        roundTrainerId: (boot && boot.id_trainer) ? String(boot.id_trainer) : null,
        esManager,
      }), originalSession }
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(newUser))
      setUser(newUser)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err.message ?? 'Credenciales incorrectas' }
    }
  }, [user])

  const switchBackToManager = useCallback(() => {
    if (!user?.originalSession) return
    const orig = user.originalSession
    invalidateCache(); clearPersistedCache()
    const restoredUser = { ...buildUserData(orig.token, orig.manager, orig.entrenador, orig.email, {
      roundManagerId: orig.roundManagerId || null,
      roundTrainerId: orig.roundTrainerId || null,
      esManager: orig.esManager,
    }), originalSession: null }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(restoredUser))
    setUser(restoredUser)
  }, [user])

  const logout = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY)
    invalidateCache(); abortRequests(); clearPersistedCache()
    setUser(null)
  }, [])

  const value = useMemo(() => ({
    user,
    loading,
    login,
    logout,
    loginAsTrainer,
    switchBackToManager,
    isImpersonating: !!user?.originalSession,
    isUsuarioWeb: user?.kind === 'usuario_web',
  }), [user, loading, login, logout, loginAsTrainer, switchBackToManager])

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
