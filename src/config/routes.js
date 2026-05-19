import {
  LayoutDashboard, Users, ClipboardCheck, Layers, Database, CalendarDays, Settings, Receipt, UserPlus,
  Instagram, Bell, Calculator, Euro,
} from 'lucide-react'

// Cada item lleva `perm`: clave del catálogo de permisos para gating.
// Si el perfil del usuario no cubre esa sección, el item se oculta.
// Manager NoofitPro (sin perfil) ve todo siempre.
export const navItems = [
  { to: '/dashboard',          icon: LayoutDashboard, label: 'Dashboard',  perm: 'inicio' },
  { to: '/clientes',           icon: Users,           label: 'Clientes',   perm: 'clientes' },
  { id: 'crm', icon: UserPlus, label: 'CRM', perm: 'crm',
    children: [
      { to: '/crm',            label: 'Leads',             perm: 'crm.leads' },
      { to: '/notificaciones', label: 'Clientes actuales', perm: 'crm.clientes_actuales' },
      { to: '/agenda-social',  label: 'Agenda Social',     perm: 'crm.agenda_social' },
      { to: '/notas',          label: 'Notas',             perm: 'crm.notas' },
    ],
  },
  { to: '/clases',             icon: CalendarDays,    label: 'Clases',     perm: 'clases' },
  { id: 'economico', icon: Euro, label: 'Económico', perm: 'economico',
    children: [
      { to: '/cuotas-clientes', label: 'Cuotas mensuales', perm: 'economico.cuotas_mensuales' },
      { to: '/contabilidad',    label: 'Contabilidad',     perm: 'economico.contabilidad' },
    ],
  },
  { to: '/informe-asistencia', icon: ClipboardCheck,  label: 'Informe Asistencia', perm: 'informe_asistencia' },
  { to: '/configuracion',      icon: Settings,        label: 'Configuración',      perm: 'configuracion' },
]

// Items solo visibles cuando NO se está impersonando (solo para el gestor)
export const managerItems = [
  { to: '/erp-configuracion', icon: Database, label: 'Config. ERP' },
]

export const configItems = []
