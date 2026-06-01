// Bandeja /incidencias — listado de eventos del sistema que requieren
// atención humana (sync Odoo fallido, SEPA rechazada, recibos descuadrados,
// etc.). Cada incidencia tiene severidad info|warning|error y puede
// marcarse como leída.
//
// Auto-refresca cada 60s para que las nuevas aparezcan sin recargar.

import { useEffect, useMemo, useState, useCallback } from 'react'
import {
  Bell, Info, AlertTriangle, AlertOctagon, CheckCircle2, Filter,
  Loader2, RefreshCw,
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../components/Toast'
import { useCan } from '../../hooks/useCan'
import { Card, Btn, Badge, SectionTitle } from '../../components/UI'
import {
  getRoundIdentity, incidenciasList, incidenciaMarcarLeida,
} from '../../utils/configApi'

const SEVERIDADES = [
  { id: '',        label: 'Todas las severidades' },
  { id: 'error',   label: 'Errores' },
  { id: 'warning', label: 'Avisos' },
  { id: 'info',    label: 'Info' },
]

// Estilo + icono por severidad.
const SEV_META = {
  error:   { Icon: AlertOctagon, color: 'var(--red)',   bgColor: 'rgba(248,113,113,0.06)',  borderColor: 'var(--red)',    badgeColor: 'red',    label: 'Error' },
  warning: { Icon: AlertTriangle, color: 'var(--amber)', bgColor: 'rgba(251,191,36,0.06)',   borderColor: 'var(--amber)',  badgeColor: 'amber',  label: 'Aviso' },
  info:    { Icon: Info,          color: 'var(--blue)',  bgColor: 'rgba(96,165,250,0.06)',   borderColor: 'var(--blue)',   badgeColor: 'blue',   label: 'Info' },
}
function metaFor(sev) { return SEV_META[sev] || SEV_META.info }

// "hace 2 horas", "hace 3 días"…
function timeAgo(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const diff = Math.max(0, (Date.now() - d.getTime()) / 1000)
  if (diff < 60)        return 'hace unos segundos'
  if (diff < 3600)      return `hace ${Math.floor(diff / 60)} min`
  if (diff < 86400)     return `hace ${Math.floor(diff / 3600)} h`
  if (diff < 86400 * 7) return `hace ${Math.floor(diff / 86400)} días`
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtFecha(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

// Render compacto del JSON `meta` (max 6 campos, valores escalares).
function MetaBlock({ meta }) {
  if (!meta || typeof meta !== 'object') return null
  const entries = Object.entries(meta).slice(0, 6)
  if (!entries.length) return null
  return (
    <div style={{
      marginTop: 10, padding: '8px 10px', borderRadius: 8,
      background: 'var(--bg-1)', border: '1px solid var(--line)',
      fontSize: 12, color: 'var(--text-2)',
      display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '3px 12px',
    }}>
      {entries.map(([k, v]) => {
        const val = (v === null || v === undefined) ? '—'
                  : (typeof v === 'object') ? JSON.stringify(v)
                  : String(v)
        return (
          <div key={k} style={{ display: 'contents' }}>
            <span style={{ color: 'var(--text-3)', fontFamily: 'monospace', fontSize: 11 }}>{k}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={val}>{val}</span>
          </div>
        )
      })}
    </div>
  )
}

function IncidenciaCard({ inc, canMarcar, onMarcar, marcando }) {
  const meta = metaFor(inc.severidad)
  const Icon = meta.Icon
  const leida = !!inc.leida_at
  const entidadStr = inc.entidad
    ? `${inc.entidad}${inc.entidad_id ? ` #${inc.entidad_id}` : ''}`
    : null

  return (
    <Card style={{
      padding: 16,
      borderLeft: `3px solid ${meta.borderColor}`,
      background: leida ? 'var(--bg-2)' : meta.bgColor,
      opacity: leida ? 0.7 : 1,
    }}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: meta.bgColor, color: meta.color,
        }}>
          <Icon size={20} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h3 style={{
              fontSize: 14, fontWeight: 600, color: 'var(--text-0)',
              margin: 0, lineHeight: 1.3,
            }}>
              {inc.titulo || '(sin título)'}
            </h3>
            <Badge color={meta.badgeColor}>{meta.label}</Badge>
            {inc.tipo && <Badge color="gray">{inc.tipo}</Badge>}
          </div>

          <div style={{
            fontSize: 11, color: 'var(--text-3)', marginTop: 4,
            display: 'flex', gap: 8, flexWrap: 'wrap',
          }}>
            {entidadStr && <span>{entidadStr}</span>}
            {entidadStr && <span>·</span>}
            <span title={fmtFecha(inc.created_at)}>{timeAgo(inc.created_at)}</span>
            {inc.id_trainer && <><span>·</span><span>trainer {inc.id_trainer}</span></>}
          </div>

          {inc.mensaje && (
            <p style={{
              fontSize: 13, color: 'var(--text-1)', marginTop: 8,
              whiteSpace: 'pre-wrap', lineHeight: 1.5,
            }}>
              {inc.mensaje}
            </p>
          )}

          <MetaBlock meta={inc.meta} />

          {/* Footer: leída o botón marcar */}
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            {leida ? (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                fontSize: 11, color: 'var(--text-3)',
              }}>
                <CheckCircle2 size={12} style={{ color: 'var(--green)' }} />
                Leída {inc.leida_por ? `por ${inc.leida_por}` : ''} {inc.leida_at ? `· ${fmtFecha(inc.leida_at)}` : ''}
              </div>
            ) : <span />}
            {!leida && canMarcar && (
              <Btn variant="secondary" size="sm" onClick={() => onMarcar(inc.id)} disabled={marcando}>
                {marcando ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                Marcar leída
              </Btn>
            )}
          </div>
        </div>
      </div>
    </Card>
  )
}

