// Sección "Recibos manuales para remesa" — dentro de Cuotas Clientes →
// Generar Recibos del Mes.
//
// Caso de uso: el operador necesita crear un recibo manual que NO sale del
// flujo automático de cuotas (regla especial, cobro retroactivo, importe
// distinto al de la cuota, etc.) y quiere que se incluya en la remesa
// mensual junto con los auto-generados.
//
// Estado del recibo: `borrador_remesa`. Es editable y borrable mientras
// esté en ese estado. Cuando se ejecuta la "Emisión" del mes, el backend
// transiciona los borradores manuales a `pagado` (si SEPA / tarjeta_tok)
// o `impagado` (resto), los marca con fecha_emision = hoy, y entonces sí
// aparecen en la ficha del cliente y en el listado de cuotas.
//
// Borradores NO aparecen en la ficha del cliente ni en el Listado general
// hasta que se emiten.
import { useEffect, useState, useMemo } from 'react'
import { useOverlayClose } from '../../hooks/useOverlayClose'
import { Loader2, Plus, Pencil, Trash2, Receipt, X } from 'lucide-react'
import { Card, Btn, SectionTitle, Badge } from '../../components/UI'
import { useToast } from '../../components/Toast'
import {
  recibosManualesMes, reciboCreate, reciboUpdate, reciboDelete,
} from '../../utils/configApi'
import { getClientes } from '../../utils/api'
import { listSubsByCliente, cuotasCatalogo } from '../../utils/subscriptionsApi'

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
  { id: 'puntual',    label: 'Puntual',    meses: 0 },
]

const inputStyle = {
  width: '100%', padding: 8, borderRadius: 8, fontSize: 13,
  background: 'var(--bg-2)', border: '1px solid var(--line)', color: 'var(--text-0)',
}

function calcFechaHasta(fechaEmision, periodicidad) {
  if (!fechaEmision) return ''
  const p = PERIODICIDADES.find(x => x.id === periodicidad)
  const meses = p?.meses ?? 1
  const d = new Date(fechaEmision + 'T00:00:00')
  if (isNaN(d)) return ''
  if (meses === 0) return fechaEmision
  d.setMonth(d.getMonth() + meses)
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}


