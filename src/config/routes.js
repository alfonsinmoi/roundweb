import {
  LayoutDashboard, Users, ClipboardCheck, Layers, Database,
} from 'lucide-react'

export const navItems = [
  { to: '/dashboard',          icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/clientes',           icon: Users,           label: 'Clientes' },
  { to: '/informe-asistencia', icon: ClipboardCheck,  label: 'Informe Asistencia' },
  { to: '/analisis-clusters',  icon: Layers,          label: 'Análisis patrones' },
]

// Items solo visibles cuando NO se está impersonando (solo para el gestor)
export const managerItems = [
  { to: '/erp-configuracion', icon: Database, label: 'Config. ERP' },
]

export const configItems = []
