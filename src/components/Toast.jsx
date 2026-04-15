import { useState, useCallback, createContext, useContext } from 'react'
import { CheckCircle2, XCircle, AlertTriangle, X } from 'lucide-react'

const ToastContext = createContext(null)

const ICONS = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
}

const COLORS = {
  success: { bg: 'rgba(45,212,168,0.1)', border: 'rgba(45,212,168,0.2)', fg: 'var(--green)' },
  error: { bg: 'rgba(248,113,113,0.1)', border: 'rgba(248,113,113,0.2)', fg: 'var(--red)' },
  warning: { bg: 'rgba(251,191,36,0.1)', border: 'rgba(251,191,36,0.2)', fg: 'var(--amber)' },
}

const DURATION = 4000

function genId() {
  try { return crypto.randomUUID() } catch { return `${Date.now()}-${Math.random()}` }
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const addToast = useCallback((message, type = 'success') => {
    const id = genId()
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), DURATION)
  }, [])

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const toast = {
    success: (msg) => addToast(msg, 'success'),
    error: (msg) => addToast(msg, 'error'),
    warning: (msg) => addToast(msg, 'warning'),
  }

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div aria-live="polite" aria-atomic="true" aria-label="Notificaciones" className="toast-container" style={{
        position: 'fixed', top: 20, right: 20, zIndex: 9999,
        display: 'flex', flexDirection: 'column', gap: 8,
        pointerEvents: 'none', maxWidth: 'calc(100vw - 40px)',
      }}>
        {toasts.map(t => {
          const Icon = ICONS[t.type]
          const color = COLORS[t.type]
          return (
            <div key={t.id} role="status" className="toast-item" style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '14px 18px', borderRadius: 14,
              background: color.bg, border: `1px solid ${color.border}`,
              backdropFilter: 'blur(12px)',
              pointerEvents: 'auto', maxWidth: 400,
            }}>
              <Icon size={16} style={{ color: color.fg, flexShrink: 0 }} aria-hidden="true" />
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-0)', flex: 1 }}>{t.message}</span>
              <button onClick={() => removeToast(t.id)} aria-label="Cerrar notificación"
                      style={{ padding: 4, cursor: 'pointer', background: 'none', border: 'none', color: 'var(--text-3)', flexShrink: 0 }}>
                <X size={14} />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)
