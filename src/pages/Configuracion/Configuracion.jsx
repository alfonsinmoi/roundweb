import { useState, useEffect } from 'react'
import { Settings, ChevronRight } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { Card } from '../../components/UI'
import { getRoundIdentity } from '../../utils/configApi'
import { useOdooStatus } from '../../hooks/useOdooStatus'
import { canAccessSection } from '../../config/permissions'
import CuotasTab        from './CuotasTab'
import DescuentosTab    from './DescuentosTab'
import ModificacionesTab from './ModificacionesTab'
import FormasPagoInfo   from './FormasPagoInfo'
import PeriodicidadInfo from './PeriodicidadInfo'
import PasarelasTab     from './PasarelasTab'
import CentrosTab       from './CentrosTab'
import EmailTab         from './EmailTab'
import EmailTemplatesTab from './EmailTemplatesTab'
import CuentasMetaTab    from './CuentasMetaTab'
import CategoriasTab     from './CategoriasTab'
import NotificacionesTab  from './NotificacionesTab'
import ContabilidadTab    from './ContabilidadTab'
import FormaFacturarTab   from './FormaFacturarTab'
import PerfilesTab        from './PerfilesTab'
import UsuariosWebTab     from './UsuariosWebTab'
import SuscripcionesTab   from './SuscripcionesTab'
import CanalesCaptacionTab from './CanalesCaptacionTab'
import FormulariosTab       from './FormulariosTab'
import ChecklistTab        from './ChecklistTab'
import AltaClienteTab      from './AltaClienteTab'
import TerminalCajaTab     from './TerminalCajaTab'

// `featureFlag`: si está y la feature está a `false` en useOdooStatus, la
// pestaña se oculta. Convención:
//   - 'cuotas': pestañas que sólo tienen sentido con Odoo desplegado (sus
//     catálogos se replican a Odoo: cuotas, descuentos, modificaciones,
//     forma de facturar).
//   - 'contabilidad': pasarelas PayComet (los pagos llegan a Odoo).
//   - ninguno: pestaña independiente de Odoo (categorías, email, perfiles…).
// La pestaña 'contab' (Contabilidad) NO se gatea: es donde el manager
// activa Odoo por primera vez.
// Cada tab lleva `perm`: clave de PERMISSIONS bajo `configuracion.*`.
// Si el perfil del usuario no tiene NINGUNA acción permitida bajo ese
// subárbol, la pestaña se oculta. Manager NoofitPro (sin perfil) ve todo.
const TABS_BASE = [
  { id: 'cuotas',         label: 'Cuotas',         comp: CuotasTab,         featureFlag: 'cuotas', perm: 'configuracion.cuotas' },
  { id: 'descuentos',     label: 'Descuentos',     comp: DescuentosTab,     featureFlag: 'cuotas', perm: 'configuracion.descuentos' },
  { id: 'modificaciones', label: 'Modificaciones', comp: ModificacionesTab, featureFlag: 'cuotas', perm: 'configuracion.modificaciones' },
  // Formas de pago y Periodicidad son info estática (sin backend) pero
  // solo tienen sentido si hay sistema de cobros = Odoo desplegado.
  // Comparten perm con cuotas (basta tener acceso a cuotas para ver la info).
  { id: 'formas_pago',    label: 'Formas de pago', comp: FormasPagoInfo,    featureFlag: 'cuotas', perm: 'configuracion.cuotas' },
  { id: 'periodicidad',   label: 'Periodicidad',   comp: PeriodicidadInfo,  featureFlag: 'cuotas', perm: 'configuracion.cuotas' },
]
const TAB_CATEGORIAS = { id: 'categorias', label: 'Categorías clientes',   comp: CategoriasTab,     managerOnly: true, perm: 'configuracion.categorias_cliente' }
const TAB_NOTIF      = { id: 'notif',      label: 'Notificaciones',         comp: NotificacionesTab, managerOnly: true, perm: 'configuracion.notificaciones' }
const TAB_SUSCRIP   = { id: 'suscrip',    label: 'Suscripciones',           comp: SuscripcionesTab,  managerOnly: true, perm: 'configuracion.suscripciones' }
const TAB_CONTAB     = { id: 'contab',     label: 'Contabilidad',           comp: ContabilidadTab,   managerOnly: true, featureFlag: 'contabilidad', perm: 'configuracion.contabilidad_tab' }
const TAB_FORMA_FACT = { id: 'forma_fact',  label: 'Forma de facturar',      comp: FormaFacturarTab,  managerOnly: true, featureFlag: 'cuotas', perm: 'configuracion.modo_facturacion' }
const TAB_PASARELAS = { id: 'pasarelas', label: 'Pasarelas (PayComet)', comp: PasarelasTab, managerOnly: true, featureFlag: 'cuotas', perm: 'configuracion.pasarelas' }
const TAB_CENTROS   = { id: 'centros',   label: 'Centros',                comp: CentrosTab,   managerOnly: true, perm: 'configuracion.centros_trainers' }
const TAB_ALTA_CLI  = { id: 'alta_cliente', label: 'Alta de cliente',     comp: AltaClienteTab, managerOnly: true, perm: 'configuracion.centros_trainers' }
const TAB_EMAIL     = { id: 'email',     label: 'Email (transaccional)',  comp: EmailTab,     managerOnly: true, perm: 'configuracion.email' }
const TAB_EMAIL_TPL = { id: 'email_tpl', label: 'Plantillas email',       comp: EmailTemplatesTab, managerOnly: true, perm: 'configuracion.email_templates' }
const TAB_META      = { id: 'meta',      label: 'Cuentas Meta',           comp: CuentasMetaTab,    managerOnly: true, perm: 'configuracion.meta' }
const TAB_PERFILES  = { id: 'perfiles',  label: 'Perfiles',               comp: PerfilesTab,       managerOnly: true, perm: 'configuracion.perfiles' }
const TAB_USUARIOS  = { id: 'usuarios',  label: 'Usuarios web',           comp: UsuariosWebTab,    managerOnly: true, perm: 'configuracion.usuarios_web' }
const TAB_CANALES   = { id: 'canales',   label: 'Canales captación',      comp: CanalesCaptacionTab, managerOnly: true, perm: 'configuracion.canales_captacion' }
const TAB_FORMULARIOS = { id: 'formularios', label: 'Formularios',          comp: FormulariosTab,      managerOnly: true, featureFlag: 'crm', perm: 'configuracion.formularios' }
const TAB_POS       = { id: 'pos',       label: 'Terminal de Caja',       comp: TerminalCajaTab,     managerOnly: true, perm: 'configuracion.pos' }
// Checklist por módulo. Solo visible si el módulo está activo (featureFlag).
const TAB_CHECK_CRM    = { id: 'check_crm',    label: 'Checklist CRM',          comp: (p) => <ChecklistTab {...p} modulo="crm" />,          managerOnly: true, featureFlag: 'crm',          perm: 'configuracion.checklist' }
const TAB_CHECK_CUOTAS = { id: 'check_cuotas', label: 'Checklist Cuotas',       comp: (p) => <ChecklistTab {...p} modulo="cuotas" />,       managerOnly: true, featureFlag: 'cuotas',       perm: 'configuracion.checklist' }
const TAB_CHECK_CONTAB = { id: 'check_contab', label: 'Checklist Contabilidad', comp: (p) => <ChecklistTab {...p} modulo="contabilidad" />, managerOnly: true, featureFlag: 'contabilidad', perm: 'configuracion.checklist' }

