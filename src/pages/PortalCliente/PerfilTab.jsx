import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  User, Mail, Briefcase, Tag, Clock, CheckCircle2, XCircle, AlertCircle, Send,
} from 'lucide-react'
import { usePortalAuth } from '../../contexts/PortalAuthContext'
import { miTrabajador, solicitarAltaTrabajador } from '../../utils/clienteApi'
import { getEntrenadores } from '../../utils/api'


export default function PerfilTab() {
  const { cliente, token, refresh } = usePortalAuth()
  const [estado, setEstado] = useState(null)     // { elegible, categorias, trabajador }
  const [loading, setLoading] = useState(true)
  const [showSolicitar, setShowSolicitar] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const d = await miTrabajador(token)
      setEstado(d)
    } catch { /* keep null */ }
    setLoading(false)
  }, [token])

  useEffect(() => { reload() }, [reload])

  if (!cliente) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 8 }}>
      {/* ── Card de identidad ──────────────────────────────────────────── */}
      <div style={{
        padding: '20px 18px', borderRadius: 16,
        background: 'var(--bg-1)', border: '1px solid var(--line)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: 'var(--gradient-primary, linear-gradient(135deg,#10b981,#059669))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <User size={24} color="#fff" />
          </div>
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--text-0)' }}>
              {cliente.nombre_completo || '—'}
            </p>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-3)' }}>
              ID NoofitPro · {cliente.cliente_idnoofit}
            </p>
          </div>
        </div>

        <Row icon={Mail} label="Email" value={cliente.email || '—'} />
        {cliente.categorias?.length > 0 && (
          <Row icon={Tag} label="Categorías" value={
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {cliente.categorias.map(c => (
                <span key={c} style={{
                  padding: '2px 10px', borderRadius: 999,
                  background: 'var(--green-bg, rgba(16,185,129,0.10))',
                  color: 'var(--green, #10b981)',
                  fontSize: 11, fontWeight: 600,
                }}>{c}</span>
              ))}
            </div>
          } />
        )}
      </div>

      {/* ── Card de Trabajo (solicitud / estado laboral) ───────────────── */}
      <SeccionTrabajo
        loading={loading}
        estado={estado}
        onSolicitar={() => setShowSolicitar(true)}
      />

      {showSolicitar && (
        <SolicitarModal
          onClose={() => setShowSolicitar(false)}
          onSent={async () => {
            setShowSolicitar(false)
            await reload()
            await refresh()    // refresca es_trabajador en el contexto
          }}
          token={token}
          trabajadorActual={estado?.trabajador}
        />
      )}
    </div>
  )
}


// ═══════════════════════════════════════════════════════════════════════════
// Sección Trabajo: lógica por estado
// ═══════════════════════════════════════════════════════════════════════════

function SeccionTrabajo({ loading, estado, onSolicitar }) {
  const navigate = useNavigate()
  if (loading) {
    return <TrabajoCard><p style={{ color: 'var(--text-3)' }}>Cargando situación laboral…</p></TrabajoCard>
  }
  if (!estado) {
    return <TrabajoCard><p style={{ color: 'var(--text-3)' }}>No se pudo cargar tu situación laboral.</p></TrabajoCard>
  }
  if (!estado.elegible) {
    return (
      <TrabajoCard>
        <Header icon={Briefcase} title="No eres trabajador en este centro"
          sub="Para poder solicitar el alta laboral en Round, tu manager debe asignarte la categoría 'Trabajador' en NoofitPro. Habla con él." />
      </TrabajoCard>
    )
  }
  const t = estado.trabajador

  // Sin solicitud aún
  if (!t) {
    return (
      <TrabajoCard>
        <Header icon={Briefcase} title="Eres elegible como trabajador"
          sub="Tu manager te ha asignado la categoría Trabajador. Para fichar tu jornada, envía la solicitud de alta laboral. Tu manager la revisará y la autorizará." />
        <BtnPrimary onClick={onSolicitar}>
          <Send size={16} /> Solicitar alta como trabajador
        </BtnPrimary>
      </TrabajoCard>
    )
  }

  // Estados del trabajador
  if (t.estado === 'pendiente_autorizacion' || t.estado === 'pendiente_alta') {
    return (
      <TrabajoCard color="amber">
        <Header icon={Clock} title="Solicitud enviada — esperando autorización"
          sub="Tu manager o trainer revisará pronto los datos y te activará. Te avisaremos cuando esté listo." />
        <DatosResumen t={t} />
      </TrabajoCard>
    )
  }
  if (t.estado === 'rechazada') {
    return (
      <TrabajoCard color="red">
        <Header icon={XCircle} title="Solicitud rechazada"
          sub="Tu manager no ha autorizado esta solicitud." />
        {t.rechazo_motivo && (
          <div style={{
            padding: 10, borderRadius: 8, marginBottom: 10,
            background: 'rgba(248,113,133,0.08)', fontSize: 13,
            border: '1px solid rgba(248,113,133,0.16)',
          }}>
            <strong>Motivo:</strong> {t.rechazo_motivo}
          </div>
        )}
        <BtnPrimary onClick={onSolicitar}>
          <Send size={16} /> Volver a solicitar
        </BtnPrimary>
      </TrabajoCard>
    )
  }
  if (t.estado === 'activo') {
    return (
      <TrabajoCard color="green">
        <Header icon={CheckCircle2} title="Trabajador activo"
          sub={`Empleado en el centro ${t.id_trainer_empleador} desde ${t.fecha_alta_laboral || '—'}.`} />
        <DatosResumen t={t} />
        <BtnPrimary onClick={() => navigate('/portal/fichar')}>
          <Clock size={16} /> Ir a fichar
        </BtnPrimary>
      </TrabajoCard>
    )
  }
  if (t.estado === 'baja') {
    return (
      <TrabajoCard color="gray">
        <Header icon={AlertCircle} title="Estás dado de baja"
          sub={`Tu alta como trabajador está cerrada desde ${t.fecha_baja_laboral || ''}. Contacta con tu manager si necesitas reactivarte.`} />
      </TrabajoCard>
    )
  }
  return null
}


