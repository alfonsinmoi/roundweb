import { useState, useEffect, useMemo } from 'react'
import {
  Loader2, Filter, RotateCcw, CheckCircle2, XCircle,
  UserMinus, ChevronDown, ChevronUp, Users, CalendarDays, AlertTriangle
} from 'lucide-react'
import { Card, Badge, Btn, Avatar } from '../components/UI'
import ConfirmDialog from '../components/ConfirmDialog'
import { useToast } from '../components/Toast'
import { getSalas, getUsuariosBySala, updateUsuarioSala, userRemoveSala } from '../utils/api'

// ── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_DAYS_BACK = 30
const DEFAULT_DAYS_FORWARD = 7
const PRELOAD_MAX = 10
const TOP_REINCIDENTES = 15
const MAX_PENDIENTES = 10

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(d) { return d.toISOString().slice(0, 10) }
function fmtDateES(d) { return new Date(d).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }) }
function fmtHora(d) { return new Date(d).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) }

function addDays(date, n) {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

function pctColor(pct) {
  if (pct >= 80) return 'var(--green)'
  if (pct >= 50) return 'var(--amber)'
  return 'var(--red)'
}

function severityColor(pct) {
  if (pct >= 75) return 'var(--red)'
  if (pct >= 50) return 'var(--amber)'
  return 'var(--amber)'
}

// ── Component ───────────────────────────────────────────────────────────────

export default function InformeAsistencia() {
  const toast = useToast()
  const [salas, setSalas] = useState([])
  const [usuariosPorSala, setUsuariosPorSala] = useState({})
  const [loading, setLoading] = useState(true)
  const [loadingUsuarios, setLoadingUsuarios] = useState({})
  const [actionLoading, setActionLoading] = useState('')

  // Confirm dialog state
  const [confirmState, setConfirmState] = useState({ open: false, usuario: null, salaId: null })

  // Filters
  const hoy = new Date()
  const [desde, setDesde] = useState(fmtDate(addDays(hoy, -DEFAULT_DAYS_BACK)))
  const [hasta, setHasta] = useState(fmtDate(addDays(hoy, DEFAULT_DAYS_FORWARD)))
  const [claseFilter, setClaseFilter] = useState('')
  const [showFilters, setShowFilters] = useState(false)

  const [tab, setTab] = useState('reincidentes')
  const [expandedSalas, setExpandedSalas] = useState(new Set())

  // ── Fetch all salas ───────────────────────────────────────────────────────
  const fetchSalas = async () => {
    setLoading(true)
    try {
      const data = await getSalas()
      setSalas(data.filter(s => s.enabled))
    } catch (err) {
      toast.error('Error cargando salas')
    }
    setLoading(false)
  }

  useEffect(() => { fetchSalas() }, [])

  // ── Filtered salas ────────────────────────────────────────────────────────
  const filteredSalas = useMemo(() => {
    const dDesde = new Date(desde + 'T00:00:00')
    const dHasta = new Date(hasta + 'T23:59:59')
    return salas.filter(s => {
      if (!s.dateStart) return false
      const d = new Date(s.dateStart)
      if (d < dDesde || d > dHasta) return false
      if (claseFilter && (s.name || s.nameTraining) !== claseFilter) return false
      return true
    }).sort((a, b) => new Date(a.dateStart) - new Date(b.dateStart))
  }, [salas, desde, hasta, claseFilter])

  const clasesDisponibles = useMemo(() => {
    const names = new Set(salas.map(s => s.name || s.nameTraining).filter(Boolean))
    return [...names].sort()
  }, [salas])

  // ── Load usuarios for a sala (lazy) ───────────────────────────────────────
  const loadUsuarios = async (salaId) => {
    if (usuariosPorSala[salaId]) return
    setLoadingUsuarios(prev => ({ ...prev, [salaId]: true }))
    try {
      const users = await getUsuariosBySala(salaId)
      setUsuariosPorSala(prev => ({ ...prev, [salaId]: users }))
    } catch (err) {
      toast.error('Error cargando usuarios de la sala')
    }
    setLoadingUsuarios(prev => ({ ...prev, [salaId]: false }))
  }

  // ── Preload upcoming salas ────────────────────────────────────────────────
  useEffect(() => {
    if (salas.length === 0) return
    const ahora = new Date()
    const en7dias = addDays(ahora, DEFAULT_DAYS_FORWARD)
    const proximas = salas
      .filter(s => s.dateStart && new Date(s.dateStart) >= ahora && new Date(s.dateStart) <= en7dias)
      .sort((a, b) => new Date(a.dateStart) - new Date(b.dateStart))
      .slice(0, PRELOAD_MAX)
    proximas.forEach(s => loadUsuarios(s.id))
  }, [salas])

  // ── Computed data ─────────────────────────────────────────────────────────

  const allUsers = useMemo(() => {
    return filteredSalas.flatMap(s => (usuariosPorSala[s.id] ?? []).map(u => ({ ...u, sala: s })))
  }, [filteredSalas, usuariosPorSala])

  const totalReservas = allUsers.length
  const totalVerificados = allUsers.filter(u => u.verify).length
  const totalNoShows = totalReservas - totalVerificados
  const pctAsistencia = totalReservas > 0 ? Math.round((totalVerificados / totalReservas) * 100) : 0

  const reincidentes = useMemo(() => {
    const map = {}
    allUsers.forEach(u => {
      if (!map[u.idClient]) {
        map[u.idClient] = { idClient: u.idClient, nameClient: u.nameClient, pictureClient: u.pictureClient, total: 0, noShows: 0, asistencias: 0 }
      }
      map[u.idClient].total++
      if (u.verify) map[u.idClient].asistencias++
      else map[u.idClient].noShows++
    })
    return Object.values(map)
      .filter(u => u.noShows > 0)
      .sort((a, b) => b.noShows - a.noShows || (b.noShows / b.total) - (a.noShows / a.total))
      .slice(0, TOP_REINCIDENTES)
  }, [allUsers])

  const salasConDatos = useMemo(() => {
    return filteredSalas.map(s => {
      const users = usuariosPorSala[s.id] ?? []
      const verificados = users.filter(u => u.verify).length
      const pct = users.length > 0 ? Math.round((verificados / users.length) * 100) : 0
      return { ...s, users, verificados, noVerificados: users.length - verificados, pctAsistencia: pct }
    })
  }, [filteredSalas, usuariosPorSala])

  const pendientes = useMemo(() => {
    const ahora = new Date()
    return salasConDatos
      .filter(s => new Date(s.dateStart) >= addDays(ahora, -1))
      .map(s => ({ ...s, pendientes: s.users.filter(u => !u.verify) }))
      .filter(s => s.pendientes.length > 0)
      .slice(0, MAX_PENDIENTES)
  }, [salasConDatos])

  // ── Actions ───────────────────────────────────────────────────────────────

  const toggleVerify = async (usuario, salaId) => {
    setActionLoading(`v-${usuario.id}`)
    try {
      await updateUsuarioSala({ ...usuario, verify: !usuario.verify })
      setUsuariosPorSala(prev => ({
        ...prev,
        [salaId]: (prev[salaId] ?? []).map(u => u.id === usuario.id ? { ...u, verify: !u.verify } : u)
      }))
      toast.success(usuario.verify ? 'Marcado como no-show' : 'Asistencia verificada')
    } catch (err) {
      toast.error('Error actualizando asistencia')
    }
    setActionLoading('')
  }

  const cancelReserva = async (usuario, salaId) => {
    setActionLoading(`r-${usuario.id}`)
    try {
      await userRemoveSala(usuario.id)
      setUsuariosPorSala(prev => ({
        ...prev,
        [salaId]: (prev[salaId] ?? []).filter(u => u.id !== usuario.id)
      }))
      toast.success(`Reserva de ${usuario.nameClient} anulada`)
    } catch (err) {
      toast.error('Error anulando reserva')
    }
    setActionLoading('')
    setConfirmState({ open: false, usuario: null, salaId: null })
  }

  const toggleExpand = (salaId) => {
    const next = new Set(expandedSalas)
    if (next.has(salaId)) next.delete(salaId)
    else { next.add(salaId); loadUsuarios(salaId) }
    setExpandedSalas(next)
  }

  const resetFilters = () => {
    setDesde(fmtDate(addDays(new Date(), -DEFAULT_DAYS_BACK)))
    setHasta(fmtDate(addDays(new Date(), DEFAULT_DAYS_FORWARD)))
    setClaseFilter('')
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '120px 0' }} role="status" aria-label="Cargando informe">
      <Loader2 size={22} className="animate-spin" style={{ color: 'var(--green)' }} aria-hidden="true" />
    </div>
  )

  return (
    <div style={{ maxWidth: 1000 }}>

      <h1 style={{ fontFamily: 'Outfit', fontSize: 28, fontWeight: 700, color: 'var(--text-0)', marginBottom: 8 }}>
        Informe de Asistencia
      </h1>
      <p style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 32 }}>
        {fmtDateES(desde)} — {fmtDateES(hasta)}{claseFilter ? ` · ${claseFilter}` : ' · Todas las clases'}
      </p>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 24 }}>
        <Btn variant="secondary" size="md" onClick={() => setShowFilters(v => !v)}>
          <Filter size={15} aria-hidden="true" /> Filtros
        </Btn>
        <Btn variant="secondary" size="md" onClick={() => { fetchSalas(); setUsuariosPorSala({}) }}>
          <RotateCcw size={15} aria-hidden="true" /> Recargar
        </Btn>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <Card style={{ padding: 28, marginBottom: 24 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 20, alignItems: 'end' }}>
            <div>
              <label htmlFor="filter-desde" style={{ display: 'block', fontSize: 13, color: 'var(--text-3)', marginBottom: 8 }}>Desde</label>
              <input id="filter-desde" type="date" value={desde} onChange={e => setDesde(e.target.value)}
                     style={{ width: '100%', padding: '12px 16px', borderRadius: 12, fontSize: 14, background: 'var(--bg-1)', border: '1px solid var(--line)', color: 'var(--text-0)', outline: 'none' }} />
            </div>
            <div>
              <label htmlFor="filter-hasta" style={{ display: 'block', fontSize: 13, color: 'var(--text-3)', marginBottom: 8 }}>Hasta</label>
              <input id="filter-hasta" type="date" value={hasta} onChange={e => setHasta(e.target.value)}
                     style={{ width: '100%', padding: '12px 16px', borderRadius: 12, fontSize: 14, background: 'var(--bg-1)', border: '1px solid var(--line)', color: 'var(--text-0)', outline: 'none' }} />
            </div>
            <div>
              <label htmlFor="filter-clase" style={{ display: 'block', fontSize: 13, color: 'var(--text-3)', marginBottom: 8 }}>Clase</label>
              <select id="filter-clase" value={claseFilter} onChange={e => setClaseFilter(e.target.value)}
                      style={{ width: '100%', padding: '12px 16px', borderRadius: 12, fontSize: 14, background: 'var(--bg-1)', border: '1px solid var(--line)', color: 'var(--text-0)', outline: 'none', cursor: 'pointer' }}>
                <option value="">Todas las clases</option>
                {clasesDisponibles.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            <Btn variant="primary" size="md" onClick={() => setShowFilters(false)}>Aplicar</Btn>
            <Btn variant="secondary" size="md" onClick={resetFilters}><RotateCcw size={14} aria-hidden="true" /> Reset</Btn>
          </div>
        </Card>
      )}

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16, marginBottom: 32 }}>
        {[
          { label: 'Total reservas', value: totalReservas, color: 'var(--text-0)' },
          { label: '% Asistencia', value: `${pctAsistencia}%`, color: pctColor(pctAsistencia) },
          { label: 'Verificados', value: totalVerificados, color: 'var(--green)' },
          { label: 'No-shows', value: totalNoShows, color: 'var(--red)' },
        ].map(kpi => (
          <Card key={kpi.label} style={{ padding: 24, textAlign: 'center' }}>
            <p style={{ fontFamily: 'Outfit', fontSize: 32, fontWeight: 700, color: kpi.color }}>{kpi.value}</p>
            <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 6 }}>{kpi.label}</p>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <div role="tablist" aria-label="Secciones del informe" style={{ display: 'flex', gap: 6, marginBottom: 24, flexWrap: 'wrap' }}>
        {[
          { id: 'reincidentes', label: 'Reincidentes', icon: AlertTriangle },
          { id: 'porClase', label: 'Por Clase', icon: CalendarDays },
          { id: 'pendientes', label: 'Pendientes', icon: Users },
        ].map(t => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '12px 20px', borderRadius: 14, fontSize: 13, fontWeight: 500,
                    cursor: 'pointer', border: 'none',
                    background: tab === t.id ? 'var(--green-bg)' : 'var(--bg-2)',
                    color: tab === t.id ? 'var(--green)' : 'var(--text-2)',
                    outline: tab === t.id ? '1px solid rgba(45,212,168,0.3)' : '1px solid var(--line)',
                    transition: 'all 0.1s',
                  }}>
            <t.icon size={14} aria-hidden="true" /> {t.label}
          </button>
        ))}
      </div>

      {/* Tab: Reincidentes */}
      {tab === 'reincidentes' && (
        <div role="tabpanel" aria-label="Reincidentes">
          <p style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 16 }}>
            Top {TOP_REINCIDENTES} clientes con más no-shows
          </p>
          {reincidentes.length === 0 ? (
            <Card style={{ padding: 48, textAlign: 'center' }}>
              <p style={{ fontSize: 14, color: 'var(--text-3)' }}>No hay datos de no-shows en el rango seleccionado</p>
            </Card>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {reincidentes.map(u => {
                const pctNoShow = Math.round((u.noShows / u.total) * 100)
                return (
                  <Card key={u.idClient} style={{ padding: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                      <Avatar nombre={u.nameClient || '?'} size={44} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontFamily: 'Outfit', fontSize: 15, fontWeight: 600, color: 'var(--text-0)' }}>
                          {u.nameClient || `Cliente #${u.idClient}`}
                        </p>
                        <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
                          {u.noShows} no-shows de {u.total} reservas · {u.asistencias} asistencias
                        </p>
                      </div>
                      <div style={{
                        padding: '8px 16px', borderRadius: 12,
                        fontSize: 14, fontWeight: 700, fontFamily: 'Outfit',
                        color: '#fff', background: severityColor(pctNoShow),
                      }}>
                        {pctNoShow}%
                      </div>
                    </div>
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab: Por Clase */}
      {tab === 'porClase' && (
        <div role="tabpanel" aria-label="Por clase" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {salasConDatos.length === 0 ? (
            <Card style={{ padding: 48, textAlign: 'center' }}>
              <p style={{ fontSize: 14, color: 'var(--text-3)' }}>No hay clases en el rango seleccionado</p>
            </Card>
          ) : salasConDatos.map(s => {
            const expanded = expandedSalas.has(s.id)
            const isLoading = loadingUsuarios[s.id]
            return (
              <Card key={s.id} style={{ overflow: 'hidden' }}>
                <button onClick={() => toggleExpand(s.id)}
                        aria-expanded={expanded}
                        aria-label={`${s.name || s.nameTraining} — ${expanded ? 'Contraer' : 'Expandir'}`}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 16, width: '100%',
                          padding: 20, cursor: 'pointer', background: 'transparent', border: 'none', textAlign: 'left',
                        }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                      <span style={{ fontFamily: 'Outfit', fontSize: 14, fontWeight: 600, color: 'var(--text-0)' }}>
                        {s.name || s.nameTraining}
                      </span>
                      {s.users.length > 0 && (
                        <span style={{ padding: '3px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600, color: '#fff', background: pctColor(s.pctAsistencia) }}>
                          {s.pctAsistencia}%
                        </span>
                      )}
                    </div>
                    <p style={{ fontSize: 12, color: 'var(--text-3)' }}>
                      {fmtDateES(s.dateStart)} · {fmtHora(s.dateStart)}
                      {s.users.length > 0 && ` · ${s.verificados}/${s.users.length} asistieron`}
                    </p>
                  </div>
                  {expanded ? <ChevronUp size={16} style={{ color: 'var(--text-3)' }} aria-hidden="true" /> : <ChevronDown size={16} style={{ color: 'var(--text-3)' }} aria-hidden="true" />}
                </button>

                {expanded && (
                  <div style={{ padding: '0 20px 20px', borderTop: '1px solid var(--line)' }}>
                    {isLoading ? (
                      <div style={{ padding: 20, textAlign: 'center' }} role="status" aria-label="Cargando usuarios">
                        <Loader2 size={18} className="animate-spin" style={{ color: 'var(--green)' }} aria-hidden="true" />
                      </div>
                    ) : s.users.length === 0 ? (
                      <p style={{ padding: 20, textAlign: 'center', fontSize: 13, color: 'var(--text-3)' }}>Sin inscripciones</p>
                    ) : (
                      <div style={{ paddingTop: 12 }}>
                        {s.users.map(u => (
                          <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
                            <Avatar nombre={u.nameClient || '?'} size={36} />
                            <span style={{ flex: 1, fontSize: 14, color: 'var(--text-0)' }}>{u.nameClient}</span>
                            <button onClick={() => toggleVerify(u, s.id)} disabled={actionLoading === `v-${u.id}`}
                                    aria-label={u.verify ? `Marcar ${u.nameClient} como no-show` : `Verificar asistencia de ${u.nameClient}`}
                                    style={{
                                      padding: '8px 14px', borderRadius: 10, fontSize: 12, fontWeight: 500, cursor: 'pointer', border: 'none',
                                      display: 'flex', alignItems: 'center', gap: 5,
                                      background: u.verify ? 'rgba(45,212,168,0.1)' : 'rgba(248,113,113,0.08)',
                                      color: u.verify ? 'var(--green)' : 'var(--red)',
                                    }}>
                              {actionLoading === `v-${u.id}` ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : u.verify ? <CheckCircle2 size={13} aria-hidden="true" /> : <XCircle size={13} aria-hidden="true" />}
                              {u.verify ? 'Verificado' : 'No-show'}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {/* Tab: Pendientes */}
      {tab === 'pendientes' && (
        <div role="tabpanel" aria-label="Pendientes" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {pendientes.length === 0 ? (
            <Card style={{ padding: 48, textAlign: 'center' }}>
              <p style={{ fontSize: 14, color: 'var(--text-3)' }}>No hay asistencias pendientes de verificar</p>
            </Card>
          ) : pendientes.map(s => (
            <Card key={s.id} style={{ padding: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <p style={{ fontFamily: 'Outfit', fontSize: 15, fontWeight: 600, color: 'var(--text-0)' }}>
                    {s.name || s.nameTraining}
                  </p>
                  <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
                    {fmtDateES(s.dateStart)} · {fmtHora(s.dateStart)}
                  </p>
                </div>
                <Badge color="yellow">{s.pendientes.length} pendiente{s.pendientes.length !== 1 ? 's' : ''}</Badge>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {s.pendientes.map(u => (
                  <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 0', borderTop: '1px solid var(--line)' }}>
                    <Avatar nombre={u.nameClient || '?'} size={36} />
                    <span style={{ flex: 1, fontSize: 14, color: 'var(--text-0)' }}>{u.nameClient}</span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => toggleVerify(u, s.id)} disabled={actionLoading === `v-${u.id}`}
                              aria-label={`Verificar asistencia de ${u.nameClient}`}
                              style={{
                                padding: 10, borderRadius: 10, cursor: 'pointer', border: 'none',
                                background: 'rgba(45,212,168,0.08)', color: 'var(--green)', display: 'flex',
                              }}>
                        {actionLoading === `v-${u.id}` ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />}
                      </button>
                      <button onClick={() => setConfirmState({ open: true, usuario: u, salaId: s.id })}
                              disabled={actionLoading === `r-${u.id}`}
                              aria-label={`Anular reserva de ${u.nameClient}`}
                              style={{
                                padding: 10, borderRadius: 10, cursor: 'pointer', border: 'none',
                                background: 'rgba(248,113,113,0.06)', color: 'var(--red)', display: 'flex',
                              }}>
                        {actionLoading === `r-${u.id}` ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <UserMinus size={14} aria-hidden="true" />}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Confirm dialog — replaces window.confirm */}
      <ConfirmDialog
        open={confirmState.open}
        title="Anular reserva"
        message={`¿Seguro que quieres anular la reserva de ${confirmState.usuario?.nameClient}?`}
        confirmText="Anular reserva"
        onConfirm={() => cancelReserva(confirmState.usuario, confirmState.salaId)}
        onCancel={() => setConfirmState({ open: false, usuario: null, salaId: null })}
      />
    </div>
  )
}
