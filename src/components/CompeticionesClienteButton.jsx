import { useState, useEffect, useMemo } from 'react'
import { Award, Loader2, Trophy } from 'lucide-react'
import { Btn, EmptyState } from './UI'
import Modal from './Modal'
import { useToast } from './Toast'
import { useAuth } from '../contexts/AuthContext'
import { competicionesCliente, getRoundIdentity } from '../utils/configApi'
import { formatDate } from '../utils/formatters'

const fmtPuesto = (p) => (p == null || p === 0 ? '—' : `#${p}`)

/**
 * Botón "Competiciones" + modal con el historial de participaciones del
 * cliente (competición, fecha, puesto personal / global).
 *
 * Espejo de InformesEstadoFisicoButton para el módulo de competiciones.
 */
export default function CompeticionesClienteButton({ cliente }) {
  const toast = useToast()
  const { user } = useAuth()
  const identity = useMemo(() => getRoundIdentity(user), [user])
  const [open, setOpen] = useState(false)
  const [comps, setComps] = useState(null)
  const [loading, setLoading] = useState(false)

  // Carga al abrir el modal (solo la primera vez por apertura).
  useEffect(() => {
    if (!open || comps !== null || !cliente?.id) return
    setLoading(true)
    competicionesCliente(cliente.id, identity)
      .then(data => setComps(data?.competiciones || []))
      .catch(err => {
        console.error('[competiciones]', err)
        toast.error('Error cargando competiciones: ' + (err.message || 'desconocido'))
        setComps([])
      })
      .finally(() => setLoading(false))
  }, [open, comps, cliente?.id, identity, toast])

  const handleClose = () => setOpen(false)

  const clienteNombre = cliente ? `${cliente.name ?? ''} ${cliente.surname ?? ''}`.trim() : ''

  return (
    <>
      <Btn variant="secondary" size="md" onClick={() => setOpen(true)}>
        <Trophy size={15} aria-hidden="true" /> Competiciones
      </Btn>

      {open && (
        <Modal open={open} onClose={handleClose}
               title="Competiciones del cliente"
               subtitle={clienteNombre}
               maxWidth={720}>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 28px 28px' }}>
            {loading && (
              <div style={{ display: 'flex', flexDirection: 'column',
                            alignItems: 'center', gap: 12, padding: 40 }}
                   role="status" aria-label="Cargando competiciones">
                <Loader2 size={24} className="animate-spin"
                          style={{ color: 'var(--green)' }} aria-hidden="true" />
              </div>
            )}

            {!loading && comps?.length === 0 && (
              <EmptyState icon={Award}
                          title="Sin competiciones"
                          description="Este cliente no ha participado en competiciones." />
            )}

            {!loading && comps?.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--line)', background: 'var(--bg-2)' }}>
                      <th style={{ ...thStyle, textAlign: 'left' }}>Competición</th>
                      <th style={{ ...thStyle, textAlign: 'left' }}>Fecha</th>
                      <th style={thStyle}>Puesto</th>
                      <th style={thStyle}>Puesto global</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comps.map((c, idx) => (
                      <tr key={`${c.sala_id}-${c.fecha}-${idx}`}
                          style={{ borderBottom: '1px solid var(--line)' }}>
                        <td style={{ ...tdStyle, textAlign: 'left', fontWeight: 600,
                                     color: 'var(--text-0)' }}>{c.competicion_nombre}</td>
                        <td style={{ ...tdStyle, textAlign: 'left' }}>{formatDate(c.fecha)}</td>
                        <td style={tdStyle}>{fmtPuesto(c.personal_rank)}</td>
                        <td style={tdStyle}>{fmtPuesto(c.global_rank)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  )
}

const thStyle = {
  padding: '10px 12px', fontSize: 11, fontWeight: 600, color: 'var(--text-3)',
  textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'right',
  whiteSpace: 'nowrap',
}
const tdStyle = {
  padding: '9px 12px', color: 'var(--text-1)', textAlign: 'right', whiteSpace: 'nowrap',
}
