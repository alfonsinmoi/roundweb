// CRUD de categorías de cliente (Gympass / Trabajador / Invitado / …)
//
// Cada categoría tiene flags `puede_reservar` (si la categoría permite
// reservar clases) y `tiene_cuota` (si llevan cuota). Si una categoría
// se marca inactiva, los clientes asignados no pueden reservar.

import { useState, useEffect } from 'react'
import { Plus, Save, Trash2, Loader2, Edit2, X, AlertCircle } from 'lucide-react'
import { Card, Btn, Badge, EmptyState } from '../../components/UI'
import { useToast } from '../../components/Toast'
import {
  categoriasList, categoriaCreate, categoriaUpdate, categoriaDelete,
  categoriaConteo,
} from '../../utils/configApi'
import { useCan } from '../../hooks/useCan'

const COLORES = [
  { id: 'purple', label: 'Morado' },
  { id: 'cyan',   label: 'Cian' },
  { id: 'amber',  label: 'Ámbar' },
  { id: 'green',  label: 'Verde' },
  { id: 'red',    label: 'Rojo' },
  { id: 'blue',   label: 'Azul' },
  { id: 'gray',   label: 'Gris' },
]

const EMPTY = {
  nombre: '', color: 'purple',
  puede_reservar: true, tiene_cuota: false, activa: true,
}

