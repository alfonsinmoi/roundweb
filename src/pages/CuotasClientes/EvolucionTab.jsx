import { useState, useEffect, useMemo } from 'react'
import {
  BarChart3, Loader2, RefreshCw, TrendingUp, Users, CreditCard, Tag, Activity, Cake,
} from 'lucide-react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
  LineChart, Line,
} from 'recharts'
import { Card, Btn, SectionTitle } from '../../components/UI'
import { useToast } from '../../components/Toast'
import { cuotasList, FORMA_PAGO_LABELS } from '../../utils/cuotasApi'
import { recibosList } from '../../utils/configApi'
import { getClientes } from '../../utils/api'

// Mapea el metodo_pago de la BD local (recibo.metodo_pago) a la clave que
// usa FORMA_PAGO_LABELS para mostrar etiqueta legible.
const METODO_TO_FORMA = {
  sepa: 'sepa',
  tarjeta_tok: 'tarjeta_token',
  caja_efectivo: 'efectivo',
  caja_tpv_fisico: 'efectivo',
  caja_tpv_virtual: 'efectivo',
  enlace_pago: 'enlace_pago',
}

// Convierte un recibo local (tabla `recibo`) al shape que espera el
// resto del componente (que originalmente leía facturas Odoo).
function adaptarReciboLocal(r) {
  const estado = r.estado || ''
  const payment_state =
    (estado === 'pagado' || estado === 'facturado') ? 'paid'
    : estado === 'devuelto'                          ? 'reversed'
    : 'not_paid'
  return {
    ...r,
    state: 'posted',         // todos los locales se consideran emitidos
    payment_state,
    amount_total:  Number(r.importe_total || 0),
    partner_idnoofit: r.cliente_idnoofit,
    partner_id:    r.cliente_idnoofit ? { id: r.cliente_idnoofit } : null,
    forma_pago:    METODO_TO_FORMA[r.metodo_pago] || r.metodo_pago || '—',
    // cuota_codigo y periodicidad ya vienen igual
    cuota_actividades: r.cuota_descripcion || null,
  }
}

// Paleta consistente
const COLORS = ['#2DD4A8','#5B9CF6','#A78BFA','#FBBF24','#FB923C','#F87171','#10B981','#3B82F6','#8B5CF6']

const PERIODICIDAD_LABELS = {
  mensual:'Mensual', bimensual:'Bimensual', trimestral:'Trimestral', semestral:'Semestral', anual:'Anual',
}
const GENDER_LABELS = { M: 'Hombre', F: 'Mujer', O: 'Otro', male: 'Hombre', female: 'Mujer' }

// Genera lista YYYY-MM hacia atrás desde hoy
function lastNMonths(n) {
  const out = []
  const d = new Date()
  d.setDate(1)
  for (let i = 0; i < n; i++) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    d.setMonth(d.getMonth() - 1)
  }
  return out.reverse()
}

function calcEdad(birthdate) {
  if (!birthdate) return null
  const d = new Date(birthdate)
  if (isNaN(d.getTime())) return null
  const today = new Date()
  let age = today.getFullYear() - d.getFullYear()
  const m = today.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--
  return age
}

function bucketEdad(edad) {
  if (edad == null) return 'Sin edad'
  if (edad < 18) return '<18'
  if (edad < 25) return '18–24'
  if (edad < 35) return '25–34'
  if (edad < 45) return '35–44'
  if (edad < 55) return '45–54'
  if (edad < 65) return '55–64'
  return '65+'
}

// Clase (granular): el código completo de la cuota ("RT LX 0815", "I MYGYM"…)
function claseKey(s) {
  if (!s) return 'Sin clase'
  return String(s).trim()
}

// Actividad (familia): primera palabra del código.
//   RT LX 0815  → RT
//   RT MJ 1030  → RT
//   I MYGYM     → I MYGYM (palabra clave "I" + "MYGYM" se considera única)
//   Ciclo 15:05 → Ciclo
//   WOD pecho   → WOD
// Heurística específica de Round: si empieza por "I " (Independiente) lo
// tratamos como su propio grupo "I MYGYM" o lo que sea; si empieza por una
// letra/clase corta lo agrupamos por la primera palabra.
function actividadKey(s) {
  const c = (s || '').trim()
  if (!c) return 'Sin actividad'
  const partes = c.split(/\s+/)
  if (partes.length === 1) return partes[0]
  // Casos "I MYGYM", "I CICLO" → mantener "I MYGYM" (no agrupar por "I")
  if (partes[0] === 'I' && partes.length >= 2) return `${partes[0]} ${partes[1]}`
  return partes[0]
}

