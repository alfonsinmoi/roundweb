// Configuración Contabilidad: toggle per trainer + categorías + visibilidades.

import { useState, useEffect, useMemo } from 'react'
import { Calculator, Save, Loader2, Edit2, Trash2, Plus, X, Check, Eye, EyeOff } from 'lucide-react'
import { Card, Btn, Badge, SectionTitle, Avatar, EmptyState } from '../../components/UI'
import { useToast } from '../../components/Toast'
import {
  contabConfigGet, contabConfigPut,
  contabCatsList, contabCatCreate, contabCatUpdate, contabCatDelete, contabCatVisPut,
  contabListadosGet, contabListadoVisPut,
} from '../../utils/configApi'
import { getEntrenadores } from '../../utils/api'
import { useOdooStatus } from '../../hooks/useOdooStatus'
import TrainersContabilidad from '../../components/TrainersContabilidad'

const TIPOS = [
  { id: 'gasto',     label: 'Gasto' },
  { id: 'nomina',    label: 'Nómina' },
  { id: 'banco',     label: 'Banco' },
  { id: 'impuesto',  label: 'Impuesto' },
  { id: 'otro',      label: 'Otro' },
]
const PERIOD = [
  { id: '',           label: '— sin periodicidad' },
  { id: 'mensual',    label: 'Mensual' },
  { id: 'trimestral', label: 'Trimestral' },
  { id: 'anual',      label: 'Anual' },
]
const COLORES = ['amber','blue','green','red','purple','cyan','orange','gray']

export default function ContabilidadTab({ identity }) {
  const toast = useToast()
  const [tab, setTab] = useState('trainers')   // trainers | categorias | listados
  // En Fase 6 esta pestaña SOLO se ve si el módulo Contabilidad ya está
  // activado (gateada vía featureFlag='contabilidad' en Configuracion.jsx).
  // Ya no necesitamos el banner de activación — vive en Suscripciones.

  return (
    <div>
      {/* Analytic per-trainer (heredar/no heredar contabilidad) */}
      <TrainersContabilidad identity={identity} />

      <div role="tablist" style={{ display: 'flex', gap: 6, marginBottom: 16, borderBottom: '1px solid var(--line)' }}>
        {[
          ['trainers', '⚙️ Activación per trainer'],
          ['categorias', '📋 Categorías de gasto'],
          ['listados', '👁️ Visibilidad de listados'],
        ].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} role="tab" aria-selected={tab === id}
                  style={{
                    padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 13, fontWeight: tab === id ? 700 : 500,
                    color: tab === id ? 'var(--text-0)' : 'var(--text-2)',
                    borderBottom: tab === id ? '2px solid var(--green)' : '2px solid transparent',
                    marginBottom: -1,
                  }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'trainers'   && <TabTrainers identity={identity} />}
      {tab === 'categorias' && <TabCategorias identity={identity} />}
      {tab === 'listados'   && <TabListados identity={identity} />}
    </div>
  )
}


