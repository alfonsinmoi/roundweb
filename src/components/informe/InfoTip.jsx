import { useState, useRef, useEffect } from 'react'
import { HelpCircle } from 'lucide-react'

/**
 * Pequeño icono "?" que abre un popover explicativo al pasar el ratón o
 * al hacer click. Diseñado para colocarse al lado de etiquetas de KPI,
 * cabeceras de tabla, valores calculados por algoritmos, etc.
 *
 * Uso:
 *   <InfoTip title="Tasa de asistencia">
 *     Porcentaje de reservas en las que el cliente apareció.
 *     Fórmula: presentes / inscritos × 100.
 *     Por debajo de 70% se considera alto absentismo.
 *   </InfoTip>
 *
 * Props:
 *   title   — opcional, encabezado en negrita del popover
 *   size    — px del icono (default 13)
 *   side    — 'auto' | 'right' | 'left' (default 'auto') — lado preferido
 *             del popover. En 'auto' se detecta si cabe por la derecha;
 *             si no cabe, se gira al lado izquierdo automáticamente.
 *   children — el texto descriptivo (puede ser JSX)
 */
const POP_WIDTH = 280
const SCREEN_MARGIN = 12   // margen mínimo respecto al borde de la ventana

export default function InfoTip({ title, size = 13, side = 'auto', children }) {
  const [open, setOpen] = useState(false)
  // resolvedSide: 'right' o 'left' tras calcular en cada apertura.
  const [resolvedSide, setResolvedSide] = useState(side === 'left' ? 'left' : 'right')
  const btnRef = useRef(null)

  // Cerrar al hacer click fuera
  useEffect(() => {
    if (!open) return
    const onDoc = (e) => {
      if (btnRef.current && !btnRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  // Cuando se abre, recalcular el lado óptimo en función del viewport
  useEffect(() => {
    if (!open) return
    if (side !== 'auto') { setResolvedSide(side); return }
    const el = btnRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const vw = window.innerWidth
    // Si el popover desplegado a la derecha NO cabe → girar a izquierda
    const wouldOverflowRight = rect.left + POP_WIDTH + SCREEN_MARGIN > vw
    const wouldOverflowLeft  = rect.right - POP_WIDTH - SCREEN_MARGIN < 0
    if (wouldOverflowRight && !wouldOverflowLeft) setResolvedSide('left')
    else if (wouldOverflowLeft && !wouldOverflowRight) setResolvedSide('right')
    else setResolvedSide('right')
  }, [open, side])

  const popStyle = {
    position: 'absolute',
    top: 'calc(100% + 6px)',
    [resolvedSide === 'left' ? 'right' : 'left']: 0,
    width: POP_WIDTH, padding: 12, zIndex: 999,
    background: 'var(--bg-1)',
    border: '1.5px solid var(--green-border)',
    borderRadius: 10,
    boxShadow: '0 10px 24px -8px rgba(0,0,0,0.45)',
    fontSize: 12, lineHeight: 1.55, color: 'var(--text-1)',
    textAlign: 'left', whiteSpace: 'normal', fontWeight: 400,
    textTransform: 'none', letterSpacing: 0,
  }

  return (
    <span ref={btnRef} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <button type="button"
              aria-label={title ? `Ver explicación de ${title}` : 'Ver explicación'}
              aria-expanded={open}
              onMouseEnter={() => setOpen(true)}
              onMouseLeave={(e) => {
                // No cerrar si el ratón pasa al popover
                if (!e.relatedTarget?.closest?.('[data-infotip-pop]')) setOpen(false)
              }}
              onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}
              style={{
                background: 'none', border: 'none', padding: 2, cursor: 'help',
                color: open ? 'var(--green)' : 'var(--text-3)',
                display: 'inline-flex', alignItems: 'center', marginLeft: 4,
              }}>
        <HelpCircle size={size} />
      </button>
      {open && (
        <div data-infotip-pop role="tooltip" style={popStyle}
             onMouseEnter={() => setOpen(true)}
             onMouseLeave={() => setOpen(false)}>
          {title && (
            <div style={{
              fontWeight: 700, color: 'var(--text-0)', marginBottom: 6,
              fontSize: 12.5,
            }}>{title}</div>
          )}
          <div>{children}</div>
        </div>
      )}
    </span>
  )
}
