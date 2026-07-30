import { createContext, useContext, useEffect, useRef, useState } from 'react'

// Permite que una página añada "crumbs" extra al breadcrumb (típicamente su
// pestaña activa), de forma que la ruta de arriba refleje la sub-vista y cada
// tramo sea clicable. Ej.: "Clientes › Detalle › Recibos".
const Ctx = createContext({ extra: [], setExtra: () => {} })

export function BreadcrumbsProvider({ children }) {
  const [extra, setExtra] = useState([])
  return <Ctx.Provider value={{ extra, setExtra }}>{children}</Ctx.Provider>
}

// Lo consume el componente <Breadcrumbs/>.
export function useBreadcrumbsExtra() {
  return useContext(Ctx).extra
}

/**
 * Hook para que una página con pestañas publique crumbs extra.
 * @param {Array<{label:string, onClick?:function}>} crumbs
 * Se actualizan cuando cambian las etiquetas y se limpian al desmontar la página.
 */
export function useSetBreadcrumbsExtra(crumbs) {
  const { setExtra } = useContext(Ctx)
  const ref = useRef(crumbs)
  ref.current = crumbs
  const key = (crumbs || []).map(c => c.label).join('|')
  useEffect(() => {
    setExtra(ref.current || [])
    return () => setExtra([])
  }, [key, setExtra])
}
