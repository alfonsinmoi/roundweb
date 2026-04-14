import { useState, useEffect } from 'react'
import { Users, Clock, Loader2, Plus, Pencil, ToggleLeft, ToggleRight } from 'lucide-react'
import { Card, Badge, Btn } from '../components/UI'
import { getActividades, guardarActividad } from '../utils/api'

function colorFromName(name = '') {
  const colors = ['var(--green)','#4361EE','#22C55E','#F59E0B','#A855F7','#06B6D4','#EC4899']
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffffffff
  return colors[Math.abs(hash) % colors.length]
}

export default function Actividades() {
  const [actividades, setActividades] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchData = () => {
    setLoading(true)
    getActividades()
      .then(data => setActividades(data))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchData() }, [])

  const handleAlta = async () => {
    const nombre = window.prompt('Nombre de la actividad:')
    if (!nombre?.trim()) return
    const aforo = window.prompt('Aforo máximo (nº reservas):', '10')
    const idEspejo = window.prompt('ID Espejo (opcional):')
    try {
      await guardarActividad({ Nombre: nombre.trim(), numMaxReservas: Number(aforo) || 10, enabled: true, idEspejo: idEspejo ? Number(idEspejo) : undefined })
      alert('Actividad creada')
      fetchData()
    } catch (err) {
      alert('Error: ' + err.message)
    }
  }

  const handleModificar = async (act) => {
    const nombre = act.Nombre ?? act.nombre ?? ''
    const nuevoNombre = window.prompt('Nombre:', nombre)
    if (nuevoNombre === null) return
    const nuevoAforo = window.prompt('Aforo máximo:', String(act.numMaxReservas ?? ''))
    if (nuevoAforo === null) return
    const antelacion = window.prompt('Tiempo antelación reserva (horas):', String(act.tiempoAntelacionReserva ?? ''))
    const idEspejo = window.prompt('ID Espejo:', String(act.idEspejo ?? ''))
    try {
      await guardarActividad({
        ...act,
        Nombre: nuevoNombre || nombre,
        numMaxReservas: Number(nuevoAforo) || act.numMaxReservas,
        tiempoAntelacionReserva: antelacion ? Number(antelacion) : act.tiempoAntelacionReserva,
        idEspejo: idEspejo ? Number(idEspejo) : act.idEspejo,
      })
      alert('Actividad modificada')
      fetchData()
    } catch (err) {
      alert('Error: ' + err.message)
    }
  }

  const handleToggle = async (act) => {
    const activa = act.enabled !== false
    const msg = activa ? '¿Desactivar esta actividad?' : '¿Activar esta actividad?'
    if (!window.confirm(msg)) return
    try {
      await guardarActividad({ ...act, enabled: !activa })
      setActividades(prev => prev.map(a => a.id === act.id ? { ...a, enabled: !activa } : a))
    } catch (err) {
      alert('Error: ' + err.message)
    }
  }

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '120px 0' }}>
      <Loader2 size={22} className="animate-spin" style={{ color: 'var(--green)' }} />
    </div>
  )

  if (error) return (
    <div style={{ padding: '80px 0', textAlign: 'center', fontSize: 14, color: 'var(--red)' }}>
      Error cargando actividades: {error}
    </div>
  )

  return (
    <div style={{ maxWidth: 900 }}>

      {/* Toolbar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <p style={{ fontSize: 13, color: 'var(--text-3)' }}>
          {actividades.length} actividad{actividades.length !== 1 ? 'es' : ''}
        </p>
        <Btn variant="primary" size="md" onClick={handleAlta}>
          <Plus size={15} /> Nueva actividad
        </Btn>
      </div>

      {/* Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 16 }}>
        {actividades.map(act => {
          const nombre = act.Nombre ?? act.nombre ?? '—'
          const color = colorFromName(nombre)
          const activa = act.enabled !== false
          return (
            <Card key={act.id} style={{ padding: 28 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                <div style={{ width: 16, height: 16, borderRadius: '50%', marginTop: 3, flexShrink: 0, background: color }} />
                <div style={{ flex: 1, minWidth: 0 }}>

                  {/* Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
                    <h3 style={{ fontFamily: 'Outfit', fontWeight: 600, fontSize: 15, color: 'var(--text-0)' }}>{nombre}</h3>
                    <Badge color={activa ? 'green' : 'gray'}>{activa ? 'Activa' : 'Inactiva'}</Badge>
                  </div>

                  {/* Info */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, marginBottom: 20 }}>
                    {act.idEspejo != null && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 13, color: 'var(--text-3)' }}>ID Espejo:</span>
                        <span style={{ fontSize: 13, color: 'var(--text-2)', fontFamily: 'monospace' }}>{act.idEspejo}</span>
                      </div>
                    )}
                    {act.numMaxReservas != null && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Users size={13} style={{ color: 'var(--text-3)' }} />
                        <span style={{ fontSize: 13, color: 'var(--text-2)' }}>Aforo: {act.numMaxReservas}</span>
                      </div>
                    )}
                    {act.tiempoAntelacionReserva != null && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Clock size={13} style={{ color: 'var(--text-3)' }} />
                        <span style={{ fontSize: 13, color: 'var(--text-2)' }}>Antelación: {act.tiempoAntelacionReserva}h</span>
                      </div>
                    )}
                  </div>

                  {/* Badges */}
                  {(act.listaEspera || act.reservarLargoPlazo) && (
                    <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
                      {act.listaEspera && <Badge color="yellow">Lista espera</Badge>}
                      {act.reservarLargoPlazo && <Badge color="blue">Largo plazo</Badge>}
                    </div>
                  )}

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 10, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
                    <button onClick={() => handleToggle(act)}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
                              borderRadius: 10, fontSize: 13, cursor: 'pointer', border: 'none',
                              background: activa ? 'rgba(248,113,113,0.06)' : 'rgba(45,212,168,0.08)',
                              color: activa ? 'var(--red)' : 'var(--green)',
                              transition: 'background 0.1s',
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = activa ? 'rgba(248,113,113,0.12)' : 'rgba(45,212,168,0.15)'}
                            onMouseLeave={e => e.currentTarget.style.background = activa ? 'rgba(248,113,113,0.06)' : 'rgba(45,212,168,0.08)'}>
                      {activa ? <ToggleRight size={15} /> : <ToggleLeft size={15} />}
                      {activa ? 'Desactivar' : 'Activar'}
                    </button>
                    <button onClick={() => handleModificar(act)}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
                              borderRadius: 10, fontSize: 13, cursor: 'pointer',
                              background: 'var(--bg-3)', border: '1px solid var(--line)', color: 'var(--text-2)',
                              transition: 'all 0.1s',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.color = 'var(--green)'; e.currentTarget.style.borderColor = 'var(--green)' }}
                            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-2)'; e.currentTarget.style.borderColor = 'var(--line)' }}>
                      <Pencil size={14} /> Modificar
                    </button>
                  </div>
                </div>
              </div>
            </Card>
          )
        })}

        {actividades.length === 0 && (
          <div style={{ gridColumn: '1 / -1', padding: '80px 0', textAlign: 'center', color: 'var(--text-3)', fontSize: 14 }}>
            No hay actividades registradas
          </div>
        )}
      </div>
    </div>
  )
}