export default function Incidencias() {
  const { user } = useAuth()
  const toast = useToast()
  const identity = useMemo(() => getRoundIdentity(user), [user])
  const canVer = useCan('incidencias.ver')
  const canMarcar = useCan('incidencias.marcar_leida')

  const [incidencias, setIncidencias] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [marcandoId, setMarcandoId] = useState(null)

  const [soloPendientes, setSoloPendientes] = useState(true)
  const [severidad, setSeveridad] = useState('')
  const [tipo, setTipo] = useState('')

  const reload = useCallback(async () => {
    if (!canVer) return
    setLoading(true)
    setError('')
    try {
      const list = await incidenciasList(identity, {
        solo_pendientes: soloPendientes ? 1 : 0,
        severidad: severidad || undefined,
        tipo: tipo || undefined,
        limit: 200,
      })
      setIncidencias(list)
    } catch (e) {
      setError(e.message || 'Error cargando incidencias')
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity.managerId, identity.trainerId, soloPendientes, severidad, tipo, canVer])

  useEffect(() => { reload() }, [reload])

  // Auto-refresh cada 60s (sin spinner — silencioso). Pausamos si la
  // pestaña está oculta para no quemar batería ni el backend.
  useEffect(() => {
    if (!canVer) return
    const tick = () => {
      if (document.visibilityState !== 'visible') return
      incidenciasList(identity, {
        solo_pendientes: soloPendientes ? 1 : 0,
        severidad: severidad || undefined,
        tipo: tipo || undefined,
        limit: 200,
      }).then(setIncidencias).catch(() => {/* silencioso */})
    }
    const id = setInterval(tick, 60_000)
    return () => clearInterval(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity.managerId, identity.trainerId, soloPendientes, severidad, tipo, canVer])

  const handleMarcar = async (id) => {
    setMarcandoId(id)
    try {
      await incidenciaMarcarLeida(identity, id)
      toast.success('Incidencia marcada como leída')
      // Si filtramos por pendientes, quitarla; si no, actualizarla
      if (soloPendientes) {
        setIncidencias(prev => prev.filter(i => i.id !== id))
      } else {
        setIncidencias(prev => prev.map(i => i.id === id
          ? { ...i, leida_at: new Date().toISOString(), leida_por: user?.email || 'tú' }
          : i))
      }
    } catch (e) {
      toast.error('Error: ' + e.message)
    } finally {
      setMarcandoId(null)
    }
  }

  // Tipos únicos para el select (a partir de lo cargado)
  const tiposDistintos = useMemo(() => {
    const s = new Set(incidencias.map(i => i.tipo).filter(Boolean))
    return Array.from(s).sort()
  }, [incidencias])

  if (!canVer) {
    return (
      <div style={{ padding: 30, maxWidth: 600, margin: '40px auto',
                     textAlign: 'center', color: 'var(--text-3)' }}>
        <Bell size={40} style={{ opacity: 0.4 }} />
        <h3 style={{ marginTop: 12, color: 'var(--text-1)' }}>
          Acceso restringido
        </h3>
        <p style={{ fontSize: 13 }}>
          Tu perfil no tiene permiso <code>incidencias.ver</code>.
          Solicítalo al administrador.
        </p>
      </div>
    )
  }

  return (
    <div style={{ padding: 16, maxWidth: 1000, margin: '0 auto' }}>
      <SectionTitle
        action={
          <Btn variant="secondary" size="sm" onClick={reload} disabled={loading}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Refrescar
          </Btn>
        }
      >
        Incidencias del sistema
      </SectionTitle>

      {/* Filtros */}
      <Card style={{ padding: 12, marginBottom: 16, display: 'flex',
                      gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <Filter size={14} style={{ color: 'var(--text-3)' }} />

        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
                         fontSize: 13, color: 'var(--text-1)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={soloPendientes}
            onChange={e => setSoloPendientes(e.target.checked)}
            style={{ accentColor: 'var(--green)' }}
          />
          Solo pendientes
        </label>

        <select
          value={severidad}
          onChange={e => setSeveridad(e.target.value)}
          style={{
            padding: '6px 10px', borderRadius: 8,
            background: 'var(--bg-1)', color: 'var(--text-0)',
            border: '1px solid var(--line)', fontSize: 13,
          }}>
          {SEVERIDADES.map(s => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>

        {tiposDistintos.length > 0 && (
          <select
            value={tipo}
            onChange={e => setTipo(e.target.value)}
            style={{
              padding: '6px 10px', borderRadius: 8,
              background: 'var(--bg-1)', color: 'var(--text-0)',
              border: '1px solid var(--line)', fontSize: 13,
            }}>
            <option value="">Todos los tipos</option>
            {tiposDistintos.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        )}

        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-3)' }}>
          {incidencias.length} {incidencias.length === 1 ? 'incidencia' : 'incidencias'}
        </span>
      </Card>

      {/* Listado */}
      {loading && incidencias.length === 0 ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
          <Loader2 size={24} className="animate-spin" style={{ color: 'var(--green)' }} />
        </div>
      ) : error ? (
        <Card style={{ padding: 20, textAlign: 'center', color: 'var(--red)' }}>
          {error}
        </Card>
      ) : incidencias.length === 0 ? (
        <Card style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)' }}>
          <CheckCircle2 size={36} style={{ color: 'var(--green)', opacity: 0.6 }} />
          <p style={{ marginTop: 10, fontSize: 14, color: 'var(--text-1)' }}>
            {soloPendientes ? 'No hay incidencias pendientes' : 'No hay incidencias'}
          </p>
          <p style={{ fontSize: 12, marginTop: 4 }}>
            Todo en orden por aquí.
          </p>
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {incidencias.map(inc => (
            <IncidenciaCard
              key={inc.id}
              inc={inc}
              canMarcar={canMarcar}
              onMarcar={handleMarcar}
              marcando={marcandoId === inc.id}
            />
          ))}
        </div>
      )}
    </div>
  )
}
