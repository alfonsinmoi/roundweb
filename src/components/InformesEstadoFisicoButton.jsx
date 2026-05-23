import { useState, useEffect, useMemo } from 'react'
import { Activity, Loader2, FlaskConical } from 'lucide-react'
import { Btn, EmptyState } from './UI'
import Modal from './Modal'
import EstadoFisicoModal from './EstadoFisicoModal'
import EstadoFisicoClienteDashboard from './EstadoFisicoClienteDashboard'
import { useToast } from './Toast'
import { useAuth } from '../contexts/AuthContext'
import { estadoFisicoSessionsCliente, getRoundIdentity } from '../utils/configApi'

/**
 * Botón "Ver informe estado físico" + modal con la lista de sesiones.
 * Al seleccionar una sesión, abre el detalle (EstadoFisicoModal).
 *
 * Replica InformesEstadoFisicoCommand de NooFitPro.
 */
export default function InformesEstadoFisicoButton({ cliente }) {
  const toast = useToast()
  const { user } = useAuth()
  const identity = useMemo(() => getRoundIdentity(user), [user])
  const [open, setOpen] = useState(false)
  const [sessions, setSessions] = useState(null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState(null)

  // Carga al abrir el modal (solo la primera vez por apertura).
  // Pasa por /api/estado-fisico/sessions/<id> (backend proxy con cache 10 min).
  // Tarda unos 10-20s la primera vez del manager (recolecta todos los clientes).
  useEffect(() => {
    if (!open || sessions !== null || !cliente?.id) return
    setLoading(true)
    estadoFisicoSessionsCliente(cliente.id, identity)
      .then(data => setSessions(data))
      .catch(err => {
        console.error('[estado-fisico]', err)
        toast.error('Error cargando informes de estado físico: ' + (err.message || 'desconocido'))
        setSessions([])
      })
      .finally(() => setLoading(false))
  }, [open, sessions, cliente?.id, identity, toast])

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

      {/* Dashboard con resumen + evolución + medallas + historial */}
      {open && !selected && (
        <Modal open={open} onClose={handleClose}
               title="Informe de estado físico"
               subtitle={clienteNombre}
               maxWidth={900}>
          {/* Scroll vertical: flex:1 + overflowY:auto + minHeight:0 (clave
              para que el flex hijo respete el alto del padre y haga scroll) */}
          <div style={{
            flex: 1, minHeight: 0, overflowY: 'auto',
            padding: '20px 28px 28px',
          }}>
            {loading && (
              <div style={{ display: 'flex', flexDirection: 'column',
                            alignItems: 'center', gap: 12, padding: 40 }}
                   role="status" aria-label="Cargando sesiones">
                <Loader2 size={24} className="animate-spin"
                          style={{ color: 'var(--green)' }} aria-hidden="true" />
                <p style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  Primera carga puede tardar 10-20s (cachea 10 min).
                </p>
              </div>
            )}

            {!loading && sessions?.length === 0 && (
              <EmptyState icon={Activity}
                          title="Sin informes"
                          description="Este cliente todavía no tiene tests de estado físico registrados." />
            )}

            {!loading && sessions?.length > 0 && (
              <EstadoFisicoClienteDashboard
                sessions={sessions}
                onVerSession={(s) => setSelected(s)} />
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
