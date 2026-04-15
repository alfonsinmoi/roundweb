/**
 * Shared date/time formatters — single source of truth.
 */

export function formatHora(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return isNaN(d) ? '—' : d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
}

export function formatFecha(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return isNaN(d) ? '—' : d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

export function formatDate(val) {
  if (!val) return '—'
  const d = new Date(val)
  return isNaN(d) ? '—' : d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function formatDateShort(val) {
  if (!val) return '—'
  const d = new Date(val)
  return isNaN(d) ? '—' : d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
}

export function formatDuration(seconds) {
  if (!seconds) return ''
  return `${Math.round(seconds / 60)} min`
}
