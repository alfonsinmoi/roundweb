// Pantalla principal de gestión de notificaciones (estilo CRM kanban).
// Columnas = secciones (Cobros / Clases / Centro / Noticias).
// Tarjetas = notif_envio agrupadas por sección.
//
// Botón "Nueva notificación" abre modal con selector de audiencia
// (cliente / lista / cluster / broadcast) + título/cuerpo/HTML.

import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Bell, Send, Users, RefreshCw, Plus, Filter, Loader2, X, Newspaper,
  Receipt, Calendar, Building2, AlertCircle, CheckCircle2, Clock,
  CircleSlash,
} from 'lucide-react'
import { Card, Btn, Badge, SectionTitle } from '../../components/UI'
import { useToast } from '../../components/Toast'
import { useAuth } from '../../contexts/AuthContext'
import {
  getRoundIdentity, notifEnviosList, notifEnvioCreate, notifEnvioCancel,
  notifEnvioGet,
} from '../../utils/configApi'
import { getClientes } from '../../utils/api'
import { NOTIF_SECCIONES, NOTIF_TIPOS, tiposDeSeccion } from '../../utils/notifCatalog'

const ICONS = { receipt: Receipt, calendar: Calendar, 'building-2': Building2, newspaper: Newspaper, bell: Bell }

