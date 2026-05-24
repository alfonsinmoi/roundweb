import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Save, Clock4, LayoutTemplate } from 'lucide-react'
import { Card, Btn, Badge, EmptyState } from '../../../components/UI'
import { useToast } from '../../../components/Toast'
import {
  plantillasList, plantillaGet, plantillaCreate, plantillaUpdate,
  plantillaDelete, plantillaBloquesSave, puestosList,
} from '../../../utils/horarioApi'


const TIPOS = [
  { id: 'trabajo',  label: 'Trabajo',  color: '#10b981' },
  { id: 'comida',   label: 'Comida',   color: '#f59e0b' },
  { id: 'descanso', label: 'Descanso', color: '#a78bfa' },
  { id: 'otros',    label: 'Otros',    color: '#94a3b8' },
]


export default function PlantillasPanel({ identity }) {
  const toast = useToast()
  const [items, setItems] = useState([])
  const [puestos, setPuestos] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState(null)
  const [creando, setCreando] = useState(false)
  const [nombreNuevo, setNombreNuevo] = useState('')

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [ps, pu] = await Promise.all([
        plantillasList(identity),
        puestosList(identity),
      ])
      setItems(ps); setPuestos(pu)
      if (!selectedId && ps.length) setSelectedId(ps[0].id)
    } catch (e) { toast.error('Error: ' + e.message) }
    finally { setLoading(false) }
  }, [identity, toast, selectedId])

  useEffect(() => { reload() }, []) // eslint-disable-line

  async function handleCrear() {
    const nombre = (nombreNuevo || '').trim()
    if (!nombre) {
      toast.error('Introduce un nombre')
      return
    }
    try {
      const p = await plantillaCreate(identity, { nombre })
      toast.success('Plantilla creada')
      setNombreNuevo(''); setCreando(false)
      setSelectedId(p.id)
      reload()
    } catch (e) {
      if (e.body?.error === 'nombre_duplicado')
        toast.error('Ya existe una plantilla con ese nombre')
      else toast.error('Error: ' + (e.body?.error || e.message))
    }
  }

  async function handleBorrar(p) {
    if (!confirm(`¿Borrar plantilla "${p.nombre}"?`)) return
    try {
      await plantillaDelete(identity, p.id)
      toast.success('Borrada')
      if (selectedId === p.id) setSelectedId(null)
      reload()
    } catch (e) {
      if (e.body?.error === 'plantilla_en_uso')
        toast.error('No se puede borrar: tiene asignaciones')
      else toast.error('Error: ' + (e.body?.error || e.message))
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 14 }}>
      <Card style={{ padding: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <strong style={{ fontSize: 13, color: 'var(--text-1)' }}>Plantillas</strong>
          <Btn size="sm" onClick={() => setCreando(v => !v)}>
            <Plus size={13} /> Nueva
          </Btn>
        </div>
        {creando && (
          <div style={{
            padding: 10, borderRadius: 8, marginBottom: 8,
            background: 'var(--bg-2)', border: '1px solid var(--green, #10b981)',
            display: 'flex', flexDirection: 'column', gap: 6,
          }}>
            <input value={nombreNuevo}
                   onChange={e => setNombreNuevo(e.target.value)}
                   onKeyDown={e => {
                     if (e.key === 'Enter') { e.preventDefault(); handleCrear() }
                     if (e.key === 'Escape') { setCreando(false); setNombreNuevo('') }
                   }}
                   autoFocus
                   placeholder="Nombre (Mañana, Tarde, Sábado…)"
                   style={{
                     padding: 7, borderRadius: 6,
                     border: '1px solid var(--line)', background: 'var(--bg-1)',
                     color: 'var(--text-0)', fontSize: 13,
                   }} />
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              <Btn size="sm" variant="ghost"
                   onClick={() => { setCreando(false); setNombreNuevo('') }}>
                Cancelar
              </Btn>
              <Btn size="sm" onClick={handleCrear}>Crear</Btn>
            </div>
          </div>
        )}
        {loading && <p style={{ color: 'var(--text-3)', fontSize: 12 }}>Cargando…</p>}
        {!loading && items.length === 0 && (
          <p style={{ color: 'var(--text-3)', fontSize: 12 }}>
            Sin plantillas. Crea "Mañana", "Tarde", "Sábado"… las que uses cada semana.
            Cada plantilla define los bloques horarios con su puesto.
          </p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {items.map(p => (
            <PlantillaRow key={p.id} p={p}
                          active={selectedId === p.id}
                          identity={identity}
                          onSelect={() => setSelectedId(p.id)}
                          onSaved={reload}
                          onDelete={() => handleBorrar(p)} />
          ))}
        </div>
      </Card>

      <Card style={{ padding: 14 }}>
        {selectedId ? (
          <BloquesEditor identity={identity} plantillaId={selectedId}
                         puestos={puestos} onSaved={reload} />
        ) : (
          <EmptyState icon={LayoutTemplate} title="Sin plantilla seleccionada"
                      description="Elige (o crea) una plantilla para definir sus bloques horarios." />
        )}
      </Card>
    </div>
  )
}


function PlantillaRow({ p, active, identity, onSelect, onSaved, onDelete }) {
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ nombre: p.nombre, color: p.color, notas: p.notas })
  async function save() {
    try {
      await plantillaUpdate(identity, p.id, form)
      setEditing(false); onSaved()
      toast.success('Guardado')
    } catch (e) { toast.error('Error: ' + e.message) }
  }
  return (
    <div onClick={() => !editing && onSelect()}
         style={{
           padding: 10, borderRadius: 8, cursor: editing ? 'default' : 'pointer',
           background: active ? 'var(--green-bg, rgba(16,185,129,0.08))' : 'transparent',
           border: active ? '1px solid var(--green, #10b981)' : '1px solid var(--line)',
         }}>
      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <input value={form.nombre} placeholder="Nombre"
                 onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                 style={{ padding: 6, borderRadius: 6, border: '1px solid var(--line)', background: 'var(--bg-1)', color: 'var(--text-0)', fontSize: 13 }} />
          <input value={form.notas || ''} placeholder="Notas (opcional)"
                 onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
                 style={{ padding: 6, borderRadius: 6, border: '1px solid var(--line)', background: 'var(--bg-1)', color: 'var(--text-0)', fontSize: 12 }} />
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <Btn size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancelar</Btn>
            <Btn size="sm" onClick={save}>Guardar</Btn>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Badge color={p.color}>{p.nombre}</Badge>
          <span style={{ flex: 1, fontSize: 11, color: 'var(--text-3)' }}>
            {p.n_bloques} bloque{p.n_bloques === 1 ? '' : 's'} · {p.horas_trabajo}h
          </span>
          <button onClick={(e) => { e.stopPropagation(); setEditing(true) }} style={iconBtn}>
            <Clock4 size={13} />
          </button>
          <button onClick={(e) => { e.stopPropagation(); onDelete() }} style={iconBtn}>
            <Trash2 size={13} />
          </button>
        </div>
      )}
    </div>
  )
}


