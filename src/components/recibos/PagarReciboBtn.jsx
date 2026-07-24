// Botón "Pagar" reutilizable para recibos impagados.
// Usado en:
//   - ClientProfile → TabCuotas (lista de recibos del cliente)
//   - CuotasClientes → ListadoTab (recibos emitidos global)
//
// Para recibos BD (`_source='bd'`, `id_bd` numérico) llama a
// POST /api/recibos/<id>/marcar-pagado y el backend (mayo 2026) refleja el
// cobro creando el `account.payment` Odoo correspondiente (journal `caja` o
// `bank` según método). Por eso aquí ya no hay branch especial.
//
// Para recibos Odoo (`account.move` ya facturados, sin `_source='bd'`) el
// cobro se gestiona por el wizard trimestral; mostramos mensaje informativo.
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Check } from 'lucide-react'
import { Btn } from '../UI'
import { useToast } from '../Toast'
import { useAuth } from '../../contexts/AuthContext'
import { useCan } from '../../hooks/useCan'
import { getRoundIdentity, reciboMarcarPagado, reciboMoveCobrar } from '../../utils/configApi'
import { useOverlayClose } from '../../hooks/useOverlayClose'

const METODOS = [
  { id: 'sepa',             label: 'SEPA' },
  { id: 'tarjeta_tok',      label: 'Tarjeta tokenizada' },
  { id: 'caja_efectivo',    label: 'Efectivo / caja' },
  { id: 'caja_tpv_fisico',  label: 'TPV físico (caja)' },
  { id: 'caja_tpv_virtual', label: 'TPV virtual' },
  { id: 'enlace_pago',      label: 'Enlace de pago' },
]


/**
 * @param {object} props
 * @param {object} props.r          Recibo (formato unificado BD/Odoo).
 * @param {function} props.onReload Callback tras pago exitoso.
 * @param {'sm'|'md'} [props.size]  Tamaño del botón.
 */
