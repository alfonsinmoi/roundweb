import { useState, useEffect, useCallback, useMemo } from 'react'
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react'
import { Card, Badge } from '../../../components/UI'
import { useToast } from '../../../components/Toast'
import { asignacionesMes } from '../../../utils/horarioApi'


const DIAS_CORTO = ['L', 'M', 'X', 'J', 'V', 'S', 'D']


function isoDate(d) { return d.toISOString().slice(0, 10) }
function fmtMesAnio(d) {
  return d.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })
}


export default function VistaMensualPanel({ identity }) {
  const toast = useToast()
  const hoy = new Date()
  const [anioMes, setAnioMes] = useState(`${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const r = await asignacionesMes(identity, anioMes)
      setData(r)
    } catch (e) { toast.error('Error: ' + e.message) }
    finally { setLoading(false) }
  }, [identity, anioMes, toast])

  useEffect(() => { reload() }, [reload])

  // Construir grid: array de días entre primer_lunes y ultimo_domingo
  const dias = useMemo(() => {
    if (!data) return []
    const ini = new Date(data.primer_lunes)
    const fin = new Date(data.ultimo_domingo)
    const out = []
    const d = new Date(ini)
    while (d <= fin) {
      out.push(new Date(d))
      d.setDate(d.getDate() + 1)
    }
    return out
  }, [data])

  // Mapa de asignaciones: trab -> fecha -> asignacion
  const mapa = useMemo(() => {
    const m = {}
    if (!data) return m
    for (const a of data.asignaciones) {
      const k = a.trabajador_id
      m[k] = m[k] || {}
      m[k][a.fecha] = a
    }
    return m
  }, [data])

  function navegar(delta) {
    const [a, m] = anioMes.split('-').map(Number)
    const d = new Date(a, m - 1, 1)
    d.setMonth(d.getMonth() + delta)
    setAnioMes(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  const [a, m] = anioMes.split('-').map(Number)
  const refMes = new Date(a, m - 1, 1)
  const primerDiaMes = data ? new Date(data.primer_dia_mes) : null
  const ultimoDiaMes = data ? new Date(data.ultimo_dia_mes) : null

  return (
    <Card style={{ padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <button onClick={() => navegar(-1)} style={navBtn}><ChevronLeft size={16} /></button>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-0)', textTransform: 'capitalize' }}>
          {fmtMesAnio(refMes)}
        </div>
        <button onClick={() => navegar(1)} style={navBtn}><ChevronRight size={16} /></button>
        <button onClick={() => {
          const h = new Date()
          setAnioMes(`${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}`)
        }} style={navBtn}>
          <Calendar size={14} /> Hoy
        </button>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-3)' }}>
          Vista de solo lectura. Para editar usa <strong>Calendario semanal</strong>.
        </span>
      </div>

      {loading && <p style={{ color: 'var(--text-3)' }}>Cargando…</p>}

      {!loading && data && data.trabajadores.length > 0 && (
        <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid var(--line)' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ background: 'var(--bg-2)' }}>
                <th style={{ ...th, position: 'sticky', left: 0, background: 'var(--bg-2)', zIndex: 2, minWidth: 160 }}>
                  Trabajador
                </th>
                {dias.map((d, i) => {
                  const fueraMes = primerDiaMes && (d < primerDiaMes || d > ultimoDiaMes)
                  const isHoy = d.toDateString() === hoy.toDateString()
                  return (
                    <th key={i} style={{
                      ...th, padding: '6px 4px', textAlign: 'center', minWidth: 44,
                      background: isHoy ? 'rgba(16,185,129,0.15)' : (fueraMes ? 'var(--bg-2)' : 'var(--bg-2)'),
                      color: fueraMes ? 'var(--text-3)' : 'var(--text-2)',
                      opacity: fueraMes ? 0.5 : 1,
                    }}>
                      <div style={{ fontSize: 9, fontWeight: 500 }}>{DIAS_CORTO[i % 7]}</div>
                      <div style={{ fontSize: 12, fontWeight: 700 }}>{d.getDate()}</div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {data.trabajadores.map(t => (
                <tr key={t.id} style={{ borderTop: '1px solid var(--line)' }}>
                  <td style={{ ...td, position: 'sticky', left: 0, background: 'var(--bg-0)', zIndex: 1,
                              fontWeight: 600, color: 'var(--text-1)', fontSize: 12 }}>
                    {t.nombre || `#${t.id}`}
                  </td>
                  {dias.map((d, i) => {
                    const fueraMes = primerDiaMes && (d < primerDiaMes || d > ultimoDiaMes)
                    const f = isoDate(d)
                    const a = mapa[t.id]?.[f]
                    return (
                      <td key={i} style={{
                        ...td, padding: '3px 2px', textAlign: 'center',
                        opacity: fueraMes ? 0.35 : 1,
                        background: a ? (fueraMes ? 'transparent' : 'rgba(255,255,255,0.02)') : 'transparent',
                      }} title={a?.plantilla_nombre || ''}>
                        {a ? (
                          <Badge color={a.libre ? 'gray' : (a.plantilla_color || 'cyan')} size="sm">
                            {a.libre ? 'L' : abrev(a.plantilla_nombre)}
                          </Badge>
                        ) : (
                          <span style={{ color: 'var(--text-3)', fontSize: 10 }}>·</span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && data && data.trabajadores.length === 0 && (
        <p style={{ color: 'var(--text-3)', fontSize: 12 }}>No hay trabajadores activos.</p>
      )}

      <p style={{ marginTop: 10, fontSize: 10, color: 'var(--text-3)' }}>
        Cada celda muestra la plantilla asignada abreviada — pasa el ratón por encima para ver el nombre completo.
      </p>
    </Card>
  )
}


function abrev(nombre) {
  if (!nombre) return '·'
  // Coger las primeras 2 cifras de la hora inicial + final si las hay
  // o las primeras letras
  const m = nombre.match(/^(\d{1,2})/)
  if (m) return m[1]
  return nombre.slice(0, 3)
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
const td = { padding: '6px 8px' }
