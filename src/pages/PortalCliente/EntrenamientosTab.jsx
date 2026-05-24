import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Filter, Search, Heart, Flame, Ruler, User, Users, ChevronRight } from 'lucide-react'


// Esqueleto del tab "Entrenamientos". Datos reales pendientes:
//   Mis entrenamientos individuales → POST api/dispositivos/getTrainingsUserMobile
//   Mis entrenamientos en grupo     → POST api/dispositivos/getTrainingsUser
//   Detalle por id                  → POST api/dispositivos/getEntrenamientoMobileUserFirst
//
// Mientras tanto: tab Yo solo / En grupo + skeleton de 3 cards.

const SUBTABS = [
  { id: 'individual', label: 'Yo solo',   icon: User },
  { id: 'grupo',      label: 'En grupo',  icon: Users },
]


export default function EntrenamientosTab() {
  const [sub, setSub] = useState('individual')
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')

  useEffect(() => {
    setLoading(true)
    const t = setTimeout(() => setLoading(false), 700)
    return () => clearTimeout(t)
  }, [sub])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 8 }}>
      <h1 style={{
        margin: 0, fontFamily: 'var(--font-display, Outfit)',
        fontSize: 24, fontWeight: 700, color: 'var(--text-0)',
      }}>
        Qué he hecho
      </h1>

      {/* ── Sub-tabs Yo solo / En grupo ──────────────────────────────── */}
      <div role="tablist" style={{
        display: 'flex', borderBottom: '1px solid var(--line)', gap: 0,
      }}>
        {SUBTABS.map(t => {
          const active = sub === t.id
          const Icon = t.icon
          return (
            <button key={t.id}
                    role="tab" aria-selected={active}
                    onClick={() => setSub(t.id)}
                    style={{
                      flex: 1, position: 'relative',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      gap: 6, padding: '12px 8px',
                      background: 'transparent', border: 'none', cursor: 'pointer',
                      color: active ? 'var(--text-0)' : 'var(--text-3)',
                      fontWeight: active ? 700 : 500, fontSize: 14,
                    }}>
              <Icon size={15} />
              {t.label}
              {active && <span style={{
                position: 'absolute', bottom: -1, left: 16, right: 16, height: 2,
                background: 'var(--text-0)', borderRadius: 999,
              }} />}
            </button>
          )
        })}
      </div>

      {/* ── Filtros + búsqueda ─────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button disabled
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '8px 10px',
                  background: 'transparent', border: 'none',
                  color: 'var(--text-3)', fontSize: 13, fontWeight: 500,
                  cursor: 'not-allowed', opacity: 0.7,
                }}>
          <Filter size={16} /> Filtros
        </button>
        <div style={{ flex: 1, position: 'relative' }}>
          <Search size={15} style={{
            position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
            color: 'var(--text-3)',
          }} />
          <input value={q} onChange={e => setQ(e.target.value)}
                 placeholder="Buscar"
                 style={{
                   width: '100%', padding: '8px 10px 8px 32px',
                   borderRadius: 10, border: '1px solid transparent',
                   background: 'transparent', color: 'var(--text-1)',
                   fontSize: 13, outline: 'none',
                 }} />
        </div>
      </div>

      {/* ── Lista ──────────────────────────────────────────────────────── */}
      {loading ? (
        <CardsList>
          <SkeletonCard /><SkeletonCard /><SkeletonCard />
        </CardsList>
      ) : (
        <EmptyList sub={sub} />
      )}
    </div>
  )
}


// ═══════════════════════════════════════════════════════════════════════════
// Componentes UI
// ═══════════════════════════════════════════════════════════════════════════

function CardsList({ children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {children}
    </div>
  )
}


