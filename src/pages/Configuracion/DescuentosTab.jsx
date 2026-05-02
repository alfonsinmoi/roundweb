import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, Check, X, RefreshCw, Download, Loader2, Users } from 'lucide-react'
import { Card, Btn, Badge, Avatar } from '../../components/UI'
import { useToast } from '../../components/Toast'
import {
  descuentosList, descuentoCreate, descuentoUpdate, descuentoDelete, descuentoAdoptar,
  asignacionesList, asignacionCreate, asignacionDelete,
  TIPOS_DESCUENTO,
} from '../../utils/configApi'
import { getClientes } from '../../utils/api'


export default function DescuentosTab({ identity }) {
  const toast = useToast()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [asignandoDesc, setAsignandoDesc] = useState(null)  // descuento sobre el que abrir modal
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
                     onAsignar={!isTrainer ? () => setAsignandoDesc(d) : null}
                     onAdoptar={isTrainer && !items.some(t => t.scope === 'trainer' && t.plantilla_origen_id === d.id) ? () => onAdoptar(d.id) : null} />
          ))}
        </Section>
      )}

      {isTrainer && propios.length > 0 && (
        <Section titulo="Mis descuentos">
          {propios.map(d => (
            <DescRow key={d.id} d={d} isTrainer
                     onEdit={() => setEditing(d)} onDelete={() => onDelete(d)}
                     onAsignar={() => setAsignandoDesc(d)} />
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

      {asignandoDesc && (
        <AsignarModal desc={asignandoDesc} identity={identity}
                      onClose={() => setAsignandoDesc(null)} />
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

function DescRow({ d, isTrainer, onEdit, onDelete, onAdoptar, onAsignar }) {
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
          {onAsignar && <Btn variant="secondary" size="sm" onClick={onAsignar}><Users size={12} /> Asignar</Btn>}
          {onAdoptar && <Btn variant="secondary" size="sm" onClick={onAdoptar}><Download size={12} /> Adoptar</Btn>}
          {onEdit && <Btn variant="secondary" size="sm" onClick={onEdit}><Pencil size={12} /></Btn>}
          {onDelete && <Btn variant="danger" size="sm" onClick={onDelete}><Trash2 size={12} /></Btn>}
        </div>
      </div>
    </Card>
  )
}


// ── Modal: asignar descuento a clientes ──────────────────────────────────────
function AsignarModal({ desc, identity, onClose }) {
  const toast = useToast()
  const [clientes, setClientes] = useState([])
  const [asignaciones, setAsignaciones] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(new Set())
  const [fechaDesde, setFechaDesde] = useState(new Date().toISOString().slice(0, 10))
  const [fechaHasta, setFechaHasta] = useState('')
  const [saving, setSaving] = useState(false)

  async function loadAll() {
    setLoading(true)
    try {
      const [cls, asigs] = await Promise.all([
        getClientes(),
        asignacionesList(identity, desc.id),
      ])
      setClientes(cls || [])
      setAsignaciones(asigs || [])
    } catch (e) { toast.error(e.message) }
    setLoading(false)
  }
  useEffect(() => { loadAll() }, [desc.id])

  const yaAsignados = new Set(asignaciones.map(a => String(a.cliente_idnoofit)))
  const candidatos = clientes.filter(c => {
    const id = String(c.id)
    if (yaAsignados.has(id)) return false
    if (!search) return true
    const q = search.toLowerCase()
    return (c.nombre || c.name || '').toLowerCase().includes(q)
        || (c.apellidos || c.surname || '').toLowerCase().includes(q)
        || (c.email || '').toLowerCase().includes(q)
        || id.includes(q)
  })

  function toggleSelect(id) {
    const s = new Set(selected)
    if (s.has(id)) s.delete(id); else s.add(id)
    setSelected(s)
  }

  async function onAsignar() {
    if (selected.size === 0) { toast.error('Selecciona al menos 1 cliente'); return }
    setSaving(true)
    try {
      const r = await asignacionCreate(identity, desc.id, {
        clientes_idnoofit: [...selected],
        fecha_desde: fechaDesde || null,
        fecha_hasta: fechaHasta || null,
      })
      const nCreadas = r.creadas?.length ?? 0
      const nExist = r.ya_existentes?.length ?? 0
      toast.success(`${nCreadas} asignaciones creadas${nExist ? `, ${nExist} ya existían` : ''}`)
      setSelected(new Set())
      loadAll()
    } catch (e) { toast.error(e.message) }
    setSaving(false)
  }

  async function onRevocar(asigId) {
    try {
      await asignacionDelete(identity, desc.id, asigId)
      toast.success('Asignación revocada')
      loadAll()
    } catch (e) { toast.error(e.message) }
  }

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }}
         style={{ position: 'fixed', inset: 0, zIndex: 600, background: 'rgba(0,0,0,0.6)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: 'var(--bg-1)', borderRadius: 'var(--radius-lg)', width: '100%',
                    maxWidth: 720, maxHeight: '90vh', overflow: 'hidden',
                    boxShadow: 'var(--shadow-lg)', display: 'flex', flexDirection: 'column' }}>
        <header style={{ padding: '18px 22px', borderBottom: '1px solid var(--line)',
                         display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--text-0)' }}>
              Asignar descuento <span style={{ color: 'var(--green)' }}>{desc.codigo}</span> a clientes
            </h2>
            <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '2px 0 0' }}>
              {desc.tipo === 'porcentaje' ? `${desc.valor}%` : `${desc.valor}€`} · {desc.descripcion}
            </p>
          </div>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 8,
                  border: '1px solid var(--line)', background: 'var(--bg-3)',
                  color: 'var(--text-2)', cursor: 'pointer' }}><X size={14} /></button>
        </header>

        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14, overflow: 'hidden', flex: 1 }}>
          {/* Asignaciones existentes */}
          {asignaciones.length > 0 && (
            <div>
              <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)',
                          textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
                Ya asignados ({asignaciones.length})
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 100, overflowY: 'auto' }}>
                {asignaciones.map(a => {
                  const c = clientes.find(x => String(x.id) === String(a.cliente_idnoofit))
                  const nombre = c ? `${c.nombre || c.name || ''} ${c.apellidos || c.surname || ''}`.trim() : `#${a.cliente_idnoofit}`
                  return (
                    <span key={a.id} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      padding: '4px 10px', borderRadius: 'var(--radius-pill)',
                      background: 'var(--green-bg)', border: '1px solid var(--green-border)',
                      fontSize: 12, color: 'var(--green)' }}>
                      {nombre}
                      <button onClick={() => onRevocar(a.id)} title="Revocar"
                              style={{ background: 'none', border: 'none', cursor: 'pointer',
                                       color: 'var(--green)', padding: 0, display: 'flex' }}>
                        <X size={12} />
                      </button>
                    </span>
                  )
                })}
              </div>
            </div>
          )}

          {/* Buscador + lista */}
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8, marginBottom: 8 }}>
              <input type="text" placeholder="Buscar cliente por nombre, email o ID…"
                     value={search} onChange={e => setSearch(e.target.value)}
                     style={inputStyle} />
              <input type="date" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)}
                     title="Vigente desde"
                     style={{ ...inputStyle, width: 140 }} />
              <input type="date" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)}
                     title="Vigente hasta (vacío = sin fin)"
                     style={{ ...inputStyle, width: 140 }} />
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6 }}>
              {candidatos.length} cliente{candidatos.length !== 1 ? 's' : ''} disponibles · {selected.size} seleccionado{selected.size !== 1 ? 's' : ''}
            </p>
            <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)',
                          background: 'var(--bg-2)', maxHeight: 300, overflowY: 'auto' }}>
              {loading ? (
                <p style={{ padding: 16, fontSize: 13, color: 'var(--text-3)' }}>Cargando…</p>
              ) : candidatos.length === 0 ? (
                <p style={{ padding: 16, fontSize: 13, color: 'var(--text-3)' }}>
                  {search ? 'Sin coincidencias' : 'Todos los clientes ya están asignados o no hay clientes en NoofitPro'}
                </p>
              ) : candidatos.slice(0, 200).map(c => {
                const id = String(c.id)
                const isSel = selected.has(id)
                const nombre = `${c.nombre || c.name || ''} ${c.apellidos || c.surname || ''}`.trim()
                return (
                  <label key={id} style={{ display: 'flex', alignItems: 'center', gap: 10,
                                           padding: '8px 12px', borderBottom: '1px solid var(--line)',
                                           cursor: 'pointer',
                                           background: isSel ? 'var(--green-bg)' : 'transparent' }}>
                    <input type="checkbox" checked={isSel} onChange={() => toggleSelect(id)} />
                    <Avatar nombre={nombre} size={28} imgUrl={c.imgUrl} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 13, color: 'var(--text-0)', fontWeight: 500 }}>{nombre || `#${id}`}</p>
                      <p style={{ fontSize: 11, color: 'var(--text-3)' }}>{c.email}</p>
                    </div>
                    <span style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>#{id}</span>
                  </label>
                )
              })}
              {candidatos.length > 200 && (
                <p style={{ padding: 12, fontSize: 12, color: 'var(--text-3)', textAlign: 'center' }}>
                  Mostrando primeros 200. Refina la búsqueda para ver más.
                </p>
              )}
            </div>
          </div>
        </div>

        <footer style={{ padding: '14px 22px', borderTop: '1px solid var(--line)',
                         display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn variant="secondary" onClick={onClose}>Cerrar</Btn>
          <Btn variant="primary" onClick={onAsignar} disabled={saving || selected.size === 0}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {saving ? ' Asignando…' : ` Asignar (${selected.size})`}
          </Btn>
        </footer>
      </div>
    </div>
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
