// Card "Modificaciones" del cliente — para el perfil del cliente.
// Lista las modificaciones aplicadas/pendientes (más nuevas arriba).
// Permite crear nueva y editar las que aún no se han cobrado (estado='activa').
import { useEffect, useMemo, useState } from 'react'
import { Plus, Loader2, Edit2, X as XIcon, Trash2, Check, Settings2, Ban } from 'lucide-react'
import { Card, Btn, Badge, SectionTitle } from '../UI'
import { useToast } from '../Toast'
import { useAuth } from '../../contexts/AuthContext'
import {
  getRoundIdentity,
  modificacionesList, modificacionCreate, modificacionUpdate, modificacionDelete,
  modificacionAnular, cuotasList,
} from '../../utils/configApi'

// Tipos para el SELECTOR (formulario nuevo). Internamente sigue habiendo
// 3 valores válidos en BD (descuento/cargo_extra/precio_alternativo) por
// compat, pero la math se rige por el SIGNO de `valor`:
//   - positivo → suma al recibo
//   - negativo → resta del recibo
// `descuento` queda como histórico (ya no se ofrece nuevo).
const TIPOS_MOD_FORM = [
  { id: 'cargo_extra',         label: 'Ajuste (suma/resta)' },
  { id: 'precio_alternativo',  label: 'Precio alternativo (sustituye precio)' },
]

// Para mostrar el signo de una modificación existente:
//   precio_alternativo → '='
//   resto → '+' si valor >= 0, '−' si valor < 0
function signoMod(m) {
  if (m.tipo === 'precio_alternativo') return '='
  return Number(m.valor) >= 0 ? '+' : '−'
}
function labelTipo(m) {
  if (m.tipo === 'precio_alternativo') return 'Precio alternativo'
  if (m.tipo === 'descuento') return 'Descuento (histórico)'
  return Number(m.valor) >= 0 ? 'Cargo extra' : 'Descuento'
}
const ESTADOS = [
  { id: 'activa',    label: 'Pendiente', color: 'amber' },
  { id: 'aplicada',  label: 'Aplicada',  color: 'green' },
  { id: 'cancelada', label: 'Cancelada', color: 'gray'  },
]

function fmt(d) {
  if (!d) return '—'
  try {
    return new Date(d).toLocaleDateString('es-ES',
      { day: 'numeric', month: 'short', year: 'numeric' })
  } catch { return d }
}
function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