// Card con el aspecto de las screenshots de mynoofit: imagen al fondo,
// título arriba, métricas en chips, fecha abajo a la derecha.
export function EntrenamientoCard({ id, titulo, duracion, distancia, mediaFc, calorias, fecha, esGrupo, onClick }) {
  return (
    <button onClick={onClick}
            style={{
              position: 'relative', width: '100%',
              borderRadius: 18, overflow: 'hidden',
              border: '1px solid var(--line)',
              background: 'var(--bg-2)',
              cursor: 'pointer', textAlign: 'left',
              padding: 0,
            }}>
      <div style={{
        position: 'relative',
        background: 'linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.75) 100%)',
        minHeight: 220,
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        padding: '14px 14px 12px',
      }}>
        {/* Header (avatar redonda placeholder + título) */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%',
            background: 'rgba(255,255,255,0.85)', flexShrink: 0,
          }} />
          <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
            <p style={{
              margin: 0, fontFamily: 'var(--font-display, Outfit)',
              fontSize: 18, fontWeight: 700, color: '#fff',
              textShadow: '0 1px 4px rgba(0,0,0,0.5)',
              lineHeight: 1.15,
            }}>
              {titulo || 'Entrenamiento'}
            </p>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'rgba(255,255,255,0.85)' }}>
              {duracion ? `Duración: ${duracion}` : ''}
            </p>
          </div>
          <div style={{ width: 28, flexShrink: 0, textAlign: 'right' }}>
            <span style={{ color: 'var(--green, #10b981)', fontSize: 16, fontWeight: 700 }}>?</span>
          </div>
        </div>

        {/* Chips métricas */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8,
          margin: '20px 0 4px',
        }}>
          <Chip label="Distancia"          value={distancia || '0 m'} />
          <Chip label="Media FC"           value={mediaFc   || '— ppm'} />
          <Chip label="Calorías consumidas" value={calorias || '0 Kcal'} />
        </div>

        {/* Footer fecha */}
        <div style={{
          display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6,
          marginTop: 8,
          color: '#fff', fontSize: 12,
        }}>
          {esGrupo ? <Users size={13} /> : <User size={13} />}
          <span>{fecha || ''}</span>
        </div>
      </div>
    </button>
  )
}


function Chip({ label, value }) {
  return (
    <div style={{
      padding: '8px 10px', borderRadius: 12,
      background: 'rgba(40,40,46,0.85)',
      backdropFilter: 'blur(2px)',
      textAlign: 'center',
    }}>
      <p style={{ margin: 0, fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>
        {label}
      </p>
      <p style={{ margin: '4px 0 0', fontSize: 13, fontWeight: 700, color: 'var(--green, #10b981)' }}>
        {value}
      </p>
    </div>
  )
}


function SkeletonCard() {
  return (
    <div style={{
      borderRadius: 18, border: '1px solid var(--line)', overflow: 'hidden',
      background: 'var(--bg-1)',
    }}>
      <div className="sk-pulse" style={{ height: 220 }} />
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


function EmptyList({ sub }) {
  const navigate = useNavigate()
  const msg = sub === 'grupo'
    ? 'Aún no tienes entrenamientos en grupo registrados. Las clases reservadas aparecerán aquí.'
    : 'Aún no tienes entrenamientos individuales registrados.'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Demo card para que el user pueda navegar al detalle aunque
          el endpoint no esté cableado todavía. */}
      <EntrenamientoCard
        id="demo-1"
        titulo={sub === 'grupo' ? 'Ciclo NooFit Etapa 4' : 'Ciclo Etapa 10 minutos'}
        duracion={sub === 'grupo' ? '11m 31s' : '01m 14s'}
        distancia={sub === 'grupo' ? '1118 m' : '0 m'}
        mediaFc={sub === 'grupo' ? '131 ppm' : '77 ppm'}
        calorias={sub === 'grupo' ? '76 Kcal' : '0 Kcal'}
        fecha={sub === 'grupo' ? '15 abr 2026' : '25 mar 2026'}
        esGrupo={sub === 'grupo'}
        onClick={() => navigate(`/portal/entrenamientos/demo-${sub}`)}
      />
      <div style={{
        padding: '20px 16px', borderRadius: 14,
        background: 'var(--bg-1)', border: '1px dashed var(--line)',
        textAlign: 'center', color: 'var(--text-3)', fontSize: 12,
      }}>
        {msg}
      </div>
    </div>
  )
}
