import { useState, useEffect, useCallback } from 'react'
import {
  Calendar, Sun, Coffee, Stethoscope, CalendarRange, Send, X, Plus,
  Loader2, CheckCircle2, XCircle, Clock,
} from 'lucide-react'
import { usePortalAuth } from '../../contexts/PortalAuthContext'
import { misAusencias, solicitarAusencia, cancelarAusencia } from '../../utils/clienteApi'
import { useOverlayClose } from '../../hooks/useOverlayClose'


const TIPOS = [
  { id: 'vacaciones',         label: 'Vacaciones',          icon: Sun },
  { id: 'asuntos_propios',    label: 'Asuntos propios',      icon: CalendarRange },
  { id: 'medico',             label: 'Médico',               icon: Stethoscope },
  { id: 'personal',           label: 'Personal',             icon: Coffee },
  { id: 'baja_medica',        label: 'Baja médica',          icon: Stethoscope },
  { id: 'permiso_retribuido', label: 'Permiso retribuido',   icon: CalendarRange },
  { id: 'otros',              label: 'Otros',                icon: Coffee },
]
const TIPO_MAP = Object.fromEntries(TIPOS.map(t => [t.id, t]))


export default function AusenciasTab() {
  const { token } = usePortalAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showSolicitar, setShowSolicitar] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true); setError('')
    try { setData(await misAusencias(token)) }
    catch (e) { setError(traduce(e)); setData(null) }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => { reload() }, [reload])

  async function handleCancelar(s) {
    if (!confirm('¿Cancelar esta solicitud?')) return
    try {
      await cancelarAusencia(token, s.id)
      reload()
    } catch (e) {
      alert('No se pudo cancelar: ' + (e.body?.error || e.message))
    }
  }

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}>
      <Loader2 size={26} className="animate-spin" style={{ color: 'var(--green)' }} />
    </div>
  )
  if (error) return <Banner kind="error">{error}</Banner>
  if (!data) return null

  const saldo = data.saldo || {}

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <h1 style={{
          margin: 0, fontFamily: 'var(--font-display, Outfit)',
          fontSize: 22, fontWeight: 700, color: 'var(--text-0)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <Calendar size={22} style={{ color: 'var(--green)' }} />
          Mis ausencias
        </h1>
        <button onClick={() => setShowSolicitar(true)} style={primaryBtn}>
          <Plus size={14} /> Solicitar
        </button>
      </div>

      {/* ── Saldo ─────────────────────────────────────────────────── */}
      {saldo.ok && (
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <SaldoCard label="Vacaciones disponibles"
                     disp={saldo.vacaciones.disponibles}
                     total={saldo.vacaciones.total}
                     aprob={saldo.vacaciones.aprobadas}
                     pend={saldo.vacaciones.pendientes}
                     tipo={saldo.vacaciones.tipo}
                     ano={saldo.ano} color="green" />
          {saldo.asuntos_propios.total > 0 && (
            <SaldoCard label="Asuntos propios"
                       disp={saldo.asuntos_propios.disponibles}
                       total={saldo.asuntos_propios.total}
                       aprob={saldo.asuntos_propios.aprobadas}
                       pend={saldo.asuntos_propios.pendientes}
                       ano={saldo.ano} color="purple" />
          )}
        </div>
      )}

      {/* ── Listado ───────────────────────────────────────────────── */}
      {data.solicitudes.length === 0 ? (
        <div style={{
          padding: '28px 18px', borderRadius: 14,
          background: 'var(--bg-1)', border: '1px dashed var(--line)',
          textAlign: 'center', color: 'var(--text-3)',
        }}>
          Aún no has solicitado ninguna ausencia.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.solicitudes.map(s => (
            <SolicitudCard key={s.id} s={s} onCancelar={handleCancelar} />
          ))}
        </div>
      )}

      {showSolicitar && (
        <SolicitarModal
          token={token}
          saldo={saldo}
          onClose={() => setShowSolicitar(false)}
          onSent={() => { setShowSolicitar(false); reload() }} />
      )}
    </div>
  )
}


// ═══════════════════════════════════════════════════════════════════════════
// Componentes
// ═══════════════════════════════════════════════════════════════════════════

