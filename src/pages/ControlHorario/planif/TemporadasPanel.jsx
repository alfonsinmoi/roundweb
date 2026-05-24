import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Save, CalendarRange } from 'lucide-react'
import { Card, Btn, Input, EmptyState } from '../../../components/UI'
import { useToast } from '../../../components/Toast'
import {
  temporadasList, temporadaCreate, temporadaUpdate, temporadaDelete,
  aperturaGet, aperturaSave,
} from '../../../utils/horarioApi'


const DIAS = [
  { i: 1, label: 'L' }, { i: 2, label: 'M' }, { i: 3, label: 'X' },
  { i: 4, label: 'J' }, { i: 5, label: 'V' }, { i: 6, label: 'S' }, { i: 7, label: 'D' },
]


// `franja` UI = { hora_inicio, hora_fin, dias: Set<int> }
// BD              = { "1": [{hora_inicio,hora_fin}, …], …, "7": [...] }
// Agrupamos filas con mismo HH:MM en una sola franja con set de días.
function agruparEnFranjas(apertura) {
  const mapa = new Map()
  for (const dia of Object.keys(apertura || {})) {
    for (const b of (apertura[dia] || [])) {
      const key = `${b.hora_inicio}|${b.hora_fin}`
      if (!mapa.has(key)) {
        mapa.set(key, { hora_inicio: b.hora_inicio, hora_fin: b.hora_fin, dias: new Set() })
      }
      mapa.get(key).dias.add(Number(dia))
    }
  }
  return Array.from(mapa.values())
    .sort((a, b) => (a.hora_inicio || '').localeCompare(b.hora_inicio || ''))
}

function franjasAApertura(franjas) {
  const out = { '1': [], '2': [], '3': [], '4': [], '5': [], '6': [], '7': [] }
  for (const f of franjas) {
    for (const d of f.dias) {
      out[String(d)].push({ hora_inicio: f.hora_inicio, hora_fin: f.hora_fin })
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
    `${f.hora_inicio}|${f.hora_fin}|${[...f.dias].sort().join(',')}`
  ).sort().join('||')
}

function fmtMinShort(mins) {
  if (!mins) return '—'
  const h = Math.floor(mins / 60), m = mins % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}:${String(m).padStart(2, '0')}`
}

function fmtMin(mins) {
  if (!mins) return '—'
  const h = Math.floor(mins / 60), m = mins % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${String(m).padStart(2, '0')}m`
}