export default function ModificacionesClienteCard({ cliente }) {
  const { user } = useAuth()
  const identity = useMemo(() => getRoundIdentity(user), [user])
  const toast = useToast()

  const [items, setItems] = useState([])
  const [cuotas, setCuotas] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)   // null | {id?, ...campos}

  async function reload() {
    if (!cliente?.id) return
    setLoading(true)
    try {
      const [mods, cs] = await Promise.all([
        modificacionesList(identity, { cliente: String(cliente.id) }).catch(() => []),
        cuotasList(identity).catch(() => []),
      ])
      // Más nuevas arriba (created_at desc)
      setItems((mods || []).sort((a, b) =>
        String(b.created_at || '').localeCompare(String(a.created_at || ''))
      ))
      setCuotas(cs || [])
    } catch (e) {
      toast.error(`Error cargando modificaciones: ${e.message}`)
    } finally { setLoading(false) }
  }
  useEffect(() => { reload() }, [cliente?.id])

  function startNew() {
    setEditing({
      tipo: 'cargo_extra',  // por defecto: ajuste (signo de `valor` manda)
      valor: '',
      cuota_id: '',
      fecha_desde: todayISO(),
      fecha_hasta: '',
      razon: '',
      estado: 'activa',
    })
  }

  function startEdit(m) {
    if (m.estado !== 'activa') {
      toast.warning('Solo se pueden modificar las pendientes (sin cobrar).')
      return
    }
    setEditing({ ...m,
      fecha_desde: (m.fecha_desde || '').slice(0, 10),
      fecha_hasta: (m.fecha_hasta || '').slice(0, 10),
    })
  }

  async function handleSave() {
    if (!editing) return
    if (!editing.tipo) { toast.error('Tipo obligatorio'); return }
    if (editing.valor === '' || isNaN(Number(editing.valor))) {
      toast.error('Valor numérico obligatorio'); return
    }
    if (!editing.fecha_desde) { toast.error('Fecha desde obligatoria'); return }
    const payload = {
      cliente_idnoofit: String(cliente.id),
      tipo: editing.tipo,
      valor: Number(editing.valor),
      cuota_id: editing.cuota_id || null,
      fecha_desde: editing.fecha_desde,
      fecha_hasta: editing.fecha_hasta || null,
      razon: editing.razon || null,
      estado: editing.estado || 'activa',
    }
    try {
      if (editing.id) await modificacionUpdate(identity, editing.id, payload)
      else            await modificacionCreate(identity, payload)
      toast.success('Modificación guardada')
      setEditing(null)
      reload()
    } catch (e) { toast.error(`Error: ${e.message}`) }
  }

  async function handleDelete(m) {
    if (m.estado !== 'activa') {
      toast.warning('Solo se pueden borrar las pendientes (sin cobrar).')
      return
    }
    if (!confirm('¿Borrar esta modificación?')) return
    try {
      await modificacionDelete(identity, m.id)
      toast.success('Borrada'); reload()
    } catch (e) { toast.error(`Error: ${e.message}`) }
  }

  // Anular = cancelar (soft). A diferencia de borrar, preserva el registro y
  // funciona también sobre las ya APLICADAS (deja de aplicarse en el futuro;
  // los recibos ya emitidos no se tocan).
  async function handleAnular(m) {
    if (m.estado === 'cancelada') return
    const msg = m.estado === 'aplicada'
      ? '¿Anular esta modificación ya aplicada?\n\nDejará de aplicarse en emisiones futuras. Los recibos ya emitidos NO cambian (edita el recibo si necesitas revertirlo).'
      : '¿Anular esta modificación?\n\nQuedará cancelada y no se aplicará.'
    if (!confirm(msg)) return
    try {
      await modificacionAnular(identity, m.id)
      toast.success('Modificación anulada'); reload()
    } catch (e) { toast.error(`Error: ${e.message}`) }
  }

  return (
    <Card style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <SectionTitle style={{ flex: 1, marginBottom: 0 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Settings2 size={16} aria-hidden="true" /> Modificaciones
          </span>
        </SectionTitle>
        {!editing && (
          <Btn variant="primary" size="sm" onClick={startNew}>
            <Plus size={12} /> Nueva
          </Btn>
        )}
      </div>

      {loading ? (
        <div style={{ padding: 20, textAlign: 'center' }}>
          <Loader2 size={18} className="animate-spin" style={{ color: 'var(--green)' }} />
        </div>
      ) : (
        <>
          {editing && (
            <ModForm value={editing} onChange={setEditing} cuotas={cuotas}
                     onCancel={() => setEditing(null)} onSave={handleSave} />
          )}

          {items.length === 0 && !editing ? (
            <p style={{ fontSize: 12, color: 'var(--text-3)', fontStyle: 'italic' }}>
              Sin modificaciones registradas.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {items.map(m => {
                const est  = ESTADOS.find(e => e.id === m.estado) || ESTADOS[0]
                const cuota = cuotas.find(c => c.id === m.cuota_id)
                const editable = m.estado === 'activa'
                const sig = signoMod(m)
                const absVal = Math.abs(Number(m.valor) || 0).toFixed(2)
                const tipoLabel = labelTipo(m)
                return (
                  <div key={m.id} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 10px', borderRadius: 8,
                    background: editable ? 'var(--amber-bg, #fef3c7)' : 'var(--bg-2)',
                    border: `1px solid ${editable ? 'var(--amber, #f59e0b)' : 'var(--line)'}`,
                    opacity: m.estado === 'cancelada' ? 0.55 : 1,
                  }}>
                    <span style={{
                      fontSize: 18, fontWeight: 700, lineHeight: 1,
                      width: 18, textAlign: 'center',
                      color: sig === '+' ? 'var(--red)'
                           : sig === '−' ? 'var(--green)'
                           : 'var(--blue)',
                    }}>{sig}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-0)', margin: 0 }}>
                        {tipoLabel}: {sig === '−' ? '−' : sig === '+' ? '+' : ''}{absVal}€
                        {cuota && <span style={{ color: 'var(--text-3)', fontWeight: 400, marginLeft: 6 }}>· {cuota.codigo}</span>}
                      </p>
                      {m.razon && (
                        <p style={{ fontSize: 11, color: 'var(--text-2)', margin: '2px 0 0' }}>
                          {m.razon}
                        </p>
                      )}
                      <p style={{ fontSize: 10, color: 'var(--text-3)', margin: '2px 0 0' }}>
                        {fmt(m.fecha_desde)}{m.fecha_hasta ? ` → ${fmt(m.fecha_hasta)}` : ''}
                      </p>
                    </div>
                    <Badge color={est.color}>{est.label}</Badge>
                    {editable && (
                      <>
                        <button onClick={() => startEdit(m)}
                                title="Editar"
                                style={{ background: 'none', border: 'none',
                                         cursor: 'pointer', color: 'var(--text-2)', padding: 4 }}>
                          <Edit2 size={13} />
                        </button>
                        <button onClick={() => handleDelete(m)}
                                title="Borrar"
                                style={{ background: 'none', border: 'none',
                                         cursor: 'pointer', color: 'var(--red)', padding: 4 }}>
                          <Trash2 size={13} />
                        </button>
                      </>
                    )}
                    {m.estado !== 'cancelada' && (
                      <button onClick={() => handleAnular(m)}
                              title={m.estado === 'aplicada'
                                ? 'Anular (deja de aplicarse; no toca recibos ya emitidos)'
                                : 'Anular (cancelar)'}
                              style={{ background: 'none', border: 'none',
                                       cursor: 'pointer', color: 'var(--amber)', padding: 4 }}>
                        <Ban size={13} />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </Card>
  )
}


function ModForm({ value, onChange, cuotas, onCancel, onSave }) {
  const set = (k, v) => onChange(prev => ({ ...prev, [k]: v }))
  return (
    <div style={{
      padding: 12, marginBottom: 12, borderRadius: 10,
      background: 'var(--bg-1)', border: '1px solid var(--line)',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <label style={lbl}>Tipo
          <select value={value.tipo} onChange={e => set('tipo', e.target.value)} style={inputStyle}>
            {TIPOS_MOD_FORM.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
        <label style={lbl}>Valor (€)
          <input type="number" step="0.01" value={value.valor}
                 onChange={e => set('valor', e.target.value)} style={inputStyle}
                 placeholder={value.tipo === 'precio_alternativo' ? '20.00' : '+10.00 o −5.00'} />
        </label>
      </div>
      <p style={{ fontSize: 11, color: 'var(--text-3)', margin: 0, lineHeight: 1.4 }}>
        {value.tipo === 'precio_alternativo'
          ? <>El recibo de la cuota afectada saldrá por exactamente este importe (sustituye el precio base).</>
          : <>Pon el valor con <strong>signo</strong>: <strong style={{ color: 'var(--red)' }}>positivo (+10)</strong> suma al recibo, <strong style={{ color: 'var(--green)' }}>negativo (−10)</strong> resta.</>}
      </p>
      <label style={lbl}>Cuota afectada (opcional)
        <select value={value.cuota_id || ''} onChange={e => set('cuota_id', e.target.value)} style={inputStyle}>
          <option value="">— Cualquiera —</option>
          {cuotas.map(c => (
            <option key={c.id} value={c.id}>{c.codigo}</option>
          ))}
        </select>
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <label style={lbl}>Fecha desde
          <input type="date" value={value.fecha_desde}
                 onChange={e => set('fecha_desde', e.target.value)} style={inputStyle} />
        </label>
        <label style={lbl}>Fecha hasta (opcional)
          <input type="date" value={value.fecha_hasta || ''}
                 onChange={e => set('fecha_hasta', e.target.value)} style={inputStyle} />
        </label>
      </div>
      <label style={lbl}>Razón / nota
        <input type="text" value={value.razon || ''}
               onChange={e => set('razon', e.target.value)}
               placeholder="Mes vacaciones, cargo extra clase…" style={inputStyle} />
      </label>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <Btn variant="secondary" size="sm" onClick={onCancel}>
          <XIcon size={12} /> Cancelar
        </Btn>
        <Btn variant="primary" size="sm" onClick={onSave}>
          <Check size={12} /> Guardar
        </Btn>
      </div>
    </div>
  )
}

const lbl = {
  display: 'flex', flexDirection: 'column', gap: 3,
  fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase',
  letterSpacing: '0.04em',
}
const inputStyle = {
  padding: '7px 10px', borderRadius: 8, fontSize: 13,
  background: 'var(--bg-2)', border: '1px solid var(--line)', color: 'var(--text-0)',
  marginTop: 2,
}
