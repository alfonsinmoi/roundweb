import { useState, useEffect, useMemo } from 'react'
import {
  Loader2, Filter, RotateCcw, CheckCircle2, XCircle,
  UserMinus, ChevronDown, ChevronUp, Users, CalendarDays,
  AlertTriangle, ChevronRight, ArrowLeft,
} from 'lucide-react'
import { Card, Badge, Btn, Avatar } from '../components/UI'
import ConfirmDialog from '../components/ConfirmDialog'
import Modal from '../components/Modal'
import { useToast } from '../components/Toast'
import {
  getSalasByRange, invalidateSalasCache, getClientes, getActividades,
  getUsuariosBySala, updateUsuarioSala, userRemoveSala,
} from '../utils/api'

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_DAYS_BACK    = 30
const DEFAULT_DAYS_FORWARD = 7
const MAX_PENDIENTES       = 10

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d)   { return d.toISOString().slice(0, 10) }
function fmtDateES(d) { return new Date(d).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }) }
function fmtHora(d)   { return new Date(d).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) }

// Semana ISO del año (1-53)
function getISOWeek(input) {
  const d = new Date(input)
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = dt.getUTCDay() || 7
  dt.setUTCDate(dt.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1))
  return Math.ceil((((dt - yearStart) / 86400000) + 1) / 7)
}

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
  return 'var(--amber)'
}

// Semana natural actual: lunes 00:00 → hoy
function semanaActual() {
  const now = new Date()
  const day = now.getDay()
  const daysFromMon = day === 0 ? 6 : day - 1
  const monday = new Date(now)
  monday.setDate(now.getDate() - daysFromMon)
  monday.setHours(0, 0, 0, 0)
  return { from: monday, to: now }
}

// Mes natural actual: día 1 → hoy
function mesActual() {
  const now = new Date()
  return { from: new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0), to: now }
}

