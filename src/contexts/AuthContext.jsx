import { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react'
import { loginEasy, getEntrenador, invalidateCache, abortRequests } from '../utils/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const saved = sessionStorage.getItem('round_session')
    if (saved) {
      try { setUser(JSON.parse(saved)) } catch { sessionStorage.removeItem('round_session') }
    }
    setLoading(false)
  }, [])

  const login = useCallback(async (email, password) => {
    try {
      const { token, manager } = await loginEasy(email, password)
      const entrenador = await getEntrenador(token, manager)

      const userData = {
        token,
        manager,
        email,
        nombre: entrenador?.name ?? email,
        apellidos: entrenador?.surname ?? '',
        id: entrenador?.id,
        role: 'trainer',
        entrenador,
      }

      sessionStorage.setItem('round_session', JSON.stringify(userData))
      setUser(userData)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err.message ?? 'Error de autenticación' }
    }
  }, [])

  const logout = useCallback(() => {
    sessionStorage.removeItem('round_session')
    invalidateCache()
    abortRequests()
    setUser(null)
  }, [])

  const value = useMemo(() => ({ user, loading, login, logout }), [user, loading, login, logout])

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
