// Popover ligero con las 3 últimas notas del cliente (para el listado)
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MessageSquare, Loader2 } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { listarNotasCliente } from '../../utils/notasApi'

function fmtDate(v) {
  if (!v) return ''
  try {
    const d = new Date(v)
    if (isNaN(d.getTime())) return v
    return d.toLocaleDateString('es-ES') + ' ' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  } catch { return v }
}

export default function NotasPopover({ cliente }) {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [notas, setNotas] = useState(null)
  const btnRef = useRef(null)
  const [pos, setPos] = useState(null)

  const handleOpen = async (e) => {
    e?.stopPropagation()
    if (open) { setOpen(false); return }
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 4, left: r.left - 200 })  // alineado a la izquierda del botón
    }
    setOpen(true)
    if (notas == null) {
      try {
        const ns = await listarNotasCliente(user, cliente.id, { limit: 3, archivadas: false })
        setNotas(ns)
      } catch { setNotas([]) }
    }
  }

  useEffect(() => {
    if (!open) return
    const onClickOut = (e) => {
      if (btnRef.current && !btnRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('click', onClickOut)
    return () => document.removeEventListener('click', onClickOut)
  }, [open])

  return (
    <>
      <button ref={btnRef} type="button" onClick={handleOpen}
              title="Ver últimas notas"
              aria-label="Ver últimas notas"
              style={{
                background: 'var(--bg-2)', border: '1px solid var(--line)',
                borderRadius: 8, padding: '4px 8px', cursor: 'pointer',
                color: 'var(--text-2)', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12,
              }}>
        <MessageSquare size={12} aria-hidden="true" />
        Notas
      </button>
      {open && pos && createPortal(
        <div style={{
          position: 'fixed', top: pos.top, left: Math.max(8, pos.left), zIndex: 9999,
          width: 320, background: 'var(--bg-1)', border: '1px solid var(--line)',
          borderRadius: 12, boxShadow: 'var(--shadow-lg)', padding: 12,
        }}
             onClick={e => e.stopPropagation()}>
          <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase',
                        letterSpacing: '0.05em', marginBottom: 10 }}>
            Últimas 3 notas — {cliente.name || cliente.nombre}
          </div>
          {notas == null ? (
            <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-3)' }}>
              <Loader2 size={14} className="animate-spin" aria-hidden="true" />
            </div>
          ) : notas.length === 0 ? (
            <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-3)', fontSize: 12 }}>
              Sin notas todavía.
            </div>
          ) : (
            <div>
              {notas.map(n => (
                <div key={n.id} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid var(--line)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>
                    <strong style={{ color: 'var(--text-2)' }}>{n.created_by_label || 'Sistema'}</strong>
                    {' · '}{fmtDate(n.created_at)}
                    {n.estado !== 'abierta' && (
                      <span style={{ marginLeft: 6, color: 'var(--amber)' }}>· {n.estado}</span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-1)', lineHeight: 1.4 }}>
                    {n.contenido.length > 180 ? n.contenido.slice(0, 180) + '…' : n.contenido}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>,
        document.body
      )}
    </>
  )
}
