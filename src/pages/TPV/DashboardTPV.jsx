// Dashboard de ventas TPV (Fase 9, mayo 2026).
//
// KPIs principales + gráfica de ventas por día + top productos + top clientes.
// Filtros: rango fechas + centro (solo manager bare).
//
// Default: últimos 30 días, todos los centros del manager.
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
import {
  BarChart3, Loader2, TrendingUp, TrendingDown, ShoppingCart, Tag,
  Users, Package, Receipt, AlertCircle,
} from 'lucide-react'
import { Card, SectionTitle } from '../../components/UI'
import { useToast } from '../../components/Toast'
import { useAuth } from '../../contexts/AuthContext'
import { useCan } from '../../hooks/useCan'
import { getRoundIdentity, centrosList } from '../../utils/configApi'
import { posDashboard } from '../../utils/posApi'


const METODOS_LABEL = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  bizum: 'Bizum',
  transferencia: 'Transferencia',
  link_pago: 'Link pago',
  recibo_mensual: 'Recibo mensual',
}
const METODO_COLOR = {
  efectivo: '#10b981',
  tarjeta: '#3b82f6',
  bizum: '#8b5cf6',
  transferencia: '#f59e0b',
  link_pago: '#06b6d4',
  recibo_mensual: '#ef4444',
}


