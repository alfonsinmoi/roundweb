import { useState } from 'react'
import { CalendarRange, Briefcase, LayoutTemplate, CalendarDays, BarChart3, Info } from 'lucide-react'
import TemporadasPanel from './planif/TemporadasPanel'
import PuestosPanel    from './planif/PuestosPanel'
import PlantillasPanel from './planif/PlantillasPanel'
import CalendarioPanel from './planif/CalendarioPanel'
import CoberturaPanel  from './planif/CoberturaPanel'


const SUB_TABS = [
  { id: 'temporadas', label: 'Temporadas y apertura', icon: CalendarRange,    comp: TemporadasPanel },
  { id: 'puestos',    label: 'Puestos y demanda',     icon: Briefcase,        comp: PuestosPanel },
  { id: 'plantillas', label: 'Plantillas de turno',   icon: LayoutTemplate,   comp: PlantillasPanel },
  { id: 'calendario', label: 'Calendario semanal',    icon: CalendarDays,     comp: CalendarioPanel },
  { id: 'cobertura',  label: 'Cobertura',             icon: BarChart3,        comp: CoberturaPanel },
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
          <strong>Planificación de personal.</strong> Configura
          temporadas, horarios de apertura, puestos y demanda. Crea
          plantillas de turno (Mañana, Tarde, Sábado…) y asignalas a
          los trabajadores en el calendario semanal. La pestaña
          Cobertura te dice qué franjas están descubiertas (déficit) o
          tienen exceso de personal frente a la demanda configurada.
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