function SolicitarModal({ onClose, onSent, token, trabajadorActual }) {
  const [form, setForm] = useState({
    nif:                  trabajadorActual?.nif || '',
    jornada_h_semana:     trabajadorActual?.jornada_h_semana || '40',
    id_trainer_empleador: trabajadorActual?.id_trainer_empleador || '',
    fecha_alta_esperada:  '',
    motivo:               '',
  })
  const [trainers, setTrainers] = useState([])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    getEntrenadores().then(setTrainers).catch(() => setTrainers([]))
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function handle(e) {
    e.preventDefault()
    setErr('')
    if (!form.nif.trim() || !form.jornada_h_semana || !form.id_trainer_empleador) {
      setErr('NIF, jornada y centro son obligatorios.'); return
    }
    setSaving(true)
    try {
      await solicitarAltaTrabajador(token, form)
      onSent()
    } catch (e) {
      setErr(e.body?.detalle || e.message || 'Error desconocido')
    } finally { setSaving(false) }
  }

  return (
    <div role="dialog" aria-modal="true" onClick={onClose}
         style={{
           position: 'fixed', inset: 0, zIndex: 100,
           background: 'rgba(0,0,0,0.6)',
           display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
           padding: 16,
         }}>
      <div onClick={e => e.stopPropagation()}
           style={{
             width: '100%', maxWidth: 480,
             background: 'var(--bg-1)', border: '1px solid var(--line)',
             borderRadius: 18, padding: 18,
             maxHeight: 'calc(100dvh - 32px)', overflowY: 'auto',
           }}>
        <p style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700 }}>
          Solicitar alta como trabajador
        </p>
        <p style={{ margin: '6px 0 16px', fontSize: 12, color: 'var(--text-3)' }}>
          Tu manager o trainer revisará estos datos. Si tiene dudas, te
          contactará antes de autorizar.
        </p>

        <form onSubmit={handle} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="NIF / NIE / Pasaporte">
            <input type="text" required value={form.nif}
                   onChange={e => set('nif', e.target.value.toUpperCase())}
                   style={input} />
          </Field>
          <Field label="Jornada habitual (horas / semana)">
            <input type="number" step="0.5" min="1" max="50" required
                   value={form.jornada_h_semana}
                   onChange={e => set('jornada_h_semana', e.target.value)}
                   style={input} />
          </Field>
          <Field label="Centro en el que trabajas (trainer)">
            <select required value={form.id_trainer_empleador}
                    onChange={e => set('id_trainer_empleador', e.target.value)}
                    style={input}>
              <option value="">— Elige tu centro —</option>
              {trainers.map(t => (
                <option key={t.id} value={t.id}>
                  {`${t.nombre || t.name || ''} ${t.apellidos || t.surname || ''}`.trim() || t.email}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Fecha estimada de incorporación (opcional)">
            <input type="date" value={form.fecha_alta_esperada}
                   onChange={e => set('fecha_alta_esperada', e.target.value)}
                   style={input} />
          </Field>
          <Field label="Comentario para tu manager (opcional)">
            <textarea rows={3} value={form.motivo}
                      onChange={e => set('motivo', e.target.value)}
                      style={{ ...input, resize: 'vertical', fontFamily: 'inherit' }} />
          </Field>

          {err && (
            <div role="alert" style={{
              padding: '10px 12px', borderRadius: 10,
              background: 'rgba(248,113,133,0.10)', color: 'var(--red, #f87171)',
              fontSize: 13,
            }}>
              {err}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose}
                    style={{ ...btnBase, background: 'transparent', color: 'var(--text-2)' }}>
              Cancelar
            </button>
            <button type="submit" disabled={saving}
                    style={{ ...btnBase, background: 'var(--green, #10b981)', color: '#fff' }}>
              {saving ? 'Enviando…' : 'Enviar solicitud'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}


// ═══════════════════════════════════════════════════════════════════════════
// Helpers UI
// ═══════════════════════════════════════════════════════════════════════════

const COLORS = {
  amber: { bg: 'rgba(245,158,11,0.06)',  border: 'rgba(245,158,11,0.25)', fg: '#f59e0b' },
  green: { bg: 'rgba(16,185,129,0.06)',  border: 'rgba(16,185,129,0.25)', fg: 'var(--green, #10b981)' },
  red:   { bg: 'rgba(248,113,133,0.06)', border: 'rgba(248,113,133,0.25)', fg: 'var(--red, #f87171)' },
  gray:  { bg: 'var(--bg-2)', border: 'var(--line)', fg: 'var(--text-3)' },
  none:  { bg: 'var(--bg-1)', border: 'var(--line)', fg: 'var(--text-2)' },
}

function TrabajoCard({ color = 'none', children }) {
  const c = COLORS[color] || COLORS.none
  return (
    <div style={{
      padding: '18px 18px', borderRadius: 16,
      background: c.bg, border: `1px solid ${c.border}`,
    }}>
      {children}
    </div>
  )
}

function Header({ icon: Icon, title, sub }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
      <Icon size={22} style={{ color: 'var(--text-2)', flexShrink: 0, marginTop: 2 }} />
      <div>
        <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text-0)' }}>
          {title}
        </p>
        {sub && (
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-3)', lineHeight: 1.5 }}>
            {sub}
          </p>
        )}
      </div>
    </div>
  )
}

function DatosResumen({ t }) {
  if (!t) return null
  return (
    <div style={{
      padding: '10px 12px', borderRadius: 10, marginBottom: 10,
      background: 'var(--bg-2)', fontSize: 13, color: 'var(--text-2)',
    }}>
      <div>NIF: <strong style={{ fontFamily: 'var(--font-mono)' }}>{t.nif || '—'}</strong></div>
      <div>Jornada: <strong>{t.jornada_h_semana ?? '—'} h/semana</strong></div>
      {t.id_trainer_empleador && <div>Trainer: <strong>{t.id_trainer_empleador}</strong></div>}
      {t.fecha_alta_laboral && <div>Alta: <strong>{t.fecha_alta_laboral}</strong></div>}
    </div>
  )
}

function Row({ icon: Icon, label, value }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 12,
      padding: '10px 0', borderTop: '1px solid var(--line)',
    }}>
      <Icon size={16} style={{ color: 'var(--text-3)', flexShrink: 0, marginTop: 2 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {label}
        </p>
        <div style={{ marginTop: 4, fontSize: 14, color: 'var(--text-0)' }}>
          {value}
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, color: 'var(--text-3)', fontWeight: 500 }}>
      {label}
      {children}
    </label>
  )
}

function BtnPrimary({ children, onClick }) {
  return (
    <button type="button" onClick={onClick}
            style={{
              ...btnBase, background: 'var(--green, #10b981)', color: '#fff',
              width: '100%', justifyContent: 'center',
            }}>
      {children}
    </button>
  )
}

const input = {
  width: '100%', padding: '10px 12px', borderRadius: 8,
  border: '1px solid var(--line)', background: 'var(--bg-0)',
  color: 'var(--text-0)', fontSize: 14, outline: 'none',
  boxSizing: 'border-box',
}
const btnBase = {
  display: 'inline-flex', alignItems: 'center', gap: 8,
  padding: '10px 16px', borderRadius: 10, border: 'none',
  fontSize: 14, fontWeight: 600, cursor: 'pointer',
}