export default function EvolucionTab({ identity }) {
  const toast = useToast()
  const [meses, setMeses] = useState(() => lastNMonths(6))
  const [rango, setRango] = useState(6)            // 3 / 6 / 12
  const [loading, setLoading] = useState(false)
  const [recibos, setRecibos] = useState([])      // todos los recibos del rango
  const [clientesById, setClientesById] = useState({})  // by id_noofit

  async function reload() {
    setLoading(true)
    try {
      // Tira de la BD local `recibo` (incluye los importados de GestPlus).
      // El endpoint Odoo antiguo filtraba por round_subscription_id, lo que
      // dejaba fuera los recibos migrados que no tienen ese campo.
      const [clientesData, ...recibosPorMes] = await Promise.all([
        getClientes().catch(() => []),
        ...meses.map(m =>
          recibosList(identity, { periodo: m, limit: 500 }).catch(() => [])),
      ])
      const map = {}
      for (const c of clientesData) map[String(c.id)] = c
      setClientesById(map)
      const flat = []
      meses.forEach((m, i) => {
        for (const r of recibosPorMes[i] || []) {
          flat.push({ ...adaptarReciboLocal(r), _mes: m })
        }
      })
      setRecibos(flat)
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setLoading(false)
  }

  useEffect(() => { setMeses(lastNMonths(rango)) }, [rango])
  useEffect(() => { reload() }, [meses, identity.managerId, identity.trainerId])

  // Enriquecer cada recibo con datos del cliente NoofitPro
  const recibosEnriched = useMemo(() => {
    return recibos.map(r => {
      const cliente = r.partner_idnoofit ? clientesById[String(r.partner_idnoofit)] : null
      const edad = cliente
        ? ((cliente.age && cliente.age > 0) ? cliente.age : calcEdad(cliente.birthdate))
        : null
      return {
        ...r,
        gender: cliente?.gender || null,
        edad,
        edadBucket: bucketEdad(edad),
      }
    })
  }, [recibos, clientesById])

  // Series mensuales: [{mes, total, paid, pending, reversed}]
  const serieMensual = useMemo(() => {
    const map = {}
    for (const m of meses) map[m] = { mes: m, total: 0, count: 0, cobrado: 0, pendiente: 0, devuelto: 0 }
    for (const r of recibosEnriched) {
      const m = map[r._mes]
      if (!m) continue
      m.total += r.amount_total || 0
      m.count++
      if (r.payment_state === 'paid') m.cobrado += r.amount_total || 0
      else if (r.payment_state === 'reversed') m.devuelto += r.amount_total || 0
      else m.pendiente += r.amount_total || 0
    }
    return meses.map(m => map[m])
  }, [recibosEnriched, meses])

  // Agrupación: por dimensión, importe por mes
  function pivotByDimension(getKey) {
    // mapKey → mes → importe
    const result = {}    // {mapKey: {mes: importe, _total: x}}
    for (const r of recibosEnriched) {
      const k = getKey(r) || 'Sin dato'
      if (!result[k]) {
        result[k] = { _total: 0, _count: 0 }
        for (const m of meses) result[k][m] = 0
      }
      result[k][r._mes] += r.amount_total || 0
      result[k]._total += r.amount_total || 0
      result[k]._count++
    }
    return Object.entries(result)
      .map(([k, v]) => ({ key: k, ...v }))
      .sort((a, b) => b._total - a._total)
  }

  const porClase         = useMemo(() => pivotByDimension(r => claseKey(r.cuota_codigo)),     [recibosEnriched])
  const porActividad     = useMemo(() => pivotByDimension(r => actividadKey(r.cuota_codigo)),  [recibosEnriched])
  const porSexo          = useMemo(() => pivotByDimension(r => GENDER_LABELS[r.gender] || 'Sin sexo'), [recibosEnriched])
  const porEdad          = useMemo(() => pivotByDimension(r => r.edadBucket), [recibosEnriched])
  const porFormaPago     = useMemo(() => pivotByDimension(r => FORMA_PAGO_LABELS[r.forma_pago] || r.forma_pago || '—'), [recibosEnriched])
  const porPeriodicidad  = useMemo(() => pivotByDimension(r => PERIODICIDAD_LABELS[r.periodicidad] || r.periodicidad || '—'), [recibosEnriched])

  const totalRango = useMemo(() => recibosEnriched.reduce((s, r) => s + (r.amount_total || 0), 0), [recibosEnriched])
  const cobradoRango = useMemo(() => recibosEnriched.filter(r => r.payment_state === 'paid').reduce((s, r) => s + (r.amount_total || 0), 0), [recibosEnriched])
  const pendienteRango = totalRango - cobradoRango
  const clientesUnicos = useMemo(() => new Set(recibosEnriched.map(r => r.partner_id?.id).filter(Boolean)).size, [recibosEnriched])

  return (
    <div>
      {/* Controles */}
      <Card style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <BarChart3 size={18} style={{ color: 'var(--green)' }} />
            <strong style={{ fontSize: 14, color: 'var(--text-0)' }}>Evolución de recibos emitidos</strong>
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', gap: 4 }}>
            {[3, 6, 12].map(n => (
              <button key={n} onClick={() => setRango(n)} style={{
                padding: '6px 12px', borderRadius: 8,
                background: rango === n ? 'var(--green-bg)' : 'var(--bg-3)',
                color: rango === n ? 'var(--green)' : 'var(--text-2)',
                border: `1px solid ${rango === n ? 'var(--green-border)' : 'var(--line)'}`,
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}>{n} meses</button>
            ))}
          </div>
          <Btn size="sm" variant="secondary" onClick={reload} disabled={loading}>
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            Recargar
          </Btn>
        </div>
      </Card>

      {loading && (
        <Card style={{ padding: 60, textAlign: 'center' }}>
          <Loader2 size={28} className="animate-spin" style={{ color: 'var(--green)' }} />
          <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8 }}>Cargando datos…</p>
        </Card>
      )}

      {!loading && recibosEnriched.length === 0 && (
        <Card style={{ padding: 40, textAlign: 'center' }}>
          <p style={{ fontSize: 13, color: 'var(--text-3)' }}>
            No hay recibos emitidos en los últimos {rango} meses.
          </p>
        </Card>
      )}

      {!loading && recibosEnriched.length > 0 && <>
        {/* KPIs del rango */}
        <Card style={{ padding: 20, marginBottom: 16 }}>
          <SectionTitle>Resumen del rango ({meses[0]} → {meses[meses.length - 1]})</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginTop: 12 }}>
            <KPI label="Importe total emitido" value={`${totalRango.toFixed(2)} €`} color="var(--green)" />
            <KPI label="Cobrado" value={`${cobradoRango.toFixed(2)} €`} color="var(--green)" />
            <KPI label="Pendiente" value={`${pendienteRango.toFixed(2)} €`} color="var(--amber)" />
            <KPI label="Recibos" value={recibosEnriched.length} />
            <KPI label="Clientes únicos" value={clientesUnicos} />
            <KPI label="Ticket medio" value={recibosEnriched.length ? `${(totalRango / recibosEnriched.length).toFixed(2)} €` : '—'} />
          </div>
        </Card>

        {/* Evolución mensual (línea apilada) */}
        <Card style={{ padding: 20, marginBottom: 16 }}>
          <SectionTitle><TrendingUp size={14} style={{ marginRight: 6 }} /> Evolución mensual</SectionTitle>
          <div style={{ width: '100%', height: 280, marginTop: 12 }}>
            <ResponsiveContainer>
              <BarChart data={serieMensual}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                <XAxis dataKey="mes" stroke="var(--text-3)" fontSize={11} />
                <YAxis stroke="var(--text-3)" fontSize={11} />
                <Tooltip contentStyle={{ background: 'var(--bg-1)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }}
                         formatter={(v) => `${v.toFixed(2)} €`} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="cobrado" stackId="a" fill="#2DD4A8" name="Cobrado" />
                <Bar dataKey="pendiente" stackId="a" fill="#FBBF24" name="Pendiente" />
                <Bar dataKey="devuelto" stackId="a" fill="#F87171" name="Devuelto" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Grid de gráficas pie/donut + tabla pivot */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
          <DimensionCard title="Por actividad"      icon={Activity}  data={porActividad}    meses={meses} />
          <DimensionCard title="Por clase"          icon={Tag}       data={porClase}        meses={meses} />
          <DimensionCard title="Por forma de pago"  icon={CreditCard} data={porFormaPago}    meses={meses} />
          <DimensionCard title="Por periodicidad"   icon={TrendingUp} data={porPeriodicidad} meses={meses} />
          <DimensionCard title="Por sexo"           icon={Users}     data={porSexo}         meses={meses} />
          <DimensionCard title="Por grupo de edad"  icon={Cake}      data={porEdad}         meses={meses} sortKey />
        </div>
      </>}
    </div>
  )
}

