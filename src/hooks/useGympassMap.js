import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { getRoundIdentity, clienteGympassList, clienteGympassUpsert, clienteGympassDelete } from '../utils/configApi'

// Hook para cargar y mantener el mapa idnoofit→gympass_id desde el backend VPS.
// Detección por alias se mantiene como fallback hasta que todos los Gympass
// estén marcados explícitamente.
const GYMPASS_RE = /wellhub|gympass|wellpass/i

export function useGympassMap() {
  const { user } = useAuth()
  // Memoizamos identity por sus claves primitivas para evitar bucle infinito
  // (getRoundIdentity devuelve un objeto nuevo cada render).
  const managerId = user?.originalSession?.manager ?? user?.originalSession?.id ?? user?.manager ?? user?.id ?? null
  const trainerId = user?.originalSession ? (user?.manager ?? user?.id) : null
  const identity = useMemo(
    () => getRoundIdentity(user),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [managerId, trainerId]
  )
  const [mapa, setMapa] = useState({})  // idnoofit → gympass_id
  const [loaded, setLoaded] = useState(false)

  const reload = useCallback(async () => {
    if (!identity.managerId) { setLoaded(true); return }
    try {
      const m = await clienteGympassList(identity)
      setMapa(m || {})
    } catch (e) {
      console.warn('cliente_gympass list error:', e.message)
    } finally {
      setLoaded(true)
    }
  }, [identity])

  useEffect(() => { reload() }, [reload])

  // Devuelve true si el cliente tiene gympass según nuestra DB local
  // (o, como fallback, alias contiene patrón Wellhub/Gympass).
  const isGympass = useCallback(
    (cliente) => {
      const id = String(cliente?.id ?? '')
      if (id && mapa[id]) return true
      return GYMPASS_RE.test(cliente?.alias || '')
    },
    [mapa]
  )

  const getGympassId = useCallback(
    (cliente) => {
      const id = String(cliente?.id ?? '')
      return mapa[id] || (GYMPASS_RE.test(cliente?.alias || '') ? 'gympass' : '')
    },
    [mapa]
  )

  const setGympass = useCallback(async (idNoofit, gympass_id, notas) => {
    if (!gympass_id) {
      await clienteGympassDelete(identity, idNoofit)
      setMapa(m => { const c = { ...m }; delete c[String(idNoofit)]; return c })
    } else {
      await clienteGympassUpsert(identity, idNoofit, gympass_id, notas)
      setMapa(m => ({ ...m, [String(idNoofit)]: gympass_id }))
    }
  }, [identity])

  return { mapa, loaded, isGympass, getGympassId, setGympass, reload }
}
