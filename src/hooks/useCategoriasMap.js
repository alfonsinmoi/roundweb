// Hook que carga el catálogo de categorías + el mapa de asignaciones
// (idnoofit → categoría completa) desde el backend del VPS.
//
// Reemplaza al detector hardcoded "alias contiene 'gympass'" → ahora cualquier
// manager puede crear sus propias categorías (Gympass, Trabajador, Invitado…).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import {
  getRoundIdentity, categoriasList, categoriasAsignaciones, categoriaClienteSet,
  categoriaClienteDel,
} from '../utils/configApi'

export function useCategoriasMap() {
  const { user } = useAuth()
  // Memoizamos identity por sus claves primitivas para evitar bucle infinito
  const managerId = user?.originalSession?.manager ?? user?.originalSession?.id ?? user?.manager ?? user?.id ?? null
  const trainerId = user?.originalSession ? (user?.manager ?? user?.id) : null
  const identity = useMemo(
    () => getRoundIdentity(user),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [managerId, trainerId]
  )

  const [categorias, setCategorias] = useState([])  // catálogo manager
  const [mapa, setMapa] = useState({})              // idnoofit → categoría asignada
  const [loaded, setLoaded] = useState(false)

  const reload = useCallback(async () => {
    if (!identity.managerId) { setLoaded(true); return }
    try {
      const [cats, asig] = await Promise.all([
        categoriasList(identity).catch(() => []),
        categoriasAsignaciones(identity).catch(() => ({})),
      ])
      setCategorias(cats || [])
      setMapa(asig || {})
    } finally {
      setLoaded(true)
    }
  }, [identity])

  useEffect(() => { reload() }, [reload])

  /** Devuelve la categoría asignada al cliente (objeto), o null si no tiene. */
  const getCategoria = useCallback((cliente) => {
    const id = String(cliente?.id ?? '')
    return id && mapa[id] ? mapa[id] : null
  }, [mapa])

  /** Asigna una categoría al cliente. Si categoria_id es null, la elimina. */
  const setCategoria = useCallback(async (idNoofit, categoria_id) => {
    if (!categoria_id) {
      await categoriaClienteDel(identity, idNoofit)
      setMapa(m => { const c = { ...m }; delete c[String(idNoofit)]; return c })
    } else {
      await categoriaClienteSet(identity, idNoofit, categoria_id)
      const cat = categorias.find(c => c.id === categoria_id)
      if (cat) {
        setMapa(m => ({ ...m, [String(idNoofit)]: {
          id: cat.id, nombre: cat.nombre, color: cat.color,
          puede_reservar: cat.puede_reservar, tiene_cuota: cat.tiene_cuota,
          activa: cat.activa,
        }}))
      }
    }
  }, [identity, categorias])

  return { categorias, mapa, loaded, getCategoria, setCategoria, reload }
}