export default function NotificacionesPage() {
  const { user, isImpersonating } = useAuth()
  const identity = useMemo(() => getRoundIdentity(user), [user])
  const toast = useToast()
  const [envios, setEnvios] = useState([])
  const [loading, setLoading] = useState(true)
  // Filtro global: fecha desde (default últimos 30 días) + hasta (hoy) + estado.
  // El filtro por tipo vive dentro de cada columna (per-sección).
  const [filtros, setFiltros] = useState(() => {
    const pad = n => String(n).padStart(2, '0')
    const fmt = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
    const hoy = new Date()
    const desde = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    return { desde: fmt(desde), hasta: fmt(hoy), estado: '' }
  })
  const [tipoPorSeccion, setTipoPorSeccion] = useState({})  // {cobros: 'impago_efectivo', ...}
  const [detalle, setDetalle] = useState(null)            // {envio, destinatarios} o null
  const [modalNuevo, setModalNuevo] = useState(null)   // null | {seccion, audience?, presetTitle?}
  const location = useLocation()
  const navigate = useNavigate()

  // Si llegamos con state.audience (desde otra página: AnalisisClusters,
  // ClientList con selección múltiple, etc.) abrimos el modal con esa lista
  // pre-rellenada. Patrón "notificar desde cualquier vista con clientes".
  useEffect(() => {
    if (location.state?.audience) {
      setModalNuevo({
        seccion: location.state.seccion || 'centro',
        audience: location.state.audience,
        presetTitle: location.state.presetTitle,
      })
      // Limpiar el state para que F5 no reabra el modal
      navigate(location.pathname, { replace: true, state: null })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function reload() {
    setLoading(true)
    try {
      // Convertimos "YYYY-MM-DD" a ISO para que el backend lo entienda
      const apiFiltros = {
        estado: filtros.estado || undefined,
        desde: filtros.desde ? new Date(filtros.desde + 'T00:00:00').toISOString() : undefined,
        hasta: filtros.hasta ? new Date(filtros.hasta + 'T23:59:59').toISOString() : undefined,
      }
      const list = await notifEnviosList(identity, apiFiltros)
      setEnvios(list)
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setLoading(false)
  }
  useEffect(() => { reload() }, [identity.managerId, filtros.desde, filtros.hasta, filtros.estado])

  const enviosBySeccion = useMemo(() => {
    const m = {}
    for (const s of NOTIF_SECCIONES) m[s.id] = []
    for (const e of envios) {
      // Filtro por tipo per-columna (si está aplicado en esa sección)
      const tipoFiltro = tipoPorSeccion[e.seccion]
      if (tipoFiltro && e.tipo !== tipoFiltro) continue
      if (m[e.seccion]) m[e.seccion].push(e)
      else m._otro = (m._otro || []).concat(e)
    }
    return m
  }, [envios, tipoPorSeccion])

  const stats = useMemo(() => {
    const total = envios.length
    const enviadas = envios.filter(e => e.estado === 'enviada').length
    const pendientes = envios.filter(e => e.estado === 'pendiente').length
    const fallidas = envios.filter(e => e.estado === 'fallida').length
    const totalDest = envios.reduce((a, e) => a + (e.total_destinatarios || 0), 0)
    const totalLeidas = envios.reduce((a, e) => a + (e.total_leidas || 0), 0)
    return { total, enviadas, pendientes, fallidas, totalDest, totalLeidas,
             pctLeidas: totalDest ? Math.round(100 * totalLeidas / totalDest) : 0 }
  }, [envios])

  return (
    <div style={{ maxWidth: '100%' }}>
      {/* Header + filtros */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <Bell size={22} style={{ color: 'var(--green)' }} aria-hidden="true" />
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, color: 'var(--text-0)', margin: 0 }}>
          Notificaciones
        </h1>
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 12 }}>
        Centro de retención y comunicación. Envía pushes a tus clientes via mynoofit y agrupa por sección.
      </p>

      {/* Banner: estado integración OneSignal con mynoofit */}
      <div style={{
        padding: '10px 14px', borderRadius: 10, marginBottom: 16,
        background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)',
        fontSize: 12, color: 'var(--text-1)',
      }}>
        ⚠️ <strong>Estado integración mynoofit:</strong> NoofitPro aún no vincula a sus
        clientes con OneSignal mediante <code style={{ background: 'var(--bg-3)', padding: '1px 5px', borderRadius: 4, fontSize: 11 }}>OneSignal.login(idCliente)</code>.
        Hasta que lo hagan, los pushes con audiencia <strong>"un cliente"</strong> fallarán
        porque OneSignal no sabe a qué dispositivo enviar. <strong>Broadcast</strong> sí funciona
        si hay devices suscritos. La notificación se persiste igualmente para auditoría.
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 20 }}>
        <StatBox label="Enviadas" value={stats.enviadas} color="var(--green)" />
        <StatBox label="Pendientes" value={stats.pendientes} color="var(--amber)" />
        <StatBox label="Fallidas" value={stats.fallidas} color="var(--red)" />
        <StatBox label="Destinatarios" value={stats.totalDest} color="var(--text-1)" />
        <StatBox label="Leídas" value={`${stats.totalLeidas} · ${stats.pctLeidas}%`} color="var(--blue)" />
      </div>

      {/* Toolbar — fecha + estado global. Filtro por tipo va per-columna. */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 14 }}>
        <Lbl text="Desde">
          <input type="date" value={filtros.desde}
                 onChange={e => setFiltros(f => ({ ...f, desde: e.target.value }))}
                 style={selectStyle} />
        </Lbl>
        <Lbl text="Hasta">
          <input type="date" value={filtros.hasta}
                 onChange={e => setFiltros(f => ({ ...f, hasta: e.target.value }))}
                 style={selectStyle} />
        </Lbl>
        <Lbl text="Estado">
          <select value={filtros.estado} onChange={e => setFiltros(f => ({ ...f, estado: e.target.value }))}
                  style={selectStyle} aria-label="Filtrar por estado">
            <option value="">Cualquiera</option>
            <option value="pendiente">Pendiente</option>
            <option value="enviada">Enviada</option>
            <option value="fallida">Fallida</option>
            <option value="cancelada">Cancelada</option>
          </select>
        </Lbl>
        <button onClick={reload} title="Recargar" style={{ ...iconBtn, marginBottom: 1 }}>
          <RefreshCw size={14} />
        </button>
        <div style={{ flex: 1 }} />
        <Btn variant="primary" onClick={() => setModalNuevo({ seccion: 'cobros' })}>
          <Plus size={14} /> Nueva notificación
        </Btn>
      </div>

      {/* Kanban por sección */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <Loader2 size={20} className="animate-spin" style={{ color: 'var(--green)' }} />
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${NOTIF_SECCIONES.length}, 1fr)`, gap: 12 }}>
          {NOTIF_SECCIONES.map(seccion => {
            const Icon = ICONS[seccion.icon] || Bell
            const items = enviosBySeccion[seccion.id] || []
            return (
              <div key={seccion.id} style={{
                background: 'var(--bg-1)', border: '1px solid var(--line)',
                borderRadius: 16, padding: 12, minHeight: 400,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <Icon size={16} style={{ color: 'var(--text-2)', flexShrink: 0 }} aria-hidden="true" />
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-0)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      {seccion.nombre}
                    </span>
                    <Badge color={seccion.color}>{items.length}</Badge>
                  </div>
                  <button onClick={() => setModalNuevo({ seccion: seccion.id })}
                          title={`Nueva notificación · ${seccion.nombre}`}
                          style={iconBtn}>
                    <Plus size={13} />
                  </button>
                </div>
                {/* Filtro por tipo (per-columna) */}
                <select value={tipoPorSeccion[seccion.id] || ''}
                        onChange={e => setTipoPorSeccion(t => ({ ...t, [seccion.id]: e.target.value }))}
                        aria-label={`Filtrar tipo en ${seccion.nombre}`}
                        style={{
                          ...selectStyle, fontSize: 11, padding: '5px 8px',
                          marginBottom: 8, width: '100%',
                        }}>
                  <option value="">Todos los tipos</option>
                  {NOTIF_TIPOS.filter(t => t.seccion === seccion.id).map(t => (
                    <option key={t.id} value={t.id}>{t.nombre}</option>
                  ))}
                </select>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '70vh', overflowY: 'auto' }}>
                  {items.length === 0 ? (
                    <p style={{ fontSize: 12, color: 'var(--text-3)', textAlign: 'center', padding: '20px 0' }}>
                      Sin envíos
                    </p>
                  ) : items.map(e => (
                    <EnvioCard key={e.id} envio={e}
                               onCancel={async () => {
                                 if (!confirm('¿Cancelar este envío?')) return
                                 try { await notifEnvioCancel(identity, e.id); toast.success('Cancelado'); reload() }
                                 catch (er) { toast.error(`Error: ${er.message}`) }
                               }}
                               onVerDestinatarios={async () => {
                                 try {
                                   const d = await notifEnvioGet(identity, e.id)
                                   setDetalle(d)
                                 } catch (er) { toast.error(`Error: ${er.message}`) }
                               }} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal detalle envío + destinatarios + leídas */}
      {detalle && (
        <DetalleEnvioModal data={detalle} onClose={() => setDetalle(null)} />
      )}

      {/* Modal nueva notificación */}
      {modalNuevo && (
        <NuevaNotifModal
          identity={identity}
          seccionInicial={modalNuevo.seccion}
          audiencePreset={modalNuevo.audience}
          presetTitle={modalNuevo.presetTitle}
          onClose={() => setModalNuevo(null)}
          onCreated={() => { setModalNuevo(null); reload() }}
        />
      )}
    </div>
  )
}


function StatBox({ label, value, color }) {
  return (
    <Card style={{ padding: 14 }}>
      <p style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</p>
      <p style={{ fontFamily: 'Outfit', fontSize: 24, fontWeight: 700, color, marginTop: 4 }}>{value}</p>
    </Card>
  )
}


function EnvioCard({ envio, onCancel, onVerDestinatarios }) {
  const tipo = NOTIF_TIPOS.find(t => t.id === envio.tipo)
  const fmt = (iso) => {
    if (!iso) return '—'
    try {
      return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    } catch { return '—' }
  }
  const estadoIcon = {
    pendiente: <Clock size={11} />,
    enviada:   <CheckCircle2 size={11} />,
    fallida:   <AlertCircle size={11} />,
    cancelada: <CircleSlash size={11} />,
  }[envio.estado]
  const estadoColor = {
    pendiente: 'amber', enviada: 'green', fallida: 'red', cancelada: 'gray',
  }[envio.estado] || 'gray'

  return (
    <Card style={{ padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{tipo?.nombre || envio.tipo}</span>
        <Badge color={estadoColor}>{estadoIcon}{envio.estado}</Badge>
      </div>
      <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-0)', marginBottom: 4, lineHeight: 1.3 }}>
        {envio.titulo}
      </p>
      {envio.cuerpo && (
        <p style={{ fontSize: 12, color: 'var(--text-2)', overflow: 'hidden',
                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', marginBottom: 8 }}>
          {envio.cuerpo}
        </p>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: 'var(--text-3)' }}>
        {envio.total_destinatarios > 1 ? (
          <button onClick={onVerDestinatarios}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--blue)', fontSize: 11, padding: 0, textDecoration: 'underline',
                    display: 'inline-flex', alignItems: 'center', gap: 3,
                  }}
                  title="Ver detalle de destinatarios">
            <Users size={10} />
            {envio.total_destinatarios} · {envio.total_leidas || 0} leídas
          </button>
        ) : (
          <span>
            <Users size={10} style={{ verticalAlign: 'middle', marginRight: 3 }} />
            {envio.total_destinatarios} · {envio.total_leidas || 0} leídas
          </span>
        )}
        <span>{fmt(envio.fecha_envio || envio.programada_at || envio.created_at)}</span>
      </div>
      {envio.estado === 'pendiente' && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--line)' }}>
          <button onClick={onCancel} style={{
            background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer',
            fontSize: 11, padding: 0,
          }}>Cancelar</button>
        </div>
      )}
      {envio.error && (
        <p style={{ marginTop: 6, fontSize: 11, color: 'var(--red)' }} title={envio.error}>
          ⚠ {envio.error.slice(0, 80)}{envio.error.length > 80 ? '…' : ''}
        </p>
      )}
    </Card>
  )
}


// ── Modal detalle envío con desglose por destinatario ─────────────────────
function DetalleEnvioModal({ data, onClose }) {
  const e = data?.envio || {}
  const dests = data?.destinatarios || []
  const seccion = NOTIF_SECCIONES.find(s => s.id === e.seccion)
  const tipo = NOTIF_TIPOS.find(t => t.id === e.tipo)
  const [clientes, setClientes] = useState([])
  useEffect(() => {
    getClientes().then(setClientes).catch(() => {})
  }, [])
  const cliMap = useMemo(() => Object.fromEntries(clientes.map(c => [String(c.id), c])), [clientes])

  const fmt = (iso) => {
    if (!iso) return '—'
    try { return new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) }
    catch { return '—' }
  }

  const leidas = dests.filter(d => d.leida).length
  const noLeidas = dests.length - leidas
  const pctLeidas = dests.length ? Math.round(100 * leidas / dests.length) : 0

  return createPortal((
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 20,
    }} onClick={onClose}>
      <Card style={{ padding: 0, maxWidth: 720, width: '100%', maxHeight: '90vh',
                     overflowY: 'auto', display: 'flex', flexDirection: 'column' }}
            onClick={ev => ev.stopPropagation()}>
        {/* Cabecera */}
        <div style={{ padding: 20, borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <Badge color={seccion?.color || 'gray'}>{seccion?.nombre || e.seccion}</Badge>
                <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{tipo?.nombre || e.tipo}</span>
              </div>
              <h2 style={{ margin: 0, fontFamily: 'Outfit', fontSize: 18, fontWeight: 700 }}>
                {e.titulo}
              </h2>
              {e.cuerpo && (
                <p style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 6 }}>{e.cuerpo}</p>
              )}
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)' }}>
              <X size={14} />
            </button>
          </div>

          {/* Stats */}
          <div style={{ display: 'flex', gap: 14, marginTop: 14, fontSize: 12 }}>
            <span style={{ color: 'var(--text-3)' }}>
              <Users size={11} style={{ verticalAlign: 'middle', marginRight: 3 }} />
              <strong style={{ color: 'var(--text-1)' }}>{dests.length}</strong> destinatarios
            </span>
            <span style={{ color: 'var(--green)' }}>
              ✓ <strong>{leidas}</strong> leídas ({pctLeidas}%)
            </span>
            <span style={{ color: 'var(--text-3)' }}>
              ⊝ <strong style={{ color: 'var(--text-2)' }}>{noLeidas}</strong> sin leer
            </span>
            <span style={{ marginLeft: 'auto', color: 'var(--text-3)' }}>
              {fmt(e.fecha_envio || e.created_at)}
            </span>
          </div>
        </div>

        {/* Lista destinatarios */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {dests.length === 0 ? (
            <p style={{ padding: 30, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
              {e.scope === 'broadcast'
                ? 'Envío masivo (broadcast) — no hay destinatarios individuales.'
                : 'Sin destinatarios.'}
            </p>
          ) : (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 0.6fr 1fr',
                             padding: '10px 16px', background: 'var(--bg-3)', fontSize: 11,
                             color: 'var(--text-3)', textTransform: 'uppercase' }}>
                <span>Cliente</span>
                <span>Estado</span>
                <span>Fecha lectura</span>
              </div>
              {dests.map(d => {
                const c = cliMap[String(d.cliente_idnoofit)] || {}
                const nombre = `${c.name || ''} ${c.surname || ''}`.trim() || `(cliente ${d.cliente_idnoofit})`
                return (
                  <div key={d.id} style={{
                    display: 'grid', gridTemplateColumns: '2fr 0.6fr 1fr',
                    padding: '10px 16px', alignItems: 'center', fontSize: 13,
                    borderTop: '1px solid var(--line)',
                  }}>
                    <div>
                      <p style={{ fontWeight: 500, color: 'var(--text-0)' }}>{nombre}</p>
                      <p style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'monospace' }}>
                        id {d.cliente_idnoofit}
                        {c.email ? <span style={{ marginLeft: 8, fontFamily: 'inherit' }}>· {c.email}</span> : null}
                      </p>
                    </div>
                    <span>
                      {d.leida
                        ? <Badge color="green">✓ Leída</Badge>
                        : <Badge color="gray">Sin leer</Badge>}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                      {d.leida ? fmt(d.fecha_lectura) : '—'}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div style={{ padding: 14, borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'flex-end' }}>
          <Btn variant="secondary" onClick={onClose}>Cerrar</Btn>
        </div>
      </Card>
    </div>
  ), document.body)
}


// Helper: ahora + N minutos en formato datetime-local del navegador (YYYY-MM-DDTHH:MM)
function nowPlusMin(min) {
  const d = new Date(Date.now() + min * 60_000)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function NuevaNotifModal({ identity, seccionInicial, audiencePreset, presetTitle, onClose, onCreated }) {
  const toast = useToast()
  const [form, setForm] = useState({
    seccion: seccionInicial || 'cobros',
    tipo: '',
    // audiencia preset (desde otra vista: cluster, lista, etc.) tiene prioridad
    audienciaTipo: audiencePreset?.tipo || 'cliente',
    // Multi-select: array de ids. Si tiene 1 → audience='cliente', si >1 → 'lista'.
    clientesIds: [],
    listaIds: audiencePreset?.tipo === 'lista' ? (audiencePreset.ref || audiencePreset.clientes || []) : [],
    listaLabel: audiencePreset?.tipo === 'cluster'
      ? `Cluster (${(audiencePreset.clientes || []).length} clientes)`
      : audiencePreset?.tipo === 'lista'
        ? `Lista (${(audiencePreset.ref || audiencePreset.clientes || []).length} clientes)`
        : '',
    titulo: presetTitle || '',
    cuerpo: '',
    cuerpoHtml: '',
    url: '',
    // Por defecto: enviar en 30 min (programada). El usuario puede ponerlo a "ahora"
    // marcando "Enviar inmediatamente".
    enviar_ahora: false,
    fecha_publicacion: nowPlusMin(30),
    fecha_desaparicion: '',
  })
  const [saving, setSaving] = useState(false)
  const [clientes, setClientes] = useState([])
  const [busc, setBusc] = useState('')

  useEffect(() => {
    getClientes().then(setClientes).catch(() => {})
  }, [])

  const tiposDisponibles = tiposDeSeccion(form.seccion)
  // Auto-seleccionar primer tipo de la sección al cambiar
  useEffect(() => {
    if (!tiposDisponibles.find(t => t.id === form.tipo)) {
      setForm(f => ({ ...f, tipo: tiposDisponibles[0]?.id || '' }))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.seccion])

  const [incluirInactivos, setIncluirInactivos] = useState(false)
  const clientesFiltrados = useMemo(() => {
    let arr = clientes
    if (!incluirInactivos) arr = arr.filter(c => c.enabled !== false)
    if (busc) {
      const q = busc.toLowerCase().trim()
      arr = arr.filter(c =>
        `${c.name || ''} ${c.surname || ''} ${c.email || ''} ${c.id || ''}`.toLowerCase().includes(q)
      )
    }
    return arr.slice(0, 50)
  }, [clientes, busc, incluirInactivos])

  const enviar = async () => {
    if (!form.titulo) { toast.error('El título es obligatorio'); return }
    if (form.audienciaTipo === 'cliente' && form.clientesIds.length === 0) { toast.error('Elige al menos un cliente'); return }
    if ((form.audienciaTipo === 'lista' || form.audienciaTipo === 'cluster') && (!form.listaIds || form.listaIds.length === 0)) {
      toast.error('Lista vacía')
      return
    }
    setSaving(true)
    try {
      // Para audiencia 'cliente': si seleccionó 1 → cliente, si varios → lista (mismo backend)
      let audience
      if (form.audienciaTipo === 'cliente') {
        audience = form.clientesIds.length === 1
          ? { tipo: 'cliente', ref: form.clientesIds[0] }
          : { tipo: 'lista', ref: form.clientesIds }
      } else if (form.audienciaTipo === 'broadcast') {
        audience = { tipo: 'broadcast' }
      } else if (form.audienciaTipo === 'lista') {
        audience = { tipo: 'lista', ref: form.listaIds }
      } else if (form.audienciaTipo === 'cluster') {
        audience = { tipo: 'cluster', ref: audiencePreset?.cluster_id || null, clientes: form.listaIds }
      }
      // Si "enviar ahora" → no programada_at; si no → mandamos programada_at = fecha_publicacion
      // y send_now=false para que se quede pendiente y la cron lo dispare a su hora.
      const programada_at = form.enviar_ahora ? null : (form.fecha_publicacion ? new Date(form.fecha_publicacion).toISOString() : null)
      const r = await notifEnvioCreate(identity, {
        seccion: form.seccion,
        tipo: form.tipo,
        titulo: form.titulo,
        cuerpo: form.cuerpo || null,
        cuerpo_html: form.cuerpoHtml || null,
        url: form.url || null,
        audience,
        fecha_desaparicion: form.fecha_desaparicion ? new Date(form.fecha_desaparicion).toISOString() : null,
        programada_at,
        send_now: !programada_at,
      })
      if (r.estado === 'fallida') {
        toast.error(`Envío fallido: ${r.error || 'desconocido'}`)
      } else if (r.estado === 'pendiente') {
        toast.success(`Programada para ${new Date(programada_at).toLocaleString('es-ES')}`)
      } else {
        toast.success(`Notificación enviada (${r.total_destinatarios} destinatarios)`)
      }
      onCreated()
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setSaving(false)
  }

  return createPortal((
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 20,
    }} onClick={onClose}>
      <Card style={{ padding: 0, maxWidth: 640, width: '100%', maxHeight: '90vh',
                     overflowY: 'auto', display: 'flex', flexDirection: 'column' }}
            onClick={e => e.stopPropagation()}>
        <div style={{ padding: 24, borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontFamily: 'Outfit', fontSize: 18, fontWeight: 700, margin: 0 }}>Nueva notificación</h2>
          <button onClick={onClose} style={iconBtn}><X size={14} /></button>
        </div>

        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Sección + tipo */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: 12 }}>
            <Lbl text="Sección">
              <select value={form.seccion} onChange={e => setForm(f => ({ ...f, seccion: e.target.value }))} style={selectStyle}>
                {NOTIF_SECCIONES.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </Lbl>
            <Lbl text="Tipo">
              <select value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))} style={selectStyle}>
                {tiposDisponibles.map(t => <option key={t.id} value={t.id}>{t.nombre}{t.auto ? ' · auto' : ''}</option>)}
              </select>
            </Lbl>
          </div>

          {/* Audiencia */}
          <Lbl text="Audiencia">
            {/* Si llegamos con audiencia preset (cluster/lista), la mostramos como info read-only */}
            {form.listaLabel ? (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
                background: 'var(--green-bg)', border: '1px solid var(--green-border)',
                borderRadius: 10, fontSize: 13, color: 'var(--green)',
              }}>
                <Users size={14} aria-hidden="true" />
                <span>{form.listaLabel}</span>
                <button onClick={() => setForm(f => ({ ...f, audienciaTipo: 'cliente', listaIds: [], listaLabel: '' }))}
                        style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)' }}
                        title="Cambiar audiencia">
                  <X size={12} />
                </button>
              </div>
            ) : (
              <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              {[['cliente','Un cliente'],['broadcast','Todos (broadcast)']].map(([v, l]) => (
                <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                  <input type="radio" name="aud" value={v}
                         checked={form.audienciaTipo === v}
                         onChange={() => setForm(f => ({ ...f, audienciaTipo: v }))} />
                  {l}
                </label>
              ))}
            </div>
            {form.audienciaTipo === 'cliente' && (
              <div>
                {/* Chips de clientes seleccionados (múltiples) */}
                {form.clientesIds.length > 0 && (
                  <div style={{
                    display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8,
                    padding: 8, background: 'var(--green-bg)', border: '1px solid var(--green-border)',
                    borderRadius: 8,
                  }}>
                    <span style={{ fontSize: 11, color: 'var(--green)', fontWeight: 600, alignSelf: 'center', marginRight: 4 }}>
                      {form.clientesIds.length} seleccionado{form.clientesIds.length !== 1 ? 's' : ''}:
                    </span>
                    {form.clientesIds.map(id => {
                      const c = clientes.find(x => String(x.id) === String(id))
                      const label = c ? `${c.name || ''} ${c.surname || ''}`.trim() : `id ${id}`
                      return (
                        <span key={id} style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          padding: '3px 8px', background: 'var(--bg-2)', borderRadius: 999,
                          fontSize: 11, border: '1px solid var(--green-border)',
                        }}>
                          {label}
                          <button onClick={() => setForm(f => ({
                            ...f, clientesIds: f.clientesIds.filter(x => String(x) !== String(id))
                          }))}
                                  style={{ background: 'none', border: 'none', cursor: 'pointer',
                                           color: 'var(--red)', padding: 0, marginLeft: 2,
                                           fontSize: 14, lineHeight: 1 }}
                                  title="Quitar">×</button>
                        </span>
                      )
                    })}
                    <button onClick={() => setForm(f => ({ ...f, clientesIds: [] }))}
                            style={{ marginLeft: 'auto', background: 'none', border: 'none',
                                     cursor: 'pointer', color: 'var(--text-3)', fontSize: 11 }}
                            title="Limpiar todos">Limpiar</button>
                  </div>
                )}

                <input type="search" placeholder="Buscar cliente por nombre, email o id..."
                       value={busc} onChange={e => setBusc(e.target.value)}
                       style={inputStyle} />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                  <p style={{ fontSize: 11, color: 'var(--text-3)' }}>
                    💡 Click en uno o varios clientes para añadirlos. Click otra vez para quitar.
                  </p>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-3)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={incluirInactivos}
                           onChange={e => setIncluirInactivos(e.target.checked)} />
                    Incluir inactivos
                  </label>
                </div>
                <div style={{ maxHeight: 220, overflowY: 'auto', marginTop: 6, border: '1px solid var(--line)', borderRadius: 8 }}>
                  {clientesFiltrados.length === 0 && busc && (
                    <p style={{ padding: 10, fontSize: 12, color: 'var(--text-3)', textAlign: 'center' }}>
                      Sin resultados para "{busc}"
                    </p>
                  )}
                  {clientesFiltrados.map(c => {
                    const isSel = form.clientesIds.some(x => String(x) === String(c.id))
                    return (
                      <div key={c.id}
                           onClick={() => setForm(f => isSel
                             ? ({ ...f, clientesIds: f.clientesIds.filter(x => String(x) !== String(c.id)) })
                             : ({ ...f, clientesIds: [...f.clientesIds, c.id] })
                           )}
                           style={{
                             padding: '8px 12px', fontSize: 12, cursor: 'pointer',
                             background: isSel ? 'var(--green-bg)' : 'transparent',
                             borderBottom: '1px solid var(--line)',
                             borderLeft: isSel ? '3px solid var(--green)' : '3px solid transparent',
                           }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                          <span style={{ fontWeight: 600, color: isSel ? 'var(--green)' : 'var(--text-0)',
                                         display: 'flex', alignItems: 'center', gap: 6 }}>
                            {isSel && <span style={{ color: 'var(--green)' }}>✓</span>}
                            {c.name} {c.surname}
                          </span>
                          <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-3)' }}>
                            id {c.id}
                          </span>
                        </div>
                        {c.email && (
                          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{c.email}</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
            </>
            )}
          </Lbl>

          {/* Título / Cuerpo */}
          <Lbl text="Título *">
            <input value={form.titulo} onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))}
                   placeholder="Texto corto que se ve en el push"
                   style={inputStyle} />
          </Lbl>
          <Lbl text="Cuerpo (texto)">
            <textarea value={form.cuerpo} onChange={e => setForm(f => ({ ...f, cuerpo: e.target.value }))}
                      rows={3} placeholder="Mensaje principal" style={{ ...inputStyle, fontFamily: 'inherit' }} />
          </Lbl>

          {form.seccion === 'noticias' && (
            <Lbl text="Cuerpo HTML (para webview)">
              <textarea value={form.cuerpoHtml} onChange={e => setForm(f => ({ ...f, cuerpoHtml: e.target.value }))}
                        rows={6} placeholder="<h2>Título</h2><p>Contenido…</p>"
                        style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 12 }} />
            </Lbl>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Lbl text="Fecha de publicación">
              <input type="datetime-local"
                     value={form.fecha_publicacion}
                     onChange={e => setForm(f => ({ ...f, fecha_publicacion: e.target.value }))}
                     disabled={form.enviar_ahora}
                     style={{ ...inputStyle, opacity: form.enviar_ahora ? 0.5 : 1 }} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-2)', marginTop: 4, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.enviar_ahora}
                       onChange={e => setForm(f => ({ ...f, enviar_ahora: e.target.checked }))} />
                Enviar inmediatamente
              </label>
            </Lbl>
            <Lbl text="Fecha desaparición (opcional)">
              <input type="datetime-local" value={form.fecha_desaparicion}
                     onChange={e => setForm(f => ({ ...f, fecha_desaparicion: e.target.value }))}
                     style={inputStyle} />
            </Lbl>
          </div>

          <Lbl text="URL deep link (opcional)">
            <input value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                   placeholder="https://round.../algo" style={inputStyle} />
          </Lbl>
        </div>

        <div style={{ padding: 16, borderTop: '1px solid var(--line)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Btn>
          <Btn variant="primary" onClick={enviar} disabled={saving}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Enviar
          </Btn>
        </div>
      </Card>
    </div>
  ), document.body)
}


function Lbl({ text, children }) {
  return (
    <div>
      <span style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 4 }}>
        {text}
      </span>
      {children}
    </div>
  )
}


const inputStyle = {
  width: '100%', padding: '8px 10px', borderRadius: 8, fontSize: 13,
  background: 'var(--bg-1)', border: '1px solid var(--line)', color: 'var(--text-0)',
}
const selectStyle = { ...inputStyle, cursor: 'pointer' }
const iconBtn = {
  background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 8,
  padding: '6px 8px', cursor: 'pointer', color: 'var(--text-2)',
  display: 'inline-flex', alignItems: 'center',
}