function actNombre(a) {
  return a.Nombre ?? a.nombre ?? a.name ?? `Actividad #${a.id}`
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function InformeAsistencia() {
  const toast = useToast()
  const [salas, setSalas]                   = useState([])
  const [usuariosPorSala, setUsuariosPorSala] = useState({})
  const [loading, setLoading]               = useState(false)
  const [loadingUsuarios, setLoadingUsuarios] = useState({})
  const [actionLoading, setActionLoading]   = useState('')
  const [catActividades, setCatActividades] = useState([])

  const [confirmState, setConfirmState] = useState({ open: false, usuario: null, salaId: null })

  // Filtros
  const hoy = new Date()
  const [desde, setDesde]         = useState(fmtDate(addDays(hoy, -DEFAULT_DAYS_BACK)))
  const [hasta, setHasta]         = useState(fmtDate(addDays(hoy, DEFAULT_DAYS_FORWARD)))
  const [claseFilter, setClaseFilter] = useState('')
  const [showFilters, setShowFilters] = useState(false)

  const [tab, setTab]               = useState(null)
  const [expandedSalas, setExpandedSalas] = useState(new Set())
  const [clienteDetalle, setClienteDetalle] = useState(null)
  const [clientMap, setClientMap]   = useState({})

  // Control de asistencia por actividad (inline, ya no modal)
  const [actividadSeleccionada, setActividadSeleccionada] = useState(null)
  const [filtroSemana, setFiltroSemana]               = useState('0')
  const [filtroMesMedia, setFiltroMesMedia]           = useState('0')
  const [clienteExpandido, setClienteExpandido]       = useState(null)

  useEffect(() => {
    getClientes().then(list => {
      const map = {}
      list.forEach(c => { map[String(c.id)] = c })
      setClientMap(map)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    getActividades().then(setCatActividades).catch(() => {})
  }, [])

  const clientName = (idClient) => {
    const c = clientMap[String(idClient)]
    if (!c) return null
    const nombre    = c.nombre    || c.name    || ''
    const apellidos = c.apellidos || c.surname || ''
    return [nombre, apellidos].filter(Boolean).join(' ') || null
  }

  const clientParts = (idClient, fallbackNombre = '', fallbackImg = '') => {
    const c = clientMap[String(idClient)]
    if (c) {
      return {
        nombre:    c.nombre    || c.name    || fallbackNombre || `Cliente #${idClient}`,
        apellidos: c.apellidos || c.surname || '',
        imgUrl:    c.imgUrl || fallbackImg || '',
      }
    }
    // Fallback a nameClient de la sala — suele venir como "Nombre Apellidos"
    if (fallbackNombre) {
      const partes = fallbackNombre.trim().split(/\s+/)
      return { nombre: partes[0], apellidos: partes.slice(1).join(' '), imgUrl: fallbackImg || '' }
    }
    return { nombre: `Cliente #${idClient}`, apellidos: '', imgUrl: fallbackImg || '' }
  }

  // ── Fetch salas ──────────────────────────────────────────────────────────────

  const fetchSalas = async () => {
    setLoading(true)
    try {
      const dDesde = new Date(desde + 'T00:00:00')
      const dHasta = new Date(hasta + 'T23:59:59')
      const data = await getSalasByRange(dDesde, dHasta)
      setSalas(data.filter(s => s.enabled !== false))
    } catch {
      toast.error('Error cargando salas')
    }
    setLoading(false)
  }

  useEffect(() => {
    if (tab === null) return
    fetchSalas()
  }, [desde, hasta, tab])

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

  // ── Load usuarios ────────────────────────────────────────────────────────────

  const loadUsuarios = async (salaId) => {
    if (usuariosPorSala[salaId]) return
    setLoadingUsuarios(prev => ({ ...prev, [salaId]: true }))
    try {
      const users = await getUsuariosBySala(salaId)
      setUsuariosPorSala(prev => ({ ...prev, [salaId]: users }))
    } catch {
      toast.error('Error cargando usuarios de la sala')
    }
    setLoadingUsuarios(prev => ({ ...prev, [salaId]: false }))
  }

  useEffect(() => {
    if (salas.length === 0) return
    const ahora = Date.now()
    filteredSalas
      .filter(s => s.dateStart && new Date(s.dateStart).getTime() < ahora)
      .forEach(s => loadUsuarios(s.id))
  }, [salas, desde, hasta, claseFilter])

  // ── Computed data ─────────────────────────────────────────────────────────────

  const allUsers = useMemo(() => {
    return filteredSalas.flatMap(s => (usuariosPorSala[s.id] ?? []).map(u => ({ ...u, sala: s })))
  }, [filteredSalas, usuariosPorSala])

  const pastUsers = useMemo(() => {
    const ahora = Date.now()
    return allUsers.filter(u => new Date(u.sala.dateStart).getTime() <= ahora)
  }, [allUsers])

  // KPIs
  const ahora7d  = Date.now() - 7  * 24 * 60 * 60 * 1000
  const ahora30d = Date.now() - 30 * 24 * 60 * 60 * 1000

  const totalReservas7d  = pastUsers.filter(u => new Date(u.sala.dateStart).getTime() >= ahora7d).length
  const totalReservas30d = pastUsers.filter(u => new Date(u.sala.dateStart).getTime() >= ahora30d).length
  const totalNoShows7d   = pastUsers.filter(u => !u.verify && new Date(u.sala.dateStart).getTime() >= ahora7d).length
  const totalNoShows30d  = pastUsers.filter(u => !u.verify && new Date(u.sala.dateStart).getTime() >= ahora30d).length
  const totalVerificados = pastUsers.filter(u => u.verify).length

  const reincidentes = useMemo(() => {
    const ahora  = Date.now()
    const semana = 7  * 24 * 60 * 60 * 1000
    const mes    = 30 * 24 * 60 * 60 * 1000
    const map = {}
    allUsers.forEach(u => {
      const t = new Date(u.sala.dateStart).getTime()
      if (t > ahora) return
      if (!map[u.idClient]) {
        map[u.idClient] = { idClient: u.idClient, nameClient: u.nameClient, pictureClient: u.pictureClient, total: 0, noShows: 0, asistencias: 0, noShowsSemana: 0, noShowsMes: 0, reservasMes: 0, lastNoShow: 0 }
      }
      const entry = map[u.idClient]
      entry.total++
      if (ahora - t <= mes) entry.reservasMes++
      if (u.verify) {
        entry.asistencias++
      } else {
        entry.noShows++
        if (t > entry.lastNoShow) entry.lastNoShow = t
        if (ahora - t <= semana) entry.noShowsSemana++
        if (ahora - t <= mes)   entry.noShowsMes++
      }
    })
    return Object.values(map)
      .filter(u => u.noShows > 0)
      .sort((a, b) => b.lastNoShow - a.lastNoShow)
  }, [allUsers])

  const salasConDatos = useMemo(() => {
    return filteredSalas.map(s => {
      const users      = usuariosPorSala[s.id] ?? []
      const verificados = users.filter(u => u.verify).length
      const pct        = users.length > 0 ? Math.round((verificados / users.length) * 100) : 0
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

  // Actividades con clases en el rango
  // Intenta por idActividad; si no hay, cae al nombre de la sala
  const actividadesConSalas = useMemo(() => {
    const byId = catActividades
      .filter(a =>
        a.enabled !== false &&
        filteredSalas.some(s => s.idActividad != null && String(s.idActividad) === String(a.id))
      )
      .map(a => ({
        id:     String(a.id),
        nombre: actNombre(a),
        count:  filteredSalas.filter(s => String(s.idActividad) === String(a.id)).length,
      }))

    if (byId.length > 0) return byId.sort((a, b) => a.nombre.localeCompare(b.nombre))

    // Fallback: derivar del nombre de la sala
    const byName = {}
    filteredSalas.forEach(s => {
      const name = s.nameTraining || s.name
      if (!name) return
      if (!byName[name]) byName[name] = { id: name, nombre: name, count: 0 }
      byName[name].count++
    })
    return Object.values(byName).sort((a, b) => a.nombre.localeCompare(b.nombre))
  }, [catActividades, filteredSalas])

  // Asistencias por cliente para la actividad seleccionada
  // Doble matching: por idActividad Y por nombre (las salas pasadas pueden no tener idActividad)
  const actividadClientes = useMemo(() => {
    if (!actividadSeleccionada) return []
    const now          = new Date()
    const semana       = semanaActual()
    const mes          = mesActual()
    const weeksElapsed = Math.max(1, (now - mes.from) / (7 * 24 * 60 * 60 * 1000))
    const nombreAct    = actividadesConSalas.find(a => a.id === actividadSeleccionada)?.nombre

    const map = {}
    filteredSalas
      .filter(s => {
        if (new Date(s.dateStart) > now) return false
        if (s.idActividad != null && String(s.idActividad) === actividadSeleccionada) return true
        if (nombreAct && (s.nameTraining === nombreAct || s.name === nombreAct)) return true
        return false
      })
      .forEach(sala => {
        ;(usuariosPorSala[sala.id] ?? []).forEach(u => {
          const t = new Date(sala.dateStart).getTime()
          if (!map[u.idClient]) map[u.idClient] = { idClient: u.idClient, nameClient: u.nameClient, pictureClient: u.pictureClient, semana: 0, mes: 0, clases: [] }
          if (u.verify) {
            if (t >= semana.from.getTime()) map[u.idClient].semana++
            if (t >= mes.from.getTime())    map[u.idClient].mes++
            map[u.idClient].clases.push({
              salaId: sala.id,
              name: sala.name || sala.nameTraining || 'Clase',
              dateStart: sala.dateStart,
            })
          }
        })
      })

    return Object.values(map)
      .map(c => ({
        ...c,
        mediaSemana: +(c.mes / weeksElapsed).toFixed(1),
        clases: c.clases.sort((a, b) => new Date(b.dateStart) - new Date(a.dateStart)),
      }))
      .sort((a, b) => b.semana - a.semana || b.mes - a.mes)
  }, [actividadSeleccionada, actividadesConSalas, filteredSalas, usuariosPorSala])

  const clientesFiltrados = useMemo(() => {
    return actividadClientes.filter(c => {
      if (filtroSemana   !== '0' && c.semana      < Number(filtroSemana))   return false
      if (filtroMesMedia !== '0' && c.mediaSemana < Number(filtroMesMedia)) return false
      return true
    })
  }, [actividadClientes, filtroSemana, filtroMesMedia])

  // ── Actions ───────────────────────────────────────────────────────────────────

  const toggleVerify = async (usuario, salaId) => {
    setActionLoading(`v-${usuario.id}`)
    try {
      await updateUsuarioSala({ ...usuario, verify: !usuario.verify })
      setUsuariosPorSala(prev => ({
        ...prev,
        [salaId]: (prev[salaId] ?? []).map(u => u.id === usuario.id ? { ...u, verify: !u.verify } : u),
      }))
      toast.success(usuario.verify ? 'Marcado como no-show' : 'Asistencia verificada')
    } catch {
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
        [salaId]: (prev[salaId] ?? []).filter(u => u.id !== usuario.id),
      }))
      toast.success(`Reserva de ${usuario.nameClient} anulada`)
    } catch {
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

  const selectStyle = {
    padding: '8px 12px', borderRadius: 10, fontSize: 13,
    background: 'var(--bg-2)', border: '1px solid var(--line)',
    color: 'var(--text-0)', cursor: 'pointer', outline: 'none',
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  // Pantalla de entrada: sólo los dos botones. Nada se carga hasta elegir.
  if (tab === null) {
    return (
      <div style={{ maxWidth: 1000 }}>
        <h1 style={{ fontFamily: 'Outfit', fontSize: 28, fontWeight: 700, color: 'var(--text-0)', marginBottom: 8 }}>
          Informe de Asistencia
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 32 }}>
          Selecciona qué informe quieres ver
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
          {[
            { id: 'faltas',  label: 'Faltas de asistencia',  desc: 'Reincidentes con clases no asistidas', icon: UserMinus, color: 'var(--red)',   bg: 'rgba(248,113,113,0.12)' },
            { id: 'control', label: 'Control de asistencia', desc: 'Asistencias por cliente y actividad',  icon: Users,     color: 'var(--green)', bg: 'var(--green-bg)' },
          ].map(({ id, label, desc, icon: Icon, color, bg }) => (
            <button key={id}
                    onClick={() => setTab(id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 16,
                      padding: 24, borderRadius: 16, textAlign: 'left',
                      background: 'var(--bg-2)', border: '1px solid var(--line)',
                      cursor: 'pointer',
                    }}>
              <div style={{ width: 52, height: 52, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', background: bg, flexShrink: 0 }}>
                <Icon size={24} style={{ color }} aria-hidden="true" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontFamily: 'Outfit', fontSize: 17, fontWeight: 600, color: 'var(--text-0)', marginBottom: 4 }}>{label}</p>
                <p style={{ fontSize: 13, color: 'var(--text-3)' }}>{desc}</p>
              </div>
              <ChevronRight size={18} style={{ color: 'var(--text-3)', flexShrink: 0 }} aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>
    )
  }

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '120px 0' }} role="status" aria-label="Cargando informe">
      <Loader2 size={22} className="animate-spin" style={{ color: 'var(--green)' }} aria-hidden="true" />
    </div>
  )

  return (
    <div style={{ maxWidth: 1000 }}>

      <button onClick={() => { setTab(null); setActividadSeleccionada(null); setClienteExpandido(null) }}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-3)', background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 16px' }}>
        <ArrowLeft size={13} aria-hidden="true" /> Volver al menú
      </button>

      <h1 style={{ fontFamily: 'Outfit', fontSize: 28, fontWeight: 700, color: 'var(--text-0)', marginBottom: 8 }}>
        {tab === 'faltas' ? 'Faltas de asistencia' : 'Control de asistencia'}
      </h1>
      <p style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 32 }}>
        {fmtDateES(desde)} — {fmtDateES(hasta)}{claseFilter ? ` · ${claseFilter}` : ' · Todas las clases'}
      </p>

      {/* Barra de filtros */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 24 }}>
        <Btn variant="secondary" size="md" onClick={() => setShowFilters(v => !v)}>
          <Filter size={15} aria-hidden="true" /> Filtros
        </Btn>
        <Btn variant="secondary" size="md" onClick={() => { invalidateSalasCache(); fetchSalas(); setUsuariosPorSala({}) }}>
          <RotateCcw size={15} aria-hidden="true" /> Recargar
        </Btn>
      </div>

      {/* Panel de filtros */}
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

      {/* KPIs — sólo en Faltas de asistencia */}
      {tab === 'faltas' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16, marginBottom: 32 }}>
          <Card style={{ padding: 24 }}>
            <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 14 }}>Total reservas</p>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
              <div>
                <p style={{ fontFamily: 'Outfit', fontSize: 32, fontWeight: 700, color: 'var(--text-0)', lineHeight: 1 }}>{totalReservas7d}</p>
                <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>últimos 7 días</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontFamily: 'Outfit', fontSize: 22, fontWeight: 600, color: 'var(--text-2)', lineHeight: 1 }}>{totalReservas30d}</p>
                <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>últimos 30 días</p>
              </div>
            </div>
          </Card>

          <Card style={{ padding: 24 }}>
            <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 14 }}>Faltas de asistencia</p>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
              <div>
                <p style={{ fontFamily: 'Outfit', fontSize: 32, fontWeight: 700, color: 'var(--red)', lineHeight: 1 }}>{totalNoShows7d}</p>
                <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>últimos 7 días</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontFamily: 'Outfit', fontSize: 22, fontWeight: 600, color: 'var(--red)', lineHeight: 1, opacity: 0.7 }}>{totalNoShows30d}</p>
                <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>últimos 30 días</p>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Tab: Faltas de asistencia */}
      {tab === 'faltas' && (
        <div aria-label="Reincidentes" role="tabpanel" style={{ marginTop: 8 }}>
          <p style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 16 }}>
            {reincidentes.length} cliente{reincidentes.length !== 1 ? 's' : ''} con faltas · ordenados por falta más reciente
          </p>
          {Object.values(loadingUsuarios).some(Boolean) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-3)', marginBottom: 12 }}>
              <Loader2 size={13} className="animate-spin" style={{ color: 'var(--green)' }} aria-hidden="true" />
              Cargando datos de asistencia…
            </div>
          )}
          {reincidentes.length === 0 && !Object.values(loadingUsuarios).some(Boolean) ? (
            <Card style={{ padding: 48, textAlign: 'center' }}>
              <p style={{ fontSize: 14, color: 'var(--text-3)' }}>No hay faltas de asistencia en el rango seleccionado</p>
            </Card>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {reincidentes.map(u => {
                const pctFaltasMes = u.reservasMes > 0 ? Math.round((u.noShowsMes / u.reservasMes) * 100) : 0
                const { nombre, apellidos, imgUrl } = clientParts(u.idClient, u.nameClient, u.pictureClient)
                return (
                  <Card key={u.idClient} style={{ padding: '12px 16px', cursor: 'pointer' }}
                        onClick={() => setClienteDetalle(u)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <Avatar nombre={`${nombre} ${apellidos}`} size={36} imgUrl={imgUrl} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontFamily: 'Outfit', fontSize: 14, fontWeight: 700, color: 'var(--text-0)' }}>{nombre}</span>
                          {apellidos && <span style={{ fontFamily: 'Outfit', fontSize: 14, fontWeight: 400, color: 'var(--text-1)' }}>{apellidos}</span>}
                          <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, background: 'rgba(248,113,113,0.12)', color: 'var(--red)' }}>
                            faltas de asistencia
                          </span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                        {[
                          { val: u.noShows,       label: 'total',  color: 'var(--red)' },
                          { val: u.noShowsSemana,  label: 'semana', color: u.noShowsSemana > 0 ? 'var(--amber)' : 'var(--text-3)' },
                          { val: u.noShowsMes,     label: 'mes',    color: u.noShowsMes    > 0 ? 'var(--amber)' : 'var(--text-3)' },
                        ].map(({ val, label, color }) => (
                          <div key={label} style={{ textAlign: 'center', minWidth: 52, padding: '4px 8px', borderRadius: 10, background: 'var(--bg-3)' }}>
                            <p style={{ fontFamily: 'Outfit', fontSize: 18, fontWeight: 700, color, lineHeight: 1 }}>{val}</p>
                            <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)', marginTop: 2 }}>{label}</p>
                          </div>
                        ))}
                        <div style={{ minWidth: 52, padding: '4px 8px', borderRadius: 10, textAlign: 'center', background: severityColor(pctFaltasMes) }}>
                          <p style={{ fontFamily: 'Outfit', fontSize: 18, fontWeight: 700, color: '#fff', lineHeight: 1 }}>{pctFaltasMes}%</p>
                          <p style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.9)', marginTop: 2 }}>30d</p>
                        </div>
                      </div>
                    </div>
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab: Control de asistencia (antes era modal) */}
      {tab === 'control' && (
        <div role="tabpanel" aria-label="Control de asistencia" style={{ marginTop: 8 }}>
          {/* Paso 1: selección de actividad */}
          {!actividadSeleccionada && (
            <>
              <p style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 16 }}>
                {actividadesConSalas.length} actividad{actividadesConSalas.length !== 1 ? 'es' : ''} · selecciona una para ver la asistencia por cliente
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {actividadesConSalas.length === 0 ? (
                  <Card style={{ padding: 48, textAlign: 'center' }}>
                    <p style={{ fontSize: 14, color: 'var(--text-3)' }}>
                      No hay actividades en el rango seleccionado
                    </p>
                  </Card>
                ) : actividadesConSalas.map(act => (
                  <button key={act.id}
                          onClick={() => { setActividadSeleccionada(act.id); setFiltroSemana('0'); setFiltroMesMedia('0'); setClienteExpandido(null) }}
                          style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '14px 18px', borderRadius: 14,
                            border: '1px solid var(--line)', background: 'var(--bg-2)',
                            cursor: 'pointer', textAlign: 'left',
                          }}>
                    <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-0)' }}>{act.nombre}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{act.count} clase{act.count !== 1 ? 's' : ''}</span>
                      <ChevronRight size={14} style={{ color: 'var(--text-3)' }} aria-hidden="true" />
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Paso 2: listado de clientes */}
          {actividadSeleccionada && (
            <div>
              <button onClick={() => { setActividadSeleccionada(null); setClienteExpandido(null) }}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-3)', background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 16px' }}>
                <ArrowLeft size={13} aria-hidden="true" /> Cambiar actividad
              </button>

              <div style={{ marginBottom: 16 }}>
                <p style={{ fontFamily: 'Outfit', fontSize: 18, fontWeight: 600, color: 'var(--text-0)' }}>
                  {actividadesConSalas.find(a => a.id === actividadSeleccionada)?.nombre ?? actividadSeleccionada}
                </p>
                <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
                  {clientesFiltrados.length} cliente{clientesFiltrados.length !== 1 ? 's' : ''} · ordenados por asistencias del mes
                </p>
              </div>

              {/* Filtros semana/media */}
              <div style={{ display: 'flex', gap: 24, marginBottom: 20, flexWrap: 'wrap' }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--text-3)', marginBottom: 6 }}>
                    Filtra por asistencias última semana mayor a
                  </label>
                  <select value={filtroSemana} onChange={e => setFiltroSemana(e.target.value)} style={selectStyle}>
                    <option value="0">Sin filtro</option>
                    {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--text-3)', marginBottom: 6 }}>
                    Filtra por media mes por semana mayor a
                  </label>
                  <select value={filtroMesMedia} onChange={e => setFiltroMesMedia(e.target.value)} style={selectStyle}>
                    <option value="0">Sin filtro</option>
                    {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
              </div>

              {Object.values(loadingUsuarios).some(Boolean) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-3)', marginBottom: 12 }}>
                  <Loader2 size={13} className="animate-spin" style={{ color: 'var(--green)' }} aria-hidden="true" />
                  Cargando datos de asistencia…
                </div>
              )}

              {filtroSemana === '0' && filtroMesMedia === '0' ? (
                <Card style={{ padding: 48, textAlign: 'center' }}>
                  <p style={{ fontSize: 14, color: 'var(--text-3)' }}>
                    Elige un filtro (días por semana o media por mes) para ver el listado
                  </p>
                </Card>
              ) : clientesFiltrados.length === 0 ? (
                <Card style={{ padding: 48, textAlign: 'center' }}>
                  <p style={{ fontSize: 14, color: 'var(--text-3)' }}>
                    No hay clientes con datos para este filtro
                  </p>
                </Card>
              ) : (
                <Card style={{ padding: 0, overflow: 'hidden' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 72px 72px 84px', gap: 8, padding: '10px 16px', borderBottom: '1px solid var(--line)', background: 'var(--bg-2)' }}>
                    <span style={{ fontSize: 11, color: 'var(--text-3)' }}>Cliente</span>
                    <span style={{ fontSize: 11, color: 'var(--text-3)', textAlign: 'center' }}>Semana</span>
                    <span style={{ fontSize: 11, color: 'var(--text-3)', textAlign: 'center' }}>Mes</span>
                    <span style={{ fontSize: 11, color: 'var(--text-3)', textAlign: 'center' }}>Media/sem</span>
                  </div>
                  <div>
                    {clientesFiltrados.map((c, idx) => {
                      const { nombre, apellidos, imgUrl } = clientParts(c.idClient, c.nameClient, c.pictureClient)
                      const isExpanded = clienteExpandido === c.idClient
                      const isLast     = idx === clientesFiltrados.length - 1
                      return (
                        <div key={c.idClient} style={{
                          borderBottom: !isLast ? '1px solid var(--line)' : 'none',
                          background: isExpanded ? 'var(--bg-2)' : 'transparent',
                        }}>
                          <div
                            role="button" tabIndex={0}
                            aria-expanded={isExpanded}
                            onClick={() => setClienteExpandido(isExpanded ? null : c.idClient)}
                            onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setClienteExpandido(isExpanded ? null : c.idClient))}
                            style={{
                              display: 'grid', gridTemplateColumns: '1fr 72px 72px 84px',
                              gap: 8, alignItems: 'center',
                              padding: '10px 16px',
                              cursor: 'pointer',
                            }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                              <Avatar nombre={`${nombre} ${apellidos}`} size={32} imgUrl={imgUrl} />
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nombre}</p>
                                {apellidos && <p style={{ fontSize: 12, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{apellidos}</p>}
                              </div>
                              {isExpanded
                                ? <ChevronUp size={14} style={{ color: 'var(--text-3)', flexShrink: 0 }} aria-hidden="true" />
                                : <ChevronDown size={14} style={{ color: 'var(--text-3)', flexShrink: 0 }} aria-hidden="true" />}
                            </div>
                            <p style={{ fontFamily: 'Outfit', fontSize: 20, fontWeight: 700, color: 'var(--green)', textAlign: 'center', lineHeight: 1 }}>{c.semana}</p>
                            <p style={{ fontFamily: 'Outfit', fontSize: 20, fontWeight: 700, color: 'var(--text-0)', textAlign: 'center', lineHeight: 1 }}>{c.mes}</p>
                            <p style={{ fontFamily: 'Outfit', fontSize: 20, fontWeight: 700, color: 'var(--amber)', textAlign: 'center', lineHeight: 1 }}>{c.mediaSemana}</p>
                          </div>

                          {isExpanded && (
                            <div style={{ padding: '4px 16px 14px 58px' }}>
                              {c.clases.length === 0 ? (
                                <p style={{ fontSize: 12, color: 'var(--text-3)', padding: '6px 0' }}>Sin asistencias registradas</p>
                              ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                  <p style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>
                                    {c.clases.length} clase{c.clases.length !== 1 ? 's' : ''} asistida{c.clases.length !== 1 ? 's' : ''}
                                  </p>
                                  {(() => {
                                    const WEEK_COLORS = [
                                      { bg: 'rgba(34,197,94,0.12)',  border: 'rgba(34,197,94,0.35)',  dot: '#22c55e' },
                                      { bg: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.35)', dot: '#3b82f6' },
                                      { bg: 'rgba(251,146,60,0.12)', border: 'rgba(251,146,60,0.35)', dot: '#fb923c' },
                                      { bg: 'rgba(168,85,247,0.12)', border: 'rgba(168,85,247,0.35)', dot: '#a855f7' },
                                      { bg: 'rgba(236,72,153,0.12)', border: 'rgba(236,72,153,0.35)', dot: '#ec4899' },
                                      { bg: 'rgba(20,184,166,0.12)', border: 'rgba(20,184,166,0.35)', dot: '#14b8a6' },
                                    ]
                                    const weekKeys = [...new Set(c.clases.map(cl => getISOWeek(cl.dateStart)))]
                                    const weekColorMap = Object.fromEntries(weekKeys.map((w, i) => [w, WEEK_COLORS[i % WEEK_COLORS.length]]))
                                    return c.clases.map(cl => {
                                      const week = getISOWeek(cl.dateStart)
                                      const col = weekColorMap[week]
                                      return (
                                        <div key={cl.salaId} style={{
                                          display: 'flex', alignItems: 'center', gap: 10,
                                          padding: '8px 12px', borderRadius: 10,
                                          background: col.bg, border: `1px solid ${col.border}`,
                                        }}>
                                          <CheckCircle2 size={14} style={{ color: col.dot, flexShrink: 0 }} aria-hidden="true" />
                                          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                                            <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                              {cl.name}
                                            </p>
                                            <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-0)', flexShrink: 0 }}>
                                              Semana {week} · {fmtDateES(cl.dateStart)} · {fmtHora(cl.dateStart)}
                                            </p>
                                          </div>
                                        </div>
                                      )
                                    })
                                  })()}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </Card>
              )}
            </div>
          )}
        </div>
      )}


      {/* Modal: clases no asistidas del cliente */}
      {clienteDetalle && (() => {
        const noShows = allUsers
          .filter(u => u.idClient === clienteDetalle.idClient && !u.verify)
          .sort((a, b) => new Date(a.sala.dateStart) - new Date(b.sala.dateStart))
        return (
          <Modal open onClose={() => setClienteDetalle(null)}
                 title={clientName(clienteDetalle.idClient) || `Cliente #${clienteDetalle.idClient}`}
                 subtitle={`${noShows.length} clase${noShows.length !== 1 ? 's' : ''} sin asistir`}
                 maxWidth={520}>
            <div style={{ overflowY: 'auto', maxHeight: '60vh', padding: '8px 32px 28px' }}>
              {noShows.length === 0 ? (
                <p style={{ textAlign: 'center', padding: 40, fontSize: 13, color: 'var(--text-3)' }}>Sin no-shows</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {noShows.map(u => (
                    <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px', borderRadius: 14, background: 'var(--bg-3)', border: '1px solid var(--line)' }}>
                      <XCircle size={16} style={{ color: 'var(--red)', flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-0)' }}>{u.sala.name || u.sala.nameTraining}</p>
                        <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{fmtDateES(u.sala.dateStart)} · {fmtHora(u.sala.dateStart)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ padding: '16px 32px', borderTop: '1px solid var(--line)' }}>
              <Btn variant="secondary" size="md" onClick={() => setClienteDetalle(null)} style={{ width: '100%', justifyContent: 'center' }}>Cerrar</Btn>
            </div>
          </Modal>
        )
      })()}

      {/* Confirm dialog */}
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
