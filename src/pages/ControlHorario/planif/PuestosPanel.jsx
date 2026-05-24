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
  { i: 1, label: 'L' }, { i: 2, label: 'M' }, { i: 3, label: 'X' },
  { i: 4, label: 'J' }, { i: 5, label: 'V' }, { i: 6, label: 'S' }, { i: 7, label: 'D' },
]
const COLORES = ['cyan', 'green', 'amber', 'red', 'purple', 'pink', 'gray']


// `franja` UI = { temporada_id, hora_inicio, hora_fin, n_trabajadores, notas, dias: Set<int> }
// BD            = una fila por (franja × dia). Agrupamos filas idénticas.
function demandaToFranjas(filas) {
  const mapa = new Map()
  for (const f of filas || []) {
    const key = `${f.temporada_id ?? ''}|${f.hora_inicio}|${f.hora_fin}|${f.n_trabajadores}|${f.notas || ''}`
    if (!mapa.has(key)) {
      mapa.set(key, {
        temporada_id: f.temporada_id ?? null,
        hora_inicio: f.hora_inicio,
        hora_fin: f.hora_fin,
        n_trabajadores: f.n_trabajadores,
        notas: f.notas || '',
        dias: new Set(),
      })
    }
    mapa.get(key).dias.add(Number(f.dia_semana))
  }
  return Array.from(mapa.values())
    .sort((a, b) => (a.hora_inicio || '').localeCompare(b.hora_inicio || ''))
}

function franjasToDemanda(franjas) {
  const out = []
  for (const f of franjas) {
    for (const d of f.dias) {
      out.push({
        temporada_id: f.temporada_id ?? null,
        dia_semana: d,
        hora_inicio: f.hora_inicio,
        hora_fin: f.hora_fin,
        n_trabajadores: f.n_trabajadores,
        notas: f.notas || '',
      })
    }
  }
  return out
}

function minutosFranja(f) {
  if (!f.hora_inicio || !f.hora_fin) return 0
  const [h1, m1] = f.hora_inicio.split(':').map(Number)
  const [h2, m2] = f.hora_fin.split(':').map(Number)
  return Math.max(0, (h2 * 60 + m2) - (h1 * 60 + m1))
}

function snapshotFranjas(franjas) {
  if (!franjas) return ''
  return franjas.map(f =>
    `${f.temporada_id ?? ''}|${f.hora_inicio}|${f.hora_fin}|${f.n_trabajadores}|${f.notas || ''}|${[...f.dias].sort().join(',')}`
  ).sort().join('||')
}

