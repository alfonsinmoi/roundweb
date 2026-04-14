import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Loader2, Users, Clock, Plus, Pencil, Trash2 } from 'lucide-react'
import { Card, Badge, Btn } from '../components/UI'
import { getSalas, saveSala, removeSala } from '../utils/api'

const diasSemana = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

function colorFromName(name = '') {
  const colors = ['var(--green)','#4361EE','#22C55E','#F59E0B','#A855F7','#06B6D4','#EC4899']
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffffffff
  return colors[Math.abs(hash) % colors.length]
}

function formatHora(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (isNaN(d)) return '—'
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
}

function formatDuration(seconds) {
  if (!seconds) return ''
  const min = Math.round(seconds / 60)
  return `${min} min`
}

export default function Clases() {
  const navigate = useNavigate()
  const [semanaOffset, setSemanaOffset] = useState(0)
  const [salas, setSalas] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [vista, setVista] = useState('semana')

  const fetchSalas = () => {
    setLoading(true)
    getSalas()
      .then(data => setSalas(data.filter(s => s.enabled)))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchSalas() }, [])

  const handleAlta = async () => {
    const nombre = window.prompt('Nombre de la nueva clase:')
    if (!nombre?.trim()) return
    const aforo = window.prompt('Aforo máximo:', '10')
    const idEspejo = window.prompt('ID Espejo (opcional):')
    try {
      await saveSala({ name: nombre.trim(), aforo: Number(aforo) || 10, enabled: true, idEspejo: idEspejo ? Number(idEspejo) : undefined })
      alert('Clase creada correctamente')
      fetchSalas()
    } catch (err) {
      alert('Error al crear: ' + err.message)
    }
  }

  const handleModificar = async (sala) => {
    const nuevoNombre = window.prompt('Nombre de la clase:', sala.name || sala.nameTraining || '')
    if (nuevoNombre === null) return
    const nuevoAforo = window.prompt('Aforo:', String(sala.aforo || ''))
    const idEspejo = window.prompt('ID Espejo:', String(sala.idEspejo ?? ''))
    try {
      await saveSala({ ...sala, name: nuevoNombre, aforo: Number(nuevoAforo) || sala.aforo, idEspejo: idEspejo ? Number(idEspejo) : sala.idEspejo })
      alert('Clase modificada')
      fetchSalas()
    } catch (err) {
      alert('Error al modificar: ' + err.message)
    }
  }

  const handleBaja = async (sala) => {
    if (!window.confirm(`¿Dar de baja la clase "${sala.name || sala.nameTraining}"?`)) return
    try {
      await removeSala(sala.id)
      setSalas(prev => prev.filter(s => s.id !== sala.id))
      alert('Clase eliminada')
    } catch (err) {
      alert('Error al eliminar: ' + err.message)
    }
  }

  const hoy = new Date()
  const inicioSemana = new Date(hoy)
  inicioSemana.setDate(hoy.getDate() - hoy.getDay() + 1 + semanaOffset * 7)
  const diasSemanaArr = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(inicioSemana)
    d.setDate(inicioSemana.getDate() + i)
    return d
  })
  const todayStr = hoy.toISOString().slice(0, 10)

  const salasPorDia = (fecha) => {
    const fechaStr = fecha.toISOString().slice(0, 10)
    return salas
      .filter(s => {
        if (!s.dateStart) return false
        return new Date(s.dateStart).toISOString().slice(0, 10) === fechaStr
      })
      .sort((a, b) => new Date(a.dateStart) - new Date(b.dateStart))
  }

  const salasSemanales = diasSemanaArr
    .flatMap(d => salasPorDia(d))
    .sort((a, b) => new Date(a.dateStart) - new Date(b.dateStart))

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '120px 0' }}>
      <Loader2 size={22} className="animate-spin" style={{ color: 'var(--green)' }} />
    </div>
  )

  if (error) return (
    <div style={{ padding: '80px 0', textAlign: 'center', fontSize: 14, color: 'var(--red)' }}>
      Error cargando clases: {error}
    </div>
  )

  return (
    <div style={{ maxWidth: 1200 }}>

      {/* Toolbar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, marginBottom: 28 }}>

        {/* Nav semana */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => setSemanaOffset(o => o - 1)}
                  style={{ padding: 12, borderRadius: 12, cursor: 'pointer', background: 'var(--bg-2)', border: '1px solid var(--line)', color: 'var(--text-3)', transition: 'color 0.1s' }}
                  onMouseEnter={e => e.currentTarget.style.color = 'var(--text-1)'}
                  onMouseLeave={e => e.currentTarget.style.color = 'var(--text-3)'}>
            <ChevronLeft size={16} />
          </button>
          <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-1)', minWidth: 180, textAlign: 'center' }}>
            {diasSemanaArr[0].toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })} — {diasSemanaArr[6].toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
          </span>
          <button onClick={() => setSemanaOffset(o => o + 1)}
                  style={{ padding: 12, borderRadius: 12, cursor: 'pointer', background: 'var(--bg-2)', border: '1px solid var(--line)', color: 'var(--text-3)', transition: 'color 0.1s' }}
                  onMouseEnter={e => e.currentTarget.style.color = 'var(--text-1)'}
                  onMouseLeave={e => e.currentTarget.style.color = 'var(--text-3)'}>
            <ChevronRight size={16} />
          </button>
          {semanaOffset !== 0 && (
            <button onClick={() => setSemanaOffset(0)}
                    style={{ padding: '8px 16px', borderRadius: 10, fontSize: 13, cursor: 'pointer', color: 'var(--green)', background: 'rgba(45,212,168,0.1)', border: 'none' }}>
              Hoy
            </button>
          )}
        </div>

        {/* Right side: vista toggle + action buttons */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--line)' }}>
            {[['semana','Semana'],['lista','Lista']].map(([v,l]) => (
              <button key={v} onClick={() => setVista(v)}
                      style={{
                        padding: '12px 20px', fontSize: 13, fontWeight: 500, cursor: 'pointer', border: 'none',
                        background: vista === v ? 'var(--green)' : 'var(--bg-2)',
                        color: vista === v ? '#fff' : 'var(--text-2)',
                      }}>
                {l}
              </button>
            ))}
          </div>
          <Btn variant="primary" size="md" onClick={handleAlta}><Plus size={15} /> Alta clase</Btn>
        </div>
      </div>

      <p style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 20 }}>
        {salasSemanales.length} sala{salasSemanales.length !== 1 ? 's' : ''} esta semana
      </p>

      {vista === 'semana' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8 }}>
          {diasSemanaArr.map(dia => {
            const diaStr = dia.toISOString().slice(0, 10)
            const esHoy = diaStr === todayStr
            const clasesDelDia = salasPorDia(dia)
            return (
              <div key={diaStr} style={{ minHeight: 200 }}>
                <div style={{ textAlign: 'center', marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid var(--line)' }}>
                  <p style={{ fontSize: 12, color: 'var(--text-3)' }}>{diasSemana[dia.getDay()]}</p>
                  <p style={{
                    fontFamily: 'Outfit', fontSize: 14, fontWeight: 700, marginTop: 4,
                    width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: '50%', margin: '4px auto 0',
                    color: esHoy ? '#fff' : 'var(--text-1)',
                    background: esHoy ? 'var(--green)' : 'transparent',
                  }}>
                    {dia.getDate()}
                  </p>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {clasesDelDia.length === 0 && (
                    <p style={{ textAlign: 'center', fontSize: 12, padding: '10px 0', color: 'var(--text-3)' }}>—</p>
                  )}
                  {clasesDelDia.map(s => {
                    const color = colorFromName(s.nameTraining || s.name)
                    const inscritos = s.users?.length ?? 0
                    return (
                      <div key={s.id} onClick={() => navigate(`/clases/${s.id}`)}
                           style={{ borderRadius: 10, padding: 10, cursor: 'pointer', background: `${color}18`, borderLeft: `3px solid ${color}` }}>
                        <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {s.name || s.nameTraining}
                        </p>
                        <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{formatHora(s.dateStart)}</p>
                        <p style={{ fontSize: 11, color: 'var(--text-3)' }}>{inscritos}/{s.aforo || '—'}</p>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {salasSemanales.length === 0 && (
            <Card style={{ padding: 48, textAlign: 'center' }}>
              <p style={{ color: 'var(--text-3)', fontSize: 14 }}>No hay salas programadas esta semana</p>
            </Card>
          )}
          {salasSemanales.map(s => {
            const color = colorFromName(s.nameTraining || s.name)
            const inscritos = s.users?.length ?? 0
            const pct = s.aforo > 0 ? Math.round((inscritos / s.aforo) * 100) : 0
            const fecha = s.dateStart ? new Date(s.dateStart) : null
            return (
              <Card key={s.id} style={{ padding: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                  <div onClick={() => navigate(`/clases/${s.id}`)} style={{ width: 4, height: 52, borderRadius: 99, flexShrink: 0, background: color, cursor: 'pointer' }} />

                  <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, alignItems: 'center' }}>
                    <div>
                      <p onClick={() => navigate(`/clases/${s.id}`)}
                         style={{ fontFamily: 'Outfit', fontWeight: 600, fontSize: 14, color: 'var(--text-0)', cursor: 'pointer', transition: 'color 0.1s' }}
                         onMouseEnter={e => e.currentTarget.style.color = 'var(--green)'}
                         onMouseLeave={e => e.currentTarget.style.color = 'var(--text-0)'}>
                        {s.name || s.nameTraining}
                      </p>
                      {s.nameTraining && s.name && s.name !== s.nameTraining && (
                        <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{s.nameTraining}</p>
                      )}
                      {s.idEspejo != null && (
                        <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2, fontFamily: 'monospace' }}>Espejo: {s.idEspejo}</p>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Clock size={13} style={{ color: 'var(--text-3)' }} />
                      <span style={{ fontSize: 13, color: 'var(--text-2)' }}>
                        {fecha ? fecha.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : '—'}{' '}
                        {formatHora(s.dateStart)}
                        {s.durationTraining ? ` · ${formatDuration(s.durationTraining)}` : ''}
                      </span>
                    </div>
                    <div>
                      <p style={{ fontSize: 12, color: 'var(--text-3)' }}>Monitor</p>
                      <p style={{ fontSize: 13, color: 'var(--text-2)' }}>{s.nameTrainer || '—'}</p>
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <Users size={12} style={{ color: 'var(--text-3)' }} />
                          <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{inscritos}/{s.aforo || '—'}</span>
                        </div>
                        {s.aforo > 0 && (
                          <Badge color={inscritos >= s.aforo ? 'red' : 'green'}>
                            {inscritos >= s.aforo ? 'Lleno' : 'Plazas'}
                          </Badge>
                        )}
                      </div>
                      {s.aforo > 0 && (
                        <div style={{ height: 5, borderRadius: 99, overflow: 'hidden', background: 'var(--bg-4)' }}>
                          <div style={{ height: '100%', borderRadius: 99, width: `${Math.min(pct, 100)}%`, background: inscritos >= s.aforo ? 'var(--red)' : 'var(--green)' }} />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    <button title="Modificar" onClick={() => handleModificar(s)}
                            style={{ padding: 10, borderRadius: 10, cursor: 'pointer', background: 'var(--bg-3)', border: '1px solid var(--line)', color: 'var(--text-2)', transition: 'all 0.1s' }}
                            onMouseEnter={e => { e.currentTarget.style.color = 'var(--green)'; e.currentTarget.style.borderColor = 'var(--green)' }}
                            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-2)'; e.currentTarget.style.borderColor = 'var(--line)' }}>
                      <Pencil size={15} />
                    </button>
                    <button title="Dar de baja" onClick={() => handleBaja(s)}
                            style={{ padding: 10, borderRadius: 10, cursor: 'pointer', background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.16)', color: 'var(--red)', transition: 'all 0.1s' }}
                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(248,113,113,0.12)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'rgba(248,113,113,0.06)'}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
