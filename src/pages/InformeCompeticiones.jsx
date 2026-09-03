// Informe de COMPETICIONES — participaciones y ranking por competición.
//
// Fuente: /api/informes/competiciones (cache local sincronizada desde el
// namespace /api/competicion/* de NoofitPro). Cada participación pertenece a
// un circuito y su modalidad se deriva del circuito: 'oficial', 'mygym' o
// 'wod'. La pantalla muestra totales, desglose por modalidad, tabla de
// competiciones (con badge de modalidad) y top clientes por participaciones.

import { useEffect, useState, useMemo, useCallback } from 'react'
import {
  Award, Loader2, RefreshCw, Users, Trophy, CalendarDays,
  ChevronUp, ChevronDown, ChevronsUpDown, Tag, VenusAndMars,
} from 'lucide-react'
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
import { Card, Btn } from '../components/UI'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../components/Toast'
import {
  getRoundIdentity, informeCompeticiones, informeCompeticionesEstado,
  informeCompeticionesSync, categoriasList,
} from '../utils/configApi'
import { formatDate } from '../utils/formatters'

function isoDaysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}
const HOY = new Date().toISOString().slice(0, 10)
const fmtNum = (n) => (n == null ? '—' : Number(n).toLocaleString('es-ES'))

const MODALIDADES = [
  { key: '',        label: 'Todas' },
  { key: 'oficial', label: 'Oficial' },
  { key: 'mygym',   label: 'MyGym' },
  { key: 'wod',     label: 'WOD' },
]
const MOD_LABEL = { oficial: 'Oficial', mygym: 'MyGym', wod: 'WOD' }
const SEXOS = [
  { key: '',  label: 'Ambos' },
  { key: 'M', label: 'Hombres' },
  { key: 'F', label: 'Mujeres' },
]
// Colores del badge por modalidad (variables CSS del tema)
const MOD_COLOR = {
  oficial: { bg: 'rgba(251,191,36,0.15)', fg: '#fbbf24' },   // oro
  mygym:   { bg: 'rgba(91,156,246,0.15)', fg: '#5b9cf6' },   // azul
  wod:     { bg: 'rgba(248,113,113,0.15)', fg: '#f87171' },  // rojo
}

