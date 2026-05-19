import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { getClientes } from '../utils/api'
import { useCategoriasMap } from './useCategoriasMap'
import {
  getRoundIdentity, clientesAtendidosList,
  clientesAtendidosMark, clientesAtendidosReset,
} from '../utils/configApi'

/**
 * Detecta clientes "nuevos" (recién dados de alta en NoofitPro) que aún no
 * han sido procesados por el trainer.
 *
 * Estrategia (mayo 2026, persistente desde noviembre 2026):
 *   Un cliente está "pendiente de procesar" cuando NO tiene categoría
 *   asignada en BD. La asignación de categoría es la señal canónica de que
 *   el trainer ya lo ha atendido.
 *
 *   Cuando el trainer pulsa "✕" en el banner para descartar sin asignar
 *   categoría, lo persistimos en BD (`cliente_atendido_banner`) para que el
 *   dismiss valga entre navegadores y dispositivos. Mantenemos también el
 *   set local como fallback síncrono (UI optimista) hasta que sincronice.
 *
 * Polling cada 30s.
 */
const STORAGE_KEY = 'round.clientes_seen'
const POLL_MS = 30_000   // 30 s

function loadSeen() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? new Set(JSON.parse(raw)) : new Set()
  } catch {
    return new Set()
  }
}
function saveSeen(set) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...set])) } catch {}
}


export function useNuevosClientes() {
  const { user } = useAuth()
  const identity = useMemo(() => getRoundIdentity(user), [user])
  const { mapa, loaded: catLoaded } = useCategoriasMap()
  const [nuevos, setNuevos] = useState([])
  const seenRef = useRef(loadSeen())     // dismiss local (UI optimista)
  const seenBackendRef = useRef(new Set()) // dismiss persistente (BD)
  const intervalRef = useRef(null)

  const reload = useCallback(async () => {
    if (!catLoaded) return
    try {
      // 1) Refrescar atendidos del backend (en paralelo con la lista NF).
      const [all, backendIds] = await Promise.all([
        getClientes(),
        clientesAtendidosList(identity).catch(() => []),
      ])
      seenBackendRef.current = new Set(
        (backendIds || []).map(x => String(x))
      )
      const activos = all.filter(c => c.enabled !== false)
      const pendientes = activos.filter(c => {
        const id = String(c.id)
        const tieneCategoria = !!mapa[id]
        if (tieneCategoria) return false
        if (seenRef.current.has(c.id)) return false
        if (seenBackendRef.current.has(id)) return false
        return true
      })
      setNuevos(pendientes)
    } catch (e) {
      console.warn('useNuevosClientes:', e?.message)
    }
  }, [catLoaded, mapa, identity])

  // Carga inicial + polling
  useEffect(() => {
    if (!user) return
    reload()
    intervalRef.current = setInterval(reload, POLL_MS)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [user, reload])

  // Marca UN cliente como atendido en backend + localStorage (UI optimista).
  const markSeen = useCallback(async (id) => {
    const sid = String(id)
    seenRef.current.add(id); saveSeen(seenRef.current)
    seenBackendRef.current.add(sid)
    setNuevos(prev => prev.filter(c => c.id !== id))
    try { await clientesAtendidosMark(identity, sid) } catch (e) {
      console.warn('markSeen backend falló (queda local):', e?.message)
    }
  }, [identity])

  // Marca TODOS los pendientes como atendidos. Si se le pasa el flag
  // `reset=true`, además limpia la tabla entera del manager (útil para
  // "empezar desde 0" — quita atendidos antiguos también).
  const markAllSeen = useCallback(async ({ reset = false } = {}) => {
    const ids = nuevos.map(c => String(c.id))
    // UI optimista
    nuevos.forEach(c => seenRef.current.add(c.id))
    saveSeen(seenRef.current)
    ids.forEach(i => seenBackendRef.current.add(i))
    setNuevos([])
    try {
      if (ids.length > 0) await clientesAtendidosMark(identity, ids)
      if (reset) await clientesAtendidosReset(identity)
    } catch (e) {
      console.warn('markAllSeen backend falló:', e?.message)
    }
  }, [nuevos, identity])

  return { nuevos, reload, markSeen, markAllSeen }
}