function SaldoCard({ label, disp, total, aprob, pend, tipo, ano, color }) {
  const fg = color === 'green' ? 'var(--green, #10b981)'
           : color === 'purple' ? '#a78bfa' : 'var(--text-0)'
  const bg = color === 'green' ? 'rgba(16,185,129,0.08)'
           : color === 'purple' ? 'rgba(167,139,250,0.08)' : 'var(--bg-1)'
  return (
    <div style={{
      padding: '14px 16px', borderRadius: 14,
      background: bg, border: `1px solid ${fg}33`,
    }}>
      <p style={{ margin: 0, fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
        {label}
      </p>
      <p style={{ margin: '8px 0 4px', fontFamily: 'var(--font-display, Outfit)', fontSize: 30, fontWeight: 700, color: fg, lineHeight: 1 }}>
        {disp}<span style={{ fontSize: 14, color: 'var(--text-3)', fontWeight: 500 }}> / {total}</span>
      </p>
      <p style={{ margin: 0, fontSize: 11, color: 'var(--text-3)' }}>
        días {tipo === 'laborales' ? 'laborales' : tipo === 'naturales' ? 'naturales' : ''} {ano}
      </p>
      {(aprob > 0 || pend > 0) && (
        <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-3)' }}>
          {aprob > 0 && <>{aprob} aprob.</>}
          {aprob > 0 && pend > 0 && ' · '}
          {pend > 0 && <span style={{ color: '#f59e0b' }}>{pend} pendiente{pend !== 1 ? 's' : ''}</span>}
        </p>
      )}
    </div>
  )
}


function SolicitudCard({ s, onCancelar }) {
  const cfg = TIPO_MAP[s.tipo] || TIPO_MAP.otros
  const Icon = cfg.icon
  const dias = s.jornada_completa ? diasEntre(s.fecha_desde, s.fecha_hasta) : '½'
  return (
    <div style={{
      padding: 14, borderRadius: 12,
      background: 'var(--bg-1)', border: '1px solid var(--line)',
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{
        width: 38, height: 38, borderRadius: 10,
        background: estadoBg(s.estado),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: estadoFg(s.estado),
        flexShrink: 0,
      }}>
        <EstadoIcon estado={s.estado} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text-0)' }}>
          <Icon size={13} style={{ verticalAlign: '-2px', marginRight: 4, color: 'var(--text-2)' }} />
          {cfg.label}
        </p>
        <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-2)' }}>
          <strong>{fmtDate(s.fecha_desde)}</strong>
          {s.fecha_hasta !== s.fecha_desde && <> → <strong>{fmtDate(s.fecha_hasta)}</strong></>}
          {!s.jornada_completa && <> ({s.hora_desde}–{s.hora_hasta})</>}
          <span style={{ marginLeft: 8, color: 'var(--text-3)' }}>· {dias} día{dias === 1 ? '' : 's'}</span>
        </p>
        {s.motivo_trabajador && (
          <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-3)', fontStyle: 'italic' }}>
            "{s.motivo_trabajador}"
          </p>
        )}
        {s.estado === 'rechazada' && s.motivo_resolucion && (
          <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--red, #f87171)' }}>
            Motivo: {s.motivo_resolucion}
          </p>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
        <span style={{
          padding: '3px 10px', borderRadius: 999,
          fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
          background: estadoBg(s.estado), color: estadoFg(s.estado),
        }}>
          {s.estado}
        </span>
        {s.estado === 'pendiente' && (
          <button onClick={() => onCancelar(s)} style={cancelBtn}>
            Cancelar
          </button>
        )}
      </div>
    </div>
  )
}


function SolicitarModal({ token, saldo, onClose, onSent }) {
  const [form, setForm] = useState({
    tipo: 'vacaciones',
    fecha_desde: '',
    fecha_hasta: '',
    jornada_completa: true,
    hora_desde: '09:00',
    hora_hasta: '11:00',
    motivo_trabajador: '',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const overlayClose = useOverlayClose(onClose)

  // Autoajusta fecha_hasta = fecha_desde si está vacía
  function setDesde(v) {
    setForm(f => ({ ...f, fecha_desde: v, fecha_hasta: f.fecha_hasta || v }))
  }

  async function handle(e) {
    e.preventDefault(); setErr('')
    if (!form.fecha_desde || !form.fecha_hasta) {
      setErr('Indica las fechas.'); return
    }
    if (!form.jornada_completa && form.fecha_desde !== form.fecha_hasta) {
      setErr('Una ausencia parcial debe ser el mismo día.'); return
    }
    setSaving(true)
    try {
      await solicitarAusencia(token, form)
      onSent()
    } catch (e) {
      setErr(e.body?.detalle || e.body?.error || e.message || 'Error')
    } finally { setSaving(false) }
  }

  return (
    <div role="dialog" aria-modal="true" {...overlayClose}
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
        <p style={{ margin: 0, fontFamily: 'var(--font-display, Outfit)', fontSize: 18, fontWeight: 700 }}>
          Solicitar ausencia
        </p>
        <p style={{ margin: '4px 0 14px', fontSize: 12, color: 'var(--text-3)' }}>
          Tu manager o trainer revisará la solicitud y te avisará.
        </p>

        <form onSubmit={handle} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Tipo">
            <select required value={form.tipo}
                    onChange={e => set('tipo', e.target.value)}
                    style={input}>
              {TIPOS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </Field>

          <Field label="Duración">
            <div style={{ display: 'flex', gap: 6 }}>
              <SegBtn active={form.jornada_completa}
                      onClick={() => set('jornada_completa', true)}>
                Día(s) completo(s)
              </SegBtn>
              <SegBtn active={!form.jornada_completa}
                      onClick={() => {
                        // Al pasar a "por horas" forzamos un solo día
                        setForm(f => ({
                          ...f, jornada_completa: false,
                          fecha_hasta: f.fecha_desde || f.fecha_hasta,
                        }))
                      }}>
                Por horas (mismo día)
              </SegBtn>
            </div>
          </Field>

          {form.jornada_completa ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="Desde">
                <input type="date" required value={form.fecha_desde}
                       onChange={e => setDesde(e.target.value)} style={input} />
              </Field>
              <Field label="Hasta">
                <input type="date" required value={form.fecha_hasta}
                       onChange={e => set('fecha_hasta', e.target.value)}
                       style={input} />
              </Field>
            </div>
          ) : (
            <>
              <Field label="Día">
                <input type="date" required value={form.fecha_desde}
                       onChange={e => setForm(f => ({ ...f, fecha_desde: e.target.value, fecha_hasta: e.target.value }))}
                       style={input} />
              </Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Field label="Hora desde">
                  <input type="time" required value={form.hora_desde}
                         onChange={e => set('hora_desde', e.target.value)} style={input} />
                </Field>
                <Field label="Hora hasta">
                  <input type="time" required value={form.hora_hasta}
                         onChange={e => set('hora_hasta', e.target.value)} style={input} />
                </Field>
              </div>
            </>
          )}
          <Field label="Comentario para tu manager (opcional)">
            <textarea rows={2} value={form.motivo_trabajador}
                      onChange={e => set('motivo_trabajador', e.target.value)}
                      style={{ ...input, resize: 'vertical', fontFamily: 'inherit' }} />
          </Field>

          {err && (
            <div role="alert" style={{
              padding: '10px 12px', borderRadius: 10,
              background: 'rgba(248,113,133,0.10)', color: 'var(--red, #f87171)',
              fontSize: 13,
            }}>{err}</div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose}
                    style={{ ...btnBase, background: 'transparent', color: 'var(--text-2)' }}>
              Cancelar
            </button>
            <button type="submit" disabled={saving}
                    style={{ ...btnBase, background: 'var(--green, #10b981)', color: '#fff' }}>
              <Send size={14} style={{ verticalAlign: '-2px' }} /> {saving ? 'Enviando…' : 'Enviar solicitud'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}


function EstadoIcon({ estado }) {
  if (estado === 'aprobada') return <CheckCircle2 size={18} />
  if (estado === 'rechazada') return <XCircle size={18} />
  if (estado === 'cancelada') return <X size={18} />
  return <Clock size={18} />
}


function Banner({ kind, children }) {
  const bg = kind === 'error' ? 'rgba(248,113,133,0.10)' : 'rgba(59,130,246,0.10)'
  const fg = kind === 'error' ? 'var(--red, #f87171)' : '#60a5fa'
  return (
    <div role="alert" style={{
      padding: '10px 14px', borderRadius: 10,
      background: bg, color: fg, fontSize: 13,
    }}>{children}</div>
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

function SegBtn({ active, children, onClick }) {
  return (
    <button type="button" onClick={onClick}
            style={{
              flex: 1, padding: '10px 12px', borderRadius: 10,
              border: active ? '1px solid var(--green, #10b981)' : '1px solid var(--line)',
              background: active ? 'var(--green-bg, rgba(16,185,129,0.10))' : 'var(--bg-0)',
              color: active ? 'var(--green, #10b981)' : 'var(--text-2)',
              fontSize: 13, fontWeight: active ? 700 : 500,
              cursor: 'pointer',
            }}>
      {children}
    </button>
  )
}


function estadoBg(e) {
  return ({
    pendiente:  'rgba(245,158,11,0.10)',
    aprobada:   'rgba(16,185,129,0.10)',
    rechazada:  'rgba(248,113,133,0.10)',
    cancelada:  'var(--bg-3)',
  })[e] || 'var(--bg-3)'
}
function estadoFg(e) {
  return ({
    pendiente:  '#f59e0b',
    aprobada:   'var(--green, #10b981)',
    rechazada:  'var(--red, #f87171)',
    cancelada:  'var(--text-3)',
  })[e] || 'var(--text-3)'
}


function fmtDate(iso) {
  if (!iso) return '—'
  try { return new Date(iso + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }) }
  catch { return iso }
}
function diasEntre(d1, d2) {
  try {
    const a = new Date(d1 + 'T00:00:00')
    const b = new Date(d2 + 'T00:00:00')
    return Math.round((b - a) / 86400000) + 1
  } catch { return 1 }
}
function traduce(e) {
  const code = typeof e === 'string' ? e : (e?.body?.error || e?.message || '')
  return code || 'Error desconocido'
}


const input = {
  width: '100%', padding: '10px 12px', borderRadius: 8,
  border: '1px solid var(--line)', background: 'var(--bg-0)',
  color: 'var(--text-0)', fontSize: 14, outline: 'none',
  boxSizing: 'border-box',
}
const btnBase = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '10px 16px', borderRadius: 10, border: 'none',
  fontSize: 14, fontWeight: 600, cursor: 'pointer',
}
const primaryBtn = {
  ...btnBase,
  background: 'var(--green, #10b981)', color: '#fff',
}
const cancelBtn = {
  padding: '4px 10px', borderRadius: 6, border: '1px solid var(--line)',
  background: 'transparent', color: 'var(--text-3)',
  fontSize: 11, cursor: 'pointer',
}
