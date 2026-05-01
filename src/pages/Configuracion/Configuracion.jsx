import { useState, useEffect } from 'react'
import { Settings, ChevronRight } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { Card } from '../../components/UI'
import { getRoundIdentity } from '../../utils/configApi'
import CuotasTab        from './CuotasTab'
import DescuentosTab    from './DescuentosTab'
import ModificacionesTab from './ModificacionesTab'
import FormasPagoInfo   from './FormasPagoInfo'
import PeriodicidadInfo from './PeriodicidadInfo'

const TABS = [
  { id: 'cuotas',         label: 'Cuotas',         comp: CuotasTab },
  { id: 'descuentos',     label: 'Descuentos',     comp: DescuentosTab },
  { id: 'modificaciones', label: 'Modificaciones', comp: ModificacionesTab },
  { id: 'formas_pago',    label: 'Formas de pago', comp: FormasPagoInfo },
  { id: 'periodicidad',   label: 'Periodicidad',   comp: PeriodicidadInfo },
]

export default function Configuracion() {
  const { user, isImpersonating } = useAuth()
  const [activeTab, setActiveTab] = useState('cuotas')
  const identity = getRoundIdentity(user)
  const ActiveComp = TABS.find(t => t.id === activeTab)?.comp ?? CuotasTab

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