export default function TemporadasPanel({ identity }) {
  const toast = useToast()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)   // id de la temporada activa en editor

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const list = await temporadasList(identity)
      setItems(list)
      if (!selected && list.length) setSelected(list[0].id)
    } catch (e) { toast.error('Error: ' + e.message) }
    finally { setLoading(false) }
  }, [identity, toast, selected])

  useEffect(() => { reload() }, []) // eslint-disable-line

  async function handleCrear() {
    const nombre = prompt('Nombre de la temporada (ej. Verano, Invierno…):', '')
    if (!nombre) return
    try {
      const t = await temporadaCreate(identity, { nombre })
      toast.success('Temporada creada'); setSelected(t.id); reload()
    } catch (e) { toast.error('Error: ' + (e.body?.error || e.message)) }
  }

  async function handleBorrar(t) {
    if (!confirm(`¿Borrar temporada "${t.nombre}"? Se perderá también su horario de apertura.`)) return
    try {
      await temporadaDelete(identity, t.id)
      toast.success('Borrada')
      if (selected === t.id) setSelected(null)
      reload()
    } catch (e) { toast.error('Error: ' + (e.body?.error || e.message)) }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 14 }}>
      {/* ── Lista de temporadas ───────────────────────────────────────── */}
      <Card style={{ padding: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <strong style={{ fontSize: 13, color: 'var(--text-1)' }}>Temporadas</strong>
          <Btn size="sm" onClick={handleCrear}>
            <Plus size={13} /> Nueva
          </Btn>
        </div>
        {loading && <p style={{ color: 'var(--text-3)', fontSize: 12 }}>Cargando…</p>}
        {!loading && items.length === 0 && (
          <p style={{ color: 'var(--text-3)', fontSize: 12 }}>
            Sin temporadas. Crea una para empezar (puedes llamarla "Permanente"
            si tu centro no tiene cambios de horario por estación).
          </p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {items.map(t => (
            <TemporadaRow key={t.id} t={t}
                          active={selected === t.id}
                          identity={identity}
                          onSelect={() => setSelected(t.id)}
                          onSaved={reload}
                          onDelete={() => handleBorrar(t)} />
          ))}
        </div>
      </Card>

      {/* ── Editor de horario apertura ────────────────────────────────── */}
      <Card style={{ padding: 14 }}>
        {selected ? (
          <AperturaEditor identity={identity} temporadaId={selected}
                           temporadaNombre={items.find(t => t.id === selected)?.nombre || ''} />
        ) : (
          <EmptyState icon={CalendarRange} title="Sin temporada seleccionada"
                      description="Elige (o crea) una temporada para editar su horario de apertura." />
        )}
      </Card>
    </div>
  )
}


function TemporadaRow({ t, active, identity, onSelect, onSaved, onDelete }) {
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({
    nombre: t.nombre, fecha_desde: t.fecha_desde || '', fecha_hasta: t.fecha_hasta || '',
    notas: t.notas, activa: t.activa,
  })
  async function save() {
    try {
      await temporadaUpdate(identity, t.id, form)
      setEditing(false); onSaved(); toast.success('Guardado')
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
          <Input label="Nombre" value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <Input label="Desde" type="date" value={form.fecha_desde}
                   onChange={e => setForm(f => ({ ...f, fecha_desde: e.target.value }))} />
            <Input label="Hasta" type="date" value={form.fecha_hasta}
                   onChange={e => setForm(f => ({ ...f, fecha_hasta: e.target.value }))} />
          </div>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <Btn size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancelar</Btn>
            <Btn size="sm" onClick={save}>Guardar</Btn>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontWeight: 600, fontSize: 13, color: 'var(--text-0)' }}>
              {t.nombre}
              {!t.activa && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text-3)' }}>(inactiva)</span>}
            </p>
            <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-3)' }}>
              {t.fecha_desde || t.fecha_hasta
                ? `${t.fecha_desde || '—'} → ${t.fecha_hasta || '—'}`
                : 'Permanente'}
            </p>
          </div>
          <button onClick={(e) => { e.stopPropagation(); setEditing(true) }}
                  style={iconBtn} title="Editar">
            <CalendarRange size={13} />
          </button>
          <button onClick={(e) => { e.stopPropagation(); onDelete() }}
                  style={iconBtn} title="Borrar">
            <Trash2 size={13} />
          </button>
        </div>
      )}
    </div>
  )
}