// Lee la pestaña inicial desde ?tab=<id> o #<id> (deep-link).
// Si llega vacío o no existe, devuelve null y el componente decide default.
function _readTabFromLocation() {
  try {
    const u = new URL(window.location.href)
    const fromQuery = (u.searchParams.get('tab') || '').trim()
    if (fromQuery) return fromQuery
    const fromHash  = (u.hash || '').replace(/^#/, '').trim()
    if (fromHash)  return fromHash
  } catch { /* SSR / no-window: ignore */ }
  return null
}

export default function Configuracion() {
  const { user, isImpersonating } = useAuth()
  // Default: Suscripciones para el manager (entry point); Cuotas para trainer impersonado.
  // Si la URL trae ?tab=<id> o #<id>, gana eso. Si la pestaña no existe (filtrada
  // por feature flag o nombre inválido) el useEffect cae a la primera visible.
  const _initial = _readTabFromLocation() || (isImpersonating ? 'cuotas' : 'suscrip')
  const [activeTab, setActiveTab] = useState(_initial)
  const identity = getRoundIdentity(user)
  const { features } = useOdooStatus()
  // Tabs solo visibles para el manager (no impersonando trainer).
  // Suscripciones va PRIMERO (entry point principal — desde aquí se activa
  // Odoo por primera vez), seguido de los catálogos (Cuotas/Descuentos/etc.).
  const TABS_ALL = isImpersonating
    ? TABS_BASE
    : [TAB_SUSCRIP, TAB_CHECK_CRM, TAB_CHECK_CUOTAS, TAB_CHECK_CONTAB, ...TABS_BASE, TAB_CATEGORIAS, TAB_NOTIF, TAB_CONTAB, TAB_FORMA_FACT, TAB_CENTROS, TAB_ALTA_CLI, TAB_PASARELAS, TAB_POS, TAB_CANALES, TAB_FORMULARIOS, TAB_EMAIL, TAB_EMAIL_TPL, TAB_META, TAB_PERFILES, TAB_USUARIOS]
  // Filtrar por features: pestañas con featureFlag se ocultan si la
  // feature está false (Odoo no desplegado).
  // Filtrar también por `perm`: si el usuario es usuario_web y su perfil no
  // tiene ningún permiso bajo el subárbol del tab, la pestaña se oculta.
  // Manager NoofitPro (user.kind != 'usuario_web') pasa todos los filtros.
  const isUsuarioWeb = user?.kind === 'usuario_web'
  const TABS = TABS_ALL
    .filter(t => !t.featureFlag || features?.[t.featureFlag] !== false)
    .filter(t => !isUsuarioWeb || !t.perm || canAccessSection(user.perfil, t.perm))

  // Si la tab activa quedó fuera del filtro (manager sin Odoo, activeTab
  // por defecto 'cuotas' que requiere Odoo), saltar a la primera visible.
  useEffect(() => {
    if (!TABS.find(t => t.id === activeTab)) {
      const first = TABS[0]
      if (first) setActiveTab(first.id)
    }
  }, [TABS, activeTab])

  // Sync activeTab → URL hash (sin polución de history). Permite copiar/pegar
  // el link y volver a la misma pestaña, y que el botón "atrás" funcione.
  useEffect(() => {
    try {
      const u = new URL(window.location.href)
      if (u.hash.replace(/^#/, '') !== activeTab) {
        u.hash = activeTab
        window.history.replaceState({}, '', u.toString())
      }
    } catch { /* ignore */ }
  }, [activeTab])

  // Si el usuario navega entre URLs (back/forward) reaccionamos al cambio.
  useEffect(() => {
    function onPop() {
      const next = _readTabFromLocation()
      if (next && TABS.find(t => t.id === next) && next !== activeTab) {
        setActiveTab(next)
      }
    }
    window.addEventListener('popstate', onPop)
    window.addEventListener('hashchange', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('hashchange', onPop)
    }
  }, [TABS, activeTab])

  const ActiveComp = TABS.find(t => t.id === activeTab)?.comp ?? TABS[0]?.comp ?? CuotasTab

  return (
    <div style={{ maxWidth: 1100, padding: '0 4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <Settings size={22} style={{ color: 'var(--green)' }} aria-hidden="true" />
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, color: 'var(--text-0)', margin: 0 }}>
          Configuración
        </h1>
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 20 }}>
        {isImpersonating
          ? <>Editando configuración del trainer <strong style={{ color: 'var(--text-1)' }}>{user.email}</strong>. Lo que cambies aquí queda asignado a este trainer.</>
          : <>Editando <strong style={{ color: 'var(--text-1)' }}>plantillas de manager</strong>. Cada trainer puede adoptarlas o crear las suyas.</>
        }
        {' '}<span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>v1.1</span>
      </p>

      {/* Sub-tabs */}
      <div role="tablist" style={{
        display: 'flex', borderBottom: '1px solid var(--line)', marginBottom: 18,
        overflowX: 'auto',
      }}>
        {TABS.map(t => {
          const isActive = activeTab === t.id
          return (
            <button key={t.id}
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setActiveTab(t.id)}
                    style={{
                      position: 'relative',
                      padding: '12px 18px',
                      background: 'none', border: 'none', cursor: 'pointer',
                      fontFamily: 'var(--font-display)',
                      fontSize: 14,
                      fontWeight: isActive ? 700 : 500,
                      color: isActive ? 'var(--text-0)' : 'var(--text-2)',
                      flexShrink: 0,
                    }}>
              {t.label}
              {isActive && <span aria-hidden="true" style={{
                position: 'absolute', bottom: -1, left: 12, right: 12, height: 2,
                background: 'var(--green)', borderRadius: 999,
              }} />}
            </button>
          )
        })}
      </div>

      {/* Banner identidad */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 12px', borderRadius: 'var(--radius-sm)',
        background: 'var(--bg-2)', border: '1px solid var(--line)',
        fontSize: 12, color: 'var(--text-3)',
        marginBottom: 16, fontFamily: 'var(--font-mono)',
      }}>
        <span>manager: <strong style={{ color: 'var(--text-1)' }}>{identity.managerId || '—'}</strong></span>
        <ChevronRight size={11} style={{ color: 'var(--text-3)' }} />
        <span>trainer: <strong style={{ color: 'var(--text-1)' }}>{identity.trainerId || '(global plantillas)'}</strong></span>
      </div>

      <ActiveComp identity={identity} />
    </div>
  )
}
