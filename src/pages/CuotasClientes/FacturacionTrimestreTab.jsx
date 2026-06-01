// Wizard de facturación trimestral.
// Lista los recibos COBRADOS del trimestre que aún no se han facturado,
// permite marcar y generar facturas (account.move out_invoice) en Odoo,
// agrupando por cliente.
import { useState, useEffect } from 'react'
import { Loader2, FileText, Download, Check, AlertTriangle } from 'lucide-react'
import { Card, Btn, SectionTitle, Badge } from '../../components/UI'
import { useToast } from '../../components/Toast'
import { useCan } from '../../hooks/useCan'
import {
  facturacionTrimestrePreview, facturacionTrimestreFacturar,
} from '../../utils/cuotasApi'

const TOKEN_ENV = import.meta.env.VITE_CONFIG_API_TOKEN || ''

function currentTrimestre() {
  const d = new Date()
  const t = Math.floor(d.getMonth() / 3) + 1
  return `${d.getFullYear()}-T${t}`
}


export default function FacturacionTrimestreTab({ identity }) {
  const toast = useToast()
  // Gates UI
  const canEmitirTrim = useCan('economico.cuotas_mensuales.facturacion_trimestre_emitir')
  const canExcelTrim = useCan('economico.cuotas_mensuales.facturacion_trimestre_excel')
  const [trim, setTrim] = useState(currentTrimestre())
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [marcados, setMarcados] = useState(new Set())
  const [facturando, setFacturando] = useState(false)

  const _hdrs = () => ({
    'X-Round-Token': TOKEN_ENV,
    'X-Round-Manager-Id': String(identity?.managerId || ''),
    ...(identity?.trainerId ? { 'X-Round-Trainer-Id': String(identity.trainerId) } : {}),
  })

  async function reload() {
    if (!trim) return
    setLoading(true); setMarcados(new Set())
    try {
      const r = await facturacionTrimestrePreview(identity, trim)
      setData(r)
    } catch (e) { toast.error(`Error: ${e.message}`) }
    finally { setLoading(false) }
  }
  useEffect(() => { reload() }, [trim])

  const pendientes = (data?.recibos || []).filter(r => r.estado === 'pagado' && !r.account_move_id)

  const toggle = id => {
    setMarcados(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const marcarTodos = () => setMarcados(new Set(pendientes.map(r => r.id)))
  const desmarcarTodos = () => setMarcados(new Set())

  const importeMarcado = pendientes
    .filter(r => marcados.has(r.id))
    .reduce((s, r) => s + Number(r.importe_total || 0), 0)

  async function descargarExcel() {
    try {
      const r = await fetch(`/api/cuotas/facturacion-trimestre/${trim}/excel`,
        { headers: _hdrs() })
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `facturacion_trimestre_${trim}.xlsx`; a.click()
      URL.revokeObjectURL(url)
    } catch (e) { toast.error(e.message) }
  }

  async function facturar() {
    if (marcados.size === 0) { toast.error('Marca al menos uno'); return }
    if (!confirm(`¿Crear facturas para los ${marcados.size} recibos marcados?\n\nAgrupará por cliente.\nImporte total: ${importeMarcado.toFixed(2)} €`)) return
    setFacturando(true)
    try {
      const r = await facturacionTrimestreFacturar(identity, trim, [...marcados], true)
      toast.success(`${r.facturas_creadas} facturas creadas en Odoo`)
      reload()
    } catch (e) { toast.error(`Error: ${e.message}`) }
    finally { setFacturando(false) }
  }

  return (
    <div>
      <Card style={{ padding: 16, marginBottom: 16,
                     background: 'var(--blue-bg)', border: '1px solid var(--blue-border)' }}>
        <p style={{ fontSize: 13, margin: 0, color: 'var(--text-1)' }}>
          <strong style={{ color: 'var(--blue)' }}>Facturación trimestral</strong> — al cerrar el trimestre,
          marca los recibos cobrados que quieres convertir en factura formal en Odoo.
          Los no marcados quedan pendientes de revisión.
        </p>
      </Card>

      <Card style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Trimestre</label>
            <input type="text" value={trim} onChange={e => setTrim(e.target.value)}
                   placeholder="2026-T2" style={{
                     padding: '8px 12px', borderRadius: 'var(--radius-sm)',
                     border: '1px solid var(--line)', background: 'var(--bg-1)',
                     color: 'var(--text-0)', fontFamily: 'var(--font-mono)', fontSize: 14, width: 110,
                   }} />
          </div>
          <div style={{ flex: 1 }} />
          {canExcelTrim && (
            <Btn variant="secondary" onClick={descargarExcel} disabled={!data}>
              <Download size={14} /> Descargar Excel
            </Btn>
          )}
          {canEmitirTrim && (
            <Btn variant="primary" onClick={facturar} disabled={facturando || marcados.size === 0}>
              {facturando ? <><Loader2 size={14} className="animate-spin" /> Facturando…</> : <><FileText size={14} /> Facturar marcados ({marcados.size})</>}
            </Btn>
          )}
        </div>
      </Card>

      {/* Stats */}
      {data && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px,1fr))', gap: 12, marginBottom: 16 }}>
          <Stat label="Cobrados pendientes facturar" value={data.pagados_pendientes_facturar}
                sub={`${(data.importe_pendiente || 0).toFixed(2)} €`} color="amber" />
          <Stat label="Ya facturados" value={data.ya_facturados}
                sub={`${(data.importe_facturado || 0).toFixed(2)} €`} color="green" />
          <Stat label="Impagados" value={data.impagados}
                sub={`${(data.importe_impagado || 0).toFixed(2)} €`} color="red" />
          <Stat label="Marcados ahora" value={marcados.size}
                sub={`${importeMarcado.toFixed(2)} €`} color="blue" />
        </div>
      )}

      {/* Lista pendientes facturar */}
      <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)',
                       display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-0)', margin: 0 }}>
            Cobrados pendientes de facturar ({pendientes.length})
          </h3>
          <div style={{ display: 'flex', gap: 6 }}>
            <Btn variant="secondary" size="sm" onClick={marcarTodos}>Marcar todos</Btn>
            <Btn variant="secondary" size="sm" onClick={desmarcarTodos}>Desmarcar</Btn>
          </div>
        </div>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <Loader2 size={20} className="animate-spin" style={{ color: 'var(--green)' }} />
          </div>
        ) : pendientes.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)' }}>
            No hay recibos pendientes de facturar en {trim}.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-2)' }}>
                <th style={{ ...th, width: 36 }}><Check size={14} /></th>
                <th style={th}>Cliente</th>
                <th style={th}>Cuota</th>
                <th style={th}>Mes</th>
                <th style={th}>Método</th>
                <th style={{ ...th, textAlign: 'right' }}>Importe</th>
                <th style={th}>Fecha pago</th>
              </tr>
            </thead>
            <tbody>
              {pendientes.map(r => (
                <tr key={r.id} style={{
                  borderBottom: '1px solid var(--line)',
                  background: marcados.has(r.id) ? 'var(--green-bg)' : 'transparent',
                  cursor: 'pointer',
                }} onClick={() => toggle(r.id)}>
                  <td style={td}>
                    <input type="checkbox" checked={marcados.has(r.id)} onChange={() => {}} />
                  </td>
                  <td style={td}>{r.cliente_nombre}</td>
                  <td style={{ ...td, fontSize: 11, color: 'var(--text-2)' }}>{r.cuota_codigo}</td>
                  <td style={td}>{r.periodo}</td>
                  <td style={td}>{r.metodo_pago}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>
                    {Number(r.importe_total).toFixed(2)} €
                  </td>
                  <td style={{ ...td, fontSize: 11, color: 'var(--text-3)' }}>
                    {r.fecha_pago ? String(r.fecha_pago).slice(0, 10) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}


function Stat({ label, value, sub, color = 'green' }) {
  return (
    <Card style={{ padding: 14 }}>
      <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: `var(--${color})`, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>{sub}</div>}
    </Card>
  )
}

const th = {
  padding: '10px 14px', textAlign: 'left',
  fontSize: 11, color: 'var(--text-3)', fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: '0.04em',
}
const td = { padding: '10px 14px', color: 'var(--text-1)' }