function AperturaEditor({ identity, temporadaId, temporadaNombre }) {
  const toast = useToast()
  const [franjas, setFranjas] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [pristine, setPristine] = useState('')

  useEffect(() => {
    setLoading(true)
    aperturaGet(identity, temporadaId)
      .then(a => {
        const fs = agruparEnFranjas(a || {})
        setFranjas(fs); setPristine(snapshotFranjas(fs))
      })
      .catch(e => toast.error('Error: ' + e.message))
      .finally(() => setLoading(false))
  }, [identity, temporadaId]) // eslint-disable-line

  const dirty = franjas !== null && snapshotFranjas(franjas) !== pristine

  useEffect(() => {
    if (!dirty) return
    const handler = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  function addFranja() {
    setFranjas(fs => [...(fs || []), {
      hora_inicio: '09:00', hora_fin: '22:00',
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
      await aperturaSave(identity, temporadaId, franjasAApertura(franjas))
      setPristine(snapshotFranjas(franjas))
      toast.success('Horario apertura guardado')
    } catch (e) { toast.error('Error: ' + (e.body?.error || e.message)) }
    finally { setSaving(false) }
  }

  if (loading) return <p style={{ color: 'var(--text-3)' }}>Cargando…</p>
  if (!franjas) return null

  // Totales por día
  const totDia = DIAS.map(d => {
    let mins = 0
    for (const f of franjas) {
      if (f.dias.has(d.i)) mins += minutosFranja(f)
    }
    return { dia: d, mins }
  })
  const totSemana = totDia.reduce((a, x) => a + x.mins, 0)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div>
          <p style={{ margin: 0, fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
            Horario de apertura
          </p>
          <strong style={{ fontSize: 16, color: 'var(--text-0)' }}>{temporadaNombre}</strong>
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
          <Btn onClick={handleSave} disabled={saving || !dirty}>
            <Save size={13} /> {saving ? 'Guardando…' : 'Guardar'}
          </Btn>
        </div>
      </div>

      <p style={{ margin: '0 0 12px', fontSize: 11, color: 'var(--text-3)' }}>
        Cada fila es una franja de apertura. Marca los días en los que se
        aplica. Si un día no aparece en ninguna franja = cerrado. Si necesitas
        mañana + tarde, mete dos franjas con los mismos días.
      </p>

      <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid var(--line)' }}>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--bg-2)' }}>
              <th style={thStyle}>Inicio</th>
              <th style={thStyle}>Fin</th>
              {DIAS.map(d => (
                <th key={d.i} style={{ ...thStyle, textAlign: 'center', width: 32 }}>{d.label}</th>
              ))}
              <th style={{ ...thStyle, width: 32 }}></th>
            </tr>
          </thead>
          <tbody>
            {franjas.map((f, idx) => (
              <tr key={idx} style={{ borderTop: '1px solid var(--line)' }}>
                <td style={tdStyle}>
                  <input type="time" value={f.hora_inicio}
                         onChange={e => setFranja(idx, { hora_inicio: e.target.value })}
                         style={timeInput} />
                </td>
                <td style={tdStyle}>
                  <input type="time" value={f.hora_fin}
                         onChange={e => setFranja(idx, { hora_fin: e.target.value })}
                         style={timeInput} />
                </td>
                {DIAS.map(d => (
                  <td key={d.i} style={{ ...tdStyle, textAlign: 'center', padding: '4px 6px' }}>
                    <input type="checkbox" checked={f.dias.has(d.i)}
                           onChange={() => toggleDia(idx, d.i)}
                           style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--green, #10b981)' }} />
                  </td>
                ))}
                <td style={{ ...tdStyle, textAlign: 'center', padding: '4px 6px' }}>
                  <button onClick={() => removeFranja(idx)} type="button" title="Eliminar franja"
                          style={{ padding: 4, borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--red, #f87171)', cursor: 'pointer' }}>
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
            {franjas.length === 0 && (
              <tr><td colSpan={10} style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)' }}>
                Sin franjas todavía. Pulsa "Añadir franja".
              </td></tr>
            )}
          </tbody>
          <tfoot>
            <tr style={{ background: 'var(--bg-2)', borderTop: '2px solid var(--line)' }}>
              <td colSpan={2} style={{ ...tdStyle, fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', padding: '8px 10px' }}>
                Horas / día
              </td>
              {totDia.map(t => (
                <td key={t.dia.i} style={{
                  ...tdStyle, padding: '8px 6px',
                  textAlign: 'center', fontFamily: 'var(--font-mono)',
                  fontSize: 13, fontWeight: 700,
                  color: t.mins > 0 ? 'var(--green, #10b981)' : 'var(--text-3)',
                }}>
                  {fmtMinShort(t.mins)}
                </td>
              ))}
              <td style={tdStyle}></td>
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
            Total apertura semanal
          </p>
          <p style={{ margin: '2px 0 0', fontFamily: 'var(--font-display, Outfit)', fontSize: 22, fontWeight: 700, color: 'var(--green, #10b981)' }}>
            {fmtMin(totSemana)}
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
const thStyle = {
  textAlign: 'left', padding: '10px 12px',
  fontSize: 10.5, fontWeight: 600, color: 'var(--text-3)',
  textTransform: 'uppercase', letterSpacing: '0.05em',
}
const tdStyle = { padding: '6px 10px' }
