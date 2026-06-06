import { useState, useEffect, useCallback } from 'react'
import { LogIn, LogOut, Coffee, PlayCircle, AlertCircle, MapPin, ChevronDown, ChevronUp, Loader2, Target } from 'lucide-react'
import { usePortalAuth } from '../../contexts/PortalAuthContext'
import { fichajeEstado, fichajePost, fichajeMiJornada, miHorario } from '../../utils/clienteApi'


// Motivos de pausa por defecto (hasta que el endpoint público con JWT de
// cliente esté disponible). Coinciden con los sembrados en backend.
const MOTIVOS_PAUSA = [
  { id: null,             codigo: 'comida',          etiqueta: 'Comida' },
  { id: null,             codigo: 'descanso_corto',  etiqueta: 'Descanso corto / café' },
  { id: null,             codigo: 'descanso_obligat',etiqueta: 'Descanso obligatorio' },
  { id: null,             codigo: 'medico',          etiqueta: 'Asuntos médicos' },
  { id: null,             codigo: 'personal',        etiqueta: 'Asuntos personales' },
  { id: null,             codigo: 'otros',           etiqueta: 'Otros' },
]


export default function FicharTab() {
  const { token, cliente } = usePortalAuth()
  const [estado, setEstado] = useState(null)        // {estado, ultimo_evento, pausa_motivo_id}
  const [jornada, setJornada] = useState(null)
  const [horario, setHorario] = useState(null)      // horario teórico {1:[...], ..., 7:[...]}
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [showPausa, setShowPausa] = useState(false)
  const [showJornada, setShowJornada] = useState(false)
  const [pendingQrToken, setPendingQrToken] = useState(null)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [e, j, h] = await Promise.all([
        fichajeEstado(token),
        fichajeMiJornada(token).catch(() => null),
        miHorario(token).catch(() => null),
      ])
      setEstado(e)
      setJornada(j)
      setHorario(h)
    } catch (e) {
      setError(traduce(e))
    } finally { setLoading(false) }
  }, [token])

  useEffect(() => { reload() }, [reload])

  async function send(tipo, extra = {}) {
    if (busy) return
    setBusy(true); setError(''); setInfo('')
    try {
      const body = { tipo, origen: 'web', ...extra }
      if (pendingQrToken) body.qr_token = pendingQrToken
      const r = await fichajePost(token, body)
      setPendingQrToken(null)
      const verif = r.evento?.verificacion_ubicacion === 'QR'
        ? '· verificado por QR' : '· sin verificación'
      setInfo(`${tipoLabel(tipo)} registrado ${verif}`)
      await reload()
    } catch (e) {
      setError(traduce(e))
    } finally { setBusy(false) }
  }

  if (loading) {
    return (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <Loader2 className="animate-spin" size={28} style={{ color: 'var(--green)' }} />
      </div>
    )
  }

  if (!estado) {
    return (
      <Banner kind="error">
        No se pudo cargar tu estado.
        {error && <div style={{ marginTop: 6, fontSize: 12 }}>{error}</div>}
      </Banner>
    )
  }

  const st = estado.estado  // 'fuera' | 'dentro' | 'en_pausa'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 8 }}>

      {/* ── Estado actual (grande, visible de un vistazo) ─────────────── */}
      <EstadoBlock estado={st} ultimo={estado.ultimo_evento} />

      {/* ── Progreso de la jornada de hoy (si tiene horario teórico) ─── */}
      <ProgresoHoy horario={horario} trabajoSeg={jornada?.total_trabajo_seg || 0} />

      {/* ── Mensajes flash ─────────────────────────────────────────────── */}
      {info && <Banner kind="ok" onClose={() => setInfo('')}>{info}</Banner>}
      {error && <Banner kind="error" onClose={() => setError('')}>{traduce(error)}</Banner>}
      {pendingQrToken && (
        <Banner kind="info">
          QR detectado · se enviará con tu próximo fichaje.{' '}
          <button onClick={() => setPendingQrToken(null)}
                  style={{ background: 'none', border: 'none', color: 'var(--green)', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>
            descartar
          </button>
        </Banner>
      )}

      {/* ── Botón principal grande (cambia según estado) ──────────────── */}
      <PrimaryAction estado={st} busy={busy} onClick={tipo => send(tipo)} />

      {/* ── Acciones secundarias ──────────────────────────────────────── */}
      {st === 'dentro' && (
        <SecondaryButton onClick={() => setShowPausa(true)} disabled={busy}>
          <Coffee size={18} /> Iniciar pausa
        </SecondaryButton>
      )}
      {st === 'en_pausa' && (
        <SecondaryButton onClick={() => send('PAUSA_FIN')} disabled={busy}>
          <PlayCircle size={18} /> Finalizar pausa
        </SecondaryButton>
      )}

      {/* ── Escanear QR (placeholder Fase 1 — abre cámara si HTTPS) ───── */}
      <QrScannerInline onScan={t => { setPendingQrToken(t); setInfo('QR cargado') }} />

      {/* ── Jornada del día (colapsable) ───────────────────────────────── */}
      <JornadaResumen jornada={jornada} open={showJornada} onToggle={() => setShowJornada(o => !o)} />

      {/* ── Modal Pausa motivo ─────────────────────────────────────────── */}
      {showPausa && (
        <ModalMotivoPausa
          onClose={() => setShowPausa(false)}
          onSend={async (motivoCodigo) => {
            setShowPausa(false)
            // Necesitamos un pausa_motivo_id (PK). Como el endpoint público
            // está pendiente, mandamos el codigo en motivo y dejamos que
            // backend lo rechace si no encuentra. TODO Fase 1.1.
            await send('PAUSA_INI', { motivo_pausa_codigo: motivoCodigo })
          }}
        />
      )}
    </div>
  )
}


