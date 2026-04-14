import { useState, useEffect } from 'react'
import { Users, CalendarDays, TrendingUp, Activity, Loader2, ArrowUpRight, Clock } from 'lucide-react'
import { Card, StatCard, Avatar, ProgressBar } from '../components/UI'
import { useNavigate } from 'react-router-dom'
import { getClientes, getSalas } from '../utils/api'

function hueFromName(name = '') {
  const c = ['#2DD4A8','#5B9CF6','#A78BFA','#FBBF24','#FB923C','#FB7185']
  let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) & 0xffffffff
  return c[Math.abs(h) % c.length]
}

export default function Dashboard() {
  const nav = useNavigate()
  const [clientes, setClientes] = useState([])
  const [salas, setSalas] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([getClientes().catch(() => []), getSalas().catch(() => [])])
      .then(([c, s]) => { setClientes(c); setSalas(s.filter(x => x.enabled)) })
      .finally(() => setLoading(false))
  }, [])

  const activos = clientes.filter(c => c.enabled !== false)
  const hoy = new Date().toISOString().slice(0, 10)
  const salasHoy = salas.filter(s => s.dateStart && new Date(s.dateStart).toISOString().slice(0, 10) === hoy)
    .sort((a, b) => new Date(a.dateStart) - new Date(b.dateStart))

  if (loading) return (
    <div className="flex items-center justify-center h-[60vh]">
      <Loader2 size={20} className="animate-spin" style={{ color: 'var(--green)' }} />
    </div>
  )

  return (
    <div className="space-y-10">

      {/* Greeting */}
      <div>
        <p className="text-[13px] mb-2" style={{ color: 'var(--text-3)' }}>
          {new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
        <h1 className="text-[36px] font-700" style={{ fontFamily: 'Outfit', color: 'var(--text-0)' }}>
          Bienvenido de vuelta
        </h1>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Clientes activos" value={activos.length} sub={`${clientes.length} totales`} icon={Users} color="var(--green)" />
        <StatCard label="Salas hoy" value={salasHoy.length} sub={`${salas.length} totales`} icon={CalendarDays} color="var(--blue)" />
        <StatCard label="Archivados" value={clientes.length - activos.length} icon={TrendingUp} color="var(--violet)" />
        <StatCard label="Tasa actividad" value={clientes.length ? `${Math.round((activos.length / clientes.length) * 100)}%` : '—'} icon={Activity} color="var(--amber)" />
      </div>

      {/* Main content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

        {/* Salas hoy */}
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-[15px] font-600" style={{ fontFamily: 'Outfit', color: 'var(--text-1)' }}>Salas de hoy</h2>
            <button onClick={() => nav('/clases')} className="text-[12px] font-medium flex items-center gap-1 cursor-pointer"
                    style={{ color: 'var(--green)' }}>
              Ver agenda <ArrowUpRight size={13} />
            </button>
          </div>

          {salasHoy.length === 0 ? (
            <Card className="py-16 text-center">
              <CalendarDays size={24} className="mx-auto mb-3" style={{ color: 'var(--text-3)' }} />
              <p className="text-[14px]" style={{ color: 'var(--text-2)' }}>No hay salas programadas para hoy</p>
            </Card>
          ) : (
            <div className="space-y-3">
              {salasHoy.map(s => {
                const color = hueFromName(s.nameTraining || s.name)
                const inscritos = s.users?.length ?? 0
                const hora = s.dateStart ? new Date(s.dateStart).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : ''
                return (
                  <Card key={s.id} className="p-5 cursor-pointer"
                        onClick={() => nav('/clases')}
                        style={{ transition: 'background 0.1s' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-3)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-2)'}>
                    <div className="flex items-center gap-5">
                      <div className="w-1 h-12 rounded-full flex-shrink-0" style={{ background: color }} />

                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-600 mb-1" style={{ fontFamily: 'Outfit', color: 'var(--text-0)' }}>
                          {s.name || s.nameTraining}
                        </p>
                        <div className="flex items-center gap-3 text-[12px]" style={{ color: 'var(--text-3)' }}>
                          {hora && <span className="flex items-center gap-1"><Clock size={11} />{hora}</span>}
                          {s.nameTrainer && <span>{s.nameTrainer}</span>}
                          {s.durationTraining > 0 && <span>{Math.round(s.durationTraining / 60)} min</span>}
                        </div>
                      </div>

                      <div className="flex-shrink-0 text-right w-24">
                        <p className="text-[15px] font-600 mb-1.5" style={{ fontFamily: 'Outfit', color: 'var(--text-0)' }}>
                          {inscritos} <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>/ {s.aforo || '∞'}</span>
                        </p>
                        {s.aforo > 0 && <ProgressBar value={inscritos} max={s.aforo} color={inscritos >= s.aforo ? 'var(--red)' : color} />}
                      </div>
                    </div>
                  </Card>
                )
              })}
            </div>
          )}
        </div>

        {/* Clientes */}
        <div>
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-[15px] font-600" style={{ fontFamily: 'Outfit', color: 'var(--text-1)' }}>Clientes recientes</h2>
            <button onClick={() => nav('/clientes')} className="text-[12px] font-medium flex items-center gap-1 cursor-pointer"
                    style={{ color: 'var(--blue)' }}>
              Todos <ArrowUpRight size={13} />
            </button>
          </div>

          <div className="space-y-1.5">
            {activos.slice(0, 8).map(c => (
              <div key={c.id} className="flex items-center gap-3.5 p-3 rounded-xl cursor-pointer"
                   onClick={() => nav(`/clientes/${c.id}`)}
                   style={{ transition: 'background 0.1s' }}
                   onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-2)'}
                   onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <Avatar nombre={`${c.name} ${c.surname}`} size={36} />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium truncate" style={{ color: 'var(--text-0)' }}>
                    {c.name} {c.surname}
                  </p>
                  <p className="text-[12px] truncate mt-0.5" style={{ color: 'var(--text-3)' }}>
                    {c.objective || c.email}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
