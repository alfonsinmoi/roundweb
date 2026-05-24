import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ChevronLeft, Watch, Shirt } from 'lucide-react'


// Detalle de un entrenamiento. Estructura inspirada en las screenshots de
// mynoofit: cabecera con título, bloque grande de métricas (2x3), iconos
// de sensor/reloj, gráficos (Intensidades / FC / Cadencia) y Ranking.
//
// Datos reales pendientes: POST api/dispositivos/getEntrenamientoMobileUserFirst.
// De momento usa placeholders cuando id empieza con "demo-".
export default function EntrenamientoDetalle() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const t = setTimeout(() => setLoading(false), 700)
    return () => clearTimeout(t)
  }, [id])

  const isGrupo = id?.includes('grupo')
  const titulo = isGrupo ? 'Ciclo NooFit Etapa 4' : 'Circuito adelgazamiento'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 4 }}>
      {/* ── Botón atrás ─────────────────────────────────────────────── */}
      <button onClick={() => navigate(-1)}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '6px 10px 6px 4px',
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: 'var(--text-1)', fontSize: 15, fontWeight: 500,
                alignSelf: 'flex-start',
              }}>
        <ChevronLeft size={20} /> Atrás
      </button>

      {/* ── Título ──────────────────────────────────────────────────── */}
      <h1 style={{
        margin: 0, fontFamily: 'var(--font-display, Outfit)',
        fontSize: 28, fontWeight: 800,
        color: 'var(--text-0)',
        textAlign: 'center',
        textTransform: 'uppercase', letterSpacing: '0.01em',
      }}>
        {loading ? <span className="sk-pulse" style={{ display: 'inline-block', width: 240, height: 30, borderRadius: 6 }} /> : titulo}
      </h1>

      {/* ── Bloque métricas grande ─────────────────────────────────── */}
      <Card>
        {loading ? (
          <SkeletonMetricGrid />
        ) : (
          <MetricGrid
            isGrupo={isGrupo}
            series={1}
            repeticiones={0}
            distancia={isGrupo ? '1118 m' : '0 m'}
            velocidadMedia={isGrupo ? '4,09 m/s' : '0,00 m/s'}
            potencia={isGrupo ? '96,32 KW' : '0,00 KW'}
            calorias={isGrupo ? '76 Kcal' : '1 Kcal'}
            fcMax={isGrupo ? '140 bpm' : '77 bpm'}
            fcMedia={isGrupo ? '131 bpm' : '75 bpm'}
          />
        )}
      </Card>

      {/* ── Iconos sensor / reloj ──────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 22 }}>
        <Shirt size={22} style={{ color: 'var(--text-2)' }} />
        <Watch size={22} style={{ color: 'var(--text-2)' }} />
      </div>

      {/* ── Gráficos ───────────────────────────────────────────────── */}
      <Card title="Intensidades" titleColor="var(--text-0)">
        <ChartPlaceholder loading={loading} kind="intensidades" />
      </Card>

      <Card title="Frecuencia cardíaca" titleColor="var(--red, #f87171)">
        <ChartPlaceholder loading={loading} kind="fc" />
      </Card>

      <Card title="Cadencia" titleColor="#f59e0b">
        <ChartPlaceholder loading={loading} kind="cadencia" />
      </Card>

      {/* ── Ranking (solo en grupo) ────────────────────────────────── */}
      {isGrupo && (
        <Card title="Ranking" titleColor="var(--text-0)">
          {loading ? (
            <SkeletonRanking />
          ) : (
            <RankingRow pos={1} nombre="Ali" pts={1268} />
          )}
        </Card>
      )}

      <style>{`
        .sk-pulse {
          background: linear-gradient(90deg,
            var(--bg-2) 0%, var(--bg-3) 50%, var(--bg-2) 100%);
          background-size: 200% 100%;
          animation: skpulse 1.4s ease-in-out infinite;
        }
        @keyframes skpulse {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  )
}


// ═══════════════════════════════════════════════════════════════════════════
// UI helpers
// ═══════════════════════════════════════════════════════════════════════════

function Card({ title, titleColor, children }) {
  return (
    <div style={{
      padding: '18px 16px', borderRadius: 18,
      background: 'var(--bg-1)', border: '1px solid var(--line)',
    }}>
      {title && (
        <p style={{
          margin: '0 0 14px', fontFamily: 'var(--font-display, Outfit)',
          fontSize: 18, fontWeight: 700,
          color: titleColor || 'var(--text-0)',
        }}>
          {title}
        </p>
      )}
      {children}
    </div>
  )
}


function MetricGrid({ series, repeticiones, distancia, velocidadMedia, potencia, calorias, fcMax, fcMedia }) {
  const Row = ({ left, right }) => (
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr 1px 1fr',
      gap: 0, padding: '14px 0',
      borderBottom: '1px solid var(--line)',
    }}>
      {left}
      <div style={{ background: 'var(--line)' }} />
      {right}
    </div>
  )
  const Metric = ({ value, label, color }) => (
    <div style={{ textAlign: 'center', padding: '0 12px' }}>
      <p style={{
        margin: 0, fontSize: 28, fontWeight: 700,
        color: color || 'var(--text-0)', fontFamily: 'var(--font-display, Outfit)',
      }}>
        {value}
      </p>
      <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-3)' }}>
        {label}
      </p>
    </div>
  )
  return (
    <div>
      <Row
        left={<Metric value={series} label="Series" />}
        right={<Metric value={repeticiones} label="Repeticiones" />}
      />
      <Row
        left={<Metric value={distancia} label="Distancia" color="#3b82f6" />}
        right={<Metric value={velocidadMedia} label="Velocidad Media" color="#3b82f6" />}
      />
      <Row
        left={<Metric value={potencia} label="Potencia" color="#f59e0b" />}
        right={<Metric value={calorias} label="Calorías consumidas" color="var(--red, #f87171)" />}
      />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1px 1fr', padding: '14px 0' }}>
        <Metric value={fcMax} label="Frecuencia cardíaca" color="var(--red, #f87171)" />
        <div style={{ background: 'var(--line)' }} />
        <Metric value={fcMedia} label="Media FC" color="var(--red, #f87171)" />
      </div>
    </div>
  )
}


function SkeletonMetricGrid() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {[0, 1, 2, 3].map(i => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div className="sk-pulse" style={{ height: 50, borderRadius: 10 }} />
          <div className="sk-pulse" style={{ height: 50, borderRadius: 10 }} />
        </div>
      ))}
    </div>
  )
}


function ChartPlaceholder({ loading, kind }) {
  if (loading) {
    return <div className="sk-pulse" style={{ height: 140, borderRadius: 12 }} />
  }
  // Mini placeholder: barras de muestra (intensidades) o curva ondulada (fc/cadencia)
  return (
    <div style={{
      height: 140, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-around',
      gap: 4, padding: '0 8px',
    }}>
      {Array.from({ length: 12 }).map((_, i) => {
        const h = kind === 'intensidades'
          ? 20 + (i % 4) * 18
          : kind === 'fc'
            ? 30 + Math.abs(Math.sin(i / 2)) * 90
            : 10 + Math.abs(Math.sin(i / 1.5)) * 100
        const color = kind === 'intensidades'
          ? (i % 2 ? '#3b82f6' : '#7c3aed')
          : kind === 'fc'
            ? 'rgba(248,113,133,0.55)'
            : 'rgba(245,158,11,0.55)'
        return (
          <div key={i} style={{
            flex: 1, height: h, borderRadius: 4,
            background: color,
          }} />
        )
      })}
    </div>
  )
}


function RankingRow({ pos, nombre, pts }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14,
      padding: '14px 16px', borderRadius: 14,
      background: 'var(--bg-2)',
    }}>
      <span style={{ width: 24, textAlign: 'center', fontWeight: 700, color: 'var(--text-1)' }}>
        {pos}
      </span>
      <div style={{
        width: 38, height: 38, borderRadius: '50%',
        background: 'var(--green, #10b981)',
      }} />
      <span style={{ flex: 1, fontSize: 15, fontWeight: 600 }}>{nombre}</span>
      <div style={{ textAlign: 'right' }}>
        <p style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#3b82f6' }}>{pts}</p>
        <p style={{ margin: 0, fontSize: 10, color: 'var(--text-3)' }}>pts</p>
      </div>
    </div>
  )
}


function SkeletonRanking() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {[0, 1, 2].map(i => (
        <div key={i} className="sk-pulse" style={{ height: 56, borderRadius: 12 }} />
      ))}
    </div>
  )
}