export default function RecibosManualesSection({ identity, mes }) {
  const toast = useToast()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(null)   // null = no modal; {} = nuevo; {...} = edit

  const reload = async () => {
    if (!mes) return
    setLoading(true)
    try {
      const rows = await recibosManualesMes(identity, mes)
      setItems(rows)
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setLoading(false)
  }
  useEffect(() => { reload() }, [mes, identity?.managerId, identity?.trainerId])

  const onBorrar = async (r) => {
    if (!confirm(`¿Borrar el recibo manual de ${r.cliente_nombre || r.cliente_idnoofit}?`)) return
    try {
      await reciboDelete(identity, r.id)
      toast.success('Borrado')
      reload()
    } catch (e) { toast.error(`Error: ${e.message}`) }
  }

  const total = items.reduce((s, r) => s + Number(r.importe_total || 0), 0)

  return (
    <Card style={{ padding: 20, marginBottom: 16, border: '2px dashed var(--amber)' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <SectionTitle>
          <Receipt size={16} style={{ marginRight: 8, color: 'var(--amber)' }} />
          Recibos manuales para esta remesa
          <Badge color="amber" style={{ marginLeft: 8 }}>
            {items.length} pendiente{items.length === 1 ? '' : 's'}
          </Badge>
        </SectionTitle>
        <div style={{ flex: 1 }} />
        <Btn variant="primary" size="sm" onClick={() => setEditing({})} disabled={!mes}>
          <Plus size={14} /> Nuevo recibo manual
        </Btn>
      </div>

      <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 12 }}>
        Crea recibos que no cumplen las reglas de emisión automática (importe
        distinto al de la cuota, cobro retroactivo, etc.). Aparecerán junto a
        los auto-generados cuando emitas la remesa. Mientras estén aquí
        puedes editarlos o borrarlos.
      </p>

      {loading ? (
        <div style={{ padding: 20, textAlign: 'center' }}>
          <Loader2 size={18} className="animate-spin" style={{ color: 'var(--amber)' }} />
        </div>
      ) : items.length === 0 ? (
        <div style={{ padding: 16, textAlign: 'center', fontSize: 13, color: 'var(--text-3)' }}>
          No hay recibos manuales pendientes para {mes}.
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--bg-2)' }}>
              <th style={th}>Cliente</th>
              <th style={th}>Cuota / concepto</th>
              <th style={th}>Período</th>
              <th style={th}>Método</th>
              <th style={{ ...th, textAlign: 'right' }}>Importe</th>
              <th style={th}>Pagado hasta</th>
              <th style={th}>Notas</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {items.map(r => (
              <tr key={r.id} style={{ borderBottom: '1px solid var(--line)' }}>
                <td style={td}>{r.cliente_nombre || r.cliente_idnoofit}</td>
                <td style={td} title={r.cuota_descripcion || ''}>
                  {r.cuota_codigo || <em style={{ color: 'var(--text-3)' }}>(libre)</em>}
                  {r.cuota_descripcion && r.cuota_codigo !== r.cuota_descripcion && (
                    <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{r.cuota_descripcion}</div>
                  )}
                </td>
                <td style={td}>{r.periodicidad || '—'}</td>
                <td style={td}>{METODOS.find(m => m.id === r.metodo_pago)?.label || r.metodo_pago}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>
                  {Number(r.importe_total).toFixed(2)} €
                </td>
                <td style={td}>{(r.fecha_hasta || '').slice(0, 10)}</td>
                <td style={{ ...td, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis',
                             whiteSpace: 'nowrap', fontSize: 11, color: 'var(--text-3)' }}
                    title={r.notas || ''}>
                  {r.notas || '—'}
                </td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  <Btn variant="ghost" size="sm" onClick={() => setEditing(r)}>
                    <Pencil size={11} /> Editar
                  </Btn>
                  <Btn variant="ghost" size="sm" onClick={() => onBorrar(r)}
                       style={{ color: 'var(--red)' }}>
                    <Trash2 size={11} /> Borrar
                  </Btn>
                </td>
              </tr>
            ))}
            <tr style={{ background: 'var(--bg-2)', fontWeight: 600 }}>
              <td style={td} colSpan={4}>Total</td>
              <td style={{ ...td, textAlign: 'right' }}>{total.toFixed(2)} €</td>
              <td style={td} colSpan={3} />
            </tr>
          </tbody>
        </table>
      )}

      {editing !== null && (
        <ModalRecibo identity={identity} mes={mes} initial={editing}
                     onClose={() => setEditing(null)}
                     onSaved={() => { setEditing(null); reload() }} />
      )}
    </Card>
  )
}

const th = {
  padding: '8px 8px', fontSize: 10, fontWeight: 600, color: 'var(--text-3)',
  textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'left',
}
const td = { padding: '8px 8px', borderBottom: '1px solid var(--line)', verticalAlign: 'middle' }


