import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, Check, X, RefreshCw, Download, Loader2 } from 'lucide-react'
import { Card, Btn, Badge } from '../../components/UI'
import { useToast } from '../../components/Toast'
import {
  cuotasList, cuotaCreate, cuotaUpdate, cuotaDelete, cuotaAdoptar,
  FORMAS_PAGO, PERIODICIDADES,
} from '../../utils/configApi'
import { getActividades } from '../../utils/api'

const PRECIO_CAMPOS = [
  { id: 'precio_mensual',     label: 'Mensual' },
  { id: 'precio_bimensual',   label: 'Bimensual' },
  { id: 'precio_trimestral',  label: 'Trimestral' },
  { id: 'precio_semestral',   label: 'Semestral' },
  { id: 'precio_anual',       label: 'Anual' },
]


export default function CuotasTab({ identity }) {
  const toast = useToast()
  const [cuotas, setCuotas] = useState([])
  const [loading, setLoading] = useState(true)
  const [actividades, setActividades] = useState([])
  const [editing, setEditing] = useState(null)  // null = ninguno; objeto = nuevo/edit

  const isTrainer = !!identity.trainerId

  async function reload() {
    setLoading(true)
    try {
      const data = await cuotasList(identity)
      setCuotas(data || [])
    } catch (e) { toast.error(`Error cargando cuotas: ${e.message}`) }
    setLoading(false)
  }

  useEffect(() => {
    reload()
    getActividades().then(setActividades).catch(() => {})
  }, [identity.managerId, identity.trainerId])

  async function onAdoptar(id) {
    try {
      await cuotaAdoptar(identity, id)
      toast.success('Plantilla adoptada')
      reload()
    } catch (e) { toast.error(e.message) }
  }

  async function onDelete(c) {
    if (!confirm(`¿Eliminar cuota "${c.codigo}"?`)) return
    try {
      await cuotaDelete(identity, c.id)
      toast.success('Cuota eliminada')
      reload()
    } catch (e) { toast.error(e.message) }
  }

  // Filtrar plantillas vs trainer-cuotas para mostrar separado
  const plantillas    = cuotas.filter(c => c.scope === 'plantilla_manager')
  const trainerCuotas = cuotas.filter(c => c.scope === 'trainer')

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: 'var(--text-2)' }}>
          {loading ? 'Cargando…' : `${cuotas.length} cuota${cuotas.length !== 1 ? 's' : ''}`}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn variant="secondary" size="sm" onClick={reload}>
            <RefreshCw size={13} /> Refrescar
          </Btn>
          <Btn variant="primary" size="sm" onClick={() => setEditing({})}>
            <Plus size={13} /> Nueva cuota
          </Btn>
        </div>
      </div>

      {/* Plantillas del manager */}
      {plantillas.length > 0 && (
        <Section titulo={isTrainer ? 'Plantillas disponibles del manager' : 'Plantillas (manager)'}>
          {plantillas.map(c => (
            <CuotaRow key={c.id} cuota={c} actividades={actividades}
                      isTrainer={isTrainer}
                      onEdit={!isTrainer ? () => setEditing(c) : null}
                      onDelete={!isTrainer ? () => onDelete(c) : null}
                      onAdoptar={isTrainer && !cuotas.some(t => t.scope === 'trainer' && t.plantilla_origen_id === c.id) ? () => onAdoptar(c.id) : null} />
          ))}
        </Section>
      )}

      {/* Cuotas del trainer */}
      {isTrainer && trainerCuotas.length > 0 && (
        <Section titulo="Mis cuotas">
          {trainerCuotas.map(c => (
            <CuotaRow key={c.id} cuota={c} actividades={actividades}
                      isTrainer={isTrainer}
                      onEdit={() => setEditing(c)}
                      onDelete={() => onDelete(c)} />
          ))}
        </Section>
      )}

      {/* Sin datos */}
      {!loading && cuotas.length === 0 && (
        <Card style={{ padding: 32, textAlign: 'center' }}>
          <p style={{ fontSize: 14, color: 'var(--text-3)' }}>
            {isTrainer ? 'Ninguna cuota. El manager aún no ha definido plantillas y tú no has creado ninguna.'
                       : 'Sin plantillas. Crea la primera con «Nueva cuota».'}
          </p>
        </Card>
      )}

      {/* Modal edit */}
      {editing && (
        <CuotaForm cuota={editing} actividades={actividades}
                   onClose={() => setEditing(null)}
                   onSaved={() => { setEditing(null); reload() }}
                   identity={identity} />
      )}
    </div>
  )
}


