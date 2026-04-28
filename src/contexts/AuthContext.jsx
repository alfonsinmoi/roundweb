import { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react'
import { loginEasy, getEntrenador, invalidateCache, abortRequests, clearPersistedCache } from '../utils/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const saved = sessionStorage.getItem('round_session')
    if (saved) {
      try { setUser(JSON.parse(saved)) } catch { sessionStorage.removeItem('round_session') }
    }
    setLoading(false)
  }, [])

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function buildUserData(token, manager, entrenador, email, extra = {}) {
    return {
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
      ...extra,
    }
  }

  // ── Login gestor ─────────────────────────────────────────────────────────────
  const login = useCallback(async (email, password) => {
    try {
      invalidateCache()
      abortRequests()
      clearPersistedCache()

      const { token, manager } = await loginEasy(email, password)
      const entrenador = await getEntrenador(token, manager)
      const userData = buildUserData(token, manager, entrenador, email)

      sessionStorage.setItem('round_session', JSON.stringify(userData))
      setUser(userData)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err.message ?? 'Error de autenticación' }
    }
  }, [])

  // ── Login como trainer (impersonar con sus propias credenciales) ─────────────
  const loginAsTrainer = useCallback(async (trainerEmail, password) => {
    if (!user) return { ok: false, error: 'Sin sesión activa' }
    try {
      invalidateCache()
      abortRequests()
      clearPersistedCache()

      const { token, manager } = await loginEasy(trainerEmail, password)
      const entrenador = await getEntrenador(token, manager)

      // Guardamos la sesión original del gestor para poder volver
      const originalSession = user.originalSession ?? {
        token:     user.token,
        manager:   user.manager,
        email:     user.email,
        nombre:    user.nombre,
        apellidos: user.apellidos,
        imgUrl:    user.imgUrl,
        id:        user.id,
        entrenador: user.entrenador,
      }

      const newUser = {
        ...buildUserData(token, manager, entrenador, trainerEmail),
        originalSession,
      }

      sessionStorage.setItem('round_session', JSON.stringify(newUser))
      setUser(newUser)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err.message ?? 'Credenciales incorrectas' }
    }
  }, [user])

  // ── Volver a la sesión del gestor ────────────────────────────────────────────
  const switchBackToManager = useCallback(() => {
    if (!user?.originalSession) return
    const orig = user.originalSession

    invalidateCache()
    clearPersistedCache()

    const restoredUser = {
      ...buildUserData(orig.token, orig.manager, orig.entrenador, orig.email),
      originalSession: null,
    }

    sessionStorage.setItem('round_session', JSON.stringify(restoredUser))
    setUser(restoredUser)
  }, [user])

  // ── Logout ───────────────────────────────────────────────────────────────────
  const logout = useCallback(() => {
    sessionStorage.removeItem('round_session')
    invalidateCache()
    abortRequests()
    clearPersistedCache()
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
