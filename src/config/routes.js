import {
  LayoutDashboard, Users, ClipboardCheck, Layers, Database, CalendarDays, Settings, Receipt, UserPlus,
  Instagram, Bell, Calculator, Euro, Clock, ShoppingCart, AlertCircle,
} from 'lucide-react'

// Cada item lleva `perm`: clave del catálogo de permisos para gating.
// Si el perfil del usuario no cubre esa sección, el item se oculta.
// Manager NoofitPro (sin perfil) ve todo siempre.
//
// `featureFlag`: opcional. Mapea a las features del manager devueltas por
// /api/manager/odoo-status. Si el flag está y la feature está a `false`,
// el item se oculta del menú (módulos que requieren Odoo desplegado).
export const navItems = [
  { to: '/dashboard',          icon: LayoutDashboard, label: 'Dashboard',  perm: 'inicio' },
  { to: '/clientes',           icon: Users,           label: 'Clientes',   perm: 'clientes' },
  { id: 'crm', icon: UserPlus, label: 'CRM', perm: 'crm', featureFlag: 'crm',
    children: [
      { to: '/crm',            label: 'Leads',             perm: 'crm.leads' },
      // Renombrado mayo 2026: "Clientes actuales" → "Comunicaciones" porque
      // el apartado realmente envía notificaciones, no es un listado de clientes.
      { to: '/notificaciones', label: 'Comunicaciones',    perm: 'crm.clientes_actuales' },
      // Renombrado mayo 2026: "Agenda Social" → "Calendario RRSS" para que
      // sea evidente que es planificación de redes sociales (Instagram + FB).
      { to: '/agenda-social',  label: 'Calendario RRSS',   perm: 'crm.agenda_social' },
      { to: '/notas',          label: 'Notas',             perm: 'crm.notas' },
    ],
  },
  { to: '/clases',             icon: CalendarDays,    label: 'Clases',     perm: 'clases' },
  { id: 'economico', icon: Euro, label: 'Económico', perm: 'economico',
    children: [
      { to: '/cuotas-clientes', label: 'Cuotas mensuales', perm: 'economico.cuotas_mensuales', featureFlag: 'cuotas' },
      { to: '/entradas-puntuales', label: 'Entradas puntuales', perm: 'economico.cuotas_mensuales', featureFlag: 'cuotas' },
      { to: '/contabilidad',    label: 'Contabilidad',     perm: 'economico.contabilidad',     featureFlag: 'contabilidad' },
    ],
  },
  // TPV (Terminal de caja) — pantalla operativa de ventas. Catálogo en
  // Configuración → Terminal de Caja; aquí se vende.
  // Cada hijo está protegido por un permiso fino (Fase 10) — /tpv aún
  // muestra el grid de productos para "Cobrar"; /tpv/dashboard solo
  // visible si tienes permiso de dashboard.
  { id: 'tpv', icon: ShoppingCart, label: 'TPV', perm: 'tpv',
    children: [
      { to: '/tpv',              label: 'Vender',       perm: 'tpv.ventas.cobrar' },
      { to: '/tpv/proveedores',  label: 'Proveedores',  perm: 'tpv.proveedores.ver' },
      { to: '/tpv/dashboard',    label: 'Dashboard',    perm: 'tpv.dashboard.ver' },
    ],
  },
  { id: 'informes', icon: ClipboardCheck, label: 'Informes', perm: 'informe_asistencia',
    children: [
      { to: '/informe-asistencia', label: 'Asistencia', perm: 'informe_asistencia' },
      { to: '/informe-clientes',   label: 'Clientes',   perm: 'informe_asistencia' },
      { to: '/informe-integridad', label: 'Integridad', perm: 'informe_asistencia' },
    ],
  },
  { to: '/control-horario',    icon: Clock,           label: 'Control horario',
    featureFlag: 'control_horario' },
  // Bandeja de incidencias del sistema. `badgeKey` hace que el Sidebar
  // pinte el nº de pendientes (consultado vía incidenciasCount cada 60s).
  { to: '/incidencias',        icon: AlertCircle,     label: 'Incidencias',
    perm: 'incidencias', badgeKey: 'incidencias' },
  { to: '/configuracion',      icon: Settings,        label: 'Configuración',      perm: 'configuracion' },
]

// Items solo visibles cuando NO se está impersonando (solo para el gestor).
// `featureFlag: 'contabilidad'` oculta "Config. ERP" si el manager NO tiene
// Odoo desplegado (no tiene ERP que configurar todavía).
export const managerItems = [
  { to: '/erp-configuracion', icon: Database, label: 'Config. ERP',
    featureFlag: 'contabilidad', perm: 'erp_configuracion' },
]

export const configItems = []
