import { useState, useEffect, useCallback, useMemo } from 'react'
import { ChevronLeft, ChevronRight, Calendar, ChevronDown, ChevronUp, Users } from 'lucide-react'
import { Card, Btn, Badge } from '../../../components/UI'
import { useToast } from '../../../components/Toast'
import { calendarioTrabajador } from '../../../utils/horarioApi'


const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']


function lunesDe(d) {
  const dt = new Date(d)
  const dow = dt.getDay() === 0 ? 7 : dt.getDay()
  dt.setDate(dt.getDate() - (dow - 1))
  return dt
}
function isoDate(d) { return d.toISOString().slice(0, 10) }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x }
function fmtDia(d) { return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }) }
function fmtH(h) {
  if (h == null) return '—'
  if (h === 0) return '—'
  return h % 1 === 0 ? `${h}h` : `${h.toFixed(2)}h`
}


export default function CalendarioTrabajadorPanel({ identity }) {
  const toast = useToast()
  const [lunes, setLunes] = useState(() => lunesDe(new Date()))
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(new Set())

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const r = await calendarioTrabajador(identity, isoDate(lunes))
      setData(r)
    } catch (e) { toast.error('Error: ' + e.message) }
    finally { setLoading(false) }
  }, [identity, lunes, toast])

  useEffect(() => { reload() }, [reload])

  const semana = useMemo(() =>
    Array.from({ length: 7 }, (_, i) => addDays(lunes, i)),
  [lunes])

  function toggleExpand(tid) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(tid)) next.delete(tid); else next.add(tid)
      return next
    })
  }

  return (
    <Card style={{ padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <button onClick={() => setLunes(addDays(lunes, -7))} style={navBtn}><ChevronLeft size={16} /></button>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-0)' }}>
          {fmtDia(lunes)} → {fmtDia(addDays(lunes, 6))}
        </div>
        <button onClick={() => setLunes(addDays(lunes, 7))} style={navBtn}><ChevronRight size={16} /></button>
        <button onClick={() => setLunes(lunesDe(new Date()))} style={navBtn}>
          <Calendar size={14} /> Hoy
        </button>
      </div>

      {loading && <p style={{ color: 'var(--text-3)' }}>Cargando…</p>}

      {!loading && data && data.trabajadores.length === 0 && (
        <p style={{ color: 'var(--text-3)', fontSize: 12 }}>
          No hay trabajadores activos para mostrar.
        </p>
      )}

      {!loading && data && data.trabajadores.length > 0 && (
        <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid var(--line)' }}>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--bg-2)' }}>
                <th style={{ ...th, width: 32 }}></th>
                <th style={{ ...th, minWidth: 180 }}>Trabajador</th>
                {semana.map((d, i) => (
                  <th key={i} style={{ ...th, textAlign: 'center', minWidth: 80 }}>
                    {DIAS[i]} <span style={{ color: 'var(--text-3)', fontWeight: 500 }}>{d.getDate()}</span>
                  </th>
                ))}
                <th style={{ ...th, textAlign: 'right', minWidth: 90 }}>Total</th>
                <th style={{ ...th, textAlign: 'right', minWidth: 90 }}>Jornada</th>
              </tr>
            </thead>
            <tbody>
              {data.trabajadores.map(t => (
                <FilaTrabajador key={t.id} t={t} expanded={expanded.has(t.id)}
                                onToggle={() => toggleExpand(t.id)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}


function FilaTrabajador({ t, expanded, onToggle }) {
  const cumple = t.jornada_h_semana ? (t.horas_semana / t.jornada_h_semana) : null
  const colorCumple = cumple == null ? 'var(--text-3)'
    : cumple < 0.85 ? '#f87171'
    : cumple > 1.05 ? '#f59e0b'
    : 'var(--green, #10b981)'
  return (
    <>
      <tr style={{ borderTop: '1px solid var(--line)' }}>
        <td style={td}>
          <button onClick={onToggle} style={iconBtn} title={expanded ? 'Cerrar' : 'Ver detalle'}>
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </td>
        <td style={{ ...td, fontWeight: 600 }}>
          {t.nombre}
          <div style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>{t.nif}</div>
        </td>
        {t.dias.map((d, i) => (
          <td key={i} style={{ ...td, textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 12,
                              color: d.horas > 0 ? 'var(--text-1)' : 'var(--text-3)',
                              background: d.horas > 0 ? 'rgba(16,185,129,0.04)' : 'transparent' }}>
            {d.horas > 0 ? `${d.horas}h` : '—'}
          </td>
        ))}
        <td style={{ ...td, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--text-0)' }}>
          {t.horas_semana}h
        </td>
        <td style={{ ...td, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, color: colorCumple, fontWeight: 600 }}>
          {t.jornada_h_semana ? `${t.horas_semana}/${t.jornada_h_semana}h` : '—'}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={11} style={{ padding: 0, background: 'var(--bg-2)' }}>
            <DetalleTrabajador t={t} />
          </td>
        </tr>
      )}
    </>
  )
}


function DetalleTrabajador({ t }) {
  // Por puesto (semana): chips
  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <p style={{ margin: '0 0 6px', fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
          Total por actividad (semana)
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {(t.horas_por_puesto || []).length === 0 && (
            <span style={{ fontSize: 11, color: 'var(--text-3)', fontStyle: 'italic' }}>Sin actividad asignada</span>
          )}
          {(t.horas_por_puesto || []).map(p => (
            <Badge key={p.puesto_id} color={p.puesto_color || 'gray'}>
              {p.puesto_codigo || p.puesto_nombre} · {p.horas}h
            </Badge>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
        {t.dias.map((d, i) => (
          <div key={i} style={{
            padding: 8, borderRadius: 8,
            background: 'var(--bg-1)', border: '1px solid var(--line)',
            opacity: d.horas > 0 ? 1 : 0.5,
          }}>
            <div style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {DIAS[i]} {new Date(d.fecha).getDate()}
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: d.horas > 0 ? 'var(--text-0)' : 'var(--text-3)', margin: '2px 0 6px' }}>
              {d.horas > 0 ? `${d.horas}h` : 'Libre'}
            </div>
            {(d.puestos || []).map(p => (
              <div key={p.puesto_id} style={{ marginBottom: 4 }}>
                <Badge color={p.puesto_color || 'gray'} size="sm">
                  {p.puesto_codigo || p.puesto_nombre} · {p.horas}h
                </Badge>
                <div style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', marginLeft: 4 }}>
                  {(p.bloques || []).map((b, k) => (
                    <div key={k}>{b[0]}–{b[1]}</div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}


const navBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '5px 10px', borderRadius: 6,
  border: '1px solid var(--line)', background: 'var(--bg-1)',
  color: 'var(--text-1)', cursor: 'pointer', fontSize: 12,
}
const iconBtn = {
  padding: 4, borderRadius: 6, border: 'none',
  background: 'transparent', color: 'var(--text-2)', cursor: 'pointer',
}
const th = {
  textAlign: 'left', padding: '8px 10px',
  fontSize: 10.5, fontWeight: 600, color: 'var(--text-3)',
  textTransform: 'uppercase', letterSpacing: '0.05em',
}
const td = { padding: '8px 10px' }
