// Hook de gating: useCan('clientes.archivar') → boolean
import { useAuth } from '../contexts/AuthContext'
import { hasPermission, canAccessSection } from '../config/permissions'

export function useCan(path) {
  const { user } = useAuth()
  // Manager NoofitPro (login clásico) tiene control total. El gating real
  // afecta sólo a usuarios web con perfil.
  if (!user) return false
  if (user.kind !== 'usuario_web') return true
  return hasPermission(user.perfil, path)
}

export function useCanAccess(sectionPath) {
  const { user } = useAuth()
  if (!user) return false
  if (user.kind !== 'usuario_web') return true
  return canAccessSection(user.perfil, sectionPath)
}

// Cuando hay que comprobar varios paths a la vez (ej. botones contextuales)
export function useCanAny(paths) {
  const { user } = useAuth()
  if (!user) return false
  if (user.kind !== 'usuario_web') return true
  return paths.some(p => hasPermission(user.perfil, p))
}
