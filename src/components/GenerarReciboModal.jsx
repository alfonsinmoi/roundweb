// Modal para emitir un recibo manual a un cliente.
//
// Uso típico: el operador necesita generar un recibo puntual (cobro extra,
// recibo retroactivo, cobro en efectivo de día puntual, etc.) sin esperar
// al cron mensual ni al wizard de pre-emisión.
//
// Pre-rellena cuota/importe/periodicidad si el cliente tiene una suscripción
// activa. Todo es editable. Llama POST /api/recibos.

import { useState, useEffect, useMemo } from 'react'
import { Loader2, Check, Receipt } from 'lucide-react'
import Modal from './Modal'
import { Btn } from './UI'
import { useToast } from './Toast'
import { useAuth } from '../contexts/AuthContext'
import {
  listSubsByCliente, cuotasCatalogo, getRoundIdentity,
} from '../utils/subscriptionsApi'
import { reciboCreate } from '../utils/configApi'

const METODOS = [
  { id: 'sepa',             label: 'SEPA (pagado al emitir)' },
  { id: 'tarjeta_tok',      label: 'Tarjeta tokenizada (pagado)' },
  { id: 'caja_efectivo',    label: 'Efectivo / caja' },
  { id: 'caja_tpv_fisico',  label: 'TPV físico (caja)' },
  { id: 'caja_tpv_virtual', label: 'TPV virtual' },
  { id: 'enlace_pago',      label: 'Enlace de pago' },
]
const PERIODICIDADES = [
  { id: 'mensual',    label: 'Mensual',    meses: 1 },
  { id: 'bimensual',  label: 'Bimensual',  meses: 2 },
  { id: 'trimestral', label: 'Trimestral', meses: 3 },
  { id: 'semestral',  label: 'Semestral',  meses: 6 },
  { id: 'anual',      label: 'Anual',      meses: 12 },
  { id: 'puntual',    label: 'Puntual (no recurrente)', meses: 0 },
]

// Calcula la fecha hasta la que cubre el pago a partir de la fecha de
// emisión + meses de la periodicidad. Convención: el pago cubre desde
// emisión hasta el día anterior al siguiente vencimiento (inclusive).
// puntual (meses=0) → cubre solo el día de emisión.
function calcFechaCubiertoHasta(fechaEmisionISO, periodicidad) {
  if (!fechaEmisionISO) return ''
  const p = PERIODICIDADES.find(x => x.id === periodicidad)
  const meses = p?.meses ?? 1
  const d = new Date(fechaEmisionISO + 'T00:00:00')
  if (isNaN(d)) return ''
  if (meses === 0) return fechaEmisionISO  // puntual → mismo día
  d.setMonth(d.getMonth() + meses)
  d.setDate(d.getDate() - 1)  // día anterior al siguiente vencimiento
  return d.toISOString().slice(0, 10)
}

const inputStyle = {
  width: '100%', padding: 10, borderRadius: 10, fontSize: 13,
  background: 'var(--bg-2)', border: '1px solid var(--line)', color: 'var(--text-0)',
}

function Field({ label, children, hint }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 12, color: 'var(--text-3)', marginBottom: 4 }}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>{hint}</div>}
    </div>
  )
}


