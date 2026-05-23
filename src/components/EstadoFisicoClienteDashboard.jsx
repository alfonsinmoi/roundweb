// Dashboard por CLIENTE: evolución, métricas por sub-test, medallas.
// Se renderiza dentro de InformesEstadoFisicoButton.jsx cuando el cliente
// tiene ≥ 1 test. Resume el progreso visualmente y permite ir al detalle
// de cada sesión.

import { useMemo } from 'react'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  Legend, BarChart, Bar,
} from 'recharts'
import {
  Activity, Award, Calendar, TrendingUp, TrendingDown, ArrowUpRight,
  ArrowDownRight, Trophy, Dumbbell, Heart, Zap, ChevronRight, Flame,
  Sparkles, Target,
} from 'lucide-react'
import { Card, Badge } from './UI'
import { formatDate } from '../utils/formatters'

// Categoría textual desde score 0-10 (misma que EstadoFisicoModal)
function categoriaDesdeScore(s) {
  if (s >= 9) return 'Excelente'
  if (s >= 7) return 'Bueno'
  if (s >= 5) return 'Normal'
  if (s >= 3) return 'Regular'
  return 'Bajo'
}
function categoriaColor(s) {
  if (s >= 9) return 'green'
  if (s >= 7) return 'blue'
  if (s >= 5) return 'yellow'
  if (s >= 3) return 'orange'
  return 'red'
}

// Extrae las 4 métricas (Fuerza, Resistencia, Potencia, Equilibrio) de una sesión
function metricas(s) {
  const m = {
    fuerza: s.hasPushUp && s.pushUpTest?.puntuacion > 0 ? s.pushUpTest.puntuacion : 0,
    potencia: s.hasSquatJump && s.squatJumpTest?.puntuacionMejor > 0 ? s.squatJumpTest.puntuacionMejor : 0,
    equilibrio: s.hasFlamenco && s.flamencoTest?.puntuacion > 0 ? s.flamencoTest.puntuacion : 0,
  }
  const rScores = []
  if (s.hasBoxSquat && s.boxSquatTest?.puntuacion > 0) rScores.push(s.boxSquatTest.puntuacion)
  if (s.hasPlancha && s.planchaTest?.puntuacion > 0) rScores.push(s.planchaTest.puntuacion)
  m.resistencia = rScores.length > 0 ? rScores.reduce((a, b) => a + b, 0) / rScores.length : 0
  return m
}

// Diferencia en días entre 2 epoch ms
const diasEntre = (a, b) => Math.floor((b - a) / (86400 * 1000))

