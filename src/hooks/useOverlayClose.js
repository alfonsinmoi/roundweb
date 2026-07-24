import { useRef, useCallback } from 'react'

/**
 * Devuelve props para el backdrop (overlay) de un modal ad-hoc de forma que
 * SOLO cierre cuando el gesto EMPEZÓ y TERMINÓ en el propio backdrop.
 *
 * Arregla el bug clásico: al seleccionar texto dentro de un input y soltar el
 * ratón fuera del formulario (mouseup sobre el backdrop), el navegador dispara
 * un `click` cuyo target es el backdrop → cerraba el formulario a media edición.
 *
 * Uso:
 *   const overlay = useOverlayClose(() => setOpen(false), !saving)
 *   <div style={{position:'fixed', inset:0, ...}} {...overlay}> … </div>
 *
 * @param {() => void} onClose  callback de cierre
 * @param {boolean}    enabled  si false, nunca cierra (p. ej. mientras guarda)
 */
export function useOverlayClose(onClose, enabled = true) {
  const downOnBackdrop = useRef(false)
  const onMouseDown = useCallback((e) => {
    downOnBackdrop.current = e.target === e.currentTarget
  }, [])
  const onClick = useCallback((e) => {
    const cerrar = e.target === e.currentTarget && downOnBackdrop.current && enabled
    downOnBackdrop.current = false
    if (cerrar) onClose?.()
  }, [onClose, enabled])
  return { onMouseDown, onClick }
}
