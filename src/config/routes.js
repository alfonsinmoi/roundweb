import {
  LayoutDashboard, Users, ClipboardCheck, Layers, Database, CalendarDays, Settings, Receipt, UserPlus,
  Instagram,
} from 'lucide-react'

export const navItems = [
  { to: '/dashboard',          icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/clientes',           icon: Users,           label: 'Clientes' },
  { to: '/crm',                icon: UserPlus,        label: 'CRM · Leads' },
  { to: '/agenda-social',      icon: Instagram,       label: 'Agenda Social' },
  { to: '/clases',             icon: CalendarDays,    label: 'Clases' },
  { to: '/cuotas-clientes',    icon: Receipt,         label: 'Cuotas clientes' },
  { to: '/informe-asistencia', icon: ClipboardCheck,  label: 'Informe Asistencia' },
  { to: '/analisis-clusters',  icon: Layers,          label: 'Análisis patrones' },
  { to: '/configuracion',      icon: Settings,        label: 'Configuración' },
]

// Items solo visibles cuando NO se está impersonando (solo para el gestor)
export const managerItems = [
  { to: '/erp-configuracion', icon: Database, label: 'Config. ERP' },
]

export const configItems = []
