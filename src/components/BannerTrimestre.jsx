// Banner que aparece arriba si hay recibos pendientes de facturar del
// trimestre cerrado. Click → lleva a Cuotas clientes / Facturación trimestral.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { getRoundIdentity } from '../utils/configApi'

const TOKEN = import.meta.env.VITE_CONFIG_API_TOKEN || ''
const STORAGE_KEY = 'round.banner.trim.dismissed'


export default function BannerTrimestre() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [dismissed, setDismissed] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') } catch { return {} }
  })

  useEffect(() => {
    if (!user) return
    const identity = getRoundIdentity(user)
    if (!identity?.managerId) return
    fetch('/api/cuotas/trimestre/aviso', {
      headers: {
        'X-Round-Token': TOKEN,
        'X-Round-Manager-Id': String(identity.managerId),
      },
    }).then(r => r.json()).then(d => {
      if (d.ok) setData(d)
    }).catch(() => {})
  }, [user])

  if (!data?.pendiente) return null
  // Dismiss persistente por trimestre
  if (dismissed[data.trim_anterior]) return null

  const handleDismiss = () => {
    const nx = { ...dismissed, [data.trim_anterior]: true }
    setDismissed(nx)
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(nx)) } catch {}
  }

  return (
    <div role="region" aria-label="Aviso facturación pendiente"
         style={{
           padding: '10px 16px',
           background: 'var(--amber-bg)',
           borderBottom: '1px solid var(--amber-border)',
           display: 'flex', alignItems: 'center', gap: 12,
         }}>
      <FileText size={16} style={{ color: 'var(--amber)', flexShrink: 0 }} aria-hidden="true" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong style={{ fontSize: 13, color: 'var(--text-0)' }}>
          Facturación pendiente — trimestre {data.trim_anterior}
        </strong>
        <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>
          Hay <strong>{data.pagados_pendientes_facturar}</strong> recibos cobrados del trimestre cerrado
          ({data.importe_pendiente_eur.toFixed(2)} €) pendientes de convertir en facturas.
        </div>
      </div>
      <button onClick={() => navigate('/cuotas-clientes')}
              style={{
                padding: '6px 12px', borderRadius: 8,
                border: '1px solid var(--amber)', background: 'var(--amber)',
                color: '#000', cursor: 'pointer', fontSize: 12, fontWeight: 600,
              }}>
        Revisar facturación
      </button>
      <button onClick={handleDismiss}
              aria-label="Ocultar aviso"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-2)', padding: 4 }}>
        <X size={16} />
      </button>
    </div>
  )
}
