import { useState, useEffect } from 'react'
import { Cpu, Battery, BatteryLow, BatteryFull, AlertTriangle, Loader2 } from 'lucide-react'
import { Card, Badge } from '../components/UI'
import { getSensores } from '../utils/api'

function BatteryIcon({ nivel }) {
  if (nivel <= 20) return <BatteryLow size={14} style={{ color: '#EF4444' }} />
  if (nivel >= 80) return <BatteryFull size={14} style={{ color: '#22C55E' }} />
  return <Battery size={14} style={{ color: '#F59E0B' }} />
}

const tipoLabel = { 0: 'EMS', 1: 'HRM', 2: 'Sensor', 3: 'Dispositivo' }

export default function Dispositivos() {
  const [sensores, setSensores] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    getSensores()
      .then(data => setSensores(data))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const activos = sensores.filter(d => d.enabled && !d.tieneIncidencia).length
  const conIncidencia = sensores.filter(d => d.tieneIncidencia).length
  const bateriasBaja = sensores.filter(d => d.battery != null && d.battery <= 20).length

  if (loading) return (
    <div className="flex items-center justify-center py-24">
      <Loader2 size={24} className="animate-spin" style={{ color: 'var(--green)' }} />
    </div>
  )

  if (error) return (
    <div className="py-16 text-center text-sm" style={{ color: 'var(--red)' }}>
      Error cargando dispositivos: {error}
    </div>
  )

  return (
    <div className="max-w-6xl space-y-5">
      {/* Stats rápidos */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total', value: sensores.length, color: '#4361EE' },
          { label: 'Activos', value: activos, color: '#22C55E' },
          { label: 'En uso', value: sensores.filter(d => d.enUso).length, color: '#F59E0B' },
          { label: 'Batería baja', value: bateriasBaja, color: '#EF4444' },
        ].map(({ label, value, color }) => (
          <Card key={label} style={{ padding: 24, textAlign: "center" }}>
            <p className="text-2xl font-bold" style={{ fontFamily: 'Outfit', color }}>{value}</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>{label}</p>
          </Card>
        ))}
      </div>

      {/* Tarjetas */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {sensores.map(disp => {
          const bat = disp.battery ?? 0
          return (
            <Card key={disp.id} style={{ padding: 28 }}>
              <div className="flex items-start justify-between gap-2 mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center"
                       style={{ background: 'rgba(67,97,238,0.15)' }}>
                    <Cpu size={18} style={{ color: '#4361EE' }} />
                  </div>
                  <div>
                    <p className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>
                      {disp.alias || disp.uuid || `Sensor ${disp.numero ?? disp.id}`}
                    </p>
                    <p className="text-xs font-mono" style={{ color: 'var(--text-3)' }}>
                      {disp.uuid ? disp.uuid.slice(0, 8) + '…' : `#${disp.id}`}
                    </p>
                  </div>
                </div>
                <Badge color={disp.tieneIncidencia ? 'red' : disp.enabled ? 'green' : 'gray'}>
                  {disp.tieneIncidencia ? 'Incidencia' : disp.enabled ? 'OK' : 'Inactivo'}
                </Badge>
              </div>

              {/* Batería */}
              {disp.battery != null && (
                <div className="mb-3">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1">
                      <BatteryIcon nivel={bat} />
                      <span className="text-xs" style={{ color: 'var(--text-2)' }}>Batería</span>
                    </div>
                    <span className="text-xs font-medium"
                          style={{ color: bat <= 20 ? '#EF4444' : 'var(--text-1)' }}>
                      {bat}%
                      {bat <= 20 && <AlertTriangle size={11} className="inline ml-1" style={{ color: '#EF4444' }} />}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--line)' }}>
                    <div className="h-full rounded-full"
                         style={{
                           width: `${bat}%`,
                           background: bat <= 20 ? '#EF4444' : bat >= 80 ? '#22C55E' : '#F59E0B'
                         }} />
                  </div>
                </div>
              )}

              <div className="pt-3 border-t space-y-1.5" style={{ borderColor: 'var(--line)' }}>
                <div className="flex justify-between text-xs">
                  <span style={{ color: 'var(--text-3)' }}>Tipo</span>
                  <span style={{ color: 'var(--text-2)' }}>
                    {tipoLabel[disp.tipo] ?? `Tipo ${disp.tipo}`}
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span style={{ color: 'var(--text-3)' }}>Estado</span>
                  <span style={{ color: disp.enUso ? 'var(--green)' : 'var(--text-3)' }}>
                    {disp.enUso ? 'En uso' : 'Libre'}
                  </span>
                </div>
                {disp.ultimoUso && (
                  <div className="flex justify-between text-xs">
                    <span style={{ color: 'var(--text-3)' }}>Último uso</span>
                    <span style={{ color: 'var(--text-2)' }}>
                      {new Date(disp.ultimoUso).toLocaleDateString('es-ES')}
                    </span>
                  </div>
                )}
                {disp.numero != null && (
                  <div className="flex justify-between text-xs">
                    <span style={{ color: 'var(--text-3)' }}>Número</span>
                    <span style={{ color: 'var(--text-2)' }}>#{disp.numero}</span>
                  </div>
                )}
              </div>
            </Card>
          )
        })}

        {sensores.length === 0 && (
          <div className="col-span-3 py-16 text-center" style={{ color: 'var(--text-3)' }}>
            No hay dispositivos registrados
          </div>
        )}
      </div>
    </div>
  )
}
