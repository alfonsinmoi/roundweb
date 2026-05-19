import { useState, useEffect, useMemo, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Loader2, Filter, RotateCcw, CheckCircle2, XCircle,
  UserMinus, ChevronDown, ChevronUp, Users, CalendarDays,
  AlertTriangle, ChevronRight, ArrowLeft, Grid3x3, TrendingUp, TrendingDown,
  Lightbulb, AlertCircle, ArrowUpRight, ArrowDownRight, Zap,
  HeartPulse, ExternalLink, Activity, Layers, Info,
} from 'lucide-react'
import { Card, Badge, Btn, Avatar } from '../components/UI'
import ConfirmDialog from '../components/ConfirmDialog'
import Modal from '../components/Modal'
import { useToast } from '../components/Toast'
import InformeTabs from '../components/informe/InformeTabs'
import InformeToolbar from '../components/informe/InformeToolbar'
import InfoTip from '../components/informe/InfoTip'
import AnalisisClusters from './AnalisisClusters'
import {
  getSalasByRange, invalidateSalasCache, getClientes, getActividades,
  getUsuariosBySala, updateUsuarioSala, userRemoveSala,
} from '../utils/api'
import { useAuth } from '../contexts/AuthContext'
import { getRoundIdentity } from '../utils/configApi'

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

const VALID_TABS = ['faltas', 'control', 'distribucion', 'revisar', 'riesgo', 'patrones', 'retos']

