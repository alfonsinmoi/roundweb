// Botón "Corregir forma de pago" — SOLO admin, para recibos YA cobrados/
// facturados cuyo método de pago se registró por error.
//
// Corrige únicamente `metodo_pago` (no toca importes ni el pago/journal de
// Odoo: el cobro ya ocurrió; esto corrige el dato Round para informes/SEPA).
// Requiere motivo. Backend: PATCH /api/recibos/<id> { metodo_pago, motivo }
// con la excepción admin de `update_recibo`.
//
// Solo recibos BD (`_source='bd'`). Visible solo a admin (usuario_web is_admin
// o manager NoofitPro).
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Save, CreditCard } from 'lucide-react'
import { Btn } from '../UI'
import { useToast } from '../Toast'
import { useAuth } from '../../contexts/AuthContext'
import { getRoundIdentity, reciboUpdate } from '../../utils/configApi'

const METODOS = [
  { id: 'sepa',             label: 'SEPA' },
  { id: 'tarjeta_tok',      label: 'Tarjeta tokenizada' },
  { id: 'caja_efectivo',    label: 'Efectivo / caja' },
  { id: 'caja_tpv_fisico',  label: 'TPV físico (caja)' },
  { id: 'caja_tpv_virtual', label: 'TPV virtual' },
  { id: 'enlace_pago',      label: 'Enlace de pago' },
]
const LABELS = Object.fromEntries(METODOS.map(m => [m.id, m.label]))

export default function CorregirFormaPagoBtn({ r, onReload, size = 'sm' }) {
  const { user } = useAuth()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const actual = r.forma_pago || r.metodo_pago || ''
  const [metodo, setMetodo] = useState(actual || 'caja_efectivo')
  const [motivo, setMotivo] = useState('')

  // Solo admin: usuario_web con perfil is_admin, o manager NoofitPro (no usuario_web).
  const isAdmin = user?.kind !== 'usuario_web' || !!user?.perfil?.is_admin
  const isBd = r._source === 'bd'
  if (!isAdmin || !isBd) return null

  const abrir = () => { setMetodo(actual || 'caja_efectivo'); setMotivo(''); setOpen(true) }

  const submit = async () => {
    if (!motivo.trim()) { toast.error('Indica el motivo de la corrección'); return }
    if (metodo === actual) { toast.error('Selecciona una forma de pago distinta'); return }
    setSaving(true)
    try {
      await reciboUpdate(getRoundIdentity(user), r.id_bd, { metodo_pago: metodo, motivo: motivo.trim() })
      toast.success(`Forma de pago corregida: ${LABELS[actual] || actual} → ${LABELS[metodo] || metodo}`)
      setOpen(false)
      onReload?.()
    } catch (e) {
      const detail = e.body?.error
      if (detail === 'motivo_requerido') toast.error('El motivo es obligatorio')
      else if (detail === 'metodo_pago_invalid') toast.error('Forma de pago no válida')
      else toast.error(`Error: ${e.message}`)
    }
    setSaving(false)
  }

  const modal = open && (
    <div role="dialog" aria-modal="true" onClick={() => !saving && setOpen(false)}
         style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 }}>
      <div onClick={e => e.stopPropagation()}
           style={{ background: 'var(--bg-1)', borderRadius: 12, padding: 20,
                    maxWidth: 400, width: '92%', border: '1px solid var(--line)',
                    boxShadow: '0 12px 40px rgba(0,0,0,0.35)', color: 'var(--text-0)' }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>Corregir forma de pago</h3>
        <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 14px' }}>
          Recibo cobrado #{r.id_bd}. Corrige solo la forma de pago registrada por error.
          No modifica importes ni el pago en Odoo.
        </p>
        <div style={{ padding: 8, background: 'var(--bg-2)', borderRadius: 8, fontSize: 12, marginBottom: 12 }}>
          Actual: <strong>{LABELS[actual] || actual || '—'}</strong>
        </div>
        <label style={lbl}>Nueva forma de pago</label>
        <select value={metodo} onChange={e => setMetodo(e.target.value)} style={inp}>
          {METODOS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <label style={lbl}>Motivo de la corrección *</label>
        <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={3}
                  placeholder="Ej: se registró como efectivo pero el cobro fue por SEPA"
                  style={{ ...inp, resize: 'vertical' }} />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <Btn variant="secondary" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Btn>
          <Btn variant="primary" onClick={submit} disabled={saving || !motivo.trim() || metodo === actual}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Corregir
          </Btn>
        </div>
      </div>
    </div>
  )

  return (
    <>
      <Btn variant="ghost" size={size} onClick={abrir} title="Corregir forma de pago (admin)">
        <CreditCard size={11} /> Forma de pago
      </Btn>
      {modal && createPortal(modal, document.body)}
    </>
  )
}

const lbl = { display: 'block', fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }
const inp = { width: '100%', padding: 8, borderRadius: 8, marginBottom: 12, fontSize: 13,
              background: 'var(--bg-2)', border: '1px solid var(--line)', color: 'var(--text-0)' }
