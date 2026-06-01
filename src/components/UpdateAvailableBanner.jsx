// Banner sticky que aparece cuando hay una nueva versión del frontend
// desplegada en el servidor (detectado por `useVersionCheck`).
//
// Recarga la página con cache-bust al pulsar el botón. El usuario PUEDE
// ignorarlo (botón X) pero entonces seguirá usando la versión vieja.

import { useState } from 'react'
import { RefreshCw, X } from 'lucide-react'
import { useVersionCheck } from '../hooks/useVersionCheck'

export default function UpdateAvailableBanner() {
  const { hasUpdate, reload } = useVersionCheck()
  const [dismissed, setDismissed] = useState(false)

  if (!hasUpdate || dismissed) return null

  return (
    <div role="status" aria-live="polite" style={{
      position: 'sticky', top: 0, zIndex: 40,
      background: 'linear-gradient(135deg, rgba(91,156,246,0.22), rgba(168,85,247,0.22))',
      borderBottom: '1px solid rgba(91,156,246,0.45)',
      backdropFilter: 'blur(8px)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        width: '100%', padding: '10px 24px',
      }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 32, height: 32, borderRadius: '50%',
          background: 'rgba(91,156,246,0.3)', color: 'var(--blue, #5b9cf6)',
        }}>
          <RefreshCw size={16} aria-hidden="true" />
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'Outfit', fontSize: 14, fontWeight: 700, color: 'var(--text-0)' }}>
            Hay una nueva versión disponible
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
            Recarga para ver las últimas mejoras y arreglos.
          </div>
        </div>
        <button onClick={reload}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '7px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600,
                  background: 'var(--gradient-primary, #2DD4A8)',
                  color: '#fff', border: 'none', cursor: 'pointer',
                  fontFamily: 'inherit',
                }}>
          <RefreshCw size={13} aria-hidden="true" /> Recargar ahora
        </button>
        <button onClick={() => setDismissed(true)}
                title="Ignorar (no recomendado — seguirás en la versión vieja)"
                aria-label="Cerrar aviso de actualización"
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 28, height: 28, borderRadius: 8,
                  background: 'rgba(255,255,255,0.5)',
                  border: '1px solid rgba(91,156,246,0.45)',
                  color: 'var(--text-2)', cursor: 'pointer', flexShrink: 0,
                }}>
          <X size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
