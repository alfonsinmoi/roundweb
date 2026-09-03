// Selector "Centro" para los informes del manager.
//
// Cuando la sesión activa es la del MANAGER (user.esManager && no está
// impersonando un trainer), este componente permite filtrar el informe
// por centro concreto o ver "Todos" sin tener que salir de la vista de
// manager. En sesiones de trainer no se pinta (se ve solo su centro).
//
// Uso:
//     const [idTrainer, setIdTrainer] = useState('')
//     <CentroSelector value={idTrainer} onChange={setIdTrainer} />
//
// El caller pasa el `id_trainer` resultante al backend como filtro
// adicional (los endpoints que ya aceptan `?id_trainer=` lo soportan
// automáticamente).

import { useEffect, useMemo, useState } from 'react'
import { Building2 } from 'lucide-react'
import { Btn } from './UI'
import { useAuth } from '../contexts/AuthContext'
import { getRoundIdentity, centrosList } from '../utils/configApi'

export default function CentroSelector({ value, onChange, style = {} }) {
  const { user, isImpersonating } = useAuth()
  const identity = useMemo(() => getRoundIdentity(user), [user])
  const [centros, setCentros] = useState([])

  // Solo mostramos el selector si es el manager (y NO está impersonando ya
  // a un trainer, en cuyo caso el pill lateral ya limita el scope).
  const visible = user?.esManager && !isImpersonating

  useEffect(() => {
    if (!visible || !identity?.managerId) return
    let active = true
    ;(async () => {
      try {
        const rows = await centrosList(identity)
        if (!active) return
        setCentros(rows || [])
      } catch { /* si falla, se queda en "Todos" */ }
    })()
    return () => { active = false }
  }, [visible, identity?.managerId])

  if (!visible) return null

  // Deduplicar por id_trainer (por si el backend devuelve varios contactos
  // por trainer) y filtrar los sin nombre.
  const opciones = []
  const vistos = new Set()
  for (const c of centros) {
    const tid = String(c.id_trainer || '')
    if (!tid || vistos.has(tid)) continue
    vistos.add(tid)
    opciones.push({ id_trainer: tid, nombre: c.nombre_centro || `Centro ${tid}` })
  }

  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', ...style }}>
      <Building2 size={14} style={{ color: 'var(--text-3)' }} aria-hidden="true" />
      <span style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase',
                     letterSpacing: '0.04em', marginRight: 4 }}>Centro</span>
      <Btn size="sm"
           variant={!value ? 'primary' : 'secondary'}
           onClick={() => onChange('')}>
        Todos
      </Btn>
      {opciones.map(o => (
        <Btn key={o.id_trainer} size="sm"
             variant={String(value) === o.id_trainer ? 'primary' : 'secondary'}
             onClick={() => onChange(o.id_trainer)}>
          {o.nombre}
        </Btn>
      ))}
    </div>
  )
}
