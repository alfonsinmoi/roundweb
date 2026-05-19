import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Loader2, Users, Clock, CalendarDays, Dumbbell,
  TrendingUp, ChevronDown, ChevronRight, Layers, Filter, RefreshCw, Play, UserRound, Bell, Info, X,
} from 'lucide-react'
import { Card, Avatar, Btn, Badge, SectionTitle } from '../components/UI'
import { runUsageClustering, DOW_LABELS, HOUR_BUCKETS, AGE_BUCKETS } from '../utils/clustering'
import { retosList, getRoundIdentity } from '../utils/configApi'
import { useAuth } from '../contexts/AuthContext'

// Paleta cíclica para los clusters
const CLUSTER_COLORS = [
  'var(--green)',
  '#5B9CF6',
  '#A78BFA',
  '#FBBF24',
  '#FB7185',
  '#FB923C',
]

function MiniBars({ data, color, height = 70 }) {
  const max = Math.max(1, ...data.map(d => d.value))
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height, padding: '4px 0' }}>
      {data.map((d, i) => {
        const h = (d.value / max) * (height - 20)
        return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, minWidth: 0 }}>
            <div style={{
              width: '100%', height: Math.max(2, h),
              background: color, borderRadius: 3, opacity: d.value > 0 ? 1 : 0.15,
            }} />
            <span style={{ fontSize: 9, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{d.label}</span>
          </div>
        )
      })}
    </div>
  )
}

function GenderBar({ genderCount }) {
  const total = genderCount.male + genderCount.female + genderCount.unknown
  if (total === 0) return null
  const malePct    = Math.round((genderCount.male    / total) * 100)
  const femalePct  = Math.round((genderCount.female  / total) * 100)
  const unknownPct = 100 - malePct - femalePct
  return (
    <div>
      <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>
        <UserRound size={10} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} aria-hidden="true" />
        Género
      </p>
      <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', height: 10, gap: 1 }}>
        {malePct    > 0 && <div style={{ flex: malePct,    background: '#5B9CF6', borderRadius: 3 }} title={`Hombre ${malePct}%`} />}
        {femalePct  > 0 && <div style={{ flex: femalePct,  background: '#FB7185', borderRadius: 3 }} title={`Mujer ${femalePct}%`} />}
        {unknownPct > 0 && <div style={{ flex: Math.max(unknownPct, 1), background: 'var(--bg-3)', border: '1px solid var(--line)', borderRadius: 3 }} title={`Sin dato ${unknownPct}%`} />}
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 5 }}>
        {malePct    > 0 && <span style={{ fontSize: 10, color: '#5B9CF6' }}>♂ {malePct}%</span>}
        {femalePct  > 0 && <span style={{ fontSize: 10, color: '#FB7185' }}>♀ {femalePct}%</span>}
        {unknownPct > 0 && <span style={{ fontSize: 10, color: 'var(--text-3)' }}>? {unknownPct}%</span>}
      </div>
    </div>
  )
}

