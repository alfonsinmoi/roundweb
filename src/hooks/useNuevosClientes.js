import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { getClientes } from '../utils/api'

/**
 * Detecta clientes "nuevos" (recién dados de alta en NoofitPro) que aún no
 * han sido procesados por el trainer.
 *
 * Estrategia: comparamos la lista actual de getClientes() contra un set de
 * IDs "seen" en localStorage. Los IDs activos que NO estén en seen son
 * "nuevos". Cuando el trainer marca uno como atendido (markSeen) se añade
 * al set y desaparece del banner.
 *
 * Polling cada N segundos. Primera ejecución INICIALIZA el set seen con
 * todos los clientes existentes (para no inundar al trainer en el primer
 * arranque tras el deploy).
 */
const STORAGE_KEY = 'round.clientes_seen'
const FIRSTRUN_KEY = 'round.clientes_seen_firstrun'
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
  const [nuevos, setNuevos] = useState([])
  const seenRef = useRef(loadSeen())
  const intervalRef = useRef(null)

  const reload = useCallback(async () => {
    try {
      const all = await getClientes()
      const activos = all.filter(c => c.enabled !== false)
      // First-run: si no hay marca de "ya pasamos por aquí", marcamos TODO
      // como visto. Así el banner solo se dispara con altas reales posteriores.
      if (!localStorage.getItem(FIRSTRUN_KEY)) {
        const allIds = activos.map(c => c.id)
        seenRef.current = new Set(allIds)
        saveSeen(seenRef.current)
        localStorage.setItem(FIRSTRUN_KEY, '1')
        setNuevos([])
        return
      }
      const pendientes = activos.filter(c => !seenRef.current.has(c.id))
      setNuevos(pendientes)
    } catch (e) {
      console.warn('useNuevosClientes:', e?.message)
    }
  }, [])

  // Carga inicial + polling
  useEffect(() => {
    if (!user) return
    reload()
    intervalRef.current = setInterval(reload, POLL_MS)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [user, reload])

  const markSeen = useCallback((id) => {
    seenRef.current.add(id)
    saveSeen(seenRef.current)
    setNuevos(prev => prev.filter(c => c.id !== id))
  }, [])

  const markAllSeen = useCallback(() => {
    nuevos.forEach(c => seenRef.current.add(c.id))
    saveSeen(seenRef.current)
    setNuevos([])
  }, [nuevos])

  return { nuevos, reload, markSeen, markAllSeen }
}