function BloquesEditor({ identity, plantillaId, puestos, onSaved }) {
  const toast = useToast()
  const [plantilla, setPlantilla] = useState(null)
  const [bloques, setBloques] = useState([])
  const [pristine, setPristine] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    plantillaGet(identity, plantillaId)
      .then(p => {
        setPlantilla(p)
        const bl = (p.bloques || []).map(b => ({ ...b }))
        setBloques(bl)
        setPristine(JSON.stringify(bl))
      })
      .catch(e => toast.error('Error: ' + e.message))
      .finally(() => setLoading(false))
  }, [identity, plantillaId]) // eslint-disable-line

  const dirty = JSON.stringify(bloques) !== pristine
  const totalMin = bloques
    .filter(b => b.tipo === 'trabajo')
    .reduce((acc, b) => acc + minutos(b.hora_inicio, b.hora_fin), 0)

  function addBloque() {
    setBloques(bs => [...bs, {
      hora_inicio: '09:00', hora_fin: '14:00',
      tipo: 'trabajo', puesto_id: null,
      orden: bs.length + 1,
    }])
  }
  function setBloque(idx, patch) {
    setBloques(bs => bs.map((b, i) => i === idx ? { ...b, ...patch } : b))
  }
  function removeBloque(idx) {
    setBloques(bs => bs.filter((_, i) => i !== idx))
  }
  async function handleSave() {
    setSaving(true)
    try {
      await plantillaBloquesSave(identity, plantillaId, bloques.map((b, i) => ({
        ...b, orden: i + 1,
        puesto_id: b.tipo === 'trabajo' ? (b.puesto_id || null) : null,
      })))
      toast.success('Bloques guardados')
      setPristine(JSON.stringify(bloques))
      onSaved?.()
    } catch (e) { toast.error('Error: ' + (e.body?.error || e.message)) }
    finally { setSaving(false) }
  }

  if (loading) return <p style={{ color: 'var(--text-3)' }}>Cargando…</p>
  if (!plantilla) return null

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div>
          <p style={{ margin: 0, fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
            Plantilla
          </p>
          <strong style={{ fontSize: 16, color: 'var(--text-0)' }}>{plantilla.nombre}</strong>
          <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--text-3)' }}>
            Total trabajo: <strong style={{ color: 'var(--text-1)' }}>{(totalMin / 60).toFixed(2)} h</strong>
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {dirty && (
            <span style={{
              padding: '3px 10px', borderRadius: 999, fontSize: 10, fontWeight: 700,
              background: 'rgba(245,158,11,0.15)', color: '#f59e0b',
              border: '1px solid rgba(245,158,11,0.35)',
              textTransform: 'uppercase', letterSpacing: '0.04em',
            }}>● Sin guardar</span>
          )}
          <Btn size="sm" onClick={handleSave} disabled={saving || !dirty}>
            <Save size={13} /> {saving ? 'Guardando…' : 'Guardar'}
          </Btn>
        </div>
      </div>

      <p style={{ margin: '0 0 10px', fontSize: 11, color: 'var(--text-3)' }}>
        Cada bloque define un tramo horario con su tipo. Para tipo "trabajo"
        elige el puesto (Recepción, Bar…). Comida/descanso no llevan puesto.
        Si un trabajador rota durante el día, mete varios bloques de trabajo
        con puestos diferentes.
      </p>

      <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid var(--line)' }}>
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--bg-2)' }}>
              <th style={th}>Inicio</th>
              <th style={th}>Fin</th>
              <th style={th}>Tipo</th>
              <th style={th}>Puesto</th>
              <th style={{ ...th, width: 32 }}></th>
            </tr>
          </thead>
          <tbody>
            {bloques.length === 0 && (
              <tr><td colSpan={5} style={{ padding: 16, textAlign: 'center', color: 'var(--text-3)' }}>
                Sin bloques. Añade uno para empezar.
              </td></tr>
            )}
            {bloques.map((b, idx) => (
              <tr key={idx} style={{ borderTop: '1px solid var(--line)' }}>
                <td style={td}>
                  <input type="time" value={b.hora_inicio}
                         onChange={e => setBloque(idx, { hora_inicio: e.target.value })}
                         style={timeInput} />
                </td>
                <td style={td}>
                  <input type="time" value={b.hora_fin}
                         onChange={e => setBloque(idx, { hora_fin: e.target.value })}
                         style={timeInput} />
                </td>
                <td style={td}>
                  <select value={b.tipo}
                          onChange={e => setBloque(idx, { tipo: e.target.value })}
                          style={selectInput}>
                    {TIPOS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                </td>
                <td style={td}>
                  {b.tipo === 'trabajo' ? (
                    <select value={b.puesto_id || ''}
                            onChange={e => setBloque(idx, { puesto_id: e.target.value ? Number(e.target.value) : null })}
                            style={selectInput}>
                      <option value="">— sin puesto —</option>
                      {puestos.map(p => (
                        <option key={p.id} value={p.id}>{p.nombre}</option>
                      ))}
                    </select>
                  ) : (
                    <span style={{ color: 'var(--text-3)', fontSize: 11 }}>—</span>
                  )}
                </td>
                <td style={td}>
                  <button onClick={() => removeBloque(idx)} type="button"
                          style={{ padding: 4, borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--red, #f87171)', cursor: 'pointer' }}>
                    <Trash2 size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 10 }}>
        <Btn size="sm" variant="ghost" onClick={addBloque}>
          <Plus size={13} /> Añadir bloque
        </Btn>
      </div>
    </div>
  )
}


function minutos(hi, hf) {
  if (!hi || !hf) return 0
  const [h1, m1] = hi.split(':').map(Number)
  const [h2, m2] = hf.split(':').map(Number)
  return Math.max(0, (h2 * 60 + m2) - (h1 * 60 + m1))
}


const iconBtn = {
  padding: 5, borderRadius: 6, border: 'none',
  background: 'transparent', color: 'var(--text-3)', cursor: 'pointer',
}
const timeInput = {
  padding: '4px 6px', borderRadius: 6,
  border: '1px solid var(--line)', background: 'var(--bg-1)',
  color: 'var(--text-0)', fontSize: 12, fontFamily: 'var(--font-mono)', width: 80,
}
const selectInput = {
  padding: '4px 8px', borderRadius: 6,
  border: '1px solid var(--line)', background: 'var(--bg-1)',
  color: 'var(--text-0)', fontSize: 12,
}
const th = {
  textAlign: 'left', padding: '8px 10px',
  fontSize: 10.5, fontWeight: 600, color: 'var(--text-3)',
  textTransform: 'uppercase', letterSpacing: '0.05em',
}
const td = { padding: '5px 10px' }
