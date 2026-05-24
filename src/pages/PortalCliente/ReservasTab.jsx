import { useState, useEffect } from 'react'
import { Calendar, ChevronLeft, ChevronRight, MapPin, Users, Sparkles } from 'lucide-react'


// Esqueleto del tab "Reservas". Datos reales pendientes de cablear:
//   GET salas      → POST api/dispositivos/getSalasByManager(desde, hasta)
//   POST reservar  → POST api/dispositivos/userJoinSala
//   POST cancelar  → POST api/dispositivos/userRemoveSala
//   Plazas         → POST api/dispositivos/getPosicionesSala
// Mientras tanto, todo es mock con loading skeleton.

export default function ReservasTab() {
  const [loading, setLoading] = useState(true)
  const [day, setDay] = useState(() => new Date())

  // Simula carga (loaders skeleton durante 700ms) cada vez que cambia el día.
  useEffect(() => {
    setLoading(true)
    const t = setTimeout(() => setLoading(false), 700)
    return () => clearTimeout(t)
  }, [day])

  function shiftDay(delta) {
    const d = new Date(day); d.setDate(d.getDate() + delta); setDay(d)
  }

  const dayLabel = day.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })
  const isToday = sameDay(day, new Date())

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 8 }}>
      {/* ── Selector de día ───────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 14px', borderRadius: 14,
        background: 'var(--bg-1)', border: '1px solid var(--line)',
      }}>
        <button onClick={() => shiftDay(-1)} aria-label="día anterior" style={iconBtn}>
          <ChevronLeft size={18} />
        </button>
        <div style={{ textAlign: 'center', flex: 1 }}>
          <p style={{
            margin: 0, fontSize: 11, color: 'var(--text-3)',
            textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600,
          }}>
            {isToday ? 'Hoy' : ''}
          </p>
          <p style={{ margin: '2px 0 0', fontSize: 15, fontWeight: 600, textTransform: 'capitalize' }}>
            {dayLabel}
          </p>
        </div>
        <button onClick={() => shiftDay(+1)} aria-label="día siguiente" style={iconBtn}>
          <ChevronRight size={18} />
        </button>
      </div>

      {/* ── Mis reservas (próximas) ──────────────────────────────────── */}
      <Section title="Mis reservas">
        {loading ? <SkeletonClase /> :
          <EmptyMini icon={Calendar}
            title="No tienes reservas en este día"
            sub="Apúntate desde la lista de clases disponibles." />}
      </Section>

      {/* ── Clases disponibles ───────────────────────────────────────── */}
      <Section title="Clases disponibles">
        {loading ? (
          <>
            <SkeletonClase />
            <SkeletonClase />
            <SkeletonClase />
          </>
        ) : (
          <EmptyMini icon={Sparkles}
            title="Próximamente"
            sub="Aquí verás las clases del centro y podrás apuntarte con un toque." />
        )}
      </Section>
    </div>
  )
}


// ═══════════════════════════════════════════════════════════════════════════
// Auxiliares
// ═══════════════════════════════════════════════════════════════════════════

function Section({ title, children }) {
  return (
    <div>
      <h3 style={{
        margin: '4px 4px 8px', fontFamily: 'var(--font-display, Outfit)',
        fontSize: 13, color: 'var(--text-3)',
        textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700,
      }}>
        {title}
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {children}
      </div>
    </div>
  )
}


function SkeletonClase() {
  return (
    <div style={{
      padding: '14px', borderRadius: 14,
      background: 'var(--bg-1)', border: '1px solid var(--line)',
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div className="sk-pulse" style={{ width: 56, height: 56, borderRadius: 12 }} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="sk-pulse" style={{ width: '60%', height: 12, borderRadius: 6 }} />
        <div className="sk-pulse" style={{ width: '40%', height: 10, borderRadius: 5 }} />
      </div>
      <div className="sk-pulse" style={{ width: 64, height: 28, borderRadius: 999 }} />

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


function EmptyMini({ icon: Icon, title, sub }) {
  return (
    <div style={{
      padding: '24px 16px', borderRadius: 14,
      background: 'var(--bg-1)', border: '1px dashed var(--line)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
      textAlign: 'center',
    }}>
      <Icon size={26} style={{ color: 'var(--text-3)' }} />
      <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text-1)' }}>
        {title}
      </p>
      {sub && (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-3)', maxWidth: 280 }}>
          {sub}
        </p>
      )}
    </div>
  )
}


function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth()    === b.getMonth() &&
         a.getDate()     === b.getDate()
}


const iconBtn = {
  width: 36, height: 36, borderRadius: 10,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'var(--bg-2)', border: '1px solid var(--line)',
  color: 'var(--text-2)', cursor: 'pointer',
}
