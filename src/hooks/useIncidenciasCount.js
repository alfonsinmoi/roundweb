// Hook para el badge del sidebar de Incidencias.
// Llama a /api/incidencias/count cada 60s (pausado si pestaña oculta).
// Falla en silencio: si la API revienta o el usuario no tiene permiso,
// el contador queda a 0 y el badge no aparece.

import { useEffect, useState, useMemo } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { getRoundIdentity, incidenciasCount } from '../utils/configApi'
import { hasPermission } from '../config/permissions'

export function useIncidenciasCount() {
  const { user } = useAuth()
  const identity = useMemo(() => getRoundIdentity(user), [user])
  const [count, setCount] = useState(0)

  // Gating: si es usuario_web sin permiso, no preguntamos siquiera.
  const enabled = !!user && (
    user.kind !== 'usuario_web' || hasPermission(user.perfil, 'incidencias.ver')
  )

  useEffect(() => {
    if (!enabled || !identity.managerId) { setCount(0); return }
    let cancelled = false
    const fetchCount = () => {
      if (document.visibilityState !== 'visible') return
      incidenciasCount(identity)
        .then(n => { if (!cancelled) setCount(n) })
        .catch(() => {/* silencioso: badge se queda como estaba */})
    }
    fetchCount()
    const id = setInterval(fetchCount, 60_000)
    const onVis = () => { if (document.visibilityState === 'visible') fetchCount() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelled = true
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [identity.managerId, identity.trainerId, enabled])

  return count
}
