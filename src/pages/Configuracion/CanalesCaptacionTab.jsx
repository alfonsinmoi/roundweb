// CRUD de canales de captación.
// Cada canal mapea uno o varios valores de `utm_source` (los que entran
// por la URL del formulario WP) a un nombre amigable + color. Sirve para
// el informe de "eficacia por canal" del CRM.

import { useState, useEffect } from 'react'
import { Plus, Save, Trash2, Loader2, Edit2, X, Megaphone } from 'lucide-react'
import { Card, Btn, Badge, EmptyState } from '../../components/UI'
import { useToast } from '../../components/Toast'
import { canalesList, canalCreate, canalUpdate, canalDelete } from '../../utils/configApi'

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
  nombre: '', color: 'cyan',
  utm_source_match: [],
  notas: '', activa: true, orden: 0,
}

export default function CanalesCaptacionTab({ identity }) {
  const toast = useToast()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [showInactivos, setShowInactivos] = useState(false)
  const [editing, setEditing] = useState(null)   // null | 'new' | id
  const [form, setForm] = useState(EMPTY)
  const [matchText, setMatchText] = useState('')  // utms separados por coma
  const [saving, setSaving] = useState(false)

  const reload = async () => {
    setLoading(true)
    try {
      const rows = await canalesList(identity, showInactivos)
      setItems(rows)
    } catch (e) {
      toast.error('Error cargando canales: ' + e.message)
    } finally { setLoading(false) }
  }
  useEffect(() => { reload() }, [identity?.managerId, showInactivos])

  function startEdit(canal) {
    setEditing(canal.id)
    setForm({
      nombre: canal.nombre, color: canal.color || 'cyan',
      utm_source_match: canal.utm_source_match || [],
      notas: canal.notas || '', activa: canal.activa, orden: canal.orden || 0,
    })
    setMatchText((canal.utm_source_match || []).join(', '))
  }
  function startNew() {
    setEditing('new'); setForm(EMPTY); setMatchText('')
  }
  function cancel() {
    setEditing(null); setForm(EMPTY); setMatchText('')
  }

  async function save() {
    if (!form.nombre.trim()) { toast.error('El nombre es obligatorio'); return }
    const utms = matchText.split(/[,\n]/).map(s => s.trim().toLowerCase()).filter(Boolean)
    const payload = { ...form, utm_source_match: utms }
    setSaving(true)
    try {
      if (editing === 'new') {
        await canalCreate(identity, payload)
        toast.success('Canal creado')
      } else {
        await canalUpdate(identity, editing, payload)
        toast.success('Canal actualizado')
      }
      cancel()
      await reload()
    } catch (e) {
      toast.error('Error: ' + e.message)
    } finally { setSaving(false) }
  }

  async function del(canal) {
    if (!confirm(`¿Desactivar el canal "${canal.nombre}"? Los leads pasados conservan su asignación.`)) return
    try {
      await canalDelete(identity, canal.id, false)
      toast.success('Canal desactivado')
      await reload()
    } catch (e) { toast.error('Error: ' + e.message) }
  }
  async function reactivar(canal) {
    try {
      await canalUpdate(identity, canal.id, { activa: true })
      toast.success('Canal reactivado')
      await reload()
    } catch (e) { toast.error('Error: ' + e.message) }
  }

  return (
    <div>
      <Card>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8 }}>
          <Megaphone size={18} style={{ color:'var(--green)' }} />
          <h2 style={{ margin:0, fontSize:18, fontFamily:'var(--font-display)' }}>
            Canales de captación
          </h2>
        </div>
        <p style={{ fontSize:13, color:'var(--text-2)', marginBottom:14 }}>
          Mapea los valores de <code>utm_source</code> que entran por la web del
          formulario público a un canal con nombre amigable. Sirve para el
          informe "Eficacia por canal" del CRM. Un mismo canal puede agrupar
          varios <code>utm_source</code> (p. ej. <code>instagram</code>, <code>ig</code>, <code>meta_ad</code>).
        </p>

        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
          <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, color:'var(--text-2)' }}>
            <input type="checkbox" checked={showInactivos} onChange={e => setShowInactivos(e.target.checked)} />
            Mostrar inactivos
          </label>
          <Btn onClick={startNew} disabled={editing==='new'}>
            <Plus size={14} /> Nuevo canal
          </Btn>
        </div>

        {loading ? (
          <div style={{ padding:30, textAlign:'center', color:'var(--text-3)' }}>
            <Loader2 size={20} className="spin" /> Cargando…
          </div>
        ) : items.length === 0 && editing !== 'new' ? (
          <EmptyState
            icon={<Megaphone size={32} />}
            title="Sin canales configurados"
            subtitle="Crea el primero para empezar a clasificar tus leads por origen."
          />
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {editing === 'new' && (
              <CanalRow form={form} setForm={setForm}
                        matchText={matchText} setMatchText={setMatchText}
                        onSave={save} onCancel={cancel}
                        saving={saving} isNew />
            )}
            {items.map(c => editing === c.id ? (
              <CanalRow key={c.id} form={form} setForm={setForm}
                        matchText={matchText} setMatchText={setMatchText}
                        onSave={save} onCancel={cancel} saving={saving} />
            ) : (
              <ViewRow key={c.id} canal={c}
                       onEdit={() => startEdit(c)}
                       onDelete={() => del(c)}
                       onReactivar={() => reactivar(c)} />
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

function ViewRow({ canal, onEdit, onDelete, onReactivar }) {
  return (
    <div style={{
      display:'flex', alignItems:'center', gap:12,
      padding:'10px 12px', border:'1px solid var(--line)', borderRadius:8,
      background: canal.activa ? 'var(--bg-1)' : 'var(--bg-2)',
      opacity: canal.activa ? 1 : 0.6,
    }}>
      <Badge color={canal.color || 'cyan'}>{canal.nombre}</Badge>
      <div style={{ flex:1, fontSize:13, color:'var(--text-2)' }}>
        <code style={{ fontSize:11 }}>
          {(canal.utm_source_match || []).join(', ') || <em style={{ color:'var(--text-3)' }}>(sin UTMs asociadas)</em>}
        </code>
        {canal.notas && <div style={{ fontSize:11, color:'var(--text-3)', marginTop:2 }}>{canal.notas}</div>}
      </div>
      <div style={{ display:'flex', gap:6 }}>
        <Btn variant="ghost" onClick={onEdit} title="Editar"><Edit2 size={14} /></Btn>
        {canal.activa ? (
          <Btn variant="ghost" onClick={onDelete} title="Desactivar" style={{ color:'var(--red)' }}>
            <Trash2 size={14} />
          </Btn>
        ) : (
          <Btn variant="ghost" onClick={onReactivar} title="Reactivar">Reactivar</Btn>
        )}
      </div>
    </div>
  )
}

function CanalRow({ form, setForm, matchText, setMatchText, onSave, onCancel, saving, isNew }) {
  return (
    <div style={{
      display:'grid', gap:8,
      gridTemplateColumns:'1fr 100px 1fr',
      padding:'12px', border:'1px dashed var(--green)', borderRadius:8,
      background:'var(--bg-2)',
    }}>
      <div>
        <label style={{ fontSize:11, color:'var(--text-3)' }}>Nombre del canal *</label>
        <input value={form.nombre}
               onChange={e => setForm({ ...form, nombre: e.target.value })}
               placeholder="Ej: Instagram"
               style={inputStyle} autoFocus />
      </div>
      <div>
        <label style={{ fontSize:11, color:'var(--text-3)' }}>Color</label>
        <select value={form.color}
                onChange={e => setForm({ ...form, color: e.target.value })}
                style={inputStyle}>
          {COLORES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </div>
      <div>
        <label style={{ fontSize:11, color:'var(--text-3)' }}>
          UTM sources que mapean a este canal (separadas por coma)
        </label>
        <input value={matchText}
               onChange={e => setMatchText(e.target.value)}
               placeholder="instagram, ig, meta_ad"
               style={inputStyle} />
      </div>
      <div style={{ gridColumn:'1 / -1' }}>
        <label style={{ fontSize:11, color:'var(--text-3)' }}>Notas (opcional)</label>
        <input value={form.notas}
               onChange={e => setForm({ ...form, notas: e.target.value })}
               placeholder="Por ejemplo: canal orgánico, sin pago"
               style={inputStyle} />
      </div>
      <div style={{ gridColumn:'1 / -1', display:'flex', justifyContent:'flex-end', gap:8, marginTop:4 }}>
        <Btn variant="ghost" onClick={onCancel} disabled={saving}><X size={14} /> Cancelar</Btn>
        <Btn onClick={onSave} disabled={saving}>
          {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />} Guardar
        </Btn>
      </div>
    </div>
  )
}

const inputStyle = {
  width:'100%', padding:'6px 10px', fontSize:13,
  border:'1px solid var(--line)', borderRadius:6, background:'var(--bg-1)',
  color:'var(--text-1)', fontFamily:'var(--font-mono)',
  boxSizing:'border-box',
}
