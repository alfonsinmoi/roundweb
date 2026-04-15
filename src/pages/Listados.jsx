import { useState, useEffect } from 'react'
import { Users, Dumbbell, Activity, Loader2 } from 'lucide-react'
import { Card, Badge, Table, SectionTitle } from '../components/UI'
import { useToast } from '../components/Toast'
import { getClientes, getEjercicios, getActividades, getEntrenadores } from '../utils/api'
import { tipoLabel, tipoColor } from '../utils/colors'

const reports = [
  { id: 'clientes-activos',  label: 'Clientes activos',   icon: Users },
  { id: 'clientes-todos',    label: 'Todos los clientes',  icon: Users },
  { id: 'ejercicios',        label: 'Ejercicios',          icon: Dumbbell },
  { id: 'actividades',       label: 'Actividades',         icon: Activity },
]

export default function Listados() {
  const toast = useToast()
  const [reporte, setReporte] = useState('clientes-activos')
  const [data, setData] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      getClientes(),
      getEjercicios(),
      getActividades(),
      getEntrenadores(),
    ])
      .then(([clientes, ejercicios, actividades, entrenadores]) => {
        setData({ clientes, ejercicios, actividades, entrenadores })
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
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" role="group" aria-label="Tipo de listado">
        {reports.map(r => {
          const Icon = r.icon
          return (
            <button key={r.id} onClick={() => setReporte(r.id)}
                    aria-pressed={reporte === r.id}
                    style={{
                      padding: 24, borderRadius: 16, cursor: 'pointer', textAlign: 'left',
                      transition: 'all 0.1s',
                      background: reporte === r.id ? 'rgba(45,212,168,0.1)' : 'var(--bg-2)',
                      border: `1px solid ${reporte === r.id ? 'rgba(45,212,168,0.4)' : 'var(--line)'}`,
                    }}>
              <Icon size={20} className="mb-2" aria-hidden="true"
                    style={{ color: reporte === r.id ? 'var(--green)' : 'var(--text-3)' }} />
              <p className="text-xs font-medium" style={{ color: reporte === r.id ? 'var(--text-1)' : 'var(--text-2)' }}>
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
    </div>
  )
}

function ListadoClientes({ data, titulo }) {
  return (
    <Card style={{ padding: 28 }}>
      <div className="flex items-center justify-between mb-4">
        <SectionTitle>{titulo} ({data.length})</SectionTitle>
      </div>
      <Table
        ariaLabel={titulo}
        columns={[
          { key: 'name', label: 'Nombre', render: (v, row) => `${v} ${row.surname}` },
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
