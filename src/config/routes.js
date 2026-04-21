import {
  LayoutDashboard, Users, CalendarDays, UserCheck,
  Dumbbell, Zap, Cpu, BarChart3, ClipboardCheck,
  Activity, Settings, CalendarCog,
} from 'lucide-react'

export const navItems = [
  { to: '/dashboard',          icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/clientes',           icon: Users,           label: 'Clientes' },
  { to: '/clases',             icon: CalendarDays,    label: 'Clases' },
  { to: '/listados',           icon: BarChart3,       label: 'Listados' },
  { to: '/informe-asistencia', icon: ClipboardCheck,  label: 'Informe Asistencia' },
]

export const configItems = [
  { to: '/clases-modificacion', icon: CalendarCog, label: 'Clases Modificación' },
  { to: '/actividades',    icon: Activity,  label: 'Actividades' },
  { to: '/monitores',      icon: UserCheck, label: 'Monitores' },
  { to: '/entrenamientos', icon: Dumbbell,  label: 'Entrenamientos' },
  { to: '/ejercicios',     icon: Zap,       label: 'Ejercicios' },
  { to: '/dispositivos',   icon: Cpu,       label: 'Dispositivos' },
]

export { Settings as ConfigIcon }
