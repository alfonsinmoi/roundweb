/**
 * Hook que carga el estado del Odoo del manager actual (Fase 1 del wizard
 * de despliegue per-manager). Devuelve:
 *
 *   {
 *     status:   { odoo_enabled, odoo_company_id, odoo_activated_at,
 *                 wcommerce_cliente_id, tipo_pago_wc, is_default_manager,
 *                 features: { crm, cuotas, contabilidad } }
 *     features: { crm, cuotas, contabilidad }   ← shortcut
 *     loading:  true mientras se carga la primera vez
 *     refresh:  fuerza un re-fetch ignorando cache
 *   }
 *
 * Cache en sessionStorage con TTL de 5 min para no machacar el backend en
 * cada render. Al cambiar de manager (login impersonando) la cache se
 * invalida automáticamente porque la clave incluye el managerId.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { getRoundIdentity, managerOdooStatus } from '../utils/configApi'

const CACHE_TTL_MS = 5 * 60 * 1000

function cacheKey(managerId) {
  return `round.odoo_status:${managerId || 'none'}`
}

function readCache(managerId) {
  try {
    const raw = sessionStorage.getItem(cacheKey(managerId))
    if (!raw) return null
    const { at, data } = JSON.parse(raw)
    if (Date.now() - at > CACHE_TTL_MS) return null
    return data
  } catch {
    return null
  }
}

function writeCache(managerId, data) {
  try {
    sessionStorage.setItem(cacheKey(managerId),
      JSON.stringify({ at: Date.now(), data }))
  } catch { /* quota / serialización — ignoramos */ }
}

function clearCache(managerId) {
  try { sessionStorage.removeItem(cacheKey(managerId)) } catch { /* no-op */ }
}

export function useOdooStatus() {
  const { user } = useAuth()
  const identity = useMemo(() => getRoundIdentity(user), [user])
  const managerId = identity?.managerId
  const [data, setData] = useState(() => readCache(managerId))
  const [loading, setLoading] = useState(() => !data)
  // `errored`: el último intento falló. Lo usamos para diferenciar
  // "cargando todavía" (mostrar fallback optimista temporalmente) de
  // "el backend respondió pero falló" (mostrar restrictivo).
  const [errored, setErrored] = useState(false)

  useEffect(() => {
    if (!managerId) {
      setData(null); setLoading(false); return
    }
    const cached = readCache(managerId)
    if (cached) { setData(cached); setLoading(false); return }
    let active = true
    setLoading(true); setErrored(false)
    managerOdooStatus(identity)
      .then(d => {
        if (!active) return
        setData(d)
        writeCache(managerId, d)
      })
      .catch(() => { if (active) setErrored(true) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [managerId, identity])

  const refresh = useCallback(() => {
    if (!managerId) return Promise.resolve(null)
    clearCache(managerId)
    setLoading(true); setErrored(false)
    return managerOdooStatus(identity)
      .then(d => { setData(d); writeCache(managerId, d); return d })
      .catch(() => { setErrored(true); return null })
      .finally(() => setLoading(false))
  }, [managerId, identity])

  // Escuchamos el evento "round.odoo-status-changed" que el bootstrap
  // dispara tras un login exitoso: así el banner "no registrado" o las
  // features cambian SIN que el usuario tenga que recargar la página.
  useEffect(() => {
    if (!managerId) return
    const handler = () => { refresh() }
    window.addEventListener('round.odoo-status-changed', handler)
    return () => window.removeEventListener('round.odoo-status-changed', handler)
  }, [managerId, refresh])

  // Política del fallback (qué pasa cuando data == null):
  //   - loading: aún no respondió → optimista (true) — evita que parpadee
  //     el menú quitando tabs y volviendo a ponerlos al terminar de cargar.
  //   - errored: backend respondió error genuino → asumimos features=false
  //     para no exponer Odoo a un manager que NO está autorizado. Es más
  //     restrictivo que antes pero es lo correcto en producción.
  //   - sin loading ni errored (caso raro: sin managerId): mantenemos true
  //     para no romper Round actual.
  const features = data?.features || (
    errored
      ? { crm: false, cuotas: false, contabilidad: false, control_horario: false }
      : { crm: true,  cuotas: true,  contabilidad: true,  control_horario: false }
  )

  return {
    status: data,
    notRegistered: !!data?.no_registrado_en_round,
    features,
    loading,
    refresh,
    isDefaultManager: !!data?.is_default_manager,
    odooEnabled: !!data?.odoo_enabled,
  }
}