function fmtPersonasHora(mins) {
  if (!mins) return '—'
  const h = mins / 60
  return h % 1 === 0 ? `${h}h` : `${h.toFixed(1)}h`
}


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
  const [franjas, setFranjas] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [pristine, setPristine] = useState('')

  useEffect(() => {
    setLoading(true)
    demandaGet(identity, puestoId, null)
      .then(filas => {
        const fs = demandaToFranjas(filas)
        setFranjas(fs); setPristine(snapshotFranjas(fs))
      })
      .catch(e => toast.error('Error: ' + e.message))
      .finally(() => setLoading(false))
  }, [identity, puestoId]) // eslint-disable-line

  const dirty = franjas !== null && snapshotFranjas(franjas) !== pristine

  useEffect(() => {
    if (!dirty) return
    const handler = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  function addFranja() {
    setFranjas(fs => [...(fs || []), {
      temporada_id: null,
      hora_inicio: '09:00', hora_fin: '14:00',
      n_trabajadores: 1, notas: '',
      dias: new Set([1, 2, 3, 4, 5]),
    }])
  }
  function setFranja(idx, patch) {
    setFranjas(fs => fs.map((f, i) => i === idx ? { ...f, ...patch } : f))
  }
  function toggleDia(idx, dia) {
    setFranjas(fs => fs.map((f, i) => {
      if (i !== idx) return f
      const dias = new Set(f.dias)
      if (dias.has(dia)) dias.delete(dia); else dias.add(dia)
      return { ...f, dias }
    }))
  }
  function removeFranja(idx) {
    setFranjas(fs => fs.filter((_, i) => i !== idx))
  }

  async function handleSave() {
    setSaving(true)
    try {
      await demandaSave(identity, puestoId, franjasToDemanda(franjas))
      toast.success('Demanda guardada')
      setPristine(snapshotFranjas(franjas))
    } catch (e) { toast.error('Error: ' + (e.body?.error || e.message)) }
    finally { setSaving(false) }
  }

  if (loading) return <p style={{ color: 'var(--text-3)' }}>Cargando…</p>
  if (!franjas) return null

  // Total personas-hora por día = sum n_trabajadores * minutos por franjas que incluyen el día
  const totDia = DIAS.map(d => {
    let mins = 0
    for (const f of franjas) {
      if (!f.dias.has(d.i)) continue
      mins += (f.n_trabajadores || 1) * minutosFranja(f)
    }
    return { dia: d, mins }
  })
  const totSemana = totDia.reduce((a, x) => a + x.mins, 0)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div>
          <p style={{ margin: 0, fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
            Demanda por franja
          </p>
          <strong style={{ fontSize: 16, color: 'var(--text-0)' }}>{puestoNombre}</strong>
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
        Cada fila es una franja: define las horas, cuántos trabajadores hacen
        falta, y marca los días en los que aplica. La temporada es opcional
        (sin temporada = aplica siempre). Si la franja varía por temporada,
        duplícala con otra temporada.
      </p>

      <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid var(--line)' }}>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--bg-2)' }}>
              <th style={th}>Temporada</th>
              <th style={th}>Inicio</th>
              <th style={th}>Fin</th>
              <th style={th}>Nº</th>
              {DIAS.map(d => (
                <th key={d.i} style={{ ...th, textAlign: 'center', width: 32 }}>{d.label}</th>
              ))}
              <th style={th}>Notas</th>
              <th style={{ ...th, width: 32 }}></th>
            </tr>
          </thead>
          <tbody>
            {franjas.map((f, idx) => (
              <tr key={idx} style={{ borderTop: '1px solid var(--line)' }}>
                <td style={td}>
                  <select value={f.temporada_id || ''}
                          onChange={e => setFranja(idx, { temporada_id: e.target.value ? Number(e.target.value) : null })}
                          style={selectInput}>
                    <option value="">— Cualquiera —</option>
                    {temporadas.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                  </select>
                </td>
                <td style={td}>
                  <input type="time" value={f.hora_inicio}
                         onChange={e => setFranja(idx, { hora_inicio: e.target.value })}
                         style={timeInput} />
                </td>
                <td style={td}>
                  <input type="time" value={f.hora_fin}
                         onChange={e => setFranja(idx, { hora_fin: e.target.value })}
                         style={timeInput} />
                </td>
                <td style={td}>
                  <input type="number" min={1} value={f.n_trabajadores}
                         onChange={e => setFranja(idx, { n_trabajadores: Number(e.target.value) || 1 })}
                         style={{ ...timeInput, width: 50 }} />
                </td>
                {DIAS.map(d => (
                  <td key={d.i} style={{ ...td, textAlign: 'center', padding: '4px 6px' }}>
                    <input type="checkbox" checked={f.dias.has(d.i)}
                           onChange={() => toggleDia(idx, d.i)}
                           style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--green, #10b981)' }} />
                  </td>
                ))}
                <td style={td}>
                  <input value={f.notas || ''}
                         onChange={e => setFranja(idx, { notas: e.target.value })}
                         style={{ ...selectInput, minWidth: 100 }} />
                </td>
                <td style={{ ...td, textAlign: 'center', padding: '4px 6px' }}>
                  <button onClick={() => removeFranja(idx)} type="button" title="Eliminar franja"
                          style={{ padding: 4, borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--red, #f87171)', cursor: 'pointer' }}>
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
            {franjas.length === 0 && (
              <tr><td colSpan={13} style={{ padding: 16, textAlign: 'center', color: 'var(--text-3)' }}>
                Sin demanda definida. Pulsa "Añadir franja".
              </td></tr>
            )}
          </tbody>
          <tfoot>
            <tr style={{ background: 'var(--bg-2)', borderTop: '2px solid var(--line)' }}>
              <td colSpan={4} style={{ ...td, fontSize: 10.5, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', padding: '8px 10px' }}>
                Personas-hora / día
              </td>
              {totDia.map(t => (
                <td key={t.dia.i} style={{
                  ...td, padding: '8px 6px',
                  textAlign: 'center', fontFamily: 'var(--font-mono)',
                  fontSize: 12, fontWeight: 700,
                  color: t.mins > 0 ? 'var(--green, #10b981)' : 'var(--text-3)',
                }}>
                  {fmtPersonasHora(t.mins)}
                </td>
              ))}
              <td colSpan={2} style={td}></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div style={{
        marginTop: 14, padding: '12px 16px', borderRadius: 12,
        background: 'var(--bg-2)', border: '1px solid var(--line)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16,
        flexWrap: 'wrap',
      }}>
        <Btn variant="ghost" size="sm" onClick={addFranja}>
          <Plus size={13} /> Añadir franja
        </Btn>
        <div style={{ textAlign: 'right' }}>
          <p style={{ margin: 0, fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
            Personas-hora semanales
          </p>
          <p style={{ margin: '2px 0 0', fontFamily: 'var(--font-display, Outfit)', fontSize: 22, fontWeight: 700, color: 'var(--green, #10b981)' }}>
            {fmtPersonasHora(totSemana)}
          </p>
        </div>
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
