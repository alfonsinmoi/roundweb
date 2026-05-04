import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Save, Loader2, CheckCircle2, QrCode, Smartphone } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { Card, Btn, Input, Select, SectionTitle, Avatar } from '../../components/UI'
import { postClientes } from '../../utils/api'
import { useAuth } from '../../contexts/AuthContext'

const nivelesConocimiento = ['Principiante', 'Básico', 'Intermedio', 'Avanzado', 'Experto']
const estadosForma = ['Sedentario', 'Regular', 'Activo', 'Muy activo', 'Atleta']

export default function NewClient() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  // Identificador del entrenador para vincular al cliente desde la app mynoofit.
  // Preferimos el manager id (cabecera X-TRAINER_MANAGER del backend); como
  // fallback, el entrenador id.
  const qrValue = String(user?.manager ?? user?.id ?? '')
  const trainerNombre = `${user?.nombre ?? ''} ${user?.apellidos ?? ''}`.trim() || (user?.email ?? '—')

  const [form, setForm] = useState({
    name: '', surname: '', email: '', cellPhone: '', dni: '',
    birthdate: '', gender: 'M',
    height: '', weight: '',
    nivelConocimiento: 0,
    estadoForma: 'Regular',
  })

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.name.trim() || !form.surname.trim()) { setError('Nombre y apellidos son obligatorios'); return }
    if (!form.email.trim()) { setError('El correo electrónico es obligatorio'); return }

    setSaving(true)
    try {
      const cliente = {
        name: form.name.trim(),
        surname: form.surname.trim(),
        email: form.email.trim(),
        cellPhone: form.cellPhone.trim() || null,
        dni: form.dni.trim() || null,
        birthdate: form.birthdate || null,
        gender: form.gender,
        height: form.height ? Number(form.height) : 0,
        weight: form.weight ? Number(form.weight) : 0,
        nivelConocimiento: Number(form.nivelConocimiento),
        estadoForma: form.estadoForma || null,
        enabled: true,
        activo: true,
        toSend: true,
      }
      await postClientes([cliente])
      setSaved(true)
      setTimeout(() => navigate('/clientes'), 1500)
    } catch (err) {
      setError('Error al crear el cliente. Inténtalo de nuevo')
    } finally {
      setSaving(false)
    }
  }

  if (saved) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '120px 0' }}>
      <div style={{ width: 64, height: 64, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(45,212,168,0.12)' }}>
        <CheckCircle2 size={28} style={{ color: 'var(--green)' }} />
      </div>
      <p style={{ fontFamily: 'Outfit', fontWeight: 600, fontSize: 16, color: 'var(--text-0)' }}>Cliente creado correctamente</p>
      <p style={{ fontSize: 13, color: 'var(--text-3)' }}>Redirigiendo...</p>
    </div>
  )

  return (
    <div style={{ maxWidth: 1100 }}>

      <button onClick={() => navigate('/clientes')}
              style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer', color: 'var(--text-3)', background: 'none', border: 'none', marginBottom: 28, transition: 'color 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--text-1)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--text-3)'}>
        <ArrowLeft size={15} /> Clientes
      </button>

      <h1 style={{ fontFamily: 'Outfit', fontSize: 28, fontWeight: 700, color: 'var(--text-0)', marginBottom: 32 }}>
        Nuevo Cliente
      </h1>

      <div className="newclient-grid" style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) 360px',
        gap: 24,
        alignItems: 'start',
      }}>

      <form onSubmit={handleSubmit}>
        <Card style={{ padding: 32 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>

            <Input label="Nombre *" id="name" required value={form.name}
                   onChange={e => set('name', e.target.value)} placeholder="Nombre" />

            <Input label="Apellidos *" id="surname" required value={form.surname}
                   onChange={e => set('surname', e.target.value)} placeholder="Apellidos" />

            <Select label="Género" id="gender" value={form.gender}
                    onChange={e => set('gender', e.target.value)}>
              <option value="M">Hombre</option>
              <option value="F">Mujer</option>
            </Select>

            <Input label="Fecha de Nacimiento" id="birthdate" type="date" value={form.birthdate}
                   onChange={e => set('birthdate', e.target.value)} />

            <div style={{ gridColumn: '1 / -1' }}>
              <Input label="Correo Electrónico *" id="email" type="email" required value={form.email}
                     onChange={e => set('email', e.target.value)} placeholder="Correo Electrónico" />
            </div>

            <Input label="Teléfono" id="cellPhone" type="tel" value={form.cellPhone}
                   onChange={e => set('cellPhone', e.target.value)} placeholder="Teléfono" />
            <Input label="DNI / NIF" id="dni" value={form.dni}
                   onChange={e => set('dni', e.target.value)} placeholder="12345678A" />

            <Input label="Altura (cm)" id="height" type="number" min="0" max="250" value={form.height}
                   onChange={e => set('height', e.target.value)} placeholder="0" />

            <Input label="Peso (Kg)" id="weight" type="number" min="0" max="300" step="0.1" value={form.weight}
                   onChange={e => set('weight', e.target.value)} placeholder="0" />

            <Select label="Nivel de conocimiento" id="nivel" value={form.nivelConocimiento}
                    onChange={e => set('nivelConocimiento', e.target.value)}>
              {nivelesConocimiento.map((n, i) => (
                <option key={i} value={i}>{n}</option>
              ))}
            </Select>

            <Select label="Estado de forma" id="estadoForma" value={form.estadoForma}
                    onChange={e => set('estadoForma', e.target.value)}>
              {estadosForma.map(ef => (
                <option key={ef} value={ef}>{ef}</option>
              ))}
            </Select>

          </div>

          {error && (
            <div style={{ padding: '16px 20px', borderRadius: 14, marginTop: 24, fontSize: 14, color: 'var(--red)', background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.12)' }}>
              {error}
            </div>
          )}

          <div style={{ marginTop: 32 }}>
            <Btn type="submit" size="lg" disabled={saving}
                 className={saving ? '' : ''}
                 style={{ width: '100%', justifyContent: 'center' }}>
              {saving
                ? <><Loader2 size={16} className="animate-spin" /> Guardando...</>
                : <><Save size={16} /> Crear Cliente</>
              }
            </Btn>
          </div>
        </Card>
      </form>

      {/* ── QR de vinculación del entrenador ──────────────────────────────── */}
      <aside style={{ position: 'sticky', top: 24 }}>
        <Card style={{ padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, alignSelf: 'flex-start' }}>
            <QrCode size={16} style={{ color: 'var(--green)' }} aria-hidden="true" />
            <h2 style={{ fontFamily: 'Outfit', fontSize: 15, fontWeight: 700, color: 'var(--text-0)', margin: 0 }}>
              Vincular cliente
            </h2>
          </div>

          <p style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.55, alignSelf: 'flex-start', margin: 0 }}>
            Para que el cliente quede asociado a este entrenador al darse de alta en la app, escanea este código desde <strong style={{ color: 'var(--text-1)' }}>mynoofit</strong>.
          </p>

          {/* Datos del entrenador */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, width: '100%',
            padding: '10px 12px', borderRadius: 10,
            background: 'var(--bg-2)', border: '1px solid var(--line)',
          }}>
            <Avatar nombre={trainerNombre} size={34} imgUrl={user?.imgUrl} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {trainerNombre}
              </p>
              <p style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'monospace', marginTop: 1 }}>
                ID: {qrValue || '—'}
              </p>
            </div>
          </div>

          {/* Código QR grande */}
          {qrValue ? (
            <div style={{
              background: '#fff', borderRadius: 14, padding: 14,
              width: '100%', display: 'flex', justifyContent: 'center',
            }}>
              <QRCodeSVG
                value={qrValue}
                size={280}
                level="M"
                includeMargin={false}
                style={{ width: '100%', height: 'auto', display: 'block', maxWidth: 280 }}
              />
            </div>
          ) : (
            <div style={{
              width: '100%', aspectRatio: '1 / 1',
              borderRadius: 14, background: 'var(--bg-3)', border: '1px dashed var(--line)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--text-3)', fontSize: 12, padding: 20, textAlign: 'center',
            }}>
              No hay sesión activa. Vuelve a iniciar sesión para generar el QR.
            </div>
          )}

          {/* Pasos */}
          <ol style={{
            margin: 0, paddingLeft: 18,
            fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6, alignSelf: 'stretch',
          }}>
            <li>El cliente abre la app <strong style={{ color: 'var(--text-1)' }}>mynoofit</strong></li>
            <li>Pulsa <strong style={{ color: 'var(--text-1)' }}>Vincular entrenador</strong> y permite la cámara</li>
            <li>Escanea este código y queda asociado a tu centro</li>
          </ol>

          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 12px', borderRadius: 10,
            background: 'rgba(45,212,168,0.08)', border: '1px solid rgba(45,212,168,0.2)',
            width: '100%',
          }}>
            <Smartphone size={13} style={{ color: 'var(--green)', flexShrink: 0 }} aria-hidden="true" />
            <p style={{ fontSize: 11, color: 'var(--green)', margin: 0, lineHeight: 1.4 }}>
              Tras escanear, el cliente aparecerá en la lista al refrescar.
            </p>
          </div>

        </Card>
      </aside>

      </div>
    </div>
  )
}
