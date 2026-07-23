// Dashboard de Tests de Estado Físico — datos agregados de NoofitPro.
// Endpoint: /api/estado-fisico/dashboard (cache 10 min)

import { useState, useEffect, useMemo } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  LineChart, Line, PieChart, Pie, Cell, Legend,
} from 'recharts'
import {
  Activity, Loader2, FlaskConical, RefreshCw, TrendingUp, TrendingDown,
  Users, Calendar, Award, ArrowUpRight, ArrowDownRight, UserCog, Repeat,
} from 'lucide-react'
import { Card, Btn, Badge, EmptyState } from '../UI'
import { useToast } from '../Toast'
import { useAuth } from '../../contexts/AuthContext'
import { getRoundIdentity, estadoFisicoDashboard } from '../../utils/configApi'
import InfoTip from './InfoTip'

const COLORS = ['#2DD4A8', '#5B9CF6', '#A78BFA', '#FBBF24', '#FB923C', '#F87171', '#10B981']

const fmtFecha = (epoch) => {
  if (!epoch) return '—'
  return new Date(epoch).toLocaleDateString('es-ES', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

export default function EstadoFisicoDashboard({ onVerPerfil }) {
  const toast = useToast()
  const { user } = useAuth()
  const identity = useMemo(() => getRoundIdentity(user), [user])
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = (force = false) => {
    if (force) setRefreshing(true)
    else setLoading(true)
    estadoFisicoDashboard(identity, force)
      .then(setData)
      .catch(e => toast.error('Error cargando dashboard: ' + e.message))
      .finally(() => { setLoading(false); setRefreshing(false) })
  }

  useEffect(() => {
    if (identity?.managerId) load(false)
  // eslint-disable-next-line
  }, [identity?.managerId])

  if (loading) return (
    <div role="tabpanel" style={{ marginTop: 8, padding: 40, textAlign: 'center' }}>
      <Loader2 size={24} className="animate-spin" style={{ color: 'var(--green)' }} aria-hidden="true" />
      <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8 }}>
        Recolectando tests de todos los clientes (puede tardar 10-30s la primera vez)…
      </p>
    </div>
  )

  if (!data || data.total_tests === 0) return (
    <div role="tabpanel" style={{ marginTop: 8 }}>
      <Card style={{ padding: 36, textAlign: 'center' }}>
        <FlaskConical size={26} style={{ color: 'var(--green)', margin: '0 auto 12px' }} aria-hidden="true" />
        <p style={{ fontSize: 14, color: 'var(--text-1)', marginBottom: 6 }}>
          Aún no hay tests de estado físico registrados
        </p>
        <p style={{ fontSize: 12, color: 'var(--text-3)' }}>
          Cuando hagas el primer test desde la ficha de un cliente (botón "Informe estado físico"),
          aparecerán aquí los KPIs.
        </p>
      </Card>
    </div>
  )

  // Datos para gráficos
  const dataMes = data.por_mes || []
  const dataTipo = Object.entries(data.por_tipo || {}).map(([name, value]) => ({ name, value }))
  const dataRep = Object.entries(data.distribucion_repeticion || {})
    .map(([name, value]) => ({ name, value }))
    .filter(d => d.value > 0)
  const dataSexo = Object.entries(data.demografico?.por_sexo || {})
    .map(([name, value]) => ({ name: name === 'H' ? 'Hombre' : name === 'M' ? 'Mujer' : name, value }))
  const dataEdad = Object.entries(data.demografico?.por_edad_bucket || {})
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => {
      // ordenar por bucket numérico
      const k = s => parseInt(String(s).match(/\d+/)?.[0] || 99)
      return k(a.name) - k(b.name)
    })

  // Técnicos: nombre legible (idTecnico de NoofitPro → nombre; fallback id)
  const tecnicos = data.tecnicos || {}
  const tecnicoLabel = (id) =>
    id == null ? 'Sin técnico' : (tecnicos[String(id)] || `Técnico #${id}`)
  const porTecnico = data.por_tecnico || []
  const fidel = data.fidelizacion_tecnico || {}
  const tecnicosReales = porTecnico.filter(t => t.id_tecnico != null)

  // Actividad por día (solo días con tests) + agregado por día de la semana
  const dataDia = data.por_dia || []
  const dataDow = data.por_dia_semana || []

  return (
    <div role="tabpanel" aria-label="Estado físico" style={{ marginTop: 8 }}>
      {/* Cabecera */}
      <div style={{
        padding: '12px 16px', borderRadius: 12, marginBottom: 18,
        background: 'rgba(45,212,168,0.06)', border: '1px solid rgba(45,212,168,0.2)',
        display: 'flex', alignItems: 'center', gap: 12,
        fontSize: 13, color: 'var(--text-1)', lineHeight: 1.5,
      }}>
        <Activity size={18} style={{ color: 'var(--green)', flexShrink: 0 }} aria-hidden="true" />
        <span style={{ flex: 1 }}>
          <strong>{data.total_tests}</strong> tests realizados por <strong>{data.clientes_con_test}</strong> clientes ·
          Repetición <strong>{data.tests_repetidos_pct}%</strong> · Puntuación media <strong>{data.puntuacion_media}</strong>
        </span>
        <Btn size="sm" variant="secondary" onClick={() => load(true)} disabled={refreshing}>
          {refreshing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          Refrescar
        </Btn>
      </div>

      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 18 }}>
        <Kpi label="Total tests"
             value={data.total_tests}
             color="var(--green)"
             info="Suma de todas las sesiones de test registradas en cualquier momento." />
        <Kpi label="Clientes con test"
             value={data.clientes_con_test}
             sub={`de ${data.clientes_con_test * 100} / total`}
             info="Número único de clientes que tienen al menos 1 test. Indica adopción de la herramienta." />
        <Kpi label="Repetición"
             value={`${data.tests_repetidos_pct}%`}
             color={data.tests_repetidos_pct >= 30 ? 'var(--green)' : 'var(--amber)'}
             sub="clientes con ≥ 2 tests"
             info="Porcentaje de clientes que han hecho 2 o más tests. Repetición alta = seguimiento real del progreso." />
        <Kpi label="Tasa completitud"
             value={`${data.tasa_completitud}%`}
             color={data.tasa_completitud >= 80 ? 'var(--green)' : 'var(--amber)'}
             info="% de tests con isCompleted=true (los 5 sub-tests realizados sin interrupciones)." />
        <Kpi label="Puntuación media"
             value={data.puntuacion_media || '—'}
             sub="/ 10"
             info="Media de la columna puntuacion en todas las sesiones (descarta los 0). Escala 0-10." />
        <Kpi label="Días entre tests"
             value={data.media_dias_entre_tests || '—'}
             sub="promedio"
             info="Media de días entre tests consecutivos del mismo cliente. Frecuencia recomendada: 30-90 días." />
      </div>

      {/* Tests por mes + tipo */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 14, marginBottom: 18 }}>
        <Card style={{ padding: 18 }}>
          <h3 style={{ fontFamily: 'Outfit', fontSize: 15, fontWeight: 700, color: 'var(--text-0)', marginBottom: 12,
                       display: 'flex', alignItems: 'center', gap: 6 }}>
            <Calendar size={15} aria-hidden="true" /> Uso mensual
            <InfoTip title="Uso mensual">
              Tests realizados cada mes. Útil para detectar adopción, picos de uso (campañas) o caídas.
            </InfoTip>
          </h3>
          {dataMes.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--text-3)' }}>Sin datos.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={dataMes}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                <XAxis dataKey="mes" stroke="var(--text-3)" fontSize={11} />
                <YAxis stroke="var(--text-3)" fontSize={11} />
                <Tooltip contentStyle={{ background: 'var(--bg-1)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="tests" fill="#2DD4A8" name="Tests" />
                <Bar dataKey="clientes" fill="#5B9CF6" name="Clientes únicos" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card style={{ padding: 18 }}>
          <h3 style={{ fontFamily: 'Outfit', fontSize: 15, fontWeight: 700, color: 'var(--text-0)', marginBottom: 12,
                       display: 'flex', alignItems: 'center', gap: 6 }}>
            <FlaskConical size={15} aria-hidden="true" /> Por tipo de test
            <InfoTip title="Por tipo de test">
              Cuántas veces se ha completado cada sub-test (Squat Jump, Box Squat, Flamenco, Plancha, Push-up).
              Tests muy poco usados pueden indicar que el equipo no está disponible o el monitor no los pide.
            </InfoTip>
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={dataTipo} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
              <XAxis type="number" stroke="var(--text-3)" fontSize={11} />
              <YAxis type="category" dataKey="name" stroke="var(--text-3)" fontSize={11} width={80} />
              <Tooltip contentStyle={{ background: 'var(--bg-1)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="value" fill="#A78BFA" name="Tests" />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Actividad por día + por día de la semana */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 14, marginBottom: 18 }}>
        <Card style={{ padding: 18 }}>
          <h3 style={{ fontFamily: 'Outfit', fontSize: 15, fontWeight: 700, color: 'var(--text-0)', marginBottom: 12,
                       display: 'flex', alignItems: 'center', gap: 6 }}>
            <Calendar size={15} aria-hidden="true" /> Actividad por día
            <InfoTip title="Actividad por día">
              Tests realizados cada día (solo los días con actividad). La etiqueta incluye el día de la
              semana (Lun–Dom) para ver el patrón. Pasa el ratón para la fecha y nº de tests.
            </InfoTip>
          </h3>
          {dataDia.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--text-3)' }}>Sin datos.</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={dataDia} margin={{ top: 4, right: 8, bottom: 24, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                <XAxis dataKey="label" stroke="var(--text-3)" fontSize={10}
                       angle={-45} textAnchor="end" height={52} interval="preserveStartEnd" />
                <YAxis stroke="var(--text-3)" fontSize={11} allowDecimals={false} />
                <Tooltip contentStyle={{ background: 'var(--bg-1)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="tests" fill="#2DD4A8" name="Tests" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card style={{ padding: 18 }}>
          <h3 style={{ fontFamily: 'Outfit', fontSize: 15, fontWeight: 700, color: 'var(--text-0)', marginBottom: 12,
                       display: 'flex', alignItems: 'center', gap: 6 }}>
            <Calendar size={15} aria-hidden="true" /> Por día de la semana
            <InfoTip title="Por día de la semana">
              Total de tests agregados por día de la semana (Lun–Dom). Muestra qué días concentra la
              actividad; el fin de semana va resaltado. Útil para planificar personal técnico.
            </InfoTip>
          </h3>
          {dataDow.every(d => !d.tests) ? (
            <p style={{ fontSize: 12, color: 'var(--text-3)' }}>Sin datos.</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={dataDow} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                <XAxis dataKey="dia_abbr" stroke="var(--text-3)" fontSize={12} />
                <YAxis stroke="var(--text-3)" fontSize={11} allowDecimals={false} />
                <Tooltip contentStyle={{ background: 'var(--bg-1)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }}
                         formatter={(v) => [v, 'Tests']}
                         labelFormatter={(l, p) => p?.[0]?.payload?.dia || l} />
                <Bar dataKey="tests" name="Tests" radius={[4, 4, 0, 0]}>
                  {dataDow.map((d, i) => <Cell key={i} fill={d.es_finde ? '#FB923C' : '#5B9CF6'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* Distribución repetición + Demografía */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14, marginBottom: 18 }}>
        <Card style={{ padding: 18 }}>
          <h3 style={{ fontFamily: 'Outfit', fontSize: 14, fontWeight: 700, color: 'var(--text-0)', marginBottom: 10,
                       display: 'flex', alignItems: 'center', gap: 6 }}>
            <Users size={14} aria-hidden="true" /> Distribución repetición
            <InfoTip title="Distribución repetición" side="left">
              Cuántos clientes han hecho 1, 2, 3-5 o 6+ tests. Si la mayoría hace solo 1, falta seguimiento.
            </InfoTip>
          </h3>
          {dataRep.length === 0 ? <p style={{ fontSize: 12, color: 'var(--text-3)' }}>Sin datos.</p> : (
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={dataRep} dataKey="value" nameKey="name" cx="50%" cy="50%"
                     outerRadius={70} label={({ name, value }) => `${name}: ${value}`}>
                  {dataRep.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ background: 'var(--bg-1)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card style={{ padding: 18 }}>
          <h3 style={{ fontFamily: 'Outfit', fontSize: 14, fontWeight: 700, color: 'var(--text-0)', marginBottom: 10 }}>
            Por sexo
          </h3>
          {dataSexo.length === 0 ? <p style={{ fontSize: 12, color: 'var(--text-3)' }}>Sin datos.</p> : (
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={dataSexo} dataKey="value" nameKey="name" cx="50%" cy="50%"
                     outerRadius={70} label={({ name, value }) => `${name}: ${value}`}>
                  {dataSexo.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ background: 'var(--bg-1)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card style={{ padding: 18 }}>
          <h3 style={{ fontFamily: 'Outfit', fontSize: 14, fontWeight: 700, color: 'var(--text-0)', marginBottom: 10 }}>
            Por edad
          </h3>
          {dataEdad.length === 0 ? <p style={{ fontSize: 12, color: 'var(--text-3)' }}>Sin datos.</p> : (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={dataEdad}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                <XAxis dataKey="name" stroke="var(--text-3)" fontSize={10} />
                <YAxis stroke="var(--text-3)" fontSize={10} />
                <Tooltip contentStyle={{ background: 'var(--bg-1)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="value" fill="#FBBF24" name="Tests" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* Técnicos: tests por técnico + fidelización */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14, marginBottom: 18 }}>
        <Card style={{ padding: 18 }}>
          <h3 style={{ fontFamily: 'Outfit', fontSize: 15, fontWeight: 700, color: 'var(--text-0)', marginBottom: 10,
                       display: 'flex', alignItems: 'center', gap: 6 }}>
            <UserCog size={15} aria-hidden="true" /> Tests por técnico
            <InfoTip title="Tests por técnico">
              Tests administrados por cada técnico (campo <code>idTecnico</code> de NoofitPro) y nº de clientes
              distintos. NoofitPro acaba de empezar a registrar el técnico, por eso la mayoría aún aparecen como
              “Sin técnico”. Un técnico mostrado como “Técnico #N” es que falta su nombre (pendiente de conectar
              el catálogo de NoofitPro).
            </InfoTip>
          </h3>
          {porTecnico.length === 0 ? <p style={{ fontSize: 12, color: 'var(--text-3)' }}>Sin datos.</p> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 12, padding: '4px 10px',
                            fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase',
                            color: 'var(--text-3)' }}>
                <span>Técnico</span><span style={{ textAlign: 'right' }}>Tests</span><span style={{ textAlign: 'right' }}>Clientes</span>
              </div>
              {porTecnico.map(t => (
                <div key={t.id_tecnico ?? 'none'}
                     style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 12, alignItems: 'center',
                              padding: '6px 10px', borderRadius: 8, fontSize: 12.5,
                              background: t.id_tecnico != null ? 'rgba(45,212,168,0.05)' : 'transparent' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                 color: t.id_tecnico != null ? 'var(--text-0)' : 'var(--text-3)',
                                 display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {t.id_tecnico != null && <UserCog size={12} style={{ color: 'var(--green)', flexShrink: 0 }} aria-hidden="true" />}
                    {tecnicoLabel(t.id_tecnico)}
                  </span>
                  <Badge color={t.id_tecnico != null ? 'green' : 'gray'}>{t.n_tests}</Badge>
                  <span style={{ textAlign: 'right', fontSize: 12, color: 'var(--text-2)',
                                 fontVariantNumeric: 'tabular-nums' }}>{t.n_clientes}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card style={{ padding: 18 }}>
          <h3 style={{ fontFamily: 'Outfit', fontSize: 15, fontWeight: 700, color: 'var(--text-0)', marginBottom: 10,
                       display: 'flex', alignItems: 'center', gap: 6 }}>
            <Repeat size={15} aria-hidden="true" /> Fidelización al técnico
            <InfoTip title="Fidelización al técnico" side="left">
              De los clientes que han hecho ≥ 2 tests <em>con técnico asignado</em>, qué porcentaje repite
              SIEMPRE con el mismo técnico. Alto = el cliente vuelve con su técnico de confianza.
            </InfoTip>
          </h3>
          {fidel.clientes_evaluables === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6 }}>
              Aún no hay clientes con ≥ 2 tests que lleven técnico asignado.
              {tecnicosReales.length > 0
                ? ' En cuanto un cliente repita test con técnico, aquí verás el % que repite con el mismo.'
                : ' NoofitPro todavía no está registrando el técnico en los tests; este indicador se activará cuando empiece a hacerlo.'}
            </p>
          ) : (
            <div>
              <p style={{ fontFamily: 'Outfit', fontSize: 34, fontWeight: 700,
                          color: fidel.pct_mismo >= 60 ? 'var(--green)' : 'var(--amber)', margin: '2px 0' }}>
                {fidel.pct_mismo}%
              </p>
              <p style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.6 }}>
                <strong>{fidel.mismo_tecnico}</strong> de <strong>{fidel.clientes_evaluables}</strong> clientes
                repiten con el mismo técnico · <strong>{fidel.distinto_tecnico}</strong> han cambiado.
              </p>
            </div>
          )}
        </Card>
      </div>

      {/* Tablas: Top clientes + Evolución + Ranking */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 14 }}>
        <Card style={{ padding: 18 }}>
          <h3 style={{ fontFamily: 'Outfit', fontSize: 15, fontWeight: 700, color: 'var(--text-0)', marginBottom: 10,
                       display: 'flex', alignItems: 'center', gap: 6 }}>
            <Award size={15} aria-hidden="true" /> Top clientes por nº de tests
          </h3>
          {data.top_clientes?.length === 0 ? <p style={{ fontSize: 12, color: 'var(--text-3)' }}>Sin datos.</p> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {data.top_clientes.map((c, i) => (
                <div key={c.id}
                     onClick={() => onVerPerfil?.(c.id)}
                     style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px',
                              borderRadius: 8, fontSize: 12.5,
                              background: i < 3 ? 'rgba(45,212,168,0.05)' : 'transparent',
                              cursor: onVerPerfil ? 'pointer' : 'default' }}>
                  <span style={{ width: 22, height: 22, borderRadius: '50%',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  background: i === 0 ? '#FFC83D' : i === 1 ? '#C0C0C0' : i === 2 ? '#CD7F32' : 'var(--bg-3)',
                                  color: i < 3 ? '#000' : 'var(--text-2)',
                                  fontSize: 11, fontWeight: 700 }}>{i + 1}</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.nombre}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                    {fmtFecha(c.ultimo_test)}
                  </span>
                  <Badge color="green">{c.n_tests} tests</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card style={{ padding: 18 }}>
          <h3 style={{ fontFamily: 'Outfit', fontSize: 15, fontWeight: 700, color: 'var(--text-0)', marginBottom: 10,
                       display: 'flex', alignItems: 'center', gap: 6 }}>
            <Award size={15} aria-hidden="true" /> Ranking puntuación (último test)
          </h3>
          {data.ranking_puntuacion?.length === 0 ? <p style={{ fontSize: 12, color: 'var(--text-3)' }}>Sin puntuaciones &gt; 0.</p> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {data.ranking_puntuacion.map((c, i) => (
                <div key={c.id}
                     onClick={() => onVerPerfil?.(c.id)}
                     style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px',
                              borderRadius: 8, fontSize: 12.5,
                              background: i < 3 ? 'rgba(91,156,246,0.05)' : 'transparent',
                              cursor: onVerPerfil ? 'pointer' : 'default' }}>
                  <span style={{ width: 22, height: 22, borderRadius: '50%',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  background: i === 0 ? '#FFC83D' : i === 1 ? '#C0C0C0' : i === 2 ? '#CD7F32' : 'var(--bg-3)',
                                  color: i < 3 ? '#000' : 'var(--text-2)',
                                  fontSize: 11, fontWeight: 700 }}>{i + 1}</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.nombre}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{fmtFecha(c.fecha)}</span>
                  <Badge color={c.puntuacion >= 7 ? 'green' : c.puntuacion >= 5 ? 'blue' : 'amber'}>
                    {c.puntuacion.toFixed(1)}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card style={{ padding: 18 }}>
          <h3 style={{ fontFamily: 'Outfit', fontSize: 15, fontWeight: 700, color: 'var(--text-0)', marginBottom: 10,
                       display: 'flex', alignItems: 'center', gap: 6 }}>
            <TrendingUp size={15} aria-hidden="true" /> Evolución (primer test → último)
            <InfoTip title="Evolución" side="left">
              Para los clientes con ≥ 2 tests, diferencia entre la puntuación del PRIMER test y la del ÚLTIMO.
              Verde si mejora, rojo si baja. Útil para felicitar a quienes progresan y contactar a los que retroceden.
            </InfoTip>
          </h3>
          {data.progreso_clientes?.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--text-3)' }}>
              Sin clientes con ≥ 2 tests aún. Para ver evolución hace falta que un cliente repita el test.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {data.progreso_clientes.map(c => (
                <div key={c.id}
                     onClick={() => onVerPerfil?.(c.id)}
                     style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                              borderRadius: 8, fontSize: 12.5, background: 'var(--bg-2)',
                              cursor: onVerPerfil ? 'pointer' : 'default' }}>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.nombre}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                    {c.puntuacion_inicial} → {c.puntuacion_actual}
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontWeight: 700,
                                  color: c.delta > 0 ? 'var(--green)' : c.delta < 0 ? 'var(--red)' : 'var(--text-3)' }}>
                    {c.delta > 0 ? <ArrowUpRight size={12} /> : c.delta < 0 ? <ArrowDownRight size={12} /> : null}
                    {c.delta > 0 ? '+' : ''}{c.delta}
                    {c.delta_pct != null && (
                      <span style={{ fontSize: 11, opacity: 0.7 }}>
                        &nbsp;({c.delta_pct > 0 ? '+' : ''}{c.delta_pct}%)
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}


function Kpi({ label, value, sub, color, info }) {
  return (
    <Card style={{ padding: 16 }}>
      <p style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600,
                  letterSpacing: 0.4, textTransform: 'uppercase',
                  display: 'flex', alignItems: 'center' }}>
        {label}
        {info && <InfoTip title={label}>{info}</InfoTip>}
      </p>
      <p style={{ fontFamily: 'Outfit', fontSize: 26, fontWeight: 700,
                  color: color || 'var(--text-0)', marginTop: 4 }}>
        {value}
      </p>
      {sub && (
        <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>{sub}</p>
      )}
    </Card>
  )
}
