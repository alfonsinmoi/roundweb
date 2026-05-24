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
        <EmptyList sub={sub} q={q} />
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


// Datos demo (basados en las capturas que pasaste de mynoofit).
// Hasta cablear getTrainingsUserMobile / getTrainingsUser.
const DEMOS_INDIVIDUAL = [
  { id: 'demo-i-1', titulo: 'Ciclo Etapa 10 minutos',              duracion: '01m 14s', distancia: '0 m',    mediaFc: '77 ppm', calorias: '0 Kcal',  fecha: '25 mar 2026' },
  { id: 'demo-i-2', titulo: 'Montaña Intervalica Discontinua Video', duracion: '29s',     distancia: '0 m',    mediaFc: '73 ppm', calorias: '0 Kcal',  fecha: '24 mar 2026' },
  { id: 'demo-i-3', titulo: 'Ciclo Etapa HIIT 12 minutos',          duracion: '36s',     distancia: '0 m',    mediaFc: '69 ppm', calorias: '0 Kcal',  fecha: '23 mar 2026' },
  { id: 'demo-i-4', titulo: 'Fuerza tren superior',                 duracion: '14m 02s', distancia: '0 m',    mediaFc: '92 ppm', calorias: '4 Kcal',  fecha: '20 mar 2026' },
  { id: 'demo-i-5', titulo: 'Resistencia liviana',                  duracion: '22m 18s', distancia: '0 m',    mediaFc: '105 ppm', calorias: '12 Kcal', fecha: '18 mar 2026' },
  { id: 'demo-i-6', titulo: 'Circuito adelgazamiento PAPE',         duracion: '08m 41s', distancia: '0 m',    mediaFc: '88 ppm', calorias: '6 Kcal',  fecha: '15 mar 2026' },
]
const DEMOS_GRUPO = [
  { id: 'demo-g-1', titulo: 'Ciclo NooFit Etapa 4',  duracion: '11m 31s', distancia: '1118 m', mediaFc: '131 ppm', calorias: '76 Kcal', fecha: '15 abr 2026' },
  { id: 'demo-g-2', titulo: 'Ciclo NooFit Etapa 2',  duracion: '05m 03s', distancia: '924 m',  mediaFc: '88 ppm',  calorias: '0 Kcal',  fecha: '25 mar 2026' },
  { id: 'demo-g-3', titulo: 'Ciclo NooFit Etapa 1',  duracion: '02m 52s', distancia: '342 m',  mediaFc: '78 ppm',  calorias: '0 Kcal',  fecha: '20 mar 2026' },
  { id: 'demo-g-4', titulo: 'HIIT Grupo Avanzado',   duracion: '32m 14s', distancia: '2487 m', mediaFc: '152 ppm', calorias: '184 Kcal', fecha: '12 mar 2026' },
  { id: 'demo-g-5', titulo: 'Spinning Tempo',        duracion: '45m 00s', distancia: '12450 m', mediaFc: '141 ppm', calorias: '320 Kcal', fecha: '08 mar 2026' },
]


function EmptyList({ sub, q }) {
  const navigate = useNavigate()
  const list = sub === 'grupo' ? DEMOS_GRUPO : DEMOS_INDIVIDUAL
  const needle = q.trim().toLowerCase()
  const filtered = needle
    ? list.filter(d => d.titulo.toLowerCase().includes(needle))
    : list

  if (filtered.length === 0) {
    return (
      <div style={{
        padding: '20px 16px', borderRadius: 14,
        background: 'var(--bg-1)', border: '1px dashed var(--line)',
        textAlign: 'center', color: 'var(--text-3)', fontSize: 13,
      }}>
        Sin resultados para “{q}”.
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {filtered.map(d => (
        <EntrenamientoCard key={d.id} {...d} esGrupo={sub === 'grupo'}
          onClick={() => navigate(`/portal/entrenamientos/${d.id}`)} />
      ))}
      <div style={{
        padding: '12px 16px', borderRadius: 12,
        background: 'var(--bg-1)', border: '1px dashed var(--line)',
        textAlign: 'center', color: 'var(--text-3)', fontSize: 11,
      }}>
        Datos demo · cableado real (NoofitPro) pendiente
      </div>
    </div>
  )
}