function KPI({ label, value, color }) {
  return (
    <div style={{ padding: 12, borderRadius: 'var(--radius-sm)', background: 'var(--bg-1)', border: '1px solid var(--line)' }}>
      <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-mono)', color: color || 'var(--text-0)', marginTop: 4 }}>{value}</div>
    </div>
  )
}

function DimensionCard({ title, icon: Icon, data, meses, sortKey }) {
  const [chartType, setChartType] = useState('stacked') // stacked | lines

  const ordered = sortKey
    ? [...data].sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }))
    : data
  const top = ordered.slice(0, 8)
  const totalRango = data.reduce((s, d) => s + d._total, 0)

  // Reformatear: filas son meses, columnas son cada valor de dimensión
  // [{mes:'2026-05', 'Cuota X': 123, 'Cuota Y': 45, ...}]
  const chartData = useMemo(() => {
    return meses.map(m => {
      const row = { mes: m }
      for (const d of top) row[d.key] = d[m] || 0
      return row
    })
  }, [top, meses])

  return (
    <Card style={{ padding: 16 }}>
      <SectionTitle action={
        data.length > 1 && (
          <div style={{ display: 'flex', gap: 2, background: 'var(--bg-3)', padding: 2, borderRadius: 8 }}>
            <button onClick={() => setChartType('stacked')} style={chartTypeBtn(chartType === 'stacked')}>Apiladas</button>
            <button onClick={() => setChartType('lines')} style={chartTypeBtn(chartType === 'lines')}>Líneas</button>
          </div>
        )
      }>{Icon && <Icon size={13} style={{ marginRight: 6 }} />} {title}</SectionTitle>

      {data.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--text-3)', fontStyle: 'italic', marginTop: 12 }}>Sin datos</p>
      ) : (
        <>
          <div style={{ width: '100%', height: 240, marginTop: 12 }}>
            <ResponsiveContainer>
              {chartType === 'stacked' ? (
                <BarChart data={chartData} margin={{ top: 5, right: 8, left: -10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                  <XAxis dataKey="mes" stroke="var(--text-3)" fontSize={11}
                         tickFormatter={m => m.slice(2)} />
                  <YAxis stroke="var(--text-3)" fontSize={11} />
                  <Tooltip
                    contentStyle={{ background: 'var(--bg-1)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 11 }}
                    formatter={v => `${v.toFixed(2)} €`} />
                  <Legend wrapperStyle={{ fontSize: 11 }} iconSize={8} />
                  {top.map((d, i) => (
                    <Bar key={d.key} dataKey={d.key} stackId="a" fill={COLORS[i % COLORS.length]} />
                  ))}
                </BarChart>
              ) : (
                <LineChart data={chartData} margin={{ top: 5, right: 8, left: -10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                  <XAxis dataKey="mes" stroke="var(--text-3)" fontSize={11}
                         tickFormatter={m => m.slice(2)} />
                  <YAxis stroke="var(--text-3)" fontSize={11} />
                  <Tooltip
                    contentStyle={{ background: 'var(--bg-1)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 11 }}
                    formatter={v => `${v.toFixed(2)} €`} />
                  <Legend wrapperStyle={{ fontSize: 11 }} iconSize={8} />
                  {top.map((d, i) => (
                    <Line key={d.key} type="monotone" dataKey={d.key}
                          stroke={COLORS[i % COLORS.length]} strokeWidth={2}
                          dot={{ r: 3 }} activeDot={{ r: 5 }} />
                  ))}
                </LineChart>
              )}
            </ResponsiveContainer>
          </div>

          {/* Tabla pivot por mes */}
          <div style={{ marginTop: 12 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line)', textAlign: 'left' }}>
                  <th style={ths}>&nbsp;</th>
                  {meses.map(m => <th key={m} style={{ ...ths, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{m.slice(2)}</th>)}
                  <th style={{ ...ths, textAlign: 'right' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {ordered.map((d, i) => {
                  const ci = top.findIndex(t => t.key === d.key)
                  const color = ci >= 0 ? COLORS[ci % COLORS.length] : 'var(--text-3)'
                  const pct = totalRango > 0 ? (d._total / totalRango) * 100 : 0
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid var(--line)' }}>
                      <td style={{ padding: '6px 4px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
                          <span style={{ fontWeight: 500, color: 'var(--text-1)' }} title={d.key}>{d.key}</span>
                          <span style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                            {pct.toFixed(0)}%
                          </span>
                        </div>
                      </td>
                      {meses.map(m => (
                        <td key={m} style={{ padding: '6px 4px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: d[m] ? 'var(--text-2)' : 'var(--text-3)' }}>
                          {d[m] ? d[m].toFixed(0) : '—'}
                        </td>
                      ))}
                      <td style={{ padding: '6px 4px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-0)' }}>
                        {d._total.toFixed(0)} €
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  )
}

function chartTypeBtn(active) {
  return {
    padding: '4px 10px', borderRadius: 6, border: 'none',
    background: active ? 'var(--bg-1)' : 'transparent',
    color: active ? 'var(--text-0)' : 'var(--text-3)',
    fontSize: 11, fontWeight: 600, cursor: 'pointer',
  }
}

const ths = { padding: '4px', fontSize: 10, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }
