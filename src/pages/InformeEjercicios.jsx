// Informe de EJERCICIOS realizados — ranking de consumo para el gestor.
//
// Qué ejercicios se hacen más en el centro, con filtros por periodo, sexo,
// franja de edad, día de la semana y franja horaria, y un desglose opcional
// por cualquiera de esas dimensiones. Métricas por ejercicio: veces
// ejecutado, clientes únicos, reps medias y duración media/total.
//
// Backend: /api/informes/ejercicios (cache local `ejercicio_realizado`
// sincronizada desde NoofitPro getTrainingsUser; sync incremental).

import { useEffect, useState, useMemo, useCallback } from 'react'
import {
  Dumbbell, Loader2, RefreshCw, Users, Activity, Layers, CalendarDays, Search,
} from 'lucide-react'
import { Card, Btn, Badge } from '../components/UI'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../components/Toast'
import {
  getRoundIdentity, informeEjercicios, informeEjerciciosEstado,
  informeEjerciciosSync,
} from '../utils/configApi'
import { coincideTexto } from '../utils/texto'

const SEXOS = [
  { v: '',         l: 'Ambos sexos' },
  { v: 'hombre',   l: 'Hombres' },
  { v: 'mujer',    l: 'Mujeres' },
]
const FRANJAS_EDAD = [
  { v: '',        l: 'Todas las edades' },
  { v: 'menos18', l: '< 18' },
  { v: '18_29',   l: '18 – 29' },
  { v: '30_44',   l: '30 – 44' },
  { v: '45_59',   l: '45 – 59' },
  { v: '60mas',   l: '60 +' },
]
const DIAS = [
  { v: '',  l: 'Todos los días' },
  { v: '1', l: 'Lunes' }, { v: '2', l: 'Martes' }, { v: '3', l: 'Miércoles' },
  { v: '4', l: 'Jueves' }, { v: '5', l: 'Viernes' }, { v: '6', l: 'Sábado' },
  { v: '7', l: 'Domingo' },
]
const FRANJAS_HORA = [
  { v: '',         l: 'Todo el horario' },
  { v: 'manana',   l: 'Mañana (6-12)' },
  { v: 'mediodia', l: 'Mediodía (12-16)' },
  { v: 'tarde',    l: 'Tarde (16-21)' },
  { v: 'noche',    l: 'Noche (21-6)' },
]
const DESGLOSES = [
  { v: '',     l: 'Sin desglose' },
  { v: 'sexo', l: 'Por sexo' },
  { v: 'edad', l: 'Por franja de edad' },
  { v: 'dia',  l: 'Por día de la semana' },
  { v: 'hora', l: 'Por franja horaria' },
]
// Etiquetas de los buckets que devuelve el backend en `desglose`
const BUCKET_LABELS = {
  sexo: { hombre: 'Hombres', mujer: 'Mujeres', sin_dato: 'Sin dato' },
  edad: { menos18: '<18', '18_29': '18-29', '30_44': '30-44',
          '45_59': '45-59', '60mas': '60+', sin_dato: 'Sin dato' },
  dia:  { 1: 'Lun', 2: 'Mar', 3: 'Mié', 4: 'Jue', 5: 'Vie', 6: 'Sáb', 7: 'Dom' },
  hora: { manana: 'Mañana', mediodia: 'Mediodía', tarde: 'Tarde', noche: 'Noche' },
}
const BUCKET_ORDER = {
  sexo: ['hombre', 'mujer', 'sin_dato'],
  edad: ['menos18', '18_29', '30_44', '45_59', '60mas', 'sin_dato'],
  dia:  ['1', '2', '3', '4', '5', '6', '7'],
  hora: ['manana', 'mediodia', 'tarde', 'noche'],
}

function isoDaysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}
const HOY = new Date().toISOString().slice(0, 10)

