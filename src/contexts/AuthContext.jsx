import { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react'
import { loginEasy, getEntrenador, invalidateCache, abortRequests, clearPersistedCache } from '../utils/api'
import { loginUsuarioWeb, meUsuarioWeb } from '../utils/authUsuarioApi'

const AuthContext = createContext(null)

const STORAGE_KEY = 'round_session'

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
  const login = useCallback(async (email, password) => {
    invalidateCache()
    abortRequests()
    clearPersistedCache()

    // Intento 1: usuario_web
    try {
      const res = await loginUsuarioWeb(email, password)
      if (res.mustChangePassword) {
        // Devolvemos info para que la UI redirija al flujo de cambio
        return {
          ok: false,
          mustChangePassword: true,
          reason: res.reason,
          message: res.message || 'Debes cambiar tu contraseña antes de continuar.',
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
      const userData = buildUserData(token, manager, entrenador, email)
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
      const originalSession = user.originalSession ?? {
        token: user.token, manager: user.manager, email: user.email,
        nombre: user.nombre, apellidos: user.apellidos, imgUrl: user.imgUrl,
        id: user.id, entrenador: user.entrenador,
      }
      const newUser = { ...buildUserData(token, manager, entrenador, trainerEmail), originalSession }
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
    const restoredUser = { ...buildUserData(orig.token, orig.manager, orig.entrenador, orig.email), originalSession: null }
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
