import { useState, useEffect } from 'react'
import { Trophy, Flame, ListChecks, BarChart3, Sparkles, ChevronRight } from 'lucide-react'


// Esqueleto del tab "Retos". Datos reales pendientes:
//   Mis retos        → POST api/dispositivos/getMisRetos
//   Retos disponibles → POST api/dispositivos/getRetosByUser
//   Entrar / Salir    → POST api/dispositivos/postRetoParticipante
//   Ranking           → POST api/dispositivos/getRankingIndividual
// De momento, esqueletos con skeleton-pulse y empty states.

const SUBTABS = [
  { id: 'mios',         label: 'Mis retos',     icon: Flame },
  { id: 'disponibles',  label: 'Disponibles',   icon: ListChecks },
  { id: 'ranking',      label: 'Ranking',       icon: BarChart3 },
]


export default function RetosTab() {
  const [sub, setSub] = useState('mios')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const t = setTimeout(() => setLoading(false), 700)
    return () => clearTimeout(t)
  }, [sub])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 8 }}>

      {/* ── Sub-tabs ───────────────────────────────────────────────────── */}
      <div role="tablist" style={{
        display: 'flex', gap: 6, padding: 4,
        background: 'var(--bg-1)', border: '1px solid var(--line)',
        borderRadius: 12,
      }}>
        {SUBTABS.map(t => {
          const active = sub === t.id
          const Icon = t.icon
          return (
            <button key={t.id}
                    role="tab" aria-selected={active}
                    onClick={() => setSub(t.id)}
                    style={{
                      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      gap: 6, padding: '8px 6px',
                      borderRadius: 8, border: 'none',
                      background: active ? 'var(--green-bg, rgba(16,185,129,0.10))' : 'transparent',
                      color: active ? 'var(--green, #10b981)' : 'var(--text-2)',
                      fontSize: 12, fontWeight: active ? 700 : 500,
                      cursor: 'pointer',
                    }}>
              <Icon size={14} />
              {t.label}
            </button>
          )
        })}
      </div>

      {/* ── Contenido ─────────────────────────────────────────────────── */}
      {sub === 'mios'        && <MisRetos        loading={loading} />}
      {sub === 'disponibles' && <RetosDisponibles loading={loading} />}
      {sub === 'ranking'     && <Ranking         loading={loading} />}
    </div>
  )
}


// ═══════════════════════════════════════════════════════════════════════════
// Sub-vistas
// ═══════════════════════════════════════════════════════════════════════════

function MisRetos({ loading }) {
  if (loading) return <SkeletonList />
  return (
    <EmptyMini icon={Trophy}
      title="Aún no participas en ningún reto"
      sub="Mira la pestaña “Disponibles” para encontrar uno y apuntarte." />
  )
}


function RetosDisponibles({ loading }) {
  if (loading) return <SkeletonList />
  return (
    <EmptyMini icon={Sparkles}
      title="Próximamente"
      sub="Tu centro publicará retos aquí. Verás progreso, recompensas y ranking." />
  )
}


function Ranking({ loading }) {
  if (loading) return <SkeletonRanking />
  return (
    <EmptyMini icon={BarChart3}
      title="Sin ranking todavía"
      sub="Cuando empieces un reto, verás aquí tu posición y la del resto." />
  )
}


// ═══════════════════════════════════════════════════════════════════════════
// Helpers UI
// ═══════════════════════════════════════════════════════════════════════════

function SkeletonList() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          padding: 14, borderRadius: 14,
          background: 'var(--bg-1)', border: '1px solid var(--line)',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div className="sk-pulse" style={{ width: 48, height: 48, borderRadius: 12 }} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="sk-pulse" style={{ width: '70%', height: 12, borderRadius: 6 }} />
            <div className="sk-pulse" style={{ width: '40%', height: 10, borderRadius: 5 }} />
            <div className="sk-pulse" style={{ width: '85%', height: 6,  borderRadius: 3 }} />
          </div>
          <ChevronRight size={16} style={{ color: 'var(--text-3)' }} />
        </div>
      ))}
      <PulseStyle />
    </div>
  )
}


function SkeletonRanking() {
  return (
    <div style={{
      padding: 14, borderRadius: 14,
      background: 'var(--bg-1)', border: '1px solid var(--line)',
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      {[0, 1, 2, 3, 4].map(i => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="sk-pulse" style={{ width: 24, height: 24, borderRadius: '50%' }} />
          <div className="sk-pulse" style={{ width: 32, height: 32, borderRadius: '50%' }} />
          <div style={{ flex: 1 }}>
            <div className="sk-pulse" style={{ width: '60%', height: 10, borderRadius: 5 }} />
          </div>
          <div className="sk-pulse" style={{ width: 40, height: 14, borderRadius: 6 }} />
        </div>
      ))}
      <PulseStyle />
    </div>
  )
}


function PulseStyle() {
  return (
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
  )
}


function EmptyMini({ icon: Icon, title, sub }) {
  return (
    <div style={{
      padding: '28px 18px', borderRadius: 14,
      background: 'var(--bg-1)', border: '1px dashed var(--line)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
      textAlign: 'center',
    }}>
      <Icon size={28} style={{ color: 'var(--text-3)' }} />
      <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text-1)' }}>
        {title}
      </p>
      {sub && (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-3)', maxWidth: 300 }}>
          {sub}
        </p>
      )}
    </div>
  )
}
