import { useState, useEffect } from 'react'
import { Search, ChevronDown, ChevronUp, Layers, Tag, Loader2 } from 'lucide-react'
import { Card, Badge } from '../components/UI'
import { getPlanesEntrenamiento } from '../utils/api'

export default function Entrenamientos() {
  const [planes, setPlanes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState(null)

  useEffect(() => {
    getPlanesEntrenamiento()
      .then(data => setPlanes(data.filter(p => p.enabled)))
      .catch(() => setError('Error cargando planes de entrenamiento'))
      .finally(() => setLoading(false))
  }, [])

  const filtered = planes.filter(p =>
    (p.nombre ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (p.descripcion ?? '').toLowerCase().includes(search.toLowerCase())
  )

  if (loading) return (
    <div className="flex items-center justify-center py-24" role="status" aria-label="Cargando entrenamientos">
      <Loader2 size={24} className="animate-spin" style={{ color: 'var(--green)' }} aria-hidden="true" />
    </div>
  )

  if (error) return (
    <div className="py-16 text-center text-sm" role="alert" style={{ color: 'var(--red)' }}>
      {error}
    </div>
  )

  return (
    <div className="max-w-5xl space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-[18px] top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} aria-hidden="true" />
          <input type="search" placeholder="Buscar plan..." value={search} onChange={e => setSearch(e.target.value)}
                 aria-label="Buscar plan de entrenamiento"
                 className="form-input"
                 style={{ width: '100%', padding: '14px 18px 14px 48px', borderRadius: 14, fontSize: 15, background: 'var(--bg-2)', border: '1px solid var(--line)', color: 'var(--text-0)', transition: 'border-color 0.15s' }} />
        </div>
      </div>

      <p className="text-xs" style={{ color: 'var(--text-3)' }} aria-live="polite">{filtered.length} planes</p>

      <div className="space-y-3">
        {filtered.map(plan => {
          const isOpen = expanded === plan.id
          return (
            <Card key={plan.id} className="overflow-hidden">
              <button aria-expanded={isOpen} aria-label={`${plan.nombre} — ${isOpen ? 'Contraer' : 'Expandir'}`}
                      style={{ width: '100%', padding: 28, display: 'flex', background: 'transparent', border: 'none' }}
                      className="flex items-start gap-4 cursor-pointer text-left"
                      onClick={() => setExpanded(isOpen ? null : plan.id)}>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <h3 className="font-semibold" style={{ color: 'var(--text-1)' }}>{plan.nombre}</h3>
                    {plan.generico && <Badge color="blue">Genérico</Badge>}
                  </div>
                  {plan.descripcion && (
                    <p className="text-sm" style={{ color: 'var(--text-2)' }}>{plan.descripcion}</p>
                  )}
                  <div className="flex flex-wrap gap-4 mt-2">
                    {plan.numeroSesiones != null && (
                      <div className="flex items-center gap-1.5 text-xs">
                        <Layers size={12} style={{ color: 'var(--text-3)' }} aria-hidden="true" />
                        <span style={{ color: 'var(--text-2)' }}>{plan.numeroSesiones} sesiones</span>
                      </div>
                    )}
                    {plan.precio != null && plan.precio > 0 && (
                      <div className="flex items-center gap-1.5 text-xs">
                        <Tag size={12} style={{ color: 'var(--text-3)' }} aria-hidden="true" />
                        <span style={{ color: 'var(--text-2)' }}>{plan.precio} €</span>
                      </div>
                    )}
                  </div>
                </div>
                {isOpen
                  ? <ChevronUp size={16} style={{ color: 'var(--text-3)', flexShrink: 0 }} aria-hidden="true" />
                  : <ChevronDown size={16} style={{ color: 'var(--text-3)', flexShrink: 0 }} aria-hidden="true" />
                }
              </button>

              {isOpen && (
                <div style={{ padding: '0 28px 28px', borderTop: '1px solid var(--line)' }}>
                  <div className="pt-4 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span style={{ color: 'var(--text-3)' }}>ID del plan</span>
                      <span className="font-mono" style={{ color: 'var(--text-2)' }}>{plan.id}</span>
                    </div>
                    {plan.nombreIngles && (
                      <div className="flex justify-between text-sm">
                        <span style={{ color: 'var(--text-3)' }}>Nombre (EN)</span>
                        <span style={{ color: 'var(--text-2)' }}>{plan.nombreIngles}</span>
                      </div>
                    )}
                    {plan.descripcionIngles && (
                      <div className="text-sm pt-2">
                        <p style={{ color: 'var(--text-3)' }} className="mb-1">Descripción (EN)</p>
                        <p style={{ color: 'var(--text-2)' }}>{plan.descripcionIngles}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </Card>
          )
        })}

        {filtered.length === 0 && (
          <div className="py-16 text-center" style={{ color: 'var(--text-3)' }}>
            No se encontraron planes de entrenamiento
          </div>
        )}
      </div>
    </div>
  )
}
