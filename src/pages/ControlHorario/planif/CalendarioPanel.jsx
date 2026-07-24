import { useState, useEffect, useCallback, useMemo } from 'react'
import { ChevronLeft, ChevronRight, Save, Calendar, RotateCcw, Copy, Repeat, Shuffle, X } from 'lucide-react'
import { Card, Btn, Badge } from '../../../components/UI'
import { useToast } from '../../../components/Toast'
import {
  asignacionesSemana, asignacionesBulk, plantillasList,
  copiarSemana, replicarSemana, aplicarPatronRotativo,
} from '../../../utils/horarioApi'
import { useOverlayClose } from '../../../hooks/useOverlayClose'


const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']


function lunesDe(d) {
  const dt = new Date(d)
  const dow = dt.getDay() === 0 ? 7 : dt.getDay()
  dt.setDate(dt.getDate() - (dow - 1))
  return dt
}
function isoDate(d) {
  return d.toISOString().slice(0, 10)
}
function addDays(d, n) {
  const x = new Date(d); x.setDate(x.getDate() + n); return x
}
function fmtDia(d) {
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
}


export default function CalendarioPanel({ identity }) {
  const toast = useToast()
  const [lunes, setLunes] = useState(() => lunesDe(new Date()))
  const [data, setData] = useState({ trabajadores: [], asignaciones: [] })
  const [plantillas, setPlantillas] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  // mapa local de cambios pendientes: {`${trabId}|${fecha}`: {turno_plantilla_id, libre, accion}}
  const [pending, setPending] = useState({})

  const semana = useMemo(() =>
    Array.from({ length: 7 }, (_, i) => addDays(lunes, i)),
  [lunes])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [a, ps] = await Promise.all([
        asignacionesSemana(identity, isoDate(lunes)),
        plantillasList(identity),
      ])
      setData(a)
      setPlantillas(ps)
      setPending({})
    } catch (e) { toast.error('Error: ' + e.message) }
    finally { setLoading(false) }
  }, [identity, lunes, toast])

  useEffect(() => { reload() }, [reload])

  // Lookup actual = pending ?? data
  const asignMap = useMemo(() => {
    const m = {}
    for (const a of data.asignaciones || []) {
      m[`${a.trabajador_id}|${a.fecha}`] = a
    }
    return m
  }, [data])

  function cellState(tid, fecha) {
    const k = `${tid}|${fecha}`
    if (pending[k]) return pending[k]
    const a = asignMap[k]
    if (!a) return { vacia: true }
    return {
      turno_plantilla_id: a.turno_plantilla_id,
      libre: a.libre,
      plantilla_nombre: a.plantilla_nombre,
      plantilla_color:  a.plantilla_color,
    }
  }

  function setCell(tid, fecha, accion, plId) {
    const k = `${tid}|${fecha}`
    if (accion === 'borrar') {
      setPending(p => ({ ...p, [k]: { accion: 'borrar', vacia: true } }))
    } else if (accion === 'libre') {
      setPending(p => ({ ...p, [k]: { accion: 'libre', libre: true, plantilla_nombre: 'Libre' } }))
    } else {
      const pl = plantillas.find(x => x.id === plId)
      setPending(p => ({
        ...p,
        [k]: {
          accion: 'asignar',
          turno_plantilla_id: plId,
          plantilla_nombre: pl?.nombre || '',
          plantilla_color:  pl?.color  || 'cyan',
        },
      }))
    }
  }

  const dirty = Object.keys(pending).length > 0

  const [busy, setBusy] = useState(false)
  const [modal, setModal] = useState(null)  // 'replicar' | 'rotativo'

  async function handleCopiarAnterior() {
    if (!confirm('Copiar las asignaciones de la semana anterior aquí (reemplaza lo actual)?')) return
    setBusy(true)
    try {
      const ant = addDays(lunes, -7)
      const r = await copiarSemana(identity, {
        desde_lunes: isoDate(ant),
        hasta_lunes: isoDate(lunes),
        replace: true,
      })
      toast.success(`Copiadas ${r.copiadas} asignaciones (${r.borradas} reemplazadas)`)
      reload()
    } catch (e) { toast.error('Error: ' + (e.body?.error || e.message)) }
    finally { setBusy(false) }
  }

  async function handleGuardar() {
    setSaving(true)
    const ops = Object.entries(pending).map(([k, v]) => {
      const [tid, fecha] = k.split('|')
      return {
        trabajador_id: Number(tid),
        fecha,
        accion: v.accion,
        turno_plantilla_id: v.accion === 'asignar' ? v.turno_plantilla_id : null,
      }
    })
    try {
      const r = await asignacionesBulk(identity, ops)
      toast.success(`Guardado: ${r.upsert} asignaciones, ${r.delete} borradas`)
      reload()
    } catch (e) { toast.error('Error: ' + (e.body?.error || e.message)) }
    finally { setSaving(false) }
  }

  return (
    <Card style={{ padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <button onClick={() => setLunes(addDays(lunes, -7))} style={navBtn} title="Semana anterior">
          <ChevronLeft size={16} />
        </button>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-0)' }}>
          {fmtDia(lunes)} → {fmtDia(addDays(lunes, 6))}
        </div>
        <button onClick={() => setLunes(addDays(lunes, 7))} style={navBtn} title="Semana siguiente">
          <ChevronRight size={16} />
        </button>
        <button onClick={() => setLunes(lunesDe(new Date()))} style={navBtn} title="Esta semana">
          <Calendar size={14} /> Hoy
        </button>

        <div style={{ marginLeft: 8, display: 'flex', gap: 6 }}>
          <Btn size="sm" variant="ghost" onClick={handleCopiarAnterior} disabled={busy || dirty}
               title="Copia asignaciones de la semana anterior aquí">
            <Copy size={13} /> Copiar anterior
          </Btn>
          <Btn size="sm" variant="ghost" onClick={() => setModal('replicar')} disabled={busy || dirty}
               title="Replica esta semana N semanas siguientes">
            <Repeat size={13} /> Replicar…
          </Btn>
          <Btn size="sm" variant="ghost" onClick={() => setModal('rotativo')} disabled={busy || dirty}
               title="Aplica un patrón rotativo A/B durante varias semanas">
            <Shuffle size={13} /> Patrón…
          </Btn>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {dirty && (
            <>
              <span style={{
                padding: '3px 10px', borderRadius: 999, fontSize: 10, fontWeight: 700,
                background: 'rgba(245,158,11,0.15)', color: '#f59e0b',
                border: '1px solid rgba(245,158,11,0.35)',
                textTransform: 'uppercase', letterSpacing: '0.04em',
              }}>● {Object.keys(pending).length} sin guardar</span>
              <Btn size="sm" variant="ghost" onClick={() => setPending({})}>
                <RotateCcw size={13} /> Descartar
              </Btn>
            </>
          )}
          <Btn size="sm" onClick={handleGuardar} disabled={saving || !dirty}>
            <Save size={13} /> {saving ? 'Guardando…' : 'Guardar'}
          </Btn>
        </div>
      </div>

      {plantillas.length === 0 && (
        <p style={{ padding: 12, borderRadius: 8, background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.16)', color: 'var(--text-2)', fontSize: 12 }}>
          Aún no hay plantillas. Crea al menos una en la sub-tab <strong>Plantillas</strong> para poder asignar turnos.
        </p>
      )}

      {loading ? (
        <p style={{ color: 'var(--text-3)' }}>Cargando…</p>
      ) : data.trabajadores.length === 0 ? (
        <p style={{ color: 'var(--text-3)', fontSize: 12 }}>
          No hay trabajadores activos para planificar.
        </p>
      ) : (
        <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid var(--line)' }}>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--bg-2)' }}>
                <th style={{ ...th, minWidth: 160 }}>Trabajador</th>
                {semana.map((d, i) => (
                  <th key={i} style={{ ...th, textAlign: 'center', minWidth: 120 }}>
                    {DIAS[i]} <span style={{ color: 'var(--text-3)', fontWeight: 500 }}>{d.getDate()}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.trabajadores.map(t => (
                <tr key={t.id} style={{ borderTop: '1px solid var(--line)' }}>
                  <td style={{ ...td, fontWeight: 600, color: 'var(--text-1)' }}>
                    {t.nombre || `#${t.id}`}
                    <div style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                      {t.nif || '—'}
                    </div>
                  </td>
                  {semana.map((d, i) => {
                    const fecha = isoDate(d)
                    const s = cellState(t.id, fecha)
                    return (
                      <td key={i} style={{ ...td, textAlign: 'center', verticalAlign: 'middle' }}>
                        <CeldaSelector
                          state={s}
                          plantillas={plantillas}
                          onChange={(accion, plId) => setCell(t.id, fecha, accion, plId)} />
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal === 'replicar' && (
        <ModalReplicar
          lunes={lunes}
          identity={identity}
          onClose={() => setModal(null)}
          onDone={() => { setModal(null); reload() }} />
      )}
      {modal === 'rotativo' && (
        <ModalPatron
          lunes={lunes}
          identity={identity}
          onClose={() => setModal(null)}
          onDone={() => { setModal(null); reload() }} />
      )}
    </Card>
  )
}


function ModalReplicar({ lunes, identity, onClose, onDone }) {
  const toast = useToast()
  const [num, setNum] = useState(4)
  const [replace, setReplace] = useState(true)
  const [busy, setBusy] = useState(false)

  async function aplicar() {
    if (num < 1 || num > 52) return
    setBusy(true)
    try {
      const r = await replicarSemana(identity, {
        desde_lunes: isoDate(lunes),
        num_semanas: num,
        replace,
      })
      toast.success(`Replicada en ${r.semanas} semanas (${r.copiadas} asignaciones)`)
      onDone()
    } catch (e) { toast.error('Error: ' + (e.body?.error || e.message)) }
    finally { setBusy(false) }
  }

  return (
    <Overlay onClose={onClose} titulo="Replicar esta semana">
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-2)' }}>
        Copia las asignaciones de la semana del <strong>{lunes.toLocaleDateString('es-ES', { day: '2-digit', month: 'long' })}</strong> a las <strong>{num}</strong> semanas siguientes.
      </p>
      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <label style={lbl}>
          Número de semanas siguientes
          <input type="number" min={1} max={52} value={num}
                 onChange={e => setNum(Number(e.target.value) || 1)}
                 style={inp} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-2)' }}>
          <input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} />
          Reemplazar lo que haya en las semanas destino
        </label>
      </div>
      <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Btn size="sm" variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Btn>
        <Btn size="sm" onClick={aplicar} disabled={busy}>
          <Repeat size={13} /> {busy ? 'Replicando…' : 'Replicar'}
        </Btn>
      </div>
    </Overlay>
  )
}


function ModalPatron({ lunes, identity, onClose, onDone }) {
  const toast = useToast()
  const [origenes, setOrigenes] = useState([
    isoDate(addDays(lunes, -7)),
    isoDate(lunes),
  ])
  const [ciclos, setCiclos] = useState(2)
  const [destinoInicial, setDestinoInicial] = useState(isoDate(addDays(lunes, 7)))
  const [replace, setReplace] = useState(true)
  const [busy, setBusy] = useState(false)

  function addOrigen() {
    if (origenes.length >= 6) return
    setOrigenes(o => [...o, isoDate(addDays(lunes, 7 * (o.length)))])
  }
  function setOrigen(i, v) { setOrigenes(o => o.map((x, k) => k === i ? v : x)) }
  function removeOrigen(i) { setOrigenes(o => o.filter((_, k) => k !== i)) }

  async function aplicar() {
    if (origenes.length < 2) {
      toast.error('Necesitas al menos 2 semanas para alternar'); return
    }
    setBusy(true)
    try {
      const r = await aplicarPatronRotativo(identity, {
        semanas_origen: origenes,
        desde_lunes: destinoInicial,
        num_ciclos: ciclos,
        replace,
      })
      toast.success(`Aplicado: ${r.semanas_aplicadas} semanas (${r.copiadas} asignaciones)`)
      onDone()
    } catch (e) { toast.error('Error: ' + (e.body?.error || e.message)) }
    finally { setBusy(false) }
  }

  const total = ciclos * origenes.length
  return (
    <Overlay onClose={onClose} titulo="Patrón rotativo de semanas">
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-2)' }}>
        Define 2-6 semanas <em>plantilla</em> y se alternarán cíclicamente
        durante <strong>{ciclos}</strong> ciclos = <strong>{total}</strong> semanas
        a partir de la fecha destino.
      </p>
      <div style={{ marginTop: 12 }}>
        <strong style={{ fontSize: 12, color: 'var(--text-1)' }}>Semanas plantilla (lunes):</strong>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
          {origenes.map((o, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, width: 60, color: 'var(--text-3)' }}>
                Semana {'ABCDEF'[i]}
              </span>
              <input type="date" value={o}
                     onChange={e => setOrigen(i, e.target.value)}
                     style={{ ...inp, flex: 1 }} />
              {origenes.length > 2 && (
                <button onClick={() => removeOrigen(i)} type="button"
                        style={{ padding: 4, border: 'none', background: 'transparent', color: 'var(--red, #f87171)', cursor: 'pointer' }}>
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
          {origenes.length < 6 && (
            <Btn size="sm" variant="ghost" onClick={addOrigen}>+ Añadir semana plantilla</Btn>
          )}
        </div>
      </div>
      <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label style={lbl}>
          Empezar el lunes
          <input type="date" value={destinoInicial}
                 onChange={e => setDestinoInicial(e.target.value)} style={inp} />
        </label>
        <label style={lbl}>
          Ciclos
          <input type="number" min={1} max={12} value={ciclos}
                 onChange={e => setCiclos(Number(e.target.value) || 1)} style={inp} />
        </label>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-2)', marginTop: 8 }}>
        <input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} />
        Reemplazar lo que haya en las semanas destino
      </label>
      <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Btn size="sm" variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Btn>
        <Btn size="sm" onClick={aplicar} disabled={busy}>
          <Shuffle size={13} /> {busy ? 'Aplicando…' : `Aplicar (${total} sem.)`}
        </Btn>
      </div>
    </Overlay>
  )
}


function Overlay({ titulo, children, onClose }) {
  const overlayClose = useOverlayClose(onClose)
  return (
    <div {...overlayClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--bg-0)', borderRadius: 12, padding: 20,
        width: '90%', maxWidth: 480,
        border: '1px solid var(--line)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <strong style={{ fontSize: 15, color: 'var(--text-0)' }}>{titulo}</strong>
          <button onClick={onClose} type="button"
                  style={{ padding: 4, border: 'none', background: 'transparent', color: 'var(--text-3)', cursor: 'pointer' }}>
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}


function CeldaSelector({ state, plantillas, onChange }) {
  function handleSel(e) {
    const v = e.target.value
    if (v === '__libre__') onChange('libre')
    else if (v === '__borrar__') onChange('borrar')
    else if (v) onChange('asignar', Number(v))
  }
  const value = state.libre
    ? '__libre__'
    : state.vacia
      ? ''
      : String(state.turno_plantilla_id || '')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
      {!state.vacia && (
        <Badge color={state.libre ? 'gray' : (state.plantilla_color || 'cyan')}>
          {state.libre ? 'Libre' : (state.plantilla_nombre || '—')}
        </Badge>
      )}
      <select value={value} onChange={handleSel}
              style={{
                padding: '3px 6px', borderRadius: 6,
                border: '1px solid var(--line)',
                background: 'var(--bg-1)', color: 'var(--text-1)',
                fontSize: 11, maxWidth: 110,
              }}>
        <option value="">— sin asignar —</option>
        <option value="__libre__">Libre</option>
        {plantillas.map(p => (
          <option key={p.id} value={p.id}>{p.nombre}</option>
        ))}
        {!state.vacia && <option value="__borrar__">Borrar</option>}
      </select>
    </div>
  )
}


const navBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '5px 10px', borderRadius: 6,
  border: '1px solid var(--line)', background: 'var(--bg-1)',
  color: 'var(--text-1)', cursor: 'pointer', fontSize: 12,
}
const th = {
  textAlign: 'left', padding: '8px 10px',
  fontSize: 10.5, fontWeight: 600, color: 'var(--text-3)',
  textTransform: 'uppercase', letterSpacing: '0.05em',
}
const td = { padding: '8px 10px' }
const lbl = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--text-2)', fontWeight: 600 }
const inp = {
  padding: '6px 8px', borderRadius: 6, border: '1px solid var(--line)',
  background: 'var(--bg-1)', color: 'var(--text-0)', fontSize: 13,
}