export default function DashboardTPV() {
  const { user } = useAuth()
  const toast = useToast()
  const identity = useMemo(() => getRoundIdentity(user), [user])
  const managerBare = !identity?.trainerId
  const canVer = useCan('tpv.dashboard.ver')

  if (!canVer) {
    return (
      <div style={{ padding: 30, maxWidth: 600, margin: '40px auto',
                     textAlign: 'center', color: 'var(--text-3)' }}>
        <BarChart3 size={40} style={{ opacity: 0.4 }} />
        <h3 style={{ marginTop: 12, color: 'var(--text-1)' }}>
          Acceso restringido
        </h3>
        <p style={{ fontSize: 13 }}>
          Tu perfil no tiene permiso <code>tpv.dashboard.ver</code>.
          Solicítalo al administrador.
        </p>
      </div>
    )
  }

  // Defaults: últimos 30 días
  const today = new Date().toISOString().slice(0, 10)
  const monthAgo = new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10)
  const [desde, setDesde] = useState(monthAgo)
  const [hasta, setHasta] = useState(today)
  const [centros, setCentros] = useState([])
  const [idTrainer, setIdTrainer] = useState('')   // '' = todos los centros
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  // Cargar centros (solo manager bare)
  useEffect(() => {
    if (!managerBare) return
    centrosList(identity).then(cs => {
      setCentros([...cs].sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '')))
    }).catch(() => {})
  // eslint-disable-next-line
  }, [managerBare])

  // Sprint 5 #4 — anti race fetch dashboard: solo la última request gana.
  // Si el usuario cambia desde/hasta/centro rápido, ignoramos respuestas
  // de queries anteriores (sin AbortController para no tener que
  // modificar la firma de posDashboard).
  const reqIdRef = useMemo(() => ({ current: 0 }), [])
  const reload = useCallback(async () => {
    const myId = ++reqIdRef.current
    setLoading(true)
    try {
      const r = await posDashboard(identity, {
        desde, hasta,
        id_trainer: managerBare ? (idTrainer || undefined) : undefined,
      })
      if (myId === reqIdRef.current) setData(r)
    } catch (e) {
      if (myId === reqIdRef.current) toast.error(`Error: ${e.message}`)
    } finally {
      if (myId === reqIdRef.current) setLoading(false)
    }
  }, [identity, desde, hasta, idTrainer, managerBare, toast, reqIdRef])
  useEffect(() => { reload() }, [reload])

  const k = data?.kpis
  const variacion = k?.variacion_pct
  const variacionIcon = variacion === null || variacion === undefined ? null
                      : variacion >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />
  const variacionColor = variacion === null || variacion === undefined ? 'var(--text-3)'
                       : variacion >= 0 ? 'var(--green)' : 'var(--red)'

  return (
    <div style={{ padding: 16, maxWidth: 1400, margin: '0 auto' }}>
      <SectionTitle>
        <BarChart3 size={20} style={{ marginRight: 8, color: 'var(--green)' }} />
        Dashboard TPV
      </SectionTitle>

      {/* Filtros */}
      <Card style={{ padding: 14, marginTop: 12, marginBottom: 16,
                     display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <label style={lbl}>Desde</label>
          <input type="date" value={desde} max={hasta}
                 onChange={e => setDesde(e.target.value)} style={inp} />
        </div>
        <div>
          <label style={lbl}>Hasta</label>
          <input type="date" value={hasta} min={desde} max={today}
                 onChange={e => setHasta(e.target.value)} style={inp} />
        </div>
        {managerBare && centros.length > 0 && (
          <div>
            <label style={lbl}>Centro</label>
            <select value={idTrainer} onChange={e => setIdTrainer(e.target.value)}
                    style={{ ...inp, minWidth: 200 }}>
              <option value="">— Todos los centros —</option>
              {centros.map(c =>
                <option key={c.id_trainer} value={c.id_trainer}>
                  {c.nombre || `Centro ${c.id_trainer}`}
                </option>
              )}
            </select>
          </div>
        )}
        {/* Atajos rápidos */}
        <div style={{ flex: 1 }} />
        {[['Hoy', 0], ['7d', 7], ['30d', 30], ['90d', 90]].map(([lbl, dias]) => (
          <button key={lbl} onClick={() => {
            setHasta(today)
            setDesde(new Date(Date.now() - dias * 86400 * 1000)
              .toISOString().slice(0, 10))
          }} style={chipBtn}>{lbl}</button>
        ))}
      </Card>

      {loading || !data ? (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <Loader2 size={28} className="animate-spin" style={{ color: 'var(--green)' }} />
        </div>
      ) : (
        <>
          {/* KPI cards */}
          <div style={{ display: 'grid',
                         gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                         gap: 12, marginBottom: 16 }}>
            <Kpi icon={Receipt} color="var(--green)" label="Total periodo"
                 v={`${k.total_periodo.toFixed(2)} €`}
                 sub={variacion !== null && variacion !== undefined && (
                   <span style={{ color: variacionColor,
                                   display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                     {variacionIcon} {variacion.toFixed(1)}% vs anterior
                   </span>
                 )} />
            <Kpi icon={ShoppingCart} color="#3b82f6" label="Nº ventas" v={k.num_ventas} />
            <Kpi icon={Tag} color="#8b5cf6" label="Ticket medio"
                 v={`${k.ticket_medio.toFixed(2)} €`} />
            <Kpi icon={AlertCircle} color="var(--red)" label="Anuladas"
                 v={k.num_anuladas}
                 sub={k.total_anulado > 0 && `${k.total_anulado.toFixed(2)} € en valor`} />
          </div>

          {/* Por método de pago */}
          <Card style={{ padding: 16, marginBottom: 16 }}>
            <strong style={{ fontSize: 13, color: 'var(--text-1)' }}>Por método de pago</strong>
            <div style={{ marginTop: 10 }}>
              {data.por_metodo.length === 0 ? (
                <div style={{ color: 'var(--text-3)', fontSize: 12 }}>Sin datos</div>
              ) : data.por_metodo.map(m => {
                const pct = k.total_periodo > 0 ? (m.total / k.total_periodo) * 100 : 0
                const color = METODO_COLOR[m.metodo] || 'var(--text-3)'
                return (
                  <div key={m.metodo} style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between',
                                  fontSize: 12, marginBottom: 4 }}>
                      <span>
                        <span style={{ display: 'inline-block', width: 10, height: 10,
                                        borderRadius: 2, background: color,
                                        marginRight: 6, verticalAlign: 'middle' }} />
                        {METODOS_LABEL[m.metodo] || m.metodo}
                        <span style={{ color: 'var(--text-3)', marginLeft: 6 }}>
                          ({m.n})
                        </span>
                      </span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                        {m.total.toFixed(2)} € · {pct.toFixed(1)}%
                      </span>
                    </div>
                    <div style={{ height: 6, background: 'var(--bg-2)',
                                   borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%',
                                     background: color }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </Card>

          {/* Gráfica ventas por día */}
          <Card style={{ padding: 16, marginBottom: 16 }}>
            <strong style={{ fontSize: 13, color: 'var(--text-1)' }}>
              Ventas por día
            </strong>
            {data.serie_dia.length === 0 ? (
              <div style={{ color: 'var(--text-3)', padding: 20, textAlign: 'center' }}>
                Sin ventas en el periodo
              </div>
            ) : (
              <div style={{ height: 280, marginTop: 12 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.serie_dia}
                            margin={{ top: 8, right: 20, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                    <XAxis dataKey="fecha" stroke="var(--text-3)" fontSize={11}
                           tickFormatter={f => f.slice(5)} />
                    <YAxis stroke="var(--text-3)" fontSize={11}
                           tickFormatter={v => `${v.toFixed(0)}€`} />
                    <Tooltip contentStyle={{ background: 'var(--bg-1)',
                                              border: '1px solid var(--line)',
                                              fontSize: 12 }}
                             formatter={(v, n) => n === 'total'
                               ? [`${Number(v).toFixed(2)} €`, 'Total']
                               : [v, 'Ventas']} />
                    <Bar dataKey="total" fill="var(--green)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          {/* Top productos + Top clientes en 2 columnas */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16,
                         marginBottom: 16 }}>
            <Card style={{ padding: 16 }}>
              <strong style={{ fontSize: 13, display: 'flex',
                                alignItems: 'center', gap: 6 }}>
                <Package size={14} /> Top productos
              </strong>
              {data.top_productos.length === 0 ? (
                <div style={{ color: 'var(--text-3)', padding: 14, fontSize: 12 }}>
                  Sin datos
                </div>
              ) : (
                <table style={{ width: '100%', marginTop: 10, fontSize: 12 }}>
                  <thead><tr style={{ color: 'var(--text-3)' }}>
                    <th align="left">Producto</th>
                    <th align="right">Uds.</th>
                    <th align="right">€</th>
                  </tr></thead>
                  <tbody>
                    {data.top_productos.map((p, i) => (
                      <tr key={i} style={{ borderTop: '1px solid var(--line)' }}>
                        <td style={{ padding: '5px 4px' }}>
                          {p.codigo && <span style={{ color: 'var(--text-3)',
                                                        fontFamily: 'var(--font-mono)',
                                                        marginRight: 6 }}>{p.codigo}</span>}
                          {p.nombre}
                        </td>
                        <td style={{ padding: '5px 4px', textAlign: 'right' }}>
                          {Number(p.cantidad).toFixed(0)}
                        </td>
                        <td style={{ padding: '5px 4px', textAlign: 'right',
                                      fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                          {Number(p.importe).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            <Card style={{ padding: 16 }}>
              <strong style={{ fontSize: 13, display: 'flex',
                                alignItems: 'center', gap: 6 }}>
                <Users size={14} /> Top clientes
              </strong>
              {data.top_clientes.length === 0 ? (
                <div style={{ color: 'var(--text-3)', padding: 14, fontSize: 12 }}>
                  No hay compras con cliente identificado
                </div>
              ) : (
                <table style={{ width: '100%', marginTop: 10, fontSize: 12 }}>
                  <thead><tr style={{ color: 'var(--text-3)' }}>
                    <th align="left">Cliente</th>
                    <th align="right">Compras</th>
                    <th align="right">€</th>
                  </tr></thead>
                  <tbody>
                    {data.top_clientes.map((c, i) => (
                      <tr key={i} style={{ borderTop: '1px solid var(--line)' }}>
                        <td style={{ padding: '5px 4px' }}>{c.cliente_nombre || '—'}</td>
                        <td style={{ padding: '5px 4px', textAlign: 'right' }}>{c.n}</td>
                        <td style={{ padding: '5px 4px', textAlign: 'right',
                                      fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                          {Number(c.total).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  )
}


function Kpi({ icon: Icon, color, label, v, sub }) {
  return (
    <Card style={{ padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6,
                     fontSize: 11, color: 'var(--text-3)' }}>
        <Icon size={13} style={{ color }} /> {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4, color }}>{v}</div>
      {sub && (
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
          {sub}
        </div>
      )}
    </Card>
  )
}

const lbl = {
  display: 'block', fontSize: 11, color: 'var(--text-3)', marginBottom: 3,
}
const inp = {
  padding: 7, borderRadius: 6, fontSize: 13, background: 'var(--bg-2)',
  border: '1px solid var(--line)', color: 'var(--text-0)',
}
const chipBtn = {
  padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600,
  background: 'var(--bg-2)', color: 'var(--text-1)',
  border: '1px solid var(--line)', cursor: 'pointer',
}
