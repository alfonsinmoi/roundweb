// Pestaña "Compras TPV" del perfil de cliente.
// Lista todas las ventas realizadas a este cliente en el TPV (Fase 5).
//
// Carga:
//   GET /api/pos/ventas?cliente_id=<id_noofit>
// Detalle al expandir una fila:
//   GET /api/pos/ventas/<id>  → cabecera + líneas
//
// Acciones disponibles inline:
//   - Reintentar sync Odoo (si sync_status='error')
//   - Anular venta (mismo endpoint que en el TPV historial)
//
// El badge sync usa los mismos estados del TPV (synced/applied_to_recibo/
// reverted/error). Aquí no editamos productos — la ficha es solo lectura
// del histórico de compras.
import { useState, useEffect, useMemo } from 'react'
import { Loader2, ShoppingBag, RefreshCw, ChevronDown, ChevronRight,
         Receipt, Tag } from 'lucide-react'
import { Card } from '../../components/UI'
import { useToast } from '../../components/Toast'
import { useAuth } from '../../contexts/AuthContext'
import { useCan } from '../../hooks/useCan'
import { getRoundIdentity } from '../../utils/configApi'
import {
  posVentasList, posVentaGet, posVentaSyncOdoo,
} from '../../utils/posApi'


const METODOS_LABEL = {
  efectivo: '💵 Efectivo',
  tarjeta: '💳 Tarjeta',
  bizum: '📱 Bizum',
  recibo_mensual: '📋 Recibo mensual',
  transferencia: '🏦 Transferencia',
  link_pago: '🔗 Link pago',
}


