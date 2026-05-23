import { useState } from 'react'
import { Bell, ChevronDown, X, ArrowRight } from 'lucide-react'
import { Avatar } from './UI'
import { useNuevosClientes } from '../hooks/useNuevosClientes'
import { useOdooStatus } from '../hooks/useOdooStatus'
import AltaClienteModal from './AltaClienteModal'

/**
 * Banner global "Nuevo cliente esperando cobro".
 * Se muestra cuando hay clientes recién registrados en NoofitPro que el
 * trainer aún no ha atendido. Click en "Atender" → abre AltaClienteModal
 * directamente para procesar el alta. Botón ✕ → marca atendido (sin
 * procesar — útil si lo gestiona luego).
 */
export default function BannerNuevosClientes() {
  const { nuevos, markSeen, markAllSeen, reload } = useNuevosClientes()
  const [expanded, setExpanded] = useState(false)
  const [clienteModal, setClienteModal] = useState(null)
  // El banner es señal de "clientes que esperan a que les des de alta en
  // el ERP". Sin Odoo no hay ERP que enviar, así que el banner pierde
  // sentido: lo ocultamos completamente.
  const { odooEnabled } = useOdooStatus()
  if (!odooEnabled) return null

  if (!nuevos || nuevos.length === 0) return null

  const fullName = c =>
    `${c.nombre || c.name || ''} ${c.apellidos || c.surname || ''}`.trim()
      || c.email || `Cliente #${c.id}`

  function abrir(c) {
    setClienteModal(c)
    setExpanded(false)
  }

  return (
    <div role="status" aria-live="polite" style={{
      position: 'sticky', top: 0, zIndex: 35,
      background: 'linear-gradient(135deg, rgba(45,212,168,0.18), rgba(91,156,246,0.18))',
      borderBottom: '1px solid rgba(45,212,168,0.35)',
      backdropFilter: 'blur(8px)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        width: '100%', padding: '10px 24px',
      }}>
        <button onClick={() => setExpanded(e => !e)}
                aria-expanded={expanded}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  flex: 1,
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: 'var(--text-0)', textAlign: 'left', padding: 0,
                }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 32, height: 32, borderRadius: '50%',
            background: 'rgba(45,212,168,0.25)', color: 'var(--green)',
            fontWeight: 700, fontSize: 13,
          }}>
            <Bell size={16} aria-hidden="true" />
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'Outfit', fontSize: 14, fontWeight: 700 }}>
              {nuevos.length === 1
                ? `Nuevo cliente esperando cobro`
                : `${nuevos.length} clientes esperando cobro`}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
              {expanded ? 'Click en uno para enviar al ERP' : 'Click para ver la lista'}
            </div>
          </div>
          <ChevronDown size={18}
                       style={{ transform: expanded ? 'rotate(180deg)' : 'none',
                                transition: 'transform 0.2s', color: 'var(--text-2)' }}
                       aria-hidden="true" />
        </button>
        <button onClick={(e) => {
                  e.stopPropagation()
                  const n = nuevos.length
                  const msg = `¿Quitar los ${n} cliente${n !== 1 ? 's' : ''} del banner?\n\n`
                    + `Se marcarán como atendidos en el servidor (vale para TODOS los navegadores y dispositivos).\n\n`
                    + `Para volver a verlos tendrás que asignarles categoría desde su perfil, o quitarlos manualmente de la lista de atendidos.\n\n`
                    + `Pulsa Aceptar para continuar.`
                  if (confirm(msg)) {
                    markAllSeen({ reset: true })
                  }
                }}
                title="Quitar todos del banner (marca atendido en el servidor)"
                aria-label="Quitar todos del banner"
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 28, height: 28, borderRadius: 8,
                  background: 'rgba(255,255,255,0.5)',
                  border: '1px solid rgba(45,212,168,0.4)',
                  color: 'var(--text-2)', cursor: 'pointer', flexShrink: 0,
                }}>
          <X size={14} aria-hidden="true" />
        </button>
      </div>

      {expanded && (
        <div style={{ borderTop: '1px solid rgba(45,212,168,0.25)' }}>
          <div style={{
            maxHeight: 360, overflowY: 'auto',
            background: 'var(--bg-1)',
          }}>
            {nuevos.map(c => (
              <div key={c.id} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 24px',
                borderBottom: '1px solid var(--line)',
              }}>
                <Avatar nombre={fullName(c)} size={34} imgUrl={c.imgUrl} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-0)',
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {fullName(c)}
                  </p>
                  <p style={{ fontSize: 11, color: 'var(--text-3)',
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.email || '—'}{c.cellPhone ? ` · ${c.cellPhone}` : ''}
                  </p>
                </div>
                <button onClick={() => abrir(c)}
                        title="Abrir perfil ERP"
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 6,
                          padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                          background: 'var(--green)', color: '#fff', border: 'none', cursor: 'pointer',
                        }}>
                  Atender <ArrowRight size={12} />
                </button>
                <button onClick={() => {
                          if (confirm(`¿Marcar a ${fullName(c)} como atendido?\n\nSe persistirá en el servidor — desaparecerá del banner en todos los navegadores y dispositivos.`)) {
                            markSeen(c.id)
                          }
                        }}
                        title="Marcar como atendido"
                        style={{
                          padding: 6, borderRadius: 8,
                          background: 'transparent', border: '1px solid var(--line)',
                          color: 'var(--text-3)', cursor: 'pointer',
                        }}>
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
          {nuevos.length > 1 && (
            <div style={{ padding: '8px 24px', textAlign: 'right' }}>
              <button onClick={() => {
                        if (confirm(`¿Marcar los ${nuevos.length} clientes como atendidos?\n\nSe persistirá en el servidor (vale para todos los navegadores).`)) {
                          markAllSeen()
                        }
                      }}
                      style={{
                        fontSize: 11, color: 'var(--text-3)',
                        background: 'transparent', border: 'none', cursor: 'pointer',
                        textDecoration: 'underline',
                      }}>
                Marcar todos como atendidos
              </button>
            </div>
          )}
        </div>
      )}

      {clienteModal && (
        <AltaClienteModal
          cliente={clienteModal}
          onClose={() => setClienteModal(null)}
          onSaved={() => {
            // Al completar el alta: marcar como atendido y recargar lista
            markSeen(clienteModal.id)
            setClienteModal(null)
            try { reload && reload() } catch {}
          }}
        />
      )}
    </div>
  )
}
