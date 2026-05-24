import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Save, Briefcase } from 'lucide-react'
import { Card, Btn, Badge, Input, EmptyState } from '../../../components/UI'
import { useToast } from '../../../components/Toast'
import {
  puestosList, puestoCreate, puestoUpdate, puestoDelete,
  compatibilidadesGet, compatibilidadesSave,
  demandaGet, demandaSave, temporadasList,
} from '../../../utils/horarioApi'


const DIAS = [
  { i: 1, label: 'Lun' }, { i: 2, label: 'Mar' }, { i: 3, label: 'Mié' },
  { i: 4, label: 'Jue' }, { i: 5, label: 'Vie' }, { i: 6, label: 'Sáb' }, { i: 7, label: 'Dom' },
]
const COLORES = ['cyan', 'green', 'amber', 'red', 'purple', 'pink', 'gray']


export default function PuestosPanel({ identity }) {
  const toast = useToast()
  const [items, setItems] = useState([])
  const [pares, setPares] = useState([])
  const [temporadas, setTemporadas] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [ps, pa, ts] = await Promise.all([
        puestosList(identity),
        compatibilidadesGet(identity),
        temporadasList(identity),
      ])
      setItems(ps)
      setPares(pa.map(p => `${p[0]}-${p[1]}`))   // set de strings "a-b"
      setTemporadas(ts)
      if (!selected && ps.length) setSelected(ps[0].id)
    } catch (e) { toast.error('Error: ' + e.message) }
    finally { setLoading(false) }
  }, [identity, toast, selected])

  useEffect(() => { reload() }, []) // eslint-disable-line

  async function handleCrear() {
    const nombre = prompt('Nombre del puesto (ej. Recepción, Monitor sala…):', '')
    if (!nombre) return
    const codigo = prompt('Código corto (ej. recepcion, monitor_sala):', nombre.toLowerCase().replace(/\s+/g, '_'))
    if (!codigo) return
    try {
      const p = await puestoCreate(identity, { nombre, codigo })
      toast.success('Puesto creado')
      setSelected(p.id)
      reload()
    } catch (e) { toast.error('Error: ' + (e.body?.error || e.message)) }
  }

  async function handleBorrar(p) {
    if (!confirm(`¿Borrar puesto "${p.nombre}"? Se perderán su demanda y compatibilidades.`)) return
    try {
      await puestoDelete(identity, p.id)
      toast.success('Borrado')
      if (selected === p.id) setSelected(null)
      reload()
    } catch (e) { toast.error('Error: ' + (e.body?.error || e.message)) }
  }

  async function toggleCompat(a, b) {
    if (a === b) return
    const lo = Math.min(a, b), hi = Math.max(a, b)
    const key = `${lo}-${hi}`
    const next = new Set(pares)
    if (next.has(key)) next.delete(key); else next.add(key)
    const arr = Array.from(next).map(k => k.split('-').map(Number))
    try {
      await compatibilidadesSave(identity, arr)
      setPares(Array.from(next))
    } catch (e) { toast.error('Error: ' + e.message) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 14 }}>
        {/* ── Lista puestos ───────────────────────────────────────── */}
        <Card style={{ padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <strong style={{ fontSize: 13, color: 'var(--text-1)' }}>Puestos</strong>
            <Btn size="sm" onClick={handleCrear}>
              <Plus size={13} /> Nuevo
            </Btn>
          </div>
          {loading && <p style={{ color: 'var(--text-3)', fontSize: 12 }}>Cargando…</p>}
          {!loading && items.length === 0 && (
            <p style={{ color: 'var(--text-3)', fontSize: 12 }}>
              Sin puestos. Crea los puestos típicos de tu centro (Recepción,
              Monitor sala, Limpieza…) para poder asignar trabajadores.
            </p>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {items.map(p => (
              <PuestoRow key={p.id} p={p}
                         active={selected === p.id}
                         identity={identity}
                         onSelect={() => setSelected(p.id)}
                         onSaved={reload}
                         onDelete={() => handleBorrar(p)} />
            ))}
          </div>
        </Card>

        {/* ── Editor demanda del puesto ──────────────────────────── */}
        <Card style={{ padding: 14 }}>
          {selected ? (
            <DemandaEditor identity={identity}
                            puestoId={selected}
                            puestoNombre={items.find(p => p.id === selected)?.nombre || ''}
                            temporadas={temporadas} />
          ) : (
            <EmptyState icon={Briefcase} title="Sin puesto seleccionado"
                        description="Elige (o crea) un puesto para definir su demanda por franja horaria." />
          )}
        </Card>
      </div>

      {/* ── Matriz de compatibilidades ─────────────────────────────── */}
      {items.length > 1 && (
        <Card style={{ padding: 14 }}>
          <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700, color: 'var(--text-0)' }}>
            Compatibilidades entre puestos
          </p>
          <p style={{ margin: '0 0 12px', fontSize: 11, color: 'var(--text-3)' }}>
            Marca los pares de puestos que un mismo trabajador puede desempeñar
            en la <strong>misma franja</strong> (ej. recepción + bar). El algoritmo
            usará esto para optimizar asignaciones.
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th></th>
                  {items.map(p => (
                    <th key={p.id} style={{
                      padding: '6px 8px', fontSize: 11,
                      borderBottom: '1px solid var(--line)',
                      writingMode: 'vertical-rl', transform: 'rotate(180deg)',
                      whiteSpace: 'nowrap', color: 'var(--text-2)',
                    }}>
                      {p.nombre}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map(rowP => (
                  <tr key={rowP.id}>
                    <td style={{ padding: '6px 10px', fontSize: 12, color: 'var(--text-2)', borderRight: '1px solid var(--line)', whiteSpace: 'nowrap' }}>
                      {rowP.nombre}
                    </td>
                    {items.map(colP => {
                      if (rowP.id === colP.id) {
                        return <td key={colP.id} style={{ textAlign: 'center', color: 'var(--text-3)' }}>—</td>
                      }
                      const lo = Math.min(rowP.id, colP.id), hi = Math.max(rowP.id, colP.id)
                      const compat = pares.includes(`${lo}-${hi}`)
                      return (
                        <td key={colP.id} style={{ textAlign: 'center', padding: '6px 8px' }}>
                          <input type="checkbox" checked={compat}
                                 onChange={() => toggleCompat(rowP.id, colP.id)}
                                 style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--green, #10b981)' }} />
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}


function PuestoRow({ p, active, identity, onSelect, onSaved, onDelete }) {
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ nombre: p.nombre, color: p.color, descripcion: p.descripcion })
  async function save() {
    try { await puestoUpdate(identity, p.id, form); setEditing(false); onSaved(); toast.success('Guardado') }
    catch (e) { toast.error('Error: ' + e.message) }
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
          <Input label="Nombre" value={form.nombre}
                 onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} />
          <div>
            <label style={{ fontSize: 11, color: 'var(--text-3)' }}>Color</label>
            <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
              {COLORES.map(c => (
                <button key={c} type="button" onClick={() => setForm(f => ({ ...f, color: c }))}
                        title={c}
                        style={{
                          width: 22, height: 22, borderRadius: '50%',
                          border: form.color === c ? '2px solid var(--text-0)' : '1px solid var(--line)',
                          background: c === 'cyan'   ? '#22d3ee'
                                    : c === 'green'  ? '#10b981'
                                    : c === 'amber'  ? '#f59e0b'
                                    : c === 'red'    ? '#f87171'
                                    : c === 'purple' ? '#a78bfa'
                                    : c === 'pink'   ? '#f472b6'
                                    : 'var(--text-3)',
                          cursor: 'pointer',
                        }} />
              ))}
            </div>
          </div>
          <Input label="Descripción" value={form.descripcion || ''}
                 onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} />
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <Btn size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancelar</Btn>
            <Btn size="sm" onClick={save}>Guardar</Btn>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Badge color={p.color}>{p.nombre}</Badge>
          <span style={{ flex: 1, fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
            {p.codigo}
          </span>
          <button onClick={(e) => { e.stopPropagation(); setEditing(true) }} style={iconBtn}>
            <Briefcase size={13} />
          </button>
          <button onClick={(e) => { e.stopPropagation(); onDelete() }} style={iconBtn}>
            <Trash2 size={13} />
          </button>
        </div>
      )}
    </div>
  )
}


function DemandaEditor({ identity, puestoId, puestoNombre, temporadas }) {
  const toast = useToast()
  const [filas, setFilas] = useState([])
  const [tempFilter, setTempFilter] = useState('')   // '' = todas
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setLoading(true)
    demandaGet(identity, puestoId, null)
      .then(setFilas)
      .catch(e => toast.error('Error: ' + e.message))
      .finally(() => setLoading(false))
  }, [identity, puestoId]) // eslint-disable-line

  function addFila() {
    setFilas(fs => [...fs, {
      temporada_id: tempFilter || null,
      dia_semana: 1, hora_inicio: '09:00', hora_fin: '14:00',
      n_trabajadores: 1, notas: '',
    }])
  }
  function setFila(idx, patch) {
    setFilas(fs => fs.map((f, i) => i === idx ? { ...f, ...patch } : f))
  }
  function removeFila(idx) {
    setFilas(fs => fs.filter((_, i) => i !== idx))
  }
  async function handleSave() {
    setSaving(true)
    try {
      await demandaSave(identity, puestoId, filas)
      toast.success('Demanda guardada')
    } catch (e) { toast.error('Error: ' + (e.body?.error || e.message)) }
    finally { setSaving(false) }
  }

  if (loading) return <p style={{ color: 'var(--text-3)' }}>Cargando…</p>

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div>
          <p style={{ margin: 0, fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
            Demanda por franja
          </p>
          <strong style={{ fontSize: 16, color: 'var(--text-0)' }}>{puestoNombre}</strong>
        </div>
        <Btn size="sm" onClick={handleSave} disabled={saving}>
          <Save size={13} /> {saving ? 'Guardando…' : 'Guardar'}
        </Btn>
      </div>

      <p style={{ margin: '0 0 10px', fontSize: 11, color: 'var(--text-3)' }}>
        Cuántos trabajadores hacen falta para este puesto en cada franja
        horaria del día. La temporada es opcional (sin temporada = aplica
        siempre). El algoritmo de planificación usará esto.
      </p>

      <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid var(--line)' }}>
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--bg-2)' }}>
              <th style={th}>Temporada</th>
              <th style={th}>Día</th>
              <th style={th}>Inicio</th>
              <th style={th}>Fin</th>
              <th style={th}>Nº</th>
              <th style={th}>Notas</th>
              <th style={{ ...th, width: 32 }}></th>
            </tr>
          </thead>
          <tbody>
            {filas.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 16, textAlign: 'center', color: 'var(--text-3)' }}>
                Sin demanda definida. Añade una franja para empezar.
              </td></tr>
            )}
            {filas.map((f, idx) => (
              <tr key={idx} style={{ borderTop: '1px solid var(--line)' }}>
                <td style={td}>
                  <select value={f.temporada_id || ''}
                          onChange={e => setFila(idx, { temporada_id: e.target.value ? Number(e.target.value) : null })}
                          style={selectInput}>
                    <option value="">— Cualquiera —</option>
                    {temporadas.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                  </select>
                </td>
                <td style={td}>
                  <select value={f.dia_semana}
                          onChange={e => setFila(idx, { dia_semana: Number(e.target.value) })}
                          style={selectInput}>
                    {DIAS.map(d => <option key={d.i} value={d.i}>{d.label}</option>)}
                  </select>
                </td>
                <td style={td}>
                  <input type="time" value={f.hora_inicio}
                         onChange={e => setFila(idx, { hora_inicio: e.target.value })}
                         style={timeInput} />
                </td>
                <td style={td}>
                  <input type="time" value={f.hora_fin}
                         onChange={e => setFila(idx, { hora_fin: e.target.value })}
                         style={timeInput} />
                </td>
                <td style={td}>
                  <input type="number" min={1} value={f.n_trabajadores}
                         onChange={e => setFila(idx, { n_trabajadores: Number(e.target.value) || 1 })}
                         style={{ ...timeInput, width: 50 }} />
                </td>
                <td style={td}>
                  <input value={f.notas || ''}
                         onChange={e => setFila(idx, { notas: e.target.value })}
                         style={{ ...selectInput, minWidth: 100 }} />
                </td>
                <td style={td}>
                  <button onClick={() => removeFila(idx)} type="button"
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
        <Btn size="sm" variant="ghost" onClick={addFila}>
          <Plus size={13} /> Añadir franja
        </Btn>
      </div>
    </div>
  )
}


const iconBtn = {
  padding: 5, borderRadius: 6, border: 'none',
  background: 'transparent', color: 'var(--text-3)', cursor: 'pointer',
}
const timeInput = {
  padding: '4px 6px', borderRadius: 6,
  border: '1px solid var(--line)', background: 'var(--bg-1)',
  color: 'var(--text-0)', fontSize: 12, fontFamily: 'var(--font-mono)', width: 76,
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
