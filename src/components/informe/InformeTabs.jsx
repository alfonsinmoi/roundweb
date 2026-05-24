import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Info } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { hasPermission } from '../../config/permissions'

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
  const { user } = useAuth()
  const [infoOpen, setInfoOpen] = useState(null)  // id del tab cuya info está abierta

  // Orden: Para revisar → Control asistencia → Faltas → Distribución espacios
  //         → En riesgo → Cluster
  const allTabs = [
    { id: 'revisar',      label: 'Para revisar',         hint: countLabel('revisar',      counts.revisar),
      info: 'Recomendaciones automáticas: clases con asistencia anómala, monitores con baja ocupación, actividades sin demanda. El sistema te sugiere qué optimizar.' },
    { id: 'control',      label: 'Control asistencia',   hint: countLabel('control',      counts.control),
      info: 'Asistencia detallada por actividad. Quién apareció a cada clase, cuándo, y permite gestionar manualmente el estado de cada usuario en cada sesión.' },
    { id: 'faltas',       label: 'Faltas',               hint: countLabel('faltas',       counts.faltas),
      info: 'Reincidentes que han faltado a clases en los últimos 7 días. Útil para detectar caída de hábito y contactar antes de que se den de baja.' },
    { id: 'distribucion', label: 'Distribución espacios', hint: countLabel('distribucion', counts.distribucion),
      info: 'Heatmap día × hora con la ocupación de las clases. Te dice en qué franjas hay más demanda y cuáles están infrautilizadas.' },
    { id: 'riesgo',       label: 'En riesgo',            hint: countLabel('riesgo',       counts.riesgo),
      info: 'Score predictivo de fuga: combina caída de asistencia, antigüedad, frecuencia y otros indicadores para decirte qué clientes están en riesgo de darse de baja.' },
    { id: 'patrones',     label: 'Cluster',              hint: 'Clusters de uso',
      info: 'Agrupa clientes con patrones de uso similares (días, horas, actividades, edad, género) usando K-means. Útil para campañas dirigidas y entender perfiles de tu centro.' },
    { id: 'retos',        label: 'Retos',                hint: countLabel('retos',        counts.retos),
      info: 'Retos activos en NoofitPro: ranking, participantes, equipos y % completado. Útil para ver el engagement y planear nuevos retos. Los datos provienen de getRetos del trainer.' },
    { id: 'estado_fisico', label: 'Estado físico',       hint: countLabel('estado_fisico', counts.estado_fisico),
      info: 'Dashboard de tests de estado físico (NoofitPro): uso mensual, tasa de repetición, evolución por cliente, ranking de puntuación, distribución demográfica.' },
  ]

  // Filtra tabs por permiso del perfil del usuario_web. Manager NoofitPro
  // (sin perfil, user.kind != 'usuario_web') ve todos.
  const isUsuarioWeb = user?.kind === 'usuario_web'
  const tabs = isUsuarioWeb
    ? allTabs.filter(t => hasPermission(user.perfil, `informe_asistencia.${t.id}`))
    : allTabs

  return (
    <div role="tablist" aria-label="Sub-vistas del informe" style={{
      display: 'flex', gap: 6, marginBottom: 18, padding: 6,
      background: 'var(--bg-2)', border: '1px solid var(--line)',
      borderRadius: 14,
      flexWrap: 'wrap',          // si no caben, salto de línea en vez de recortar
      // Sin overflowX para que el popover de info pueda salirse fuera del box
    }}>
      {tabs.map(t => {
        const isActive = active === t.id
        return (
          <div key={t.id} style={{ position: 'relative', flexShrink: 0 }}>
            <button role="tab"
                    aria-selected={isActive}
                    onClick={() => navigate(`/informe-asistencia/${t.id}`)}
                    style={{
                      position: 'relative',
                      display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                      gap: 3, padding: '10px 40px 12px 18px',
                      background: isActive ? 'var(--green-bg)' : 'transparent',
                      border: isActive ? '1px solid var(--green-border)' : '1px solid transparent',
                      borderRadius: 10,
                      cursor: 'pointer', textAlign: 'left',
                      boxShadow: isActive ? '0 1px 0 rgba(45,212,168,0.18)' : 'none',
                      transition: 'background 0.15s, border-color 0.15s',
                    }}>
              <span style={{
                fontFamily: 'var(--font-display)', fontSize: 15,
                fontWeight: isActive ? 800 : 600,
                color: isActive ? 'var(--green)' : 'var(--text-1)',
                letterSpacing: 0.1,
                transition: 'color 0.15s',
              }}>
                {t.label}
              </span>
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 11,
                color: isActive ? 'var(--green)' : 'var(--text-3)',
                opacity: isActive ? 0.9 : 1,
                whiteSpace: 'nowrap', fontWeight: isActive ? 600 : 400,
              }}>
                {t.hint}
              </span>
            </button>
            {/* Botón info ℹ️ */}
            {t.info && (
              <button onClick={(e) => { e.stopPropagation(); setInfoOpen(infoOpen === t.id ? null : t.id) }}
                      title="Ver info"
                      aria-label={`Información sobre ${t.label}`}
                      style={{
                        position: 'absolute', top: 10, right: 8,
                        background: 'none', border: 'none', padding: 4, cursor: 'pointer',
                        color: infoOpen === t.id ? 'var(--green)' : 'var(--text-3)',
                        borderRadius: 4,
                      }}>
                <Info size={13} />
              </button>
            )}
            {/* Popover */}
            {infoOpen === t.id && t.info && (
              <>
                <div onClick={() => setInfoOpen(null)}
                     style={{ position: 'fixed', inset: 0, zIndex: 998 }} />
                <div style={{
                  position: 'absolute', top: 'calc(100% + 8px)', right: 0,
                  width: 320, padding: 14, zIndex: 999,
                  background: 'var(--bg-1)', border: '1.5px solid var(--green-border)',
                  borderRadius: 12, boxShadow: '0 12px 28px -8px rgba(0,0,0,0.45)',
                }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-0)', marginBottom: 6 }}>
                    {t.label}
                  </p>
                  <p style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>
                    {t.info}
                  </p>
                </div>
              </>
            )}
          </div>
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
    case 'retos':        return n != null ? `${n} retos activos`    : 'NoofitPro'
    case 'estado_fisico': return n != null ? `${n} tests`           : 'Dashboard'
    default: return ''
  }
}
