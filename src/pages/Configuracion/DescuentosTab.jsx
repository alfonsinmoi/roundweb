import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, Check, X, RefreshCw, Download, Loader2 } from 'lucide-react'
import { Card, Btn, Badge } from '../../components/UI'
import { useToast } from '../../components/Toast'
import {
  descuentosList, descuentoCreate, descuentoUpdate, descuentoDelete, descuentoAdoptar,
  TIPOS_DESCUENTO,
} from '../../utils/configApi'


export default function DescuentosTab({ identity }) {
  const toast = useToast()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const isTrainer = !!identity.trainerId

  async function reload() {
    setLoading(true)
    try {
      setItems(await descuentosList(identity) || [])
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setLoading(false)
  }

  useEffect(() => { reload() }, [identity.managerId, identity.trainerId])

  async function onAdoptar(id) {
    try { await descuentoAdoptar(identity, id); toast.success('Plantilla adoptada'); reload() }
    catch (e) { toast.error(e.message) }
  }
  async function onDelete(d) {
    if (!confirm(`¿Eliminar "${d.codigo}"?`)) return
    try { await descuentoDelete(identity, d.id); toast.success('Descuento eliminado'); reload() }
    catch (e) { toast.error(e.message) }
  }

  const plantillas = items.filter(d => d.scope === 'plantilla_manager')
  const propios    = items.filter(d => d.scope === 'trainer')

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14, gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: 'var(--text-2)' }}>
          {loading ? 'Cargando…' : `${items.length} descuento${items.length !== 1 ? 's' : ''}`}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn variant="secondary" size="sm" onClick={reload}><RefreshCw size={13} /> Refrescar</Btn>
          <Btn variant="primary" size="sm" onClick={() => setEditing({})}><Plus size={13} /> Nuevo</Btn>
        </div>
      </div>

      {plantillas.length > 0 && (
        <Section titulo={isTrainer ? 'Plantillas del manager' : 'Plantillas (manager)'}>
          {plantillas.map(d => (
            <DescRow key={d.id} d={d} isTrainer={isTrainer}
                     onEdit={!isTrainer ? () => setEditing(d) : null}
                     onDelete={!isTrainer ? () => onDelete(d) : null}
                     onAdoptar={isTrainer && !items.some(t => t.scope === 'trainer' && t.plantilla_origen_id === d.id) ? () => onAdoptar(d.id) : null} />
          ))}
        </Section>
      )}

      {isTrainer && propios.length > 0 && (
        <Section titulo="Mis descuentos">
          {propios.map(d => (
            <DescRow key={d.id} d={d} isTrainer
                     onEdit={() => setEditing(d)} onDelete={() => onDelete(d)} />
          ))}
        </Section>
      )}

      {!loading && items.length === 0 && (
        <Card style={{ padding: 32, textAlign: 'center' }}>
          <p style={{ fontSize: 14, color: 'var(--text-3)' }}>Sin descuentos. Crea el primero con «Nuevo».</p>
        </Card>
      )}

      {editing && (
        <DescForm desc={editing} identity={identity}
                  onClose={() => setEditing(null)}
                  onSaved={() => { setEditing(null); reload() }} />
      )}
    </div>
  )
}


function Section({ titulo, children }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700,
                   color: 'var(--text-3)', textTransform: 'uppercase',
                   letterSpacing: '0.05em', marginBottom: 8 }}>{titulo}</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
    </div>
  )
}

function DescRow({ d, isTrainer, onEdit, onDelete, onAdoptar }) {
  return (
    <Card style={{ padding: '12px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, color: 'var(--text-0)' }}>{d.codigo}</span>
            <Badge color={d.tipo === 'porcentaje' ? 'green' : 'blue'}>
              {d.tipo === 'porcentaje' ? `${d.valor}%` : `${d.valor}€`}
            </Badge>
            {!d.active && <Badge color="gray">Inactivo</Badge>}
            {d.plantilla_origen_id && <Badge color="blue">Adoptada</Badge>}
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>{d.descripcion}</p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {onAdoptar && <Btn variant="secondary" size="sm" onClick={onAdoptar}><Download size={12} /> Adoptar</Btn>}
          {onEdit && <Btn variant="secondary" size="sm" onClick={onEdit}><Pencil size={12} /></Btn>}
          {onDelete && <Btn variant="danger" size="sm" onClick={onDelete}><Trash2 size={12} /></Btn>}
        </div>
      </div>
    </Card>
  )
}


function DescForm({ desc, identity, onClose, onSaved }) {
  const isNew = !desc.id
  const toast = useToast()
  const [saving, setSaving] = useState(false)
  const [data, setData] = useState({
    codigo: desc.codigo || '',
    descripcion: desc.descripcion || '',
    tipo: desc.tipo || 'porcentaje',
    valor: desc.valor ?? 0,
    active: desc.active ?? true,
  })
  const set = (k, v) => setData(d => ({ ...d, [k]: v }))

  async function onSubmit(e) {
    e.preventDefault()
    if (!data.codigo.trim()) { toast.error('Código obligatorio'); return }
    setSaving(true)
    try {
      if (isNew) await descuentoCreate(identity, data)
      else       await descuentoUpdate(identity, desc.id, data)
      toast.success('Descuento guardado'); onSaved()
    } catch (e) { toast.error(e.message) }
    setSaving(false)
  }

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }}
         style={{ position: 'fixed', inset: 0, zIndex: 600, background: 'rgba(0,0,0,0.6)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: 'var(--bg-1)', borderRadius: 'var(--radius-lg)', width: '100%',
                    maxWidth: 480, boxShadow: 'var(--shadow-lg)' }}>
        <header style={{ padding: '18px 22px', borderBottom: '1px solid var(--line)',
                         display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--text-0)' }}>
            {isNew ? 'Nuevo descuento' : `Editar ${desc.codigo}`}
          </h2>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 8,
                  border: '1px solid var(--line)', background: 'var(--bg-3)',
                  color: 'var(--text-2)', cursor: 'pointer' }}>
            <X size={14} />
          </button>
        </header>
        <form onSubmit={onSubmit} style={{ padding: 22 }}>
          <Field label="Código *">
            <input value={data.codigo} onChange={e => set('codigo', e.target.value)}
                   placeholder="DESC_FAMILIA" style={inputStyle} />
          </Field>
          <Field label="Descripción">
            <input value={data.descripcion} onChange={e => set('descripcion', e.target.value)}
                   style={inputStyle} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 10 }}>
            <Field label="Tipo">
              <select value={data.tipo} onChange={e => set('tipo', e.target.value)} style={inputStyle}>
                {TIPOS_DESCUENTO.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="Valor">
              <input type="number" step="0.01" value={data.valor}
                     onChange={e => set('valor', parseFloat(e.target.value) || 0)}
                     style={inputStyle} />
            </Field>
          </div>
          <Field>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text-1)' }}>
              <input type="checkbox" checked={data.active} onChange={e => set('active', e.target.checked)} /> Activo
            </label>
          </Field>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
            <Btn variant="secondary" type="button" onClick={onClose}>Cancelar</Btn>
            <Btn variant="primary" type="submit" disabled={saving}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {saving ? ' Guardando…' : ' Guardar'}
            </Btn>
          </div>
        </form>
      </div>
    </div>
  )
}

const inputStyle = {
  width: '100%', padding: '8px 10px', borderRadius: 'var(--radius-sm)',
  background: 'var(--bg-2)', border: '1px solid var(--line)',
  color: 'var(--text-0)', fontSize: 13, outline: 'none',
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
      {label && <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)',
                              textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>}
      {children}
    </label>
  )
}