// ═══════════════════════════════════════════════════════════════════════════
// Componentes auxiliares
// ═══════════════════════════════════════════════════════════════════════════

function EstadoBlock({ estado, ultimo }) {
  const map = {
    fuera:    { label: 'FUERA',     color: 'var(--text-3)',          bg: 'var(--bg-2)' },
    dentro:   { label: 'DENTRO',    color: 'var(--green, #10b981)',  bg: 'rgba(16,185,129,0.10)' },
    en_pausa: { label: 'EN PAUSA',  color: '#f59e0b',                bg: 'rgba(245,158,11,0.12)' },
  }
  const cfg = map[estado] || map.fuera
  return (
    <div style={{
      padding: '20px 18px', borderRadius: 18,
      background: cfg.bg, textAlign: 'center',
      border: `1px solid ${cfg.color}33`,
    }}>
      <p style={{
        margin: 0, fontSize: 11, color: 'var(--text-3)',
        textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600,
      }}>
        Tu estado ahora
      </p>
      <p style={{
        margin: '8px 0 0', fontFamily: 'var(--font-display, Outfit)',
        fontSize: 32, fontWeight: 800, letterSpacing: '0.04em',
        color: cfg.color,
      }}>
        {cfg.label}
      </p>
      {ultimo && (
        <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-3)' }}>
          Último: {tipoLabel(ultimo.tipo)} · {fmtHora(ultimo.ts_evento)}
        </p>
      )}
    </div>
  )
}


