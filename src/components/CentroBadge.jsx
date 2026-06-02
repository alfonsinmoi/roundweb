// Badge top-right del header: muestra el CENTRO/TRAINER activo de la sesión
// y el USUARIO logueado (nombre o email). Al hacer click abre el QR del
// trainer activo (el mismo QR cifrado de captación del centro).
//
// "Trainer activo":
//   - usuario_web / impersonación → identity.trainerId.
//   - manager cuyo id ES también un centro (caso Round: manager==trainer)
//     → identity.managerId.
//   - manager puro sin centro propio → null → "Todos los centros" (sin QR).
//
// nombre_centro se lee de centro_contacto (refresco cada 60s). El cambio de
// centro sigue requiriendo logout (este badge NO cambia de centro, solo
// informa y muestra el QR).
import { useEffect, useMemo, useState } from 'react'
import { Building2, QrCode } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { getRoundIdentity, centrosList } from '../utils/configApi'
import { cifrarQrTrainer } from '../utils/qrCifrado'
import { QrModal } from './QrAltaCliente'

const POLL_MS = 60_000

export default function CentroBadge() {
  const { user } = useAuth()
  const identity = useMemo(() => getRoundIdentity(user), [user])
  const [centros, setCentros] = useState([])
  const [open, setOpen] = useState(false)
  const [qrPayload, setQrPayload] = useState(null)
  const [qrError, setQrError] = useState(null)

  useEffect(() => {
    if (!identity?.managerId) return
    const load = () => centrosList(identity).then(setCentros).catch(() => {})
    load()
    const t = setInterval(() => { if (!document.hidden) load() }, POLL_MS)
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus) }
  }, [identity?.managerId])

  if (!identity?.managerId) return null

  // Trainer activo: el de la sesión (impersonación / usuario_web) o, si es
  // manager, su propio centro (solo si su id aparece como centro real).
  const sessionTid = identity.trainerId ? String(identity.trainerId) : null
  const managerIsCentro = !sessionTid && identity.managerId
    && centros.some(x => String(x.id_trainer) === String(identity.managerId))
  const activeTid = sessionTid || (managerIsCentro ? String(identity.managerId) : null)

  let nombre = 'Todos los centros'
  if (activeTid) {
    const c = centros.find(x => String(x.id_trainer) === activeTid)
    nombre = c?.nombre_centro || `Centro ${activeTid}`
  }

  const userLabel = `${user?.nombre || ''} ${user?.apellidos || ''}`.trim()
    || user?.email || ''

  const clickable = !!activeTid

  const abrirQr = () => {
    if (!clickable) return
    setQrPayload(null); setQrError(null); setOpen(true)
    cifrarQrTrainer(activeTid, identity.managerId, nombre)
      .then(setQrPayload)
      .catch(e => setQrError(e.message || 'Error generando QR'))
  }

  const inner = (
    <>
      <Building2 size={18} aria-hidden="true" style={{ flexShrink: 0 }} />
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15,
                     minWidth: 0, textAlign: 'left' }}>
        <span style={{ maxWidth: 240, overflow: 'hidden',
                       textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {nombre}
        </span>
        {userLabel && (
          <span style={{ fontSize: 11, fontWeight: 500, opacity: 0.8,
                         maxWidth: 240, overflow: 'hidden',
                         textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {userLabel}
          </span>
        )}
      </span>
      {clickable && <QrCode size={16} aria-hidden="true" style={{ flexShrink: 0, opacity: 0.8 }} />}
    </>
  )

  const baseStyle = {
    display: 'inline-flex', alignItems: 'center', gap: 10,
    padding: '6px 16px', borderRadius: 14,
    background: activeTid ? 'var(--green-bg)' : 'var(--bg-2)',
    border: `1.5px solid ${activeTid ? 'var(--green)' : 'var(--line)'}`,
    color: activeTid ? 'var(--green)' : 'var(--text-2)',
    fontFamily: 'Outfit, var(--font-display), sans-serif',
    fontWeight: 700, fontSize: 15, letterSpacing: '0.01em',
    userSelect: 'none',
  }

  return (
    <>
      {clickable ? (
        <button onClick={abrirQr}
                aria-label={`Centro activo: ${nombre} · ${userLabel}. Ver QR del centro`}
                title="Ver el QR de captación del centro"
                style={{ ...baseStyle, cursor: 'pointer' }}>
          {inner}
        </button>
      ) : (
        <div role="status"
             aria-label={`Centro activo: ${nombre}${userLabel ? ' · ' + userLabel : ''}`}
             title="Para cambiar de centro, cierra sesión y vuelve a entrar."
             style={{ ...baseStyle, cursor: 'default' }}>
          {inner}
        </div>
      )}
      {open && (
        <QrModal title={`QR del centro · ${nombre}`}
                 subtitle="El cliente lo escanea con mynoofit y se da de alta vinculándose al centro."
                 payload={qrPayload}
                 error={qrError}
                 showPayloadText={false}
                 onClose={() => setOpen(false)} />
      )}
    </>
  )
}
