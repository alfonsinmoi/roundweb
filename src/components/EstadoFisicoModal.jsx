import { useMemo } from 'react'
import {
  Activity, Dumbbell, Heart, Zap, Scale, Clock, Award, User,
  TrendingUp, AlertCircle,
} from 'lucide-react'
import { Card, Badge } from './UI'
import Modal from './Modal'
import { formatDate } from '../utils/formatters'

// ── Cálculos derivados (mismas fórmulas que DetalleInformeEstadoFisicoViewModel) ──

function categoriaDesdeScore(score) {
  if (score >= 9) return 'Excelente'
  if (score >= 7) return 'Bueno'
  if (score >= 5) return 'Normal'
  if (score >= 3) return 'Regular'
  return 'Bajo'
}

function categoriaColor(score) {
  if (score >= 9) return 'green'
  if (score >= 7) return 'blue'
  if (score >= 5) return 'yellow'
  if (score >= 3) return 'orange'
  return 'red'
}

function computeMetricas(s) {
  if (!s) return null

  const hasFlamenco = s.hasFlamenco && s.flamencoTest
  const hasPushUp = s.hasPushUp && s.pushUpTest
  const hasBoxSquat = s.hasBoxSquat && s.boxSquatTest
  const hasPlancha = s.hasPlancha && s.planchaTest
  const hasSquatJump = s.hasSquatJump && s.squatJumpTest

  // Fuerza: puntuación de PushUp
  const fuerza = hasPushUp && s.pushUpTest.puntuacion > 0 ? s.pushUpTest.puntuacion : 0

  // Resistencia: media de BoxSquat y Plancha
  const resistenciaScores = []
  if (hasBoxSquat && s.boxSquatTest.puntuacion > 0) resistenciaScores.push(s.boxSquatTest.puntuacion)
  if (hasPlancha && s.planchaTest.puntuacion > 0) resistenciaScores.push(s.planchaTest.puntuacion)
  const resistencia = resistenciaScores.length > 0
    ? Math.round((resistenciaScores.reduce((a, b) => a + b, 0) / resistenciaScores.length) * 10) / 10
    : 0

  // Potencia: puntuación mejor de SquatJump
  const potencia = hasSquatJump && s.squatJumpTest.puntuacionMejor > 0 ? s.squatJumpTest.puntuacionMejor : 0

  // Equilibrio: puntuación de Flamenco
  const equilibrio = hasFlamenco && s.flamencoTest.puntuacion > 0 ? s.flamencoTest.puntuacion : 0

  // Edad metabólica
  const scores = [fuerza, resistencia, potencia, equilibrio].filter(v => v > 0)
  let edadMetabolica = 0
  let edadMetabolicaTexto = ''
  if (scores.length >= 2 && s.edad > 0) {
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length
    const ajustada = s.edad + (6.0 - avg) * 2.5
    edadMetabolica = Math.round(Math.max(18, Math.min(s.edad + 15, ajustada)))
    const dif = edadMetabolica - s.edad
    if (dif <= -5) edadMetabolicaTexto = 'excelente forma física'
    else if (dif <= -2) edadMetabolicaTexto = 'buena forma física'
    else if (dif <= 2) edadMetabolicaTexto = 'forma física promedio'
    else if (dif <= 5) edadMetabolicaTexto = 'mejorable'
    else edadMetabolicaTexto = 'necesita mejorar'
  }

  return {
    hasFlamenco, hasPushUp, hasBoxSquat, hasPlancha, hasSquatJump,
    fuerza, resistencia, potencia, equilibrio,
    edadMetabolica, edadMetabolicaTexto,
  }
}

// ── Sub-componentes ──────────────────────────────────────────────────────────

function MetricCard({ icon: Icon, label, score, color = 'var(--green)' }) {
  if (!score || score <= 0) return null
  return (
    <Card style={{ padding: 18, display: 'flex', alignItems: 'center', gap: 14 }}>
      <div style={{
        width: 38, height: 38, borderRadius: 12, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: `color-mix(in srgb, ${color} 14%, var(--bg-3))`,
      }}>
        <Icon size={18} style={{ color }} aria-hidden="true" />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 12, color: 'var(--text-3)' }}>{label}</p>
        <p style={{ fontFamily: 'Outfit', fontSize: 22, fontWeight: 700, color: 'var(--text-0)' }}>
          {score.toFixed(1)}
          <span style={{ fontSize: 13, color: 'var(--text-3)', marginLeft: 4 }}>/10</span>
        </p>
      </div>
      <Badge color={categoriaColor(score)}>{categoriaDesdeScore(score)}</Badge>
    </Card>
  )
}

