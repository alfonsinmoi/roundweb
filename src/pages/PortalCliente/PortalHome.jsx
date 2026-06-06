import { Navigate } from 'react-router-dom'
import { usePortalAuth } from '../../contexts/PortalAuthContext'


// Página /portal sin tab específica. Redirige a la tab por defecto:
//   - "Fichar" si es trabajador (requisito explícito)
//   - "Perfil"  en cualquier otro caso
export default function PortalHome() {
  const { cliente } = usePortalAuth()
  const dest = cliente?.es_trabajador ? '/portal/fichar' : '/portal/perfil'
  return <Navigate to={dest} replace />
}
