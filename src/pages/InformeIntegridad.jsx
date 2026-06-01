// Informe de integridad NoofitPro ↔ cache local.
// Calcula EN VIVO (sin tabla local) qué clientes están reservando en
// clases del manager pero NO aparecen en nuestra cache de clientes.
// Descarga Excel con todos los detalles.
import { useState, useMemo, useEffect } from 'react'
import { RefreshCw, Download, AlertTriangle, Search, Loader2 } from 'lucide-react'
import { Card, Btn, Badge } from '../components/UI'
import { useToast } from '../components/Toast'
import { useAuth } from '../contexts/AuthContext'
import { getRoundIdentity } from '../utils/configApi'
import { coincideTexto } from '../utils/texto'

const TOKEN = import.meta.env.VITE_CONFIG_API_TOKEN || ''

export default function InformeIntegridad() {
  const toast = useToast()
  const { user } = useAuth()
  const identity = useMemo(() => getRoundIdentity(user), [user])
  const [dias, setDias] = useState(90)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [tipoFiltro, setTipoFiltro] = useState('todos') // todos|verdadero_fantasma|cross_manager

  function headers() {
    const h = { 'X-Round-Token': TOKEN }
    if (identity?.managerId) h['X-Round-Manager-Id'] = String(identity.managerId)
    if (identity?.trainerId) h['X-Round-Trainer-Id'] = String(identity.trainerId)
    return h
  }

  async function reload() {
    if (!identity?.managerId) return
    setLoading(true)
    try {
      const r = await fetch(`/api/integridad/reservas-sin-cliente?dias=${dias}`, { headers: headers() })
      const j = await r.json()
      if (!j.ok) throw new Error(j.error || 'Error')
      setData(j)
    } catch (e) { toast.error(e.message) }
    setLoading(false)
  }
  useEffect(() => { reload() }, [identity?.managerId, identity?.trainerId])

  function descargarExcel() {
    const url = `/api/integridad/reservas-sin-cliente/excel?dias=${dias}`
    // Para enviar headers no podemos abrir en pestaña simple. Hacemos fetch + blob.
    fetch(url, { headers: headers() })
      .then(r => r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(blob => {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `integridad_reservas_${identity.managerId}_${dias}d.xlsx`
        a.click()
        URL.revokeObjectURL(a.href)
      })
      .catch(e => toast.error(`Descarga fallida: ${e.message}`))
  }

  const filas = useMemo(() => {
    if (!data) return []
    let rows = data.fantasmas || []
    if (tipoFiltro !== 'todos') rows = rows.filter(f => f.tipo === tipoFiltro)
    if (search) rows = rows.filter(f =>
      coincideTexto(String(f.cliente_id), search) ||
      coincideTexto(f.nombre || '', search) ||
      coincideTexto(f.email || '', search) ||
      coincideTexto(f.dni || '', search) ||
      (f.actividades || []).some(a => coincideTexto(a, search))
    )
    return rows
  }, [data, search, tipoFiltro])

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700,
                       color: 'var(--text-0)', margin: 0 }}>Integridad de clientes</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-3)' }}>
            Clientes que reservan en clases del centro pero <strong>no figuran</strong> en la web admin / cache local.
            Cálculo <strong>en vivo</strong> contra NoofitPro (sin tabla local de reservas).
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ fontSize: 12, color: 'var(--text-3)' }}>Días:</label>
          <select value={dias} onChange={e => setDias(Number(e.target.value))}
                  style={{ padding: '6px 10px', borderRadius: 8, background: 'var(--bg-2)',
                           border: '1px solid var(--line)', color: 'var(--text-0)', fontSize: 13 }}>
            {[30, 60, 90, 180, 365].map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <Btn variant="secondary" size="sm" onClick={reload} disabled={loading}>
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Recalcular
          </Btn>
          <Btn variant="primary" size="sm" onClick={descargarExcel} disabled={!data}>
            <Download size={13} /> Excel
          </Btn>
        </div>
      </div>

      {/* Resumen */}
      {data && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                      gap: 10, marginBottom: 16 }}>
          <KPI label="En cache local" value={data.cache_total} />
          <KPI label="Reservas en el rango" value={data.reservas_total} />
          <KPI label="Clientes reservando" value={data.clientes_reservando} />
          <KPI label="Fantasmas (total)" value={data.fantasmas_total} accent />
          <KPI label="Verdaderos" value={data.fantasmas_verdaderos}
               accent={data.fantasmas_verdaderos > 0} />
          <KPI label="Cross-manager" value={data.fantasmas_cross_manager} />
          <KPI label="Inactivos en cache" value={data.inactivos_en_cache} />
        </div>
      )}

      {/* Aviso si hay verdaderos */}
      {data?.fantasmas_verdaderos > 0 && (
        <Card style={{ padding: 14, marginBottom: 14,
                       background: 'var(--amber-bg)', border: '1px solid var(--amber-border)' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <AlertTriangle size={18} style={{ color: 'var(--amber)', flexShrink: 0, marginTop: 2 }} />
            <div style={{ fontSize: 13, color: 'var(--text-1)', lineHeight: 1.5 }}>
              Hay <strong>{data.fantasmas_verdaderos}</strong> clientes reservando que no aparecen en
              cache de <em>ningún</em> manager. Probables causas: NoofitPro no ha vinculado al cliente
              con tu centro, cuentas mynoofit antiguas reservando, o clases de prueba abiertas al público.
              Revísalos en NoofitPro y, si son reales del centro, pide a NoofitPro que los asocie al trainer.
            </div>
          </div>
        </Card>
      )}

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%',
                                     transform: 'translateY(-50%)', color: 'var(--text-3)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)}
                 placeholder="Buscar cliente, email, DNI, actividad…"
                 style={{ width: '100%', padding: '8px 10px 8px 32px', borderRadius: 'var(--radius-sm)',
                          background: 'var(--bg-2)', border: '1px solid var(--line)',
                          color: 'var(--text-0)', fontSize: 13, outline: 'none' }} />
        </div>
        <select value={tipoFiltro} onChange={e => setTipoFiltro(e.target.value)}
                style={{ padding: '8px 10px', borderRadius: 'var(--radius-sm)',
                         background: 'var(--bg-2)', border: '1px solid var(--line)',
                         color: 'var(--text-0)', fontSize: 13 }}>
          <option value="todos">Todos</option>
          <option value="verdadero_fantasma">Verdaderos</option>
          <option value="cross_manager">Cross-manager</option>
        </select>
      </div>

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <p style={{ padding: 24, fontSize: 13, color: 'var(--text-3)' }}>Cargando datos en vivo de NoofitPro…</p>
        ) : !data || filas.length === 0 ? (
          <p style={{ padding: 24, fontSize: 13, color: 'var(--text-3)' }}>
            {!data ? 'Sin datos' : 'Sin coincidencias con los filtros actuales'}
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--bg-2)', color: 'var(--text-3)', fontSize: 11, textAlign: 'left' }}>
                  <th style={th}>Tipo</th>
                  <th style={th}>Cliente id</th>
                  <th style={th}>Nombre</th>
                  <th style={th}>Email / DNI</th>
                  <th style={th}># Reservas</th>
                  <th style={th}>Primera</th>
                  <th style={th}>Última</th>
                  <th style={th}>Actividades</th>
                  <th style={th}>Otro manager</th>
                </tr>
              </thead>
              <tbody>
                {filas.map(f => (
                  <tr key={f.cliente_id} style={{ borderTop: '1px solid var(--line)' }}>
                    <td style={td}>
                      {f.tipo === 'verdadero_fantasma'
                        ? <Badge color="amber">Verdadero</Badge>
                        : <Badge color="blue">Cross-mgr</Badge>}
                    </td>
                    <td style={{ ...td, fontFamily: 'var(--font-mono)' }}>{f.cliente_id}</td>
                    <td style={td}>{f.nombre || '—'}</td>
                    <td style={td}>
                      {f.email && <span>{f.email}</span>}
                      {f.dni && <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{f.dni}</div>}
                      {!f.email && !f.dni && '—'}
                    </td>
                    <td style={td}><strong>{f.reservas}</strong></td>
                    <td style={td}>{f.primera_fecha || '—'}</td>
                    <td style={td}>{f.ultima_fecha || '—'}</td>
                    <td style={{ ...td, maxWidth: 260, fontSize: 11, color: 'var(--text-2)' }}>
                      {(f.actividades || []).join(', ') || '—'}
                    </td>
                    <td style={td}>
                      {(f.en_otros_managers || []).map(m => m.id_manager).join(', ') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

const th = { padding: '10px 12px', fontWeight: 600, whiteSpace: 'nowrap' }
const td = { padding: '9px 12px', color: 'var(--text-1)', verticalAlign: 'top' }

function KPI({ label, value, accent }) {
  return (
    <Card style={{ padding: 12 }}>
      <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase',
                    letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700,
                    color: accent ? 'var(--amber)' : 'var(--text-0)', marginTop: 2 }}>
        {value ?? '—'}
      </div>
    </Card>
  )
}
