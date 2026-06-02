// Componentes para los QR de alta de cliente.
// El comportamiento depende del modo configurado en Configuración → Alta de
// cliente para el trainer actual ('centro' | 'individual' | 'ambos').
//
//   <QrCentroButton trainerId="17675" nombreCentro="Round Málaga Centro" />
//     → si modo ∈ {centro, ambos}: muestra botón "QR del centro" que abre
//       modal con QR escaneable por mynoofit para captación abierta.
//       Contenido: AES-256-CBC de "TRAINER;<id>;<managerId>;<nombre>" (base64).
//     → si modo='individual': NO se renderiza nada.
//
//   <QrFichaCliente cliente={c} trainerId="17675" />
//     → si modo ∈ {individual, ambos}: muestra QR personal del cliente que
//       éste escanea con mynoofit para vincular su cuenta a la ficha.
//       Contenido: "TRAINERLINK;<idCliente>" (sin cifrar, cedeDatos=true).
//     → si modo='centro': NO se renderiza nada.
//
// Spec: docs/QR_TRAINER_CLIENTE.md (junio 2026, confirmado por NoofitPro).
//
// Polling: cada componente vuelve a leer el modo cada 30 s y al volver a
// foco — así si el gestor cambia el modo, los QR aparecen/desaparecen sin
// recargar la web.
import { useEffect, useMemo, useState, useRef } from 'react'
import { QrCode, X, Loader2 } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useAuth } from '../contexts/AuthContext'
import {
  getRoundIdentity, altaModoGet,
} from '../utils/configApi'
import { cifrarQrTrainer, payloadQrVincular } from '../utils/qrCifrado'

const POLL_MS = 30_000


// Hook: devuelve el modo de alta del trainer indicado. Recarga cada 30 s y
// al volver al foco para reflejar cambios del gestor sin tener que recargar.
export function useAltaModo(idTrainer) {
  const { user } = useAuth()
  const identity = useMemo(() => getRoundIdentity(user), [user])
  const [modo, setModo] = useState(null)
  const timer = useRef(null)

  const refresh = () => {
    if (!identity?.managerId || !idTrainer) return
    altaModoGet(identity, idTrainer).then(setModo).catch(() => {})
  }
  useEffect(() => {
    refresh()
    timer.current = setInterval(() => {
      if (!document.hidden) refresh()
    }, POLL_MS)
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      if (timer.current) clearInterval(timer.current)
      window.removeEventListener('focus', onFocus)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity?.managerId, idTrainer])
  return modo
}


export function QrCentroButton({ trainerId, nombreCentro }) {
  const { user } = useAuth()
  const identity = useMemo(() => getRoundIdentity(user), [user])
  const [open, setOpen] = useState(false)
  const [qrPayload, setQrPayload] = useState(null)
  const [qrError, setQrError] = useState(null)

  // Generar el contenido cifrado del QR cuando se abre el modal.
  useEffect(() => {
    if (!open) return
    if (!identity?.managerId || !trainerId) return
    setQrPayload(null); setQrError(null)
    cifrarQrTrainer(trainerId, identity.managerId, nombreCentro || `Trainer ${trainerId}`)
      .then(setQrPayload)
      .catch(e => setQrError(e.message || 'Error generando QR'))
  }, [open, identity?.managerId, trainerId, nombreCentro])

  // Junio 2026 — el QR del trainer se muestra SIEMPRE arriba a la derecha en
  // Clientes (antes dependía del modo de alta 'centro'/'ambos'). Es el QR de
  // perfil del trainer (cifrado), independiente de cómo se den de alta.
  if (!trainerId) return null

  return (
    <>
      <button onClick={() => setOpen(true)}
              title="QR del centro — los clientes nuevos se dan de alta y se vinculan al trainer"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '6px 10px', borderRadius: 10,
                background: 'var(--green-bg)', border: '1px solid var(--green-border)',
                color: 'var(--green)', fontWeight: 600, fontSize: 12,
                cursor: 'pointer',
              }}>
        <QrCode size={14} /> QR del centro
      </button>
      {open && (
        <QrModal title={`QR del centro · ${nombreCentro || `Trainer ${trainerId}`}`}
                 subtitle="El cliente lo escanea con mynoofit y se da de alta vinculándose al centro."
                 payload={qrPayload}
                 error={qrError}
                 // El payload cifrado es opaco — no merece la pena mostrarlo
                 // como texto debajo del QR (sería ruido).
                 showPayloadText={false}
                 onClose={() => setOpen(false)} />
      )}
    </>
  )
}


