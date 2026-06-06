import { useState, useEffect, useMemo, useDeferredValue } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, Archive, Loader2, Send, X, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Download } from 'lucide-react'
import * as XLSX from 'xlsx'
import { Badge, Avatar, Btn, EmptyState, isSafeImageUrl, normalizeImageUrl } from '../../components/UI'
import AltaClienteModal from '../../components/AltaClienteModal'
import { getClientes, peekCache, peekPersistedCache, getERPConfiguraciones, invalidateCache, clearPersistedCache } from '../../utils/api'
import { useAuth } from '../../contexts/AuthContext'
import { useGympassMap } from '../../hooks/useGympassMap'
import { useCategoriasMap } from '../../hooks/useCategoriasMap'
import { getRoundIdentity, fechaBajaPorCliente, bajaProgramadaList, temporalInactivoList } from '../../utils/configApi'
import { coincideTexto } from '../../utils/texto'
import { QrCentroButton } from '../../components/QrAltaCliente'
import NotasPopover from '../../components/notas/NotasPopover'
import { useCan } from '../../hooks/useCan'

const PAGE_SIZE = 15

// Etiquetas legibles de los motivos de pausa (inactividad temporal)
const MOTIVO_PAUSA_LABEL = {
  baja_medica: 'Baja médica',
  lesion: 'Lesión',
  vacaciones: 'Vacaciones',
  cambio_trabajo_domicilio: 'Cambio de trabajo/domicilio',
  otros: 'Otros',
}

/**
 * Devuelve los números de página a mostrar, con elipsis (…) para saltos.
 * Siempre muestra la primera y la última, más un rango cercano al actual.
 * Ejemplos:
 *   totalPages=5, current=1  → [1, 2, 3, 4, 5]
 *   totalPages=20, current=1 → [1, 2, 3, …, 20]
 *   totalPages=20, current=10 → [1, …, 9, 10, 11, …, 20]
 *   totalPages=20, current=20 → [1, …, 18, 19, 20]
 */
function buildPageList(totalPages, current) {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
  const pages = new Set([1, totalPages, current, current - 1, current + 1])
  // Acompañamos los extremos con una página cercana para evitar elipsis de un único número
  if (current <= 3) { pages.add(2); pages.add(3); pages.add(4) }
  if (current >= totalPages - 2) { pages.add(totalPages - 1); pages.add(totalPages - 2); pages.add(totalPages - 3) }
  const ordered = [...pages].filter(n => n >= 1 && n <= totalPages).sort((a, b) => a - b)
  const result = []
  ordered.forEach((n, i) => {
    if (i > 0 && n - ordered[i - 1] > 1) result.push('…')
    result.push(n)
  })
  return result
}