function PrimaryAction({ estado, busy, onClick }) {
  const cfg = {
    fuera:    { tipo: 'ENTRADA', label: 'Marcar ENTRADA', icon: LogIn,  color: 'var(--green, #10b981)' },
    dentro:   { tipo: 'SALIDA',  label: 'Marcar SALIDA',  icon: LogOut, color: 'var(--red, #f87171)' },
    en_pausa: { tipo: 'SALIDA',  label: 'Marcar SALIDA (cierra pausa)', icon: LogOut, color: 'var(--red, #f87171)' },
  }
  const c = cfg[estado] || cfg.fuera
  const Icon = c.icon
  return (
    <button
      onClick={() => onClick(c.tipo)}
      disabled={busy}
      style={{
        width: '100%',
        minHeight: 88,
        padding: '20px',
        borderRadius: 18,
        border: 'none',
        background: c.color,
        color: '#fff',
        fontSize: 22, fontWeight: 800,
        fontFamily: 'var(--font-display, Outfit)',
        cursor: busy ? 'wait' : 'pointer',
        opacity: busy ? 0.7 : 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14,
        letterSpacing: '0.03em',
        boxShadow: `0 8px 24px ${c.color}33`,
        transition: 'transform 0.1s',
      }}
      onTouchStart={e => e.currentTarget.style.transform = 'scale(0.98)'}
      onTouchEnd={e => e.currentTarget.style.transform = 'scale(1)'}
    >
      {busy ? <Loader2 className="animate-spin" size={26} /> : <Icon size={26} />}
      {c.label}
    </button>
  )
}


function SecondaryButton({ children, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled}
            style={{
              width: '100%', padding: '14px 18px',
              borderRadius: 12, border: '1px solid var(--line)',
              background: 'var(--bg-1)', color: 'var(--text-1)',
              fontSize: 15, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.5 : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            }}>
      {children}
    </button>
  )
}


function Banner({ kind, children, onClose }) {
  const colors = {
    ok:    { bg: 'rgba(16,185,129,0.10)',  fg: 'var(--green, #10b981)' },
    error: { bg: 'rgba(248,113,133,0.10)', fg: 'var(--red, #f87171)' },
    info:  { bg: 'rgba(59,130,246,0.10)',  fg: '#60a5fa' },
  }
  const c = colors[kind] || colors.info
  return (
    <div role="alert" style={{
      padding: '12px 14px', borderRadius: 12,
      background: c.bg, color: c.fg, fontSize: 13,
      display: 'flex', alignItems: 'flex-start', gap: 10,
    }}>
      <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
      <div style={{ flex: 1 }}>{children}</div>
      {onClose && (
        <button onClick={onClose} aria-label="cerrar" style={{
          background: 'none', border: 'none', color: c.fg, cursor: 'pointer', padding: 0,
        }}>×</button>
      )}
    </div>
  )
}