export default function GenerarReciboModal({ cliente, onClose, onSaved }) {
  const { user } = useAuth()
  const identity = useMemo(() => getRoundIdentity(user), [user])
  const toast = useToast()

  const [cuotas, setCuotas] = useState([])
  const [subActiva, setSubActiva] = useState(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  // Form
  const today = new Date().toISOString().slice(0, 10)
  const periodoActual = today.slice(0, 7)  // YYYY-MM
  const [cuotaId, setCuotaId] = useState('')
  const [periodicidad, setPeriodicidad] = useState('mensual')
  const [importe, setImporte] = useState('')
  const [ivaPct, setIvaPct] = useState(21)
  const [metodoPago, setMetodoPago] = useState('caja_efectivo')
  const [fechaEmision, setFechaEmision] = useState(today)
  const [periodo, setPeriodo] = useState(periodoActual)
  const [fechaCubiertoHasta, setFechaCubiertoHasta] = useState(
    calcFechaCubiertoHasta(today, 'mensual'))
  // Marca de "el usuario editó la fecha manualmente" — si edita, dejamos de
  // auto-recalcular. Si vuelve a cambiar emisión/periodicidad después de
  // editar, sí recalculamos (volvemos al modo auto).
  const [fechaCubiertoEditada, setFechaCubiertoEditada] = useState(false)
  const [notas, setNotas] = useState('')

  useEffect(() => {
    (async () => {
      setLoading(true)
      try {
        const [s, c] = await Promise.all([
          listSubsByCliente(identity, cliente.id).catch(() => ({ subs: [] })),
          cuotasCatalogo(identity, cliente.idTrainer ?? cliente.id_trainer ?? null).catch(() => []),
        ])
        setCuotas(c)
        const activa = (s.subs || []).find(x => x.estado === 'activa')
        if (activa) {
          setSubActiva(activa)
          setCuotaId(String(activa.cuota_id?.id || ''))
          setPeriodicidad(activa.periodicidad || 'mensual')
          // Forma de pago de la sub → método del recibo (aproximación)
          if (activa.forma_pago === 'sepa') setMetodoPago('sepa')
          else if (activa.forma_pago === 'tarjeta_token') setMetodoPago('tarjeta_tok')
          else if (activa.forma_pago === 'efectivo') setMetodoPago('caja_efectivo')
          else if (activa.forma_pago === 'enlace_pago') setMetodoPago('enlace_pago')
          // Importe desde la cuota
          const cuotaObj = c.find(x => x.id === activa.cuota_id?.id)
          if (cuotaObj) {
            const precio = cuotaObj[`precio_${activa.periodicidad || 'mensual'}`]
            if (precio) setImporte(String(precio))
          }
        }
      } catch (e) {
        toast.error(`Error cargando datos del cliente: ${e.message}`)
      } finally { setLoading(false) }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cliente?.id])

  // Recalcular importe al cambiar cuota o periodicidad
  useEffect(() => {
    if (!cuotaId) return
    const c = cuotas.find(x => x.id === Number(cuotaId))
    if (!c) return
    const precio = c[`precio_${periodicidad}`]
    if (precio != null) setImporte(String(precio))
  }, [cuotaId, periodicidad, cuotas])

  // Auto-calcular fecha cubierto hasta al cambiar emisión o periodicidad,
  // a menos que el usuario haya editado manualmente la fecha.
  useEffect(() => {
    if (fechaCubiertoEditada) return
    setFechaCubiertoHasta(calcFechaCubiertoHasta(fechaEmision, periodicidad))
  }, [fechaEmision, periodicidad, fechaCubiertoEditada])

  const cuotaSel = cuotas.find(c => c.id === Number(cuotaId))

  const handleSubmit = async () => {
    if (!importe || Number(importe) <= 0) {
      toast.error('Importe debe ser mayor que 0'); return
    }
    if (!metodoPago) { toast.error('Selecciona método de pago'); return }

    setSubmitting(true)
    try {
      const importeTotal = Number(importe)
      const iva = Number(ivaPct) || 0
      const importeBase = +(importeTotal / (1 + iva/100)).toFixed(2)
      const importeIva = +(importeTotal - importeBase).toFixed(2)

      const payload = {
        cliente_idnoofit: cliente.id,
        cliente_nombre: `${cliente.name || ''} ${cliente.surname || ''}`.trim(),
        cuota_id: cuotaSel?.id || null,
        cuota_codigo: cuotaSel?.codigo || null,
        cuota_descripcion: cuotaSel?.descripcion || null,
        periodo: periodo || null,
        // Rango de cobertura del pago — `fecha_desde` = emisión, `fecha_hasta`
        // = el día final que queda pagado.
        fecha_desde: fechaEmision || null,
        fecha_hasta: fechaCubiertoHasta || null,
        periodicidad,
        importe_total: importeTotal,
        importe_base: importeBase,
        importe_iva: importeIva,
        iva_pct: iva,
        metodo_pago: metodoPago,
        fecha_emision: fechaEmision,
        origen: 'manual',
        notas: notas || null,
      }
      await reciboCreate(identity, payload)
      toast.success('Recibo emitido')
      onSaved && onSaved()
      onClose && onClose()
    } catch (e) {
      toast.error(`Error al emitir recibo: ${e.message}`)
    } finally { setSubmitting(false) }
  }

  return (
    <Modal open={true} onClose={onClose} maxWidth={560}
           title={<><Receipt size={16} style={{ marginRight: 6 }} /> Generar recibo manual</>}>
      <div style={{ padding: 24, flex: 1, overflowY: 'auto', minHeight: 0 }}>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)' }}>
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : (
          <>
            <div style={{ padding: 12, borderRadius: 10, background: 'var(--bg-2)',
                          fontSize: 13, color: 'var(--text-2)', marginBottom: 16 }}>
              Recibo para <strong>{cliente.name} {cliente.surname}</strong>
              {subActiva && (
                <span style={{ display: 'block', fontSize: 12, marginTop: 4, color: 'var(--text-3)' }}>
                  Prefilled desde su suscripción activa ({subActiva.cuota_id?.name}, {subActiva.periodicidad}).
                  Puedes editar todos los campos.
                </span>
              )}
            </div>

            <Field label="Cuota (opcional)">
              <select value={cuotaId} onChange={e => setCuotaId(e.target.value)} style={inputStyle}>
                <option value="">— Recibo libre (sin cuota asociada) —</option>
                {cuotas.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.codigo} — {c.descripcion}
                  </option>
                ))}
              </select>
            </Field>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              <Field label="Periodicidad">
                <select value={periodicidad} onChange={e => setPeriodicidad(e.target.value)} style={inputStyle}>
                  {PERIODICIDADES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </Field>
              <Field label="Mes de referencia (YYYY-MM)"
                     hint="Etiqueta del mes al que se refiere el recibo (no es la fecha de cobertura).">
                <input type="text" value={periodo} onChange={e => setPeriodo(e.target.value)}
                       placeholder="2026-05" style={inputStyle} />
              </Field>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <Field label="Importe total (€) *">
                <input type="number" min="0" step="0.01" value={importe}
                       onChange={e => setImporte(e.target.value)} style={inputStyle} />
              </Field>
              <Field label="IVA %">
                <input type="number" min="0" max="100" step="1" value={ivaPct}
                       onChange={e => setIvaPct(e.target.value)} style={inputStyle} />
              </Field>
            </div>

            <Field label="Método de pago *"
                   hint="SEPA y Tarjeta tokenizada se marcan como 'pagado' al emitir. El resto quedan 'impagado' hasta que se cobren.">
              <select value={metodoPago} onChange={e => setMetodoPago(e.target.value)} style={inputStyle}>
                {METODOS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </Field>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              <Field label="Fecha emisión">
                <input type="date" value={fechaEmision}
                       onChange={e => setFechaEmision(e.target.value)}
                       style={inputStyle} />
              </Field>
              <Field label="Pagado hasta"
                     hint={fechaCubiertoEditada
                       ? 'Editada manualmente. Cambia emisión o periodicidad para recalcular.'
                       : `Auto-calculado: emisión + ${PERIODICIDADES.find(p => p.id === periodicidad)?.label?.toLowerCase() || periodicidad}.`}>
                <input type="date" value={fechaCubiertoHasta}
                       onChange={e => { setFechaCubiertoHasta(e.target.value); setFechaCubiertoEditada(true) }}
                       style={inputStyle} />
              </Field>
            </div>

            <Field label="Notas (opcional)">
              <textarea value={notas} onChange={e => setNotas(e.target.value)} rows={2}
                        placeholder="Ej. Recibo retroactivo abril por cuota no cobrada..."
                        style={{ ...inputStyle, resize: 'vertical', minHeight: 60 }} />
            </Field>
          </>
        )}
      </div>

      <div style={{ padding: '16px 24px', borderTop: '1px solid var(--line)',
                    display: 'flex', gap: 10, justifyContent: 'flex-end',
                    flexShrink: 0, background: 'var(--bg-2)' }}>
        <Btn variant="secondary" onClick={onClose} disabled={submitting}>Cancelar</Btn>
        <Btn variant="primary" onClick={handleSubmit} disabled={submitting || loading}>
          {submitting ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          {' '}Emitir recibo
        </Btn>
      </div>
    </Modal>
  )
}
