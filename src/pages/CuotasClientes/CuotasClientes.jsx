import { useState, useEffect, useMemo } from 'react'
import { Receipt, ChevronRight } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { getRoundIdentity } from '../../utils/configApi'
import IvaNota from '../../components/IvaNota'
import GenerarTab from './GenerarTab'
import GenerarRecibosTab from './GenerarRecibosTab'
import FacturacionTrimestreTab from './FacturacionTrimestreTab'
import ListadoTab from './ListadoTab'
import DevolucionesTab from './DevolucionesTab'
import EvolucionTab from './EvolucionTab'
import FacturacionTab from './FacturacionTab'
import PagadoresTab from './PagadoresTab'

const TOKEN = import.meta.env.VITE_CONFIG_API_TOKEN || ''

// Pestañas declaradas con qué modos las habilitan.
// modes: array de modos en los que la pestaña se muestra. Si la lista incluye
// '*' la pestaña se muestra siempre.
// Orden (mayo 2026): primero lectura/análisis (Listado → Devoluciones →
// Evolución), después acciones operativas (Generar recibos del mes →
// Facturación). El Listado es la primera por ser la vista por defecto.
const ALL_TABS = [
  { id: 'listado',         label: 'Listado',                 comp: ListadoTab,           modes: ['*'] },
  { id: 'devoluciones',    label: 'Devoluciones',            comp: DevolucionesTab,      modes: ['*'] },
  { id: 'pagadores',       label: 'Pagadores',               comp: PagadoresTab,         modes: ['*'] },
  { id: 'evolucion',       label: 'Evolución',               comp: EvolucionTab,         modes: ['*'] },
  { id: 'facturacion',     label: 'Facturación',             comp: FacturacionTab,       modes: ['*'] },
  { id: 'generar_recibos', label: 'Generar recibos del mes', comp: GenerarRecibosTab,
    modes: ['recibo_trimestre', 'factura_draft'] },
  { id: 'generar',         label: 'Remesa mensual',          comp: GenerarTab,
    modes: ['factura_directa'] },
  { id: 'facturacion_trim',label: 'Facturación trimestral',  comp: FacturacionTrimestreTab,
    modes: ['recibo_trimestre', 'factura_draft'] },
]

export default function CuotasClientes() {
  const { user, isImpersonating } = useAuth()
  const identity = useMemo(() => getRoundIdentity(user), [user])

  // Modo de facturación del manager (guardado en Configuración → Forma de facturar)
  const [modoFact, setModoFact] = useState(null)
  const [modoLoaded, setModoLoaded] = useState(false)

  useEffect(() => {
    if (!identity?.managerId) return
    fetch('/api/config/modo-facturacion', {
      headers: {
        'X-Round-Token': TOKEN,
        'X-Round-Manager-Id': String(identity.managerId),
      },
    }).then(r => r.json()).then(d => {
      if (d.ok) setModoFact(d.modo_facturacion || 'recibo_trimestre')
    }).catch(() => setModoFact('recibo_trimestre'))
      .finally(() => setModoLoaded(true))
  }, [identity?.managerId])

  // Filtrado por modo
  const TABS = useMemo(() => {
    if (!modoFact) return ALL_TABS.filter(t => t.modes.includes('*'))
    return ALL_TABS.filter(t => t.modes.includes('*') || t.modes.includes(modoFact))
  }, [modoFact])

  // Pestaña inicial: la primera de las disponibles según modo
  const [activeTab, setActiveTab] = useState(null)
  useEffect(() => {
    if (modoLoaded && TABS.length > 0 && !TABS.find(t => t.id === activeTab)) {
      setActiveTab(TABS[0].id)
    }
  }, [modoLoaded, TABS, activeTab])

  const ActiveComp = TABS.find(t => t.id === activeTab)?.comp ?? (TABS[0]?.comp)

  return (
    <div style={{ maxWidth: 1400, padding: '0 4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
        <Receipt size={22} style={{ color: 'var(--green)' }} aria-hidden="true" />
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, color: 'var(--text-0)', margin: 0 }}>
          Cuotas clientes
        </h1>
        <IvaNota />
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 20 }}>
        Generación de remesas mensuales, listado filtrable de recibos y analítica de cobros.
        {isImpersonating && <> Operando como trainer <strong style={{ color: 'var(--text-1)' }}>{user.email}</strong>.</>}
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
        <span>trainer: <strong style={{ color: 'var(--text-1)' }}>{identity.trainerId || '(manager)'}</strong></span>
      </div>

      {ActiveComp ? <ActiveComp identity={identity} /> : (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)' }}>
          {modoLoaded ? 'No hay pestañas disponibles para este modo de facturación.' : 'Cargando…'}
        </div>
      )}
    </div>
  )
}
