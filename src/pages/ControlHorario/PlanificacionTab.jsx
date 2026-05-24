import { useState } from 'react'
import { CalendarRange, Briefcase, Info } from 'lucide-react'
import TemporadasPanel from './planif/TemporadasPanel'
import PuestosPanel    from './planif/PuestosPanel'


const SUB_TABS = [
  { id: 'temporadas', label: 'Temporadas y apertura', icon: CalendarRange, comp: TemporadasPanel },
  { id: 'puestos',    label: 'Puestos y demanda',     icon: Briefcase,     comp: PuestosPanel },
]


export default function PlanificacionTab({ identity }) {
  const [sub, setSub] = useState('temporadas')
  const Active = SUB_TABS.find(t => t.id === sub)?.comp || TemporadasPanel
  return (
    <div>
      {/* Banner Fase 2 B.1 */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 10,
        padding: '10px 12px', borderRadius: 10, marginBottom: 14,
        background: 'rgba(59,130,246,0.06)', color: 'var(--text-2)',
        border: '1px solid rgba(59,130,246,0.16)',
        fontSize: 12, lineHeight: 1.5,
      }}>
        <Info size={14} style={{ color: '#3b82f6', flexShrink: 0, marginTop: 2 }} />
        <div>
          <strong>Configuración base de planificación.</strong> Define
          aquí las temporadas, horarios de apertura del centro, puestos
          de trabajo y demanda por puesto. Las capacidades y preferencias
          de cada trabajador se editan en su ficha (tabs nuevas Capacidades
          y Preferencias). La planificación visual y el algoritmo automático
          llegan en una iteración posterior.
        </div>
      </div>

      {/* Sub-tabs */}
      <div role="tablist" style={{
        display: 'flex', gap: 6, padding: 4, marginBottom: 14,
        background: 'var(--bg-1)', border: '1px solid var(--line)',
        borderRadius: 12,
      }}>
        {SUB_TABS.map(t => {
          const active = sub === t.id
          const Icon = t.icon
          return (
            <button key={t.id} role="tab" aria-selected={active}
                    onClick={() => setSub(t.id)}
                    style={{
                      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      gap: 6, padding: '8px 10px',
                      borderRadius: 8, border: 'none',
                      background: active ? 'var(--green-bg, rgba(16,185,129,0.10))' : 'transparent',
                      color: active ? 'var(--green, #10b981)' : 'var(--text-2)',
                      fontSize: 13, fontWeight: active ? 700 : 500,
                      cursor: 'pointer',
                    }}>
              <Icon size={14} />
              {t.label}
            </button>
          )
        })}
      </div>

      <Active identity={identity} />
    </div>
  )
}
