// Página de gestión de entradas puntuales (drop-in / pago por visita).
//   - Pendientes: reservas confirmadas en modo "por entrada" pendientes de
//     cobrar en recepción. Botón Cobrar (efectivo/TPV/tarjeta) y Anular.
//   - Por mes: entradas en modo "por mes" pendientes; botón para emitir el
//     recibo agregado del mes seleccionado.
//   - Histórico: entradas ya cobradas/facturadas.
import { useState, useEffect, useMemo } from 'react'
import { RefreshCw, Check, X, Loader2, Wallet, CalendarDays, Search } from 'lucide-react'
import { Card, Btn, Badge } from '../../components/UI'
import { useToast } from '../../components/Toast'
import { useAuth } from '../../contexts/AuthContext'
import { useCan } from '../../hooks/useCan'
import {
  getRoundIdentity, epEventosList, epCobrar, epAnular, epEmitirMes, epDetectar,
  EP_FORMAS_POR_ENTRADA,
} from '../../utils/configApi'
import { coincideTexto } from '../../utils/texto'

const TABS = [
  { id: 'pendientes', label: 'Pendientes (recepción)' },
  { id: 'por_mes',    label: 'Por mes' },
  { id: 'historico',  label: 'Histórico' },
]

function mesActual() { return new Date().toISOString().slice(0, 7) }

