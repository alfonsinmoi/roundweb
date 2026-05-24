import { Award, Sparkles } from 'lucide-react'


// Placeholder para tabs que aún no tienen UI propia. Hoy sólo Logros.
// Reservas y Retos ya tienen archivos propios con esqueletos:
//   - ReservasTab.jsx
//   - RetosTab.jsx
export function LogrosTab() { return <Placeholder icon={Award} title="Logros" /> }


function Placeholder({ icon: Icon, title }) {
  return (
    <div style={{
      paddingTop: 32, textAlign: 'center',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
    }}>
      <div style={{
        width: 72, height: 72, borderRadius: 24,
        background: 'var(--bg-2)', border: '1px solid var(--line)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon size={32} style={{ color: 'var(--text-3)' }} />
      </div>
      <div>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display, Outfit)', fontSize: 22, fontWeight: 700 }}>
          {title}
        </h2>
        <p style={{ margin: '6px 0 0', color: 'var(--text-3)', fontSize: 13, maxWidth: 280 }}>
          Pronto verás aquí tus {title.toLowerCase()} sincronizados con NoofitPro.
        </p>
      </div>
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '6px 14px', borderRadius: 999,
        background: 'rgba(59,130,246,0.10)', color: '#60a5fa',
        fontSize: 11, fontWeight: 600,
      }}>
        <Sparkles size={12} /> Próximamente
      </div>
    </div>
  )
}