function JornadaResumen({ jornada, open, onToggle }) {
  if (!jornada) return null
  // Formato adaptativo: <1 min muestra segundos; <1 h muestra mm:ss; resto Xh YYm.
  const horas = (s) => {
    s = Math.max(0, Math.floor(s || 0))
    if (s < 60)   return `${s}s`
    if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
    return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
  }
  return (
    <div style={{
      borderRadius: 12, border: '1px solid var(--line)',
      background: 'var(--bg-1)', overflow: 'hidden',
    }}>
      <button onClick={onToggle}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '14px 16px',
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text-1)', fontSize: 14, fontWeight: 600,
              }}>
        <span>Mi jornada de hoy · trabajo {horas(jornada.total_trabajo_seg || 0)}</span>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {open && (
        <div style={{ padding: '0 16px 14px' }}>
          {jornada.eventos?.length === 0 && (
            <p style={{ fontSize: 13, color: 'var(--text-3)', margin: 0 }}>
              Sin eventos hoy todavía.
            </p>
          )}
          {jornada.eventos?.map(e => (
            <div key={e.id} style={{
              padding: '8px 0', borderTop: '1px solid var(--line)',
              fontSize: 13, color: 'var(--text-2)',
              display: 'flex', justifyContent: 'space-between',
            }}>
              <span>{tipoLabel(e.tipo)}</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>
                {fmtHora(e.ts_evento)}
                {e.verificacion_ubicacion === 'QR' && (
                  <MapPin size={11} style={{ marginLeft: 4, verticalAlign: 'middle', color: 'var(--green)' }} />
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}


function QrScannerInline({ onScan }) {
  // Placeholder de scanner. La integración real con cámara está pendiente
  // (Fase 1.x). De momento permite pegar el contenido del QR a mano para
  // poder probar el flujo verificado-en-centro.
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
              style={{
                width: '100%', padding: '12px 14px',
                borderRadius: 12, border: '1px dashed var(--line)',
                background: 'transparent', color: 'var(--text-3)',
                fontSize: 13, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}>
        <MapPin size={14} /> Pegar QR del centro (opcional)
      </button>
    )
  }
  return (
    <div style={{
      padding: 14, borderRadius: 12, border: '1px solid var(--line)',
      background: 'var(--bg-1)',
    }}>
      <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 8px' }}>
        Pega aquí el contenido del QR (el largo "eyJhbGc…"). Próximamente,
        scanner con la cámara.
      </p>
      <textarea value={value} onChange={e => setValue(e.target.value)}
                rows={3} placeholder="eyJhbGciOiJIUzI1NiIs…"
                style={{
                  width: '100%', padding: 10, borderRadius: 8,
                  border: '1px solid var(--line)', background: 'var(--bg-0)',
                  color: 'var(--text-1)', fontSize: 12, fontFamily: 'var(--font-mono)',
                  outline: 'none', boxSizing: 'border-box', resize: 'vertical',
                }} />
      <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
        <button onClick={() => setOpen(false)}
                style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--line)',
                         background: 'transparent', color: 'var(--text-2)', cursor: 'pointer', fontSize: 12 }}>
          Cancelar
        </button>
        <button onClick={() => { onScan(value.trim()); setOpen(false); setValue('') }}
                disabled={!value.trim()}
                style={{ padding: '8px 14px', borderRadius: 8, border: 'none',
                         background: 'var(--green)', color: '#fff', cursor: 'pointer', fontSize: 12,
                         opacity: value.trim() ? 1 : 0.5 }}>
          Cargar
        </button>
      </div>
    </div>
  )
}


function ModalMotivoPausa({ onClose, onSend }) {
  return (
    <div role="dialog" aria-modal="true"
         onClick={onClose}
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
             borderRadius: 18, padding: 16,
           }}>
        <p style={{
          margin: '0 0 12px', fontSize: 15, fontWeight: 600, color: 'var(--text-0)',
        }}>
          ¿Motivo de la pausa?
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {MOTIVOS_PAUSA.map(m => (
            <button key={m.codigo}
                    onClick={() => onSend(m.codigo)}
                    style={{
                      padding: '14px 16px', borderRadius: 12,
                      border: '1px solid var(--line)', background: 'var(--bg-2)',
                      color: 'var(--text-0)', fontSize: 15, fontWeight: 500,
                      textAlign: 'left', cursor: 'pointer',
                    }}>
              {m.etiqueta}
            </button>
          ))}
        </div>
        <button onClick={onClose}
                style={{
                  marginTop: 12, width: '100%', padding: 12,
                  borderRadius: 12, border: 'none',
                  background: 'transparent', color: 'var(--text-3)',
                  fontSize: 13, cursor: 'pointer',
                }}>
          Cancelar
        </button>
      </div>
    </div>
  )
}


function fmtHora(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  } catch { return iso }
}

function tipoLabel(t) {
  return ({
    ENTRADA: 'Entrada', SALIDA: 'Salida',
    PAUSA_INI: 'Inicio pausa', PAUSA_FIN: 'Fin pausa',
    CORRECCION_INSERT: 'Corrección', CORRECCION_ANULAR: 'Anulación',
  })[t] || t
}

// ═══════════════════════════════════════════════════════════════════════════
// Progreso jornada teórica de hoy (real vs esperado)
// ═══════════════════════════════════════════════════════════════════════════