export default function InformeCompeticiones() {
  const { user } = useAuth()
  const identity = useMemo(() => getRoundIdentity(user), [user])
  const toast = useToast()

  const [desde, setDesde] = useState(isoDaysAgo(90))
  const [hasta, setHasta] = useState(HOY)
  const [modalidad, setModalidad] = useState('')
  const [sexo, setSexo] = useState('')
  const [categoriaId, setCategoriaId] = useState('')

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [estado, setEstado] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [categorias, setCategorias] = useState([])

  // Sort de tablas
  const [sortComp, setSortComp] = useState({ col: 'fecha', dir: 'desc' })
  const [sortTop,  setSortTop]  = useState({ col: 'competiciones', dir: 'desc' })

  const cargar = useCallback(async () => {
    if (!identity?.managerId) return
    setLoading(true)
    try {
      const d = await informeCompeticiones(identity, {
        desde, hasta, limit: 200,
        ...(modalidad ? { modalidad } : {}),
        ...(sexo ? { sexo } : {}),
        ...(categoriaId ? { categoria: categoriaId } : {}),
      })
      setData(d)
    } catch (e) {
      toast.error(`Error cargando informe: ${e.message}`)
    } finally { setLoading(false) }
  }, [identity?.managerId, desde, hasta, modalidad, sexo, categoriaId])

  useEffect(() => { cargar() }, [cargar])

  // Estado del sync + sync incremental en background al abrir.
  useEffect(() => {
    if (!identity?.managerId) return
    let active = true
    ;(async () => {
      try {
        const st = await informeCompeticionesEstado(identity)
        if (!active) return
        setEstado(st)
        informeCompeticionesSync(identity).catch(() => {})
      } catch { /* estado es informativo */ }
    })()
    return () => { active = false }
  }, [identity?.managerId])

  // Catálogo de categorías del manager (para el filtro).
  useEffect(() => {
    if (!identity?.managerId) return
    let active = true
    ;(async () => {
      try {
        const cats = await categoriasList(identity)
        if (!active) return
        setCategorias((cats || []).filter(c => c.activa !== false))
      } catch { /* opcional */ }
    })()
    return () => { active = false }
  }, [identity?.managerId])

  const handleSyncAhora = async () => {
    setSyncing(true)
    try {
      await informeCompeticionesSync(identity)
      toast.success('Sincronización lanzada en segundo plano — pulsa "Actualizar" en unos minutos')
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setSyncing(false)
  }

  const rawCompeticiones = data?.competiciones || []
  const rawTopClientes = data?.top_clientes || []
  const totalComp = Number(data?.totales?.competiciones || 0)

  const competiciones = useMemo(() => {
    const arr = [...rawCompeticiones]
    const { col, dir } = sortComp
    const mul = dir === 'asc' ? 1 : -1
    return arr.sort((a, b) => {
      const av = a?.[col]; const bv = b?.[col]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (col === 'fecha') return (String(av) < String(bv) ? -1 : String(av) > String(bv) ? 1 : 0) * mul
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mul
      return String(av).localeCompare(String(bv), 'es') * mul
    })
  }, [rawCompeticiones, sortComp])

  const topClientes = useMemo(() => {
    const arr = [...rawTopClientes]
    const { col, dir } = sortTop
    const mul = dir === 'asc' ? 1 : -1
    return arr.sort((a, b) => {
      const av = a?.[col]; const bv = b?.[col]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mul
      return String(av).localeCompare(String(bv), 'es') * mul
    })
  }, [rawTopClientes, sortTop])

  const toggleSort = (state, setState, col) => {
    setState(s => (s.col === col
      ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { col, dir: col === 'nombre' ? 'asc' : 'desc' }))
  }
  const porModalidad = useMemo(() => {
    // Rellenamos siempre las tres modalidades para que las tarjetas se vean
    // aunque una esté vacía (cuando no hay filtro activo).
    const base = { oficial: null, mygym: null, wod: null }
    for (const r of (data?.por_modalidad || [])) {
      if (r && r.modalidad in base) base[r.modalidad] = r
    }
    return base
  }, [data])

  const setPreset = (dias) => { setDesde(isoDaysAgo(dias)); setHasta(HOY) }

  return (
    <div>
      {/* ── Cabecera ──────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
                    gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontFamily: 'Outfit', fontSize: 24, fontWeight: 700,
                       color: 'var(--text-0)', margin: 0,
                       display: 'flex', alignItems: 'center', gap: 10 }}>
            <Trophy size={22} style={{ color: 'var(--green)' }} aria-hidden="true" />
            Informe de Competiciones
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '6px 0 0' }}>
            Competiciones celebradas en el centro, participantes y ranking de
            clientes por número de participaciones. Desglose por modalidad
            (Oficial, MyGym y WOD).
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {estado?.ultimo_sync && (
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
              Última sincronización: {new Date(estado.ultimo_sync).toLocaleString('es-ES')}
            </span>
          )}
          <Btn variant="secondary" size="sm" onClick={handleSyncAhora} disabled={syncing}>
            {syncing ? <Loader2 size={13} className="animate-spin" aria-hidden="true" />
                     : <RefreshCw size={13} aria-hidden="true" />}
            {' Sincronizar'}
          </Btn>
          <Btn variant="secondary" size="sm" onClick={cargar} disabled={loading}>
            {loading ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : null}
            {' Actualizar'}
          </Btn>
        </div>
      </div>

      {/* ── Filtros de periodo + modalidad ────────────────────────────── */}
      <Card style={{ padding: 18, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <CalendarDays size={15} style={{ color: 'var(--text-3)' }} aria-hidden="true" />
          {[['30 días', 30], ['90 días', 90], ['12 meses', 365]].map(([l, n]) => (
            <Btn key={n} size="sm"
                 variant={desde === isoDaysAgo(n) && hasta === HOY ? 'primary' : 'secondary'}
                 onClick={() => setPreset(n)}>{l}</Btn>
          ))}
          <input type="date" value={desde} onChange={e => setDesde(e.target.value)} style={inputStyle} />
          <span style={{ color: 'var(--text-3)', fontSize: 12 }}>→</span>
          <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} style={inputStyle} />
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center',
                      marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
          <span style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase',
                         letterSpacing: '0.04em', marginRight: 4 }}>Modalidad</span>
          {MODALIDADES.map((m) => (
            <Btn key={m.key || 'all'} size="sm"
                 variant={modalidad === m.key ? 'primary' : 'secondary'}
                 onClick={() => setModalidad(m.key)}>{m.label}</Btn>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center',
                      marginTop: 10 }}>
          <VenusAndMars size={14} style={{ color: 'var(--text-3)' }} aria-hidden="true" />
          <span style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase',
                         letterSpacing: '0.04em', marginRight: 4 }}>Sexo</span>
          {SEXOS.map((s) => (
            <Btn key={s.key || 'all'} size="sm"
                 variant={sexo === s.key ? 'primary' : 'secondary'}
                 onClick={() => setSexo(s.key)}>{s.label}</Btn>
          ))}
          <div style={{ width: 1, height: 20, background: 'var(--line)', margin: '0 4px' }} />
          <Tag size={14} style={{ color: 'var(--text-3)' }} aria-hidden="true" />
          <span style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase',
                         letterSpacing: '0.04em', marginRight: 4 }}>Categoría</span>
          <select
            value={categoriaId}
            onChange={e => setCategoriaId(e.target.value)}
            style={{ ...inputStyle, minWidth: 160 }}
          >
            <option value="">Todas</option>
            {categorias.map(c => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
          {(sexo || categoriaId) && (
            <Btn size="sm" variant="secondary"
                 onClick={() => { setSexo(''); setCategoriaId('') }}>
              Limpiar
            </Btn>
          )}
        </div>
      </Card>

      {/* ── KPIs globales del filtro ──────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                    gap: 12, marginBottom: 16 }}>
        <Kpi icon={Trophy} label="Competiciones"  value={fmtNum(data?.totales?.competiciones)} />
        <Kpi icon={Award}  label="Participaciones" value={fmtNum(data?.totales?.participaciones)} />
        <Kpi icon={Users}  label="Clientes"        value={fmtNum(data?.totales?.clientes)} />
      </div>

      {/* ── Desglose por modalidad (solo si no hay filtro activo) ─────── */}
      {!modalidad && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                      gap: 12, marginBottom: 16 }}>
          {['oficial', 'mygym', 'wod'].map((k) => (
            <ModCard key={k} modalidad={k} row={porModalidad[k]}
                     onClick={() => setModalidad(k)} />
          ))}
        </div>
      )}

      {/* ── Estado vacío / contenido ──────────────────────────────────── */}
      {loading ? (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: 48, textAlign: 'center' }}>
            <Loader2 size={22} className="animate-spin" style={{ color: 'var(--green)' }} />
          </div>
        </Card>
      ) : totalComp === 0 ? (() => {
        const filtros = []
        if (modalidad) filtros.push(`modalidad ${MOD_LABEL[modalidad]}`)
        if (sexo) filtros.push(sexo === 'M' ? 'hombres' : 'mujeres')
        if (categoriaId) {
          const nom = categorias.find(c => String(c.id) === String(categoriaId))?.nombre
          filtros.push(`categoría ${nom || categoriaId}`)
        }
        const hayFiltro = filtros.length > 0
        const sinDatosGlobales = estado && !estado.filas
        return (
          <Card style={{ padding: 40, textAlign: 'center' }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, margin: '0 auto 14px',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: 'var(--green-bg)' }}>
              <Trophy size={22} style={{ color: 'var(--green)' }} aria-hidden="true" />
            </div>
            <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-0)', margin: 0 }}>
              {hayFiltro
                ? `Sin competiciones para ${filtros.join(' · ')} en el periodo`
                : 'Aún no hay competiciones'}
            </p>
            <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '8px auto 0', maxWidth: 480 }}>
              {hayFiltro
                ? 'Prueba a ampliar el rango de fechas, cambiar de modalidad o quitar algún filtro (sexo / categoría).'
                : (sinDatosGlobales
                    ? 'Se registrarán automáticamente cuando se creen competiciones (Oficial, MyGym o WOD) en NoofitPro.'
                    : 'No hay competiciones en el periodo seleccionado.')}
            </p>
            {hayFiltro && (sexo || categoriaId) && (
              <Btn size="sm" variant="secondary" style={{ marginTop: 14 }}
                   onClick={() => { setSexo(''); setCategoriaId('') }}>
                Limpiar sexo y categoría
              </Btn>
            )}
          </Card>
        )
      })() : (
        <div style={{ display: 'grid', gap: 16 }}>
          {/* ── Gráficos ──────────────────────────────────────────────── */}
          <div style={{ display: 'grid', gap: 16,
                        gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)',
                            fontFamily: 'Outfit', fontWeight: 700, color: 'var(--text-0)',
                            fontSize: 15 }}>
                Participaciones por día
                <span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 400,
                               marginLeft: 8 }}>
                  serie diaria en el periodo
                </span>
              </div>
              <div style={{ padding: 12, height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data?.serie_diaria || []}
                             margin={{ top: 6, right: 12, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                    <XAxis
                      dataKey="dia"
                      tickFormatter={(v) => v?.slice(5) || ''}
                      tick={{ fontSize: 11, fill: 'var(--text-3)' }}
                      minTickGap={20}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 11, fill: 'var(--text-3)' }}
                      width={36}
                    />
                    <Tooltip
                      contentStyle={{ background: 'var(--bg-2)', border: '1px solid var(--line)',
                                      borderRadius: 8, fontSize: 12 }}
                      labelStyle={{ color: 'var(--text-0)' }}
                      labelFormatter={(v) => formatDate(v)}
                    />
                    <Line type="monotone" dataKey="participaciones"
                          stroke="var(--green)" strokeWidth={2}
                          dot={false} name="Participaciones" />
                    <Line type="monotone" dataKey="clientes"
                          stroke="#5b9cf6" strokeWidth={2}
                          strokeDasharray="4 3" dot={false} name="Clientes" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)',
                            fontFamily: 'Outfit', fontWeight: 700, color: 'var(--text-0)',
                            fontSize: 15 }}>
                Participaciones por día de la semana
                <span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 400,
                               marginLeft: 8 }}>
                  acumulado del periodo
                </span>
              </div>
              <div style={{ padding: 12, height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data?.por_dia_semana || []}
                            margin={{ top: 6, right: 12, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                    <XAxis
                      dataKey="nombre"
                      tick={{ fontSize: 11, fill: 'var(--text-3)' }}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 11, fill: 'var(--text-3)' }}
                      width={36}
                    />
                    <Tooltip
                      contentStyle={{ background: 'var(--bg-2)', border: '1px solid var(--line)',
                                      borderRadius: 8, fontSize: 12 }}
                      labelStyle={{ color: 'var(--text-0)' }}
                      cursor={{ fill: 'rgba(45,212,168,0.08)' }}
                    />
                    <Bar dataKey="participaciones"
                         fill="var(--green)" radius={[6, 6, 0, 0]}
                         name="Participaciones" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          {/* ── Tabla de competiciones ────────────────────────────────── */}
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)',
                          fontFamily: 'Outfit', fontWeight: 700, color: 'var(--text-0)', fontSize: 15 }}>
              Competiciones
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--line)', background: 'var(--bg-2)' }}>
                    <SortHeader align="left" state={sortComp}
                                col="nombre" onClick={c => toggleSort(sortComp, setSortComp, c)}>
                      Competición
                    </SortHeader>
                    <SortHeader align="left" state={sortComp}
                                col="modalidad" onClick={c => toggleSort(sortComp, setSortComp, c)}>
                      Modalidad
                    </SortHeader>
                    <SortHeader align="left" state={sortComp}
                                col="fecha" onClick={c => toggleSort(sortComp, setSortComp, c)}>
                      Última
                    </SortHeader>
                    <SortHeader state={sortComp}
                                col="participantes" onClick={c => toggleSort(sortComp, setSortComp, c)}>
                      Participaciones
                    </SortHeader>
                    <SortHeader state={sortComp}
                                col="clientes_distintos" onClick={c => toggleSort(sortComp, setSortComp, c)}>
                      Clientes
                    </SortHeader>
                  </tr>
                </thead>
                <tbody>
                  {competiciones.map((c) => (
                    <tr key={c.id_circuito || `${c.nombre}-${c.fecha}`}
                        style={{ borderBottom: '1px solid var(--line)' }}>
                      <td style={{ ...tdStyle, textAlign: 'left', fontWeight: 600,
                                   color: 'var(--text-0)' }}>
                        {c.nombre || `Circuito #${c.id_circuito}`}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'left' }}>
                        <ModBadge modalidad={c.modalidad} />
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'left' }}>{formatDate(c.fecha)}</td>
                      <td style={tdStyle}>{fmtNum(c.participantes)}</td>
                      <td style={tdStyle}>{fmtNum(c.clientes_distintos)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* ── Top clientes ──────────────────────────────────────────── */}
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)',
                          fontFamily: 'Outfit', fontWeight: 700, color: 'var(--text-0)', fontSize: 15 }}>
              Top clientes
            </div>
            {!topClientes.length ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-2)', fontSize: 13 }}>
                Sin clientes participantes en el periodo.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--line)', background: 'var(--bg-2)' }}>
                      <th style={thStyle}>#</th>
                      <SortHeader align="left" state={sortTop}
                                  col="nombre" onClick={c => toggleSort(sortTop, setSortTop, c)}>
                        Cliente
                      </SortHeader>
                      <SortHeader state={sortTop}
                                  col="competiciones" onClick={c => toggleSort(sortTop, setSortTop, c)}>
                        Competiciones
                      </SortHeader>
                      <SortHeader state={sortTop}
                                  col="participaciones" onClick={c => toggleSort(sortTop, setSortTop, c)}>
                        Participaciones
                      </SortHeader>
                    </tr>
                  </thead>
                  <tbody>
                    {topClientes.map((c, idx) => (
                      <tr key={c.id_cliente}
                          style={{ borderBottom: '1px solid var(--line)' }}>
                        <td style={{ ...tdStyle, color: 'var(--text-3)', width: 36 }}>{idx + 1}</td>
                        <td style={{ ...tdStyle, textAlign: 'left', fontWeight: 600,
                                     color: 'var(--text-0)' }}>{c.nombre || `Cliente #${c.id_cliente}`}</td>
                        <td style={tdStyle}>{fmtNum(c.competiciones)}</td>
                        <td style={tdStyle}>{fmtNum(c.participaciones)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {data && !loading && totalComp > 0 && (
        <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 10 }}>
          Periodo {data.desde} → {data.hasta}
          {modalidad ? ` · modalidad ${MOD_LABEL[modalidad]}` : ''}
          {sexo ? ` · ${sexo === 'M' ? 'hombres' : 'mujeres'}` : ''}
          {categoriaId ? ` · categoría ${categorias.find(c => String(c.id) === String(categoriaId))?.nombre || categoriaId}` : ''}
          . Se sincronizan cada noche (y al abrir esta página, de forma incremental).
        </p>
      )}
    </div>
  )
}

