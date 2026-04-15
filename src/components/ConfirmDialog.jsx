import Modal from './Modal'
import { Btn } from './UI'
import { AlertTriangle } from 'lucide-react'

/**
 * Replaces window.confirm() with an accessible modal dialog.
 */
export default function ConfirmDialog({ open, onConfirm, onCancel, title = '¿Estás seguro?', message, confirmText = 'Confirmar', variant = 'danger' }) {
  if (!open) return null

  return (
    <Modal open={open} onClose={onCancel} title={title} maxWidth={440}>
      <div style={{ padding: '28px 32px' }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <AlertTriangle size={20} style={{ color: 'var(--amber)', flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
          <p style={{ fontSize: 14, color: 'var(--text-1)', lineHeight: 1.6 }}>{message}</p>
        </div>
      </div>
      <div style={{ padding: '20px 32px', borderTop: '1px solid var(--line)', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <Btn variant="secondary" size="md" onClick={onCancel}>Cancelar</Btn>
        <Btn variant={variant} size="md" onClick={onConfirm}>{confirmText}</Btn>
      </div>
    </Modal>
  )
}
