// Informe de COMPETICIONES — participaciones y puestos por competición.
//
// Qué competiciones se han celebrado en el centro, con cuántos participantes,
// y el ranking de clientes por nº de participaciones y mejor puesto. Filtra
// por periodo. Espejo del informe de ejercicios.
//
// Backend: /api/informes/competiciones (cache local sincronizada desde
// NoofitPro — clases de tipo competición). Hoy Round no las usa aún, así que
// la pantalla se ve vacía con estados claros.

import { useEffect, useState, useMemo, useCallback } from 'react'
import {
  Award, Loader2, RefreshCw, Users, Trophy, CalendarDays,
} from 'lucide-react'
import { Card, Btn } from '../components/UI'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../components/Toast'
import {
  getRoundIdentity, informeCompeticiones, informeCompeticionesEstado,
  informeCompeticionesSync,
} from '../utils/configApi'
import { formatDate } from '../utils/formatters'

function isoDaysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}
const HOY = new Date().toISOString().slice(0, 10)
const fmtNum = (n) => (n == null ? '—' : Number(n).toLocaleString('es-ES'))
const fmtPuesto = (p) => (p == null || p === 0 ? '—' : `#${p}`)

export default function InformeCompeticiones() {
  const { user } = useAuth()
  const identity = useMemo(() => getRoundIdentity(user), [user])
  const toast = useToast()

  const [desde, setDesde] = useState(isoDaysAgo(90))
  const [hasta, setHasta] = useState(HOY)

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [estado, setEstado] = useState(null)
  const [syncing, setSyncing] = useState(false)

  const cargar = useCallback(async () => {
    if (!identity?.managerId) return
    setLoading(true)
    try {
      const d = await informeCompeticiones(identity, { desde, hasta, limit: 200 })
      setData(d)
    } catch (e) {
      toast.error(`Error cargando informe: ${e.message}`)
    } finally { setLoading(false) }
  }, [identity?.managerId, desde, hasta])

  useEffect(() => { cargar() }, [cargar])

  // Estado del sync + sync incremental en background al abrir.
  useEffect(() => {
    if (!identity?.managerId) return
    let active = true
    ;(async () => {
      try {
        const st = await informeCompeticionesEstado(identity)
        if (!active) return
        setEstado(st)
        informeCompeticionesSync(identity).catch(() => {})
      } catch { /* estado es informativo */ }
    })()
    return () => { active = false }
  }, [identity?.managerId])

  const handleSyncAhora = async () => {
    setSyncing(true)
    try {
      await informeCompeticionesSync(identity)
      toast.success('Sincronización lanzada en segundo plano — pulsa "Actualizar" en unos minutos')
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setSyncing(false)
  }

  const competiciones = data?.competiciones || []
  const topClientes = data?.top_clientes || []
  const totalComp = Number(data?.totales?.competiciones || 0)

  const setPreset = (dias) => { setDesde(isoDaysAgo(dias)); setHasta(HOY) }

  return (
    <div>
      {/* ── Cabecera ──────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
                    gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontFamily: 'Outfit', fontSize: 24, fontWeight: 700,
                       color: 'var(--text-0)', margin: 0,
                       display: 'flex', alignItems: 'center', gap: 10 }}>
            <Trophy size={22} style={{ color: 'var(--green)' }} aria-hidden="true" />
            Informe de Competiciones
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '6px 0 0' }}>
            Competiciones celebradas en el centro, participantes y ranking de
            clientes por participaciones y mejor puesto.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {estado?.ultimo_sync && (
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
              Última sincronización: {new Date(estado.ultimo_sync).toLocaleString('es-ES')}
            </span>
          )}
          <Btn variant="secondary" size="sm" onClick={handleSyncAhora} disabled={syncing}>
            {syncing ? <Loader2 size={13} className="animate-spin" aria-hidden="true" />
                     : <RefreshCw size={13} aria-hidden="true" />}
            {' Sincronizar'}
          </Btn>
          <Btn variant="secondary" size="sm" onClick={cargar} disabled={loading}>
            {loading ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : null}
            {' Actualizar'}
          </Btn>
        </div>
      </div>

      {/* ── Filtros de periodo ────────────────────────────────────────── */}
      <Card style={{ padding: 18, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <CalendarDays size={15} style={{ color: 'var(--text-3)' }} aria-hidden="true" />
          {[['30 días', 30], ['90 días', 90], ['12 meses', 365]].map(([l, n]) => (
            <Btn key={n} size="sm"
                 variant={desde === isoDaysAgo(n) && hasta === HOY ? 'primary' : 'secondary'}
                 onClick={() => setPreset(n)}>{l}</Btn>
          ))}
          <input type="date" value={desde} onChange={e => setDesde(e.target.value)} style={inputStyle} />
          <span style={{ color: 'var(--text-3)', fontSize: 12 }}>→</span>
          <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} style={inputStyle} />
        </div>
      </Card>

      {/* ── KPIs ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                    gap: 12, marginBottom: 16 }}>
        <Kpi icon={Trophy} label="Competiciones" value={fmtNum(data?.totales?.competiciones)} />
        <Kpi icon={Award}  label="Participaciones" value={fmtNum(data?.totales?.participaciones)} />
        <Kpi icon={Users}  label="Clientes" value={fmtNum(data?.totales?.clientes)} />
      </div>

      {/* ── Estado vacío / contenido ──────────────────────────────────── */}
      {loading ? (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: 48, textAlign: 'center' }}>
            <Loader2 size={22} className="animate-spin" style={{ color: 'var(--green)' }} />
          </div>
        </Card>
      ) : totalComp === 0 ? (
        <Card style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ width: 48, height: 48, borderRadius: 14, margin: '0 auto 14px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'var(--green-bg)' }}>
            <Trophy size={22} style={{ color: 'var(--green)' }} aria-hidden="true" />
          </div>
          <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-0)', margin: 0 }}>
            Aún no hay competiciones
          </p>
          <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '8px auto 0', maxWidth: 460 }}>
            {estado && !estado.filas
              ? 'Se registrarán automáticamente cuando se creen clases de tipo competición en NoofitPro.'
              : 'No hay competiciones en el periodo seleccionado. Se registrarán automáticamente cuando se creen clases de tipo competición en NoofitPro.'}
          </p>
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {/* ── Tabla de competiciones ────────────────────────────────── */}
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)',
                          fontFamily: 'Outfit', fontWeight: 700, color: 'var(--text-0)', fontSize: 15 }}>
              Competiciones
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--line)', background: 'var(--bg-2)' }}>
                    <th style={{ ...thStyle, textAlign: 'left' }}>Competición</th>
                    <th style={{ ...thStyle, textAlign: 'left' }}>Fecha</th>
                    <th style={thStyle}>Participantes</th>
                  </tr>
                </thead>
                <tbody>
                  {competiciones.map((c) => (
                    <tr key={`${c.sala_id}-${c.fecha}`} style={{ borderBottom: '1px solid var(--line)' }}>
                      <td style={{ ...tdStyle, textAlign: 'left', fontWeight: 600,
                                   color: 'var(--text-0)' }}>
                        {c.nombre}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'left' }}>{formatDate(c.fecha)}</td>
                      <td style={tdStyle}>{fmtNum(c.participantes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* ── Top clientes ──────────────────────────────────────────── */}
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)',
                          fontFamily: 'Outfit', fontWeight: 700, color: 'var(--text-0)', fontSize: 15 }}>
              Top clientes
            </div>
            {!topClientes.length ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-2)', fontSize: 13 }}>
                Sin clientes participantes en el periodo.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--line)', background: 'var(--bg-2)' }}>
                      <th style={thStyle}>#</th>
                      <th style={{ ...thStyle, textAlign: 'left' }}>Cliente</th>
                      <th style={thStyle}>Competiciones</th>
                      <th style={thStyle}>Mejor puesto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topClientes.map((c, idx) => (
                      <tr key={c.cliente_idnoofit} style={{ borderBottom: '1px solid var(--line)' }}>
                        <td style={{ ...tdStyle, color: 'var(--text-3)', width: 36 }}>{idx + 1}</td>
                        <td style={{ ...tdStyle, textAlign: 'left', fontWeight: 600,
                                     color: 'var(--text-0)' }}>{c.nombre}</td>
                        <td style={tdStyle}>{fmtNum(c.competiciones)}</td>
                        <td style={tdStyle}>{fmtPuesto(c.mejor_puesto)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {data && !loading && totalComp > 0 && (
        <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 10 }}>
          Periodo {data.desde} → {data.hasta}. Datos de las clases de tipo
          competición registradas en NoofitPro. Se sincronizan cada noche
          (y al abrir esta página, de forma incremental).
        </p>
      )}
    </div>
  )
}

function Kpi({ icon: Icon, label, value }) {
  return (
    <Card style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'var(--green-bg)' }}>
        <Icon size={17} style={{ color: 'var(--green)' }} aria-hidden="true" />
      </div>
      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: 11, color: 'var(--text-3)', margin: 0, textTransform: 'uppercase',
                    letterSpacing: '0.04em' }}>{label}</p>
        <p style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-0)', margin: '2px 0 0',
                    fontFamily: 'Outfit' }}>{value}</p>
      </div>
    </Card>
  )
}

const inputStyle = {
  padding: '8px 10px', borderRadius: 10, fontSize: 13,
  background: 'var(--bg-2)', border: '1px solid var(--line)', color: 'var(--text-0)',
}
const thStyle = {
  padding: '10px 12px', fontSize: 11, fontWeight: 600, color: 'var(--text-3)',
  textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'right',
  whiteSpace: 'nowrap',
}
const tdStyle = {
  padding: '9px 12px', color: 'var(--text-1)', textAlign: 'right', whiteSpace: 'nowrap',
}