export default function PagarReciboBtn({ r, onReload, size = 'sm' }) {
  const { user } = useAuth()
  const toast = useToast()
  // Misma clave canónica que el backend (routes/recibos.py:386).
  // Antes (H3) usábamos 'recibos.marcar_pagado' — subtree duplicado del
  // catálogo. Resultado: el manager veía dos sitios donde activar el
  // mismo permiso, y al activar uno NO se sincronizaba con el otro.
  const canPagar = useCan('economico.cuotas_mensuales.marcar_pagado_manual')
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [metodo, setMetodo] = useState(r.forma_pago || 'caja_efectivo')
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10))
  // Junio 2026 — cobro parcial editable
  const importeEsperado = Number(r.amount_total || 0)
  const [importeCobrado, setImporteCobrado] = useState(importeEsperado.toFixed(2))
  const [observacion, setObservacion] = useState('')
  const overlayClose = useOverlayClose(() => setOpen(false), !submitting)

  const isBd = r._source === 'bd'
  // Sprint 7 audit #M9 — protección input vacío: NO tratar '' como 0
  // (eso disparaba la UI "⚠ Diferencia -X€" engañosa). Importe vacío =
  // sin diferencia, sin observación requerida, pero botón deshabilitado.
  const importeVacio = importeCobrado === '' || importeCobrado == null
  const importeNum = importeVacio ? null : Number(importeCobrado)
  const importeValido = !importeVacio && !isNaN(importeNum) && importeNum > 0
  const diff = importeValido
    ? Math.round((importeNum - importeEsperado) * 100) / 100
    : 0
  const hayDiferencia = importeValido && Math.abs(diff) > 0.01
  const observacionReq = hayDiferencia && !observacion.trim()

  const handleClick = () => {
    // Tanto recibos BD como recibos puramente Odoo (account.move) se cobran
    // desde aquí. Reset por si se abre el modal varias veces.
    setImporteCobrado(importeEsperado.toFixed(2))
    setObservacion('')
    setMetodo(r.forma_pago || 'caja_efectivo')
    setOpen(true)
  }

  const handleSubmit = async () => {
    if (isNaN(importeNum) || importeNum <= 0) {
      toast.error('Importe inválido'); return
    }
    if (observacionReq) {
      toast.error('Observación obligatoria si el importe difiere'); return
    }
    setSubmitting(true)
    try {
      // Sprint 7 audit — solo enviar observación si hay diferencia; si no,
      // sería ruido en `recibo.notas` (texto sobre un cobro íntegro).
      const payload = {
        metodo, fecha,
        importe_cobrado: importeNum,
        observacion: hayDiferencia ? (observacion.trim() || undefined) : undefined,
      }
      // Recibo BD → marcar-pagado (id_bd). Recibo puramente Odoo (sin id_bd) →
      // cobrar el account.move directamente (r.id es el id del move).
      const resp = isBd
        ? await reciboMarcarPagado(getRoundIdentity(user), r.id_bd, payload)
        : await reciboMoveCobrar(getRoundIdentity(user), r.id, payload)
      if (!resp || resp.ok === false) {
        toast.error(`Error: ${resp?.error || 'cobro falló'}`)
        setSubmitting(false)
        return
      }
      // Aviso si Odoo no se pudo actualizar (recibo BD sí está pagado pero
      // sin payment Odoo — operador deberá completarlo manualmente).
      if (resp.warning) {
        toast.error(`Pagado en BD pero ${resp.warning}`)
      } else if (hayDiferencia) {
        toast.success(`Cobrado ${importeNum.toFixed(2)}€ (${diff > 0 ? '+' : ''}${diff.toFixed(2)}€). Incidencia abierta para admin.`)
      } else {
        toast.success(`Recibo pagado · payment Odoo=${resp.account_payment_id || resp.payment_id || '—'}`)
      }
      setOpen(false)
      onReload && onReload(resp)
    } catch (e) {
      toast.error(`Error: ${e.message}`)
    }
    setSubmitting(false)
  }

  const modalContent = open && (
    <div role="dialog" aria-modal="true" {...overlayClose}
         style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  zIndex: 10000 }}>
      <div onClick={e => e.stopPropagation()}
           style={{ background: 'var(--bg-1)', borderRadius: 12, padding: 20,
                    maxWidth: 380, width: '90%', border: '1px solid var(--line)',
                    boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
                    color: 'var(--text-0)' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>Marcar como pagado</h3>
            <div style={{ padding: 10, background: 'var(--bg-2)', borderRadius: 8,
                          fontSize: 12, marginBottom: 14 }}>
              <div><strong>{r.partner_id?.name || '—'}</strong></div>
              <div style={{ color: 'var(--text-3)' }}>
                {r.cuota_codigo || ''} · {r.mes_ref || ''} · Importe esperado:{' '}
                <strong>{importeEsperado.toFixed(2)} €</strong>
              </div>
            </div>
            <label style={{ display: 'block', fontSize: 11,
                            color: 'var(--text-3)', marginBottom: 4 }}>
              Importe cobrado (€) *
            </label>
            <input type="number" step="0.01" min="0.01" value={importeCobrado}
                   onChange={e => setImporteCobrado(e.target.value)}
                   style={{ ...selectStyle, fontFamily: 'var(--font-mono)',
                            textAlign: 'right', fontSize: 16, fontWeight: 700,
                            color: hayDiferencia ? '#d97706' : 'var(--text-0)',
                            borderColor: hayDiferencia ? '#fbbf24' : 'var(--line)' }} />
            {hayDiferencia && (
              <div style={{ padding: 8, borderRadius: 6, background: '#fef3c7',
                             color: '#92400e', fontSize: 12, marginBottom: 12,
                             marginTop: -8 }}>
                ⚠ Diferencia <strong>{diff > 0 ? '+' : ''}{diff.toFixed(2)}€</strong>{' '}
                respecto al recibo. Se creará una incidencia automática para
                el admin.
              </div>
            )}
            <label style={{ display: 'block', fontSize: 11,
                            color: 'var(--text-3)', marginBottom: 4 }}>
              Método de pago
            </label>
            <select value={metodo} onChange={e => setMetodo(e.target.value)}
                    style={selectStyle}>
              {METODOS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <label style={{ display: 'block', fontSize: 11,
                            color: 'var(--text-3)', marginBottom: 4 }}>
              Fecha de cobro
            </label>
            <input type="date" value={fecha} onChange={e => setFecha(e.target.value)}
                   style={selectStyle} />
            <label style={{ display: 'block', fontSize: 11,
                            color: 'var(--text-3)', marginBottom: 4 }}>
              Observación {hayDiferencia && <span style={{ color: 'var(--red)' }}>* (obligatoria por diferencia)</span>}
            </label>
            <textarea value={observacion}
                      onChange={e => setObservacion(e.target.value)}
                      placeholder={hayDiferencia
                        ? 'Explica el motivo de la diferencia (p. ej. pago parcial, recargo, condonación...)'
                        : 'Opcional — quedará registrada en las notas del recibo'}
                      rows={2}
                      style={{ ...selectStyle, resize: 'vertical', minHeight: 50,
                               borderColor: observacionReq ? 'var(--red)' : 'var(--line)' }} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Btn variant="secondary" onClick={() => setOpen(false)} disabled={submitting}>
                Cancelar
              </Btn>
              <Btn variant="primary" onClick={handleSubmit}
                   disabled={submitting || observacionReq || !importeValido}>
                {submitting ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                {' '}Confirmar pago
              </Btn>
            </div>
          </div>
    </div>
  )

  if (!canPagar) return null
  return (
    <>
      <Btn variant="secondary" size={size} onClick={handleClick}>Pagar</Btn>
      {/* Render via Portal en document.body para que el modal se monte fuera
          del contenedor de tabla con overflow:auto (evita que quede oculto). */}
      {modalContent && createPortal(modalContent, document.body)}
    </>
  )
}

const selectStyle = {
  width: '100%', padding: 8, borderRadius: 8, marginBottom: 12,
  background: 'var(--bg-2)', border: '1px solid var(--line)',
  color: 'var(--text-0)', fontSize: 13,
}
