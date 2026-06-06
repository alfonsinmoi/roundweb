// Banner que avisa a administración de entradas puntuales (modo "por entrada")
// pendientes de cobrar en recepción. Click → /entradas-puntuales.
// Sondea cada 60 s mientras la pestaña está visible.
import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Wallet, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { getRoundIdentity } from '../utils/configApi'

const TOKEN = import.meta.env.VITE_CONFIG_API_TOKEN || ''
const POLL_MS = 60_000

export default function EntradasPendientesBanner() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [total, setTotal] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const timerRef = useRef(null)

  useEffect(() => {
    if (!user) return
    const identity = getRoundIdentity(user)
    if (!identity?.managerId) return
    const headers = { 'X-Round-Token': TOKEN, 'X-Round-Manager-Id': String(identity.managerId) }
    if (identity.trainerId) headers['X-Round-Trainer-Id'] = String(identity.trainerId)

    const fetchPend = () => {
      if (document.hidden) return
      fetch('/api/entradas-puntuales/pendientes', { headers })
        .then(r => r.json())
        .then(d => { if (d.ok) { setTotal(d.total || 0); if ((d.total || 0) > 0) setDismissed(false) } })
        .catch(() => {})
    }
    fetchPend()
    timerRef.current = setInterval(fetchPend, POLL_MS)
    const onFocus = () => fetchPend()
    window.addEventListener('focus', onFocus)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      window.removeEventListener('focus', onFocus)
    }
  }, [user])

  if (total === 0 || dismissed) return null

  return (
    <div role="region" aria-label="Entradas puntuales pendientes de cobro"
         style={{
           padding: '10px 16px', background: 'var(--amber-bg)',
           borderBottom: '1px solid var(--amber-border)',
           display: 'flex', alignItems: 'center', gap: 12,
         }}>
      <Wallet size={16} style={{ color: 'var(--amber)', flexShrink: 0 }} aria-hidden="true" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong style={{ fontSize: 13, color: 'var(--text-0)' }}>
          {total} entrada{total !== 1 ? 's' : ''} puntual{total !== 1 ? 'es' : ''} pendiente{total !== 1 ? 's' : ''} de cobro
        </strong>
        <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>
          Hay reservas confirmadas que deben cobrarse en recepción.
        </div>
      </div>
      <button onClick={() => navigate('/entradas-puntuales')}
              style={{
                padding: '6px 12px', borderRadius: 8,
                border: '1px solid var(--amber)', background: 'var(--amber)',
                color: '#000', cursor: 'pointer', fontSize: 12, fontWeight: 600,
              }}>
        Cobrar ahora
      </button>
      <button onClick={() => setDismissed(true)} aria-label="Ocultar aviso"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-2)', padding: 4 }}>
        <X size={16} />
      </button>
    </div>
  )
}