function Section({ titulo, children }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700,
                   color: 'var(--text-3)', textTransform: 'uppercase',
                   letterSpacing: '0.05em', marginBottom: 8 }}>
        {titulo}
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {children}
      </div>
    </div>
  )
}


function CuotaRow({ cuota, actividades, isTrainer, onEdit, onDelete, onAdoptar }) {
  const nActs = (cuota.actividades_idnoofit || []).length
  return (
    <Card style={{ padding: '12px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, color: 'var(--text-0)' }}>
              {cuota.codigo}
            </span>
            {!cuota.active && <Badge color="gray">Inactiva</Badge>}
            {cuota.plantilla_origen_id && <Badge color="blue">Adoptada</Badge>}
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>{cuota.descripcion}</p>
          <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 11, color: 'var(--text-3)', flexWrap: 'wrap' }}>
            {cuota.precio_mensual    > 0 && <span>Mensual <strong style={{ color: 'var(--text-1)' }}>{cuota.precio_mensual}€</strong></span>}
            {cuota.precio_trimestral > 0 && <span>Trim <strong style={{ color: 'var(--text-1)' }}>{cuota.precio_trimestral}€</strong></span>}
            {cuota.precio_anual      > 0 && <span>Anual <strong style={{ color: 'var(--text-1)' }}>{cuota.precio_anual}€</strong></span>}
            {cuota.matricula > 0 && <span>Matr <strong style={{ color: 'var(--text-1)' }}>{cuota.matricula}€</strong></span>}
            <span>· {nActs} actividad{nActs !== 1 ? 'es' : ''}</span>
            <span>· {(cuota.formas_pago || []).length} forma{(cuota.formas_pago || []).length !== 1 ? 's' : ''} de pago</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {onAdoptar && <Btn variant="secondary" size="sm" onClick={onAdoptar}><Download size={12} /> Adoptar</Btn>}
          {onEdit && <Btn variant="secondary" size="sm" onClick={onEdit}><Pencil size={12} /> Editar</Btn>}
          {onDelete && <Btn variant="danger" size="sm" onClick={onDelete}><Trash2 size={12} /></Btn>}
        </div>
      </div>
    </Card>
  )
}