function Kpi({ icon: Icon, label, value }) {
  return (
    <Card style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'var(--green-bg)' }}>
        <Icon size={17} style={{ color: 'var(--green)' }} aria-hidden="true" />
      </div>
      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: 11, color: 'var(--text-3)', margin: 0, textTransform: 'uppercase',
                    letterSpacing: '0.04em' }}>{label}</p>
        <p style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-0)', margin: '2px 0 0',
                    fontFamily: 'Outfit' }}>{value}</p>
      </div>
    </Card>
  )
}

function ModBadge({ modalidad }) {
  const c = MOD_COLOR[modalidad]
  if (!c) return <span style={{ color: 'var(--text-3)', fontSize: 12 }}>—</span>
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999,
                   background: c.bg, color: c.fg, fontSize: 11, fontWeight: 700,
                   textTransform: 'uppercase', letterSpacing: '0.04em' }}>
      {MOD_LABEL[modalidad] || modalidad}
    </span>
  )
}

function ModCard({ modalidad, row, onClick }) {
  const c = MOD_COLOR[modalidad]
  const empty = !row || !Number(row.participaciones)
  return (
    <Card
      onClick={onClick}
      style={{ padding: 16, cursor: 'pointer',
               borderTop: `3px solid ${c.fg}`, opacity: empty ? 0.65 : 1 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <ModBadge modalidad={modalidad} />
        <span style={{ fontSize: 10, color: 'var(--text-3)' }}>
          {empty ? 'sin datos' : 'ver solo esta'}
        </span>
      </div>
      <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: 8 }}>
        <MiniStat label="Comp." value={fmtNum(row?.competiciones)} />
        <MiniStat label="Partic." value={fmtNum(row?.participaciones)} />
        <MiniStat label="Clientes" value={fmtNum(row?.clientes)} />
      </div>
    </Card>
  )
}

