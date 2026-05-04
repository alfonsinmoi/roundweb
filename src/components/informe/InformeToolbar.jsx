import { RotateCcw, Filter, Calendar } from 'lucide-react'

/**
 * Toolbar compartida del Informe de Asistencia.
 *
 * Estructura (de izq. a der.):
 *   - Botón rango (icono calendario + rango legible) → abre filtros avanzados
 *   - Atajos: 7d / 30d / Mes / Personalizado (segmented control)
 *   - Filtro actividad (select; solo si hay actividades)
 *   - Spacer
 *   - Recargar
 *
 * Props:
 *   desde, hasta             — strings yyyy-MM-dd
 *   onRange(desde, hasta)    — callback al pulsar atajos o cambiar rango
 *   actividades              — string[] disponibles
 *   actividadActiva          — '' = todas
 *   onActividad(name)        — callback
 *   onReload                 — callback recargar (invalida caché)
 *   onTogglePersonalizar     — abre/cierra panel de filtros personalizados
 *   personalizando           — bool (estado del panel de filtros)
 */
export default function InformeToolbar({
  desde, hasta,
  onRange, actividades = [], actividadActiva = '',
  onActividad, onReload, onTogglePersonalizar, personalizando = false,
}) {
  const presets = [
    { id: '7d',     label: '7d',  build: () => buildRange(7) },
    { id: '30d',    label: '30d', build: () => buildRange(30) },
    { id: 'mes',    label: 'Mes', build: () => buildRangeMes() },
  ]

  const presetActivo = detectPreset(desde, hasta)

  const fmt = (s) => {
    if (!s) return ''
    const [y, m, d] = s.split('-')
    return `${d}/${m}/${y.slice(2)}`
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      marginBottom: 18,
    }}>
      {/* Botón con rango legible — abre filtros avanzados */}
      <button onClick={onTogglePersonalizar}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 14px', borderRadius: 'var(--radius-sm)',
                background: personalizando ? 'var(--bg-3)' : 'var(--bg-2)',
                border: '1px solid var(--line)',
                color: 'var(--text-1)', fontSize: 13, fontWeight: 500,
                cursor: 'pointer', flexShrink: 0,
              }}>
        <Calendar size={13} aria-hidden="true" style={{ color: 'var(--green)' }} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-1)' }}>
          {fmt(desde)} — {fmt(hasta)}
        </span>
      </button>

      {/* Atajos de rango (segmented) */}
      <div role="group" aria-label="Atajos de rango"
           style={{
             display: 'flex', borderRadius: 'var(--radius-sm)',
             background: 'var(--bg-1)', border: '1px solid var(--line)',
             overflow: 'hidden',
           }}>
        {presets.map(p => {
          const activo = presetActivo === p.id
          return (
            <button key={p.id}
                    onClick={() => {
                      const r = p.build()
                      onRange?.(r.desde, r.hasta)
                    }}
                    aria-pressed={activo}
                    style={{
                      padding: '7px 12px', fontSize: 12, fontWeight: 600,
                      background: activo ? 'var(--bg-3)' : 'transparent',
                      color: activo ? 'var(--text-0)' : 'var(--text-2)',
                      border: 'none', cursor: 'pointer',
                    }}>
              {p.label}
            </button>
          )
        })}
        <button onClick={onTogglePersonalizar}
                aria-pressed={personalizando}
                style={{
                  padding: '7px 12px', fontSize: 12, fontWeight: 600,
                  background: personalizando ? 'var(--bg-3)' : 'transparent',
                  color: personalizando ? 'var(--text-0)' : 'var(--text-2)',
                  border: 'none', cursor: 'pointer',
                  borderLeft: '1px solid var(--line)',
                }}>
          Personalizado
        </button>
      </div>

      {/* Filtro actividad */}
      {actividades.length > 0 && (
        <select value={actividadActiva}
                onChange={e => onActividad?.(e.target.value)}
                aria-label="Filtrar por actividad"
                style={{
                  padding: '8px 12px', borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-2)', border: '1px solid var(--line)',
                  color: 'var(--text-1)', fontSize: 13, cursor: 'pointer',
                  outline: 'none',
                }}>
          <option value="">Todas las actividades</option>
          {actividades.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      )}

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Recargar */}
      <button onClick={onReload}
              title="Recargar datos"
              aria-label="Recargar"
              style={{
                width: 34, height: 34, borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-2)', border: '1px solid var(--line)',
                color: 'var(--text-2)', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
        <RotateCcw size={14} aria-hidden="true" />
      </button>
    </div>
  )
}

// ── Helpers de rango ─────────────────────────────────────────────────────────

function fmtDate(d) { return d.toISOString().slice(0, 10) }

function buildRange(daysBack) {
  const hasta = new Date()
  const desde = new Date(); desde.setDate(desde.getDate() - daysBack)
  return { desde: fmtDate(desde), hasta: fmtDate(hasta) }
}

function buildRangeMes() {
  const hoy   = new Date()
  const desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1)
  return { desde: fmtDate(desde), hasta: fmtDate(hoy) }
}

// Detecta si el rango actual coincide con uno de los atajos
function detectPreset(desde, hasta) {
  if (!desde || !hasta) return null
  const today = fmtDate(new Date())
  if (hasta !== today) return null
  const r7   = buildRange(7)
  const r30  = buildRange(30)
  const rMes = buildRangeMes()
  if (desde === r7.desde)   return '7d'
  if (desde === r30.desde)  return '30d'
  if (desde === rMes.desde) return 'mes'
  return null
}
