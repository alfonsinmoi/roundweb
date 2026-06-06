import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import {
  loginCliente, meCliente,
  getPortalSession, setPortalSession, clearPortalSession,
} from '../utils/clienteApi'


const PortalAuthCtx = createContext(null)


export function PortalAuthProvider({ children }) {
  const [session, setSession] = useState(() => getPortalSession())
  const [loading, setLoading] = useState(false)

  // Refresca datos del cliente al montar (por si cambió `es_trabajador` desde
  // que se logueó). Si el token es inválido, lo borra y deja sesión vacía.
  useEffect(() => {
    if (!session?.token) return
    let alive = true
    meCliente(session.token)
      .then(d => {
        if (!alive) return
        const next = { ...session, cliente: d.cliente }
        setSession(next)
        setPortalSession(next)
      })
      .catch(err => {
        if (!alive) return
        if (err.status === 401) {
          clearPortalSession()
          setSession(null)
        }
      })
    return () => { alive = false }
  }, []) // eslint-disable-line

  const login = useCallback(async (email, password, id_manager) => {
    setLoading(true)
    try {
      const d = await loginCliente(email, password, id_manager)
      const next = { token: d.token, cliente: d.cliente }
      setPortalSession(next)
      setSession(next)
      return { ok: true }
    } catch (e) {
      return {
        ok: false,
        error: e.message || 'Error de autenticación',
        status: e.status,
        managers: e.body?.managers,   // 409 manager_ambiguo
      }
    } finally { setLoading(false) }
  }, [])

  const logout = useCallback(() => {
    clearPortalSession()
    setSession(null)
  }, [])

  const refresh = useCallback(async () => {
    if (!session?.token) return null
    try {
      const d = await meCliente(session.token)
      const next = { ...session, cliente: d.cliente }
      setSession(next)
      setPortalSession(next)
      return d.cliente
    } catch { return null }
  }, [session])

  return (
    <PortalAuthCtx.Provider value={{
      session, cliente: session?.cliente || null, token: session?.token || null,
      isAuthed: !!session?.token,
      loading, login, logout, refresh,
    }}>
      {children}
    </PortalAuthCtx.Provider>
  )
}


export function usePortalAuth() {
  const v = useContext(PortalAuthCtx)
  if (!v) throw new Error('usePortalAuth fuera de PortalAuthProvider')
  return v
}
