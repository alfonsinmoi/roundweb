// Contexto global del "filtro de trainer" para administradores.
//
// Cuando el usuario tiene un perfil con is_admin=true, ve datos de TODOS los
// trainers del manager por defecto. Este contexto permite que elija filtrar
// por uno concreto desde el selector de la cabecera. La selección se persiste
// en sessionStorage para sobrevivir a recargas dentro de la misma sesión.
//
// Usuarios no-admin: ignoran este contexto (siempre ven solo su trainer).

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useAuth } from './AuthContext'

const KEY = 'round.trainer_filter'
const ALL = 'all'

const TrainerFilterContext = createContext({
  selectedTrainerId: null,    // null = "todos"
  setSelectedTrainerId: () => {},
  isAdmin: false,
  available: false,           // true si el usuario puede usar el selector
})

export function TrainerFilterProvider({ children }) {
  const { user } = useAuth()
  const isAdmin = !!(user && user.kind === 'usuario_web' && user.perfil?.is_admin)

  const [selectedTrainerId, setSel] = useState(() => {
    try {
      const raw = sessionStorage.getItem(KEY)
      return raw && raw !== ALL ? raw : null
    } catch { return null }
  })

  // Persistir cambios
  useEffect(() => {
    try {
      if (selectedTrainerId) sessionStorage.setItem(KEY, selectedTrainerId)
      else sessionStorage.setItem(KEY, ALL)
    } catch { /* ignore */ }
  }, [selectedTrainerId])

  // Resetear al cerrar sesión / cambiar usuario
  useEffect(() => {
    if (!user) setSel(null)
  }, [user])

  const value = useMemo(() => ({
    selectedTrainerId,
    setSelectedTrainerId: setSel,
    isAdmin,
    available: isAdmin,
  }), [selectedTrainerId, isAdmin])

  return (
    <TrainerFilterContext.Provider value={value}>
      {children}
    </TrainerFilterContext.Provider>
  )
}

export function useTrainerFilter() {
  return useContext(TrainerFilterContext)
}