export function QrFichaCliente({ cliente, trainerId, compact = false }) {
  const modo = useAltaModo(trainerId)
  const [open, setOpen] = useState(false)
  if (modo !== 'individual' && modo !== 'ambos') return null
  if (!cliente?.id) return null

  // TODO(NoofitPro): cuando expongan el flag `Trainer.cedeDatos`, pasarlo
  // como prop o leerlo aquí para que un cedeDatos=false genere el
  // payload alternativo "cedeDatosFalse:<id>:<dni>:<idTrainer>".
  const payload = payloadQrVincular({
    idCliente: cliente.id,
    dni: cliente.dni,
    idTrainer: trainerId,
    cedeDatos: true,
  })

  return (
    <>
      <button onClick={() => setOpen(true)}
              title="QR de la ficha — el cliente lo escanea con mynoofit y vincula su cuenta a esta ficha"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: compact ? '4px 8px' : '6px 10px',
                borderRadius: 10,
                background: 'var(--green-bg)', border: '1px solid var(--green-border)',
                color: 'var(--green)', fontWeight: 600, fontSize: compact ? 11 : 12,
                cursor: 'pointer',
              }}>
        <QrCode size={compact ? 12 : 14} /> QR ficha
      </button>
      {open && (
        <QrModal title={`QR de ${cliente.name || ''} ${cliente.surname || ''}`}
                 subtitle="El cliente lo escanea con mynoofit y vincula su cuenta a esta ficha existente."
                 payload={payload}
                 showPayloadText={true}
                 onClose={() => setOpen(false)} />
      )}
    </>
  )
}


export function QrModal({ title, subtitle, payload, error, showPayloadText, onClose }) {
  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }}
         style={{ position: 'fixed', inset: 0, zIndex: 700,
                  background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: 20 }}>
      <div style={{ background: 'var(--bg-1)', borderRadius: 20,
                    boxShadow: 'var(--shadow-lg)', maxWidth: 420, width: '100%',
                    padding: 28, position: 'relative', textAlign: 'center' }}>
        <button onClick={onClose} aria-label="Cerrar"
                style={{ position: 'absolute', top: 12, right: 12,
                         width: 32, height: 32, borderRadius: 8,
                         border: '1px solid var(--line)', background: 'var(--bg-3)',
                         color: 'var(--text-2)', cursor: 'pointer',
                         display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <X size={14} />
        </button>
        <h2 style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-0)',
                     margin: '0 0 6px' }}>{title}</h2>
        <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 22px',
                    lineHeight: 1.5 }}>{subtitle}</p>
        <div style={{ display: 'flex', justifyContent: 'center',
                      padding: 20, borderRadius: 14, background: '#fff',
                      border: '1px solid var(--line)', minHeight: 300 }}>
          {error ? (
            <div style={{ color: 'var(--red)', fontSize: 12,
                          alignSelf: 'center', padding: 20 }}>
              {error}
            </div>
          ) : payload ? (
            <QRCodeSVG value={payload} size={260} level="M" includeMargin={false} />
          ) : (
            <div style={{ alignSelf: 'center', color: 'var(--text-3)',
                          fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Loader2 size={16} className="animate-spin" /> Generando QR…
            </div>
          )}
        </div>
        {showPayloadText && payload && (
          <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 14,
                      fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
            {payload}
          </p>
        )}
      </div>
    </div>
  )
}
