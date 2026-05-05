// Prefetch de chunks lazy + datos para acelerar la navegación.
// La idea: cuando el usuario está viendo una página, en background
// vamos calentando el chunk JS y los datos de las rutas más visitadas,
// para que el siguiente click sea instantáneo.

import {
  getClientes, getEntrenadores, getActividades, getEjercicios,
} from './api'

// Cada entrada: factory que devuelve el import() del componente
// (esto descarga y parsea el chunk JS) + factory que precarga los datos.
const REGISTRY = {
  '/clientes': {
    chunk: () => import('../pages/Clients/ClientList'),
    data:  () => getClientes(),
  },
  '/dashboard': {
    chunk: () => import('../pages/Dashboard'),
    // El dashboard usa varios datos; precargamos los más comunes.
    data:  () => Promise.all([getClientes().catch(() => null)]),
  },
  '/crm': {
    chunk: () => import('../pages/CRM/CrmPage'),
    data:  () => null, // CRM se autoabastece (leadsList) — no exportado aquí
  },
  '/clases': {
    chunk: () => import('../pages/Clases'),
    data:  () => null,
  },
  '/cuotas-clientes': {
    chunk: () => import('../pages/CuotasClientes/CuotasClientes'),
    data:  () => null,
  },
  '/actividades': {
    chunk: () => import('../pages/Actividades'),
    data:  () => getActividades().catch(() => null),
  },
  '/monitores': {
    chunk: () => import('../pages/Monitores'),
    data:  () => getEntrenadores().catch(() => null),
  },
  '/ejercicios': {
    chunk: () => import('../pages/Ejercicios'),
    data:  () => getEjercicios().catch(() => null),
  },
}

// Marcador para no repetir prefetch del mismo path en la misma pestaña
const _done = new Set()

/** Calienta chunk + datos de una ruta concreta. Idempotente. */
export function prefetchRoute(path) {
  if (!path || _done.has(path)) return
  const entry = REGISTRY[path]
  if (!entry) return
  _done.add(path)
  // chunk: ignoramos errores (ya se reintentará al navegar)
  try { entry.chunk()?.catch?.(() => {}) } catch {}
  // datos: dispara la promesa pero no bloquea
  try { entry.data()?.catch?.(() => {}) } catch {}
}

/** Prefetch de las rutas más visitadas, ejecutado en idle. */
export function prefetchPopularRoutes() {
  const popular = ['/clientes', '/crm', '/clases', '/cuotas-clientes']
  const run = () => popular.forEach(prefetchRoute)
  // Si el navegador soporta requestIdleCallback, lo usamos; si no, setTimeout.
  if (typeof window === 'undefined') return
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(run, { timeout: 2000 })
  } else {
    setTimeout(run, 300)
  }
}

/** Reset (útil tras logout). */
export function resetPrefetchState() {
  _done.clear()
}
