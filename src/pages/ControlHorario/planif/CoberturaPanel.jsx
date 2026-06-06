import { useState, useEffect, useCallback, useMemo } from 'react'
import { ChevronLeft, ChevronRight, Calendar, AlertTriangle, CheckCircle2, TrendingUp } from 'lucide-react'
import { Card, Btn, Badge } from '../../../components/UI'
import { useToast } from '../../../components/Toast'
import { coberturaSemana, temporadasList } from '../../../utils/horarioApi'


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


export default function CoberturaPanel({ identity }) {
  const toast = useToast()
  const [lunes, setLunes] = useState(() => lunesDe(new Date()))
  const [temporadas, setTemporadas] = useState([])
  const [temporadaId, setTemporadaId] = useState('')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    temporadasList(identity).then(setTemporadas).catch(() => {})
  }, [identity])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const r = await coberturaSemana(identity, isoDate(lunes), temporadaId || null)
      setData(r)
    } catch (e) { toast.error('Error: ' + e.message) }
    finally { setLoading(false) }
  }, [identity, lunes, temporadaId, toast])

  useEffect(() => { reload() }, [reload])

  const semana = useMemo(() =>
    Array.from({ length: 7 }, (_, i) => addDays(lunes, i)),
  [lunes])

  // Agrupa franjas por día
  const franjasPorDia = useMemo(() => {
    const m = {}
    for (const f of data?.franjas || []) {
      m[f.fecha] ??= []
      m[f.fecha].push(f)
    }
    Object.values(m).forEach(lst => lst.sort((a, b) =>
      a.hora_inicio.localeCompare(b.hora_inicio) ||
      a.puesto_nombre.localeCompare(b.puesto_nombre)
    ))
    return m
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
          <select value={temporadaId} onChange={e => setTemporadaId(e.target.value)}
                  style={{
                    padding: '5px 10px', borderRadius: 6,
                    border: '1px solid var(--line)', background: 'var(--bg-1)',
                    color: 'var(--text-1)', fontSize: 12, marginLeft: 8,
                  }}>
            <option value="">— Todas las temporadas —</option>
            {temporadas.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </select>
        </div>
      </Card>

      {/* KPIs */}
      {data && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          <KpiCard icon={CheckCircle2} label="Franjas OK"
                   value={data.kpi.franjas_ok} total={data.kpi.total_franjas}
                   color="#10b981" />
          <KpiCard icon={AlertTriangle} label="Críticas (déficit)"
                   value={data.kpi.franjas_criticas} total={data.kpi.total_franjas}
                   color="#f87171" />
          <KpiCard icon={TrendingUp} label="Sobre-cobertura"
                   value={data.kpi.franjas_exceso} total={data.kpi.total_franjas}
                   color="#f59e0b" />
          <KpiCard label="Horas planificadas"
                   value={(data.resumen_trabajadores || []).reduce((a, x) => a + x.horas_trabajo, 0).toFixed(1) + 'h'}
                   color="#3b82f6" />
        </div>
      )}

      {/* Mapa franjas día×puesto */}
      <Card style={{ padding: 14 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--text-0)' }}>
          Cobertura por día y puesto
        </h3>
        {loading && <p style={{ color: 'var(--text-3)' }}>Cargando…</p>}
        {!loading && data && (data.franjas || []).length === 0 && (
          <p style={{ color: 'var(--text-3)', fontSize: 12 }}>
            No hay demanda definida para esta semana. Configura "Puestos y demanda"
            antes de planificar.
          </p>
        )}
        {!loading && data && (data.franjas || []).length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8 }}>
            {semana.map((d, i) => {
              const fecha = isoDate(d)
              const franjas = franjasPorDia[fecha] || []
              return (
                <div key={i} style={{
                  padding: 8, borderRadius: 8,
                  background: 'var(--bg-2)', border: '1px solid var(--line)',
                  minHeight: 120, display: 'flex', flexDirection: 'column', gap: 4,
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-2)', marginBottom: 4, textAlign: 'center' }}>
                    {DIAS[i]} <span style={{ color: 'var(--text-3)', fontWeight: 500 }}>{d.getDate()}</span>
                  </div>
                  {franjas.length === 0 && (
                    <p style={{ fontSize: 10, color: 'var(--text-3)', textAlign: 'center', fontStyle: 'italic', margin: 0 }}>
                      Sin demanda
                    </p>
                  )}
                  {franjas.map((f, j) => <FranjaCard key={j} f={f} />)}
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {/* Resumen por trabajador */}
      {data && (data.resumen_trabajadores || []).length > 0 && (
        <Card style={{ padding: 14 }}>
          <h3 style={{ margin: '0 0 10px', fontSize: 14, color: 'var(--text-0)' }}>
            Horas planificadas por trabajador
          </h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-2)' }}>
                  <th style={th}>Trabajador</th>
                  <th style={{ ...th, textAlign: 'right' }}>Horas</th>
                  <th style={{ ...th, textAlign: 'right' }}>Días</th>
                  <th style={th}>Por puesto</th>
                </tr>
              </thead>
              <tbody>
                {data.resumen_trabajadores.map(t => (
                  <tr key={t.trabajador_id} style={{ borderTop: '1px solid var(--line)' }}>
                    <td style={{ ...td, fontWeight: 600 }}>{t.trabajador_nombre}</td>
                    <td style={{ ...td, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                      {t.horas_trabajo.toFixed(2)}
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>{t.dias_trabajo}</td>
                    <td style={td}>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {(t.puestos || []).map(p => (
                          <span key={p.puesto_id} style={{
                            padding: '2px 8px', borderRadius: 999,
                            background: 'var(--bg-2)', border: '1px solid var(--line)',
                            fontSize: 10, color: 'var(--text-2)',
                          }}>
                            {p.puesto_nombre} · {p.horas.toFixed(1)}h
                          </span>
                        ))}
                      </div>
                    </td>
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


function FranjaCard({ f }) {
  const bg = f.estado === 'critico' ? 'rgba(248,113,113,0.15)'
           : f.estado === 'exceso'  ? 'rgba(245,158,11,0.15)'
                                    : 'rgba(16,185,129,0.10)'
  const bd = f.estado === 'critico' ? 'rgba(248,113,113,0.45)'
           : f.estado === 'exceso'  ? 'rgba(245,158,11,0.45)'
                                    : 'rgba(16,185,129,0.30)'
  return (
    <div style={{
      padding: '5px 7px', borderRadius: 6, fontSize: 10,
      background: bg, border: `1px solid ${bd}`, color: 'var(--text-1)',
    }} title={f.estado === 'critico' ? `Faltan ${f.deficit}` : (f.estado === 'exceso' ? `Sobran ${f.exceso}` : 'OK')}>
      <div style={{ fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
        {f.hora_inicio}–{f.hora_fin}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
        <span style={{ color: 'var(--text-2)' }}>{f.puesto_nombre}</span>
        <span style={{ fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
          {f.asignado}/{f.requerido}
        </span>
      </div>
    </div>
  )
}


function KpiCard({ icon: Icon, label, value, total, color }) {
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
        <p style={{ margin: '2px 0 0', fontSize: 20, fontWeight: 700, color: 'var(--text-0)' }}>
          {value}{total !== undefined && <span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 500 }}>{' / '}{total}</span>}
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
const td = { padding: '6px 10px' }
