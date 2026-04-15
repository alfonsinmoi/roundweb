import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

/**
 * Accessible modal with focus trap, Escape to close, and backdrop click.
 */
export default function Modal({ open, onClose, title, subtitle, children, maxWidth = 720, disabled = false }) {
  const dialogRef = useRef(null)
  const prevFocusRef = useRef(null)

  useEffect(() => {
    if (!open) return

    prevFocusRef.current = document.activeElement

    // Focus first focusable element in modal
    const timer = setTimeout(() => {
      const el = dialogRef.current?.querySelector('input, button, select, textarea, [tabindex]:not([tabindex="-1"])')
      el?.focus()
    }, 50)

    // Trap focus within modal
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !disabled) {
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const focusable = dialogRef.current?.querySelectorAll(
        'input:not([disabled]), button:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
      if (!focusable?.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }

    document.addEventListener('keydown', handleKeyDown)
    document.body.style.overflow = 'hidden'

    return () => {
      clearTimeout(timer)
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
      prevFocusRef.current?.focus()
    }
  }, [open, onClose, disabled])

  if (!open) return null

  return (
    <div role="dialog" aria-modal="true" aria-label={title}
         style={{
           position: 'fixed', inset: 0, zIndex: 1000,
           display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
           background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
           overflowY: 'auto', padding: '40px 20px',
         }}
         onClick={e => { if (e.target === e.currentTarget && !disabled) onClose() }}>
      <div ref={dialogRef}
           style={{
             width: '100%', maxWidth, background: 'var(--bg-2)',
             border: '1px solid var(--line)', borderRadius: 24,
             display: 'flex', flexDirection: 'column',
           }}>

        {/* Header */}
        <div style={{
          padding: '24px 32px', borderBottom: '1px solid var(--line)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0,
        }}>
          <div>
            <h3 style={{ fontFamily: 'Outfit', fontSize: 20, fontWeight: 600, color: 'var(--text-0)' }}>{title}</h3>
            {subtitle && <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>{subtitle}</p>}
          </div>
          <button onClick={() => { if (!disabled) onClose() }}
                  aria-label="Cerrar"
                  style={{
                    padding: 10, borderRadius: 12, cursor: 'pointer',
                    background: 'var(--bg-3)', border: '1px solid var(--line)',
                    color: 'var(--text-3)', transition: 'color 0.1s',
                  }}>
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        {children}
      </div>
    </div>
  )
}