function CuotaForm({ cuota, actividades, onClose, onSaved, identity }) {
  const isNew = !cuota.id
  const toast = useToast()
  const [saving, setSaving] = useState(false)
  const [data, setData] = useState({
    codigo: cuota.codigo || '',
    descripcion: cuota.descripcion || '',
    precio_mensual: cuota.precio_mensual ?? 0,
    precio_bimensual: cuota.precio_bimensual ?? 0,
    precio_trimestral: cuota.precio_trimestral ?? 0,
    precio_semestral: cuota.precio_semestral ?? 0,
    precio_anual: cuota.precio_anual ?? 0,
    matricula: cuota.matricula ?? 0,
    formas_pago: cuota.formas_pago || [],
    periodicidades: cuota.periodicidades || [],
    actividades_idnoofit: cuota.actividades_idnoofit || [],
    active: cuota.active ?? true,
  })

  const set = (k, v) => setData(d => ({ ...d, [k]: v }))
  const toggleArray = (k, v) => set(k, data[k].includes(v) ? data[k].filter(x => x !== v) : [...data[k], v])

  async function onSubmit(e) {
    e.preventDefault()
    if (!data.codigo.trim()) { toast.error('Código obligatorio'); return }
    setSaving(true)
    try {
      if (isNew) await cuotaCreate(identity, data)
      else       await cuotaUpdate(identity, cuota.id, data)
      toast.success('Cuota guardada')
      onSaved()
    } catch (e) { toast.error(e.message) }
    setSaving(false)
  }

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }}
         style={{ position: 'fixed', inset: 0, zIndex: 600, background: 'rgba(0,0,0,0.6)',
                  backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', padding: 20 }}>
      <div style={{ background: 'var(--bg-1)', borderRadius: 'var(--radius-lg)', width: '100%',
                    maxWidth: 720, maxHeight: '90vh', overflow: 'auto',
                    boxShadow: 'var(--shadow-lg)' }}>
        <header style={{ padding: '18px 22px', borderBottom: '1px solid var(--line)',
                         display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, margin: 0,
                       color: 'var(--text-0)' }}>
            {isNew ? 'Nueva cuota' : `Editar ${cuota.codigo}`}
          </h2>
          <button onClick={onClose} aria-label="Cerrar"
                  style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid var(--line)',
                           background: 'var(--bg-3)', color: 'var(--text-2)', cursor: 'pointer',
                           display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <X size={14} />
          </button>
        </header>

        <form onSubmit={onSubmit} style={{ padding: 22 }}>
          {/* Código + descripción */}
          <Field label="Código *">
            <Input value={data.codigo} onChange={v => set('codigo', v)} placeholder="RT 1D" />
          </Field>
          <Field label="Descripción">
            <Input value={data.descripcion} onChange={v => set('descripcion', v)} placeholder="RT 1 día/semana" />
          </Field>

          {/* Precios */}
          <FieldGroup titulo="Precios por periodicidad">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
              {PRECIO_CAMPOS.map(p => (
                <Field key={p.id} label={p.label} small>
                  <Input type="number" step="0.01" value={data[p.id]} onChange={v => set(p.id, parseFloat(v) || 0)} suffix="€" />
                </Field>
              ))}
              <Field label="Matrícula" small>
                <Input type="number" step="0.01" value={data.matricula} onChange={v => set('matricula', parseFloat(v) || 0)} suffix="€" />
              </Field>
            </div>
          </FieldGroup>

          {/* Periodicidades disponibles */}
          <FieldGroup titulo="Periodicidades disponibles para esta cuota">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {PERIODICIDADES.map(p => (
                <Chip key={p.id} active={data.periodicidades.includes(p.id)}
                      onClick={() => toggleArray('periodicidades', p.id)}>
                  {p.label}
                </Chip>
              ))}
            </div>
          </FieldGroup>

          {/* Formas de pago aceptadas */}
          <FieldGroup titulo="Formas de pago aceptadas">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {FORMAS_PAGO.map(f => (
                <Chip key={f.id} active={data.formas_pago.includes(f.id)}
                      onClick={() => toggleArray('formas_pago', f.id)}>
                  {f.label}
                </Chip>
              ))}
            </div>
          </FieldGroup>

          {/* Actividades NoofitPro */}
          <FieldGroup titulo={`Actividades incluidas (${data.actividades_idnoofit.length} de ${actividades.length})`}>
            {actividades.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--text-3)' }}>Cargando actividades de NoofitPro…</p>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 220, overflow: 'auto', padding: 6,
                            border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-2)' }}>
                {actividades.map(a => {
                  const id = Number(a.id)
                  return (
                    <Chip key={id} active={data.actividades_idnoofit.includes(id)}
                          onClick={() => toggleArray('actividades_idnoofit', id)}>
                      {a.nombre || a.Nombre || `#${id}`}
                    </Chip>
                  )
                })}
              </div>
            )}
          </FieldGroup>

          {/* Active */}
          <FieldGroup titulo="Estado">
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={data.active} onChange={e => set('active', e.target.checked)} />
              <span style={{ fontSize: 13, color: 'var(--text-1)' }}>Cuota activa</span>
            </label>
          </FieldGroup>

          {/* Buttons */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16, paddingTop: 16,
                        borderTop: '1px solid var(--line)' }}>
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


function Field({ label, children, small }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: small ? 0 : 12 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)',
                     textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </span>
      {children}
    </label>
  )
}

function FieldGroup({ titulo, children }) {
  return (
    <fieldset style={{ border: 'none', padding: 0, marginBottom: 14 }}>
      <legend style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)',
                       textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
        {titulo}
      </legend>
      {children}
    </fieldset>
  )
}

function Input({ value, onChange, suffix, type = 'text', placeholder, step }) {
  return (
    <div style={{ position: 'relative', display: 'flex' }}>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
             placeholder={placeholder} step={step}
             style={{ flex: 1, padding: '8px 10px', borderRadius: 'var(--radius-sm)',
                      background: 'var(--bg-2)', border: '1px solid var(--line)',
                      color: 'var(--text-0)', fontSize: 13, outline: 'none',
                      paddingRight: suffix ? 28 : undefined }} />
      {suffix && <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                                fontSize: 12, color: 'var(--text-3)' }}>{suffix}</span>}
    </div>
  )
}

function Chip({ active, onClick, children }) {
  return (
    <button type="button" onClick={onClick}
            style={{ padding: '6px 11px', borderRadius: 'var(--radius-pill)',
                     background: active ? 'var(--green-bg)' : 'var(--bg-3)',
                     border: `1px solid ${active ? 'var(--green-border)' : 'var(--line)'}`,
                     color: active ? 'var(--green)' : 'var(--text-2)',
                     fontSize: 12, fontWeight: active ? 600 : 500,
                     cursor: 'pointer', transition: 'all 0.1s' }}>
      {children}
    </button>
  )
}