export default function EntradasPuntuales() {
  const toast = useToast()
  const { user } = useAuth()
  const identity = useMemo(() => getRoundIdentity(user), [user])
  // Permisos UI
  const canDetectar = useCan('entradas_puntuales.detectar_ahora')
  const canCobrar = useCan('entradas_puntuales.cobrar_recepcion')
  const canAnular = useCan('entradas_puntuales.anular_evento')
  const canEmitirMes = useCan('entradas_puntuales.emitir_mes')
  const [tab, setTab] = useState('pendientes')
  const [eventos, setEventos] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [mes, setMes] = useState(mesActual())

  async function reload() {
    if (!identity?.managerId) return
    setLoading(true)
    try {
      let params = {}
      if (tab === 'pendientes') params = { estado: 'pendiente', modo: 'por_entrada' }
      else if (tab === 'por_mes') params = { estado: 'pendiente', modo: 'por_mes' }
      else params = {}  // histórico: todos (filtramos abajo)
      const data = await epEventosList(identity, params)
      let rows = data || []
      if (tab === 'historico') rows = rows.filter(e => ['cobrado', 'facturado'].includes(e.estado))
      setEventos(rows)
    } catch (e) { toast.error(e.message) }
    setLoading(false)
  }
  useEffect(() => { reload() }, [identity?.managerId, identity?.trainerId, tab])

  const filtrados = useMemo(() => {
    if (!search) return eventos
    return eventos.filter(e =>
      coincideTexto(e.cliente_nombre || '', search) ||
      coincideTexto(String(e.cliente_idnoofit), search) ||
      coincideTexto(e.cuota_codigo || '', search) ||
      coincideTexto(e.actividad_nombre || '', search))
  }, [eventos, search])

  async function onDetectar() {
    setBusy(true)
    try {
      const r = await epDetectar(identity, 7)
      toast.success(`Detección completada: ${r.nuevas ?? 0} entradas nuevas`)
      reload()
    } catch (e) { toast.error(e.message) }
    setBusy(false)
  }

  async function onCobrar(evt, forma) {
    setBusy(true)
    try {
      await epCobrar(identity, evt.id, { forma_pago: forma })
      toast.success(`Entrada cobrada (${forma})`)
      reload()
    } catch (e) { toast.error(e.message) }
    setBusy(false)
  }

  async function onAnular(evt) {
    if (!confirm('¿Anular esta entrada? No se cobrará.')) return
    setBusy(true)
    try { await epAnular(identity, evt.id); toast.success('Entrada anulada'); reload() }
    catch (e) { toast.error(e.message) }
    setBusy(false)
  }

  async function onEmitirMes() {
    if (!confirm(`¿Emitir el recibo agregado de ${mes} para todas las entradas "por mes" pendientes?`)) return
    setBusy(true)
    try {
      const r = await epEmitirMes(identity, mes)
      const n = (r.recibos || []).filter(x => x.invoice_id).length
      toast.success(`${n} recibo${n !== 1 ? 's' : ''} emitido${n !== 1 ? 's' : ''} para ${mes}`)
      reload()
    } catch (e) { toast.error(e.message) }
    setBusy(false)
  }

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700,
                     color: 'var(--text-0)', margin: 0 }}>Entradas puntuales</h1>
        {canDetectar && (
          <Btn variant="secondary" size="sm" onClick={onDetectar} disabled={busy}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Detectar reservas
          </Btn>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
                  style={{ padding: '8px 14px', borderRadius: 'var(--radius-pill)', cursor: 'pointer',
                           fontSize: 13, fontWeight: tab === t.id ? 700 : 500,
                           background: tab === t.id ? 'var(--green-bg)' : 'var(--bg-3)',
                           border: `1px solid ${tab === t.id ? 'var(--green-border)' : 'var(--line)'}`,
                           color: tab === t.id ? 'var(--green)' : 'var(--text-2)' }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Buscador + acción mes */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%',
                                     transform: 'translateY(-50%)', color: 'var(--text-3)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)}
                 placeholder="Buscar cliente, cuota, actividad…"
                 style={{ width: '100%', padding: '8px 10px 8px 32px', borderRadius: 'var(--radius-sm)',
                          background: 'var(--bg-2)', border: '1px solid var(--line)',
                          color: 'var(--text-0)', fontSize: 13, outline: 'none' }} />
        </div>
        {tab === 'por_mes' && (
          <>
            <input type="month" value={mes} onChange={e => setMes(e.target.value)}
                   style={{ padding: '8px 10px', borderRadius: 'var(--radius-sm)',
                            background: 'var(--bg-2)', border: '1px solid var(--line)',
                            color: 'var(--text-0)', fontSize: 13 }} />
            {canEmitirMes && (
              <Btn variant="primary" size="sm" onClick={onEmitirMes} disabled={busy}>
                <CalendarDays size={13} /> Emitir mes {mes}
              </Btn>
            )}
          </>
        )}
      </div>

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <p style={{ padding: 24, color: 'var(--text-3)', fontSize: 13 }}>Cargando…</p>
        ) : filtrados.length === 0 ? (
          <p style={{ padding: 24, color: 'var(--text-3)', fontSize: 13 }}>
            {tab === 'pendientes' ? 'Sin entradas pendientes de cobro.'
              : tab === 'por_mes' ? 'Sin entradas "por mes" pendientes.'
              : 'Sin histórico.'}
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--bg-2)', color: 'var(--text-3)', fontSize: 11, textAlign: 'left' }}>
                  <th style={th}>Fecha</th>
                  <th style={th}>Cliente</th>
                  <th style={th}>Cuota / Actividad</th>
                  <th style={th}>Importe</th>
                  <th style={th}>Estado</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map(e => (
                  <tr key={e.id} style={{ borderTop: '1px solid var(--line)' }}>
                    <td style={td}>{e.fecha_clase}{e.hora_clase ? ` ${e.hora_clase}` : ''}</td>
                    <td style={td}>{e.cliente_nombre || `#${e.cliente_idnoofit}`}</td>
                    <td style={td}>
                      <strong>{e.cuota_codigo}</strong>
                      {e.actividad_nombre && <span style={{ color: 'var(--text-3)' }}> · {e.actividad_nombre}</span>}
                    </td>
                    <td style={td}>{e.precio_entrada != null ? `${Number(e.precio_entrada).toFixed(2)}€` : '—'}</td>
                    <td style={td}>
                      {e.estado === 'pendiente' ? <Badge color="amber">Pendiente</Badge>
                        : e.estado === 'cobrado' ? <Badge color="green">Cobrado</Badge>
                        : e.estado === 'facturado' ? <Badge color="blue">Facturado</Badge>
                        : <Badge color="gray">{e.estado}</Badge>}
                    </td>
                    <td style={{ ...td, whiteSpace: 'nowrap', textAlign: 'right' }}>
                      {tab === 'pendientes' && e.estado === 'pendiente' && (
                        <div style={{ display: 'inline-flex', gap: 4 }}>
                          {canCobrar && EP_FORMAS_POR_ENTRADA.map(f => (
                            <button key={f.id} disabled={busy} onClick={() => onCobrar(e, f.id)}
                                    title={`Cobrar ${f.label}`}
                                    style={{ padding: '4px 8px', borderRadius: 6, cursor: 'pointer',
                                             fontSize: 11, fontWeight: 600, color: 'var(--green)',
                                             background: 'var(--green-bg)', border: '1px solid var(--green-border)' }}>
                              <Wallet size={11} style={{ verticalAlign: 'middle' }} /> {f.label.split(' ')[0]}
                            </button>
                          ))}
                          {canAnular && (
                            <button disabled={busy} onClick={() => onAnular(e)} title="Anular"
                                    style={{ padding: '4px 8px', borderRadius: 6, cursor: 'pointer',
                                             color: 'var(--red)', background: 'transparent',
                                             border: '1px solid rgba(248,113,113,0.4)' }}>
                              <X size={11} />
                            </button>
                          )}
                        </div>
                      )}
                      {e.recibo_odoo_id && <span style={{ fontSize: 11, color: 'var(--text-3)' }}>Recibo #{e.recibo_odoo_id}</span>}
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
const td = { padding: '9px 12px', color: 'var(--text-1)' }