function ClusterInfoModal({ cluster, color, onClose }) {
  // Top día y franja horaria del cluster
  const dowMax = cluster.dowTotal.indexOf(Math.max(...cluster.dowTotal))
  const hourMax = cluster.hourTotal.indexOf(Math.max(...cluster.hourTotal))
  const ageMax = cluster.ageTotal ? cluster.ageTotal.indexOf(Math.max(...cluster.ageTotal)) : -1
  const totalGen = (cluster.genderCount?.male || 0) + (cluster.genderCount?.female || 0)
  const pctMale = totalGen ? Math.round(100 * (cluster.genderCount?.male || 0) / totalGen) : 0
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 9999, padding: 20,
    }}>
      <Card onClick={(e) => e.stopPropagation()}
            style={{ padding: 0, maxWidth: 560, width: '100%', maxHeight: '88vh', overflowY: 'auto' }}>
        <div style={{ padding: 20, borderBottom: '1px solid var(--line)',
                       display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h3 style={{ margin: 0, fontFamily: 'Outfit', fontSize: 17, fontWeight: 700 }}>
              Cluster {cluster.id + 1}: {cluster.name}
            </h3>
            <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
              {cluster.size} clientes con un patrón de uso similar
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)' }}>
            <X size={14} />
          </button>
        </div>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Section title="¿Qué tienen en común?" icon="🎯">
            <ul style={ulStyle}>
              <li><strong>Día dominante:</strong> {DOW_LABELS[dowMax]}{' '}
                ({Math.round(100 * cluster.dowTotal[dowMax] / cluster.totalSessions)}% de sus sesiones)</li>
              <li><strong>Franja horaria favorita:</strong> {HOUR_BUCKETS[hourMax].label}h{' '}
                ({Math.round(100 * cluster.hourTotal[hourMax] / cluster.totalSessions)}%)</li>
              {ageMax >= 0 && (
                <li><strong>Edad predominante:</strong> {AGE_BUCKETS[ageMax].label} años</li>
              )}
              {totalGen > 0 && (
                <li><strong>Género:</strong> {pctMale}% hombres / {100 - pctMale}% mujeres</li>
              )}
              {cluster.topTypes?.length > 0 && (
                <li><strong>Actividades top:</strong>{' '}
                  {cluster.topTypes.slice(0, 3).map(t => t.name || t).join(', ')}</li>
              )}
              <li><strong>Frecuencia media:</strong> {cluster.avgSessionsPerWeek.toFixed(1)} sesiones / semana</li>
              <li><strong>Total sesiones del grupo:</strong> {cluster.totalSessions}</li>
            </ul>
          </Section>

          <Section title="¿Cómo se creó?" icon="🧠">
            <p style={pStyle}>
              Hemos extraído de cada cliente un <strong>vector de ~36 características</strong>:
            </p>
            <ul style={ulStyle}>
              <li>Distribución por día de semana (7 dim)</li>
              <li>Distribución por franja horaria (6 dim)</li>
              <li>Frecuencia semanal (1 dim)</li>
              <li>Distribución por actividad sobre vocabulario top-12 (12 dim)</li>
              <li>Género one-hot (2 dim)</li>
              <li>Franja de edad one-hot (5 dim)</li>
              <li><strong>Retos NoofitPro (3 dim)</strong>: nº de retos participa, podios (top 3), valor acumulado normalizado</li>
            </ul>
            <p style={pStyle}>
              Después aplicamos <strong>K-means++</strong> con distancia euclídea sobre todos
              los vectores. Los clientes que han caído en este cluster comparten un perfil
              de uso suficientemente parecido al centroide.
            </p>
            <p style={{ ...pStyle, fontStyle: 'italic', color: 'var(--text-3)' }}>
              El nombre &ldquo;{cluster.name}&rdquo; se asigna automáticamente con una heurística
              que mira los rasgos dominantes (día/hora/edad/actividad) y elige una etiqueta
              corta humana.
            </p>
          </Section>

          <Section title="¿Para qué sirve?" icon="💡">
            <ul style={ulStyle}>
              <li>Segmentar campañas: notificación, oferta o recordatorio dirigido a este perfil</li>
              <li>Detectar &ldquo;huecos&rdquo;: si este cluster es grande y casi no hay clases en su
                franja, hay oportunidad de añadirlas</li>
              <li>Optimizar plantilla de monitores y horarios según los grupos reales</li>
              <li>Identificar cohortes de riesgo y crear acciones de retención específicas</li>
            </ul>
          </Section>
        </div>
        <div style={{ padding: 14, borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'flex-end' }}>
          <Btn variant="secondary" onClick={onClose}>Cerrar</Btn>
        </div>
      </Card>
    </div>
  )
}

function Section({ title, icon, children }) {
  return (
    <div style={{ padding: 14, background: 'var(--bg-1)', borderRadius: 10, border: '1px solid var(--line)' }}>
      <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-0)', marginBottom: 8 }}>
        <span style={{ marginRight: 6 }}>{icon}</span>{title}
      </p>
      {children}
    </div>
  )
}
const pStyle = { fontSize: 12, color: 'var(--text-2)', lineHeight: 1.55, marginBottom: 8 }
const ulStyle = { fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6, paddingLeft: 18, margin: 0 }


