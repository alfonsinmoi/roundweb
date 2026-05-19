// Modal para crear o responder una nota
import { useEffect, useState, useMemo } from 'react'
import { Send, X } from 'lucide-react'
import Modal from '../Modal'
import { Btn } from '../UI'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../Toast'
import { crearNota, responderNota } from '../../utils/notasApi'
import { usuariosWebList } from '../../utils/authUsuarioApi'
import { getRoundIdentity } from '../../utils/configApi'

export default function NotaModal({
  open, onClose, onSaved,
  cliente,                  // { id, nombre } — necesario para crear
  parentNota = null,        // si != null → modo respuesta
}) {
  const { user } = useAuth()
  const toast = useToast()
  const identity = useMemo(() => getRoundIdentity(user), [user])
  const [contenido, setContenido] = useState('')
  const [asignadaA, setAsignadaA] = useState('')
  const [usuarios, setUsuarios] = useState([])
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    setContenido(''); setAsignadaA('')
    // cargar usuarios web del manager para el dropdown
    usuariosWebList(identity).then(d => setUsuarios((d.usuarios || []).filter(u => u.activo))).catch(() => {})
  }, [open, identity])

  const handleSave = async () => {
    if (!contenido.trim()) { toast.error('Escribe algo'); return }
    setSubmitting(true)
    try {
      if (parentNota) {
        await responderNota(user, parentNota.id, contenido.trim())
        toast.success('Respuesta enviada')
      } else {
        await crearNota(user, cliente.id, {
          contenido: contenido.trim(),
          cliente_nombre: cliente.nombre,
          asignada_a_usuario_id: asignadaA ? Number(asignadaA) : null,
        })
        toast.success(asignadaA ? 'Nota creada y asignada' : 'Nota creada')
      }
      onSaved && onSaved()
      onClose()
    } catch (e) {
      toast.error('Error: ' + (e.body?.error || e.message))
    } finally { setSubmitting(false) }
  }

  return (
    <Modal open={open} onClose={onClose} maxWidth={520}
           title={parentNota ? `Responder a ${parentNota.created_by_label || parentNota.created_by_email}` : `Nueva nota${cliente?.nombre ? ' para ' + cliente.nombre : ''}`}>
      <div style={{ padding: 24, flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {parentNota && (
          <div style={{ padding: 10, background: 'var(--bg-2)', borderRadius: 8, marginBottom: 14, fontSize: 12, color: 'var(--text-2)', fontStyle: 'italic' }}>
            "{parentNota.contenido.slice(0, 200)}{parentNota.contenido.length > 200 ? '…' : ''}"
          </div>
        )}

        <textarea value={contenido}
                  onChange={e => setContenido(e.target.value)}
                  placeholder="Escribe la nota…"
                  rows={5}
                  style={{
                    width: '100%', padding: 12, borderRadius: 10, fontSize: 14,
                    background: 'var(--bg-2)', border: '1px solid var(--line)',
                    color: 'var(--text-0)', resize: 'vertical', minHeight: 100,
                    fontFamily: 'inherit',
                  }} />

        {!parentNota && (
          <div style={{ marginTop: 14 }}>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-3)', marginBottom: 6 }}>
              Asignar a (opcional)
            </label>
            <select value={asignadaA} onChange={e => setAsignadaA(e.target.value)}
                    style={{
                      width: '100%', padding: 10, borderRadius: 10, fontSize: 13,
                      background: 'var(--bg-2)', border: '1px solid var(--line)', color: 'var(--text-0)',
                    }}>
              <option value="">— sin asignar (solo informativa) —</option>
              {usuarios.map(u => (
                <option key={u.id} value={u.id}>
                  {u.nombre} {u.apellidos || ''} ({u.email})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div style={{ padding: '16px 24px', borderTop: '1px solid var(--line)',
                     display: 'flex', gap: 10, justifyContent: 'flex-end',
                     flexShrink: 0, background: 'var(--bg-2)' }}>
        <Btn variant="secondary" onClick={onClose} disabled={submitting}>
          <X size={14} aria-hidden="true" /> Cancelar
        </Btn>
        <Btn variant="primary" onClick={handleSave} disabled={submitting || !contenido.trim()}>
          <Send size={14} aria-hidden="true" /> Enviar
        </Btn>
      </div>
    </Modal>
  )
}
