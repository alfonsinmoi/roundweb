import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, Check, X, RefreshCw, Loader2 } from 'lucide-react'
import { Card, Btn, Badge } from '../../components/UI'
import { useToast } from '../../components/Toast'
import {
  modificacionesList, modificacionCreate, modificacionUpdate, modificacionDelete,
  TIPOS_MODIFICACION,
} from '../../utils/configApi'


export default function ModificacionesTab({ identity }) {
  const toast = useToast()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)

  async function reload() {
    setLoading(true)
    try { setItems(await modificacionesList(identity) || []) }
    catch (e) { toast.error(`Error: ${e.message}`) }
    setLoading(false)
  }
  useEffect(() => { reload() }, [identity.managerId, identity.trainerId])

  async function onDelete(m) {
    if (!confirm(`¿Eliminar modificación de ${m.fecha_desde}?`)) return
    try { await modificacionDelete(identity, m.id); toast.success('Eliminada'); reload() }
    catch (e) { toast.error(e.message) }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14, gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: 'var(--text-2)' }}>
          {loading ? 'Cargando…' : `${items.length} modificación${items.length !== 1 ? 'es' : ''}`}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn variant="secondary" size="sm" onClick={reload}><RefreshCw size={13} /> Refrescar</Btn>
          <Btn variant="primary" size="sm" onClick={() => setEditing({})}><Plus size={13} /> Nueva</Btn>
        </div>
      </div>

      {!loading && items.length === 0 && (
        <Card style={{ padding: 32, textAlign: 'center' }}>
          <p style={{ fontSize: 14, color: 'var(--text-3)' }}>
            Sin modificaciones. Crea una para aplicar un cambio puntual de precio o un cargo extra.
          </p>
        </Card>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map(m => (
          <Card key={m.id} style={{ padding: '12px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Badge color={m.tipo === 'descuento' ? 'green' : m.tipo === 'cargo_extra' ? 'red' : 'blue'}>
                    {TIPOS_MODIFICACION.find(t => t.id === m.tipo)?.label || m.tipo}
                  </Badge>
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, color: 'var(--text-0)' }}>
                    {m.valor}€
                  </span>
                  {m.estado !== 'activa' && <Badge color="gray">{m.estado}</Badge>}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
                  {m.fecha_desde}{m.fecha_hasta ? ` — ${m.fecha_hasta}` : ' — sin fin'}
                  {m.cliente_idnoofit ? ` · cliente ${m.cliente_idnoofit}` : ''}
                </div>
                {m.razon && <p style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4 }}>{m.razon}</p>}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <Btn variant="secondary" size="sm" onClick={() => setEditing(m)}><Pencil size={12} /></Btn>
                <Btn variant="danger" size="sm" onClick={() => onDelete(m)}><Trash2 size={12} /></Btn>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {editing && (
        <ModForm mod={editing} identity={identity}
                 onClose={() => setEditing(null)}
                 onSaved={() => { setEditing(null); reload() }} />
      )}
    </div>
  )
}


function ModForm({ mod, identity, onClose, onSaved }) {
  const isNew = !mod.id
  const toast = useToast()
  const [saving, setSaving] = useState(false)
  const [data, setData] = useState({
    tipo: mod.tipo || 'descuento',
    valor: mod.valor ?? 0,
    fecha_desde: mod.fecha_desde || new Date().toISOString().slice(0, 10),
    fecha_hasta: mod.fecha_hasta || '',
    cliente_idnoofit: mod.cliente_idnoofit || '',
    razon: mod.razon || '',
    estado: mod.estado || 'activa',
  })
  const set = (k, v) => setData(d => ({ ...d, [k]: v }))

  async function onSubmit(e) {
    e.preventDefault()
    if (!data.fecha_desde) { toast.error('Fecha desde obligatoria'); return }
    if (!identity.trainerId) { toast.error('Necesitas estar viendo un trainer concreto'); return }
    setSaving(true)
    try {
      const payload = { ...data, fecha_hasta: data.fecha_hasta || null,
                        cliente_idnoofit: data.cliente_idnoofit || null }
      if (isNew) await modificacionCreate(identity, payload)
      else       await modificacionUpdate(identity, mod.id, payload)
      toast.success('Modificación guardada'); onSaved()
    } catch (e) { toast.error(e.message) }
    setSaving(false)
  }

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }}
         style={{ position: 'fixed', inset: 0, zIndex: 600, background: 'rgba(0,0,0,0.6)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: 'var(--bg-1)', borderRadius: 'var(--radius-lg)', width: '100%',
                    maxWidth: 520, boxShadow: 'var(--shadow-lg)' }}>
        <header style={{ padding: '18px 22px', borderBottom: '1px solid var(--line)',
                         display: 'flex', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--text-0)' }}>
            {isNew ? 'Nueva modificación' : 'Editar modificación'}
          </h2>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 8,
                  border: '1px solid var(--line)', background: 'var(--bg-3)',
                  color: 'var(--text-2)', cursor: 'pointer' }}><X size={14} /></button>
        </header>
        <form onSubmit={onSubmit} style={{ padding: 22 }}>
          {!identity.trainerId && (
            <div style={{ padding: 10, marginBottom: 14, borderRadius: 8,
                          background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)',
                          fontSize: 12, color: 'var(--amber)' }}>
              Las modificaciones siempre van asociadas a un trainer. Para crear una, impersonate
              un trainer desde el sidebar.
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Tipo *">
              <select value={data.tipo} onChange={e => set('tipo', e.target.value)} style={inputStyle}>
                {TIPOS_MODIFICACION.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="Importe (€) *">
              <input type="number" step="0.01" value={data.valor}
                     onChange={e => set('valor', parseFloat(e.target.value) || 0)} style={inputStyle} />
            </Field>
            <Field label="Vigente desde *">
              <input type="date" value={data.fecha_desde} onChange={e => set('fecha_desde', e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Vigente hasta">
              <input type="date" value={data.fecha_hasta} onChange={e => set('fecha_hasta', e.target.value)} style={inputStyle} />
            </Field>
          </div>
          <Field label="Cliente NoofitPro (opcional)">
            <input value={data.cliente_idnoofit} onChange={e => set('cliente_idnoofit', e.target.value)}
                   placeholder="ID NoofitPro o vacío para todos" style={inputStyle} />
          </Field>
          <Field label="Razón">
            <textarea value={data.razon} onChange={e => set('razon', e.target.value)} rows={3}
                      placeholder="Por qué se aplica esta modificación…"
                      style={{ ...inputStyle, resize: 'vertical' }} />
          </Field>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
            <Btn variant="secondary" type="button" onClick={onClose}>Cancelar</Btn>
            <Btn variant="primary" type="submit" disabled={saving || !identity.trainerId}>
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
  color: 'var(--text-0)', fontSize: 13, outline: 'none', fontFamily: 'inherit',
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
      {label && <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)',
                              textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>}
      {children}
    </label>
  )
}