function ClusterCard({ cluster, color, onClientClick, onNotify }) {
  const [infoOpen, setInfoOpen] = useState(false)
  const [open, setOpen] = useState(false)
  const dowData  = DOW_LABELS.map((l, i) => ({ label: l, value: cluster.dowTotal[i] }))
  const hourData = HOUR_BUCKETS.map((b, i) => ({ label: b.label, value: cluster.hourTotal[i] }))
  const ageData  = AGE_BUCKETS.map((b, i) => ({ label: b.label, value: cluster.ageTotal?.[i] ?? 0 }))

  return (
    <Card style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16, borderLeft: `4px solid ${color}` }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: `color-mix(in srgb, ${color} 15%, transparent)`,
            color, fontFamily: 'Outfit', fontSize: 18, fontWeight: 700,
          }}>
            {cluster.id + 1}
          </div>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ fontFamily: 'Outfit', fontSize: 17, fontWeight: 700, color: 'var(--text-0)' }}>
              {cluster.name}
            </h3>
            <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
              {cluster.size} clientes · {cluster.avgSessionsPerWeek.toFixed(1)} sesiones/sem · {cluster.totalSessions} totales
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Badge color="gray"><Users size={10} aria-hidden="true" /> {cluster.size}</Badge>
          <button onClick={() => setInfoOpen(true)} title="¿Cómo se creó este cluster?"
                  aria-label="Información del cluster"
                  style={{
                    display: 'inline-flex', alignItems: 'center',
                    padding: '6px 8px', borderRadius: 8,
                    cursor: 'pointer', border: '1px solid var(--line)',
                    background: 'var(--bg-2)', color: 'var(--text-2)',
                  }}>
            <Info size={11} aria-hidden="true" />
          </button>
          <button
            onClick={() => onNotify?.(cluster)}
            title="Enviar notificación a este cluster"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '6px 10px', borderRadius: 8, fontSize: 11, fontWeight: 600,
              cursor: 'pointer', border: '1px solid var(--green-border)',
              background: 'var(--green-bg)', color: 'var(--green)',
            }}>
            <Bell size={11} aria-hidden="true" /> Notificar
          </button>
        </div>
      </div>

      {infoOpen && <ClusterInfoModal cluster={cluster} color={color} onClose={() => setInfoOpen(false)} />}

      {/* Distribuciones */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>
            <CalendarDays size={10} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} aria-hidden="true" />
            Día de semana
          </p>
          <MiniBars data={dowData} color={color} />
        </div>
        <div>
          <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>
            <Clock size={10} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} aria-hidden="true" />
            Franja horaria
          </p>
          <MiniBars data={hourData} color={color} />
        </div>
      </div>

      {/* Género + Edad */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {cluster.genderCount && <GenderBar genderCount={cluster.genderCount} />}
        <div>
          <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>
            <CalendarDays size={10} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} aria-hidden="true" />
            Franja de edad
          </p>
          <MiniBars data={ageData} color={color} height={60} />
        </div>
      </div>

      {/* Tipos top */}
      {cluster.topTypes.length > 0 && (
        <div>
          <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>
            <Dumbbell size={10} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} aria-hidden="true" />
            Entrenamientos favoritos
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {cluster.topTypes.map(t => (
              <span key={t.name} style={{
                fontSize: 11, padding: '4px 10px', borderRadius: 8,
                background: 'var(--bg-3)', color: 'var(--text-1)', border: '1px solid var(--line)',
              }}>
                {t.name} <strong style={{ color }}>{t.pct}%</strong>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Miembros (desplegable) */}
      <button onClick={() => setOpen(o => !o)} style={{
        display: 'flex', alignItems: 'center', gap: 6,
        fontSize: 12, fontWeight: 500, color: 'var(--text-2)',
        background: 'none', border: 'none', cursor: 'pointer', padding: 0,
      }}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {open ? 'Ocultar' : 'Ver'} {cluster.size} clientes
      </button>

      {open && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          gap: 6, maxHeight: 360, overflowY: 'auto', paddingRight: 4,
        }}>
          {cluster.members.map(m => (
            <button key={m.idClient}
                    onClick={() => onClientClick(m.idClient)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 10px', borderRadius: 10,
                      background: 'var(--bg-3)', border: '1px solid var(--line)',
                      cursor: 'pointer', textAlign: 'left', width: '100%',
                    }}>
              <Avatar nombre={m.nombre} size={28} imgUrl={m.imgUrl} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {m.nombre}
                </p>
                <p style={{ fontSize: 10, color: 'var(--text-3)' }}>
                  {m.features.total} sesiones · {m.features.sessionsPerWeek.toFixed(1)}/sem
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </Card>
  )
}

export default function AnalisisClusters() {
  const navigate = useNavigate()
  const [dias, setDias] = useState(90)
  const [k, setK] = useState('auto')
  const [minSessions, setMinSessions] = useState(4)
  const [soloActivos, setSoloActivos] = useState(true)
  const [resultado, setResultado] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [hasRun, setHasRun] = useState(false)

  const { user } = useAuth()
  const identity = useMemo(() => getRoundIdentity(user), [user])

  const runAnalysis = () => {
    setHasRun(true)
    setLoading(true)
    setError('')
    let active = true
    // Cargar retos en paralelo: incluir como señales en el clustering
    Promise.resolve()
      .then(() => identity?.managerId ? retosList(identity).catch(() => []) : [])
      .then(retos => {
        // Mapa idClient → {nRetos, ranking1to3, valor}
        const retosByClient = {}
        for (const r of (retos || [])) {
          const rankByCli = {}
          for (const rk of (r.rankingIndividual || [])) {
            const id = String(rk?.idClient || rk?.clienteId || '')
            if (id) rankByCli[id] = rk.rankingIndividual
          }
          for (const p of (r.participantes || [])) {
            const id = String(p?.idClient || p?.clienteId || '')
            if (!id) continue
            if (!retosByClient[id]) retosByClient[id] = { nRetos: 0, ranking1to3: 0, valor: 0 }
            retosByClient[id].nRetos += 1
            retosByClient[id].valor  += (rankByCli[id] ? (r.rankingIndividual.find(x => String(x.idClient || x.clienteId) === id)?.valorAcumulado || 0) : 0) || p.valorAcumulado || 0
            const rk = rankByCli[id]
            if (rk != null && rk <= 3) retosByClient[id].ranking1to3 += 1
          }
        }
        return runUsageClustering({
          dias,
          k: k === 'auto' ? 'auto' : Number(k),
          minSessions,
          soloActivos,
          retosByClient,
        })
      })
      .then(res => { if (active) setResultado(res) })
      .catch(err => { if (active) setError(err.message || 'Error analizando patrones') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }

  const kpi = useMemo(() => {
    if (!resultado) return null
    const totalSesiones = resultado.clusters.reduce((s, c) => s + c.totalSessions, 0)
    return {
      clientes: resultado.clientesAnalizados,
      excluidos: resultado.clientesExcluidos,
      grupos: resultado.clusters.length,
      sesiones: totalSesiones,
    }
  }, [resultado])

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 16, marginBottom: 28 }}>
        <div>
          <h1 style={{ fontFamily: 'Outfit', fontSize: 28, fontWeight: 700, color: 'var(--text-0)' }}>
            Análisis de patrones de uso
          </h1>
          <p style={{ fontSize: 14, color: 'var(--text-3)', marginTop: 4 }}>
            Agrupa clientes con tendencias similares de horario, día y tipo de entrenamiento
          </p>
        </div>
        {hasRun && (
          <Btn variant="secondary" size="md" onClick={runAnalysis} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} aria-hidden="true" /> Recalcular
          </Btn>
        )}
      </div>

      {/* Controles */}
      <Card style={{ padding: 20, marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <Filter size={14} style={{ color: 'var(--text-3)' }} aria-hidden="true" />
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
            Parámetros del análisis
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-3)', display: 'block', marginBottom: 6 }}>Ventana (días)</label>
            <select value={dias} onChange={e => setDias(Number(e.target.value))} className="form-input"
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 10, fontSize: 13, background: 'var(--bg-1)', border: '1px solid var(--line)', color: 'var(--text-0)' }}>
              <option value={30}>Últimos 30 días</option>
              <option value={60}>Últimos 60 días</option>
              <option value={90}>Últimos 90 días</option>
              <option value={180}>Últimos 180 días</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-3)', display: 'block', marginBottom: 6 }}>Número de grupos</label>
            <select value={k} onChange={e => setK(e.target.value)} className="form-input"
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 10, fontSize: 13, background: 'var(--bg-1)', border: '1px solid var(--line)', color: 'var(--text-0)' }}>
              <option value="auto">Automático (3-6)</option>
              <option value="3">3 grupos</option>
              <option value="4">4 grupos</option>
              <option value="5">5 grupos</option>
              <option value="6">6 grupos</option>
              <option value="8">8 grupos</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-3)', display: 'block', marginBottom: 6 }}>Sesiones mínimas</label>
            <select value={minSessions} onChange={e => setMinSessions(Number(e.target.value))} className="form-input"
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 10, fontSize: 13, background: 'var(--bg-1)', border: '1px solid var(--line)', color: 'var(--text-0)' }}>
              <option value={1}>≥ 1 sesión</option>
              <option value={3}>≥ 3 sesiones</option>
              <option value={4}>≥ 4 sesiones</option>
              <option value={6}>≥ 6 sesiones</option>
              <option value={10}>≥ 10 sesiones</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-3)', display: 'block', marginBottom: 6 }}>Filtro</label>
            <label style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
              borderRadius: 10, background: 'var(--bg-1)', border: '1px solid var(--line)', cursor: 'pointer', fontSize: 13,
            }}>
              <input type="checkbox" checked={soloActivos} onChange={e => setSoloActivos(e.target.checked)} />
              <span style={{ color: 'var(--text-1)' }}>Solo clientes activos</span>
            </label>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <Btn variant="primary" size="md" onClick={runAnalysis} disabled={loading}>
            <Play size={15} aria-hidden="true" /> {hasRun ? 'Volver a analizar' : 'Analizar'}
          </Btn>
        </div>
      </Card>

      {/* Placeholder inicial: nada se carga hasta que el usuario pulsa Analizar */}
      {!hasRun && !loading && (
        <Card style={{ padding: 60, textAlign: 'center' }}>
          <Layers size={28} style={{ color: 'var(--text-3)', margin: '0 auto 12px' }} aria-hidden="true" />
          <p style={{ fontSize: 14, color: 'var(--text-1)' }}>
            Ajusta los parámetros y pulsa <strong style={{ color: 'var(--green)' }}>Analizar</strong> para calcular los patrones.
          </p>
          <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8 }}>
            El análisis no se ejecuta automáticamente al entrar.
          </p>
        </Card>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '80px 0', gap: 12 }}>
          <Loader2 size={24} className="animate-spin" style={{ color: 'var(--green)' }} aria-hidden="true" />
          <p style={{ fontSize: 13, color: 'var(--text-3)' }}>Analizando patrones de uso...</p>
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <Card style={{ padding: 40, textAlign: 'center' }}>
          <p role="alert" style={{ fontSize: 14, color: 'var(--red)' }}>{error}</p>
        </Card>
      )}

      {/* Resultados */}
      {!loading && resultado && (
        <>
          {/* KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
            <Card style={{ padding: 18 }}>
              <p style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                Clientes analizados
              </p>
              <p style={{ fontFamily: 'Outfit', fontSize: 26, fontWeight: 700, color: 'var(--green)', marginTop: 4 }}>{kpi.clientes}</p>
              <p style={{ fontSize: 11, color: 'var(--text-3)' }}>{kpi.excluidos} excluidos (bajo uso)</p>
            </Card>
            <Card style={{ padding: 18 }}>
              <p style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                Grupos detectados
              </p>
              <p style={{ fontFamily: 'Outfit', fontSize: 26, fontWeight: 700, color: 'var(--text-0)', marginTop: 4 }}>{kpi.grupos}</p>
              <p style={{ fontSize: 11, color: 'var(--text-3)' }}>
                k = {resultado.params.k}{k === 'auto' ? ' (auto)' : ''}
              </p>
            </Card>
            <Card style={{ padding: 18 }}>
              <p style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                Sesiones totales
              </p>
              <p style={{ fontFamily: 'Outfit', fontSize: 26, fontWeight: 700, color: 'var(--text-0)', marginTop: 4 }}>{kpi.sesiones}</p>
              <p style={{ fontSize: 11, color: 'var(--text-3)' }}>en {resultado.params.dias} días</p>
            </Card>
            <Card style={{ padding: 18 }}>
              <p style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                Grupo más grande
              </p>
              <p style={{ fontFamily: 'Outfit', fontSize: 26, fontWeight: 700, color: 'var(--text-0)', marginTop: 4 }}>
                {resultado.clusters[0]?.size ?? 0}
              </p>
              <p style={{ fontSize: 11, color: 'var(--text-3)' }}>
                {kpi.clientes > 0 ? Math.round(((resultado.clusters[0]?.size ?? 0) / kpi.clientes) * 100) : 0}% del total
              </p>
            </Card>
          </div>

          {/* Sin datos */}
          {resultado.clusters.length === 0 ? (
            <Card style={{ padding: 60, textAlign: 'center' }}>
              <Layers size={28} style={{ color: 'var(--text-3)', margin: '0 auto 12px' }} aria-hidden="true" />
              <p style={{ fontSize: 14, color: 'var(--text-3)' }}>
                No hay suficientes datos para clusterizar con estos parámetros.
              </p>
              <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8 }}>
                Prueba a reducir el mínimo de sesiones o ampliar la ventana.
              </p>
            </Card>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(520px, 100%), 1fr))', gap: 16 }}>
              {resultado.clusters.map((c, i) => (
                <ClusterCard key={c.id}
                             cluster={c}
                             color={CLUSTER_COLORS[i % CLUSTER_COLORS.length]}
                             onClientClick={id => navigate(`/clientes/${id}`)}
                             onNotify={cluster => navigate('/notificaciones', { state: {
                               seccion: 'centro',
                               presetTitle: `Cluster: ${cluster.name}`,
                               audience: {
                                 tipo: 'cluster',
                                 cluster_id: cluster.id,
                                 clientes: cluster.members.map(m => m.idClient),
                               },
                             }})} />
              ))}
            </div>
          )}

          {/* Excluidos */}
          {resultado.outliers.length > 0 && (
            <Card style={{ padding: 20, marginTop: 20 }}>
              <SectionTitle>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <TrendingUp size={16} aria-hidden="true" /> Clientes de bajo uso ({resultado.outliers.length})
                </span>
              </SectionTitle>
              <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 12 }}>
                Menos de {minSessions} sesiones en {dias} días — no se clusterizan por falta de patrón estable.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 6, maxHeight: 280, overflowY: 'auto' }}>
                {resultado.outliers.map(m => (
                  <button key={m.idClient}
                          onClick={() => navigate(`/clientes/${m.idClient}`)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: '6px 10px', borderRadius: 10,
                            background: 'var(--bg-3)', border: '1px solid var(--line)',
                            cursor: 'pointer', textAlign: 'left', width: '100%',
                          }}>
                    <Avatar nombre={m.nombre} size={26} imgUrl={m.imgUrl} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {m.nombre}
                      </p>
                      <p style={{ fontSize: 10, color: 'var(--text-3)' }}>{m.features.total} sesiones</p>
                    </div>
                  </button>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