export default function InformeAsistencia() {
  const toast    = useToast()
  const params   = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  // El tab activo se deriva de la URL: /informe-asistencia/:tab.
  // Si entran al menú sin :tab → redirigimos a 'revisar' (que es el
  // dashboard global). Antes mostrábamos un selector de menú intermedio;
  // ahora todos los informes están bajo "Para revisar" como punto de entrada.
  useEffect(() => {
    if (!params.tab) {
      navigate('/informe-asistencia/revisar', { replace: true })
    }
  }, [params.tab, navigate])
  const tab = VALID_TABS.includes(params.tab) ? params.tab : 'revisar'
  const setTab = (next) => {
    navigate(`/informe-asistencia/${next || 'revisar'}`)
  }

  const [salas, setSalas]                   = useState([])
  const [usuariosPorSala, setUsuariosPorSala] = useState({})
  const [loading, setLoading]               = useState(false)
  const [loadingUsuarios, setLoadingUsuarios] = useState({})
  const [actionLoading, setActionLoading]   = useState('')
  const [catActividades, setCatActividades] = useState([])
  // Retos: lista completa para la pestaña "Retos" y mapa {idCliente: nº retos}
  // para el score de "Clientes en riesgo".
  const [retos, setRetos] = useState([])
  const [retosByClient, setRetosByClient] = useState({})

  const [confirmState, setConfirmState] = useState({ open: false, usuario: null, salaId: null })

  // Filtros
  const hoy = new Date()
  const [desde, setDesde]         = useState(fmtDate(addDays(hoy, -DEFAULT_DAYS_BACK)))
  const [hasta, setHasta]         = useState(fmtDate(addDays(hoy, DEFAULT_DAYS_FORWARD)))
  const [claseFilter, setClaseFilter] = useState('')
  const [showFilters, setShowFilters] = useState(false)

  // tab y setTab se derivan ahora de la URL (ver arriba). No hay useState local.
  const [expandedSalas, setExpandedSalas] = useState(new Set())
  const [clienteDetalle, setClienteDetalle] = useState(null)
  const [clientMap, setClientMap]   = useState({})
  const [infoPopover, setInfoPopover] = useState(null)  // id del botón cuya info está abierta en la pantalla menú

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

  // Cargar retos (los necesita 'retos' y 'riesgo'). Solo una vez por sesión.
  const identity = useMemo(() => getRoundIdentity(user), [user])
  useEffect(() => {
    if (!identity?.managerId) return
    if (tab !== 'retos' && tab !== 'riesgo') return
    if (retos.length > 0) return    // ya cargados
    import('../utils/configApi').then(mod => mod.retosList(identity)).then(arr => {
      setRetos(arr || [])
      // Construir mapa cliente → nº de retos en los que participa
      const byCli = {}
      for (const r of (arr || [])) {
        for (const p of (r.participantes || [])) {
          if (!p || typeof p !== 'object') continue
          const cli = p.idClient || p.clienteId || p.idCliente
          if (cli) byCli[String(cli)] = (byCli[String(cli)] || 0) + 1
        }
      }
      setRetosByClient(byCli)
    }).catch(e => console.warn('retosList:', e?.message))
  }, [tab, identity, retos.length])

  const filteredSalas = useMemo(() => {
    const dDesde = new Date(desde + 'T00:00:00')
    const dHasta = new Date(hasta + 'T23:59:59')
    // Mapa idActividad → nombre canónico, para matchear igual que el desplegable
    const actNameById = new Map()
    for (const a of catActividades) actNameById.set(String(a.id), actNombre(a))
    const useId = salas.some(s => s.idActividad != null)
    const salaActName = (s) => {
      if (useId && s.idActividad != null) {
        return actNameById.get(String(s.idActividad)) || s.name || s.nameTraining
      }
      return s.name || s.nameTraining
    }
    return salas.filter(s => {
      if (!s.dateStart) return false
      const d = new Date(s.dateStart)
      if (d < dDesde || d > dHasta) return false
      if (claseFilter && salaActName(s) !== claseFilter) return false
      return true
    }).sort((a, b) => new Date(a.dateStart) - new Date(b.dateStart))
  }, [salas, desde, hasta, claseFilter, catActividades])

  // Lista de ACTIVIDADES (no clases) disponibles: nombre canónico del catálogo
  // si la sala tiene idActividad, o el nombre crudo de la sala como fallback.
  // Antes mostraba todos los nombres de clases (Ciclo 15:05, Ciclo 18:15…),
  // confundiendo "clase concreta" con "tipo de actividad".
  const clasesDisponibles = useMemo(() => {
    const actNameById = new Map()
    for (const a of catActividades) actNameById.set(String(a.id), actNombre(a))
    const useId = salas.some(s => s.idActividad != null)
    const names = new Set()
    for (const s of salas) {
      if (useId && s.idActividad != null) {
        const n = actNameById.get(String(s.idActividad))
        if (n) names.add(n)
      } else {
        const n = s.name || s.nameTraining
        if (n) names.add(n)
      }
    }
    return [...names].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }))
  }, [salas, catActividades])

  // ── Load usuarios ────────────────────────────────────────────────────────────
  // Acumulador de fallos de la TANDA en curso. Cuando termina la tanda
  // (decremento a 0) mostramos UN solo toast con el resumen, en vez de
  // 50 toasts "Error cargando usuarios de la sala" (lo que pasaba antes
  // cuando NoofitPro empezaba a 502/429 con muchas salas).
  const cargaUsersRef = useRef({ pendientes: 0, errores: 0, ultimoErr: null })

  const loadUsuarios = async (salaId) => {
    if (usuariosPorSala[salaId]) return
    setLoadingUsuarios(prev => ({ ...prev, [salaId]: true }))
    cargaUsersRef.current.pendientes += 1
    try {
      let users
      try {
        users = await getUsuariosBySala(salaId)
      } catch (e1) {
        // 1 retry con pausa pequeña (mitiga rate limit transitorio de NoofitPro)
        await new Promise(r => setTimeout(r, 400 + Math.random() * 400))
        users = await getUsuariosBySala(salaId)
      }
      setUsuariosPorSala(prev => ({ ...prev, [salaId]: users }))
    } catch (e) {
      cargaUsersRef.current.errores += 1
      cargaUsersRef.current.ultimoErr = e?.message || 'error'
      console.warn(`getUsuariosBySala(${salaId}):`, e?.message || e)
    } finally {
      cargaUsersRef.current.pendientes -= 1
      if (cargaUsersRef.current.pendientes === 0 && cargaUsersRef.current.errores > 0) {
        const n = cargaUsersRef.current.errores
        toast.error(`${n} sala${n !== 1 ? 's' : ''} sin datos de usuarios. ` +
          `(NoofitPro pudo limitar peticiones; recarga si faltan KPIs.)`)
        cargaUsersRef.current.errores  = 0
        cargaUsersRef.current.ultimoErr = null
      }
    }
    setLoadingUsuarios(prev => ({ ...prev, [salaId]: false }))
  }

  useEffect(() => {
    if (salas.length === 0) return
    const ahora = Date.now()
    cargaUsersRef.current = { pendientes: 0, errores: 0, ultimoErr: null }
    const salasACargar = filteredSalas
      .filter(s => s.dateStart && new Date(s.dateStart).getTime() < ahora)
      .filter(s => !usuariosPorSala[s.id])
    // Concurrencia limitada: 5 a la vez. Lanza primero las más recientes
    // para que los KPIs visibles se rellenen cuanto antes.
    const ordenadas = [...salasACargar].sort(
      (a, b) => new Date(b.dateStart) - new Date(a.dateStart))
    const CONCURRENCY = 5
    let cancelado = false
    ;(async () => {
      for (let i = 0; i < ordenadas.length; i += CONCURRENCY) {
        if (cancelado) return
        const slice = ordenadas.slice(i, i + CONCURRENCY)
        await Promise.all(slice.map(s => loadUsuarios(s.id)))
      }
    })()
    return () => { cancelado = true }
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

  // ── Distribución por actividad × hora por mes ─────────────────────────────────
  // Usamos la misma resolución que el filtro de Control de Asistencia: agrupar
  // por idActividad cuando esté presente (resolviendo el nombre vía catActividades),
  // y caer al nombre de la sala SOLO si no hay idActividad en ningún sala del rango.
  const distribucionActividadPorMes = useMemo(() => {
    const ahora = Date.now()

    // Mapa idActividad → nombre canónico
    const actNameById = new Map()
    for (const a of catActividades) actNameById.set(String(a.id), actNombre(a))

    // ¿Hay idActividad en al menos una sala? → agrupar por idActividad
    const useId = filteredSalas.some(s => s.idActividad != null)

    // Resuelve la actividad de una sala
    const resolveActividad = (s) => {
      if (useId && s.idActividad != null) {
        const id = String(s.idActividad)
        return actNameById.get(id) ?? `Actividad #${id}`
      }
      return s.name || s.nameTraining || `Actividad`
    }

    const byMonth = new Map() // 'YYYY-MM' → { ym, fecha, actividades: Map(name → { matrix[24], clases[24], total, totalClases }) }
    const allActs = new Map() // name → { totalClientes, totalClases }

    for (const s of filteredSalas) {
      if (!s.dateStart) continue
      const t = new Date(s.dateStart).getTime()
      if (t > ahora) continue

      const d         = new Date(s.dateStart)
      const ym        = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const h         = d.getHours()
      const actividad = resolveActividad(s)

      if (!byMonth.has(ym)) {
        byMonth.set(ym, { ym, fecha: new Date(d.getFullYear(), d.getMonth(), 1), actividades: new Map() })
      }
      const m = byMonth.get(ym)
      if (!m.actividades.has(actividad)) {
        m.actividades.set(actividad, {
          matrix: Array(24).fill(0),
          clases: Array(24).fill(0),
          total: 0, totalClases: 0,
        })
      }
      const a  = m.actividades.get(actividad)
      const us = usuariosPorSala[s.id]
      const n  = Array.isArray(us) ? us.length : 0
      a.matrix[h] += n
      a.clases[h] += 1
      a.total      += n
      a.totalClases++

      if (!allActs.has(actividad)) allActs.set(actividad, { totalClientes: 0, totalClases: 0 })
      const ag = allActs.get(actividad)
      ag.totalClientes += n
      ag.totalClases++
    }

    // Rango horario activo + máximos globales
    let minH = 24, maxH = -1
    let globalMaxClientes = 0, globalMaxClases = 0
    for (const m of byMonth.values()) {
      for (const a of m.actividades.values()) {
        for (let h = 0; h < 24; h++) {
          if (a.matrix[h] > globalMaxClientes) globalMaxClientes = a.matrix[h]
          if (a.clases[h] > globalMaxClases)   globalMaxClases   = a.clases[h]
          if (a.clases[h] > 0) {
            if (h < minH) minH = h
            if (h > maxH) maxH = h
          }
        }
      }
    }
    if (maxH < 0) { minH = 7; maxH = 22 }

    // Lista de actividades ordenada por importancia global (clientes primero, clases empate)
    const actividades = [...allActs.entries()]
      .map(([name, agg]) => ({ name, ...agg }))
      .sort((a, b) => (b.totalClientes - a.totalClientes) || (b.totalClases - a.totalClases))

    const meses = [...byMonth.values()].sort((a, b) => b.fecha - a.fecha)
    return { meses, actividades, minHour: minH, maxHour: maxH, globalMaxClientes, globalMaxClases }
  }, [filteredSalas, usuariosPorSala, catActividades])

  // ── Distribución de clases: heatmap día × hora por mes ────────────────────────
  const distribucionPorMes = useMemo(() => {
    const ahora = Date.now()
    const byMonth = new Map() // 'YYYY-MM' → { matrix:[7][24], totalClientes, totalClases, peakDow, peakHour, peakValue }

    for (const s of filteredSalas) {
      if (!s.dateStart) continue
      const t = new Date(s.dateStart).getTime()
      if (t > ahora) continue // solo pasadas

      const d   = new Date(s.dateStart)
      const ym  = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const dow = d.getDay() === 0 ? 6 : d.getDay() - 1   // 0=Lun … 6=Dom
      const h   = d.getHours()

      if (!byMonth.has(ym)) {
        byMonth.set(ym, {
          ym,
          fecha: new Date(d.getFullYear(), d.getMonth(), 1),
          matrix: Array.from({ length: 7 }, () => Array(24).fill(0)),
          clases:  Array.from({ length: 7 }, () => Array(24).fill(0)),
          totalClientes: 0,
          totalClases:   0,
        })
      }
      const m  = byMonth.get(ym)
      const us = usuariosPorSala[s.id]
      // Si están cargados los usuarios usamos su número; si no, contamos como 0 clientes pero sí 1 clase
      const nClientes = Array.isArray(us) ? us.length : 0
      m.matrix[dow][h] += nClientes
      m.clases[dow][h] += 1
      m.totalClientes  += nClientes
      m.totalClases    += 1
    }

    // Calcular pico y rango horario activo por mes y global.
    // Para la "Franja activa" descartamos horas con actividad despreciable
    // (datos fantasma: salas con 0 inscritos o test) — solo contamos una
    // hora si la SUMA de clases en toda la semana a esa hora supera un
    // umbral relativo al pico horario.
    let globalMaxClientes = 0
    let globalMaxClases   = 0
    // 1ª pasada: max por hora-del-día (sumando todos los días de la semana)
    const totalClasesPorHora = Array(24).fill(0)
    for (const m of byMonth.values()) {
      for (let dw = 0; dw < 7; dw++) {
        for (let h = 0; h < 24; h++) {
          totalClasesPorHora[h] += m.clases[dw][h]
        }
      }
    }
    const picoClasesHora = Math.max(1, ...totalClasesPorHora)
    // Umbral: ≥ 5% del pico horario Y al menos 3 clases en todo el periodo
    const umbralFranja = Math.max(3, Math.floor(picoClasesHora * 0.05))

    let minHour = 24, maxHour = -1
    for (const m of byMonth.values()) {
      let peak = { dow: 0, hour: 0, value: 0 }
      for (let dw = 0; dw < 7; dw++) {
        for (let h = 0; h < 24; h++) {
          const v = m.matrix[dw][h]
          if (v > peak.value) peak = { dow: dw, hour: h, value: v }
          if (v > globalMaxClientes) globalMaxClientes = v
          const c = m.clases[dw][h]
          if (c > globalMaxClases) globalMaxClases = c
        }
      }
      m.peak = peak
    }
    // Franja activa: solo horas que superan el umbral en el global
    for (let h = 0; h < 24; h++) {
      if (totalClasesPorHora[h] >= umbralFranja) {
        if (h < minHour) minHour = h
        if (h > maxHour) maxHour = h
      }
    }
    if (maxHour < 0) { minHour = 7; maxHour = 22 }

    // Devolvemos ordenado cronológicamente (más reciente primero)
    const lista = [...byMonth.values()].sort((a, b) => b.fecha - a.fecha)

    return { meses: lista, minHour, maxHour, globalMaxClientes, globalMaxClases }
  }, [filteredSalas, usuariosPorSala])

  // ── ANÁLISIS PARA REVISAR: ocupación por hora + recomendaciones ───────────────
  const analisisRevisar = useMemo(() => {
    const ahora = Date.now()
    const dosSemMs = 14 * 24 * 60 * 60 * 1000

    // Mapa idActividad → nombre canónico (igual que en distribucionActividad)
    const actNameById = new Map()
    for (const a of catActividades) actNameById.set(String(a.id), actNombre(a))
    const useId = filteredSalas.some(s => s.idActividad != null)
    const resolveActividad = (s) => {
      if (useId && s.idActividad != null) {
        const id = String(s.idActividad)
        return actNameById.get(id) ?? `Actividad #${id}`
      }
      return s.name || s.nameTraining || `Actividad`
    }

    // Por hora: { clases, inscritos, aforo, asistencias, sinAforo, recientes, antiguas }
    const porHora = Array.from({ length: 24 }, () => ({
      clases: 0, inscritos: 0, aforo: 0, asistencias: 0, sinAforo: 0,
      ocupacionRecienteI: 0, ocupacionRecienteA: 0,
      ocupacionAntiguaI:  0, ocupacionAntiguaA:  0,
    }))

    // Por (hora, actividad): para detectar actividad líder en horas pico
    const porHoraAct = new Map() // 'hora|actividad' → { clases, inscritos, aforo }

    for (const s of filteredSalas) {
      if (!s.dateStart) continue
      const t = new Date(s.dateStart).getTime()
      if (t > ahora) continue

      const h    = new Date(s.dateStart).getHours()
      const us   = usuariosPorSala[s.id]
      const insc = Array.isArray(us) ? us.length : 0
      const verif = Array.isArray(us) ? us.filter(u => u.verify).length : 0
      const af   = Number(s.aforo) > 0 ? Number(s.aforo) : 0
      const slot = porHora[h]
      slot.clases++
      slot.inscritos   += insc
      slot.asistencias += verif
      if (af > 0) slot.aforo += af
      else        slot.sinAforo++

      // Para tendencia: comparar últimas 2 semanas vs 2 semanas anteriores
      if (ahora - t <= dosSemMs) {
        slot.ocupacionRecienteI += insc
        slot.ocupacionRecienteA += af
      } else if (ahora - t <= 2 * dosSemMs) {
        slot.ocupacionAntiguaI += insc
        slot.ocupacionAntiguaA += af
      }

      const act = resolveActividad(s)
      const k = `${h}|${act}`
      if (!porHoraAct.has(k)) porHoraAct.set(k, { clases: 0, inscritos: 0, aforo: 0, actividad: act, hora: h })
      const e = porHoraAct.get(k)
      e.clases++
      e.inscritos += insc
      if (af > 0) e.aforo += af
    }

    // Calcular % ocupación por hora
    const horasAnalizadas = porHora.map((s, h) => {
      const ocup = s.aforo > 0 ? Math.round((s.inscritos / s.aforo) * 100) : null
      const asist = s.inscritos > 0 ? Math.round((s.asistencias / s.inscritos) * 100) : null
      const ocupRec = s.ocupacionRecienteA > 0 ? (s.ocupacionRecienteI / s.ocupacionRecienteA) : null
      const ocupAnt = s.ocupacionAntiguaA  > 0 ? (s.ocupacionAntiguaI  / s.ocupacionAntiguaA)  : null
      const tendencia = (ocupRec != null && ocupAnt != null) ? Math.round((ocupRec - ocupAnt) * 100) : null
      return { hora: h, ...s, ocupacion: ocup, asistencia: asist, tendencia }
    }).filter(x => x.clases > 0)

    // Recomendaciones
    const recomendaciones = []

    // 1) Saturación crítica
    horasAnalizadas
      .filter(h => h.ocupacion != null && h.ocupacion >= 85 && h.clases >= 3)
      .sort((a, b) => b.ocupacion - a.ocupacion)
      .forEach(h => {
        // Buscar la actividad líder en esta hora
        const acts = [...porHoraAct.values()]
          .filter(e => e.hora === h.hora && e.aforo > 0)
          .map(e => ({ ...e, ocup: e.inscritos / e.aforo }))
          .sort((a, b) => b.ocup - a.ocup)
        const top = acts[0]
        recomendaciones.push({
          tipo: 'saturacion',
          severidad: 'alta',
          hora: h.hora,
          icon: AlertTriangle,
          color: 'var(--red)',
          titulo: `Hora ${String(h.hora).padStart(2, '0')}:00 — saturación crítica`,
          texto:
            `Ocupación media del ${h.ocupacion}% en ${h.clases} clases del periodo. ` +
            (top ? `La actividad más demandada es "${top.actividad}" (${Math.round(top.ocup * 100)}% de aforo). ` : '') +
            `Recomendación: añadir 1-2 clases adicionales en esta franja, preferentemente de "${top?.actividad ?? 'la actividad líder'}", o aumentar aforo.`,
        })
      })

    // 2) Tendencia ascendente con ocupación elevada
    horasAnalizadas
      .filter(h => h.tendencia != null && h.tendencia >= 15 && h.ocupacion != null && h.ocupacion >= 60)
      .sort((a, b) => b.tendencia - a.tendencia)
      .slice(0, 3)
      .forEach(h => {
        recomendaciones.push({
          tipo: 'tendencia',
          severidad: 'media',
          hora: h.hora,
          icon: TrendingUp,
          color: 'var(--amber)',
          titulo: `Hora ${String(h.hora).padStart(2, '0')}:00 — tendencia al alza`,
          texto:
            `La ocupación ha subido +${h.tendencia} pp en las últimas 2 semanas (de ${Math.round((h.ocupacionAntiguaI / Math.max(1,h.ocupacionAntiguaA)) * 100)}% a ${Math.round((h.ocupacionRecienteI / Math.max(1,h.ocupacionRecienteA)) * 100)}%). ` +
            `Anticipa: si la tendencia sigue, esta hora se saturará en pocas semanas. Plantea reforzar la oferta antes.`,
        })
      })

    // 3) Sobreoferta (muchas clases, baja ocupación)
    horasAnalizadas
      .filter(h => h.ocupacion != null && h.ocupacion < 40 && h.clases >= 4)
      .sort((a, b) => a.ocupacion - b.ocupacion)
      .slice(0, 3)
      .forEach(h => {
        recomendaciones.push({
          tipo: 'sobreoferta',
          severidad: 'baja',
          hora: h.hora,
          icon: ArrowDownRight,
          color: '#5B9CF6',
          titulo: `Hora ${String(h.hora).padStart(2, '0')}:00 — sobreoferta`,
          texto:
            `Solo el ${h.ocupacion}% de ocupación en ${h.clases} clases. ` +
            `Recomendación: consolidar clases (de ${h.clases} a ${Math.max(1, Math.round(h.clases * h.ocupacion / 80))}) o reasignar a una franja con más demanda.`,
        })
      })

    // 4) Asistencia baja (no-shows) en alguna hora con buena reserva
    horasAnalizadas
      .filter(h => h.asistencia != null && h.asistencia < 70 && h.inscritos >= 20)
      .sort((a, b) => a.asistencia - b.asistencia)
      .slice(0, 2)
      .forEach(h => {
        recomendaciones.push({
          tipo: 'noshow',
          severidad: 'media',
          hora: h.hora,
          icon: AlertCircle,
          color: 'var(--red)',
          titulo: `Hora ${String(h.hora).padStart(2, '0')}:00 — alta tasa de no-show`,
          texto:
            `Ratio de asistencia del ${h.asistencia}% (de ${h.inscritos} reservas, ${h.asistencias} asistencias). ` +
            `Aunque haya ocupación nominal, muchos no aparecen. Plantea recordatorios automáticos o lista de espera para liberar plazas.`,
        })
      })

    // 5) Actividad estrella saturada en una hora
    const actividadesPicoAct = [...porHoraAct.values()]
      .filter(e => e.aforo >= 30 && e.clases >= 3 && e.inscritos / e.aforo >= 0.85)
      .sort((a, b) => (b.inscritos / b.aforo) - (a.inscritos / a.aforo))
      .slice(0, 3)
    actividadesPicoAct.forEach(e => {
      const ocup = Math.round((e.inscritos / e.aforo) * 100)
      // Evitar duplicar si ya hay saturación crítica para esa hora
      const yaCritica = recomendaciones.some(r => r.tipo === 'saturacion' && r.hora === e.hora)
      if (yaCritica) return
      recomendaciones.push({
        tipo: 'actividadEstrella',
        severidad: 'alta',
        hora: e.hora,
        icon: Zap,
        color: 'var(--green)',
        titulo: `"${e.actividad}" — saturada a las ${String(e.hora).padStart(2, '0')}:00`,
        texto:
          `${ocup}% de aforo en ${e.clases} sesiones de "${e.actividad}" a esta hora. ` +
          `Es una actividad estrella en esta franja: duplica la oferta o pasa a aforo mayor.`,
      })
    })

    // Ordenar recomendaciones por severidad (alta → media → baja)
    const sevRank = { alta: 0, media: 1, baja: 2 }
    recomendaciones.sort((a, b) => (sevRank[a.severidad] ?? 9) - (sevRank[b.severidad] ?? 9))

    return { horasAnalizadas, recomendaciones, totalSalas: filteredSalas.filter(s => new Date(s.dateStart).getTime() <= ahora).length }
  }, [filteredSalas, usuariosPorSala, catActividades])

  // ── ANÁLISIS CLIENTES EN RIESGO ────────────────────────────────────────────────
  const analisisRiesgo = useMemo(() => {
    const hoy  = Date.now()
    const DAY  = 24 * 60 * 60 * 1000
    const D7   =  7 * DAY
    const D14  = 14 * DAY
    const D28  = 28 * DAY
    const D56  = 56 * DAY

    // Acumulamos por cliente desde allUsers (que viene de filteredSalas + usuariosPorSala)
    const map = new Map() // idClient → entry
    for (const u of allUsers) {
      if (!u.sala?.dateStart) continue
      const t  = new Date(u.sala.dateStart).getTime()
      const id = u.idClient
      if (!map.has(id)) {
        map.set(id, {
          idClient: id,
          nameClient: u.nameClient,
          pictureClient: u.pictureClient,
          recent14_v: 0, prev14_v: 0,
          recent4w_count: 0, prev4w_count: 0,
          nextWeekReservas: 0,
          lastAttendance: 0,
          totalReservas: 0, totalAsistencias: 0,
          recent_hours: {},
          prev_hours:   {},
        })
      }
      const e = map.get(id)
      e.totalReservas++
      if (u.verify) e.totalAsistencias++

      // Asistencias verificadas últimos 14 vs 14 anteriores
      if (t >= hoy - D14 && t <= hoy && u.verify) e.recent14_v++
      else if (t >= hoy - D28 && t < hoy - D14 && u.verify) e.prev14_v++

      // Última asistencia
      if (u.verify && t <= hoy && t > e.lastAttendance) e.lastAttendance = t

      // Reservas próximas (futuras, 7d)
      if (t > hoy && t <= hoy + D7) e.nextWeekReservas++

      // Frecuencia (reservas) últimas 4sem vs 4sem anteriores
      if (t >= hoy - D28 && t <= hoy) e.recent4w_count++
      else if (t >= hoy - D56 && t < hoy - D28) e.prev4w_count++

      // Distribución de horas (para detectar cambio de patrón)
      const hour = new Date(u.sala.dateStart).getHours()
      if (t >= hoy - D28 && t <= hoy)             e.recent_hours[hour] = (e.recent_hours[hour] ?? 0) + 1
      else if (t >= hoy - D56 && t < hoy - D28)   e.prev_hours[hour]   = (e.prev_hours[hour]   ?? 0) + 1
    }

    // Datos extra del cliente desde clientMap (foto buena, nombre/apellidos, fecha alta…)
    const pickCreationDate = (c) =>
      c?.creationDate ?? c?.dateCreate ?? c?.creado ?? c?.fechaAlta ?? c?.created ?? c?.createdAt ?? null

    // TVD: Total Variation Distance entre dos distribuciones
    const tvd = (a, b) => {
      const sumA = Object.values(a).reduce((x, y) => x + y, 0) || 0
      const sumB = Object.values(b).reduce((x, y) => x + y, 0) || 0
      if (sumA === 0 || sumB === 0) return 0   // sin datos en alguna ventana, no penalizamos
      const keys = new Set([...Object.keys(a), ...Object.keys(b)])
      let d = 0
      for (const k of keys) d += Math.abs((a[k] ?? 0) / sumA - (b[k] ?? 0) / sumB)
      return d / 2
    }

    const list = []
    for (const e of map.values()) {
      const score   = []
      const factores = []
      const c       = clientMap[String(e.idClient)] ?? null
      const creado  = pickCreationDate(c)
      const diasAlta = creado ? Math.floor((hoy - new Date(creado).getTime()) / DAY) : null

      // 1) Caída drástica de asistencia (peso 30)
      if (e.prev14_v > 0) {
        const delta = (e.recent14_v - e.prev14_v) / e.prev14_v
        if (delta <= -0.5) {
          score.push(30)
          factores.push({ key: 'caida', label: `Asistencia bajó ${Math.round(Math.abs(delta) * 100)}% en últimas 2 semanas`, severidad: 'alta' })
        } else if (delta <= -0.3) {
          score.push(15)
          factores.push({ key: 'caida_leve', label: `Asistencia bajando ${Math.round(Math.abs(delta) * 100)}%`, severidad: 'media' })
        }
      }

      // 2) Inactividad reciente (peso 25)
      if (e.lastAttendance > 0) {
        const dias = Math.floor((hoy - e.lastAttendance) / DAY)
        let pts = 0
        if (dias >= 22)      pts = 25
        else if (dias >= 15) pts = 18
        else if (dias >= 8)  pts = 10
        if (pts > 0) {
          score.push(pts)
          factores.push({ key: 'inactividad', label: `Sin asistir desde hace ${dias} días`, severidad: pts >= 18 ? 'alta' : 'media' })
        }
      } else if (e.totalReservas > 0) {
        // Tiene reservas pero ninguna asistencia verificada → muy mal
        score.push(25)
        factores.push({ key: 'sin_asistencias', label: 'Sin asistencias verificadas en el periodo', severidad: 'alta' })
      }

      // 3) Sin reservas próximas (peso 15)
      if (e.nextWeekReservas === 0) {
        score.push(15)
        factores.push({ key: 'sin_reservas', label: 'Sin reservas en próximos 7 días', severidad: 'media' })
      } else if (e.nextWeekReservas === 1) {
        score.push(5)
      }

      // 4) Frecuencia bajando (peso 15)
      const recF  = e.recent4w_count / 4
      const prevF = e.prev4w_count / 4
      if (prevF > 0) {
        const ratio = recF / prevF
        if (ratio < 0.6) {
          score.push(15)
          factores.push({ key: 'frecuencia', label: `Frecuencia ${recF.toFixed(1)}/sem (era ${prevF.toFixed(1)}/sem)`, severidad: 'alta' })
        } else if (ratio < 0.8) {
          score.push(7)
          factores.push({ key: 'frecuencia_leve', label: `Frecuencia bajando (${recF.toFixed(1)} vs ${prevF.toFixed(1)}/sem)`, severidad: 'media' })
        }
      }

      // 5) Cambio de patrón horario (peso 10)
      const cambioPatron = tvd(e.recent_hours, e.prev_hours)
      if (cambioPatron > 0.5) {
        score.push(10)
        factores.push({ key: 'patron', label: `Patrón horario alterado (${Math.round(cambioPatron * 100)}% divergencia)`, severidad: 'media' })
      }

      // 6) Cliente nuevo sin consolidar (peso 5)
      if (diasAlta != null && diasAlta < 30 && e.totalAsistencias < 4) {
        score.push(5)
        factores.push({ key: 'nuevo', label: `Cliente nuevo (${diasAlta}d) con poca asistencia`, severidad: 'media' })
      }

      // 7) Retos (señal positiva: cliente engaged): RESTA puntos del score.
      //    -5 si participa en 1 reto, -10 si en 2+. No baja del 0.
      const nRetos = retosByClient[String(e.idClient)] || 0
      let restaRetos = 0
      if (nRetos >= 2) {
        restaRetos = 10
        factores.push({ key: 'retos', label: `Participa en ${nRetos} retos (engagement alto)`, severidad: 'positiva' })
      } else if (nRetos === 1) {
        restaRetos = 5
        factores.push({ key: 'retos', label: `Participa en 1 reto`, severidad: 'positiva' })
      }

      const total = Math.max(0, Math.min(100, score.reduce((s, n) => s + n, 0) - restaRetos))
      const pctAsistencia = e.totalReservas > 0 ? Math.round((e.totalAsistencias / e.totalReservas) * 100) : null
      const nivel = total >= 75 ? 'critico' : total >= 50 ? 'riesgo' : total >= 30 ? 'atencion' : 'sano'

      list.push({
        ...e,
        cliente: c,
        diasAlta,
        score: total,
        nivel,
        factores,
        pctAsistencia,
      })
    }

    list.sort((a, b) => b.score - a.score || b.factores.length - a.factores.length)

    const totales = {
      criticos:  list.filter(c => c.nivel === 'critico').length,
      riesgo:    list.filter(c => c.nivel === 'riesgo').length,
      atencion:  list.filter(c => c.nivel === 'atencion').length,
      sanos:     list.filter(c => c.nivel === 'sano').length,
    }

    return { list, totales }
  }, [allUsers, clientMap, retosByClient])

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
            { id: 'faltas', label: 'Faltas de asistencia', desc: 'Reincidentes con clases no asistidas',
              icon: UserMinus, color: 'var(--red)', bg: 'rgba(248,113,113,0.12)',
              info: 'Lista de clientes que han faltado a clases en los últimos 7 días, ordenados por número de faltas. Útil para detectar caída de hábito y contactar antes de que se den de baja. Puedes ver el detalle de qué clase faltaron y el motivo si está registrado.' },
            { id: 'control', label: 'Control de asistencia', desc: 'Asistencias por cliente y actividad',
              icon: Users, color: 'var(--green)', bg: 'var(--green-bg)',
              info: 'Vista detallada de quién asistió a cada clase en un período. Permite filtrar por actividad, marcar manualmente asistencia/falta de cualquier cliente en cualquier sesión, y descargar listados.' },
            { id: 'distribucion', label: 'Distribución de clases', desc: 'Mapa de clientes por hora y día — evolución mensual',
              icon: Grid3x3, color: '#5B9CF6', bg: 'rgba(91,156,246,0.12)',
              info: 'Heatmap día × hora con la ocupación real de las clases. Te muestra en qué franjas hay más demanda y cuáles están infrautilizadas, con evolución mes a mes. Útil para ajustar el cuadrante de horarios.' },
            { id: 'revisar', label: 'Para revisar', desc: 'Detecta horas saturadas y propone mejoras de horario',
              icon: Lightbulb, color: '#FBBF24', bg: 'rgba(251,191,36,0.14)',
              info: 'Sistema de recomendaciones automáticas: clases con asistencia anómala, monitores con baja ocupación, actividades sin demanda, horas con sobrecarga, sesiones repetidamente vacías. El sistema te sugiere qué optimizar para mejorar la rentabilidad y la experiencia.' },
            { id: 'riesgo', label: 'Clientes en riesgo', desc: 'Score de fuga: caída de asistencia, frecuencia, patrón…',
              icon: HeartPulse, color: 'var(--rose)', bg: 'rgba(251,113,133,0.12)',
              info: 'Score predictivo de baja: combina caída de asistencia (4 sem actuales vs 4 anteriores), antigüedad, frecuencia, días desde última asistencia y otros indicadores. Cada cliente recibe un nivel de riesgo (alto/medio/bajo) para que actúes antes de que se vaya.' },
            { id: 'patrones', label: 'Análisis de patrones', desc: 'Clusters automáticos por hábitos de uso',
              icon: Layers, color: '#A78BFA', bg: 'rgba(167,139,250,0.14)',
              info: 'Agrupa a tus clientes en grupos con patrones similares (días, horas, actividades, edad, género) usando K-means sobre un vector de 33 características. Útil para campañas dirigidas, optimizar horarios según los perfiles reales, y entender qué tipos de cliente tienes en tu centro.' },
          ].map(({ id, label, desc, icon: Icon, color, bg, info }) => (
            <div key={id} style={{ position: 'relative' }}>
              <button onClick={() => {
                setTab(id)
                if (id === 'distribucion') {
                  const seis = new Date(); seis.setMonth(seis.getMonth() - 6); seis.setDate(1)
                  setDesde(fmtDate(seis)); setHasta(fmtDate(new Date()))
                }
                if (id === 'revisar') {
                  const tres = new Date(); tres.setMonth(tres.getMonth() - 3); tres.setDate(1)
                  setDesde(fmtDate(tres)); setHasta(fmtDate(new Date()))
                }
                if (id === 'riesgo') {
                  const noventa = new Date(); noventa.setDate(noventa.getDate() - 90)
                  setDesde(fmtDate(noventa)); setHasta(fmtDate(new Date()))
                }
              }} style={{
                display: 'flex', alignItems: 'center', gap: 16, width: '100%',
                padding: 24, borderRadius: 16, textAlign: 'left',
                background: 'var(--bg-2)', border: '1px solid var(--line)', cursor: 'pointer',
              }}>
                <div style={{ width: 52, height: 52, borderRadius: 14,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                background: bg, flexShrink: 0 }}>
                  <Icon size={24} style={{ color }} aria-hidden="true" />
                </div>
                <div style={{ flex: 1, minWidth: 0, paddingRight: 28 }}>
                  <p style={{ fontFamily: 'Outfit', fontSize: 17, fontWeight: 600, color: 'var(--text-0)', marginBottom: 4 }}>{label}</p>
                  <p style={{ fontSize: 13, color: 'var(--text-3)' }}>{desc}</p>
                </div>
                <ChevronRight size={18} style={{ color: 'var(--text-3)', flexShrink: 0 }} aria-hidden="true" />
              </button>
              {/* Botón info absoluto arriba a la derecha */}
              <button onClick={(e) => {
                  e.stopPropagation()
                  setInfoPopover(infoPopover === id ? null : id)
                }}
                title="Más información"
                style={{
                  position: 'absolute', top: 12, right: 12,
                  background: 'var(--bg-1)', border: '1px solid var(--line)', borderRadius: 8,
                  padding: 6, cursor: 'pointer',
                  color: infoPopover === id ? 'var(--green)' : 'var(--text-3)',
                  zIndex: 1,
                }}>
                <Info size={14} />
              </button>
              {infoPopover === id && (
                <>
                  <div onClick={() => setInfoPopover(null)}
                       style={{ position: 'fixed', inset: 0, zIndex: 9 }} />
                  <div style={{
                    position: 'absolute', top: 50, right: 12, width: 360, padding: 16,
                    background: 'var(--bg-2)', border: '1px solid var(--line)',
                    borderRadius: 12, boxShadow: '0 12px 24px -8px rgba(0,0,0,0.5)',
                    zIndex: 10, fontSize: 13, color: 'var(--text-1)', lineHeight: 1.55,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <Icon size={16} style={{ color }} aria-hidden="true" />
                      <strong style={{ color: 'var(--text-0)' }}>{label}</strong>
                    </div>
                    <p>{info}</p>
                  </div>
                </>
              )}
            </div>
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

      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, color: 'var(--text-0)', marginBottom: 4 }}>
        Informe de asistencia
      </h1>
      <p style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 24 }}>
        {fmtDateES(desde)} — {fmtDateES(hasta)}{claseFilter ? ` · ${claseFilter}` : ' · Todas las clases'}
      </p>

      {/* Toolbar compartida: rango + atajos + filtro actividad + recargar */}
      <InformeToolbar
        desde={desde}
        hasta={hasta}
        onRange={(d, h) => { setDesde(d); setHasta(h) }}
        actividades={clasesDisponibles}
        actividadActiva={claseFilter}
        onActividad={setClaseFilter}
        onReload={() => { invalidateSalasCache(); fetchSalas(); setUsuariosPorSala({}) }}
        onTogglePersonalizar={() => setShowFilters(v => !v)}
        personalizando={showFilters}
      />

      {/* Panel de filtros personalizado (rango libre) */}
      {showFilters && (
        <Card style={{ padding: 24, marginBottom: 18 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16, alignItems: 'end' }}>
            <div>
              <label htmlFor="filter-desde" style={{ display: 'block', fontSize: 12, color: 'var(--text-3)', marginBottom: 6 }}>Desde</label>
              <input id="filter-desde" type="date" value={desde} onChange={e => setDesde(e.target.value)}
                     style={{ width: '100%', padding: '10px 14px', borderRadius: 'var(--radius-sm)', fontSize: 13, background: 'var(--bg-1)', border: '1px solid var(--line)', color: 'var(--text-0)', outline: 'none' }} />
            </div>
            <div>
              <label htmlFor="filter-hasta" style={{ display: 'block', fontSize: 12, color: 'var(--text-3)', marginBottom: 6 }}>Hasta</label>
              <input id="filter-hasta" type="date" value={hasta} onChange={e => setHasta(e.target.value)}
                     style={{ width: '100%', padding: '10px 14px', borderRadius: 'var(--radius-sm)', fontSize: 13, background: 'var(--bg-1)', border: '1px solid var(--line)', color: 'var(--text-0)', outline: 'none' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <Btn variant="primary" size="sm" onClick={() => setShowFilters(false)}>Aplicar</Btn>
            <Btn variant="secondary" size="sm" onClick={resetFilters}><RotateCcw size={14} aria-hidden="true" /> Reset</Btn>
          </div>
        </Card>
      )}

      {/* Tabs compartidos */}
      <InformeTabs
        active={tab}
        counts={{
          faltas:       totalNoShows7d,
          control:      actividadesConSalas.length,
          distribucion: distribucionPorMes?.meses?.[0]?.totalClases ?? null,
          revisar:      analisisRevisar?.recomendaciones?.length ?? 0,
          riesgo:       (analisisRiesgo?.totales?.criticos ?? 0) + (analisisRiesgo?.totales?.riesgo ?? 0),
          retos:        retos.length || null,
        }}
      />


      {/* KPIs — sólo en Faltas de asistencia */}
      {tab === 'faltas' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16, marginBottom: 32 }}>
          <Card style={{ padding: 24 }}>
            <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 14, display: 'flex', alignItems: 'center' }}>
              Total reservas
              <InfoTip title="Total reservas">
                Suma de todas las inscripciones (reservas) registradas en NoofitPro
                para clases pasadas. Un mismo cliente que reservó 3 clases cuenta como 3.
                Compara los últimos 7 días con los últimos 30 días para ver la actividad
                reciente del centro.
              </InfoTip>
            </p>
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
            <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 14, display: 'flex', alignItems: 'center' }}>
              Faltas de asistencia
              <InfoTip title="Faltas de asistencia (no-show)">
                Número de reservas en las que el cliente NO apareció: estaba inscrito
                pero el trainer no lo marcó como asistente al pasar lista. Se calcula
                solo sobre clases ya pasadas (no las futuras). Si una clase aún no se
                ha cerrado puede contar como falta provisional hasta que se marque.
              </InfoTip>
            </p>
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
                    <span style={{ fontSize: 11, color: 'var(--text-3)', textAlign: 'center', display: 'inline-flex', justifyContent: 'center', alignItems: 'center' }}>
                      Semana
                      <InfoTip title="Asistencias esta semana">
                        Nº de clases a las que ha asistido el cliente DESDE el lunes hasta hoy
                        (semana ISO en curso). Solo cuenta presencias verificadas, no reservas
                        ni faltas.
                      </InfoTip>
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-3)', textAlign: 'center', display: 'inline-flex', justifyContent: 'center', alignItems: 'center' }}>
                      Mes
                      <InfoTip title="Asistencias este mes">
                        Nº de clases a las que ha asistido el cliente desde el día 1 del mes
                        en curso hasta hoy.
                      </InfoTip>
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-3)', textAlign: 'center', display: 'inline-flex', justifyContent: 'center', alignItems: 'center' }}>
                      Media/sem
                      <InfoTip title="Media semanal" side="left">
                        Asistencias del cliente en todo el rango filtrado divididas entre
                        el número de semanas del rango. Da una cifra realista de su hábito,
                        independiente de si justo esta semana asistió mucho o poco.
                      </InfoTip>
                    </span>
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


      {/* Tab: Distribución de clases — heatmap día×hora / actividad×hora por mes */}
      {tab === 'distribucion' && (
        <DistribucionClases
          datos={distribucionPorMes}
          datosActividad={distribucionActividadPorMes}
          loadingUsuarios={Object.values(loadingUsuarios).some(Boolean)}
        />
      )}

      {/* Tab: Para revisar — análisis de ocupación + recomendaciones */}
      {tab === 'revisar' && (
        <ParaRevisar
          analisis={analisisRevisar}
          loadingUsuarios={Object.values(loadingUsuarios).some(Boolean)}
        />
      )}

      {/* Tab: Clientes en riesgo */}
      {tab === 'riesgo' && (
        <ClientesEnRiesgo
          analisis={analisisRiesgo}
          loadingUsuarios={Object.values(loadingUsuarios).some(Boolean)}
          onVerPerfil={(id) => navigate(`/clientes/${id}`)}
          clientMap={clientMap}
        />
      )}

      {/* Tab: Análisis de patrones (clusters de uso) */}
      {tab === 'patrones' && (
        <div role="tabpanel" aria-label="Análisis de patrones">
          <AnalisisClusters embedded />
        </div>
      )}

      {/* Tab: Retos NoofitPro */}
      {tab === 'retos' && (
        <RetosPanel retos={retos} clientMap={clientMap} />
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

// ─── Componente: Distribución de clases (heatmap día × hora por mes) ─────────
const DOW_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const MES_LABELS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

function DistribucionClases({ datos, datosActividad, loadingUsuarios }) {
  const [metrica, setMetrica] = useState('clientes') // 'clientes' | 'clases'
  const [vista,   setVista]   = useState('dia')      // 'dia' | 'actividad'

  const usaActividad = vista === 'actividad'
  const fuente = usaActividad ? datosActividad : datos
  const { meses, minHour, maxHour, globalMaxClientes, globalMaxClases } = fuente
  const globalMax = metrica === 'clientes' ? globalMaxClientes : globalMaxClases
  const horas = []
  for (let h = minHour; h <= maxHour; h++) horas.push(h)

  if (meses.length === 0) {
    return (
      <Card style={{ padding: 48, textAlign: 'center' }}>
        <Grid3x3 size={28} style={{ color: 'var(--text-3)', margin: '0 auto 12px' }} aria-hidden="true" />
        <p style={{ fontSize: 14, color: 'var(--text-3)' }}>
          No hay clases pasadas en el rango seleccionado
        </p>
      </Card>
    )
  }

  // Comparativa entre el mes más reciente y el anterior (para vista=día)
  const latest = meses[0]
  const prev   = meses[1] ?? null
  const totalLatest = metrica === 'clientes'
    ? (usaActividad ? totalMesActividad(latest, 'totalClientes')   : latest.totalClientes)
    : (usaActividad ? totalMesActividad(latest, 'totalClases')     : latest.totalClases)
  const totalPrev = prev
    ? (metrica === 'clientes'
        ? (usaActividad ? totalMesActividad(prev, 'totalClientes') : prev.totalClientes)
        : (usaActividad ? totalMesActividad(prev, 'totalClases')   : prev.totalClases))
    : 0
  const deltaPct = prev && totalPrev > 0 ? Math.round(((totalLatest - totalPrev) / totalPrev) * 100) : null

  return (
    <div role="tabpanel" aria-label="Distribución de clases" style={{ marginTop: 8 }}>
      {/* Toggles: Vista + Métrica */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8, flexWrap: 'wrap' }}>
        {/* Vista */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Vista:</span>
          <div style={{ display: 'flex', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--line)' }}>
            {[
              { id: 'dia',       label: 'Día × Hora' },
              { id: 'actividad', label: 'Actividad × Hora' },
            ].map(({ id, label }) => (
              <button key={id}
                      onClick={() => setVista(id)}
                      style={{
                        padding: '8px 14px', fontSize: 13, fontWeight: 500,
                        background: vista === id ? '#A78BFA' : 'var(--bg-2)',
                        color:      vista === id ? '#fff'    : 'var(--text-2)',
                        border: 'none', cursor: 'pointer',
                      }}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Métrica */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Métrica:</span>
          <div style={{ display: 'flex', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--line)' }}>
            {[
              { id: 'clientes', label: 'Clientes' },
              { id: 'clases',   label: 'Clases' },
            ].map(({ id, label }) => (
              <button key={id}
                      onClick={() => setMetrica(id)}
                      style={{
                        padding: '8px 14px', fontSize: 13, fontWeight: 500,
                        background: metrica === id ? '#5B9CF6' : 'var(--bg-2)',
                        color:      metrica === id ? '#fff'    : 'var(--text-2)',
                        border: 'none', cursor: 'pointer',
                      }}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {loadingUsuarios && metrica === 'clientes' && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-3)' }}>
            <Loader2 size={12} className="animate-spin" /> cargando datos…
          </span>
        )}
        <span style={{ fontSize: 12, color: 'var(--text-3)', marginLeft: 'auto' }}>
          {meses.length} mes{meses.length !== 1 ? 'es' : ''} con datos
        </span>
      </div>

      {/* Explicación de la métrica seleccionada */}
      <div style={{
        padding: '10px 14px', borderRadius: 10, marginBottom: 24,
        background: 'var(--bg-3)', border: '1px solid var(--line)',
        fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5,
      }}>
        {metrica === 'clases' ? (
          <>
            <strong>Clases:</strong> sesiones programadas en el calendario cuya hora de inicio ya ha pasado, contadas en el mes correspondiente.
            No filtra por asistencia (cuenta la sesión aunque no asistiera nadie) ni incluye las futuras.
          </>
        ) : (
          <>
            <strong>Clientes:</strong> suma de personas inscritas en cada clase pasada del mes (provienen del listado de usuarios por sala).
            Si una clase aún no tiene cargados sus inscritos, aporta 0; espera a que termine la carga para ver totales completos.
          </>
        )}
      </div>

      {/* KPIs comparativos */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
        <Card style={{ padding: 18 }}>
          <p style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', display: 'flex', alignItems: 'center' }}>
            {metrica === 'clientes' ? 'Clientes' : 'Clases'} — {MES_LABELS[latest.fecha.getMonth()]}
            <InfoTip title={metrica === 'clientes' ? 'Clientes del mes' : 'Clases del mes'} side="left">
              {metrica === 'clientes'
                ? 'Suma de personas inscritas en TODAS las clases del mes mostrado (cuenta cada reserva como un cliente, una persona inscrita en 4 clases suma 4).'
                : 'Número total de clases pasadas del mes mostrado.'}
              {deltaPct !== null && (
                <><br/><br/><strong>Δ vs mes anterior:</strong> compara con el mes inmediatamente previo. Verde = subida, Rojo = bajada.</>
              )}
            </InfoTip>
          </p>
          <p style={{ fontFamily: 'Outfit', fontSize: 26, fontWeight: 700, color: 'var(--text-0)', marginTop: 4 }}>{totalLatest}</p>
          {deltaPct !== null && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, color: deltaPct >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {deltaPct >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
              {deltaPct > 0 ? '+' : ''}{deltaPct}% vs mes anterior
            </span>
          )}
        </Card>
        {usaActividad ? (
          <Card style={{ padding: 18 }}>
            <p style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', display: 'flex', alignItems: 'center' }}>
              Actividad líder
              <InfoTip title="Actividad líder" side="left">
                La actividad con más {metrica === 'clientes' ? 'clientes inscritos' : 'sesiones programadas'} en
                todo el periodo. Útil para ver qué tipo de clase atrae más demanda.
              </InfoTip>
            </p>
            {datosActividad.actividades[0] ? (
              <>
                <p style={{ fontFamily: 'Outfit', fontSize: 18, fontWeight: 700, color: 'var(--text-0)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {datosActividad.actividades[0].name}
                </p>
                <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
                  {metrica === 'clientes' ? datosActividad.actividades[0].totalClientes : datosActividad.actividades[0].totalClases} {metrica}
                </p>
              </>
            ) : <p style={{ color: 'var(--text-3)', fontSize: 13 }}>—</p>}
          </Card>
        ) : (
          <Card style={{ padding: 18 }}>
            <p style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', display: 'flex', alignItems: 'center' }}>
              Día pico
              <InfoTip title="Día pico" side="left">
                Combinación día-de-semana + hora con el valor MÁS ALTO en el heatmap
                del mes mostrado. Se calcula recorriendo todas las celdas (7 días × 24 horas)
                y eligiendo la del máximo. Útil para saber dónde se concentra la demanda.
              </InfoTip>
            </p>
            <p style={{ fontFamily: 'Outfit', fontSize: 22, fontWeight: 700, color: 'var(--text-0)', marginTop: 4 }}>
              {DOW_LABELS[latest.peak.dow]} · {String(latest.peak.hour).padStart(2, '0')}:00
            </p>
            <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>{latest.peak.value} {metrica === 'clientes' ? 'clientes' : 'clases'} en {MES_LABELS[latest.fecha.getMonth()].toLowerCase()}</p>
          </Card>
        )}
        <Card style={{ padding: 18 }}>
          <p style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', display: 'flex', alignItems: 'center' }}>
            Franja activa
            <InfoTip title="Franja activa" side="left">
              Rango horario con actividad CONSISTENTE durante el periodo analizado.
              <br/><br/>
              <strong>Cómo se filtra:</strong> solo entran horas que cumplen las dos condiciones:
              <br/>• ≥ 5% del nº de clases de la hora pico
              <br/>• ≥ 3 clases en todo el periodo
              <br/><br/>
              Esto evita que una clase fantasma a las 01:00 (datos de test o salas mal
              etiquetadas) estire la franja desde madrugada hasta noche.
            </InfoTip>
          </p>
          <p style={{ fontFamily: 'Outfit', fontSize: 22, fontWeight: 700, color: 'var(--text-0)', marginTop: 4 }}>
            {String(minHour).padStart(2, '0')}:00 — {String(maxHour).padStart(2, '0')}:59
          </p>
          <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>{maxHour - minHour + 1} h/día</p>
        </Card>
      </div>

      {/* Heatmaps por mes */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {meses.map(m => (
          usaActividad
            ? <HeatmapActividadMes key={m.ym} mes={m} actividades={datosActividad.actividades} horas={horas} metrica={metrica} globalMax={globalMax} />
            : <HeatmapMes           key={m.ym} mes={m}                                          horas={horas} metrica={metrica} globalMax={globalMax} />
        ))}
      </div>
    </div>
  )
}

// Suma totales (clientes/clases) de todas las actividades de un mes
function totalMesActividad(mes, key) {
  let s = 0
  for (const a of mes.actividades.values()) s += a[key]
  return s
}

function HeatmapActividadMes({ mes, actividades, horas, metrica, globalMax }) {
  const cellSize = 30

  const cellColor = (v) => {
    if (v === 0) return 'var(--bg-3)'
    const intensity = globalMax > 0 ? v / globalMax : 0
    const alpha = 0.15 + intensity * 0.85
    return `rgba(167, 139, 250, ${alpha})` // morado para vista actividad
  }

  // Ordenar actividades por importancia GLOBAL (las del prop) y filtrar las que tienen datos en este mes
  const filas = actividades
    .map(a => ({
      ...a,
      data: mes.actividades.get(a.name) ?? null,
    }))
    .filter(f => f.data) // solo las que tienen datos este mes

  if (filas.length === 0) {
    return (
      <Card style={{ padding: 16 }}>
        <h3 style={{ fontFamily: 'Outfit', fontSize: 16, fontWeight: 600, color: 'var(--text-0)', margin: 0 }}>
          {MES_LABELS[mes.fecha.getMonth()]} {mes.fecha.getFullYear()}
        </h3>
        <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 6 }}>Sin actividades en este mes</p>
      </Card>
    )
  }

  const totalMes = filas.reduce((s, f) => s + (metrica === 'clientes' ? f.data.total : f.data.totalClases), 0)
  const masImportante = [...filas].sort((a, b) => {
    const va = metrica === 'clientes' ? a.data.total : a.data.totalClases
    const vb = metrica === 'clientes' ? b.data.total : b.data.totalClases
    return vb - va
  })[0]

  return (
    <Card style={{ padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ fontFamily: 'Outfit', fontSize: 16, fontWeight: 600, color: 'var(--text-0)', margin: 0 }}>
          {MES_LABELS[mes.fecha.getMonth()]} {mes.fecha.getFullYear()}
        </h3>
        <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-3)' }}>
          <span><strong style={{ color: 'var(--text-1)' }}>{totalMes}</strong> {metrica}</span>
          {masImportante && (
            <span>Top: <strong style={{ color: 'var(--text-1)' }}>{masImportante.name}</strong></span>
          )}
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <div style={{ display: 'inline-block', minWidth: '100%' }}>
          {/* Cabecera de horas */}
          <div style={{ display: 'flex', gap: 2, marginBottom: 2 }}>
            <div style={{ width: 160, flexShrink: 0 }} />
            {horas.map(h => (
              <div key={h} style={{
                width: cellSize, height: 18, flexShrink: 0,
                fontSize: 10, color: 'var(--text-3)', textAlign: 'center', lineHeight: '18px',
              }}>
                {String(h).padStart(2, '0')}
              </div>
            ))}
            <div style={{ width: 70, flexShrink: 0, fontSize: 10, color: 'var(--text-3)', textAlign: 'right', lineHeight: '18px', paddingRight: 6 }}>Total</div>
          </div>

          {/* Filas: actividades */}
          {filas.map((f) => {
            const row   = metrica === 'clientes' ? f.data.matrix : f.data.clases
            const total = metrica === 'clientes' ? f.data.total  : f.data.totalClases
            return (
              <div key={f.name} style={{ display: 'flex', gap: 2, marginBottom: 2, alignItems: 'center' }}>
                <div title={f.name}
                     style={{
                       width: 160, height: cellSize, flexShrink: 0,
                       fontSize: 12, color: 'var(--text-1)', fontWeight: 500,
                       display: 'flex', alignItems: 'center',
                       overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                       paddingRight: 6,
                     }}>
                  {f.name}
                </div>
                {horas.map(h => {
                  const v = row[h]
                  return (
                    <div key={h}
                         title={`${f.name} · ${String(h).padStart(2, '0')}:00 — ${v} ${metrica}`}
                         style={{
                           width: cellSize, height: cellSize, flexShrink: 0,
                           borderRadius: 4, background: cellColor(v),
                           display: 'flex', alignItems: 'center', justifyContent: 'center',
                           fontSize: 10, fontWeight: 600,
                           color: v > globalMax * 0.5 ? '#fff' : 'var(--text-2)',
                         }}>
                      {v > 0 ? v : ''}
                    </div>
                  )
                })}
                <div style={{
                  width: 70, height: cellSize, flexShrink: 0,
                  fontSize: 13, color: 'var(--text-0)', fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                  paddingRight: 6, fontFamily: 'Outfit',
                }}>
                  {total}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </Card>
  )
}

function HeatmapMes({ mes, horas, metrica, globalMax }) {
  const matrix = metrica === 'clientes' ? mes.matrix : mes.clases
  const total  = metrica === 'clientes' ? mes.totalClientes : mes.totalClases
  const cellSize = 30

  const cellColor = (v) => {
    if (v === 0) return 'var(--bg-3)'
    const intensity = globalMax > 0 ? v / globalMax : 0
    // Escala azul claro → azul fuerte (#5B9CF6)
    const alpha = 0.15 + intensity * 0.85
    return `rgba(91, 156, 246, ${alpha})`
  }

  return (
    <Card style={{ padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ fontFamily: 'Outfit', fontSize: 16, fontWeight: 600, color: 'var(--text-0)', margin: 0 }}>
          {MES_LABELS[mes.fecha.getMonth()]} {mes.fecha.getFullYear()}
        </h3>
        <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-3)' }}>
          <span><strong style={{ color: 'var(--text-1)' }}>{total}</strong> {metrica}</span>
          <span>Pico: <strong style={{ color: 'var(--text-1)' }}>{DOW_LABELS[mes.peak.dow]} {String(mes.peak.hour).padStart(2, '0')}:00</strong></span>
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <div style={{ display: 'inline-block', minWidth: '100%' }}>
          {/* Cabecera de horas */}
          <div style={{ display: 'flex', gap: 2, marginBottom: 2 }}>
            <div style={{ width: 38, flexShrink: 0 }} />
            {horas.map(h => (
              <div key={h} style={{
                width: cellSize, height: 18, flexShrink: 0,
                fontSize: 10, color: 'var(--text-3)', textAlign: 'center', lineHeight: '18px',
              }}>
                {String(h).padStart(2, '0')}
              </div>
            ))}
          </div>

          {/* Filas: días de la semana */}
          {DOW_LABELS.map((dl, dw) => (
            <div key={dl} style={{ display: 'flex', gap: 2, marginBottom: 2 }}>
              <div style={{
                width: 38, height: cellSize, flexShrink: 0,
                fontSize: 11, color: 'var(--text-3)', fontWeight: 600,
                display: 'flex', alignItems: 'center', justifyContent: 'flex-start',
              }}>
                {dl}
              </div>
              {horas.map(h => {
                const v = matrix[dw][h]
                return (
                  <div key={h}
                       title={`${dl} ${String(h).padStart(2, '0')}:00 — ${v} ${metrica}`}
                       style={{
                         width: cellSize, height: cellSize, flexShrink: 0,
                         borderRadius: 4, background: cellColor(v),
                         display: 'flex', alignItems: 'center', justifyContent: 'center',
                         fontSize: 10, fontWeight: 600,
                         color: v > globalMax * 0.5 ? '#fff' : 'var(--text-2)',
                       }}>
                    {v > 0 ? v : ''}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </Card>
  )
}

// ─── Componente: Para revisar (análisis ocupación + recomendaciones) ──────────
function ParaRevisar({ analisis, loadingUsuarios }) {
  const { horasAnalizadas, recomendaciones, totalSalas } = analisis

  if (totalSalas === 0) {
    return (
      <Card style={{ padding: 48, textAlign: 'center' }}>
        <Lightbulb size={28} style={{ color: 'var(--text-3)', margin: '0 auto 12px' }} aria-hidden="true" />
        <p style={{ fontSize: 14, color: 'var(--text-3)' }}>
          No hay clases pasadas en el rango seleccionado para analizar
        </p>
      </Card>
    )
  }

  // KPIs globales
  const totalInscritos  = horasAnalizadas.reduce((s, h) => s + h.inscritos,   0)
  const totalAforo      = horasAnalizadas.reduce((s, h) => s + h.aforo,       0)
  const totalAsistencia = horasAnalizadas.reduce((s, h) => s + h.asistencias, 0)
  const ocupGlobal      = totalAforo > 0 ? Math.round((totalInscritos / totalAforo) * 100) : null
  const asistGlobal     = totalInscritos > 0 ? Math.round((totalAsistencia / totalInscritos) * 100) : null

  // Maximo % ocupación para escalar barras
  const maxOcup = Math.max(100, ...horasAnalizadas.map(h => h.ocupacion ?? 0))

  // Color según nivel de ocupación
  const colorOcup = (pct) => {
    if (pct == null) return 'var(--text-3)'
    if (pct >= 85) return 'var(--red)'
    if (pct >= 70) return 'var(--amber)'
    if (pct >= 40) return 'var(--green)'
    return '#5B9CF6'
  }

  return (
    <div role="tabpanel" aria-label="Para revisar" style={{ marginTop: 8 }}>
      {/* Explicación */}
      <div style={{
        padding: '12px 16px', borderRadius: 12, marginBottom: 24,
        background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)',
        fontSize: 13, color: 'var(--text-1)', lineHeight: 1.55,
        display: 'flex', gap: 12, alignItems: 'flex-start',
      }}>
        <Lightbulb size={16} style={{ color: 'var(--amber)', flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
        <div>
          Análisis sobre <strong>{totalSalas}</strong> clases pasadas en el periodo. Compara
          el número de clases programadas con la ocupación real (inscritos / aforo) para detectar:
          horas saturadas, sobreoferta, no-show alto, tendencias al alza y actividades líderes.
          {loadingUsuarios && <> &nbsp;<Loader2 size={12} className="animate-spin" style={{ display: 'inline', verticalAlign: 'middle' }} /> Aún cargando inscritos…</>}
        </div>
      </div>

      {/* KPIs globales */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
        <Card style={{ padding: 18 }}>
          <p style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', display: 'flex', alignItems: 'center' }}>
            Ocupación media
            <InfoTip title="Ocupación media">
              Porcentaje medio de plazas usadas. <strong>Fórmula:</strong> total inscritos / total aforo × 100.
              <br/><br/>
              <strong>Colores:</strong>
              <br/>• Azul &lt; 40% — infraocupado, valora reducir clases.
              <br/>• Verde 40-69% — sano.
              <br/>• Ámbar 70-84% — al borde de saturación.
              <br/>• Rojo ≥ 85% — saturado, plantéate desdoblar.
            </InfoTip>
          </p>
          <p style={{ fontFamily: 'Outfit', fontSize: 28, fontWeight: 700, color: ocupGlobal != null ? colorOcup(ocupGlobal) : 'var(--text-3)', marginTop: 4 }}>
            {ocupGlobal != null ? `${ocupGlobal}%` : '—'}
          </p>
          <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>{totalInscritos} de {totalAforo || '—'} plazas</p>
        </Card>
        <Card style={{ padding: 18 }}>
          <p style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', display: 'flex', alignItems: 'center' }}>
            Tasa asistencia
            <InfoTip title="Tasa de asistencia">
              Porcentaje de reservas en las que el cliente sí apareció. <strong>Fórmula:</strong> asistencias / reservas × 100.
              <br/><br/>
              <strong>Umbrales:</strong>
              <br/>• ≥ 80% verde — comportamiento sano.
              <br/>• &lt; 80% ámbar — empiezas a tener no-shows.
              <br/>• &lt; 70% rojo — alto absentismo. Plantea políticas de "última reserva" o penalización.
            </InfoTip>
          </p>
          <p style={{ fontFamily: 'Outfit', fontSize: 28, fontWeight: 700, color: asistGlobal != null && asistGlobal >= 80 ? 'var(--green)' : 'var(--amber)', marginTop: 4 }}>
            {asistGlobal != null ? `${asistGlobal}%` : '—'}
          </p>
          <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>{totalAsistencia} asistencias / {totalInscritos} reservas</p>
        </Card>
        <Card style={{ padding: 18 }}>
          <p style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', display: 'flex', alignItems: 'center' }}>
            Recomendaciones
            <InfoTip title="Recomendaciones" side="left">
              Número de alertas detectadas por el algoritmo combinando:
              <br/>• Horas saturadas (ocupación ≥ 85%)
              <br/>• Horas sobreofertadas (ocupación &lt; 40% con &gt; 5 clases)
              <br/>• Actividades sin demanda (&lt; 30% ocupación)
              <br/>• Monitores con baja asistencia
              <br/>• Tendencias al alza/baja significativas
              <br/><br/>
              Severidad <strong>alta</strong>: el problema afecta a varias clases / es estructural.
              <br/>Severidad <strong>media</strong>: caso aislado o leve.
            </InfoTip>
          </p>
          <p style={{ fontFamily: 'Outfit', fontSize: 28, fontWeight: 700, color: 'var(--text-0)', marginTop: 4 }}>{recomendaciones.length}</p>
          <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
            {recomendaciones.filter(r => r.severidad === 'alta').length} alta · {recomendaciones.filter(r => r.severidad === 'media').length} media
          </p>
        </Card>
      </div>

      {/* Recomendaciones */}
      <h2 style={{ fontFamily: 'Outfit', fontSize: 18, fontWeight: 600, color: 'var(--text-0)', marginBottom: 12 }}>
        Recomendaciones
      </h2>
      {recomendaciones.length === 0 ? (
        <Card style={{ padding: 32, textAlign: 'center' }}>
          <CheckCircle2 size={24} style={{ color: 'var(--green)', margin: '0 auto 8px' }} />
          <p style={{ fontSize: 14, color: 'var(--text-2)' }}>
            No se han detectado horas problemáticas. La distribución del horario parece equilibrada.
          </p>
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 32 }}>
          {recomendaciones.map((r, i) => {
            const Icon = r.icon
            const sevBg = r.severidad === 'alta'  ? 'rgba(248,113,113,0.08)'
                        : r.severidad === 'media' ? 'rgba(251,191,36,0.08)'
                                                  : 'rgba(91,156,246,0.08)'
            const sevBorder = r.severidad === 'alta'  ? 'rgba(248,113,113,0.25)'
                            : r.severidad === 'media' ? 'rgba(251,191,36,0.25)'
                                                      : 'rgba(91,156,246,0.25)'
            return (
              <div key={i} style={{
                display: 'flex', gap: 14, alignItems: 'flex-start',
                padding: 18, borderRadius: 14,
                background: sevBg, border: `1px solid ${sevBorder}`,
              }}>
                <div style={{
                  width: 38, height: 38, borderRadius: 10, flexShrink: 0,
                  background: 'var(--bg-1)', border: `1px solid ${sevBorder}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Icon size={17} style={{ color: r.color }} aria-hidden="true" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-0)', marginBottom: 4 }}>
                    {r.titulo}
                  </p>
                  <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.55 }}>
                    {r.texto}
                  </p>
                </div>
                <span style={{
                  flexShrink: 0, fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 20,
                  background: 'var(--bg-1)', border: `1px solid ${sevBorder}`,
                  color: r.color, textTransform: 'uppercase', letterSpacing: 0.4,
                }}>
                  {r.severidad}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* Tabla de ocupación por hora */}
      <h2 style={{ fontFamily: 'Outfit', fontSize: 18, fontWeight: 600, color: 'var(--text-0)', marginBottom: 12 }}>
        Detalle por hora
      </h2>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: '60px 1fr 80px 100px 100px 110px',
          padding: '10px 18px', background: 'var(--bg-3)',
          borderBottom: '1px solid var(--line)',
          fontSize: 11, fontWeight: 600, color: 'var(--text-3)',
          textTransform: 'uppercase', letterSpacing: 0.4,
        }}>
          <span style={{ display: 'inline-flex', alignItems: 'center' }}>
            Hora
            <InfoTip title="Hora del día">Franja horaria en formato 24h. Una clase se asigna a la hora en que arranca, no a su duración.</InfoTip>
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center' }}>
            Ocupación
            <InfoTip title="Ocupación de la franja">
              Porcentaje de plazas ocupadas en esa hora del día. <strong>Fórmula:</strong> total inscritos / total aforo × 100.
              <br/><br/>
              Si aparece una flecha <strong>↗ verde</strong> o <strong>↘ roja</strong> al lado,
              indica la <strong>tendencia</strong>: cambio en puntos porcentuales (pp) entre las
              últimas 2 semanas y las 2 anteriores.
            </InfoTip>
          </span>
          <span style={{ textAlign: 'right', display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end' }}>
            Clases
            <InfoTip title="Clases" side="left">Número total de clases programadas en esta franja durante el periodo. No filtra por asistencia.</InfoTip>
          </span>
          <span style={{ textAlign: 'right', display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end' }}>
            Inscritos
            <InfoTip title="Inscritos" side="left">Suma total de reservas en todas las clases de esta franja. Un cliente que reserva 3 clases en esta hora cuenta como 3.</InfoTip>
          </span>
          <span style={{ textAlign: 'right', display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end' }}>
            Aforo
            <InfoTip title="Aforo total" side="left">Suma de plazas máximas (aforo) de todas las clases de esta franja. Útil para conocer la capacidad teórica.</InfoTip>
          </span>
          <span style={{ textAlign: 'right', display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end' }}>
            Asist.
            <InfoTip title="Tasa de asistencia" side="left">
              % de personas que se inscribieron y SÍ aparecieron a clase. <strong>Fórmula:</strong> asistencias / inscritos × 100.
              <br/><br/>Por debajo de <strong>70%</strong> se marca en rojo (alto no-show — clientes que reservan pero no van).
            </InfoTip>
          </span>
        </div>
        {horasAnalizadas
          .slice()
          .sort((a, b) => a.hora - b.hora)
          .map((h, idx) => {
            const ocupColor = colorOcup(h.ocupacion)
            const w = h.ocupacion != null ? Math.min(100, (h.ocupacion / maxOcup) * 100) : 0
            return (
              <div key={h.hora} style={{
                display: 'grid', gridTemplateColumns: '60px 1fr 80px 100px 100px 110px',
                padding: '10px 18px', alignItems: 'center', gap: 8,
                borderBottom: idx < horasAnalizadas.length - 1 ? '1px solid var(--line)' : 'none',
                fontSize: 13, color: 'var(--text-1)',
              }}>
                <span style={{ fontFamily: 'Outfit', fontWeight: 600, color: 'var(--text-0)' }}>
                  {String(h.hora).padStart(2, '0')}h
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--bg-3)', overflow: 'hidden' }}>
                    <div style={{ width: `${w}%`, height: '100%', background: ocupColor, transition: 'width .2s' }} />
                  </div>
                  <span style={{ minWidth: 44, textAlign: 'right', fontSize: 13, fontWeight: 600, color: ocupColor }}>
                    {h.ocupacion != null ? `${h.ocupacion}%` : '—'}
                  </span>
                  {h.tendencia != null && Math.abs(h.tendencia) >= 10 && (() => {
                    const ocupAnt = h.ocupacionAntiguaA > 0
                      ? Math.round((h.ocupacionAntiguaI  / h.ocupacionAntiguaA)  * 100) : null
                      const ocupRec = h.ocupacionRecienteA > 0
                        ? Math.round((h.ocupacionRecienteI / h.ocupacionRecienteA) * 100) : null
                    const sube = h.tendencia > 0
                    const tooltip =
                      `Tendencia: la ocupación a las ${String(h.hora).padStart(2,'0')}h ha ` +
                      `${sube ? 'subido' : 'bajado'} ${Math.abs(h.tendencia)} puntos porcentuales (pp) ` +
                      `comparando las últimas 2 semanas con las 2 anteriores.\n\n` +
                      (ocupAnt != null && ocupRec != null
                        ? `Antes (semanas −4 a −2): ${ocupAnt}%\nAhora (semanas −2 a hoy): ${ocupRec}%\n\n`
                        : '') +
                      (sube
                        ? '↗ Verde = la franja está captando más asistentes.'
                        : '↘ Rojo = la franja está perdiendo asistentes. Revisa si hay clases canceladas, cambio de horario o competencia interna.')
                    return (
                      <span title={tooltip}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 11, fontWeight: 600,
                              color: sube ? 'var(--green)' : 'var(--red)',
                              cursor: 'help',
                              textDecoration: 'underline dotted',
                              textUnderlineOffset: 3,
                            }}>
                        {sube ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                        {sube ? '+' : ''}{h.tendencia}pp
                      </span>
                    )
                  })()}
                </div>
                <span style={{ textAlign: 'right', color: 'var(--text-2)' }}>{h.clases}</span>
                <span style={{ textAlign: 'right', color: 'var(--text-2)' }}>{h.inscritos}</span>
                <span style={{ textAlign: 'right', color: 'var(--text-2)' }}>{h.aforo || '—'}</span>
                <span style={{ textAlign: 'right', color: h.asistencia != null && h.asistencia < 70 ? 'var(--red)' : 'var(--text-2)' }}>
                  {h.asistencia != null ? `${h.asistencia}%` : '—'}
                </span>
              </div>
            )
          })}
      </Card>
    </div>
  )
}

// ─── Componente: Clientes en riesgo ──────────────────────────────────────────
function ClientesEnRiesgo({ analisis, loadingUsuarios, onVerPerfil, clientMap }) {
  const { list, totales } = analisis
  const [filtroNivel, setFiltroNivel] = useState('riesgo+') // 'todos' | 'riesgo+' (riesgo+critico) | 'critico'

  // Aviso siempre: faltan integraciones (app y retos)
  // El handoff/usuario lo pidió: si no hay datos, decirlo, no inventar.
  const filtrados = list.filter(c => {
    if (filtroNivel === 'todos')   return true
    if (filtroNivel === 'critico') return c.nivel === 'critico'
    if (filtroNivel === 'riesgo+') return c.nivel === 'critico' || c.nivel === 'riesgo'
    return c.score >= 30
  })

  const colorNivel = {
    critico:  'var(--red)',
    riesgo:   'var(--amber)',
    atencion: '#5B9CF6',
    sano:     'var(--green)',
  }
  const labelNivel = {
    critico:  'CRÍTICO',
    riesgo:   'EN RIESGO',
    atencion: 'ATENCIÓN',
    sano:     'SANO',
  }

  return (
    <div role="tabpanel" aria-label="Clientes en riesgo" style={{ marginTop: 8 }}>

      {/* Aviso de datos no integrados */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 12,
        padding: '12px 16px', borderRadius: 'var(--radius-md)',
        background: 'rgba(91,156,246,0.07)', border: '1px solid rgba(91,156,246,0.18)',
        marginBottom: 22,
      }}>
        <Activity size={16} style={{ color: 'var(--blue)', flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
        <div style={{ fontSize: 12.5, color: 'var(--text-1)', lineHeight: 1.55 }}>
          Score basado en señales reales del backend: asistencias verificadas, reservas,
          frecuencia, patrón horario y fecha de alta.{' '}
          <InfoTip title="Cómo se calcula el score (0-100)">
            El score combina 5 indicadores, cada uno aporta entre 0 y N puntos:
            <br/><br/>
            <strong>1. Caída de asistencia (0-40 pt)</strong> — diferencia entre asistencias de las últimas 4 semanas y las 4 anteriores. A más caída, más puntos.
            <br/><br/>
            <strong>2. Días sin asistir (0-25 pt)</strong> — cuántos días hace de la última asistencia. ≥30 días = máximo.
            <br/><br/>
            <strong>3. Frecuencia baja (0-15 pt)</strong> — clases/semana actual vs hábito histórico.
            <br/><br/>
            <strong>4. Antigüedad (0-10 pt)</strong> — clientes recién captados son más volátiles.
            <br/><br/>
            <strong>5. Patrón irregular (0-10 pt)</strong> — variabilidad en horas y días.
            <br/><br/>
            <strong>Niveles:</strong> &lt;30 sano, 30-49 atención, 50-74 riesgo, ≥75 crítico.
          </InfoTip>
          <strong style={{ color: 'var(--text-0)' }}>Faltan integraciones</strong>:
          uso de la app móvil (mynoofit) y retos completados — pendientes de endpoint en wiemspro.
          Cuando estén, el algoritmo los incorporará automáticamente.
          {loadingUsuarios && <> &nbsp;<Loader2 size={12} className="animate-spin" style={{ display: 'inline', verticalAlign: 'middle' }} /> Aún cargando reservas…</>}
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 22 }}>
        {[
          { id:'critico',  label:'Críticos',  count: totales.criticos,  desc:'Score ≥ 75',  color: colorNivel.critico,  bg:'rgba(248,113,113,0.06)', border:'rgba(248,113,113,0.22)',
            tip: 'Cliente con MUY alta probabilidad de fuga. Acción recomendada: contacto personal en menos de 7 días.' },
          { id:'riesgo',   label:'En riesgo', count: totales.riesgo,    desc:'Score 50–74', color: colorNivel.riesgo,   bg:'rgba(251,191,36,0.06)', border:'rgba(251,191,36,0.22)',
            tip: 'Cliente con señales de desconexión: caída de asistencia o frecuencia. Plantéate campaña automática y oferta de retención.' },
          { id:'atencion', label:'Atención',  count: totales.atencion,  desc:'Score 30–49', color: colorNivel.atencion, bg:'rgba(91,156,246,0.06)', border:'rgba(91,156,246,0.22)',
            tip: 'Hay algún indicador anómalo pero no es crítico. Útil para incluirlos en campañas masivas de fidelización.' },
          { id:'sano',     label:'Sanos',     count: totales.sanos,     desc:'Score < 30',  color: colorNivel.sano,     bg:'rgba(45,212,168,0.06)', border:'rgba(45,212,168,0.22)',
            tip: 'Comportamiento consistente y reciente. No requieren acción.' },
        ].map(k => (
          <Card key={k.id} style={{ padding: 16, background: k.bg, border: `1px solid ${k.border}` }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.4, display: 'flex', alignItems: 'center' }}>
              {k.label}
              <InfoTip title={`${k.label} — ${k.desc}`}>{k.tip}</InfoTip>
            </p>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, color: k.color, marginTop: 4 }}>{k.count}</p>
            <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>{k.desc}</p>
          </Card>
        ))}
      </div>

      {/* Filtro de nivel */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Mostrar:</span>
        <div style={{ display: 'flex', borderRadius: 'var(--radius-sm)', overflow: 'hidden', border: '1px solid var(--line)' }}>
          {[
            { id: 'critico', label: `Solo críticos (${totales.criticos})` },
            { id: 'riesgo+', label: `Riesgo + crítico (${totales.criticos + totales.riesgo})` },
            { id: 'todos',   label: `Todos (${list.length})` },
          ].map(({ id, label }) => (
            <button key={id}
                    onClick={() => setFiltroNivel(id)}
                    style={{
                      padding: '7px 12px', fontSize: 12, fontWeight: 600,
                      background: filtroNivel === id ? 'var(--bg-3)' : 'var(--bg-2)',
                      color:      filtroNivel === id ? 'var(--text-0)' : 'var(--text-2)',
                      border: 'none', cursor: 'pointer',
                    }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Lista */}
      {filtrados.length === 0 ? (
        <Card style={{ padding: 32, textAlign: 'center' }}>
          <CheckCircle2 size={24} style={{ color: 'var(--green)', margin: '0 auto 8px' }} />
          <p style={{ fontSize: 14, color: 'var(--text-2)' }}>
            No hay clientes en este nivel. La cartera parece sana.
          </p>
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtrados.map(c => (
            <ClienteRiesgoRow
              key={c.idClient}
              cliente={c}
              clientFromMap={clientMap[String(c.idClient)] ?? null}
              colorNivel={colorNivel}
              labelNivel={labelNivel}
              onVerPerfil={onVerPerfil}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ClienteRiesgoRow({ cliente, clientFromMap, colorNivel, labelNivel, onVerPerfil }) {
  const c       = clientFromMap
  const nombre  = (c?.nombre ?? c?.name)    ?? cliente.nameClient ?? `#${cliente.idClient}`
  const apell   = (c?.apellidos ?? c?.surname) ?? ''
  const nombreCompleto = `${nombre} ${apell}`.trim()
  const imgUrl  = c?.imgUrl ?? cliente.pictureClient ?? ''
  const color   = colorNivel[cliente.nivel]
  const label   = labelNivel[cliente.nivel]

  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 84px auto',
        alignItems: 'center', gap: 16, padding: '14px 18px',
      }}>
        {/* Cliente + factores */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
          <Avatar nombre={nombreCompleto} size={42} imgUrl={imgUrl} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 600, color: 'var(--text-0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {nombreCompleto}
              </span>
              {cliente.diasAlta != null && (
                <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                  {cliente.diasAlta < 30 ? `${cliente.diasAlta}d` : cliente.diasAlta < 365 ? `${Math.round(cliente.diasAlta / 30)}m` : `${Math.round(cliente.diasAlta / 365)}a`} de alta
                </span>
              )}
              {cliente.pctAsistencia != null && (
                <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                  · {cliente.pctAsistencia}% asistencia · {cliente.totalReservas} reservas
                </span>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 6 }}>
              {cliente.factores.slice(0, 4).map((f, i) => (
                <span key={f.key + i} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  fontSize: 12, color: 'var(--text-2)',
                }}>
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: f.severidad === 'alta' ? 'var(--red)' : 'var(--amber)',
                    flexShrink: 0,
                  }} />
                  {f.label}
                </span>
              ))}
              {cliente.factores.length === 0 && (
                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  Sin alertas detectadas en este periodo.
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Score */}
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 800, color, lineHeight: 1 }}>
            {cliente.score}
          </p>
          <p style={{ fontSize: 9.5, fontWeight: 700, color, letterSpacing: 0.5, marginTop: 4 }}>
            {label}
          </p>
        </div>

        {/* Acción */}
        <button onClick={() => onVerPerfil?.(cliente.idClient)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '8px 14px', borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-3)', border: '1px solid var(--line)',
                  color: 'var(--text-1)', fontSize: 12, fontWeight: 600,
                  cursor: 'pointer', flexShrink: 0,
                }}>
          Ver perfil <ExternalLink size={12} aria-hidden="true" />
        </button>
      </div>

      {/* Barra inferior con color del nivel */}
      <div style={{ height: 3, background: color, opacity: 0.7 }} />
    </Card>
  )
}

// ─── Componente: Retos NoofitPro ────────────────────────────────────────────
// Determina si un reto está "terminado": estado==2 / fechaFin pasada.
function retoTerminado(r) {
  if (Number(r.estado) === 2) return true
  const ff = r.fechaFin
  if (typeof ff === 'number' && ff > 1e10) {
    return ff < Date.now()
  }
  return false
}

// Lista de retos en los que participa un cliente (con su valor + ranking)
function retosParaCliente(retos, idClient) {
  const out = []
  const idStr = String(idClient)
  for (const r of (retos || [])) {
    const part = (r.participantes || []).find(p =>
      String(p?.idClient || p?.clienteId) === idStr)
    if (!part) continue
    const rk = (r.rankingIndividual || []).find(x =>
      String(x?.idClient || x?.clienteId) === idStr)
    out.push({
      reto: r,
      valorAcumulado: rk?.valorAcumulado ?? part.valorAcumulado ?? 0,
      numRegistros:   rk?.numRegistros   ?? part.numRegistros   ?? 0,
      ranking:        rk?.rankingIndividual ?? null,
      activo:         part.activo,
      fechaInscripcion: part.fechaInscripcion,
      terminado:      retoTerminado(r),
    })
  }
  return out
}

function RetosPanel({ retos, clientMap }) {
  const [filtroEstado, setFiltroEstado] = useState('activos')   // activos | terminados | todos
  const [clienteSel, setClienteSel] = useState(null)            // { idClient, nombre, imgUrl }

  if (!retos || retos.length === 0) {
    return (
      <div role="tabpanel" aria-label="Retos" style={{ marginTop: 8 }}>
        <Card style={{ padding: 32, textAlign: 'center' }}>
          <Zap size={24} style={{ color: 'var(--green)', margin: '0 auto 8px' }} />
          <p style={{ fontSize: 14, color: 'var(--text-2)' }}>
            No hay retos activos en NoofitPro para los trainers configurados.
          </p>
          <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8 }}>
            Crea un reto desde NoofitPro y aparecerá aquí (caché 5 min, fuerza refresco en el botón ↻ de la toolbar).
          </p>
        </Card>
      </div>
    )
  }

  // Aplicar filtro de estado
  const retosFiltrados = retos.filter(r => {
    const term = retoTerminado(r)
    if (filtroEstado === 'activos')    return !term
    if (filtroEstado === 'terminados') return term
    return true
  })
  const nActivos    = retos.filter(r => !retoTerminado(r)).length
  const nTerminados = retos.length - nActivos

  const fmtFecha = (epoch) => {
    if (!epoch) return '—'
    if (typeof epoch === 'number' && epoch > 1e10) {
      return new Date(epoch).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
    }
    return epoch
  }
  const tipoMetricaLabel = (n) => ({ 1: 'sesiones', 2: 'km', 3: 'minutos', 4: 'calorías' }[n] || `métrica ${n}`)

  return (
    <div role="tabpanel" aria-label="Retos" style={{ marginTop: 8 }}>
      <div style={{
        padding: '12px 16px', borderRadius: 12, marginBottom: 18,
        background: 'rgba(45,212,168,0.06)', border: '1px solid rgba(45,212,168,0.2)',
        fontSize: 12.5, color: 'var(--text-1)', lineHeight: 1.55,
      }}>
        <strong>{retos.length} reto{retos.length !== 1 ? 's' : ''}</strong> en NoofitPro
        ({nActivos} activo{nActivos !== 1 ? 's' : ''} · {nTerminados} terminado{nTerminados !== 1 ? 's' : ''}).
        Click sobre cualquier participante del ranking para ver TODOS sus retos. Cuando un
        cliente participa, su score de "En riesgo" baja (señal positiva de engagement).
      </div>

      {/* Filtro de estado */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 600 }}>Mostrar:</span>
        <div style={{ display: 'flex', borderRadius: 10, overflow: 'hidden',
                       border: '1.5px solid var(--line)', background: 'var(--bg-2)' }}>
          {[
            { id: 'activos',    label: `Activos (${nActivos})` },
            { id: 'terminados', label: `Terminados (${nTerminados})` },
            { id: 'todos',      label: `Todos (${retos.length})` },
          ].map(({ id, label }) => (
            <button key={id}
                    onClick={() => setFiltroEstado(id)}
                    aria-pressed={filtroEstado === id}
                    style={{
                      padding: '8px 14px', fontSize: 12.5, fontWeight: 700,
                      background: filtroEstado === id ? 'var(--green)' : 'transparent',
                      color: filtroEstado === id ? '#fff' : 'var(--text-1)',
                      border: 'none', cursor: 'pointer',
                    }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {retosFiltrados.length === 0 ? (
        <Card style={{ padding: 28, textAlign: 'center' }}>
          <p style={{ fontSize: 13, color: 'var(--text-3)' }}>
            No hay retos {filtroEstado === 'activos' ? 'activos' : 'terminados'} en el filtro actual.
          </p>
        </Card>
      ) : (
      <div style={{ display: 'grid', gap: 14 }}>
        {retosFiltrados.map(r => {
          const participantes = r.participantes || []
          const equipos = r.equipos || []
          const ranking = r.rankingIndividual || []
          return (
            <Card key={r.id} style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)',
                            display: 'flex', alignItems: 'flex-start', gap: 14,
                            background: 'var(--bg-2)' }}>
                <div style={{ width: 44, height: 44, borderRadius: 12,
                              background: 'var(--green-bg)', display: 'flex',
                              alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Zap size={20} style={{ color: 'var(--green)' }} aria-hidden="true" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontFamily: 'Outfit', fontSize: 16, fontWeight: 700, color: 'var(--text-0)', margin: 0,
                              display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {r.nombre || `Reto #${r.id}`}
                    {retoTerminado(r)
                      ? <Badge color="gray">Terminado</Badge>
                      : <Badge color="green">Activo</Badge>}
                  </p>
                  <p style={{ fontSize: 12, color: 'var(--text-2)', margin: '4px 0 0', whiteSpace: 'pre-line' }}>
                    {r.descripcion || '—'}
                  </p>
                  <div style={{ display: 'flex', gap: 14, fontSize: 11.5, color: 'var(--text-3)', marginTop: 8 }}>
                    <span>📅 {fmtFecha(r.fechaInicio)} → {fmtFecha(r.fechaFin)}</span>
                    <span>👥 {participantes.length} participantes</span>
                    {equipos.length > 0 && <span>🏆 {equipos.length} equipos</span>}
                    <span>📏 {tipoMetricaLabel(r.tipoMetrica)}</span>
                  </div>
                </div>
              </div>

              {ranking.length > 0 && (
                <div style={{ padding: '12px 18px' }}>
                  <p style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600,
                              textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>
                    Ranking individual (top 10)
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {ranking.slice(0, 10).map((rk, idx) => {
                      const cli = clientMap[String(rk.idClient || rk.clienteId)]
                      const nombreLocal = cli ? `${cli.nombre || cli.name || ''} ${cli.apellidos || cli.surname || ''}`.trim() : ''
                      // Prioridad: nombre del clientMap > nombreCliente del propio reto > id
                      const nombre = nombreLocal
                                     || rk.nombreCliente
                                     || rk.nombre
                                     || `#${rk.idClient || rk.clienteId || idx}`
                      // Campo real en NoofitPro: valorAcumulado (km / sesiones / etc.)
                      const valor = rk.valorAcumulado ?? rk.valor ?? rk.puntuacion ?? rk.score
                      const valorTxt = (typeof valor === 'number')
                          ? (Number.isInteger(valor) ? valor.toString() : valor.toFixed(2))
                          : (valor ?? '0')
                      const sinActividad = (typeof valor === 'number' && valor === 0)
                      return (
                        <div key={idx} style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '6px 8px', borderRadius: 8,
                          background: idx < 3 ? 'rgba(45,212,168,0.05)' : 'transparent',
                          fontSize: 12.5, color: sinActividad ? 'var(--text-3)' : 'var(--text-1)',
                          opacity: sinActividad ? 0.6 : 1,
                        }}>
                          <span style={{
                            width: 22, height: 22, borderRadius: '50%',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: idx === 0 ? '#FFC83D' : idx === 1 ? '#C0C0C0' : idx === 2 ? '#CD7F32' : 'var(--bg-3)',
                            color: idx < 3 ? '#000' : 'var(--text-2)',
                            fontSize: 11, fontWeight: 700, flexShrink: 0,
                          }}>{idx + 1}</span>
                          <button onClick={() => setClienteSel({
                                    idClient: rk.idClient || rk.clienteId,
                                    nombre,
                                    imgUrl: rk.imagenCliente || '',
                                  })}
                                  style={{
                                    flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                    background: 'none', border: 'none', padding: 0, textAlign: 'left',
                                    color: 'inherit', cursor: 'pointer',
                                    textDecoration: 'underline', textDecorationColor: 'transparent',
                                    transition: 'text-decoration-color 0.15s',
                                  }}
                                  onMouseEnter={e => e.currentTarget.style.textDecorationColor = 'var(--green)'}
                                  onMouseLeave={e => e.currentTarget.style.textDecorationColor = 'transparent'}
                                  title="Ver todos los retos de este cliente">
                            {nombre}
                          </button>
                          {rk.numRegistros != null && (
                            <span style={{ fontSize: 10.5, color: 'var(--text-3)',
                                           fontFamily: 'var(--font-mono)' }}
                                  title={`${rk.numRegistros} sesiones registradas`}>
                              {rk.numRegistros} ses
                            </span>
                          )}
                          <span style={{ fontWeight: 700, color: sinActividad ? 'var(--text-3)' : 'var(--text-0)',
                                         minWidth: 80, textAlign: 'right' }}>
                            {valorTxt} {tipoMetricaLabel(r.tipoMetrica)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                  <p style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 8 }}>
                    <strong>valor:</strong> km/sesiones acumulados por el cliente desde fecha de inicio del reto.{' '}
                    <strong>ses:</strong> nº de sesiones donde se han registrado datos (pulsómetro o sala compatible).{' '}
                    Participantes en gris = inscritos pero sin actividad registrada todavía.
                  </p>
                </div>
              )}
            </Card>
          )
        })}
      </div>
      )}

      {/* Modal: retos de un cliente concreto */}
      {clienteSel && (
        <RetosClienteModal
          clienteSel={clienteSel}
          retos={retos}
          onClose={() => setClienteSel(null)}
        />
      )}
    </div>
  )
}

// ─── Modal: todos los retos en los que participa un cliente ─────────────────
function RetosClienteModal({ clienteSel, retos, onClose }) {
  const retosCli = retosParaCliente(retos, clienteSel.idClient)
  const total = retosCli.length
  const activos    = retosCli.filter(x => !x.terminado).length
  const terminados = total - activos
  const tipoMetricaLabel = (n) => ({ 1: 'sesiones', 2: 'km', 3: 'minutos', 4: 'calorías' }[n] || `métrica ${n}`)
  const fmtFecha = (epoch) => {
    if (!epoch) return '—'
    if (typeof epoch === 'number' && epoch > 1e10)
      return new Date(epoch).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
    return epoch
  }

  return (
    <Modal open onClose={onClose} maxWidth={720}
           title={`Retos de ${clienteSel.nombre}`}>
      <div style={{ padding: 24 }}>
        <div style={{ display: 'flex', gap: 14, marginBottom: 18,
                       padding: '10px 14px', borderRadius: 10,
                       background: 'var(--green-bg)', border: '1px solid var(--green-border)' }}>
          <Zap size={18} style={{ color: 'var(--green)', flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
          <div style={{ fontSize: 12.5, color: 'var(--text-1)' }}>
            <strong>{total}</strong> reto{total !== 1 ? 's' : ''} (
            <strong style={{ color: 'var(--green)' }}>{activos}</strong> activo{activos !== 1 ? 's' : ''} ·{' '}
            <strong style={{ color: 'var(--text-3)' }}>{terminados}</strong> terminado{terminados !== 1 ? 's' : ''})
          </div>
        </div>

        {total === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-3)', textAlign: 'center', padding: 20 }}>
            Este cliente no participa en ningún reto.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {retosCli.map(({ reto, valorAcumulado, numRegistros, ranking, activo, fechaInscripcion, terminado }) => (
              <div key={reto.id} style={{
                padding: '12px 14px', borderRadius: 10,
                background: terminado ? 'var(--bg-2)' : 'var(--green-bg)',
                border: `1px solid ${terminado ? 'var(--line)' : 'var(--green-border)'}`,
                opacity: !activo ? 0.6 : 1,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-0)' }}>
                    {reto.nombre}
                  </span>
                  {terminado
                    ? <Badge color="gray">Terminado</Badge>
                    : <Badge color="green">Activo</Badge>}
                  {!activo && <Badge color="red">Abandonó</Badge>}
                  {ranking != null && (
                    <Badge color={ranking <= 3 ? 'amber' : 'blue'}>
                      Puesto #{ranking}
                    </Badge>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 14, fontSize: 11.5, color: 'var(--text-2)', flexWrap: 'wrap' }}>
                  <span>📅 {fmtFecha(reto.fechaInicio)} → {fmtFecha(reto.fechaFin)}</span>
                  {fechaInscripcion && <span>📝 Inscrito {new Date(fechaInscripcion).toLocaleDateString('es-ES')}</span>}
                  <span style={{ fontWeight: 700, color: 'var(--text-0)' }}>
                    🏆 {typeof valorAcumulado === 'number'
                          ? (Number.isInteger(valorAcumulado) ? valorAcumulado : valorAcumulado.toFixed(2))
                          : valorAcumulado} {tipoMetricaLabel(reto.tipoMetrica)}
                  </span>
                  <span>📊 {numRegistros} sesiones</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}

