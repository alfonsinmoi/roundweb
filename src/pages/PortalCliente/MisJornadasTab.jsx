import { useState, useEffect, useCallback } from 'react'
import {
  BarChart3, Calendar, CalendarDays, CalendarRange, Clock, Loader2,
  ChevronDown, ChevronRight,
} from 'lucide-react'
import { usePortalAuth } from '../../contexts/PortalAuthContext'
import { miResumen, miHorario } from '../../utils/clienteApi'


const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

export default function MisJornadasTab() {
  const { token } = usePortalAuth()
  const [ano, setAno] = useState(() => new Date().getFullYear())
  const [data, setData] = useState(null)
  const [horario, setHorario] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [view, setView] = useState('mensual')   // anual | mensual | semanal | diario

  const reload = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [d, h] = await Promise.all([
        miResumen(token, ano),
        miHorario(token).catch(() => null),
      ])
      setData(d)
      setHorario(h)
    }
    catch (e) {
      setError(traduce(e))
      setData(null)
    }
    finally { setLoading(false) }
  }, [token, ano])

  useEffect(() => { reload() }, [reload])

  // Pre-calcula minutos teóricos por día ISO (1..7) en función del horario.
  // Cacheado durante el render para no recomputar 365 veces.
  const minTeoricosPorDow = horario ? calcularTeoricosPorDow(horario) : null

  // Año actual y mes/semana actual para destacar
  const today = new Date()
  const curMonth = today.getMonth() + 1
  const curIsoWeek = getISOWeek(today)
  const curIsoYear = getISOYear(today)
  const isCurrentYear = ano === today.getFullYear()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 8 }}>
      {/* ── Cabecera ───────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <h1 style={{
          margin: 0, fontFamily: 'var(--font-display, Outfit)',
          fontSize: 22, fontWeight: 700, color: 'var(--text-0)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <BarChart3 size={22} style={{ color: 'var(--green)' }} />
          Mis jornadas
        </h1>
        <select value={ano} onChange={e => setAno(Number(e.target.value))}
                style={{
                  padding: '8px 12px', borderRadius: 10,
                  border: '1px solid var(--line)', background: 'var(--bg-1)',
                  color: 'var(--text-0)', fontSize: 13, cursor: 'pointer',
                }}>
          {Array.from({ length: 5 }, (_, i) => today.getFullYear() - i).map(y => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>

      {error && <Banner kind="error">{error}</Banner>}

      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}>
          <Loader2 size={26} className="animate-spin" style={{ color: 'var(--green)' }} />
        </div>
      )}

      {!loading && data && (
        <>
          {/* ── KPIs ─────────────────────────────────────────────── */}
          <div style={{
            display: 'grid', gap: 10,
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          }}>
            <Kpi label={`Total ${ano}`} value={fmtDur(data.anual.trabajo_seg)}
                 sub={`${data.anual.dias_trabajados} días`} color="green" />
            {isCurrentYear && (
              <>
                <Kpi label={`${MESES[curMonth - 1]} (mes actual)`}
                     value={fmtDur(data.mensual[curMonth - 1]?.trabajo_seg || 0)}
                     sub={`${data.mensual[curMonth - 1]?.dias_trabajados || 0} días`} />
                <Kpi label={`Semana ${curIsoWeek}`}
                     value={fmtDur(data.semanal.find(s => s.iso_year === curIsoYear && s.iso_week === curIsoWeek)?.trabajo_seg || 0)}
                     sub="esta semana" />
              </>
            )}
            <Kpi label="Pausas totales" value={fmtDur(data.anual.pausa_seg)}
                 sub={`${ano}`} color="amber" />
          </div>

          {/* ── Tabs vista ──────────────────────────────────────── */}
          <div role="tablist" style={{
            display: 'flex', gap: 6, padding: 4,
            background: 'var(--bg-1)', border: '1px solid var(--line)',
            borderRadius: 12,
          }}>
            <SubTab active={view === 'mensual'}  onClick={() => setView('mensual')}><CalendarRange size={14} /> Mes</SubTab>
            <SubTab active={view === 'semanal'}  onClick={() => setView('semanal')}><CalendarDays size={14} /> Semana</SubTab>
            <SubTab active={view === 'diario'}   onClick={() => setView('diario')}><Calendar size={14} /> Día</SubTab>
            <SubTab active={view === 'anual'}    onClick={() => setView('anual')}><Clock size={14} /> Anual</SubTab>
          </div>

          {view === 'anual'    && <AnualView data={data} mtd={minTeoricosPorDow} />}
          {view === 'mensual'  && <MensualView data={data} mtd={minTeoricosPorDow}
                                               currentMonth={isCurrentYear ? curMonth : null} />}
          {view === 'semanal'  && <SemanalView data={data} mtd={minTeoricosPorDow}
                                               highlight={isCurrentYear ? { iso_year: curIsoYear, iso_week: curIsoWeek } : null} />}
          {view === 'diario'   && <DiarioView data={data} mtd={minTeoricosPorDow} />}
        </>
      )}
    </div>
  )
}