function fmtDur(seg) {
  if (!seg) return '—'
  const s = Math.round(seg)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return s % 60 ? `${m}m ${s % 60}s` : `${m}m`
  const h = Math.floor(m / 60)
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`
}
const fmtNum = (n) => (n == null ? '—' : Number(n).toLocaleString('es-ES'))

export default function InformeEjercicios() {
  const { user } = useAuth()
  const identity = useMemo(() => getRoundIdentity(user), [user])
  const toast = useToast()

  // Filtros
  const [desde, setDesde] = useState(isoDaysAgo(90))
  const [hasta, setHasta] = useState(HOY)
  const [sexo, setSexo] = useState('')
  const [franjaEdad, setFranjaEdad] = useState('')
  const [diaSemana, setDiaSemana] = useState('')
  const [franjaHora, setFranjaHora] = useState('')
  const [groupBy, setGroupBy] = useState('')
  const [q, setQ] = useState('')

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [estado, setEstado] = useState(null)
  const [syncing, setSyncing] = useState(false)

  const cargar = useCallback(async () => {
    if (!identity?.managerId) return
    setLoading(true)
    try {
      const d = await informeEjercicios(identity, {
        desde, hasta, sexo, franja_edad: franjaEdad,
        dia_semana: diaSemana, franja_horaria: franjaHora,
        group_by: groupBy, limit: 200,
      })
      setData(d)
    } catch (e) {
      toast.error(`Error cargando informe: ${e.message}`)
    } finally { setLoading(false) }
  }, [identity?.managerId, desde, hasta, sexo, franjaEdad, diaSemana, franjaHora, groupBy])

  useEffect(() => { cargar() }, [cargar])

  // Estado del sync + primer sync automático si la cache está vacía.
  useEffect(() => {
    if (!identity?.managerId) return
    let active = true
    ;(async () => {
      try {
        const st = await informeEjerciciosEstado(identity)
        if (!active) return
        setEstado(st)
        // Dispara un sync incremental en background en cada visita (el
        // backend tiene TTL 6h + anti-stampede, es barato).
        informeEjerciciosSync(identity).catch(() => {})
        if (!st.filas) {
          toast.info?.('Sincronizando entrenamientos por primera vez — puede tardar unos minutos. Pulsa "Actualizar" en un rato.')
        }
      } catch { /* estado es informativo */ }
    })()
    return () => { active = false }
  }, [identity?.managerId])

  const handleSyncAhora = async () => {
    setSyncing(true)
    try {
      await informeEjerciciosSync(identity)
      toast.success('Sincronización lanzada en segundo plano — pulsa "Actualizar" en unos minutos')
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setSyncing(false)
  }

  const ranking = useMemo(() => {
    const rows = data?.ranking || []
    if (!q.trim()) return rows
    return rows.filter(r => coincideTexto(r.nombre || '', q))
  }, [data, q])

  const maxVeces = ranking.length ? Number(ranking[0].veces) : 0
  const totalEjec = Number(data?.totales?.ejecuciones || 0)
  const buckets = groupBy ? BUCKET_ORDER[groupBy] : null

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
            <Dumbbell size={22} style={{ color: 'var(--green)' }} aria-hidden="true" />
            Informe de Ejercicios
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '6px 0 0' }}>
            Qué ejercicios se consumen más en el centro — filtra por periodo, sexo,
            edad, día y franja horaria.
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

      {/* ── Filtros ───────────────────────────────────────────────────── */}
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
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
          <select value={sexo} onChange={e => setSexo(e.target.value)} style={inputStyle}>
            {SEXOS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
          <select value={franjaEdad} onChange={e => setFranjaEdad(e.target.value)} style={inputStyle}>
            {FRANJAS_EDAD.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
          <select value={diaSemana} onChange={e => setDiaSemana(e.target.value)} style={inputStyle}>
            {DIAS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
          <select value={franjaHora} onChange={e => setFranjaHora(e.target.value)} style={inputStyle}>
            {FRANJAS_HORA.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
          <select value={groupBy} onChange={e => setGroupBy(e.target.value)}
                  style={{ ...inputStyle, borderColor: groupBy ? 'var(--green)' : 'var(--line)' }}>
            {DESGLOSES.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
          <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
            <Search size={13} style={{ position: 'absolute', left: 10, top: '50%',
                                        transform: 'translateY(-50%)', color: 'var(--text-3)' }} aria-hidden="true" />
            <input value={q} onChange={e => setQ(e.target.value)}
                   placeholder="Buscar ejercicio…"
                   style={{ ...inputStyle, width: '100%', paddingLeft: 30, boxSizing: 'border-box' }} />
          </div>
        </div>
      </Card>

      {/* ── KPIs ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                    gap: 12, marginBottom: 16 }}>
        <Kpi icon={Activity} label="Ejecuciones" value={fmtNum(data?.totales?.ejecuciones)} />
        <Kpi icon={Dumbbell} label="Ejercicios distintos" value={fmtNum(data?.totales?.ejercicios_distintos)} />
        <Kpi icon={Users}    label="Clientes" value={fmtNum(data?.totales?.clientes)} />
        <Kpi icon={Layers}   label="Sesiones" value={fmtNum(data?.totales?.sesiones)} />
      </div>

      {/* ── Ranking ───────────────────────────────────────────────────── */}
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 48, textAlign: 'center' }}>
            <Loader2 size={22} className="animate-spin" style={{ color: 'var(--green)' }} />
          </div>
        ) : !ranking.length ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-2)', fontSize: 13 }}>
            {estado && !estado.filas
              ? 'Aún no hay datos sincronizados. La primera sincronización está en marcha — vuelve en unos minutos.'
              : 'Sin ejercicios en el periodo / filtros seleccionados.'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line)', background: 'var(--bg-2)' }}>
                  <th style={thStyle}>#</th>
                  <th style={{ ...thStyle, textAlign: 'left' }}>Ejercicio</th>
                  <th style={{ ...thStyle, textAlign: 'left', minWidth: 180 }}>Veces</th>
                  {buckets && buckets.map(b => (
                    <th key={b} style={thStyle}>{BUCKET_LABELS[groupBy][b]}</th>
                  ))}
                  <th style={thStyle}>Clientes</th>
                  <th style={thStyle}>Reps media</th>
                  <th style={thStyle}>Dur. media</th>
                  <th style={thStyle}>Dur. total</th>
                </tr>
              </thead>
              <tbody>
                {ranking.map((r, idx) => {
                  const pct = totalEjec ? (Number(r.veces) / totalEjec) * 100 : 0
                  const barW = maxVeces ? (Number(r.veces) / maxVeces) * 100 : 0
                  const des = data?.desglose?.[r.nombre] || {}
                  return (
                    <tr key={r.nombre} style={{ borderBottom: '1px solid var(--line)' }}>
                      <td style={{ ...tdStyle, color: 'var(--text-3)', width: 36 }}>{idx + 1}</td>
                      <td style={{ ...tdStyle, textAlign: 'left', fontWeight: 600,
                                   color: 'var(--text-0)', maxWidth: 320 }}>
                        {r.nombre}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'left' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ flex: 1, height: 8, borderRadius: 4,
                                        background: 'var(--bg-3)', minWidth: 70, maxWidth: 160 }}>
                            <div style={{ width: `${barW}%`, height: '100%', borderRadius: 4,
                                          background: 'var(--green)', opacity: 0.85 }} />
                          </div>
                          <span style={{ fontWeight: 600, color: 'var(--text-0)' }}>{fmtNum(r.veces)}</span>
                          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{pct.toFixed(1)}%</span>
                        </div>
                      </td>
                      {buckets && buckets.map(b => (
                        <td key={b} style={{ ...tdStyle,
                                             color: des[b] ? 'var(--text-0)' : 'var(--text-3)',
                                             background: des[b]
                                               ? `rgba(45,212,168,${Math.min(0.04 + (des[b] / Number(r.veces)) * 0.25, 0.3)})`
                                               : 'transparent' }}>
                          {des[b] ? fmtNum(des[b]) : '—'}
                        </td>
                      ))}
                      <td style={tdStyle}>{fmtNum(r.clientes)}</td>
                      <td style={tdStyle}>{r.reps_media ? fmtNum(r.reps_media) : '—'}</td>
                      <td style={tdStyle}>{fmtDur(r.dur_media_seg)}</td>
                      <td style={tdStyle}>{fmtDur(r.dur_total_seg)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {data && !loading && (
        <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 10 }}>
          Periodo {data.desde} → {data.hasta}. Solo sesiones cerradas registradas en NoofitPro;
          reps/duración según lo realmente ejecutado. Los datos se sincronizan cada noche
          (y al abrir esta página, de forma incremental).
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
