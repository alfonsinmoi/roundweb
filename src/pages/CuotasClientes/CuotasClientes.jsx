import { useState } from 'react'
import { Receipt, ChevronRight } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { getRoundIdentity } from '../../utils/configApi'
import GenerarTab from './GenerarTab'
import ListadoTab from './ListadoTab'
import DevolucionesTab from './DevolucionesTab'
import EvolucionTab from './EvolucionTab'

const TABS = [
  { id: 'generar',     label: 'Generar remesa mensual', comp: GenerarTab },
  { id: 'listado',     label: 'Listado',                comp: ListadoTab },
  { id: 'devoluciones',label: 'Devoluciones',           comp: DevolucionesTab },
  { id: 'evolucion',   label: 'Evolución',              comp: EvolucionTab },
]

export default function CuotasClientes() {
  const { user, isImpersonating } = useAuth()
  const [activeTab, setActiveTab] = useState('generar')
  const identity = getRoundIdentity(user)
  const ActiveComp = TABS.find(t => t.id === activeTab)?.comp ?? GenerarTab

  return (
    <div style={{ maxWidth: 1400, padding: '0 4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <Receipt size={22} style={{ color: 'var(--green)' }} aria-hidden="true" />
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, color: 'var(--text-0)', margin: 0 }}>
          Cuotas clientes
        </h1>
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

      <ActiveComp identity={identity} />
    </div>
  )
}
