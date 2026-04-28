import { useState, useEffect, useMemo } from 'react'
import { Users, Dumbbell, Activity, Loader2, CalendarDays, ChevronDown } from 'lucide-react'
import { Card, Badge, Table, SectionTitle, Avatar } from '../components/UI'
import { useToast } from '../components/Toast'
import { getClientes, getEjercicios, getActividades, getEntrenadores, getSalasByRange } from '../utils/api'
import { tipoLabel, tipoColor } from '../utils/colors'

function toLocalDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const reports = [
  { id: 'clientes-activos',  label: 'Clientes activos',     icon: Users },
  { id: 'clientes-todos',    label: 'Todos los clientes',    icon: Users },
  { id: 'ejercicios',        label: 'Ejercicios',            icon: Dumbbell },
  { id: 'actividades',       label: 'Actividades',           icon: Activity },
  { id: 'clases-actividad',  label: 'Clases por actividad',  icon: CalendarDays },
]

export default function Listados() {
  const toast = useToast()
  const [reporte, setReporte] = useState('clientes-activos')
  const [data, setData] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const until = new Date(today); until.setDate(today.getDate() + 56)

    Promise.all([
      getClientes(),
      getEjercicios(),
      getActividades(),
      getEntrenadores(),
      getSalasByRange(today, until),
    ])
      .then(([clientes, ejercicios, actividades, entrenadores, salas]) => {
        setData({ clientes, ejercicios, actividades, entrenadores, salas })
      })
      .catch(() => toast.error('Error cargando datos de listados'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="flex items-center justify-center py-24" role="status" aria-label="Cargando listados">
      <Loader2 size={24} className="animate-spin" style={{ color: 'var(--green)' }} aria-hidden="true" />
    </div>
  )

  return (
    <div className="max-w-6xl space-y-5">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }} role="group" aria-label="Tipo de listado">
        {reports.map(r => {
          const Icon = r.icon
          const active = reporte === r.id
          return (
            <button key={r.id} onClick={() => setReporte(r.id)}
                    aria-pressed={active}
                    style={{
                      padding: '18px 16px', borderRadius: 16, cursor: 'pointer', textAlign: 'left',
                      transition: 'all 0.1s',
                      background: active ? 'rgba(45,212,168,0.1)' : 'var(--bg-2)',
                      border: `1px solid ${active ? 'rgba(45,212,168,0.4)' : 'var(--line)'}`,
                    }}>
              <Icon size={18} style={{ color: active ? 'var(--green)' : 'var(--text-3)', marginBottom: 8, display: 'block' }} aria-hidden="true" />
              <p style={{ fontSize: 12, fontWeight: 500, color: active ? 'var(--text-1)' : 'var(--text-2)' }}>
                {r.label}
              </p>
            </button>
          )
        })}
      </div>

      {reporte === 'clientes-activos' && (
        <ListadoClientes data={(data.clientes ?? []).filter(c => c.enabled !== false)} titulo="Clientes activos" />
      )}
      {reporte === 'clientes-todos' && (
        <ListadoClientes data={data.clientes ?? []} titulo="Todos los clientes" />
      )}
      {reporte === 'ejercicios' && (
        <ListadoEjercicios data={(data.ejercicios ?? []).filter(e => e.enabled)} />
      )}
      {reporte === 'actividades' && (
        <ListadoActividades data={data.actividades ?? []} />
      )}
      {reporte === 'clases-actividad' && (
        <ListadoClasesPorActividad salas={data.salas ?? []} actividades={data.actividades ?? []} />
      )}
    </div>
  )
}

// ── Clases por actividad ────────────────────────────────────────────────────