export default function ClientList() {
  const navigate = useNavigate()
  const { user }  = useAuth()
  const identity  = useMemo(() => getRoundIdentity(user), [user])
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [filtro, setFiltro] = useState('activos')
  const [filtroCategoria, setFiltroCategoria] = useState('')   // '' = todas, 'sin' = sin categoría, '<id>' = id específico
  // Inicializamos clientes con cualquier cache disponible (memoria o sessionStorage)
  // para evitar el spinner full-page cuando ya tenemos datos.
  const [clientes, setClientes] = useState(() => peekPersistedCache('clientes') || [])
  // loading=true SOLO si no había nada cacheado de entrada.
  const [loading, setLoading] = useState(() => !peekPersistedCache('clientes'))
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [erpCliente, setErpCliente] = useState(null)
  const [page, setPage] = useState(1)
  const [fotoPreview, setFotoPreview] = useState(null) // { imgUrl, nombre, x, y }
  const [fechasBaja, setFechasBaja] = useState({})    // { clienteId: fechaIso }
  // Bajas programadas pendientes: { clienteIdnoofit: {fecha_baja, motivo} }
  const [bajasProgramadas, setBajasProgramadas] = useState({})
  // Pausas (inactividad temporal) activas: { clienteIdnoofit: <pausa> }
  const [temporales, setTemporales] = useState({})
  const [fotoFailed,  setFotoFailed]  = useState(false)
  // Reset del fallo al cambiar de foto
  useEffect(() => { setFotoFailed(false) }, [fotoPreview?.imgUrl])

  useEffect(() => {
    let active = true
    setError('')

    const hadCache = !!peekPersistedCache('clientes')
    setRefreshing(true)

    // Refresco en segundo plano (la cache ya pintó la lista al inicializar el state)
    getClientes()
      .then(cli => { if (active) setClientes(cli) })
      .catch(err => { if (active && !hadCache) setError(err.message) })
      .finally(() => { if (active) { setLoading(false); setRefreshing(false) } })

    return () => { active = false }
  }, [])

  // Recarga forzada (limpia caché + pide a NoofitPro). Útil tras alta/reactivación.
  const reloadClientes = async () => {
    try {
      invalidateCache('clientes')
      clearPersistedCache('clientes')
      const cli = await getClientes()
      setClientes(cli)
    } catch {}
  }

  // Cargar fechas de baja (último cambio archivado) para mostrarlas junto al badge
  useEffect(() => {
    if (!identity?.managerId) return
    fechaBajaPorCliente(identity)
      .then(map => setFechasBaja(map || {}))
      .catch(() => {})
  }, [identity.managerId])

  // Cargar bajas programadas pendientes (futuras o pasadas no ejecutadas)
  // del manager → map por cliente_idnoofit. Sirve para el badge "Baja prog."
  // y para el filtro "Con baja programada".
  useEffect(() => {
    if (!identity?.managerId) return
    bajaProgramadaList(identity, false)
      .then(rows => {
        const m = {}
        for (const r of (rows || [])) m[String(r.cliente_idnoofit)] = r
        setBajasProgramadas(m)
      })
      .catch(() => setBajasProgramadas({}))
  }, [identity.managerId])

  // Cargar pausas activas (inactividad temporal: programada|en_curso) del
  // manager → map por cliente_idnoofit. Sirve para el badge "Pausa" y el
  // filtro "Temporal inactivo".
  useEffect(() => {
    if (!identity?.managerId) return
    temporalInactivoList(identity)
      .then(rows => {
        const m = {}
        for (const r of (rows || [])) m[String(r.cliente_idnoofit)] = r
        setTemporales(m)
      })
      .catch(() => setTemporales({}))
  }, [identity.managerId])

  // ERP activo si existe alguna configuración con al menos un campo definido
  const [tieneERP, setTieneERP] = useState(false)
  const [erpConfig, setErpConfig] = useState(null)
  useEffect(() => {
    let active = true
    getERPConfiguraciones()
      .then(raw => {
        if (!active) return
        const configs = Array.isArray(raw) ? raw : (raw ? [raw] : [])
        const withFields = configs.find(c => Array.isArray(c?.campos) && c.campos.length > 0)
        setTieneERP(!!withFields)
        setErpConfig(withFields || null)
      })
      .catch(() => { if (active) { setTieneERP(false); setErpConfig(null) } })
    return () => { active = false }
  }, [])

  const clientFullName = c => `${c.nombre || c.name || ''} ${c.apellidos || c.surname || ''}`.trim()

  // Detección de cliente Gympass: tira de la BD propia del VPS (cliente_gympass)
  // y como fallback usa el alias. (Compat — se mostrará si no tiene categoría asignada)
  const { isGympass, getGympassId } = useGympassMap()
  // Sistema nuevo: catálogo de categorías + asignación cliente↔categoría
  const { categorias, getCategoria } = useCategoriasMap()
  const canExportarExcel = useCan('clientes.exportar_excel')
  const canCrearCliente  = useCan('clientes.crear')

  const filtered = useMemo(() => clientes.filter(c => {
    // Búsqueda case+accent-insensitive. "Jimenez" matchea "Jiménez",
    // "MARIA" matchea "María", "perez" matchea "Pérez", etc.
    const haystack = `${clientFullName(c)} ${c.email || ''} ${c.gympassId || ''} ${c.alias || ''} ${c.dni || ''}`
    if (!coincideTexto(haystack, deferredSearch)) return false
    if (filtroCategoria) {
      const cat = getCategoria(c)
      if (filtroCategoria === 'sin') { if (cat) return false }
      else if (!cat || String(cat.id) !== String(filtroCategoria)) return false
    }
    const bajaProg = bajasProgramadas[String(c.id)]
    const temporal = temporales[String(c.id)]
    if (filtro === 'activos')   return c.enabled !== false && !bajaProg && !temporal
    if (filtro === 'inactivos') return c.enabled === false && !temporal
    if (filtro === 'baja_prog') return !!bajaProg && c.enabled !== false && !temporal
    if (filtro === 'temporal')  return !!temporal
    return true
  }), [clientes, deferredSearch, filtro, filtroCategoria, getCategoria, bajasProgramadas, temporales])

  // Paginación: calcular total y ajustar la página actual si el filtro la deja
  // fuera de rango (p.ej. estábamos en pág. 5 y el nuevo filtro sólo tiene 3).
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  // Solo bloqueamos con spinner si NO tenemos absolutamente nada que pintar.
  // Si hay datos cacheados, los mostramos al instante y refrescamos en background.
  if (loading && clientes.length === 0) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '120px 0' }} role="status" aria-label="Cargando clientes">
      <Loader2 size={22} className="animate-spin" style={{ color: 'var(--green)' }} aria-hidden="true" />
    </div>
  )

  if (error) return (
    <div role="alert" style={{ padding: '80px 0', textAlign: 'center', fontSize: 15, color: 'var(--red)' }}>
      Error cargando clientes
    </div>
  )

  const startIdx = (page - 1) * PAGE_SIZE
  const visible = filtered.slice(startIdx, startIdx + PAGE_SIZE)
  // Notas siempre presentes; columna "Acciones" reservada solo si hay un cliente
  // archivado con permiso de reactivación (botón Reactivar). En el caso normal
  // se renderiza vacía.
  const cols = '2.4fr 1fr 2fr 120px 1fr 1fr auto auto'
  const pageList = buildPageList(totalPages, page)
  const goPage = p => setPage(Math.min(totalPages, Math.max(1, p)))

  return (
    <div>
      {/* ── Toolbar + contador (sticky, compacto) ── */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 50,
        isolation: 'isolate',
        background: 'var(--bg-0)',
        // Extiende horizontalmente para cubrir toda la anchura visible del scroll
        // y evitar que las filas que hay debajo se vean al pasar por detrás.
        marginLeft: 'calc(-1 * clamp(20px, 4vw, 48px))',
        marginRight: 'calc(-1 * clamp(20px, 4vw, 48px))',
        paddingLeft: 'clamp(20px, 4vw, 48px)',
        paddingRight: 'clamp(20px, 4vw, 48px)',
        paddingTop: 12,
        paddingBottom: 10,
        marginBottom: 12,
        borderBottom: '1px solid var(--line)',
        boxShadow: '0 4px 10px -6px rgba(0,0,0,0.25)',
      }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
            <Search size={15} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }} aria-hidden="true" />
            <input type="search" placeholder="Buscar cliente..."
                   value={search}
                   onChange={e => { setSearch(e.target.value); setPage(1) }}
                   aria-label="Buscar cliente"
                   style={{
                     width: '100%', padding: '10px 14px 10px 40px', borderRadius: 12, fontSize: 13,
                     background: 'var(--bg-2)', border: '1px solid var(--line)', color: 'var(--text-0)',
                     outline: 'none',
                   }} />
          </div>

          <div role="group" aria-label="Filtrar clientes" style={{ display: 'flex', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--line)' }}>
            {[['activos','Activos'],['baja_prog','Con baja prog.'],['inactivos','Inactivos'],['temporal','Temporal inactivo'],['todos','Todos']].map(([v, l]) => (
              <button key={v} onClick={() => { setFiltro(v); setPage(1) }}
                      aria-pressed={filtro === v}
                      style={{
                        padding: '8px 14px', fontSize: 12, fontWeight: 500, cursor: 'pointer', border: 'none',
                        background: filtro === v ? 'var(--green-bg)' : 'var(--bg-2)',
                        color: filtro === v ? 'var(--green)' : 'var(--text-2)',
                        transition: 'all 0.1s',
                      }}>
                {l}
              </button>
            ))}
          </div>

          <select value={filtroCategoria}
                  onChange={e => { setFiltroCategoria(e.target.value); setPage(1) }}
                  aria-label="Filtrar por categoría"
                  title="Filtrar por categoría"
                  style={{
                    padding: '8px 12px', fontSize: 12, fontWeight: 500, cursor: 'pointer',
                    borderRadius: 10, background: 'var(--bg-2)',
                    color: filtroCategoria ? 'var(--text-0)' : 'var(--text-2)',
                    border: '1px solid var(--line)',
                  }}>
            <option value="">Todas las categorías</option>
            <option value="sin">Sin categoría (pagador con cuota)</option>
            {categorias.filter(c => c.activa).map(c => (
              <option key={c.id} value={c.id}>{c.nombre}</option>
            ))}
          </select>

          {canExportarExcel && (
          <Btn size="md" variant="secondary"
               disabled={filtered.length === 0}
               onClick={() => {
                 // Exporta a Excel los clientes actualmente filtrados con
                 // solo Nombre, Apellidos, Email. El nombre de archivo
                 // incluye el filtro aplicado y la fecha de descarga.
                 const rows = filtered.map(c => ({
                   Nombre:    c.name    || c.nombre    || '',
                   Apellidos: c.surname || c.apellidos || '',
                   Email:     c.email   || '',
                 }))
                 const ws = XLSX.utils.json_to_sheet(rows,
                   { header: ['Nombre', 'Apellidos', 'Email'] })
                 ws['!cols'] = [{ wch: 22 }, { wch: 28 }, { wch: 32 }]
                 const wb = XLSX.utils.book_new()
                 XLSX.utils.book_append_sheet(wb, ws, 'Clientes')
                 const hoy = new Date().toISOString().slice(0, 10)
                 const partes = ['clientes', filtro]
                 if (filtroCategoria) {
                   const cat = categorias.find(x => String(x.id) === String(filtroCategoria))
                   partes.push(filtroCategoria === 'sin' ? 'sin-categoria'
                     : (cat?.nombre || `cat${filtroCategoria}`)
                       .toLowerCase().replace(/[^a-z0-9]+/g, '-'))
                 }
                 if (deferredSearch) partes.push('busq')
                 XLSX.writeFile(wb, `${partes.join('_')}_${hoy}.xlsx`)
               }}
               title={filtered.length === 0
                  ? 'No hay clientes con el filtro actual'
                  : `Exportar ${filtered.length} cliente${filtered.length !== 1 ? 's' : ''} a Excel (nombre, apellidos, email)`}>
            <Download size={14} aria-hidden="true" /> Excel
          </Btn>
          )}

          {/* QR del centro: aparece arriba a la derecha cuando el modo de
              "Alta de cliente" del trainer activo es 'centro' o 'ambos'.
              Se actualiza solo si el gestor cambia la configuración. */}
          {identity?.trainerId && (
            <QrCentroButton trainerId={String(identity.trainerId)}
                            nombreCentro={identity.trainerName} />
          )}
          {canCrearCliente && (
            <Btn size="md" onClick={() => navigate('/clientes/nuevo')}>
              <Plus size={15} aria-hidden="true" /> Nuevo cliente
            </Btn>
          )}
        </div>

        {(() => {
          const sinFoto = filtered.filter(c => !c.imgUrl || typeof c.imgUrl !== 'string' || !c.imgUrl.trim()).length
          return (
            <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }} aria-live="polite">
              <span>
                {filtered.length} cliente{filtered.length !== 1 ? 's' : ''}
                {filtered.length > 0 && (
                  <span style={{ marginLeft: 10 }}>
                    · <strong style={{ color: sinFoto > 0 ? 'var(--amber)' : 'var(--text-2)' }}>{sinFoto}</strong> sin foto
                  </span>
                )}
              </span>
              {refreshing && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--text-3)' }}>
                  <Loader2 size={11} className="animate-spin" aria-hidden="true" />
                  actualizando…
                </span>
              )}
            </p>
          )
        })()}
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No se encontraron clientes"
                    description={deferredSearch ? 'Prueba con otros términos de búsqueda' : undefined} />
      ) : (
        <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 20, overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 0, padding: '8px 20px', background: 'var(--bg-3)', borderBottom: '1px solid var(--line)' }}>
            {['Cliente', 'Categoría', 'Email', 'Estado', 'Teléfono', 'DNI', 'Notas', ''].map((h, i) => (
              <span key={i} style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-3)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>{h}</span>
            ))}
          </div>

          {/* Rows */}
          {visible.map((c, i) => (
            <div key={c.id}
                 role="button"
                 tabIndex={0}
                 onClick={() => navigate(`/clientes/${c.id}`)}
                 onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && navigate(`/clientes/${c.id}`)}
                 aria-label={`Ver perfil de ${c.name} ${c.surname}`}
                 className="interactive-row"
                 style={{
                   display: 'grid', gridTemplateColumns: cols, alignItems: 'center',
                   gap: 12,
                   padding: '8px 20px', cursor: 'pointer',
                   borderBottom: i < visible.length - 1 ? '1px solid var(--line)' : 'none',
                   transition: 'background 0.1s',
                   minHeight: 48,             // altura fija = una sola línea visual
                 }}>

              {/* Cliente */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingRight: 12, minWidth: 0 }}>
                <button onClick={e => {
                          e.stopPropagation()
                          const r = e.currentTarget.getBoundingClientRect()
                          // 10cm ≈ 378px @ 96dpi — clampamos al viewport con un margen de 12px
                          const SIZE = 378
                          const M = 12
                          let x = r.right + 8 // al lado derecho del avatar
                          let y = r.top
                          if (x + SIZE + M > window.innerWidth) x = Math.max(M, r.left - SIZE - 8)
                          if (x + SIZE + M > window.innerWidth) x = window.innerWidth - SIZE - M
                          if (y + SIZE + 80 > window.innerHeight) y = window.innerHeight - SIZE - 80 - M
                          if (y < M) y = M
                          setFotoPreview({ imgUrl: c.imgUrl, nombre: clientFullName(c), x, y })
                        }}
                        onKeyDown={e => e.stopPropagation()}
                        aria-label={`Ampliar foto de ${clientFullName(c)}`}
                        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0, borderRadius: 12 }}>
                  <Avatar nombre={clientFullName(c)} size={30} imgUrl={c.imgUrl} />
                </button>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontFamily: 'Outfit', fontSize: 16, fontWeight: 700, color: 'var(--text-0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.25 }}>
                    {clientFullName(c)}
                  </p>
                  {c.idEspejo != null && (
                    <p style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'monospace' }}>#{c.idEspejo}</p>
                  )}
                </div>
              </div>

              {/* Categoría */}
              {(() => {
                const cat = getCategoria(c)
                if (cat) {
                  const color = cat.color || 'purple'
                  const titleParts = [cat.nombre]
                  if (!cat.activa) titleParts.push('inactiva')
                  if (!cat.puede_reservar) titleParts.push('no reserva clases')
                  if (!cat.tiene_cuota) titleParts.push('sin cuota')
                  return (
                    <div>
                      <Badge color={color} title={titleParts.join(' · ')}>
                        {cat.nombre}
                      </Badge>
                    </div>
                  )
                }
                // Compat: marcar gympass detectado por alias si no tiene categoría
                if (isGympass(c)) {
                  return (
                    <div>
                      <Badge color="purple" title={getGympassId(c) || c.alias || 'Gympass (alias)'}>Gympass</Badge>
                    </div>
                  )
                }
                // Sin categoría = pagador con cuota → vacío
                return <p style={{ fontSize: 13, color: 'var(--text-3)' }}>—</p>
              })()}

              {/* Email */}
              <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 12 }} title={c.email}>
                {c.email || '—'}
              </p>

              {/* Estado */}
              <div>
                {c.enabled === false ? (() => {
                  const motivo = typeof c.motivoArchivado === 'string'
                    ? c.motivoArchivado.trim()
                    : ''
                  const fbIso = fechasBaja[c.id]
                  let fbStr = ''
                  if (fbIso) {
                    try {
                      const d = new Date(fbIso)
                      fbStr = d.toLocaleDateString('es-ES',
                        { day: 'numeric', month: 'short', year: 'numeric' })
                    } catch {}
                  }
                  const tooltipParts = []
                  if (fbStr) tooltipParts.push(`Inactivo desde ${fbStr}`)
                  if (motivo) tooltipParts.push(`Motivo: ${motivo}`)
                  return (
                    <Badge color="red" title={tooltipParts.join(' · ')}>
                      <Archive size={10} aria-hidden="true" /> Inactivo
                    </Badge>
                  )
                })() : (() => {
                  // Prioridad: pausa (inactividad temporal) > baja programada > activo.
                  const tmp = temporales[String(c.id)]
                  if (tmp) {
                    let iniStr = '', finStr = ''
                    try {
                      iniStr = new Date(tmp.fecha_inicio).toLocaleDateString('es-ES',
                        { day: '2-digit', month: '2-digit', year: '2-digit' })
                    } catch {}
                    try {
                      finStr = new Date(tmp.fecha_fin).toLocaleDateString('es-ES',
                        { day: '2-digit', month: '2-digit', year: '2-digit' })
                    } catch {}
                    const motivoLbl = MOTIVO_PAUSA_LABEL[tmp.motivo] || tmp.motivo || '—'
                    return (
                      <Badge color="amber"
                             title={`Pausa: ${motivoLbl} · ${iniStr} → ${finStr}`}>
                        Pausa: {motivoLbl} · {iniStr}→{finStr}
                      </Badge>
                    )
                  }
                  // Si hay baja programada pendiente, mostrar fecha en amarillo.
                  // Si NO la hay, badge verde "Activo" estándar.
                  const bp = bajasProgramadas[String(c.id)]
                  if (bp) {
                    let fbStr = ''
                    try {
                      const d = new Date(bp.fecha_baja)
                      fbStr = d.toLocaleDateString('es-ES',
                        { day: '2-digit', month: '2-digit', year: '2-digit' })
                    } catch {}
                    const tooltip = bp.motivo
                      ? `Desactivación programada para el ${fbStr}. Motivo: ${bp.motivo}`
                      : `Desactivación programada para el ${fbStr}`
                    return (
                      <Badge color="amber" title={tooltip}>
                        Desactivación en {fbStr}
                      </Badge>
                    )
                  }
                  return <Badge color="green">Activo</Badge>
                })()}
              </div>

              {/* Teléfono */}
              <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-1)',
                           overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 8 }}
                 title={c.cellPhone || ''}>{c.cellPhone || '—'}</p>

              {/* DNI */}
              <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-1)', fontFamily: 'var(--font-mono)',
                           overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 8 }}
                 title={c.dni || ''}>{c.dni || '—'}</p>

              {/* Notas — popover con últimas 3 */}
              <NotasPopover cliente={c} />

              {/* Reactivar — solo para archivados (al activar se abre ERP) */}
              {c.enabled === false && tieneERP ? (
                <button onClick={e => { e.stopPropagation(); setErpCliente({ ...c, _recaptacion: true }) }}
                        aria-label={`Reactivar y enviar ERP para ${c.name} ${c.surname}`}
                        title="Reactivar cliente · abre datos ERP en edición y crea alta nueva en Odoo"
                        style={{
                          display: 'flex', alignItems: 'center', gap: 5,
                          padding: '5px 10px', borderRadius: 8, fontSize: 11, fontWeight: 600,
                          cursor: 'pointer', border: '1px solid var(--green-border)',
                          background: 'var(--green-bg)', color: 'var(--green)', transition: 'all 0.1s',
                          whiteSpace: 'nowrap',
                        }}>
                  <Send size={11} aria-hidden="true" /> Reactivar
                </button>
              ) : <span aria-hidden="true" />}
            </div>
          ))}
        </div>
      )}

      {/* ── Paginación ── */}
      {filtered.length > PAGE_SIZE && (
        <nav aria-label="Paginación de clientes"
             style={{
               marginTop: 16, display: 'flex', flexWrap: 'wrap',
               alignItems: 'center', justifyContent: 'center', gap: 4,
             }}>
          <PagerBtn onClick={() => goPage(1)} disabled={page === 1} title="Primera página">
            <ChevronsLeft size={14} aria-hidden="true" />
          </PagerBtn>
          <PagerBtn onClick={() => goPage(page - 1)} disabled={page === 1} title="Página anterior">
            <ChevronLeft size={14} aria-hidden="true" />
          </PagerBtn>

          {pageList.map((p, i) =>
            p === '…' ? (
              <span key={`e${i}`} style={{ padding: '0 6px', fontSize: 13, color: 'var(--text-3)' }}>…</span>
            ) : (
              <PagerBtn key={p} onClick={() => goPage(p)} active={p === page}
                        title={`Página ${p}`} aria-current={p === page ? 'page' : undefined}>
                {p}
              </PagerBtn>
            )
          )}

          <PagerBtn onClick={() => goPage(page + 1)} disabled={page === totalPages} title="Página siguiente">
            <ChevronRight size={14} aria-hidden="true" />
          </PagerBtn>
          <PagerBtn onClick={() => goPage(totalPages)} disabled={page === totalPages} title="Última página">
            <ChevronsRight size={14} aria-hidden="true" />
          </PagerBtn>

          <span style={{ marginLeft: 12, fontSize: 12, color: 'var(--text-3)' }} aria-live="polite">
            {startIdx + 1}–{Math.min(startIdx + PAGE_SIZE, filtered.length)} de {filtered.length}
          </span>
        </nav>
      )}

      {erpCliente && (
        <AltaClienteModal cliente={erpCliente}
                  recaptacion={!!erpCliente._recaptacion}
                  onSaved={reloadClientes}
                  onClose={() => setErpCliente(null)} />
      )}

      {/* Preview de foto ampliada 10x10 cm, anclada a la posición del click */}
      {fotoPreview && (
        <>
          {/* Capa transparente para cerrar al hacer click fuera */}
          <div onClick={() => setFotoPreview(null)}
               style={{ position: 'fixed', inset: 0, zIndex: 99, background: 'transparent' }} />
          {/* Popup en la posición del click */}
          <div role="dialog" aria-label={`Foto de ${fotoPreview.nombre}`}
               onClick={e => e.stopPropagation()}
               style={{
                 position: 'fixed', top: fotoPreview.y, left: fotoPreview.x, zIndex: 100,
                 background: 'var(--bg-2)', borderRadius: 16, padding: 10,
                 border: '1px solid var(--line)',
                 boxShadow: '0 18px 48px rgba(0,0,0,0.45)',
                 display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
               }}>
            <button onClick={() => setFotoPreview(null)}
                    aria-label="Cerrar"
                    style={{
                      position: 'absolute', top: 6, right: 6,
                      width: 28, height: 28, borderRadius: 8,
                      background: 'rgba(0,0,0,0.55)', color: '#fff',
                      border: 'none', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
              <X size={14} aria-hidden="true" />
            </button>
            <div style={{
              width: '10cm', height: '10cm',
              borderRadius: 12, overflow: 'hidden',
              background: 'var(--bg-3)', border: '1px solid var(--line)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {(() => {
                const safe = isSafeImageUrl(fotoPreview.imgUrl)
                const url  = safe ? normalizeImageUrl(fotoPreview.imgUrl) : null
                if (!url || fotoFailed) {
                  // Iniciales en grande como fallback
                  const ini = fotoPreview.nombre?.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?'
                  return (
                    <div role="img" aria-label={fotoPreview.nombre ?? ''}
                         style={{
                           width: '100%', height: '100%',
                           display: 'flex', alignItems: 'center', justifyContent: 'center',
                           background: 'var(--bg-2)',
                           color: 'var(--text-2)',
                           fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 64,
                         }}>
                      {ini}
                    </div>
                  )
                }
                return (
                  <img src={url} alt=""
                       aria-label={fotoPreview.nombre}
                       onError={() => {
                         // eslint-disable-next-line no-console
                         console.warn('[fotoPreview] no se pudo cargar:', url, 'cliente:', fotoPreview.nombre)
                         setFotoFailed(true)
                       }}
                       style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                )
              })()}
            </div>
            <p style={{ fontFamily: 'Outfit', fontSize: 13, fontWeight: 600, color: 'var(--text-0)', textAlign: 'center', maxWidth: '10cm', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {fotoPreview.nombre}
            </p>
          </div>
        </>
      )}
    </div>
  )
}

// ── Botón de paginación ──────────────────────────────────────────────────────
function PagerBtn({ children, onClick, disabled, active, title, ...rest }) {
  return (
    <button onClick={onClick} disabled={disabled} title={title} {...rest}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              minWidth: 30, height: 30, padding: '0 9px',
              borderRadius: 8, fontSize: 13, fontWeight: active ? 600 : 500,
              cursor: disabled ? 'not-allowed' : 'pointer',
              border: '1px solid ' + (active ? 'var(--green)' : 'var(--line)'),
              background: active ? 'var(--green-bg)' : 'var(--bg-2)',
              color: active ? 'var(--green)' : disabled ? 'var(--text-3)' : 'var(--text-2)',
              opacity: disabled ? 0.45 : 1,
              transition: 'all 0.1s',
              fontFamily: 'inherit',
            }}>
      {children}
    </button>
  )
}
