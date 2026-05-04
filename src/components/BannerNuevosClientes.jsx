import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, ChevronDown, X, ArrowRight } from 'lucide-react'
import { Avatar } from './UI'
import { useNuevosClientes } from '../hooks/useNuevosClientes'

/**
 * Banner global "Nuevo cliente esperando cobro".
 * Se muestra cuando hay clientes recién registrados en NoofitPro que el
 * trainer aún no ha atendido. Click → lista expandible. Click en cliente →
 * navega al perfil con el tab ERP abierto. Botón ✕ → marca atendido.
 */
export default function BannerNuevosClientes() {
  const { nuevos, markSeen, markAllSeen } = useNuevosClientes()
  const [expanded, setExpanded] = useState(false)
  const navigate = useNavigate()

  if (!nuevos || nuevos.length === 0) return null

  const fullName = c =>
    `${c.nombre || c.name || ''} ${c.apellidos || c.surname || ''}`.trim()
      || c.email || `Cliente #${c.id}`

  function abrir(c) {
    markSeen(c.id)
    navigate(`/clientes/${c.id}?tab=erp`)
    setExpanded(false)
  }

  return (
    <div role="status" aria-live="polite" style={{
      position: 'sticky', top: 0, zIndex: 35,
      background: 'linear-gradient(135deg, rgba(45,212,168,0.18), rgba(91,156,246,0.18))',
      borderBottom: '1px solid rgba(45,212,168,0.35)',
      backdropFilter: 'blur(8px)',
    }}>
      <button onClick={() => setExpanded(e => !e)}
              aria-expanded={expanded}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                width: '100%', padding: '10px 24px',
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: 'var(--text-0)', textAlign: 'left',
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
                <button onClick={() => markSeen(c.id)}
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
              <button onClick={markAllSeen}
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
    </div>
  )
}
