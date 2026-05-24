import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  User, Mail, Briefcase, Tag, Clock, CheckCircle2, XCircle, AlertCircle,
} from 'lucide-react'
import { usePortalAuth } from '../../contexts/PortalAuthContext'
import { miTrabajador } from '../../utils/clienteApi'


// Sección "Trabajo" en el perfil del cliente. INFORMATIVO: el alta como
// trabajador la inicia el manager o trainer desde la web admin. El cliente
// sólo ve aquí su situación.
export default function PerfilTab() {
  const { cliente, token } = usePortalAuth()
  const [estado, setEstado] = useState(null)
  const [loading, setLoading] = useState(true)

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
      {/* ── Card identidad ─────────────────────────────────────────────── */}
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

      {/* ── Card Trabajo (sólo estado, sin acción del cliente) ─────────── */}
      <SeccionTrabajo loading={loading} estado={estado} />
    </div>
  )
}


function SeccionTrabajo({ loading, estado }) {
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
        <Header icon={Briefcase} title="No estás dado de alta como trabajador"
          sub="Para fichar como empleado del centro, tu manager debe asignarte la categoría 'Trabajador' en NoofitPro y darte de alta laboral desde la web de gestión." />
      </TrabajoCard>
    )
  }
  const t = estado.trabajador

  if (!t || t.estado === 'pendiente_autorizacion' || t.estado === 'pendiente_alta') {
    return (
      <TrabajoCard color="amber">
        <Header icon={Clock} title="Pendiente de alta laboral"
          sub="Eres elegible como trabajador (tienes la categoría asignada), pero tu manager o trainer todavía no ha completado tu alta laboral. Hasta entonces no podrás fichar. Si tienes prisa, recuérdale que la complete desde Control horario → Trabajadores → Pendientes alta." />
        {t && <DatosResumen t={t} />}
      </TrabajoCard>
    )
  }
  if (t.estado === 'rechazada') {
    return (
      <TrabajoCard color="red">
        <Header icon={XCircle} title="Alta no autorizada"
          sub="Tu manager no ha autorizado tu alta como trabajador. Habla con él si crees que es un error." />
        {t.rechazo_motivo && (
          <div style={{
            padding: 10, borderRadius: 8, marginBottom: 10,
            background: 'rgba(248,113,133,0.08)', fontSize: 13,
            border: '1px solid rgba(248,113,133,0.16)',
          }}>
            <strong>Motivo:</strong> {t.rechazo_motivo}
          </div>
        )}
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


// ═══════════════════════════════════════════════════════════════════════════
// Helpers UI
// ═══════════════════════════════════════════════════════════════════════════

const COLORS = {
  amber: { bg: 'rgba(245,158,11,0.06)',  border: 'rgba(245,158,11,0.25)' },
  green: { bg: 'rgba(16,185,129,0.06)',  border: 'rgba(16,185,129,0.25)' },
  red:   { bg: 'rgba(248,113,133,0.06)', border: 'rgba(248,113,133,0.25)' },
  gray:  { bg: 'var(--bg-2)',            border: 'var(--line)' },
  none:  { bg: 'var(--bg-1)',            border: 'var(--line)' },
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
      {t.nif && <div>NIF: <strong style={{ fontFamily: 'var(--font-mono)' }}>{t.nif}</strong></div>}
      {t.jornada_h_semana != null && <div>Jornada: <strong>{t.jornada_h_semana} h/semana</strong></div>}
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

function BtnPrimary({ children, onClick }) {
  return (
    <button type="button" onClick={onClick}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '10px 16px', borderRadius: 10, border: 'none',
              background: 'var(--green, #10b981)', color: '#fff',
              fontSize: 14, fontWeight: 600, cursor: 'pointer',
              width: '100%', justifyContent: 'center',
            }}>
      {children}
    </button>
  )
}