function ListadoClasesPorActividad({ salas, actividades }) {
  const [filtroAct, setFiltroAct] = useState('todas')

  // Lookup map: actividadById[id] → actividad
  const actividadById = useMemo(() => {
    const map = {}
    actividades.forEach(a => { map[a.id] = a })
    return map
  }, [actividades])

  // Group salas by idActividad
  const grupos = useMemo(() => {
    const map = {}
    const sinActividad = []

    salas.forEach(s => {
      if (s.idActividad != null) {
        if (!map[s.idActividad]) map[s.idActividad] = []
        map[s.idActividad].push(s)
      } else {
        sinActividad.push(s)
      }
    })

    const result = Object.entries(map).map(([idAct, clases]) => {
      const act = actividadById[idAct]
      const nombre = act ? (act.Nombre ?? act.nombre ?? `Actividad #${idAct}`) : `Actividad #${idAct}`
      return {
        id: idAct,
        nombre,
        clases: clases.sort((a, b) => new Date(a.dateStart) - new Date(b.dateStart)),
      }
    }).sort((a, b) => a.nombre.localeCompare(b.nombre))

    if (sinActividad.length > 0) {
      result.push({
        id: '__sin__',
        nombre: 'Sin actividad asignada',
        clases: sinActividad.sort((a, b) => new Date(a.dateStart) - new Date(b.dateStart)),
      })
    }

    return result
  }, [salas, actividadById])

  const gruposFiltrados = filtroAct === 'todas' ? grupos : grupos.filter(g => g.id === filtroAct)

  const totalClases = gruposFiltrados.reduce((acc, g) => acc + g.clases.length, 0)

  const inputStyle = {
    padding: '10px 14px', borderRadius: 12, fontSize: 13, cursor: 'pointer',
    background: 'var(--bg-2)', border: '1px solid var(--line)', color: 'var(--text-1)',
    fontFamily: 'inherit',
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <p style={{ fontSize: 13, color: 'var(--text-3)' }}>
          <strong style={{ color: 'var(--text-1)' }}>{gruposFiltrados.length}</strong> actividad{gruposFiltrados.length !== 1 ? 'es' : ''}{' · '}
          <strong style={{ color: 'var(--text-1)' }}>{totalClases}</strong> clase{totalClases !== 1 ? 's' : ''}
        </p>
        <select value={filtroAct} onChange={e => setFiltroAct(e.target.value)} style={inputStyle}>
          <option value="todas">Todas las actividades</option>
          {grupos.map(g => (
            <option key={g.id} value={g.id}>{g.nombre} ({g.clases.length})</option>
          ))}
        </select>
      </div>

      {grupos.length === 0 && (
        <Card style={{ padding: 48, textAlign: 'center' }}>
          <p style={{ fontSize: 14, color: 'var(--text-3)' }}>No hay clases en las próximas 8 semanas</p>
        </Card>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {gruposFiltrados.map(grupo => (
          <Card key={grupo.id} style={{ overflow: 'hidden' }}>
            {/* Group header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '16px 24px', borderBottom: '1px solid var(--line)',
              background: grupo.id === '__sin__' ? 'var(--bg-3)' : 'var(--bg-2)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Activity size={15} style={{ color: grupo.id === '__sin__' ? 'var(--text-3)' : 'var(--green)' }} aria-hidden="true" />
                <span style={{ fontFamily: 'Outfit', fontSize: 15, fontWeight: 700, color: 'var(--text-0)' }}>
                  {grupo.nombre}
                </span>
              </div>
              <span style={{
                fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 8,
                background: 'var(--bg-3)', color: 'var(--text-3)', border: '1px solid var(--line)',
              }}>
                {grupo.clases.length} clase{grupo.clases.length !== 1 ? 's' : ''}
              </span>
            </div>

            {/* Table */}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--line)' }}>
                    {['Clase', 'Fecha', 'Hora', 'Monitor', 'Aforo', 'Duración'].map(col => (
                      <th key={col} style={{
                        padding: '10px 20px', textAlign: 'left',
                        fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
                        letterSpacing: '0.06em', color: 'var(--text-3)',
                        background: 'var(--bg-1)',
                      }}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grupo.clases.map((s, i) => {
                    const d = new Date(s.dateStart)
                    const inscritos = s.users?.length ?? 0
                    const lleno = s.aforo && inscritos >= s.aforo
                    return (
                      <tr key={s.id} style={{
                        borderBottom: i < grupo.clases.length - 1 ? '1px solid var(--line)' : 'none',
                        background: i % 2 === 0 ? 'transparent' : 'var(--bg-1)',
                      }}>
                        <td style={{ padding: '12px 20px', fontWeight: 600, color: 'var(--text-0)' }}>
                          {s.name || s.nameTraining || '—'}
                        </td>
                        <td style={{ padding: '12px 20px', color: 'var(--text-2)' }}>
                          {d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })}
                        </td>
                        <td style={{ padding: '12px 20px', color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>
                          {d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td style={{ padding: '12px 20px', color: 'var(--text-2)' }}>
                          {s.nameTrainer || '—'}
                        </td>
                        <td style={{ padding: '12px 20px' }}>
                          <span style={{ color: lleno ? 'var(--red)' : 'var(--text-2)', fontWeight: lleno ? 600 : 400 }}>
                            {inscritos}/{s.aforo || '∞'}
                          </span>
                        </td>
                        <td style={{ padding: '12px 20px', color: 'var(--text-3)' }}>
                          {s.durationTraining ? `${Math.round(s.durationTraining / 60)} min` : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}

// ── Existing report components ──────────────────────────────────────────────

function ListadoClientes({ data, titulo }) {
  const fullName = c => `${c.nombre || c.name || ''} ${c.apellidos || c.surname || ''}`.trim()
  return (
    <Card style={{ padding: 28 }}>
      <div className="flex items-center justify-between mb-4">
        <SectionTitle>{titulo} ({data.length})</SectionTitle>
      </div>
      <Table
        ariaLabel={titulo}
        columns={[
          { key: 'name', label: 'Nombre', render: (v, row) => (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Avatar nombre={fullName(row)} size={28} imgUrl={row.imgUrl} />
              <span>{fullName(row)}</span>
            </div>
          ) },
          { key: 'email', label: 'Email' },
          { key: 'cellPhone', label: 'Teléfono', render: v => v || '—' },
          { key: 'objective', label: 'Objetivo', render: v => <span className="truncate max-w-40 block">{v || '—'}</span> },
          { key: 'enabled', label: 'Estado', render: v => <Badge color={v !== false ? 'green' : 'gray'}>{v !== false ? 'Activo' : 'Archivado'}</Badge> },
          { key: 'numTrainings', label: 'Entrenam.', render: v => v != null ? <Badge color="blue">{v}</Badge> : '—' },
        ]}
        data={data}
      />
    </Card>
  )
}

function ListadoEjercicios({ data }) {
  return (
    <Card style={{ padding: 28 }}>
      <div className="flex items-center justify-between mb-4">
        <SectionTitle>Ejercicios ({data.length})</SectionTitle>
      </div>
      <Table
        ariaLabel="Ejercicios"
        columns={[
          { key: 'nombre', label: 'Nombre' },
          { key: 'tipoEj', label: 'Tipo', render: v => <Badge color={tipoColor[v] ?? 'gray'}>{tipoLabel[v] ?? `Tipo ${v}`}</Badge> },
          { key: 'idZonaCorporal', label: 'Zona corp.', render: v => v != null ? `#${v}` : '—' },
          { key: 'idTipoMaterial', label: 'Material', render: v => v != null ? `#${v}` : '—' },
          { key: 'favorito', label: 'Favorito', render: v => v ? '★' : '—' },
        ]}
        data={data}
      />
    </Card>
  )
}

function ListadoActividades({ data }) {
  return (
    <Card style={{ padding: 28 }}>
      <div className="flex items-center justify-between mb-4">
        <SectionTitle>Actividades ({data.length})</SectionTitle>
      </div>
      <Table
        ariaLabel="Actividades"
        columns={[
          { key: 'Nombre', label: 'Nombre', render: (v, row) => v ?? row.nombre ?? '—' },
          { key: 'numMaxReservas', label: 'Aforo', render: v => v != null ? v : '—' },
          { key: 'tiempoAntelacionReserva', label: 'Antelación (h)', render: v => v != null ? v : '—' },
          { key: 'listaEspera', label: 'Lista espera', render: v => v ? <Badge color="yellow">Sí</Badge> : <Badge color="gray">No</Badge> },
          { key: 'enabled', label: 'Estado', render: v => <Badge color={v !== false ? 'green' : 'gray'}>{v !== false ? 'Activa' : 'Inactiva'}</Badge> },
        ]}
        data={data}
      />
    </Card>
  )
}
