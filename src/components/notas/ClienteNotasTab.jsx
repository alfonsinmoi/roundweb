// Pestaña "Notas" del perfil del cliente
import { useEffect, useState } from 'react'
import { Plus, MessageSquare, Loader2, Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../Toast'
import { Btn, Card } from '../UI'
import NotaCard from './NotaCard'
import NotaModal from './NotaModal'
import { listarNotasCliente, archivarNota, recordatorioNota, borrarNota } from '../../utils/notasApi'

export default function ClienteNotasTab({ cliente }) {
  const { user } = useAuth()
  const toast = useToast()
  const [notas, setNotas] = useState([])
  const [loading, setLoading] = useState(true)
  const [showArchivadas, setShowArchivadas] = useState(false)
  const [creating, setCreating] = useState(false)
  const [responding, setResponding] = useState(null)

  const reload = async () => {
    setLoading(true)
    try {
      const ns = await listarNotasCliente(user, cliente.id, { limit: 200, archivadas: showArchivadas })
      setNotas(ns)
    } catch (e) { toast.error('No se pudieron cargar las notas: ' + e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { if (cliente?.id) reload() }, [cliente?.id, showArchivadas])

  const handleArchivar = async (n) => {
    try { await archivarNota(user, n.id); toast.success('Nota archivada'); reload() }
    catch (e) { toast.error('Error: ' + e.message) }
  }
  const handleRecordatorio = async (n, horas) => {
    try { await recordatorioNota(user, n.id, horas); toast.success('Recordatorio establecido'); reload() }
    catch (e) { toast.error('Error: ' + e.message) }
  }
  const handleBorrar = async (n) => {
    if (!window.confirm('¿Borrar esta nota? No se puede deshacer.')) return
    try { await borrarNota(user, n.id); toast.success('Nota borrada'); reload() }
    catch (e) { toast.error('Error: ' + e.message) }
  }

  return (
    <div role="tabpanel" aria-label="Notas del cliente">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <MessageSquare size={18} style={{ color: 'var(--green)' }} aria-hidden="true" />
          <h3 style={{ fontSize: 16, color: 'var(--text-0)', margin: 0 }}>Notas del cliente</h3>
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>({notas.length})</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn variant="secondary" size="sm" onClick={() => setShowArchivadas(s => !s)}>
            {showArchivadas ? <EyeOff size={12} aria-hidden="true" /> : <Eye size={12} aria-hidden="true" />}
            {showArchivadas ? ' Ocultar archivadas' : ' Ver archivadas'}
          </Btn>
          <Btn variant="primary" size="sm" onClick={() => setCreating(true)}>
            <Plus size={12} aria-hidden="true" /> Nueva nota
          </Btn>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-2)' }}>
          <Loader2 size={20} className="animate-spin" aria-hidden="true" />
        </div>
      ) : notas.length === 0 ? (
        <Card style={{ padding: 32, textAlign: 'center', color: 'var(--text-2)' }}>
          {showArchivadas ? 'No hay notas archivadas.' : 'Aún no hay notas. Crea la primera.'}
        </Card>
      ) : (
        <div>
          {notas.map(n => (
            <NotaCard key={n.id} nota={n}
                      onArchivar={handleArchivar}
                      onRecordatorio={handleRecordatorio}
                      onResponder={() => setResponding(n)}
                      onBorrar={handleBorrar} />
          ))}
        </div>
      )}

      <NotaModal open={creating}
                 onClose={() => setCreating(false)}
                 onSaved={reload}
                 cliente={{ id: cliente.id, nombre: `${cliente.name || cliente.nombre || ''} ${cliente.surname || cliente.apellidos || ''}`.trim() }} />

      <NotaModal open={!!responding}
                 onClose={() => setResponding(null)}
                 onSaved={reload}
                 parentNota={responding}
                 cliente={{ id: cliente.id, nombre: `${cliente.name || cliente.nombre || ''} ${cliente.surname || cliente.apellidos || ''}`.trim() }} />
    </div>
  )
}
