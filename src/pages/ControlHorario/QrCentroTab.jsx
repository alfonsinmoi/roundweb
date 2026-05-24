import { useState, useEffect, useCallback } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { QrCode, RefreshCcw } from 'lucide-react'
import { Card, Btn, Select } from '../../components/UI'
import { useToast } from '../../components/Toast'
import { qrActual } from '../../utils/horarioApi'
import { getEntrenadores } from '../../utils/api'


export default function QrCentroTab({ identity }) {
  const toast = useToast()
  const [trainers, setTrainers] = useState([])
  const [trainerId, setTrainerId] = useState('')
  const [token, setToken] = useState(null)
  const [expiresAt, setExpiresAt] = useState(null)
  const [secondsLeft, setSecondsLeft] = useState(0)

  useEffect(() => {
    getEntrenadores().then(ts => {
      setTrainers(ts || [])
      if (ts?.length && !trainerId) setTrainerId(String(ts[0].id))
    }).catch(() => {})
  }, []) // eslint-disable-line

  const refresh = useCallback(async () => {
    if (!trainerId) return
    try {
      const data = await qrActual(identity, trainerId)
      setToken(data.qr_payload)
      setExpiresAt(new Date(data.expires_at))
    } catch (e) {
      toast.error('No se pudo emitir el QR: ' + (e.message || 'error'))
    }
  }, [identity, trainerId, toast])

  useEffect(() => { refresh() }, [refresh])

  // Cuenta atrás + autorefresco al expirar
  useEffect(() => {
    if (!expiresAt) return
    const tick = () => {
      const left = Math.max(0, Math.floor((expiresAt - new Date()) / 1000))
      setSecondsLeft(left)
      if (left === 0) refresh()
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [expiresAt, refresh])

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 18 }}>
      <Card style={{ padding: 18 }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, marginTop: 0 }}>
          QR del centro
        </h2>
        <p style={{ color: 'var(--text-2)', fontSize: 13, lineHeight: 1.6 }}>
          Si <strong>NO hay clase activa</strong> en este trainer, muestra
          este QR a los trabajadores para que lo escaneen con
          <strong> mynoofit</strong>. El código rota automáticamente cada
          10 minutos por seguridad (anti-fotos).
        </p>
        <p style={{ color: 'var(--text-2)', fontSize: 13, lineHeight: 1.6, marginBottom: 18 }}>
          Si <strong>HAY clase activa</strong>, sirve también el QR de la
          clase que NoofitPro ya muestra en otro sitio — los trabajadores
          pueden usar cualquiera de los dos para registrar su entrada o
          salida verificadas.
        </p>

        <Select label="Trainer / centro"
                value={trainerId}
                onChange={e => setTrainerId(e.target.value)}>
          {trainers.length === 0 && <option value="">— Sin trainers —</option>}
          {trainers.map(t => (
            <option key={t.id} value={t.id}>
              {`${t.nombre || t.name || ''} ${t.apellidos || t.surname || ''}`.trim() || t.email} (id {t.id})
            </option>
          ))}
        </Select>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 18 }}>
          <Btn variant="ghost" onClick={refresh}>
            <RefreshCcw size={14} /> Refrescar
          </Btn>
          {secondsLeft > 0 && (
            <span style={{ color: 'var(--text-3)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
              Próximo refresco en {String(Math.floor(secondsLeft / 60)).padStart(2, '0')}:{String(secondsLeft % 60).padStart(2, '0')}
            </span>
          )}
        </div>
      </Card>

      <Card style={{ padding: 18, display: 'flex', flexDirection: 'column',
                     alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        {token ? (
          <>
            <div style={{ background: '#fff', padding: 12, borderRadius: 12 }}>
              <QRCodeSVG value={token} size={240} level="M" />
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-3)', textAlign: 'center', margin: 0 }}>
              Escanea con <strong style={{ color: 'var(--text-2)' }}>mynoofit</strong>
            </p>
          </>
        ) : (
          <div style={{ color: 'var(--text-3)', fontSize: 13, padding: 60 }}>
            <QrCode size={48} style={{ marginBottom: 12, color: 'var(--text-3)' }} />
            <p>Selecciona un trainer para generar el QR</p>
          </div>
        )}
      </Card>
    </div>
  )
}
