import { useState, useEffect } from 'react'
import { Settings, ChevronRight } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { Card } from '../../components/UI'
import { getRoundIdentity } from '../../utils/configApi'
import { useOdooStatus } from '../../hooks/useOdooStatus'
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

// `featureFlag`: si está y la feature está a `false` en useOdooStatus, la
// pestaña se oculta. Convención:
//   - 'cuotas': pestañas que sólo tienen sentido con Odoo desplegado (sus
//     catálogos se replican a Odoo: cuotas, descuentos, modificaciones,
//     forma de facturar).
//   - 'contabilidad': pasarelas PayComet (los pagos llegan a Odoo).
//   - ninguno: pestaña independiente de Odoo (categorías, email, perfiles…).
// La pestaña 'contab' (Contabilidad) NO se gatea: es donde el manager
// activa Odoo por primera vez.
const TABS_BASE = [
  { id: 'cuotas',         label: 'Cuotas',         comp: CuotasTab,         featureFlag: 'cuotas' },
  { id: 'descuentos',     label: 'Descuentos',     comp: DescuentosTab,     featureFlag: 'cuotas' },
  { id: 'modificaciones', label: 'Modificaciones', comp: ModificacionesTab, featureFlag: 'cuotas' },
  // Formas de pago y Periodicidad son info estática (sin backend) pero
  // solo tienen sentido si hay sistema de cobros = Odoo desplegado.
  { id: 'formas_pago',    label: 'Formas de pago', comp: FormasPagoInfo,    featureFlag: 'cuotas' },
  { id: 'periodicidad',   label: 'Periodicidad',   comp: PeriodicidadInfo,  featureFlag: 'cuotas' },
]
const TAB_CATEGORIAS = { id: 'categorias', label: 'Categorías clientes',   comp: CategoriasTab,     managerOnly: true }
const TAB_NOTIF      = { id: 'notif',      label: 'Notificaciones',         comp: NotificacionesTab, managerOnly: true }
// "Suscripciones" sustituye al antiguo wizard "Despliegue total" — desde
// aquí el manager activa CRM, Cuotas y Contabilidad por separado.
// SIEMPRE visible para el manager (no featureFlag): es el entry point para
// activar Odoo por primera vez.
const TAB_SUSCRIP   = { id: 'suscrip',    label: 'Suscripciones',           comp: SuscripcionesTab,  managerOnly: true }
// La pestaña antigua "Contabilidad" pasa a gatearse por featureFlag —
// solo aparece si el módulo ya está activo (entonces sirve para la config
// per-trainer, categorías de gasto y visibilidad de listados).
const TAB_CONTAB     = { id: 'contab',     label: 'Contabilidad',           comp: ContabilidadTab,   managerOnly: true, featureFlag: 'contabilidad' }
const TAB_FORMA_FACT = { id: 'forma_fact',  label: 'Forma de facturar',      comp: FormaFacturarTab,  managerOnly: true, featureFlag: 'cuotas' }
const TAB_PASARELAS = { id: 'pasarelas', label: 'Pasarelas (PayComet)', comp: PasarelasTab, managerOnly: true, featureFlag: 'cuotas' }
const TAB_CENTROS   = { id: 'centros',   label: 'Centros',                comp: CentrosTab,   managerOnly: true }
const TAB_EMAIL     = { id: 'email',     label: 'Email (transaccional)',  comp: EmailTab,     managerOnly: true }
const TAB_EMAIL_TPL = { id: 'email_tpl', label: 'Plantillas email',       comp: EmailTemplatesTab, managerOnly: true }
const TAB_META      = { id: 'meta',      label: 'Cuentas Meta',           comp: CuentasMetaTab,    managerOnly: true }
const TAB_PERFILES  = { id: 'perfiles',  label: 'Perfiles',               comp: PerfilesTab,       managerOnly: true }
const TAB_USUARIOS  = { id: 'usuarios',  label: 'Usuarios web',           comp: UsuariosWebTab,    managerOnly: true }

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
    : [TAB_SUSCRIP, ...TABS_BASE, TAB_CATEGORIAS, TAB_NOTIF, TAB_CONTAB, TAB_FORMA_FACT, TAB_CENTROS, TAB_PASARELAS, TAB_EMAIL, TAB_EMAIL_TPL, TAB_META, TAB_PERFILES, TAB_USUARIOS]
  // Filtrar por features: pestañas con featureFlag se ocultan si la
  // feature está false (Odoo no desplegado).
  const TABS = TABS_ALL.filter(t => !t.featureFlag || features?.[t.featureFlag] !== false)

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
