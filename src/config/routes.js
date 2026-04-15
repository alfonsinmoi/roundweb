import {
  LayoutDashboard, Users, CalendarDays, Activity, UserCheck,
  Dumbbell, Zap, Cpu, BarChart3, ClipboardCheck
} from 'lucide-react'

/**
 * Single source of truth for navigation items.
 * Used by Sidebar and Header to avoid drift.
 */
export const navItems = [
  { to: '/dashboard',           icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/clientes',            icon: Users,            label: 'Clientes' },
  { to: '/clases',              icon: CalendarDays,     label: 'Clases' },
  { to: '/actividades',         icon: Activity,         label: 'Actividades' },
  { to: '/monitores',           icon: UserCheck,        label: 'Monitores' },
  { to: '/entrenamientos',      icon: Dumbbell,         label: 'Entrenamientos' },
  { to: '/ejercicios',          icon: Zap,              label: 'Ejercicios' },
  { to: '/dispositivos',        icon: Cpu,              label: 'Dispositivos' },
  { to: '/listados',            icon: BarChart3,        label: 'Listados' },
  { to: '/informe-asistencia',  icon: ClipboardCheck,   label: 'Informe Asistencia' },
]
