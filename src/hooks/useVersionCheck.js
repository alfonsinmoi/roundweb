// Hook que detecta cuando hay una nueva build desplegada en el servidor y
// avisa al usuario para que recargue.
//
// Funcionamiento:
//   - Al arrancar carga /version.json y guarda `currentBuild`.
//   - Cada `POLL_MS` (60 s por defecto) vuelve a fetchearlo con cache-bust.
//   - Si el `build` recibido difiere del `currentBuild` → set `hasUpdate=true`.
//   - El componente `UpdateAvailableBanner` lo muestra y ofrece recargar.
//
// El polling solo corre cuando el documento es visible (no consume cuota en
// pestañas en background).

import { useEffect, useRef, useState } from 'react'

const VERSION_URL = '/version.json'
const POLL_MS = 60_000   // 1 min — equilibrio entre frescura y carga del CDN

export function useVersionCheck() {
  const [hasUpdate, setHasUpdate] = useState(false)
  const [newBuild, setNewBuild] = useState(null)
  const currentBuildRef = useRef(null)
  const timerRef = useRef(null)

  const fetchVersion = async () => {
    try {
      // cache-bust agresivo: timestamp + headers no-store. Si nginx tiene
      // cache de proxy, este truco la salta. La query no afecta al servidor.
      const r = await fetch(`${VERSION_URL}?_=${Date.now()}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
      })
      if (!r.ok) return null
      const v = await r.json()
      return v?.build || null
    } catch {
      return null
    }
  }

  useEffect(() => {
    let cancelled = false
    // 1) Snapshot inicial al arrancar
    fetchVersion().then(b => {
      if (cancelled || !b) return
      currentBuildRef.current = b
    })
    // 2) Polling periódico
    const tick = async () => {
      if (document.hidden) return   // no consumir cuando la pestaña no se ve
      const b = await fetchVersion()
      if (!b || cancelled) return
      if (currentBuildRef.current && b !== currentBuildRef.current) {
        setNewBuild(b)
        setHasUpdate(true)
      } else if (!currentBuildRef.current) {
        currentBuildRef.current = b
      }
    }
    timerRef.current = setInterval(tick, POLL_MS)
    // 3) Re-check al volver a foco (descubre la nueva versión al instante en
    //    vez de esperar al siguiente tick del intervalo).
    const onFocus = () => tick()
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      cancelled = true
      if (timerRef.current) clearInterval(timerRef.current)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [])

  const reload = () => {
    // Forzar bypass de cache del navegador. `location.reload(true)` está
    // deprecado; el patrón moderno es navegar a la misma URL con un
    // timestamp en la query → el navegador recarga sin reuse del index.html.
    const url = new URL(window.location.href)
    url.searchParams.set('_v', Date.now().toString())
    window.location.replace(url.toString())
  }

  return { hasUpdate, newBuild, currentBuild: currentBuildRef.current, reload }
}
