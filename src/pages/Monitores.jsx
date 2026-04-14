import { useState, useEffect } from 'react'
import { Mail, Users, Loader2 } from 'lucide-react'
import { Card, Badge, Avatar } from '../components/UI'
import { getEntrenadores } from '../utils/api'

export default function Monitores() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    getEntrenadores()
      .then(data => setItems(data))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="flex items-center justify-center py-24">
      <Loader2 size={24} className="animate-spin" style={{ color: 'var(--green)' }} />
    </div>
  )

  if (error) return (
    <div className="py-16 text-center text-sm" style={{ color: 'var(--red)' }}>
      Error cargando monitores: {error}
    </div>
  )

  return (
    <div className="max-w-5xl space-y-5">
      <p className="text-xs" style={{ color: 'var(--text-3)' }}>
        {items.length} monitor{items.length !== 1 ? 'es' : ''}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map(mon => (
          <Card key={mon.id} style={{ padding: 28 }}>
            <div className="flex items-start gap-3 mb-4">
              <Avatar nombre={`${mon.nombre} ${mon.apellidos}`} size={48} />
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold" style={{ color: 'var(--text-1)' }}>
                      {mon.nombre} {mon.apellidos}
                    </p>
                    {mon.managerId && (
                      <p className="text-xs mt-0.5" style={{ color: 'var(--green)' }}>
                        Manager #{mon.managerId}
                      </p>
                    )}
                  </div>
                  <Badge color={mon.enabled ? 'green' : 'gray'}>{mon.enabled ? 'Activo' : 'Inactivo'}</Badge>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              {mon.email && (
                <div className="flex items-center gap-2 text-xs">
                  <Mail size={12} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
                  <span className="truncate" style={{ color: 'var(--text-2)' }}>{mon.email}</span>
                </div>
              )}
              <div className="flex items-center gap-2 text-xs">
                <Users size={12} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
                <span style={{ color: 'var(--text-2)' }}>
                  {mon.premium ? 'Premium' : 'Estándar'}
                </span>
              </div>
            </div>

            {mon.autoSerial && (
              <div className="mt-3 pt-3 border-t" style={{ borderColor: 'var(--line)' }}>
                <p className="text-xs font-mono" style={{ color: 'var(--text-3)' }}>
                  Serial: {mon.autoSerial}
                </p>
              </div>
            )}
          </Card>
        ))}

        {items.length === 0 && (
          <div className="col-span-3 py-16 text-center" style={{ color: 'var(--text-3)' }}>
            No hay monitores registrados
          </div>
        )}
      </div>
    </div>
  )
}