export default function TabComprasTPV({ cliente }) {
  const { user } = useAuth()
  const toast = useToast()
  const identity = useMemo(() => getRoundIdentity(user), [user])
  const canRetrySync = useCan('tpv.ventas.sync_odoo')
  const [ventas, setVentas] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)
  const [syncing, setSyncing] = useState(null)
  // Filtros simples
  const [filtros, setFiltros] = useState({ metodo: '', estado: '' })

  // El backend filtra por cliente_id (=id_noofit). El cliente en NoofitPro
  // suele exponer `idCliente` o `id` — lo cogemos como string.
  const idCliente = String(cliente?.idCliente ?? cliente?.id ?? '')

  const reload = async () => {
    if (!idCliente) { setLoading(false); return }
    setLoading(true)
    try {
      const r = await posVentasList(identity, { cliente_id: idCliente })
      setVentas(r)
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setLoading(false)
  }
  useEffect(() => { reload() /* eslint-disable-next-line */ }, [idCliente])

  const ventasFiltradas = useMemo(() => ventas.filter(v =>
    (!filtros.metodo || v.metodo_pago === filtros.metodo) &&
    (!filtros.estado || v.estado === filtros.estado)
  ), [ventas, filtros])

  const totalGastado = ventasFiltradas
    .filter(v => v.estado !== 'anulada')
    .reduce((s, v) => s + Number(v.total || 0), 0)

  const onRetry = async (v) => {
    setSyncing(v.id)
    try {
      const r = await posVentaSyncOdoo(identity, v.id)
      if (r.ok) toast.success('Reintentado')
      else toast.error(`Error: ${r.error}`)
      reload()
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setSyncing(null)
  }

  if (!idCliente) {
    return (
      <Card style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)' }}>
        Cliente sin id NoofitPro — no se pueden cargar compras.
      </Card>
    )
  }

  return (
    <div>
      {/* KPIs cabecera */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
                     gap: 10, marginBottom: 12 }}>
        <Stat label="Compras" v={ventasFiltradas.length} />
        <Stat label="Total gastado" v={`${totalGastado.toFixed(2)} €`}
              color="var(--green)" />
        <Stat label="Activas / anuladas"
              v={`${ventasFiltradas.filter(v => v.estado !== 'anulada').length} / ${ventasFiltradas.filter(v => v.estado === 'anulada').length}`} />
      </div>

      {/* Filtros */}
      <Card style={{ padding: 12, marginBottom: 12,
                      display: 'flex', gap: 8, flexWrap: 'wrap',
                      alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Filtros:</span>
        <select value={filtros.metodo}
                onChange={e => setFiltros(f => ({ ...f, metodo: e.target.value }))}
                style={selStyle}>
          <option value="">Todos los métodos</option>
          {Object.entries(METODOS_LABEL).map(([k, l]) =>
            <option key={k} value={k}>{l}</option>
          )}
        </select>
        <select value={filtros.estado}
                onChange={e => setFiltros(f => ({ ...f, estado: e.target.value }))}
                style={selStyle}>
          <option value="">Todos los estados</option>
          <option value="completada">Completada</option>
          <option value="anulada">Anulada</option>
        </select>
        <span style={{ flex: 1 }} />
        <button onClick={reload} style={miniBtn} title="Recargar">
          <RefreshCw size={12} />
        </button>
      </Card>

      {/* Lista */}
      <Card style={{ padding: 0 }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <Loader2 size={20} className="animate-spin"
                     style={{ color: 'var(--green)' }} />
          </div>
        ) : ventasFiltradas.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)' }}>
            <ShoppingBag size={32} style={{ opacity: 0.4 }} />
            <p style={{ marginTop: 8 }}>Sin compras registradas en el TPV.</p>
          </div>
        ) : (
          <table style={{ width: '100%', fontSize: 13 }}>
            <thead><tr style={{ color: 'var(--text-3)', fontSize: 11,
                                  textAlign: 'left' }}>
              <th style={{ padding: '8px 6px' }}></th>
              <th style={{ padding: '8px 6px' }}>Tiquet</th>
              <th style={{ padding: '8px 6px' }}>Fecha</th>
              <th style={{ padding: '8px 6px' }}>Líneas</th>
              <th style={{ padding: '8px 6px' }}>Método</th>
              <th style={{ padding: '8px 6px', textAlign: 'right' }}>Total</th>
              <th style={{ padding: '8px 6px' }}>Estado</th>
              <th style={{ padding: '8px 6px' }}>Odoo</th>
            </tr></thead>
            <tbody>
              {ventasFiltradas.map(v => (
                <VentaRow key={v.id} v={v}
                          expanded={expanded === v.id}
                          onToggle={() => setExpanded(expanded === v.id ? null : v.id)}
                          onRetry={canRetrySync ? () => onRetry(v) : null}
                          syncing={syncing === v.id}
                          identity={identity} />
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}


function VentaRow({ v, expanded, onToggle, onRetry, syncing, identity }) {
  const [detalle, setDetalle] = useState(null)
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (expanded && !detalle) {
      setLoading(true)
      posVentaGet(identity, v.id).then(d => setDetalle(d)).finally(() => setLoading(false))
    }
  }, [expanded, v.id, identity, detalle])

  const anulada = v.estado === 'anulada'
  return (
    <>
      <tr style={{ borderTop: '1px solid var(--line)',
                    background: expanded ? 'var(--bg-2)' : 'transparent',
                    cursor: 'pointer', opacity: anulada ? 0.55 : 1 }}
          onClick={onToggle}>
        <td style={{ padding: '8px 6px', width: 24 }}>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </td>
        <td style={{ padding: '8px 6px', fontFamily: 'var(--font-mono)' }}>
          {v.numero}
        </td>
        <td style={{ padding: '8px 6px' }}>
          {new Date(v.fecha).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}
        </td>
        <td style={{ padding: '8px 6px' }}>{v.num_lineas}</td>
        <td style={{ padding: '8px 6px', fontSize: 12 }}>
          {METODOS_LABEL[v.metodo_pago] || v.metodo_pago}
        </td>
        <td style={{ padding: '8px 6px', textAlign: 'right',
                      fontWeight: 700, fontFamily: 'var(--font-mono)',
                      color: anulada ? 'var(--text-3)' : 'var(--green)' }}>
          {Number(v.total).toFixed(2)}€
        </td>
        <td style={{ padding: '8px 6px' }}>
          {anulada
            ? <span style={{ color: 'var(--red)', fontSize: 11 }}>anulada</span>
            : <span style={{ color: 'var(--green)', fontSize: 11 }}>✓</span>}
        </td>
        <td style={{ padding: '8px 6px' }}>
          <OdooBadge v={v} onRetry={onRetry} syncing={syncing} />
        </td>
      </tr>
      {expanded && (
        <tr style={{ background: 'var(--bg-2)' }}>
          <td colSpan={8} style={{ padding: 14 }}>
            {loading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : detalle ? (
              <DetalleVenta venta={detalle.venta} lineas={detalle.lineas} />
            ) : (
              <span style={{ color: 'var(--text-3)' }}>No se pudo cargar.</span>
            )}
          </td>
        </tr>
      )}
    </>
  )
}


function DetalleVenta({ venta, lineas }) {
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
                     gap: 8, marginBottom: 10, fontSize: 12 }}>
        {venta.notas && (
          <div style={{ gridColumn: 'span 3', color: 'var(--text-2)' }}>
            📝 {venta.notas}
          </div>
        )}
        <div><strong>Subtotal:</strong> {Number(venta.subtotal).toFixed(2)}€</div>
        <div><strong>IVA:</strong> {Number(venta.iva).toFixed(2)}€</div>
        <div><strong>Operario:</strong> {venta.created_by || '—'}</div>
        {venta.odoo_move_id && (
          <div><strong>Move Odoo:</strong> #{venta.odoo_move_id}</div>
        )}
        {venta.recibo_id && (
          <div><Receipt size={11} style={{ verticalAlign: -1 }} /> <strong>Recibo:</strong> #{venta.recibo_id}</div>
        )}
        {venta.odoo_refund_move_id && (
          <div><strong>Refund:</strong> #{venta.odoo_refund_move_id}</div>
        )}
      </div>
      <table style={{ width: '100%', fontSize: 12 }}>
        <thead><tr style={{ color: 'var(--text-3)' }}>
          <th align="left">Producto</th>
          <th align="right">Cant</th>
          <th align="right">P. Unit</th>
          <th align="center">IVA</th>
          <th align="right">Total</th>
        </tr></thead>
        <tbody>
          {lineas.map(l => (
            <tr key={l.id} style={{ borderTop: '1px solid var(--line)' }}>
              <td style={{ padding: '4px 6px' }}>
                {l.tipo === 'descuento' &&
                  <Tag size={11} style={{ color: '#ef4444', verticalAlign: -1, marginRight: 4 }} />}
                {l.nombre}
                {l.codigo && (
                  <span style={{ color: 'var(--text-3)', fontSize: 10,
                                  marginLeft: 6, fontFamily: 'var(--font-mono)' }}>
                    {l.codigo}
                  </span>
                )}
              </td>
              <td style={{ padding: '4px 6px', textAlign: 'right' }}>{l.cantidad}</td>
              <td style={{ padding: '4px 6px', textAlign: 'right',
                            fontFamily: 'var(--font-mono)' }}>
                {Number(l.precio_unit).toFixed(2)}€
              </td>
              <td style={{ padding: '4px 6px', textAlign: 'center' }}>{l.iva_pct}%</td>
              <td style={{ padding: '4px 6px', textAlign: 'right',
                            fontFamily: 'var(--font-mono)', fontWeight: 600,
                            color: l.tipo === 'descuento' ? '#ef4444' : 'inherit' }}>
                {Number(l.total).toFixed(2)}€
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}


function OdooBadge({ v, onRetry, syncing }) {
  const s = v.sync_status || 'pending'
  if (syncing) return <Loader2 size={12} className="animate-spin" style={{ color: 'var(--text-3)' }} />
  if (s === 'synced')
    return <span title={`Move #${v.odoo_move_id}`}
                 style={{ color: 'var(--green)', fontSize: 11 }}>✓</span>
  if (s === 'applied_to_recibo')
    return <span title={`Recibo mensual #${v.recibo_id}`}
                 style={{ color: '#3b82f6', fontSize: 11 }}>📋 #{v.recibo_id}</span>
  if (s === 'reverted')
    return <span title="Anulada y revertida" style={{ color: 'var(--text-3)', fontSize: 11 }}>↩</span>
  if (s === 'skipped')
    return <span style={{ color: 'var(--text-3)', fontSize: 10 }}>—</span>
  if (s === 'error') {
    // Si no hay permiso de retry mostramos solo el indicador rojo (no botón).
    if (!onRetry) {
      return <span title={v.sync_error || 'Error de sync'}
                   style={{ color: 'var(--red)', fontSize: 11 }}>✗</span>
    }
    return (
      <button onClick={e => { e.stopPropagation(); onRetry() }}
              title={v.sync_error || 'Reintentar'}
              style={{ background: 'none', border: 'none', cursor: 'pointer',
                       color: 'var(--red)', fontSize: 11, padding: 0,
                       display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        <RefreshCw size={11} />
      </button>
    )
  }
  return <span style={{ color: 'var(--text-3)', fontSize: 10 }}>{s}</span>
}


function Stat({ label, v, color }) {
  return (
    <Card style={{ padding: 12 }}>
      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2,
                     color: color || 'var(--text-0)' }}>{v}</div>
    </Card>
  )
}

const selStyle = {
  padding: 6, borderRadius: 6, fontSize: 12,
  background: 'var(--bg-2)', border: '1px solid var(--line)',
  color: 'var(--text-0)',
}
const miniBtn = {
  padding: '6px 10px', borderRadius: 6, background: 'var(--bg-2)',
  border: '1px solid var(--line)', color: 'var(--text-2)',
  cursor: 'pointer', display: 'inline-flex', alignItems: 'center',
}
