// Selector global de trainer para administradores.
//
// Aparece en el Layout cuando el usuario es admin (is_admin=true). Permite
// elegir un trainer concreto o ver "Todos". El valor seleccionado afecta a
// todas las llamadas a la API (clientes, recibos, clases, etc).
//
// Solo se muestra si:
//   - El usuario es admin (perfil_is_admin)
//   - Hay al menos 2 trainers en el manager (sino no tiene sentido)

import { useEffect, useState } from 'react'
import { Users, ChevronDown } from 'lucide-react'
import { useTrainerFilter } from '../contexts/TrainerFilterContext'
import { getEntrenadores } from '../utils/api'

export default function TrainerFilterBar() {
  const { available, selectedTrainerId, setSelectedTrainerId } = useTrainerFilter()
  const [trainers, setTrainers] = useState([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!available) return
    getEntrenadores()
      .then(list => setTrainers(list || []))
      .catch(() => setTrainers([]))
      .finally(() => setLoaded(true))
  }, [available])

  if (!available) return null
  if (loaded && trainers.length < 2) return null   // un solo trainer → no merece selector

  const sel = trainers.find(t => String(t.id) === String(selectedTrainerId))
  const label = sel
    ? `${sel.nombre || ''} ${sel.apellidos || ''}`.trim() || `#${sel.id}`
    : 'Todos los centros'

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '6px 12px', borderRadius: 999,
      background: selectedTrainerId ? 'var(--blue-bg)' : 'var(--bg-2)',
      border: `1px solid ${selectedTrainerId ? 'var(--blue)' : 'var(--line)'}`,
      fontSize: 12,
    }}>
      <Users size={13} style={{ color: selectedTrainerId ? 'var(--blue)' : 'var(--text-2)' }} aria-hidden="true" />
      <span style={{ color: 'var(--text-3)' }}>Centro:</span>
      <select value={selectedTrainerId || ''}
              onChange={e => setSelectedTrainerId(e.target.value || null)}
              aria-label="Filtrar por centro / trainer"
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: selectedTrainerId ? 'var(--blue)' : 'var(--text-1)',
                fontWeight: 600, fontSize: 12, paddingRight: 14,
                outline: 'none', appearance: 'none',
              }}>
        <option value="">Todos los centros</option>
        {trainers.map(t => (
          <option key={t.id} value={t.id}>
            {(t.nombre || '') + ' ' + (t.apellidos || '')}
          </option>
        ))}
      </select>
      <ChevronDown size={11} style={{ marginLeft: -10, color: 'var(--text-3)', pointerEvents: 'none' }} aria-hidden="true" />
    </div>
  )
}
