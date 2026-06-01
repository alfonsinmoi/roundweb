// Popover ligero con las 3 últimas notas del cliente (para el listado).
//
// Junio 2026 — refactor para robustez:
//   - El click stopPropagation se hace ANTES de cualquier async (la fila
//     padre tiene onClick=navigate al perfil, había riesgo de race).
//   - Fetch movido a useEffect (antes era inline dentro del handler async,
//     dejaba estados intermedios raros si el usuario cerraba rápido).
//   - onMouseDown también stopea — algunos navegadores disparan el navigate
//     en mousedown antes que el click.
//   - Posicionamiento clamped al viewport para que el popover sea siempre
//     visible aunque el botón esté pegado al borde derecho/inferior.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MessageSquare, Loader2 } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { listarNotasCliente } from '../../utils/notasApi'

const POPOVER_W = 320

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
  const [error, setError] = useState(null)
  const btnRef = useRef(null)
  const [pos, setPos] = useState(null)

  const stop = (e) => {
    e.stopPropagation()
    if (e.preventDefault) e.preventDefault()
  }

  const toggle = (e) => {
    stop(e)
    if (open) { setOpen(false); return }
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      // Posicionar a la izquierda del botón (el botón está cerca del borde
      // derecho de la fila). Clamp al viewport con margen 12.
      let left = r.right - POPOVER_W
      if (left < 12) left = 12
      if (left + POPOVER_W > window.innerWidth - 12) {
        left = window.innerWidth - POPOVER_W - 12
      }
      const top = Math.min(r.bottom + 4, window.innerHeight - 200)
      setPos({ top, left })
    }
    setOpen(true)
  }

  // Cargar las notas cuando se abre el popover por primera vez.
  useEffect(() => {
    if (!open || notas != null) return
    let cancelado = false
    listarNotasCliente(user, cliente.id, { limit: 3, archivadas: false })
      .then(ns => { if (!cancelado) setNotas(ns || []) })
      .catch(e => {
        if (cancelado) return
        console.error('NotasPopover fetch error:', e)
        setError(e?.message || 'No se pudieron cargar las notas')
        setNotas([])
      })
    return () => { cancelado = true }
  }, [open, notas, user, cliente.id])

  // Click fuera del popover cierra.
  useEffect(() => {
    if (!open) return
    const onClickOut = (e) => {
      if (btnRef.current && !btnRef.current.contains(e.target)) setOpen(false)
    }
    // Pequeño delay para no capturar el mismo click que abrió el popover.
    const t = setTimeout(() => document.addEventListener('click', onClickOut), 0)
    return () => {
      clearTimeout(t)
      document.removeEventListener('click', onClickOut)
    }
  }, [open])

  return (
    <>
      <button ref={btnRef} type="button"
              onClick={toggle}
              onMouseDown={stop}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { stop(e); toggle(e) } }}
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
          position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999,
          width: POPOVER_W, background: 'var(--bg-1)', border: '1px solid var(--line)',
          borderRadius: 12, boxShadow: 'var(--shadow-lg)', padding: 12,
        }}
             onClick={stop}
             onMouseDown={stop}>
          <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase',
                        letterSpacing: '0.05em', marginBottom: 10 }}>
            Últimas 3 notas — {cliente.name || cliente.nombre}
          </div>
          {error ? (
            <div style={{ padding: 12, color: 'var(--red)', fontSize: 12 }}>
              ⚠ {error}
            </div>
          ) : notas == null ? (
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
