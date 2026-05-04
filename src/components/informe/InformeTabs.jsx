import { useNavigate } from 'react-router-dom'

/**
 * Tabs compartidos de Informe de Asistencia.
 * Cada tab navega a /informe-asistencia/:tab?. Si está activo se pinta la barra
 * verde inferior (2px) tipo "underline" y el label en font-display 14/700.
 *
 * Props:
 *   active   — id de tab activo: 'faltas' | 'control' | 'distribucion' | 'revisar'
 *   counts   — objeto opcional con conteos derivados de datos reales:
 *              { faltas, control, distribucion, revisar }
 */
export default function InformeTabs({ active, counts = {} }) {
  const navigate = useNavigate()

  const tabs = [
    { id: 'faltas',       label: 'Faltas',       hint: countLabel('faltas',       counts.faltas) },
    { id: 'control',      label: 'Control',      hint: countLabel('control',      counts.control) },
    { id: 'distribucion', label: 'Distribución', hint: countLabel('distribucion', counts.distribucion) },
    { id: 'revisar',      label: 'Para revisar', hint: countLabel('revisar',      counts.revisar) },
    { id: 'riesgo',       label: 'En riesgo',    hint: countLabel('riesgo',       counts.riesgo) },
  ]

  return (
    <div role="tablist" aria-label="Sub-vistas del informe" style={{
      display: 'flex', gap: 0, marginBottom: 18,
      borderBottom: '1px solid var(--line)',
      overflowX: 'auto',
    }}>
      {tabs.map(t => {
        const isActive = active === t.id
        return (
          <button key={t.id}
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => navigate(`/informe-asistencia/${t.id}`)}
                  style={{
                    position: 'relative',
                    display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                    gap: 3, padding: '12px 20px 14px', flexShrink: 0,
                    background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
                  }}>
            <span style={{
              fontFamily: 'var(--font-display)', fontSize: 14,
              fontWeight: isActive ? 700 : 500,
              color: isActive ? 'var(--text-0)' : 'var(--text-2)',
              transition: 'color 0.15s',
            }}>
              {t.label}
            </span>
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 11,
              color: 'var(--text-3)', whiteSpace: 'nowrap',
            }}>
              {t.hint}
            </span>
            {isActive && (
              <span aria-hidden="true" style={{
                position: 'absolute', bottom: -1, left: 14, right: 14, height: 2,
                background: 'var(--green)', borderRadius: 999,
              }} />
            )}
          </button>
        )
      })}
    </div>
  )
}

// Etiqueta breve para cada tab — descriptiva si no hay conteo, numérica si lo hay
function countLabel(id, n) {
  switch (id) {
    case 'faltas':       return n != null ? `${n} en 7d`            : 'Faltas 7d'
    case 'control':      return n != null ? `${n} actividades`      : 'Por actividad'
    case 'distribucion': return n != null ? `${n} clases`           : 'Día × hora'
    case 'revisar':      return n != null ? `${n} alertas`          : 'Recomendaciones'
    case 'riesgo':       return n != null ? `${n} en riesgo`        : 'Score de fuga'
    default: return ''
  }
}
