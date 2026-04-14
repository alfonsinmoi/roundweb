import { createContext, useContext, useState, useEffect } from 'react'
import { loginEasy, getEntrenador } from '../utils/api'

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

  /**
   * Calls the real WiemsPro API:
   * 1. POST account/loginEasy → token
   * 2. GET api/dispositivos/entrenador → trainer profile
   * Returns { ok: true } or { ok: false, error: string }
   */
  const login = async (email, password) => {
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
      sessionStorage.setItem('round_token', token)
      setUser(userData)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err.message ?? 'Error de autenticación' }
    }
  }

  const logout = () => {
    sessionStorage.removeItem('round_session')
    sessionStorage.removeItem('round_token')
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
