// Botón "Devolver" reutilizable para recibos cobrados.
// Usado en ListadoTab y (potencialmente) ClientProfile.
//
// Llama POST /api/recibos/<id>/marcar-devuelto. El backend (mayo 2026):
//   - Cancela el `account.payment` Odoo asociado (corregido el bug XML-RPC).
//   - Limpia `recibo.account_payment_id`.
//   - Marca el recibo como `impagado` (re-cobrable) por defecto, o `devuelto`
//     si el operador desmarca "reactivar para re-cobro".
//   - Incrementa `intentos_cobro` y deja traza en `notas`.
//
// Solo aplica a recibos BD (`_source='bd'`) que estén cobrados — los Odoo
// account.move facturados se devuelven por flujo distinto.
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, AlertTriangle, Undo2 } from 'lucide-react'
import { Btn } from '../UI'
import { useToast } from '../Toast'
import { useAuth } from '../../contexts/AuthContext'
import { useCan } from '../../hooks/useCan'
import { getRoundIdentity, reciboMarcarDevuelto } from '../../utils/configApi'

const MOTIVOS_FRECUENTES = [
  'Devolución bancaria SEPA',
  'IBAN incorrecto',
  'Cuenta sin fondos',
  'Cliente reclama devolución',
  'Error en cobro / duplicado',
]


export default function DevolverReciboBtn({ r, onReload, size = 'sm' }) {
  const { user } = useAuth()
  const toast = useToast()
  // Misma clave canónica que el backend (routes/recibos.py:609 — marcar_devuelto
  // y marcar_impagado comparten `economico.cuotas_mensuales.anular_pago`).
  // Antes usábamos 'recibos.marcar_devuelto' — duplicado del catálogo.
  const canDevolver = useCan('economico.cuotas_mensuales.anular_pago')
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [motivo, setMotivo] = useState(MOTIVOS_FRECUENTES[0])
  const [reactivar, setReactivar] = useState(true)

  const isBd = r._source === 'bd'

  const handleClick = () => {
    if (!isBd) {
      toast.error('Este recibo está en Odoo. La devolución se gestiona desde Facturación trimestral.')
      return
    }
    setOpen(true)
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      const resp = await reciboMarcarDevuelto(getRoundIdentity(user), r.id_bd, {
        motivo, reactivar_impagado: reactivar,
      })
      if (!resp || resp.ok === false) {
        toast.error(`Error: ${resp?.error || 'devolución falló'}`)
        setSubmitting(false)
        return
      }
      // Devolución OK. Mensaje según si había payment Odoo asociado.
      // Si pago_anulado=false significa que el recibo ya no tenía payment
      // (recibo BD sin emitir o ya cancelado) — la devolución BD es válida igualmente.
      if (resp.pago_anulado) {
        toast.success(`Devuelto · payment Odoo anulado · estado: ${resp.nuevo_estado}`)
      } else {
        toast.success(`Devuelto · estado: ${resp.nuevo_estado}`)
      }
      setOpen(false)
      onReload && onReload(resp)
    } catch (e) {
      toast.error(`Error: ${e.message}`)
    }
    setSubmitting(false)
  }

  const modalContent = open && (
    <div role="dialog" aria-modal="true"
         style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  zIndex: 10000 }}
         onClick={() => !submitting && setOpen(false)}>
      <div onClick={e => e.stopPropagation()}
           style={{ background: 'var(--bg-1)', borderRadius: 12, padding: 20,
                    maxWidth: 420, width: '90%', border: '1px solid var(--line)',
                    boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
                    color: 'var(--text-0)' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 16,
                          display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={18} style={{ color: 'var(--red)' }} />
              Devolver recibo
            </h3>

            <div style={{ padding: 10, background: 'var(--bg-2)', borderRadius: 8,
                          fontSize: 12, marginBottom: 14 }}>
              <div><strong>{r.partner_id?.name || '—'}</strong></div>
              <div style={{ color: 'var(--text-3)' }}>
                {r.cuota_codigo || ''} · {r.mes_ref || ''}
                {' · '}<strong>{Number(r.amount_total || 0).toFixed(2)} €</strong>
              </div>
            </div>

            <label style={{ display: 'block', fontSize: 11,
                            color: 'var(--text-3)', marginBottom: 4 }}>
              Motivo
            </label>
            <select value={MOTIVOS_FRECUENTES.includes(motivo) ? motivo : 'custom'}
                    onChange={e => {
                      if (e.target.value === 'custom') setMotivo('')
                      else setMotivo(e.target.value)
                    }}
                    style={selectStyle}>
              {MOTIVOS_FRECUENTES.map(m => <option key={m} value={m}>{m}</option>)}
              <option value="custom">Otro (escribir)…</option>
            </select>
            {!MOTIVOS_FRECUENTES.includes(motivo) && (
              <input type="text" value={motivo}
                     onChange={e => setMotivo(e.target.value)}
                     placeholder="Escribe el motivo…"
                     style={selectStyle} />
            )}

            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8,
                            fontSize: 12, color: 'var(--text-2)', marginBottom: 14,
                            cursor: 'pointer', padding: 10,
                            background: 'var(--bg-2)', borderRadius: 8 }}>
              <input type="checkbox" checked={reactivar}
                     onChange={e => setReactivar(e.target.checked)}
                     style={{ marginTop: 2 }} />
              <span>
                <strong>Reactivar como impagado</strong> (re-cobrable).
                <span style={{ display: 'block', fontSize: 11, color: 'var(--text-3)',
                                marginTop: 3 }}>
                  Desmarca para dejar el recibo en estado <code>devuelto</code> final.
                </span>
              </span>
            </label>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Btn variant="secondary" onClick={() => setOpen(false)} disabled={submitting}>
                Cancelar
              </Btn>
              <Btn variant="danger" onClick={handleSubmit}
                   disabled={submitting || !motivo.trim()}>
                {submitting ? <Loader2 size={13} className="animate-spin" /> : <Undo2 size={13} />}
                {' '}Confirmar devolución
              </Btn>
            </div>
          </div>
    </div>
  )

  if (!canDevolver) return null
  return (
    <>
      <Btn variant="ghost" size={size} onClick={handleClick}
           title="Marcar como devuelto y cancelar payment Odoo"
           style={{ color: 'var(--red)' }}>
        <Undo2 size={11} /> Devolver
      </Btn>
      {/* Render via Portal en document.body para evitar problemas de
          stacking context con la tabla scrolleable que lo contiene. */}
      {modalContent && createPortal(modalContent, document.body)}
    </>
  )
}

const selectStyle = {
  width: '100%', padding: 8, borderRadius: 8, marginBottom: 12,
  background: 'var(--bg-2)', border: '1px solid var(--line)',
  color: 'var(--text-0)', fontSize: 13,
}