function TabTrainers({ identity }) {
  const toast = useToast()
  const [trainers, setTrainers] = useState([])
  const [config, setConfig] = useState([])
  const [loading, setLoading] = useState(true)

  const reload = async () => {
    setLoading(true)
    try {
      const [t, c] = await Promise.all([
        getEntrenadores().catch(() => []),
        contabConfigGet(identity).catch(() => []),
      ])
      setTrainers(t || [])
      setConfig(c || [])
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setLoading(false)
  }
  useEffect(() => { reload() }, [identity?.managerId])

  const cfgByTrainer = Object.fromEntries(config.map(c => [String(c.id_trainer), c]))

  const toggle = async (trainer) => {
    const cur = cfgByTrainer[String(trainer.id)]
    const newActivo = !(cur?.activo)
    try {
      await contabConfigPut(identity, trainer.id, { activo: newActivo, notas: cur?.notas })
      toast.success(newActivo ? 'Contabilidad activada' : 'Contabilidad desactivada')
      reload()
    } catch (e) { toast.error(`Error: ${e.message}`) }
  }

  if (loading) return <Spinner />

  return (
    <Card style={{ padding: 20 }}>
      <SectionTitle>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Calculator size={16} /> Activación per trainer
        </span>
      </SectionTitle>
      <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 14 }}>
        Marca para qué trainers el manager controla la contabilidad. Solo verán
        la pestaña <strong>Contabilidad</strong> en la web los trainers que
        tengan esto activado.
      </p>
      {trainers.length === 0 ? (
        <EmptyState title="Sin trainers" description="Configura primero los centros." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {trainers.map(t => {
            const cfg = cfgByTrainer[String(t.id)]
            const activo = !!cfg?.activo
            return (
              <div key={t.id} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: 12,
                borderRadius: 12, border: '1px solid var(--line)', background: 'var(--bg-1)',
              }}>
                <Avatar nombre={`${t.nombre || t.name || ''} ${t.apellidos || t.surname || ''}`} size={36} imgUrl={t.imgUrl} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 14, fontWeight: 600 }}>
                    {t.nombre || t.name} {t.apellidos || t.surname}
                  </p>
                  <p style={{ fontSize: 11, color: 'var(--text-3)' }}>
                    {t.email} · ID {t.id}
                  </p>
                </div>
                <button onClick={() => toggle(t)}
                        style={{
                          padding: '8px 14px', borderRadius: 999, border: 'none', cursor: 'pointer',
                          background: activo ? 'var(--green)' : 'var(--bg-3)',
                          color: activo ? '#000' : 'var(--text-2)',
                          fontWeight: 600, fontSize: 12,
                        }}>
                  {activo ? '✓ Activo' : 'Inactivo'}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}


function TabCategorias({ identity }) {
  const toast = useToast()
  const [items, setItems] = useState([])
  const [trainers, setTrainers] = useState([])
  const [vis, setVis] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [showInactive, setShowInactive] = useState(false)
  const [filtroTipo, setFiltroTipo] = useState('')

  const reload = async () => {
    setLoading(true)
    try {
      const [d, t] = await Promise.all([
        contabCatsList(identity),
        getEntrenadores().catch(() => []),
      ])
      setItems(d.categorias || [])
      setVis(d.visibilidad || [])
      setTrainers(t || [])
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setLoading(false)
  }
  useEffect(() => { reload() }, [identity?.managerId])

  const filtered = useMemo(() => items.filter(c =>
    (showInactive || c.activa) && (!filtroTipo || c.tipo === filtroTipo)
  ), [items, showInactive, filtroTipo])

  const visMap = useMemo(() => {
    // {catId: {trainerId: visible}}
    const m = {}
    for (const v of vis) {
      m[v.categoria_id] = m[v.categoria_id] || {}
      m[v.categoria_id][String(v.id_trainer)] = v.visible
    }
    return m
  }, [vis])

  const save = async (data) => {
    try {
      if (data.id) {
        await contabCatUpdate(identity, data.id, data)
        toast.success('Categoría actualizada')
      } else {
        await contabCatCreate(identity, data)
        toast.success('Categoría creada')
      }
      setEditing(null)
      reload()
    } catch (e) { toast.error(`Error: ${e.message}`) }
  }
  const remove = async (cat) => {
    if (!confirm(`Eliminar categoría "${cat.nombre}"?`)) return
    try {
      const r = await contabCatDelete(identity, cat.id)
      toast.success(r.mode === 'deactivated' ? 'Desactivada (en uso)' : 'Eliminada')
      reload()
    } catch (e) { toast.error(`Error: ${e.message}`) }
  }
  const toggleVis = async (cat, trainerId, currentVisible) => {
    try {
      await contabCatVisPut(identity, cat.id, trainerId, !currentVisible)
      reload()
    } catch (e) { toast.error(`Error: ${e.message}`) }
  }

  if (loading) return <Spinner />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card style={{ padding: 16 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)} style={inp}>
            <option value="">Todos los tipos</option>
            {TIPOS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-2)', cursor: 'pointer' }}>
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
            Mostrar inactivas
          </label>
          <div style={{ flex: 1 }} />
          {editing == null && (
            <Btn size="sm" onClick={() => setEditing({})}><Plus size={13} /> Nueva</Btn>
          )}
        </div>
      </Card>

      {editing && (
        <CategoriaForm initial={editing} trainers={trainers}
                       onCancel={() => setEditing(null)} onSave={save} />
      )}

      {filtered.length === 0 ? (
        <EmptyState title="Sin categorías" />
      ) : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 110px',
                         padding: '10px 16px', background: 'var(--bg-3)',
                         fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase' }}>
            <span>Nombre</span><span>Tipo</span><span>Periodicidad</span><span>Cuenta Odoo</span><span>IVA %</span><span></span>
          </div>
          {filtered.map((c, i) => (
            <div key={c.id} style={{
              display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 110px',
              padding: '10px 16px', alignItems: 'center', fontSize: 13,
              borderTop: i > 0 ? '1px solid var(--line)' : 'none',
              opacity: c.activa ? 1 : 0.55,
            }}>
              <div>
                <Badge color={c.color || 'gray'}>{c.nombre}</Badge>
                <span style={{ fontSize: 10, color: 'var(--text-3)', marginLeft: 8, fontFamily: 'monospace' }}>{c.codigo}</span>
                {trainers.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                    {trainers.map(t => {
                      const visible = visMap[c.id]?.[String(t.id)]
                      const v = visible === undefined ? true : visible
                      return (
                        <button key={t.id} onClick={() => toggleVis(c, t.id, v)}
                                title={v ? `Visible para ${t.nombre || t.name}` : `Oculta para ${t.nombre || t.name}`}
                                style={{
                                  fontSize: 10, padding: '3px 7px', borderRadius: 6,
                                  background: v ? 'var(--green-bg)' : 'var(--bg-3)',
                                  color: v ? 'var(--green)' : 'var(--text-3)',
                                  border: `1px solid ${v ? 'var(--green-border)' : 'var(--line)'}`,
                                  cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3,
                                }}>
                          {v ? <Eye size={9} /> : <EyeOff size={9} />}
                          {(t.nombre || t.name || '').split(' ')[0]}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
              <span>{TIPOS.find(t => t.id === c.tipo)?.label || c.tipo}</span>
              <span>{c.periodicidad || '—'}</span>
              <span style={{ fontFamily: 'monospace' }}>{c.cuenta_contable_odoo || '—'}</span>
              <span>{c.iva_default != null ? `${c.iva_default}%` : '—'}</span>
              <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                <button onClick={() => setEditing(c)} style={iconBtn} aria-label="Editar"><Edit2 size={12} /></button>
                <button onClick={() => remove(c)} style={{...iconBtn, color: 'var(--red)'}} aria-label="Borrar"><Trash2 size={12} /></button>
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}


function CategoriaForm({ initial, trainers, onCancel, onSave }) {
  const [f, setF] = useState({
    id: initial.id, codigo: initial.codigo || '', nombre: initial.nombre || '',
    tipo: initial.tipo || 'gasto', periodicidad: initial.periodicidad || '',
    proveedor_default: initial.proveedor_default || '',
    cuenta_contable_odoo: initial.cuenta_contable_odoo || '',
    iva_default: initial.iva_default != null ? String(initial.iva_default) : '21.00',
    color: initial.color || 'gray', orden: initial.orden || 100,
    activa: initial.activa !== false,
  })
  return (
    <Card style={{ padding: 16, borderColor: 'var(--green-border)' }}>
      <h4 style={{ margin: 0, marginBottom: 10, fontFamily: 'Outfit', fontSize: 14, fontWeight: 700 }}>
        {f.id ? 'Editar categoría' : 'Nueva categoría'}
      </h4>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
        <Lbl text="Código *">
          <input value={f.codigo} onChange={e => setF({ ...f, codigo: e.target.value.toLowerCase() })}
                 disabled={!!f.id} placeholder="luz, agua…" style={inp} />
        </Lbl>
        <Lbl text="Nombre *">
          <input value={f.nombre} onChange={e => setF({ ...f, nombre: e.target.value })} style={inp} />
        </Lbl>
        <Lbl text="Tipo">
          <select value={f.tipo} onChange={e => setF({ ...f, tipo: e.target.value })} style={inp}>
            {TIPOS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </Lbl>
        <Lbl text="Periodicidad">
          <select value={f.periodicidad} onChange={e => setF({ ...f, periodicidad: e.target.value })} style={inp}>
            {PERIOD.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </Lbl>
        <Lbl text="Cuenta contable Odoo">
          <input value={f.cuenta_contable_odoo} onChange={e => setF({ ...f, cuenta_contable_odoo: e.target.value })}
                 placeholder="628000" style={inp} />
        </Lbl>
        <Lbl text="IVA %">
          <input type="number" step="0.01" value={f.iva_default}
                 onChange={e => setF({ ...f, iva_default: e.target.value })} style={inp} />
        </Lbl>
        <Lbl text="Proveedor default">
          <input value={f.proveedor_default} onChange={e => setF({ ...f, proveedor_default: e.target.value })} style={inp} />
        </Lbl>
        <Lbl text="Color">
          <select value={f.color} onChange={e => setF({ ...f, color: e.target.value })} style={inp}>
            {COLORES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </Lbl>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
        <Btn variant="secondary" size="sm" onClick={onCancel}><X size={13} /> Cancelar</Btn>
        <Btn variant="primary" size="sm" onClick={() => onSave({
          ...f,
          iva_default: f.iva_default ? parseFloat(f.iva_default) : null,
          orden: parseInt(f.orden) || 100,
        })}><Save size={13} /> Guardar</Btn>
      </div>
    </Card>
  )
}


function TabListados({ identity }) {
  const toast = useToast()
  const [trainers, setTrainers] = useState([])
  const [data, setData] = useState({ catalogo: [], por_trainer: {} })
  const [loading, setLoading] = useState(true)

  const reload = async () => {
    setLoading(true)
    try {
      const [t, d] = await Promise.all([getEntrenadores().catch(() => []), contabListadosGet(identity)])
      setTrainers(t || [])
      setData({ catalogo: d.catalogo || [], por_trainer: d.por_trainer || {} })
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setLoading(false)
  }
  useEffect(() => { reload() }, [identity?.managerId])

  const toggle = async (trainer, listado, current) => {
    try {
      await contabListadoVisPut(identity, trainer.id, listado.id, !current)
      reload()
    } catch (e) { toast.error(`Error: ${e.message}`) }
  }

  if (loading) return <Spinner />

  return (
    <Card style={{ padding: 20 }}>
      <SectionTitle><span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Eye size={16} /> Visibilidad de listados</span></SectionTitle>
      <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 14 }}>
        Define qué listados ve cada trainer cuando entre en Contabilidad. Por defecto todos visibles.
      </p>
      {trainers.length === 0 ? (
        <EmptyState title="Sin trainers" />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--line)' }}>
                <th style={{ textAlign: 'left', padding: 8, fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase' }}>Listado</th>
                {trainers.map(t => (
                  <th key={t.id} style={{ textAlign: 'center', padding: 8, fontSize: 11, color: 'var(--text-3)' }}>
                    {(t.nombre || t.name || '').split(' ')[0]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.catalogo.map(l => (
                <tr key={l.id} style={{ borderBottom: '1px solid var(--line)' }}>
                  <td style={{ padding: 8 }}>{l.nombre}</td>
                  {trainers.map(t => {
                    const cur = data.por_trainer[String(t.id)]?.[l.id]
                    const v = cur === undefined ? true : cur
                    return (
                      <td key={t.id} style={{ textAlign: 'center', padding: 8 }}>
                        <button onClick={() => toggle(t, l, v)}
                                style={{
                                  padding: '4px 10px', borderRadius: 999, border: 'none', cursor: 'pointer',
                                  background: v ? 'var(--green-bg)' : 'var(--bg-3)',
                                  color: v ? 'var(--green)' : 'var(--text-3)',
                                }}>
                          {v ? <Check size={12} /> : <X size={12} />}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}


// ── Helpers ────────────────────────────────────────────────────────────────
function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
      <Loader2 size={20} className="animate-spin" style={{ color: 'var(--green)' }} />
    </div>
  )
}
function Lbl({ text, children }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 3 }}>
        {text}
      </span>
      {children}
    </label>
  )
}
const inp = {
  width: '100%', padding: '7px 10px', borderRadius: 8, fontSize: 13,
  background: 'var(--bg-1)', border: '1px solid var(--line)', color: 'var(--text-0)',
}
const iconBtn = {
  background: 'none', border: '1px solid var(--line)', borderRadius: 6,
  padding: '4px 7px', cursor: 'pointer', color: 'var(--text-2)',
  display: 'inline-flex', alignItems: 'center',
}