export default function CategoriasTab({ identity }) {
  const toast = useToast()
  const canCrear = useCan('configuracion.categorias_cliente.crear')
  const canBorrar = useCan('configuracion.categorias_cliente.borrar')
  const [items, setItems] = useState([])
  const [conteos, setConteos] = useState([])     // [{id, nombre, clientes}]
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)   // null | 'new' | id
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)

  const reload = async () => {
    setLoading(true)
    try {
      const [list, c] = await Promise.all([
        categoriasList(identity).catch(() => []),
        categoriaConteo(identity).catch(() => []),
      ])
      setItems(list || [])
      setConteos(c || [])
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setLoading(false)
  }
  useEffect(() => { reload() }, [identity?.managerId])

  const startNew = () => { setEditing('new'); setForm(EMPTY) }
  const startEdit = (cat) => {
    setEditing(cat.id)
    setForm({
      nombre: cat.nombre || '',
      color: cat.color || 'purple',
      puede_reservar: !!cat.puede_reservar,
      tiene_cuota: !!cat.tiene_cuota,
      activa: !!cat.activa,
    })
  }
  const cancelEdit = () => { setEditing(null); setForm(EMPTY) }

  const save = async () => {
    if (!form.nombre.trim()) { toast.error('El nombre es obligatorio'); return }
    setSaving(true)
    try {
      if (editing === 'new') {
        await categoriaCreate(identity, form)
        toast.success('Categoría creada')
      } else {
        await categoriaUpdate(identity, editing, form)
        toast.success('Categoría actualizada')
      }
      cancelEdit()
      reload()
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setSaving(false)
  }

  const remove = async (cat) => {
    const conteo = conteos.find(c => c.id === cat.id)?.clientes || 0
    const msg = conteo > 0
      ? `La categoría "${cat.nombre}" tiene ${conteo} cliente(s) asignado(s). Se desactivará en lugar de borrarse.`
      : `Borrar la categoría "${cat.nombre}"?`
    if (!confirm(msg)) return
    try {
      const r = await categoriaDelete(identity, cat.id)
      toast.success(r.mode === 'deactivated' ? 'Categoría desactivada' : 'Categoría borrada')
      reload()
    } catch (e) { toast.error(`Error: ${e.message}`) }
  }

  const clientesPorId = Object.fromEntries(conteos.map(c => [c.id, c.clientes]))

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
      <Loader2 size={20} className="animate-spin" style={{ color: 'var(--green)' }} />
    </div>
  )

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <p style={{ fontSize: 13, color: 'var(--text-3)' }}>
          Define qué tipo de clientes hay en tu centro. Si una categoría tiene
          <strong style={{ color: 'var(--text-1)' }}> "puede reservar"</strong> desactivado, los clientes asignados no podrán reservar
          clases. Si la categoría se inactiva, sucede lo mismo.
        </p>
        {editing == null && canCrear && (
          <Btn size="sm" onClick={startNew}><Plus size={14} /> Nueva categoría</Btn>
        )}
      </div>

      {editing != null && (
        <Card style={{ padding: 18, marginBottom: 16, borderColor: 'var(--green-border)' }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
            {editing === 'new' ? 'Nueva categoría' : 'Editar categoría'}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <div>
              <label style={lbl}>Nombre *</label>
              <input type="text" value={form.nombre} className="form-input"
                     onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                     placeholder="Ej: Gympass, Trabajador..."
                     style={inp} />
            </div>
            <div>
              <label style={lbl}>Color</label>
              <select value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                      style={inp}>
                {COLORES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 14 }}>
            <Check label="Puede reservar clases"
                   checked={form.puede_reservar}
                   onChange={v => setForm(f => ({ ...f, puede_reservar: v }))} />
            <Check label="Tiene cuota"
                   checked={form.tiene_cuota}
                   onChange={v => setForm(f => ({ ...f, tiene_cuota: v }))} />
            <Check label="Activa"
                   checked={form.activa}
                   onChange={v => setForm(f => ({ ...f, activa: v }))} />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <Btn variant="secondary" size="sm" onClick={cancelEdit} disabled={saving}>
              <X size={13} /> Cancelar
            </Btn>
            <Btn variant="primary" size="sm" onClick={save} disabled={saving}>
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Guardar
            </Btn>
          </div>
        </Card>
      )}

      {items.length === 0 ? (
        <EmptyState title="No hay categorías"
                    description="Crea la primera (Gympass, Trabajador, Invitado…) para empezar." />
      ) : (
        <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 16, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 100px', padding: '10px 16px', background: 'var(--bg-3)', fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', fontWeight: 500 }}>
            <span>Nombre</span><span>Reserva</span><span>Cuota</span><span>Estado</span><span>Clientes</span><span></span>
          </div>
          {items.map((c, i) => (
            <div key={c.id} style={{
              display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 100px',
              padding: '12px 16px', alignItems: 'center',
              borderTop: i > 0 ? '1px solid var(--line)' : 'none',
              opacity: c.activa ? 1 : 0.6,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Badge color={c.color || 'gray'}>{c.nombre}</Badge>
              </div>
              <span style={{ fontSize: 13 }}>{c.puede_reservar ? '✓' : '✗ no'}</span>
              <span style={{ fontSize: 13 }}>{c.tiene_cuota ? '✓' : '—'}</span>
              <span style={{ fontSize: 13 }}>
                {c.activa
                  ? <Badge color="green">Activa</Badge>
                  : <Badge color="gray">Inactiva</Badge>}
              </span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{clientesPorId[c.id] ?? 0}</span>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <button onClick={() => startEdit(c)} aria-label="Editar"
                        style={btnIcon}>
                  <Edit2 size={13} />
                </button>
                {canBorrar && (
                  <button onClick={() => remove(c)} aria-label="Borrar"
                          style={{ ...btnIcon, color: 'var(--red)' }}>
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
        <AlertCircle size={11} /> Cuando NoofitPro publique categorías nativas, las sincronizaremos vía el campo "noofit_alias".
      </p>
    </div>
  )
}

function Check({ label, checked, onChange }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

const lbl = { display: 'block', fontSize: 12, color: 'var(--text-3)', marginBottom: 4 }
const inp = {
  width: '100%', padding: '8px 10px', borderRadius: 8, fontSize: 13,
  background: 'var(--bg-1)', border: '1px solid var(--line)', color: 'var(--text-0)',
}
const btnIcon = {
  background: 'none', border: '1px solid var(--line)', borderRadius: 8,
  padding: '5px 8px', cursor: 'pointer', color: 'var(--text-2)',
  display: 'inline-flex', alignItems: 'center',
}
