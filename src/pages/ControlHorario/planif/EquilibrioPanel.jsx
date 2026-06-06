import { useState, useEffect, useCallback, useMemo } from 'react'
import { ChevronLeft, ChevronRight, Calendar, Scale, Sun, Moon, Split, Briefcase } from 'lucide-react'
import { Card, Btn, Badge } from '../../../components/UI'
import { useToast } from '../../../components/Toast'
import { equilibrioSemana } from '../../../utils/horarioApi'


function lunesDe(d) {
  const dt = new Date(d)
  const dow = dt.getDay() === 0 ? 7 : dt.getDay()
  dt.setDate(dt.getDate() - (dow - 1))
  return dt
}
function isoDate(d) { return d.toISOString().slice(0, 10) }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x }
function fmtDia(d) { return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }) }


export default function EquilibrioPanel({ identity }) {
  const toast = useToast()
  const [lunes, setLunes] = useState(() => lunesDe(new Date()))
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const r = await equilibrioSemana(identity, isoDate(lunes))
      setData(r)
    } catch (e) { toast.error('Error: ' + e.message) }
    finally { setLoading(false) }
  }, [identity, lunes, toast])

  useEffect(() => { reload() }, [reload])

  // Para cada métrica, calcular max para barras proporcionales
  const maxes = useMemo(() => {
    if (!data?.trabajadores) return {}
    const ts = data.trabajadores
    return {
      total:  Math.max(1, ...ts.map(t => t.horas_total)),
      manana: Math.max(1, ...ts.map(t => t.horas_manana)),
      tarde:  Math.max(1, ...ts.map(t => t.horas_tarde)),
      finde:  Math.max(1, ...ts.map(t => t.horas_finde)),
    }
  }, [data])

  // Puestos únicos en toda la semana
  const todosPuestos = useMemo(() => {
    if (!data?.trabajadores) return []
    const m = new Map()
    for (const t of data.trabajadores) {
      for (const p of (t.horas_por_puesto || [])) {
        if (!m.has(p.puesto_id)) m.set(p.puesto_id, p)
      }
    }
    return Array.from(m.values())
  }, [data])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card style={{ padding: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={() => setLunes(addDays(lunes, -7))} style={navBtn}><ChevronLeft size={16} /></button>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-0)' }}>
            {fmtDia(lunes)} → {fmtDia(addDays(lunes, 6))}
          </div>
          <button onClick={() => setLunes(addDays(lunes, 7))} style={navBtn}><ChevronRight size={16} /></button>
          <button onClick={() => setLunes(lunesDe(new Date()))} style={navBtn}>
            <Calendar size={14} /> Hoy
          </button>
        </div>
      </Card>

      {/* KPIs promedio */}
      {data?.promedio && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
          <Kpi icon={Scale}  label="Horas/semana promedio"     value={`${data.promedio.horas_total}h`} color="#3b82f6" />
          <Kpi icon={Sun}    label="Mañana promedio"            value={`${data.promedio.horas_manana}h`} color="#f59e0b" />
          <Kpi icon={Moon}   label="Tarde promedio"             value={`${data.promedio.horas_tarde}h`} color="#a78bfa" />
          <Kpi icon={Split}  label="Días partidos promedio"     value={data.promedio.dias_partidos} color="#f87171" />
        </div>
      )}

      {/* Tabla resumen */}
      {!loading && data && data.trabajadores.length > 0 && (
        <Card style={{ padding: 14 }}>
          <h3 style={{ margin: '0 0 10px', fontSize: 14, color: 'var(--text-0)' }}>
            Carga semanal por trabajador
          </h3>
          <p style={{ margin: '0 0 12px', fontSize: 11, color: 'var(--text-3)' }}>
            "Mañana" = bloques antes de las 14:00 · "Tarde" = a partir de las 14:00 ·
            "Partido" = un día con &gt;1 bloque separado por hueco ≥ 1 hora.
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-2)' }}>
                  <th style={th}>Trabajador</th>
                  <th style={{ ...th, textAlign: 'right' }}>Total</th>
                  <th style={{ ...th, textAlign: 'right' }}>% Jornada</th>
                  <th style={th}>Mañana / Tarde</th>
                  <th style={{ ...th, textAlign: 'center' }}>Fin sem.</th>
                  <th style={{ ...th, textAlign: 'center' }}>Turnos</th>
                  <th style={{ ...th, textAlign: 'center' }}>Días partidos</th>
                  <th style={th}>Por actividad</th>
                </tr>
              </thead>
              <tbody>
                {data.trabajadores.map(t => (
                  <FilaEquilibrio key={t.id} t={t} maxes={maxes} />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Comparativa por actividad */}
      {todosPuestos.length > 0 && (
        <Card style={{ padding: 14 }}>
          <h3 style={{ margin: '0 0 10px', fontSize: 14, color: 'var(--text-0)' }}>
            Distribución por actividad (horas/semana)
          </h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-2)' }}>
                  <th style={th}>Trabajador</th>
                  {todosPuestos.map(p => (
                    <th key={p.puesto_id} style={{ ...th, textAlign: 'right' }}>
                      <Badge color={p.puesto_color || 'gray'}>{p.puesto_codigo || p.puesto_nombre}</Badge>
                    </th>
                  ))}
                  <th style={{ ...th, textAlign: 'right' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {data.trabajadores.map(t => {
                  const porPuesto = Object.fromEntries((t.horas_por_puesto || []).map(p => [p.puesto_id, p.horas]))
                  return (
                    <tr key={t.id} style={{ borderTop: '1px solid var(--line)' }}>
                      <td style={{ ...td, fontWeight: 600 }}>{t.nombre}</td>
                      {todosPuestos.map(p => (
                        <td key={p.puesto_id} style={{ ...td, textAlign: 'right', fontFamily: 'var(--font-mono)',
                                                       color: porPuesto[p.puesto_id] ? 'var(--text-1)' : 'var(--text-3)' }}>
                          {porPuesto[p.puesto_id] ? `${porPuesto[p.puesto_id]}h` : '—'}
                        </td>
                      ))}
                      <td style={{ ...td, textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-0)' }}>
                        {t.horas_total}h
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}


function FilaEquilibrio({ t, maxes }) {
  const cumple = t.cumple_jornada_pct
  const colorPct = cumple == null ? 'var(--text-3)'
    : cumple < 85 ? '#f87171'
    : cumple > 105 ? '#f59e0b'
    : 'var(--green, #10b981)'

  const totalManTar = t.horas_manana + t.horas_tarde
  const pctManana = totalManTar > 0 ? (t.horas_manana / totalManTar) * 100 : 0

  return (
    <tr style={{ borderTop: '1px solid var(--line)' }}>
      <td style={{ ...td, fontWeight: 600 }}>
        {t.nombre}
        <div style={{ fontSize: 10, color: 'var(--text-3)' }}>Jornada: {t.jornada_h_semana ?? '—'}h</div>
      </td>
      <td style={{ ...td, textAlign: 'right' }}>
        <strong style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{t.horas_total}h</strong>
        <Bar value={t.horas_total} max={maxes.total} color="#3b82f6" />
      </td>
      <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: colorPct, fontFamily: 'var(--font-mono)' }}>
        {cumple != null ? `${cumple}%` : '—'}
      </td>
      <td style={td}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', width: 36, color: '#f59e0b' }}>{t.horas_manana}h</span>
          <div style={{ flex: 1, height: 8, background: 'rgba(168,139,250,0.2)', borderRadius: 4, position: 'relative', minWidth: 60 }}>
            <div style={{
              position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pctManana}%`,
              background: '#f59e0b', borderRadius: 4,
            }} />
          </div>
          <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', width: 36, textAlign: 'right', color: '#a78bfa' }}>{t.horas_tarde}h</span>
        </div>
      </td>
      <td style={{ ...td, textAlign: 'center', fontFamily: 'var(--font-mono)',
                  color: t.horas_finde > 0 ? 'var(--text-1)' : 'var(--text-3)' }}>
        {t.horas_finde > 0 ? `${t.horas_finde}h` : '—'}
      </td>
      <td style={{ ...td, textAlign: 'center', fontFamily: 'var(--font-mono)' }}>{t.n_turnos}</td>
      <td style={{ ...td, textAlign: 'center', fontFamily: 'var(--font-mono)',
                   color: t.dias_partidos > 0 ? '#f87171' : 'var(--text-3)',
                   fontWeight: t.dias_partidos > 0 ? 700 : 400 }}>
        {t.dias_partidos}
      </td>
      <td style={td}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {(t.horas_por_puesto || []).map(p => (
            <Badge key={p.puesto_id} color={p.puesto_color || 'gray'} size="sm">
              {p.puesto_codigo || p.puesto_nombre} {p.horas}h
            </Badge>
          ))}
          {(t.horas_por_puesto || []).length === 0 && (
            <span style={{ color: 'var(--text-3)', fontSize: 11, fontStyle: 'italic' }}>—</span>
          )}
        </div>
      </td>
    </tr>
  )
}


function Bar({ value, max, color }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div style={{ height: 4, background: 'var(--bg-2)', borderRadius: 2, marginTop: 4 }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2 }} />
    </div>
  )
}


function Kpi({ icon: Icon, label, value, color }) {
  return (
    <Card style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
      {Icon && (
        <div style={{
          width: 36, height: 36, borderRadius: 8,
          background: color + '20', color,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon size={18} />
        </div>
      )}
      <div>
        <p style={{ margin: 0, fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
          {label}
        </p>
        <p style={{ margin: '2px 0 0', fontSize: 18, fontWeight: 700, color: 'var(--text-0)' }}>
          {value}
        </p>
      </div>
    </Card>
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
const td = { padding: '8px 10px', verticalAlign: 'middle' }
