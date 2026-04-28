import { useState, useEffect } from 'react'
import { getSalasByRange } from '../utils/api'

// Ventana activa: desde 1 minuto antes del inicio hasta el fin (start + duración)
function isClaseActivaMinuto(sala, now) {
  if (!sala?.dateStart) return false
  const start = new Date(sala.dateStart).getTime()
  if (isNaN(start)) return false
  const duration = (sala.durationTraining || 3600) * 1000
  return now >= start - 60 * 1000 && now <= start + duration
}

/**
 * Devuelve la clase que está actualmente en curso (1 minuto antes de empezar → fin).
 * Recarga las salas de hoy cada 5 minutos y actualiza el reloj cada 30 s.
 * @returns {Object|null} sala en curso o null si no hay ninguna
 */
export function useClaseEnCurso() {
  const [salas, setSalas] = useState([])
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    let cancelled = false
    const load = () => {
      const desde = new Date(); desde.setHours(0, 0, 0, 0)
      const hasta = new Date(desde); hasta.setDate(hasta.getDate() + 1)
      getSalasByRange(desde, hasta)
        .then(s => { if (!cancelled) setSalas(s ?? []) })
        .catch(() => {})
    }
    load()
    const reloadTs = setInterval(load, 5 * 60 * 1000)
    return () => { cancelled = true; clearInterval(reloadTs) }
  }, [])

  useEffect(() => {
    // Tick cada 30 s — suficiente para captar el cambio con precisión de segundos
    const t = setInterval(() => setNow(Date.now()), 30 * 1000)
    return () => clearInterval(t)
  }, [])

  return salas.find(s => isClaseActivaMinuto(s, now)) ?? null
}
