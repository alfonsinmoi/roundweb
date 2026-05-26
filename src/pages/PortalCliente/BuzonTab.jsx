import { useState, useEffect, useCallback } from 'react'
import { Bell, MessageSquare, Check, CheckCheck, Send, X } from 'lucide-react'
import { usePortalAuth } from '../../contexts/PortalAuthContext'
import {
  listarNotificaciones, leerNotificacion, marcarTodasNotifLeidas,
  listarNotasCliente, leerNota, responderNota,
} from '../../utils/clienteApi'


export default function BuzonTab() {
  const { token } = usePortalAuth()
  const [tab, setTab] = useState('notif')   // notif | notas
  const [notif, setNotif] = useState({ notificaciones: [], no_leidas: 0 })
  const [notas, setNotas] = useState({ notas: [], no_leidas: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    if (!token) return
    setLoading(true); setError('')
    try {
      const [n, na] = await Promise.all([
        listarNotificaciones(token),
        listarNotasCliente(token),
      ])
      setNotif(n); setNotas(na)
    } catch (e) { setError(e.message || 'Error') }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => { reload() }, [reload])

  return (
    <div style={{
      padding: '20px 24px', maxWidth: 760, margin: '0 auto',
      display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: 'var(--text-0)' }}>
        Buzón
      </h1>

      {/* Tabs */}
      <div role="tablist" style={{
        display: 'flex', gap: 4, padding: 4,
        background: 'var(--bg-1)', border: '1px solid var(--line)', borderRadius: 12,
      }}>
        <TabBtn active={tab === 'notif'} onClick={() => setTab('notif')}
                icon={Bell} label="Notificaciones" badge={notif.no_leidas} />
        <TabBtn active={tab === 'notas'} onClick={() => setTab('notas')}
                icon={MessageSquare} label="Notas del manager" badge={notas.no_leidas} />
      </div>

      {error && (
        <div style={{ padding: 10, borderRadius: 8, background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.30)', color: '#f87171', fontSize: 13 }}>
          Error: {error}
        </div>
      )}

      {loading ? (
        <p style={{ color: 'var(--text-3)' }}>Cargando…</p>
      ) : tab === 'notif' ? (
        <PanelNotificaciones data={notif} token={token} onReload={reload} />
      ) : (
        <PanelNotas data={notas} token={token} onReload={reload} />
      )}
    </div>
  )
}


function TabBtn({ active, onClick, icon: Icon, label, badge }) {
  return (
    <button role="tab" aria-selected={active} onClick={onClick}
            style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: 8, padding: '9px 12px',
              borderRadius: 8, border: 'none',
              background: active ? 'var(--green-bg, rgba(16,185,129,0.10))' : 'transparent',
              color: active ? 'var(--green, #10b981)' : 'var(--text-2)',
              fontSize: 13, fontWeight: active ? 700 : 500, cursor: 'pointer',
            }}>
      <Icon size={15} />
      <span>{label}</span>
      {badge > 0 && (
        <span style={{
          minWidth: 18, height: 18, padding: '0 6px', borderRadius: 9,
          background: '#f87171', color: '#fff',
          fontSize: 10, fontWeight: 700, display: 'inline-flex',
          alignItems: 'center', justifyContent: 'center',
        }}>{badge > 99 ? '99+' : badge}</span>
      )}
    </button>
  )
}


function PanelNotificaciones({ data, token, onReload }) {
  const [marcando, setMarcando] = useState(false)
  async function marcarTodas() {
    setMarcando(true)
    try { await marcarTodasNotifLeidas(token); onReload() }
    catch { /* */ }
    finally { setMarcando(false) }
  }
  async function marcarUna(id) {
    try { await leerNotificacion(token, id); onReload() } catch { /* */ }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {data.no_leidas > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={marcarTodas} disabled={marcando}
                  style={btnGhost}>
            <CheckCheck size={13} /> Marcar todas leídas
          </button>
        </div>
      )}

      {(data.notificaciones || []).length === 0 && (
        <EmptyMsg icon={Bell} text="No tienes notificaciones por ahora." />
      )}

      {(data.notificaciones || []).map(n => (
        <NotifCard key={n.id} n={n} onMarcar={() => marcarUna(n.id)} />
      ))}
    </div>
  )
}


function NotifCard({ n, onMarcar }) {
  const noLeida = !n.leida
  return (
    <div style={{
      padding: '12px 14px', borderRadius: 10,
      background: noLeida ? 'var(--green-bg, rgba(16,185,129,0.06))' : 'var(--bg-1)',
      border: `1px solid ${noLeida ? 'var(--green, #10b981)' : 'var(--line)'}`,
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {noLeida && <span style={{ width: 8, height: 8, borderRadius: 4, background: 'var(--green, #10b981)' }} />}
            <strong style={{ fontSize: 14, color: 'var(--text-0)' }}>{n.titulo}</strong>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
            {fmtFecha(n.fecha)} · {n.seccion} · {n.tipo}
          </div>
        </div>
        {noLeida && (
          <button onClick={onMarcar} style={btnGhost} title="Marcar como leída">
            <Check size={13} />
          </button>
        )}
      </div>
      {n.cuerpo && (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-1)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
          {n.cuerpo}
        </p>
      )}
      {n.cuerpo_html && (
        <div dangerouslySetInnerHTML={{ __html: n.cuerpo_html }}
             style={{ fontSize: 13, color: 'var(--text-1)' }} />
      )}
      {n.url && (
        <a href={n.url} target="_blank" rel="noopener noreferrer"
           style={{ fontSize: 12, color: 'var(--green, #10b981)', textDecoration: 'none' }}>
          Abrir enlace →
        </a>
      )}
      {n.leida && n.fecha_lectura && (
        <span style={{ fontSize: 10, color: 'var(--text-3)' }}>
          Leído el {fmtFecha(n.fecha_lectura)}
        </span>
      )}
    </div>
  )
}


function PanelNotas({ data, token, onReload }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {(data.notas || []).length === 0 && (
        <EmptyMsg icon={MessageSquare} text="No tienes notas del manager." />
      )}
      {(data.notas || []).map(n => (
        <NotaCard key={n.id} n={n} token={token} onReload={onReload} />
      ))}
    </div>
  )
}


