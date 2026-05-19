import { useState, useEffect } from 'react'
import { Activity, Loader2, ChevronRight, ArrowLeft, FlaskConical } from 'lucide-react'
import { Btn, Badge, Card, EmptyState } from './UI'
import Modal from './Modal'
import EstadoFisicoModal from './EstadoFisicoModal'
import { useToast } from './Toast'
import { getEstadoFisicoSessions } from '../utils/api'
import { formatDate } from '../utils/formatters'

function badgeColorScore(score) {
  if (!score) return 'gray'
  if (score >= 9) return 'green'
  if (score >= 7) return 'blue'
  if (score >= 5) return 'yellow'
  if (score >= 3) return 'orange'
  return 'red'
}

/**
 * Botón "Ver informe estado físico" + modal con la lista de sesiones.
 * Al seleccionar una sesión, abre el detalle (EstadoFisicoModal).
 *
 * Replica InformesEstadoFisicoCommand de NooFitPro.
 */
export default function InformesEstadoFisicoButton({ cliente }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [sessions, setSessions] = useState(null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState(null)

  // Carga al abrir el modal (solo la primera vez por apertura)
  useEffect(() => {
    if (!open || sessions !== null || !cliente?.id) return
    setLoading(true)
    getEstadoFisicoSessions(cliente.id)
      .then(data => setSessions(data))
      .catch(() => {
        toast.error('Error cargando informes de estado físico')
        setSessions([])
      })
      .finally(() => setLoading(false))
  }, [open, sessions, cliente?.id, toast])

  const handleClose = () => {
    setOpen(false)
    setSelected(null)
  }

  const clienteNombre = cliente ? `${cliente.name ?? ''} ${cliente.surname ?? ''}`.trim() : ''

  return (
    <>
      <Btn variant="secondary" size="md" onClick={() => setOpen(true)}>
        <FlaskConical size={15} aria-hidden="true" /> Informe estado físico
      </Btn>

      {/* Lista de sesiones */}
      {open && !selected && (
        <Modal open={open} onClose={handleClose}
               title="Informes de estado físico"
               subtitle={clienteNombre}
               maxWidth={680}>
          <div style={{ padding: '20px 32px 28px' }}>
            {loading && (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }} role="status" aria-label="Cargando sesiones">
                <Loader2 size={22} className="animate-spin" style={{ color: 'var(--green)' }} aria-hidden="true" />
              </div>
            )}

            {!loading && sessions?.length === 0 && (
              <EmptyState icon={Activity}
                          title="Sin informes"
                          description="Este cliente todavía no tiene tests de estado físico registrados." />
            )}

            {!loading && sessions?.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {sessions.map(s => {
                  const tests = [
                    s.hasPushUp && 'Flexiones',
                    s.hasSquatJump && 'Squat Jump',
                    s.hasBoxSquat && 'Box Squat',
                    s.hasPlancha && 'Plancha',
                    s.hasFlamenco && 'Flamenco',
                  ].filter(Boolean)

                  return (
                    <Card key={s.id} className="interactive-row"
                          onClick={() => setSelected(s)}
                          style={{
                            padding: 18, cursor: 'pointer',
                            display: 'flex', alignItems: 'center', gap: 14,
                          }}
                          tabIndex={0}
                          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(s) } }}>

                      <div style={{
                        width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'rgba(45,212,168,0.1)',
                      }}>
                        <Activity size={18} style={{ color: 'var(--green)' }} aria-hidden="true" />
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                          <p style={{ fontFamily: 'Outfit', fontSize: 15, fontWeight: 600, color: 'var(--text-0)' }}>
                            {formatDate(s.testDate)}
                          </p>
                          {s.puntuacion > 0 && (
                            <Badge color={badgeColorScore(s.puntuacion)}>
                              {s.puntuacion.toFixed(1)} · {s.categoria || ''}
                            </Badge>
                          )}
                          {!s.isCompleted && <Badge color="yellow">Incompleto</Badge>}
                        </div>
                        <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
                          {tests.length > 0 ? tests.join(' · ') : 'Sin tests realizados'}
                        </p>
                      </div>

                      <ChevronRight size={16} style={{ color: 'var(--text-3)', flexShrink: 0 }} aria-hidden="true" />
                    </Card>
                  )
                })}
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Detalle de la sesión */}
      {selected && (
        <EstadoFisicoModal
          session={selected}
          clienteNombre={clienteNombre}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  )
}