// ── Modal de creación / edición ─────────────────────────────────────────────
function ModalRecibo({ identity, mes, initial, onClose, onSaved }) {
  const toast = useToast()
  const isEdit = !!initial?.id
  const [submitting, setSubmitting] = useState(false)
  const overlayClose = useOverlayClose(onClose)

  // Form state
  const today = new Date().toISOString().slice(0, 10)
  const [cliente, setCliente] = useState(null)   // {id, name, surname}
  const [clienteIdInput, setClienteIdInput] = useState(initial?.cliente_idnoofit || '')
  const [clienteNombre, setClienteNombre] = useState(initial?.cliente_nombre || '')
  const [cuotaCodigo, setCuotaCodigo] = useState(initial?.cuota_codigo || '')
  const [cuotaDescripcion, setCuotaDescripcion] = useState(initial?.cuota_descripcion || '')
  const [periodicidad, setPeriodicidad] = useState(initial?.periodicidad || 'mensual')
  const [importe, setImporte] = useState(initial?.importe_total != null ? String(initial.importe_total) : '')
  const [ivaPct, setIvaPct] = useState(initial?.iva_pct != null ? String(initial.iva_pct) : '21')
  const [metodo, setMetodo] = useState(initial?.metodo_pago || 'sepa')
  const [fechaEmision, setFechaEmision] = useState((initial?.fecha_emision || today).slice(0, 10))
  const [fechaHasta, setFechaHasta] = useState(
    initial?.fecha_hasta ? initial.fecha_hasta.slice(0, 10) : calcFechaHasta(today, 'mensual'))
  const [fechaHastaEditada, setFechaHastaEditada] = useState(!!initial?.id)
  const [periodo, setPeriodo] = useState(initial?.periodo || mes)
  const [notas, setNotas] = useState(initial?.notas || '')

  // Buscador de clientes (autocomplete simple desde getClientes cacheado)
  const [todosClientes, setTodosClientes] = useState([])
  const [buscar, setBuscar] = useState('')
  useEffect(() => {
    getClientes().then(setTodosClientes).catch(() => setTodosClientes([]))
  }, [])
  const sugerencias = useMemo(() => {
    const q = buscar.trim().toLowerCase()
    if (!q || q.length < 2) return []
    return todosClientes.filter(c => {
      const txt = `${c.name || ''} ${c.surname || ''} ${c.id || ''} ${c.email || ''}`.toLowerCase()
      return txt.includes(q)
    }).slice(0, 12)
  }, [buscar, todosClientes])

  // ── Pre-fill desde suscripción(es) activa(s) del cliente ────────────────
  // Cuando el operador elige un cliente, traemos sus suscripciones activas y
  // el catálogo de cuotas para rellenar automáticamente cuota/periodicidad/
  // método/importe. Si tiene >1 sub activa, se muestra un selector para
  // elegir cuál replicar (todos los campos siguen editables a mano).
  const [subsActivas, setSubsActivas] = useState([])
  const [subSeleccionada, setSubSeleccionada] = useState(null)  // sub completa
  const [cargandoSubs, setCargandoSubs] = useState(false)
  const [cuotasCat, setCuotasCat] = useState([])

  // Mapeo Odoo sub.forma_pago → frontend metodo_pago.
  const FORMA_PAGO_SUB_A_METODO = {
    sepa:          'sepa',
    tarjeta_token: 'tarjeta_tok',
    tokenizacion:  'tarjeta_tok',
    efectivo:      'caja_efectivo',
    tpv:           'caja_tpv_fisico',
    enlace_pago:   'enlace_pago',
  }

  // Aplica los valores de una suscripción al formulario.
  const aplicarSub = (sub, cuotas = cuotasCat) => {
    if (!sub) return
    setSubSeleccionada(sub)
    const cuota = (cuotas || []).find(c => c.id === sub.cuota_id?.id)
    if (cuota) {
      setCuotaCodigo(cuota.codigo || '')
      setCuotaDescripcion(cuota.descripcion || '')
      const precio = cuota[`precio_${sub.periodicidad || 'mensual'}`]
      if (precio != null && Number(precio) > 0) setImporte(String(precio))
    }
    if (sub.periodicidad) setPeriodicidad(sub.periodicidad)
    const m = FORMA_PAGO_SUB_A_METODO[sub.forma_pago]
    if (m) setMetodo(m)
  }

  const elegirCliente = async (c) => {
    setCliente(c)
    setClienteIdInput(String(c.id))
    setClienteNombre(`${c.name || ''} ${c.surname || ''}`.trim())
    setBuscar('')
    // Pre-fill desde suscripciones del cliente
    setCargandoSubs(true)
    setSubsActivas([]); setSubSeleccionada(null)
    try {
      const [subResp, cuotas] = await Promise.all([
        listSubsByCliente(identity, c.id).catch(() => ({ subs: [] })),
        cuotasCatalogo(identity, c.idTrainer ?? c.id_trainer ?? null).catch(() => []),
      ])
      const subs = subResp.subs || subResp || []
      const activas = subs.filter(s => s.estado === 'activa')
      setSubsActivas(activas)
      setCuotasCat(cuotas)
      // Si hay una sola activa, la aplicamos directamente. Si hay varias,
      // dejamos que el operador elija.
      if (activas.length === 1) aplicarSub(activas[0], cuotas)
      else if (activas.length > 1) aplicarSub(activas[0], cuotas)  // default primera
    } catch (e) {
      // No bloquea — el operador puede rellenar a mano
    }
    setCargandoSubs(false)
  }

  // Auto-recalcular fecha hasta si no se ha editado manualmente
  useEffect(() => {
    if (fechaHastaEditada) return
    setFechaHasta(calcFechaHasta(fechaEmision, periodicidad))
  }, [fechaEmision, periodicidad, fechaHastaEditada])

  const submit = async () => {
    if (!clienteIdInput) { toast.error('Selecciona un cliente'); return }
    if (!importe || Number(importe) <= 0) { toast.error('Importe > 0'); return }
    if (!metodo) { toast.error('Método de pago obligatorio'); return }
    const importeTotal = Number(importe)
    const iva = Number(ivaPct) || 0
    const importeBase = +(importeTotal / (1 + iva / 100)).toFixed(2)
    const importeIva = +(importeTotal - importeBase).toFixed(2)
    const payload = {
      cliente_idnoofit: clienteIdInput,
      cliente_nombre:   clienteNombre || null,
      cuota_codigo:     cuotaCodigo || null,
      cuota_descripcion: cuotaDescripcion || null,
      periodo,
      periodicidad,
      fecha_desde:      fechaEmision,
      fecha_hasta:      fechaHasta || null,
      fecha_emision:    fechaEmision,
      importe_total:    importeTotal,
      importe_base:     importeBase,
      importe_iva:      importeIva,
      iva_pct:          iva,
      metodo_pago:      metodo,
      estado:           'borrador_remesa',
      origen:           'manual_remesa',
      notas:            notas || null,
    }
    setSubmitting(true)
    try {
      if (isEdit) {
        await reciboUpdate(identity, initial.id, payload)
        toast.success('Actualizado')
      } else {
        await reciboCreate(identity, payload)
        toast.success('Creado como borrador para esta remesa')
      }
      onSaved && onSaved()
    } catch (e) {
      toast.error(`Error: ${e.message}`)
    }
    setSubmitting(false)
  }

  return (
    <div role="dialog" aria-modal="true"
         style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
         {...overlayClose}>
      <div onClick={e => e.stopPropagation()}
           style={{ background: 'var(--bg-1)', borderRadius: 14, maxWidth: 760, width: '92%',
                    maxHeight: '90vh', display: 'flex', flexDirection: 'column',
                    border: '1px solid var(--line)' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line)',
                      display: 'flex', alignItems: 'center', gap: 10 }}>
          <Receipt size={18} style={{ color: 'var(--amber)' }} />
          <strong style={{ fontSize: 15 }}>
            {isEdit ? 'Editar recibo manual' : 'Nuevo recibo manual para remesa'}
          </strong>
          <div style={{ flex: 1 }} />
          <button onClick={onClose}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>
          {!isEdit && (
            <Field label="Cliente">
              <input type="text" value={buscar} onChange={e => setBuscar(e.target.value)}
                     placeholder="Buscar por nombre, apellidos o ID…"
                     style={inputStyle} />
              {sugerencias.length > 0 && (
                <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid var(--line)',
                              borderRadius: 8, marginTop: 4, background: 'var(--bg-2)' }}>
                  {sugerencias.map(c => (
                    <div key={c.id} onClick={() => elegirCliente(c)}
                         style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13,
                                  borderBottom: '1px solid var(--line)' }}>
                      <strong>{c.name} {c.surname}</strong>
                      <span style={{ marginLeft: 8, color: 'var(--text-3)', fontSize: 11 }}>
                        #{c.id} · {c.email || 'sin email'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {clienteIdInput && (
                <div style={{ marginTop: 6, padding: '6px 10px', background: 'var(--green-bg)',
                              borderRadius: 6, fontSize: 12 }}>
                  ✓ Cliente seleccionado: <strong>{clienteNombre}</strong> (id={clienteIdInput})
                  {cargandoSubs && <span style={{ marginLeft: 8, color: 'var(--text-3)' }}>
                    · cargando cuotas activas… <Loader2 size={11} className="animate-spin" style={{ verticalAlign: 'middle' }} />
                  </span>}
                </div>
              )}
              {/* Selector de cuota activa si hay varias */}
              {subsActivas.length > 1 && (
                <div style={{ marginTop: 8, padding: 10, background: 'var(--bg-2)',
                              borderRadius: 8, fontSize: 12 }}>
                  <div style={{ marginBottom: 6, color: 'var(--text-2)' }}>
                    Tiene <strong>{subsActivas.length} cuotas activas</strong>. Elige cuál usar
                    como base (todos los campos siguen editables):
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {subsActivas.map(s => (
                      <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6,
                                                  cursor: 'pointer' }}>
                        <input type="radio" name="sub_activa"
                               checked={subSeleccionada?.id === s.id}
                               onChange={() => aplicarSub(s)} />
                        <span><strong>{s.cuota_id?.name || `Cuota ${s.cuota_id?.id}`}</strong>
                              {' '}· {s.periodicidad}
                              {' '}· {s.forma_pago}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {subsActivas.length === 1 && subSeleccionada && (
                <div style={{ marginTop: 6, padding: '6px 10px',
                              background: 'rgba(91,156,246,0.08)', borderRadius: 6, fontSize: 11,
                              color: 'var(--text-2)' }}>
                  Pre-rellenado desde su única cuota activa:{' '}
                  <strong>{subSeleccionada.cuota_id?.name}</strong>{' '}
                  ({subSeleccionada.periodicidad}, {subSeleccionada.forma_pago}).
                  Puedes modificar cualquier campo.
                </div>
              )}
              {!cargandoSubs && clienteIdInput && subsActivas.length === 0 && (
                <div style={{ marginTop: 6, padding: '6px 10px',
                              background: 'rgba(251,191,36,0.08)', borderRadius: 6, fontSize: 11,
                              color: 'var(--text-2)' }}>
                  Este cliente no tiene cuotas activas. Rellena los campos a mano.
                </div>
              )}
            </Field>
          )}
          {isEdit && (
            <div style={{ padding: 10, background: 'var(--bg-2)', borderRadius: 8, marginBottom: 14,
                          fontSize: 13 }}>
              Cliente: <strong>{clienteNombre}</strong> (id={clienteIdInput}) — no editable.
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
            <Field label="Código cuota (opcional)">
              <input value={cuotaCodigo} onChange={e => setCuotaCodigo(e.target.value)}
                     placeholder="RT 2 dias / RECIBO LIBRE / etc." style={inputStyle} />
            </Field>
            <Field label="Período (YYYY-MM)">
              <input value={periodo} onChange={e => setPeriodo(e.target.value)}
                     style={inputStyle} />
            </Field>
          </div>

          <Field label="Descripción / concepto (opcional)">
            <input value={cuotaDescripcion} onChange={e => setCuotaDescripcion(e.target.value)}
                   placeholder="ej. Cuota especial trimestre extra"
                   style={inputStyle} />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Periodicidad">
              <select value={periodicidad} onChange={e => setPeriodicidad(e.target.value)}
                      style={inputStyle}>
                {PERIODICIDADES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </Field>
            <Field label="Método de pago">
              <select value={metodo} onChange={e => setMetodo(e.target.value)} style={inputStyle}>
                {METODOS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </Field>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
            <Field label="Importe total (€) *">
              <input type="number" min="0" step="0.01" value={importe}
                     onChange={e => setImporte(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="IVA %">
              <input type="number" min="0" max="100" step="1" value={ivaPct}
                     onChange={e => setIvaPct(e.target.value)} style={inputStyle} />
            </Field>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Fecha emisión">
              <input type="date" value={fechaEmision}
                     onChange={e => setFechaEmision(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Pagado hasta"
                   hint={fechaHastaEditada ? 'Editada manualmente.' : 'Auto-calculado.'}>
              <input type="date" value={fechaHasta}
                     onChange={e => { setFechaHasta(e.target.value); setFechaHastaEditada(true) }}
                     style={inputStyle} />
            </Field>
          </div>

          <Field label="Notas">
            <textarea value={notas} onChange={e => setNotas(e.target.value)} rows={2}
                      placeholder="Razón del recibo manual (cobro retroactivo, importe especial, etc.)"
                      style={{ ...inputStyle, resize: 'vertical', minHeight: 50 }} />
          </Field>
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--line)',
                      display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Btn variant="secondary" onClick={onClose} disabled={submitting}>Cancelar</Btn>
          <Btn variant="primary" onClick={submit} disabled={submitting}>
            {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
            {' '}{isEdit ? 'Guardar cambios' : 'Crear borrador'}
          </Btn>
        </div>
      </div>
    </div>
  )
}


function Field({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>
        {label}
      </label>
      {children}
      {hint && <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 3 }}>{hint}</div>}
    </div>
  )
}