function SortHeader({ state, col, onClick, align = 'right', children }) {
  const active = state.col === col
  const Icon = active
    ? (state.dir === 'asc' ? ChevronUp : ChevronDown)
    : ChevronsUpDown
  return (
    <th
      onClick={() => onClick(col)}
      style={{ ...thStyle, textAlign: align, cursor: 'pointer',
               color: active ? 'var(--text-0)' : 'var(--text-3)', userSelect: 'none' }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4,
                     justifyContent: align === 'left' ? 'flex-start' : 'flex-end',
                     width: '100%' }}>
        {children}
        <Icon size={12} style={{ opacity: active ? 1 : 0.5 }} aria-hidden="true" />
      </span>
    </th>
  )
}

function MiniStat({ label, value }) {
  return (
    <div>
      <p style={{ fontSize: 10, color: 'var(--text-3)', margin: 0, textTransform: 'uppercase',
                  letterSpacing: '0.04em' }}>{label}</p>
      <p style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-0)', margin: '2px 0 0',
                  fontFamily: 'Outfit' }}>{value}</p>
    </div>
  )
}

const inputStyle = {
  padding: '8px 10px', borderRadius: 10, fontSize: 13,
  background: 'var(--bg-2)', border: '1px solid var(--line)', color: 'var(--text-0)',
}
const thStyle = {
  padding: '10px 12px', fontSize: 11, fontWeight: 600, color: 'var(--text-3)',
  textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'right',
  whiteSpace: 'nowrap',
}
const tdStyle = {
  padding: '9px 12px', color: 'var(--text-1)', textAlign: 'right', whiteSpace: 'nowrap',
}
