// Aviso global cuando NoofitPro (proxy /wiemspro) está caído o lento.
//
// `src/utils/api.js` emite el evento `round.noofit-status` { ok, reason } en
// cada llamada a NoofitPro: ok=false con timeout/network/5xx, ok=true cuando
// responde. Aquí lo escuchamos y mostramos una barra de aviso mientras esté
// caído; se oculta en cuanto una llamada vuelve a responder.
//
// Importante: solo afecta a los DATOS de NoofitPro (clientes, clases, agenda,
// monitores…). El resto de la web (cuotas, recibos, TPV, configuración, CRM)
// va por el backend de Round y sigue funcionando — por eso el mensaje lo
// aclara y la barra no bloquea la navegación.
import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'

const REASON_TXT = {
  timeout: 'NoofitPro está tardando demasiado en responder',
  network: 'No se pudo conectar con NoofitPro',
  http_502: 'NoofitPro no está disponible (502)',
  http_503: 'NoofitPro no está disponible (503)',
  http_504: 'NoofitPro no responde a tiempo (504)',
}

export default function NoofitStatusBanner() {
  const [down, setDown] = useState(false)
  const [reason, setReason] = useState(null)
  const [dismissed, setDismissed] = useState(false)
  const clearTimer = useRef(null)

  useEffect(() => {
    const onStatus = (e) => {
      const ok = e?.detail?.ok
      if (ok) {
        // NoofitPro respondió → ocultar (con pequeño debounce para no parpadear)
        if (clearTimer.current) clearTimeout(clearTimer.current)
        clearTimer.current = setTimeout(() => { setDown(false); setReason(null); setDismissed(false) }, 400)
      } else {
        if (clearTimer.current) { clearTimeout(clearTimer.current); clearTimer.current = null }
        setReason(e?.detail?.reason || null)
        setDown(true)
        setDismissed(false)  // un fallo nuevo reabre el aviso aunque lo hubieran cerrado
      }
    }
    window.addEventListener('round.noofit-status', onStatus)
    return () => {
      window.removeEventListener('round.noofit-status', onStatus)
      if (clearTimer.current) clearTimeout(clearTimer.current)
    }
  }, [])

  if (!down || dismissed) return null

  return (
    <div role="alert" aria-live="assertive" style={{
      position: 'sticky', top: 0, zIndex: 40,
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 24px',
      background: 'linear-gradient(135deg, rgba(245,158,11,0.18), rgba(239,68,68,0.16))',
      borderBottom: '1px solid rgba(245,158,11,0.45)',
      backdropFilter: 'blur(8px)',
    }}>
      <AlertTriangle size={18} style={{ color: 'var(--amber, #f59e0b)', flexShrink: 0 }} aria-hidden="true" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: 'Outfit, sans-serif', fontSize: 14, fontWeight: 700, color: 'var(--text-0)' }}>
          {REASON_TXT[reason] || 'NoofitPro no responde (servidor caído o lento)'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
          Los datos de NoofitPro (clientes, clases, agenda…) pueden no cargar o ir lentos.
          El resto de la web (cuotas, recibos, TPV, configuración) funciona con normalidad.
        </div>
      </div>
      <button onClick={() => setDismissed(true)} aria-label="Ocultar aviso"
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                background: 'rgba(255,255,255,0.5)', border: '1px solid rgba(245,158,11,0.4)',
                color: 'var(--text-2)', cursor: 'pointer',
              }}>
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  )
}