function ProgresoHoy({ horario, trabajoSeg }) {
  if (!horario) return null
  const isoDow = getISODow(new Date())   // 1=lun ... 7=dom
  const franjasHoy = (horario[String(isoDow)] || []).filter(f => f.tipo === 'trabajo')
  if (franjasHoy.length === 0) {
    // No tiene horario teórico hoy
    return (
      <div style={{
        padding: '10px 14px', borderRadius: 12,
        background: 'var(--bg-1)', border: '1px solid var(--line)',
        fontSize: 12, color: 'var(--text-3)', textAlign: 'center',
      }}>
        Hoy no tienes jornada teórica programada — descanso.
      </div>
    )
  }
  const minTeorico = franjasHoy.reduce((a, f) => a + minutosFranja(f.hora_inicio, f.hora_fin), 0)
  const minReal = Math.floor((trabajoSeg || 0) / 60)
  const pct = Math.min(100, Math.round((minReal / minTeorico) * 100))

  const color = pct >= 100 ? 'var(--green, #10b981)'
              : pct >= 50  ? '#f59e0b'
              : 'var(--text-2)'

  return (
    <div style={{
      padding: '14px 16px', borderRadius: 14,
      background: 'var(--bg-1)', border: '1px solid var(--line)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, marginBottom: 8 }}>
        <div>
          <p style={{ margin: 0, fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
            <Target size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} />
            Jornada de hoy
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 18, fontWeight: 700, color: 'var(--text-0)' }}>
            <span style={{ color }}>{fmtMinHM(minReal)}</span>
            <span style={{ color: 'var(--text-3)', fontWeight: 500, fontSize: 13 }}> / {fmtMinHM(minTeorico)}</span>
          </p>
          <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-3)' }}>
            Horario teórico: {franjasHoy.map(f => `${f.hora_inicio}–${f.hora_fin}`).join(' · ')}
          </p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <p style={{
            margin: 0, fontFamily: 'var(--font-display, Outfit)',
            fontSize: 32, fontWeight: 700, color,
            lineHeight: 1,
          }}>
            {pct}%
          </p>
          <p style={{ margin: '2px 0 0', fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            completado
          </p>
        </div>
      </div>
      <div style={{
        height: 8, borderRadius: 999, overflow: 'hidden',
        background: 'var(--bg-3)',
      }}>
        <div style={{
          height: '100%', width: `${pct}%`,
          background: color,
          transition: 'width 0.4s ease',
        }} />
      </div>
    </div>
  )
}


function getISODow(d) {
  const js = d.getDay()
  return js === 0 ? 7 : js
}
function minutosFranja(hi, hf) {
  if (!hi || !hf) return 0
  const [h1, m1] = hi.split(':').map(Number)
  const [h2, m2] = hf.split(':').map(Number)
  return Math.max(0, (h2 * 60 + m2) - (h1 * 60 + m1))
}
function fmtMinHM(mins) {
  mins = Math.max(0, Math.floor(mins || 0))
  if (mins === 0) return '0h'
  const h = Math.floor(mins / 60); const m = mins % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${String(m).padStart(2, '0')}m`
}


function traduce(e) {
  const code = typeof e === 'string' ? e : (e?.body?.error || e?.message || '')
  const map = {
    transicion_invalida:  'No puedes hacer esa acción desde tu estado actual.',
    feature_not_enabled:  'Tu centro no tiene activado el control horario.',
    trabajador_baja:      'Tu cuenta de trabajador está dada de baja.',
    no_eres_trabajador:   'Tu cuenta no es de trabajador en este centro.',
    invalid_token:        'Tu sesión ha caducado. Vuelve a entrar.',
    missing_token:        'Tu sesión ha caducado. Vuelve a entrar.',
    pausa_motivo_requerido: 'Indica el motivo de la pausa.',
  }
  return map[code] || code || 'Error desconocido'
}