// ═══════════════════════════════════════════════════════════════════════════
// Vistas
// ═══════════════════════════════════════════════════════════════════════════

function AnualView({ data, mtd }) {
  const [open, setOpen] = useState(true)
  const maxSeg = Math.max(1, ...data.mensual.map(m => m.trabajo_seg))
  const teoricoAno = mtd ? minutosTeoricosAno(data.ano, mtd) * 60 : null  // en segundos
  return (
    <Card noPad>
      <button onClick={() => setOpen(o => !o)} style={rowBtnStyle(open)}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <strong style={{ fontSize: 16, color: 'var(--text-0)' }}>Año {data.ano}</strong>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
            {data.anual.dias_trabajados} {data.anual.dias_trabajados === 1 ? 'día' : 'días'}
          </span>
          <RealVsTeorico realSeg={data.anual.trabajo_seg} teoricoSeg={teoricoAno} big />
        </span>
      </button>
      {open && (
        <div style={{ borderTop: '1px solid var(--line)' }}>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--bg-2)' }}>
                <Th></Th><Th>Mes</Th><Th>Real / Teórico</Th><Th right>%</Th><Th right>Días</Th>
                <Th style={{ minWidth: 100 }}></Th>
              </tr>
            </thead>
            <tbody>
              {data.mensual.filter(m => m.trabajo_seg > 0 || (mtd && minutosTeoricosMes(data.ano, m.mes, mtd) > 0)).map(m => (
                <ExpandableMonth key={m.mes} m={m} maxSeg={maxSeg} mtd={mtd} ano={data.ano}
                                  diasMes={data.diario.filter(d => Number(d.fecha.slice(5, 7)) === m.mes)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}


function MensualView({ data, mtd, currentMonth }) {
  const maxSeg = Math.max(1, ...data.mensual.map(m => m.trabajo_seg))
  return (
    <Card noPad>
      <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'var(--bg-2)' }}>
            <Th></Th><Th>Mes</Th><Th>Real / Teórico</Th><Th right>%</Th><Th right>Días</Th>
            <Th style={{ minWidth: 100 }}></Th>
          </tr>
        </thead>
        <tbody>
          {data.mensual.map(m => (
            <ExpandableMonth key={m.mes} m={m} maxSeg={maxSeg} mtd={mtd} ano={data.ano}
                              isCurrent={currentMonth === m.mes}
                              diasMes={data.diario.filter(d => Number(d.fecha.slice(5, 7)) === m.mes)} />
          ))}
        </tbody>
      </table>
    </Card>
  )
}


function ExpandableMonth({ m, maxSeg, isCurrent, diasMes, mtd, ano }) {
  const [open, setOpen] = useState(false)
  const teoricoSeg = mtd ? minutosTeoricosMes(ano, m.mes, mtd) * 60 : null
  const canOpen = m.trabajo_seg > 0 || (diasMes && diasMes.length > 0)
  const pct = teoricoSeg && teoricoSeg > 0 ? Math.round((m.trabajo_seg / teoricoSeg) * 100) : null
  return (
    <>
      <tr onClick={() => canOpen && setOpen(o => !o)}
          style={{
            borderTop: '1px solid var(--line)',
            background: isCurrent ? 'rgba(16,185,129,0.06)' : undefined,
            cursor: canOpen ? 'pointer' : 'default',
          }}>
        <Td>
          <span style={{ color: 'var(--text-3)', visibility: canOpen ? 'visible' : 'hidden' }}>
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
        </Td>
        <Td>
          <span style={{ fontWeight: isCurrent ? 700 : 500 }}>{MESES[m.mes - 1]}</span>
          {isCurrent && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--green)' }}>actual</span>}
        </Td>
        <Td><RealVsTeorico realSeg={m.trabajo_seg} teoricoSeg={teoricoSeg} /></Td>
        <Td right><PctBadge pct={pct} /></Td>
        <Td right>{m.dias_trabajados}</Td>
        <Td><Bar value={m.trabajo_seg} max={Math.max(maxSeg, teoricoSeg || 0)} /></Td>
      </tr>
      {open && diasMes && diasMes.length > 0 && (
        <tr>
          <td colSpan={6} style={{ padding: 0, background: 'var(--bg-2)' }}>
            <DiasSubTable dias={diasMes} mtd={mtd} />
          </td>
        </tr>
      )}
    </>
  )
}


function SemanalView({ data, mtd, highlight }) {
  if (data.semanal.length === 0) {
    return <Empty>Sin jornadas en {data.ano}.</Empty>
  }
  const maxSeg = Math.max(1, ...data.semanal.map(s => s.trabajo_seg))
  return (
    <Card noPad>
      <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'var(--bg-2)' }}>
            <Th></Th><Th>Semana</Th><Th>Desde lunes</Th><Th>Real / Teórico</Th>
            <Th right>%</Th><Th right>Días</Th><Th style={{ minWidth: 100 }}></Th>
          </tr>
        </thead>
        <tbody>
          {data.semanal.map(s => {
            const isCur = highlight && s.iso_year === highlight.iso_year && s.iso_week === highlight.iso_week
            const lunes = s.fecha_lunes
            const domingo = addDays(lunes, 6)
            const dias = data.diario.filter(d => d.fecha >= lunes && d.fecha <= domingo)
            return (
              <ExpandableWeek key={`${s.iso_year}-${s.iso_week}`}
                              s={s} maxSeg={maxSeg} isCur={isCur} dias={dias} mtd={mtd} />
            )
          })}
        </tbody>
      </table>
    </Card>
  )
}


function ExpandableWeek({ s, maxSeg, isCur, dias, mtd }) {
  const [open, setOpen] = useState(false)
  const teoricoSeg = mtd ? minutosTeoricosSemana(s.fecha_lunes, mtd) * 60 : null
  const canOpen = dias.length > 0
  const pct = teoricoSeg && teoricoSeg > 0 ? Math.round((s.trabajo_seg / teoricoSeg) * 100) : null
  return (
    <>
      <tr onClick={() => canOpen && setOpen(o => !o)}
          style={{
            borderTop: '1px solid var(--line)',
            background: isCur ? 'rgba(16,185,129,0.06)' : undefined,
            cursor: canOpen ? 'pointer' : 'default',
          }}>
        <Td>
          <span style={{ color: 'var(--text-3)', visibility: canOpen ? 'visible' : 'hidden' }}>
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
        </Td>
        <Td>
          <span style={{ fontWeight: isCur ? 700 : 500 }}>S{s.iso_week}</span>
          {isCur && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--green)' }}>actual</span>}
        </Td>
        <Td>{fmtDate(s.fecha_lunes)}</Td>
        <Td><RealVsTeorico realSeg={s.trabajo_seg} teoricoSeg={teoricoSeg} /></Td>
        <Td right><PctBadge pct={pct} /></Td>
        <Td right>{s.dias_trabajados}</Td>
        <Td><Bar value={s.trabajo_seg} max={Math.max(maxSeg, teoricoSeg || 0)} /></Td>
      </tr>
      {open && dias.length > 0 && (
        <tr>
          <td colSpan={7} style={{ padding: 0, background: 'var(--bg-2)' }}>
            <DiasSubTable dias={dias} mtd={mtd} />
          </td>
        </tr>
      )}
    </>
  )
}


function DiasSubTable({ dias, mtd }) {
  return (
    <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
      <tbody>
        {dias.slice().reverse().map(d => {
          const teoMin = mtd ? minutosTeoricosDia(d.fecha, mtd) : null
          const teoSeg = teoMin != null ? teoMin * 60 : null
          const pct = teoSeg && teoSeg > 0 ? Math.round((d.trabajo_seg / teoSeg) * 100) : null
          return (
            <tr key={d.fecha} style={{ borderTop: '1px solid var(--line)' }}>
              <td style={{ padding: '8px 14px 8px 36px', color: 'var(--text-2)', width: '32%' }}>
                <span style={{ fontFamily: 'var(--font-mono)' }}>{fmtDate(d.fecha)}</span>
              </td>
              <td style={{ padding: '8px 14px', color: 'var(--text-1)' }}>
                <RealVsTeorico realSeg={d.trabajo_seg} teoricoSeg={teoSeg} />
                {d.pausa_seg > 0 && (
                  <span style={{ marginLeft: 8, color: 'var(--text-3)', fontSize: 11 }}>
                    · pausa {fmtDur(d.pausa_seg)}
                  </span>
                )}
              </td>
              <td style={{ padding: '8px 14px', textAlign: 'right', width: 60 }}>
                <PctBadge pct={pct} />
              </td>
              <td style={{ padding: '8px 14px', textAlign: 'right', color: 'var(--text-3)', fontSize: 11, width: 80 }}>
                {d.n_eventos} eventos
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}


// ── Compara real vs teórico inline ────────────────────────────────────────
function RealVsTeorico({ realSeg, teoricoSeg, big }) {
  const real = fmtDur(realSeg)
  if (teoricoSeg == null) {
    return <span style={{ fontWeight: big ? 700 : 600, fontSize: big ? 18 : 13, color: 'var(--green)' }}>{real}</span>
  }
  return (
    <span style={{ fontWeight: big ? 700 : 600, fontSize: big ? 18 : 13 }}>
      <span style={{ color: 'var(--text-0)' }}>{real}</span>
      <span style={{ color: 'var(--text-3)', fontWeight: 500, fontSize: big ? 13 : 11 }}>
        {' / '}{fmtDur(teoricoSeg)}
      </span>
    </span>
  )
}


function PctBadge({ pct }) {
  if (pct == null) return <span style={{ color: 'var(--text-3)', fontSize: 11 }}>—</span>
  const color = pct >= 100 ? 'var(--green, #10b981)'
              : pct >= 80  ? '#f59e0b'
              : 'var(--red, #f87171)'
  const bg    = pct >= 100 ? 'rgba(16,185,129,0.10)'
              : pct >= 80  ? 'rgba(245,158,11,0.10)'
              : 'rgba(248,113,133,0.10)'
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 999,
      background: bg, color, fontSize: 11, fontWeight: 700,
      fontFamily: 'var(--font-mono)',
    }}>
      {pct}%
    </span>
  )
}


function rowBtnStyle(open) {
  return {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    width: '100%', padding: '14px 16px',
    background: open ? 'var(--bg-2)' : 'transparent',
    border: 'none', cursor: 'pointer', textAlign: 'left',
    color: 'var(--text-1)', fontSize: 14,
  }
}


function addDays(isoYmd, days) {
  const d = new Date(isoYmd + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}


function DiarioView({ data, mtd }) {
  if (data.diario.length === 0) {
    return <Empty>Sin jornadas en {data.ano}.</Empty>
  }
  const byMonth = {}
  data.diario.forEach(d => {
    const m = Number(d.fecha.slice(5, 7))
    if (!byMonth[m]) byMonth[m] = []
    byMonth[m].push(d)
  })
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {Object.keys(byMonth).sort((a, b) => Number(b) - Number(a)).map(m => (
        <Card key={m} noPad>
          <div style={{
            padding: '10px 14px', background: 'var(--bg-2)',
            borderBottom: '1px solid var(--line)',
            fontSize: 12, fontWeight: 600, color: 'var(--text-2)',
            textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            {MESES[Number(m) - 1]} {data.ano}
          </div>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <tbody>
              {byMonth[m].slice().reverse().map(d => {
                const teoMin = mtd ? minutosTeoricosDia(d.fecha, mtd) : null
                const teoSeg = teoMin != null ? teoMin * 60 : null
                const pct = teoSeg && teoSeg > 0 ? Math.round((d.trabajo_seg / teoSeg) * 100) : null
                return (
                  <tr key={d.fecha} style={{ borderTop: '1px solid var(--line)' }}>
                    <Td><span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{fmtDate(d.fecha)}</span></Td>
                    <Td>
                      <RealVsTeorico realSeg={d.trabajo_seg} teoricoSeg={teoSeg} />
                      {d.pausa_seg > 0 && (
                        <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--text-3)' }}>
                          · pausa {fmtDur(d.pausa_seg)}
                        </span>
                      )}
                    </Td>
                    <Td right><PctBadge pct={pct} /></Td>
                    <Td right>
                      <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                        {d.n_eventos} eventos
                      </span>
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      ))}
    </div>
  )
}


// ═══════════════════════════════════════════════════════════════════════════
// Helpers UI
// ═══════════════════════════════════════════════════════════════════════════

function Kpi({ label, value, sub, color = 'gray' }) {
  const fg = color === 'green' ? 'var(--green, #10b981)' :
             color === 'amber' ? '#f59e0b' : 'var(--text-0)'
  return (
    <div style={{
      padding: '14px 16px', borderRadius: 14,
      background: 'var(--bg-1)', border: '1px solid var(--line)',
    }}>
      <p style={{ margin: 0, fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
        {label}
      </p>
      <p style={{ margin: '6px 0 2px', fontSize: 22, fontWeight: 700, color: fg, fontFamily: 'var(--font-display, Outfit)' }}>
        {value}
      </p>
      <p style={{ margin: 0, fontSize: 11, color: 'var(--text-3)' }}>{sub}</p>
    </div>
  )
}

function Card({ children, noPad }) {
  return (
    <div style={{
      borderRadius: 14, background: 'var(--bg-1)',
      border: '1px solid var(--line)',
      overflow: 'hidden',
      padding: noPad ? 0 : 14,
    }}>
      {children}
    </div>
  )
}

function Th({ children, right, style = {} }) {
  return (
    <th style={{
      textAlign: right ? 'right' : 'left',
      padding: '10px 14px',
      fontSize: 11, fontWeight: 600,
      color: 'var(--text-3)',
      textTransform: 'uppercase', letterSpacing: '0.05em',
      ...style,
    }}>{children}</th>
  )
}

function Td({ children, right }) {
  return (
    <td style={{
      padding: '10px 14px',
      textAlign: right ? 'right' : 'left',
      color: 'var(--text-1)',
    }}>{children}</td>
  )
}

function Bar({ value, max }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <div style={{
      height: 6, background: 'var(--bg-3)',
      borderRadius: 999, overflow: 'hidden',
      minWidth: 60,
    }}>
      <div style={{
        height: '100%', width: `${pct}%`,
        background: 'var(--green, #10b981)',
        transition: 'width 0.3s',
      }} />
    </div>
  )
}

function SubTab({ active, children, ...rest }) {
  return (
    <button {...rest} role="tab" aria-selected={active}
            style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: 6, padding: '8px 6px',
              borderRadius: 8, border: 'none',
              background: active ? 'var(--green-bg, rgba(16,185,129,0.10))' : 'transparent',
              color: active ? 'var(--green, #10b981)' : 'var(--text-2)',
              fontSize: 12, fontWeight: active ? 700 : 500,
              cursor: 'pointer',
            }}>
      {children}
    </button>
  )
}

function Empty({ children }) {
  return (
    <div style={{
      padding: '32px 20px', textAlign: 'center',
      color: 'var(--text-3)', fontSize: 13,
      background: 'var(--bg-1)', border: '1px dashed var(--line)', borderRadius: 14,
    }}>
      {children}
    </div>
  )
}

function Banner({ kind, children }) {
  const bg = kind === 'error' ? 'rgba(248,113,133,0.10)' : 'rgba(59,130,246,0.10)'
  const fg = kind === 'error' ? 'var(--red, #f87171)' : '#60a5fa'
  return (
    <div role="alert" style={{
      padding: '10px 14px', borderRadius: 10,
      background: bg, color: fg, fontSize: 13,
    }}>{children}</div>
  )
}


function fmtDur(s) {
  s = Math.max(0, Math.floor(s || 0))
  if (s === 0)    return '—'
  if (s < 60)     return `${s}s`
  if (s < 3600)   return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
}

function fmtDate(iso) {
  if (!iso) return ''
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString('es-ES', { weekday: 'short', day: '2-digit', month: 'short' })
  } catch { return iso }
}

// ISO 8601 week number (lunes = primer día)
function getISOWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7)
}
function getISOYear(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7))
  return date.getUTCFullYear()
}

// ── Helpers teóricos vs reales ─────────────────────────────────────────────

// Devuelve un map {1: minutos, 2: minutos, ..., 7: minutos} con los minutos
// teóricos de TRABAJO por día de la semana ISO (1=Lun, 7=Dom).
function calcularTeoricosPorDow(horario) {
  const out = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 }
  for (let d = 1; d <= 7; d++) {
    const franjas = horario[String(d)] || []
    for (const f of franjas) {
      if (f.tipo !== 'trabajo') continue
      out[d] += hhmmToMin(f.hora_fin) - hhmmToMin(f.hora_inicio)
    }
  }
  return out
}

function hhmmToMin(s) {
  if (!s) return 0
  const [h, m] = s.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

// Minutos teóricos de un día concreto (YYYY-MM-DD)
function minutosTeoricosDia(isoYmd, mtd) {
  if (!mtd) return 0
  const d = new Date(isoYmd + 'T00:00:00')
  const dow = d.getDay() === 0 ? 7 : d.getDay()
  return mtd[dow] || 0
}

// Minutos teóricos de un mes natural (ano, mes 1..12)
function minutosTeoricosMes(ano, mes, mtd) {
  if (!mtd) return 0
  const ultimoDia = new Date(ano, mes, 0).getDate()
  let total = 0
  for (let day = 1; day <= ultimoDia; day++) {
    const d = new Date(ano, mes - 1, day)
    const dow = d.getDay() === 0 ? 7 : d.getDay()
    total += mtd[dow] || 0
  }
  return total
}

// Minutos teóricos de una semana ISO a partir de la fecha del lunes
function minutosTeoricosSemana(isoLunesYmd, mtd) {
  if (!mtd) return 0
  let total = 0
  const lun = new Date(isoLunesYmd + 'T00:00:00')
  for (let i = 0; i < 7; i++) {
    const d = new Date(lun); d.setDate(d.getDate() + i)
    const dow = d.getDay() === 0 ? 7 : d.getDay()
    total += mtd[dow] || 0
  }
  return total
}

// Minutos teóricos de un año natural
function minutosTeoricosAno(ano, mtd) {
  if (!mtd) return 0
  let total = 0
  for (let m = 1; m <= 12; m++) total += minutosTeoricosMes(ano, m, mtd)
  return total
}


function traduce(e) {
  const code = typeof e === 'string' ? e : (e?.body?.error || e?.message || '')
  const map = {
    no_eres_trabajador:   'Tu cuenta no es de trabajador en este centro.',
    feature_not_enabled:  'El módulo de control horario no está activo.',
    invalid_token:        'Tu sesión ha caducado. Vuelve a entrar.',
    missing_token:        'Tu sesión ha caducado. Vuelve a entrar.',
  }
  return map[code] || code || 'Error desconocido'
}
