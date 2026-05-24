import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Save, CalendarRange } from 'lucide-react'
import { Card, Btn, Badge, Input, EmptyState } from '../../../components/UI'
import { useToast } from '../../../components/Toast'
import {
  temporadasList, temporadaCreate, temporadaUpdate, temporadaDelete,
  aperturaGet, aperturaSave,
} from '../../../utils/horarioApi'


const DIAS = [
  { i: 1, label: 'L' }, { i: 2, label: 'M' }, { i: 3, label: 'X' },
  { i: 4, label: 'J' }, { i: 5, label: 'V' }, { i: 6, label: 'S' }, { i: 7, label: 'D' },
]


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
  const [apertura, setApertura] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [pristine, setPristine] = useState('')

  useEffect(() => {
    setLoading(true)
    aperturaGet(identity, temporadaId)
      .then(a => { setApertura(a || {}); setPristine(JSON.stringify(a || {})) })
      .catch(e => toast.error('Error: ' + e.message))
      .finally(() => setLoading(false))
  }, [identity, temporadaId]) // eslint-disable-line

  const dirty = apertura && JSON.stringify(apertura) !== pristine

  function setDia(dia, blocks) {
    setApertura(a => ({ ...a, [String(dia)]: blocks }))
  }
  function addBloque(dia) {
    const prev = apertura[String(dia)] || []
    setDia(dia, [...prev, { hora_inicio: '09:00', hora_fin: '22:00' }])
  }
  function updateBloque(dia, idx, field, value) {
    const arr = (apertura[String(dia)] || []).slice()
    arr[idx] = { ...arr[idx], [field]: value }
    setDia(dia, arr)
  }
  function removeBloque(dia, idx) {
    const arr = (apertura[String(dia)] || []).slice()
    arr.splice(idx, 1)
    setDia(dia, arr)
  }
  async function handleSave() {
    setSaving(true)
    try {
      await aperturaSave(identity, temporadaId, apertura)
      setPristine(JSON.stringify(apertura))
      toast.success('Horario apertura guardado')
    } catch (e) { toast.error('Error: ' + (e.body?.error || e.message)) }
    finally { setSaving(false) }
  }

  if (loading) return <p style={{ color: 'var(--text-3)' }}>Cargando…</p>
  if (!apertura) return null

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
        Cada día puede tener varios bloques de apertura (mañana + tarde).
        Sin bloques = cerrado.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {DIAS.map(d => {
          const bloques = apertura[String(d.i)] || []
          return (
            <div key={d.i} style={{
              padding: 10, borderRadius: 10,
              background: 'var(--bg-2)', border: '1px solid var(--line)',
              display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            }}>
              <strong style={{ fontSize: 13, width: 24, textAlign: 'center' }}>{d.label}</strong>
              {bloques.length === 0 && (
                <span style={{ color: 'var(--text-3)', fontSize: 12, fontStyle: 'italic' }}>Cerrado</span>
              )}
              {bloques.map((b, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input type="time" value={b.hora_inicio}
                         onChange={e => updateBloque(d.i, i, 'hora_inicio', e.target.value)}
                         style={timeInput} />
                  <span style={{ color: 'var(--text-3)' }}>→</span>
                  <input type="time" value={b.hora_fin}
                         onChange={e => updateBloque(d.i, i, 'hora_fin', e.target.value)}
                         style={timeInput} />
                  <button onClick={() => removeBloque(d.i, i)} type="button"
                          style={{ padding: 4, borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--red, #f87171)', cursor: 'pointer' }}>
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
              <button onClick={() => addBloque(d.i)} type="button"
                      style={{
                        padding: '4px 8px', borderRadius: 6,
                        background: 'var(--bg-1)', border: '1px dashed var(--line)',
                        color: 'var(--text-3)', cursor: 'pointer', fontSize: 11,
                      }}>
                <Plus size={10} style={{ verticalAlign: '-1px' }} /> bloque
              </button>
            </div>
          )
        })}
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