export default function EstadoFisicoClienteDashboard({
  sessions,         // array de sessions del cliente, ya ordenadas DESC por fecha
  onVerSession,     // (session) => void — abre el modal de detalle
}) {
  // Trabajamos en orden ASC (más antiguo primero) para evolución
  const ordenadas = useMemo(
    () => [...(sessions || [])].sort((a, b) => (a.testDate || 0) - (b.testDate || 0)),
    [sessions]
  )

  if (ordenadas.length === 0) return null

  const primero = ordenadas[0]
  const ultimo  = ordenadas[ordenadas.length - 1]
  const total   = ordenadas.length

  // ── Datos para gráficos ──
  const dataEvolucion = ordenadas.map((s, idx) => {
    const m = metricas(s)
    return {
      idx: idx + 1,
      fecha: s.testDate,
      fechaLabel: formatDate(s.testDate),
      Global: parseFloat(s.puntuacion) || 0,
      Fuerza: parseFloat(m.fuerza?.toFixed(1)) || 0,
      Resistencia: parseFloat(m.resistencia?.toFixed(1)) || 0,
      Potencia: parseFloat(m.potencia?.toFixed(1)) || 0,
      Equilibrio: parseFloat(m.equilibrio?.toFixed(1)) || 0,
    }
  })

  // ── KPIs derivados ──
  const pGlobalIni = parseFloat(primero.puntuacion) || 0
  const pGlobalFin = parseFloat(ultimo.puntuacion) || 0
  const deltaGlobal = +(pGlobalFin - pGlobalIni).toFixed(2)
  const mPrimero = metricas(primero)
  const mUltimo  = metricas(ultimo)

  // Mejor marca histórica de cada métrica (puede no ser el último test)
  const peakGlobal = Math.max(...dataEvolucion.map(d => d.Global))
  const peakFuerza = Math.max(...dataEvolucion.map(d => d.Fuerza))
  const peakResistencia = Math.max(...dataEvolucion.map(d => d.Resistencia))
  const peakPotencia = Math.max(...dataEvolucion.map(d => d.Potencia))
  const peakEquilibrio = Math.max(...dataEvolucion.map(d => d.Equilibrio))

  // Días entre tests
  const intervalos = []
  for (let i = 1; i < ordenadas.length; i++) {
    intervalos.push(diasEntre(ordenadas[i-1].testDate, ordenadas[i].testDate))
  }
  const mediaDias = intervalos.length > 0
    ? Math.round(intervalos.reduce((a, b) => a + b, 0) / intervalos.length)
    : null
  const diasDesdeUltimo = diasEntre(ultimo.testDate, Date.now())

  // ── MEDALLAS — sistema de logros automático ──────────────────────────
  // Cada medalla es un objeto {id, icon, label, color, descripcion}
  const medallas = []
  // 1) "Primer test"
  if (total >= 1) {
    medallas.push({ id: 'primero', icon: Target, color: 'var(--blue)',
      label: 'Primer test completado', descripcion: formatDate(primero.testDate) })
  }
  // 2) "Constancia": 3+ tests
  if (total >= 3) {
    medallas.push({ id: 'constancia', icon: Calendar, color: 'var(--green)',
      label: `Constancia · ${total} tests`,
      descripcion: 'Hace seguimiento periódico' })
  }
  // 3) "Atleta veterano": 6+ tests
  if (total >= 6) {
    medallas.push({ id: 'veterano', icon: Trophy, color: '#FFC83D',
      label: 'Atleta veterano', descripcion: '6+ tests realizados' })
  }
  // 4) "En racha": último test mejora vs el anterior (no el primero)
  if (total >= 2) {
    const penultimo = ordenadas[ordenadas.length - 2]
    const dlt = (parseFloat(ultimo.puntuacion) || 0) - (parseFloat(penultimo.puntuacion) || 0)
    if (dlt >= 0.5) {
      medallas.push({ id: 'racha', icon: Flame, color: 'var(--rose)',
        label: 'En racha', descripcion: `+${dlt.toFixed(1)} vs test anterior` })
    }
  }
  // 5) "Gran salto": delta total ≥ +2
  if (deltaGlobal >= 2) {
    medallas.push({ id: 'salto', icon: Sparkles, color: 'var(--green)',
      label: 'Gran salto', descripcion: `+${deltaGlobal} pt desde el primer test` })
  }
  // 6) "Mejor marca": último test es récord histórico
  if (pGlobalFin > 0 && Math.abs(pGlobalFin - peakGlobal) < 0.01 && total >= 2) {
    medallas.push({ id: 'record', icon: Trophy, color: '#FFC83D',
      label: 'Récord personal', descripcion: `Mejor puntuación histórica: ${pGlobalFin.toFixed(1)}` })
  }
  // 7) "Categoría Excelente": último test ≥ 9
  if (pGlobalFin >= 9) {
    medallas.push({ id: 'excelente', icon: Award, color: 'var(--green)',
      label: 'Excelente', descripcion: `Puntuación ${pGlobalFin.toFixed(1)}/10` })
  }
  // 8) Medallas específicas por métrica si supera 8
  const dispatchMetric = [
    { key: 'fuerza', val: mUltimo.fuerza, icon: Dumbbell, label: 'Fuerza top', color: 'var(--red)' },
    { key: 'resistencia', val: mUltimo.resistencia, icon: Heart, label: 'Resistencia top', color: 'var(--rose)' },
    { key: 'potencia', val: mUltimo.potencia, icon: Zap, label: 'Potencia top', color: 'var(--amber)' },
    { key: 'equilibrio', val: mUltimo.equilibrio, icon: Activity, label: 'Equilibrio top', color: 'var(--blue)' },
  ]
  for (const dm of dispatchMetric) {
    if (dm.val >= 8) {
      medallas.push({ id: dm.key, icon: dm.icon, color: dm.color,
        label: dm.label, descripcion: `${dm.val.toFixed(1)}/10` })
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── Cabecera resumen ── */}
      <Card style={{ padding: 18,
                      background: 'rgba(45,212,168,0.05)',
                      border: '1px solid rgba(45,212,168,0.25)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 14 }}>
          <KpiStat icon={Activity} label="Tests realizados" value={total}
                    color="var(--text-0)" />
          <KpiStat icon={Calendar} label="Primer test"
                    value={formatDate(primero.testDate)} small />
          <KpiStat icon={Calendar} label="Último test"
                    value={formatDate(ultimo.testDate)}
                    sub={diasDesdeUltimo > 0 ? `hace ${diasDesdeUltimo}d` : 'hoy'} small />
          {mediaDias != null && (
            <KpiStat icon={Calendar} label="Media entre tests"
                      value={`${mediaDias}d`} small />
          )}
          {total >= 2 && (
            <KpiStat icon={deltaGlobal >= 0 ? TrendingUp : TrendingDown}
                      label="Evolución global"
                      value={`${deltaGlobal > 0 ? '+' : ''}${deltaGlobal.toFixed(1)}`}
                      sub={`${pGlobalIni.toFixed(1)} → ${pGlobalFin.toFixed(1)}`}
                      color={deltaGlobal > 0 ? 'var(--green)' :
                             deltaGlobal < 0 ? 'var(--red)' : 'var(--text-0)'} />
          )}
          <KpiStat icon={Trophy} label="Mejor marca"
                    value={peakGlobal > 0 ? peakGlobal.toFixed(1) : '—'}
                    sub="histórico"
                    color="#FFC83D" />
        </div>
      </Card>

      {/* ── Medallas ── */}
      {medallas.length > 0 && (
        <Card style={{ padding: 18 }}>
          <p style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600,
                       letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 12 }}>
            Medallas y logros
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {medallas.map(m => {
              const Icon = m.icon
              return (
                <div key={m.id}
                     title={m.descripcion}
                     style={{
                       display: 'inline-flex', alignItems: 'center', gap: 8,
                       padding: '8px 12px', borderRadius: 'var(--radius-pill)',
                       background: `color-mix(in srgb, ${m.color} 14%, var(--bg-2))`,
                       border: `1px solid color-mix(in srgb, ${m.color} 40%, transparent)`,
                       fontSize: 12, fontWeight: 600, color: 'var(--text-1)',
                     }}>
                  <Icon size={14} style={{ color: m.color }} aria-hidden="true" />
                  <span>{m.label}</span>
                  <span style={{ fontSize: 10.5, color: 'var(--text-3)', fontWeight: 400 }}>
                    · {m.descripcion}
                  </span>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {/* ── Evolución de puntuación global ── */}
      {total >= 2 && (
        <Card style={{ padding: 18 }}>
          <h3 style={{ fontFamily: 'Outfit', fontSize: 14, fontWeight: 700,
                       color: 'var(--text-0)', marginBottom: 12,
                       display: 'flex', alignItems: 'center', gap: 6 }}>
            <TrendingUp size={14} aria-hidden="true" /> Evolución puntuación global
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={dataEvolucion}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
              <XAxis dataKey="fechaLabel" stroke="var(--text-3)" fontSize={11} />
              <YAxis domain={[0, 10]} stroke="var(--text-3)" fontSize={11} />
              <Tooltip contentStyle={{ background: 'var(--bg-1)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }} />
              <Line type="monotone" dataKey="Global" stroke="#2DD4A8" strokeWidth={3}
                    dot={{ r: 5 }} activeDot={{ r: 7 }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* ── Evolución por sub-métrica ── */}
      {total >= 2 && (mUltimo.fuerza + mUltimo.resistencia + mUltimo.potencia + mUltimo.equilibrio) > 0 && (
        <Card style={{ padding: 18 }}>
          <h3 style={{ fontFamily: 'Outfit', fontSize: 14, fontWeight: 700,
                       color: 'var(--text-0)', marginBottom: 12,
                       display: 'flex', alignItems: 'center', gap: 6 }}>
            <Activity size={14} aria-hidden="true" /> Evolución por capacidad
          </h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={dataEvolucion}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
              <XAxis dataKey="fechaLabel" stroke="var(--text-3)" fontSize={11} />
              <YAxis domain={[0, 10]} stroke="var(--text-3)" fontSize={11} />
              <Tooltip contentStyle={{ background: 'var(--bg-1)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="Fuerza" stroke="#F87171" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="Resistencia" stroke="#FB7185" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="Potencia" stroke="#FBBF24" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="Equilibrio" stroke="#5B9CF6" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* ── Tabla resumen por capacidad: primer/último/mejor + delta ── */}
      {(peakFuerza + peakResistencia + peakPotencia + peakEquilibrio) > 0 && (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)',
                          fontSize: 14, fontWeight: 700, color: 'var(--text-0)',
                          display: 'flex', alignItems: 'center', gap: 6 }}>
            <Award size={14} aria-hidden="true" /> Resumen por capacidad
          </div>
          <div style={{ display: 'grid',
                          gridTemplateColumns: '1.2fr 1fr 1fr 1fr 1fr',
                          padding: '8px 18px', background: 'var(--bg-3)',
                          fontSize: 10.5, color: 'var(--text-3)',
                          textTransform: 'uppercase', letterSpacing: 0.4,
                          fontWeight: 600, gap: 8 }}>
            <span>Capacidad</span>
            <span style={{ textAlign: 'center' }}>Primer test</span>
            <span style={{ textAlign: 'center' }}>Último test</span>
            <span style={{ textAlign: 'center' }}>Mejor</span>
            <span style={{ textAlign: 'center' }}>Evolución</span>
          </div>
          {[
            { key: 'Global', icon: Award, color: '#FFC83D', ini: pGlobalIni, fin: pGlobalFin, peak: peakGlobal },
            { key: 'Fuerza', icon: Dumbbell, color: 'var(--red)', ini: mPrimero.fuerza, fin: mUltimo.fuerza, peak: peakFuerza },
            { key: 'Resistencia', icon: Heart, color: 'var(--rose)', ini: mPrimero.resistencia, fin: mUltimo.resistencia, peak: peakResistencia },
            { key: 'Potencia', icon: Zap, color: 'var(--amber)', ini: mPrimero.potencia, fin: mUltimo.potencia, peak: peakPotencia },
            { key: 'Equilibrio', icon: Activity, color: 'var(--blue)', ini: mPrimero.equilibrio, fin: mUltimo.equilibrio, peak: peakEquilibrio },
          ].map((row, i) => {
            const delta = +(row.fin - row.ini).toFixed(1)
            const Icon = row.icon
            return (
              <div key={row.key} style={{
                display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr 1fr 1fr',
                padding: '10px 18px', alignItems: 'center', fontSize: 12.5, gap: 8,
                borderTop: '1px solid var(--line)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Icon size={13} style={{ color: row.color }} aria-hidden="true" />
                  <span style={{ fontWeight: 600 }}>{row.key}</span>
                </div>
                <span style={{ textAlign: 'center', color: 'var(--text-2)',
                                 fontFamily: 'var(--font-mono)' }}>
                  {row.ini > 0 ? row.ini.toFixed(1) : '—'}
                </span>
                <span style={{ textAlign: 'center', color: 'var(--text-0)',
                                 fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                  {row.fin > 0 ? row.fin.toFixed(1) : '—'}
                </span>
                <span style={{ textAlign: 'center', color: '#FFC83D',
                                 fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                  {row.peak > 0 ? row.peak.toFixed(1) : '—'}
                </span>
                <span style={{ textAlign: 'center',
                                 color: delta > 0 ? 'var(--green)' :
                                        delta < 0 ? 'var(--red)' : 'var(--text-3)',
                                 fontWeight: 700, fontFamily: 'var(--font-mono)',
                                 display: 'inline-flex', alignItems: 'center',
                                 justifyContent: 'center', gap: 3 }}>
                  {delta > 0 ? <ArrowUpRight size={12} /> : delta < 0 ? <ArrowDownRight size={12} /> : null}
                  {delta > 0 ? '+' : ''}{delta || '—'}
                </span>
              </div>
            )
          })}
        </Card>
      )}

      {/* ── Lista de sesiones (acceso al detalle individual) ── */}
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)',
                       fontSize: 14, fontWeight: 700, color: 'var(--text-0)' }}>
          Historial de sesiones ({total})
        </div>
        {[...ordenadas].reverse().map((s, i) => {
          const m = metricas(s)
          return (
            <div key={s.id || i}
                 role="button" tabIndex={0}
                 onClick={() => onVerSession?.(s)}
                 onKeyDown={e => (e.key === 'Enter' || e.key === ' ') &&
                                 (e.preventDefault(), onVerSession?.(s))}
                 className="interactive-row"
                 style={{ display: 'flex', alignItems: 'center', gap: 12,
                          padding: '10px 18px', cursor: 'pointer',
                          borderTop: '1px solid var(--line)', fontSize: 12.5 }}>
              <div style={{ minWidth: 110 }}>
                <p style={{ fontWeight: 600, color: 'var(--text-0)' }}>
                  {formatDate(s.testDate)}
                </p>
              </div>
              <div style={{ flex: 1, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {s.hasPushUp && <Badge color={categoriaColor(m.fuerza)}>F {m.fuerza ? m.fuerza.toFixed(1) : '—'}</Badge>}
                {(s.hasBoxSquat || s.hasPlancha) && <Badge color={categoriaColor(m.resistencia)}>R {m.resistencia ? m.resistencia.toFixed(1) : '—'}</Badge>}
                {s.hasSquatJump && <Badge color={categoriaColor(m.potencia)}>P {m.potencia ? m.potencia.toFixed(1) : '—'}</Badge>}
                {s.hasFlamenco && <Badge color={categoriaColor(m.equilibrio)}>E {m.equilibrio ? m.equilibrio.toFixed(1) : '—'}</Badge>}
              </div>
              {s.puntuacion > 0 && (
                <Badge color={categoriaColor(s.puntuacion)}>
                  Global {s.puntuacion.toFixed(1)}
                </Badge>
              )}
              <ChevronRight size={14} style={{ color: 'var(--text-3)' }} aria-hidden="true" />
            </div>
          )
        })}
      </Card>
    </div>
  )
}


function KpiStat({ icon: Icon, label, value, sub, color = 'var(--text-0)', small = false }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
        <Icon size={12} style={{ color: 'var(--text-3)' }} aria-hidden="true" />
        <span style={{ fontSize: 11, color: 'var(--text-3)',
                        textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600 }}>
          {label}
        </span>
      </div>
      <p style={{ fontFamily: 'Outfit', fontSize: small ? 15 : 22,
                  fontWeight: 700, color, lineHeight: 1.2 }}>
        {value}
      </p>
      {sub && (
        <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{sub}</p>
      )}
    </div>
  )
}
