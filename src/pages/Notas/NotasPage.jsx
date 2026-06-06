// Página /notas — listado completo con filtros y agrupaciones
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MessageSquare, Filter, ArrowLeft, Loader2, Plus } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../components/Toast'
import { Card, Btn, Badge } from '../../components/UI'
import NotaCard from '../../components/notas/NotaCard'
import NotaModal from '../../components/notas/NotaModal'
import EnviarNotaModal from '../../components/notas/EnviarNotaModal'
import {
  misNotas, archivarNota, recordatorioNota, borrarNota, listarNotasCliente,
} from '../../utils/notasApi'

const ROLES = [
  { id: 'todas',     label: 'Todas (mías o asignadas)' },
  { id: 'asignadas', label: 'Asignadas a mí' },
  { id: 'creadas',   label: 'Creadas por mí' },
]
const ESTADOS = [
  { id: '',             label: 'Todos los estados' },
  { id: 'abierta',      label: 'Abiertas' },
  { id: 'recordatorio', label: 'Con recordatorio' },
  { id: 'contestada',   label: 'Contestadas' },
  { id: 'archivada',    label: 'Archivadas' },
]
const AGRUPACIONES = [
  { id: 'fecha',    label: 'Por fecha' },
  { id: 'cliente',  label: 'Por cliente' },
  { id: 'estado',   label: 'Por estado' },
  { id: 'creador',  label: 'Por creador' },
]

export default function NotasPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const [notas, setNotas] = useState([])
  const [loading, setLoading] = useState(true)
  const [responding, setResponding] = useState(null)

  const [rol, setRol] = useState('todas')
  const [estado, setEstado] = useState('')
  const [agrupacion, setAgrupacion] = useState('fecha')
  const [busqueda, setBusqueda] = useState('')
  const [enviarOpen, setEnviarOpen] = useState(false)

  const reload = async () => {
    setLoading(true)
    try {
      const ns = await misNotas(user, { rol, estado: estado || undefined })
      setNotas(ns)
    } catch (e) { toast.error('Error: ' + e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { reload() }, [rol, estado])

  const handleArchivar = async (n) => {
    try { await archivarNota(user, n.id); toast.success('Archivada'); reload() }
    catch (e) { toast.error('Error: ' + e.message) }
  }
  const handleRecordatorio = async (n, h) => {
    try { await recordatorioNota(user, n.id, h); toast.success('Recordatorio establecido'); reload() }
    catch (e) { toast.error('Error: ' + e.message) }
  }
  const handleBorrar = async (n) => {
    if (!window.confirm('¿Borrar esta nota?')) return
    try { await borrarNota(user, n.id); toast.success('Borrada'); reload() }
    catch (e) { toast.error('Error: ' + e.message) }
  }

  // Filtro de búsqueda en cliente (sobre lo ya traído del backend)
  const notasFiltradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return notas
    return notas.filter(n =>
      (n.contenido || '').toLowerCase().includes(q) ||
      (n.cliente_nombre || '').toLowerCase().includes(q) ||
      (n.created_by_label || '').toLowerCase().includes(q) ||
      (n.asignada_a_label || '').toLowerCase().includes(q)
    )
  }, [notas, busqueda])

  // Agrupar
  const grupos = useMemo(() => {
    const out = {}
    for (const n of notasFiltradas) {
      let key
      if (agrupacion === 'cliente') key = n.cliente_nombre || `Cliente ${n.cliente_idnoofit}`
      else if (agrupacion === 'estado') key = n.estado
      else if (agrupacion === 'creador') key = n.created_by_label || n.created_by_email || 'Sistema'
      else {
        const d = new Date(n.created_at)
        const today = new Date()
        const yesterday = new Date(); yesterday.setDate(today.getDate() - 1)
        if (d.toDateString() === today.toDateString()) key = 'Hoy'
        else if (d.toDateString() === yesterday.toDateString()) key = 'Ayer'
        else if ((today - d) / (1000 * 86400) < 7) key = 'Esta semana'
        else if ((today - d) / (1000 * 86400) < 30) key = 'Este mes'
        else key = 'Más antiguas'
      }
      if (!out[key]) out[key] = []
      out[key].push(n)
    }
    return out
  }, [notasFiltradas, agrupacion])

  return (
    <div style={{ maxWidth: 980 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <MessageSquare size={22} style={{ color: 'var(--green)' }} aria-hidden="true" />
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, color: 'var(--text-0)', margin: 0 }}>
          Notas
        </h1>
        <Badge color="gray" style={{ marginLeft: 'auto' }}>
          {notasFiltradas.length} {notasFiltradas.length === 1 ? 'nota' : 'notas'}
        </Badge>
        <Btn variant="primary" size="sm" onClick={() => setEnviarOpen(true)}
             title="Crear una nota y enviarla a trabajadores o clientes">
          <Plus size={13} /> Nueva nota
        </Btn>
      </div>

      <Card style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>Filtrar por</label>
            <select value={rol} onChange={e => setRol(e.target.value)} style={selectStyle}>
              {ROLES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>Estado</label>
            <select value={estado} onChange={e => setEstado(e.target.value)} style={selectStyle}>
              {ESTADOS.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>Agrupar</label>
            <select value={agrupacion} onChange={e => setAgrupacion(e.target.value)} style={selectStyle}>
              {AGRUPACIONES.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>Buscar</label>
            <input value={busqueda} onChange={e => setBusqueda(e.target.value)}
                   placeholder="contenido, cliente, persona…"
                   style={selectStyle} />
          </div>
        </div>
      </Card>

      {loading ? (
        <Card style={{ padding: 40, textAlign: 'center', color: 'var(--text-2)' }}>
          <Loader2 size={20} className="animate-spin" aria-hidden="true" />
        </Card>
      ) : notasFiltradas.length === 0 ? (
        <Card style={{ padding: 40, textAlign: 'center', color: 'var(--text-2)' }}>
          No hay notas con esos filtros.
        </Card>
      ) : (
        Object.entries(grupos).map(([grupo, ns]) => (
          <div key={grupo} style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-3)',
                          textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
              {grupo} <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>({ns.length})</span>
            </h3>
            {ns.map(n => (
              <NotaCard key={n.id} nota={n} showCliente={true}
                        onResponder={() => setResponding(n)}
                        onArchivar={handleArchivar}
                        onRecordatorio={handleRecordatorio}
                        onBorrar={handleBorrar} />
            ))}
          </div>
        ))
      )}

      <NotaModal open={!!responding}
                 onClose={() => setResponding(null)}
                 onSaved={() => { setResponding(null); reload() }}
                 parentNota={responding}
                 cliente={responding ? { id: responding.cliente_idnoofit, nombre: responding.cliente_nombre } : null} />

      {enviarOpen && (
        <EnviarNotaModal
          user={user}
          onClose={() => setEnviarOpen(false)}
          onSaved={() => { setEnviarOpen(false); reload() }}
        />
      )}
    </div>
  )
}

const selectStyle = {
  width: '100%', padding: 10, borderRadius: 10, fontSize: 13,
  background: 'var(--bg-2)', border: '1px solid var(--line)', color: 'var(--text-0)',
}