function TestRow({ label, value, suffix = '' }) {
  if (value == null || value === '' || value === 0) return null
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
      <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{label}</span>
      <span style={{ fontSize: 13, color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums' }}>
        {typeof value === 'number' ? value.toFixed(value % 1 === 0 ? 0 : 2) : value}{suffix}
      </span>
    </div>
  )
}

function TestSubCard({ title, icon: Icon, test, color = 'var(--green)', children }) {
  if (!test) return null
  return (
    <Card style={{ padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <Icon size={15} style={{ color }} aria-hidden="true" />
        <h4 style={{ fontFamily: 'Outfit', fontSize: 14, fontWeight: 600, color: 'var(--text-0)', flex: 1 }}>{title}</h4>
        {test.puntuacion > 0 && (
          <Badge color={categoriaColor(test.puntuacion)}>
            {test.puntuacion.toFixed(1)} · {test.categoria || categoriaDesdeScore(test.puntuacion)}
          </Badge>
        )}
        {/* SquatJump uses puntuacionMejor */}
        {test.puntuacionMejor > 0 && (
          <Badge color={categoriaColor(test.puntuacionMejor)}>
            {test.puntuacionMejor.toFixed(1)} · {test.calidadMejor || categoriaDesdeScore(test.puntuacionMejor)}
          </Badge>
        )}
      </div>
      <div>{children}</div>
    </Card>
  )
}

// ── Modal principal ──────────────────────────────────────────────────────────

export default function EstadoFisicoModal({ session, clienteNombre, onClose }) {
  const m = useMemo(() => computeMetricas(session), [session])

  if (!session) return null

  const titulo = `Informe estado físico — ${formatDate(session.testDate)}`

  return (
    <Modal open={!!session} onClose={onClose} title={titulo}
           subtitle={clienteNombre} maxWidth={860}>
      <div style={{ padding: '24px 32px', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Datos del sujeto + puntuación global */}
        <Card style={{ padding: 24 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 20 }}>
            <Stat icon={User} label="Edad" value={session.edad > 0 ? `${session.edad} años` : '—'} />
            <Stat icon={Scale} label="Peso" value={session.pesoKg > 0 ? `${session.pesoKg} kg` : '—'} />
            <Stat icon={User} label="Sexo" value={session.sexo === 'M' ? 'Masculino' : session.sexo === 'F' ? 'Femenino' : '—'} />
            <Stat
              icon={Award}
              label="Puntuación global"
              value={
                session.puntuacion > 0
                  ? <span>{session.puntuacion.toFixed(1)}<span style={{ fontSize: 13, color: 'var(--text-3)' }}>/10</span></span>
                  : 'N/A'
              }
              valueColor="var(--text-0)"
            />
            {m.edadMetabolica > 0 && (
              <Stat
                icon={TrendingUp}
                label="Edad metabólica"
                value={`${m.edadMetabolica} años`}
                sub={m.edadMetabolicaTexto}
                valueColor={
                  m.edadMetabolica < session.edad ? 'var(--green)' :
                  m.edadMetabolica > session.edad + 2 ? 'var(--red)' : 'var(--text-0)'
                }
              />
            )}
          </div>
          {session.puntuacion > 0 && (
            <div style={{ marginTop: 18, paddingTop: 18, borderTop: '1px solid var(--line)' }}>
              <Badge color={categoriaColor(session.puntuacion)}>
                {session.categoria || categoriaDesdeScore(session.puntuacion)}
              </Badge>
            </div>
          )}
        </Card>

        {/* Métricas calculadas */}
        {(m.fuerza > 0 || m.resistencia > 0 || m.potencia > 0 || m.equilibrio > 0) && (
          <div>
            <h3 style={{ fontFamily: 'Outfit', fontSize: 14, fontWeight: 600, color: 'var(--text-2)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Métricas
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
              <MetricCard icon={Dumbbell} label="Fuerza" score={m.fuerza} color="var(--red)" />
              <MetricCard icon={Heart} label="Resistencia" score={m.resistencia} color="var(--rose)" />
              <MetricCard icon={Zap} label="Potencia" score={m.potencia} color="var(--amber)" />
              <MetricCard icon={Activity} label="Equilibrio" score={m.equilibrio} color="var(--blue)" />
            </div>
          </div>
        )}

        {/* Detalle de cada test */}
        {(m.hasPushUp || m.hasSquatJump || m.hasBoxSquat || m.hasPlancha || m.hasFlamenco) && (
          <div>
            <h3 style={{ fontFamily: 'Outfit', fontSize: 14, fontWeight: 600, color: 'var(--text-2)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Detalle por test
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
              {m.hasPushUp && (
                <TestSubCard title="Flexiones (PushUp)" icon={Dumbbell} test={session.pushUpTest} color="var(--red)">
                  <TestRow label="Variante" value={session.pushUpTest.variante} />
                  <TestRow label="Repeticiones" value={session.pushUpTest.totalReps} />
                  <TestRow label="Reps equivalentes" value={session.pushUpTest.repsEquivalentes} />
                  <TestRow label="Tiempo" value={session.pushUpTest.tiempo} suffix=" s" />
                  <TestRow label="Reps incorrectas" value={session.pushUpTest.totalBadReps} />
                  <TestRow label="Completado" value={session.pushUpTest.completado ? 'Sí' : 'No'} />
                </TestSubCard>
              )}
              {m.hasSquatJump && (
                <TestSubCard title="Squat Jump" icon={Zap} test={session.squatJumpTest} color="var(--amber)">
                  <TestRow label="Total saltos" value={session.squatJumpTest.totalSaltos} />
                  <TestRow label="Mejor altura" value={session.squatJumpTest.mejorAlturaCm} suffix=" cm" />
                  <TestRow label="Altura media" value={session.squatJumpTest.alturaPromedioCm} suffix=" cm" />
                  <TestRow label="Mejor tiempo vuelo" value={session.squatJumpTest.mejorTiempoVuelo} suffix=" s" />
                  <TestRow label="Mejor intento" value={`#${session.squatJumpTest.mejorIntento}`} />
                  <TestRow label="Percentil" value={session.squatJumpTest.percentilMejor} suffix=" %" />
                </TestSubCard>
              )}
              {m.hasBoxSquat && (
                <TestSubCard title="Box Squat" icon={Activity} test={session.boxSquatTest} color="var(--green)">
                  <TestRow label="Repeticiones" value={session.boxSquatTest.totalReps} />
                  <TestRow label="Tiempo" value={session.boxSquatTest.tiempo} suffix=" s" />
                  <TestRow label="ROM promedio" value={session.boxSquatTest.romPromedio} suffix=" °" />
                  <TestRow label="Velocidad media" value={session.boxSquatTest.velocidadMediaGlobal} suffix=" m/s" />
                  <TestRow label="Potencia media" value={session.boxSquatTest.potenciaMedia} suffix=" W" />
                  <TestRow label="Caída potencia" value={session.boxSquatTest.caidaPotenciaPct} suffix=" %" />
                  <TestRow label="Completado" value={session.boxSquatTest.completado ? 'Sí' : 'No'} />
                </TestSubCard>
              )}
              {m.hasPlancha && (
                <TestSubCard title="Plancha" icon={Clock} test={session.planchaTest} color="var(--violet)">
                  <TestRow label="Variante" value={session.planchaTest.variante} />
                  <TestRow label="Tiempo real" value={session.planchaTest.tiempoReal} suffix=" s" />
                  <TestRow label="Tiempo equivalente" value={session.planchaTest.tiempoEquivalente} suffix=" s" />
                  <TestRow label="Eventos cadera" value={session.planchaTest.totalEventosCadera} />
                  <TestRow label="Motivo finalización" value={session.planchaTest.motivoFinalizacion} />
                </TestSubCard>
              )}
              {m.hasFlamenco && (
                <TestSubCard title="Flamenco (equilibrio)" icon={Activity} test={session.flamencoTest} color="var(--blue)">
                  <TestRow label="Canal" value={session.flamencoTest.canal} />
                  <TestRow label="Mejor tiempo" value={session.flamencoTest.mejorTiempo} suffix=" s" />
                  <TestRow label="Media tiempos" value={session.flamencoTest.mediaTiempos} suffix=" s" />
                  <TestRow label="Total intentos" value={session.flamencoTest.totalIntentos} />
                  <TestRow label="RMS aceleración" value={session.flamencoTest.rmsAceleracionG} suffix=" g" />
                </TestSubCard>
              )}
            </div>
          </div>
        )}

        {/* Observaciones */}
        {session.observations && (
          <Card style={{ padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <AlertCircle size={14} style={{ color: 'var(--text-3)', marginTop: 2 }} aria-hidden="true" />
              <div>
                <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 4 }}>Observaciones</p>
                <p style={{ fontSize: 13, color: 'var(--text-1)', lineHeight: 1.55 }}>{session.observations}</p>
              </div>
            </div>
          </Card>
        )}
      </div>
    </Modal>
  )
}

function Stat({ icon: Icon, label, value, sub, valueColor = 'var(--text-0)' }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <Icon size={13} style={{ color: 'var(--text-3)' }} aria-hidden="true" />
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{label}</span>
      </div>
      <p style={{ fontFamily: 'Outfit', fontSize: 18, fontWeight: 700, color: valueColor, lineHeight: 1.2 }}>{value}</p>
      {sub && <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{sub}</p>}
    </div>
  )
}
