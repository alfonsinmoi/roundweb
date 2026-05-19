// Banner que aparece arriba cuando el usuario_web tiene notas asignadas pendientes
import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, X, Reply, Archive, BellOff, ChevronDown, ChevronUp } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../Toast'
import NotaCard from './NotaCard'
import NotaModal from './NotaModal'
import { misNotasBanner, archivarNota, recordatorioNota } from '../../utils/notasApi'

const REFRESH_MS = 60 * 1000  // refresca cada minuto

export default function NotasBanner() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const [notas, setNotas] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [responding, setResponding] = useState(null)

  const reload = useCallback(async () => {
    if (user?.kind !== 'usuario_web') { setNotas([]); setLoaded(true); return }
    try {
      const ns = await misNotasBanner(user)
      setNotas(ns)
    } catch { /* token caducado o auth fallida — ignoramos */ }
    finally { setLoaded(true) }
  }, [user])

  useEffect(() => {
    reload()
    const t = setInterval(reload, REFRESH_MS)
    return () => clearInterval(t)
  }, [reload])

  const handleArchivar = async (n) => {
    try { await archivarNota(user, n.id); setNotas(ns => ns.filter(x => x.id !== n.id)); toast.success('Archivada') }
    catch (e) { toast.error('Error: ' + e.message) }
  }
  const handleRecordatorio = async (n, horas) => {
    try { await recordatorioNota(user, n.id, horas); setNotas(ns => ns.filter(x => x.id !== n.id)); toast.success(`Recordar en ${horas}h`) }
    catch (e) { toast.error('Error: ' + e.message) }
  }
  const handleResponder = (n) => setResponding(n)

  if (!loaded || !notas.length) return null

  return (
    <>
      <div role="region" aria-label="Notas pendientes"
           style={{
             padding: '10px 16px', background: 'var(--amber-bg)',
             borderBottom: '1px solid var(--amber-border)',
             display: 'flex', flexDirection: 'column', gap: 0,
           }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Bell size={16} style={{ color: 'var(--amber)' }} aria-hidden="true" />
          <strong style={{ fontSize: 13, color: 'var(--text-0)' }}>
            Tienes {notas.length} {notas.length === 1 ? 'nota pendiente' : 'notas pendientes'}
          </strong>
          <button type="button" onClick={() => setCollapsed(c => !c)}
                  aria-label={collapsed ? 'Expandir notas' : 'Contraer notas'}
                  style={{ marginLeft: 'auto', background: 'none', border: 'none',
                           color: 'var(--text-2)', cursor: 'pointer', padding: 4 }}>
            {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
          <button type="button" onClick={() => navigate('/notas')}
                  style={{ fontSize: 11, color: 'var(--text-2)', background: 'none',
                           border: '1px solid var(--line)', borderRadius: 8,
                           padding: '4px 8px', cursor: 'pointer' }}>
            Ver todas
          </button>
        </div>

        {!collapsed && (
          <div style={{ marginTop: 12, display: 'grid', gap: 8, maxHeight: 320, overflowY: 'auto' }}>
            {notas.map(n => (
              <NotaCard key={n.id} nota={n} compact={true}
                        onResponder={handleResponder}
                        onArchivar={handleArchivar}
                        onRecordatorio={handleRecordatorio} />
            ))}
          </div>
        )}
      </div>

      <NotaModal open={!!responding}
                 onClose={() => setResponding(null)}
                 onSaved={() => { setResponding(null); reload() }}
                 parentNota={responding}
                 cliente={responding ? { id: responding.cliente_idnoofit, nombre: responding.cliente_nombre } : null} />
    </>
  )
}