function NotaCard({ n, token, onReload }) {
  const noLeida = !n.leida_at
  const [respondiendo, setRespondiendo] = useState(false)
  const [contenido, setContenido] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function marcarLeida() {
    try { await leerNota(token, n.id); onReload() } catch { /* */ }
  }

  async function enviarRespuesta() {
    if (!contenido.trim()) return
    setEnviando(true)
    try {
      await responderNota(token, n.id, contenido.trim())
      setContenido('')
      setRespondiendo(false)
      onReload()
    } catch { /* */ }
    finally { setEnviando(false) }
  }

  return (
    <div style={{
      padding: '12px 14px', borderRadius: 10,
      background: noLeida ? 'rgba(59,130,246,0.08)' : 'var(--bg-1)',
      border: `1px solid ${noLeida ? '#3b82f6' : 'var(--line)'}`,
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {noLeida && <span style={{ width: 8, height: 8, borderRadius: 4, background: '#3b82f6' }} />}
            <strong style={{ fontSize: 13, color: 'var(--text-0)' }}>{n.autor_label}</strong>
            <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4,
                          background: n.estado === 'contestada' ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)',
                          color: n.estado === 'contestada' ? '#10b981' : '#f59e0b',
                          textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700 }}>
              {n.estado}
            </span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{fmtFecha(n.created_at)}</div>
        </div>
        {noLeida && (
          <button onClick={marcarLeida} style={btnGhost} title="Marcar como leída">
            <Check size={13} />
          </button>
        )}
      </div>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-1)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
        {n.contenido}
      </p>

      {/* Hilo de respuestas */}
      {(n.respuestas || []).map(r => (
        <div key={r.id} style={{
          marginLeft: 12, paddingLeft: 12, borderLeft: '2px solid var(--line)',
          paddingTop: 8, paddingBottom: 4,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <strong style={{ fontSize: 12, color: 'var(--text-1)' }}>{r.autor_label}</strong>
            <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3,
                          background: r.autor_kind === 'cliente' ? 'var(--green-bg, rgba(16,185,129,0.15))' : 'rgba(59,130,246,0.15)',
                          color: r.autor_kind === 'cliente' ? 'var(--green, #10b981)' : '#3b82f6',
                          textTransform: 'uppercase', fontWeight: 700 }}>
              {r.autor_kind === 'cliente' ? 'Tú' : 'Manager'}
            </span>
            <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{fmtFecha(r.created_at)}</span>
          </div>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-2)', whiteSpace: 'pre-wrap' }}>
            {r.contenido}
          </p>
        </div>
      ))}

      {/* Form respuesta */}
      {respondiendo ? (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <textarea value={contenido} onChange={e => setContenido(e.target.value)}
                    placeholder="Escribe tu respuesta…" rows={3}
                    style={{
                      padding: 8, borderRadius: 6,
                      border: '1px solid var(--line)', background: 'var(--bg-1)',
                      color: 'var(--text-0)', fontSize: 13, resize: 'vertical',
                      fontFamily: 'inherit',
                    }} />
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button onClick={() => { setRespondiendo(false); setContenido('') }}
                    disabled={enviando} style={btnGhost}>
              <X size={13} /> Cancelar
            </button>
            <button onClick={enviarRespuesta} disabled={enviando || !contenido.trim()}
                    style={btnPrim}>
              <Send size={13} /> {enviando ? 'Enviando…' : 'Enviar'}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
          <button onClick={() => setRespondiendo(true)} style={btnGhost}>
            <Send size={13} /> Responder
          </button>
        </div>
      )}
    </div>
  )
}


function EmptyMsg({ icon: Icon, text }) {
  return (
    <div style={{
      padding: '32px 16px', textAlign: 'center',
      color: 'var(--text-3)', borderRadius: 12,
      background: 'var(--bg-1)', border: '1px dashed var(--line)',
    }}>
      <Icon size={28} style={{ marginBottom: 8, opacity: 0.5 }} />
      <p style={{ margin: 0, fontSize: 13 }}>{text}</p>
    </div>
  )
}


function fmtFecha(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}


const btnGhost = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '5px 10px', borderRadius: 6,
  border: '1px solid var(--line)', background: 'var(--bg-1)',
  color: 'var(--text-2)', fontSize: 12, cursor: 'pointer',
}
const btnPrim = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '5px 10px', borderRadius: 6,
  border: 'none', background: 'var(--green, #10b981)',
  color: '#fff', fontSize: 12, cursor: 'pointer', fontWeight: 600,
}
