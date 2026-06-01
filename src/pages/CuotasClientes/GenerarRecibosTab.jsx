// Generar recibos del mes — modo α (recibo + trimestral)
// Usa endpoints v2: /api/cuotas/preemision-v2/<mes> y /api/cuotas/emitir-v2/<mes>
import { useState, useEffect } from 'react'
import { Loader2, Play, Send, ShieldCheck, Trash2, X, Download, Check } from 'lucide-react'
import { Card, Btn, SectionTitle, Badge } from '../../components/UI'
import { useToast } from '../../components/Toast'
import { useCan } from '../../hooks/useCan'
import {
  preemisionV2Generar, preemisionV2Listar, preemisionV2BorrarRecibo, emitirV2,
} from '../../utils/cuotasApi'
import RecibosManualesSection from './RecibosManualesSection'

// Por defecto en validación/emisión usamos el MES PRÓXIMO: lo habitual es
// pre-emitir recibos del mes siguiente al cierre del actual. El usuario puede
// cambiarlo a otro mes desde el selector.
function nextMonth() {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() + 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const TOKEN_ENV = import.meta.env.VITE_CONFIG_API_TOKEN || ''


export default function GenerarRecibosTab({ identity }) {
  const toast = useToast()
  // Permisos UI (admin clásico → siempre true)
  const canValidar = useCan('economico.cuotas_mensuales.validar_preemision')
  const canEditPre = useCan('economico.cuotas_mensuales.editar_preemision')
  const canBorrarPre = useCan('economico.cuotas_mensuales.borrar_preemision')
  const canEmitirMes = useCan('economico.cuotas_mensuales.emitir_mes')
  const canDescargarSepa = useCan('economico.cuotas_mensuales.descargar_sepa')
  const [mes, setMes] = useState(nextMonth())
  const [recibos, setRecibos] = useState([])
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [emitting, setEmitting] = useState(false)
  const [validResult, setValidResult] = useState(null)
  const [validating, setValidating] = useState(false)

  const _hdrs = () => ({
    'X-Round-Token': TOKEN_ENV,
    'X-Round-Manager-Id': String(identity?.managerId || ''),
    ...(identity?.trainerId ? { 'X-Round-Trainer-Id': String(identity.trainerId) } : {}),
  })

  async function reload() {
    if (!mes) return
    setLoading(true)
    try {
      const d = await preemisionV2Listar(identity, mes)
      setRecibos(d.recibos || [])
    } catch (e) { toast.error(`Error: ${e.message}`) }
    finally { setLoading(false) }
  }
  useEffect(() => { reload() }, [mes])

  async function generar() {
    if (!confirm(`¿Generar recibos para ${mes}? Se creará un recibo por cliente con cuotas activas.`)) return
    setGenerating(true)
    try {
      const r = await preemisionV2Generar(identity, mes)
      toast.success(`${r.creados} recibos creados · ${r.skipped_ya_existentes} ya existían · ${r.skipped_sin_forma_pago} sin forma de pago`)
      reload()
    } catch (e) { toast.error(`Error: ${e.message}`) }
    finally { setGenerating(false) }
  }

  async function emitir() {
    if (!confirm(`Emitir ${recibos.filter(r => r.estado === 'pagado').length} recibos pagados (crear payments en Odoo)?`)) return
    setEmitting(true)
    try {
      const r = await emitirV2(identity, mes)
      toast.success(`${r.pagos_creados} payments creados en Odoo`)
      reload()
    } catch (e) { toast.error(`Error: ${e.message}`) }
    finally { setEmitting(false) }
  }

  async function validar() {
    setValidating(true); setValidResult(null)
    try {
      const r = await fetch(`/api/cuotas/preemision/${mes}/validar`, { headers: _hdrs() })
      const d = await r.json()
      if (!d.ok) throw new Error(d.error || 'Error')
      setValidResult(d)
    } catch (e) { toast.error(e.message) }
    finally { setValidating(false) }
  }

  async function descargarSepa() {
    if (!mes) return
    try {
      const r = await fetch(`/api/cuotas/sepa/${mes}`, {
        method: 'POST', headers: _hdrs(),
      })
      const ct = r.headers.get('Content-Type') || ''
      if (!r.ok || !ct.includes('xml')) {
        let d
        try { d = await r.json() } catch { d = { error: 'fallo_desconocido' } }
        toast.error(d.detalle || d.error || `HTTP ${r.status}`)
        return
      }
      const stats = r.headers.get('X-SEPA-Stats') || ''
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      // Filename del Content-Disposition o uno genérico
      const cd = r.headers.get('Content-Disposition') || ''
      const m = /filename="([^"]+)"/.exec(cd)
      a.href = url
      a.download = m ? m[1] : `remesa_${mes}.xml`
      a.click()
      URL.revokeObjectURL(url)
      toast.success(`SEPA descargado · ${stats}`)
    } catch (e) {
      toast.error(`Error: ${e.message}`)
    }
  }

  async function descargarValidacionExcel() {
    try {
      const r = await fetch(`/api/cuotas/preemision/${mes}/validar/excel`, { headers: _hdrs() })
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `validacion_emision_${mes}.xlsx`; a.click()
      URL.revokeObjectURL(url)
    } catch (e) { toast.error(e.message) }
  }

  async function borrarRecibo(rid) {
    if (!confirm('¿Borrar este recibo?')) return
    try {
      await preemisionV2BorrarRecibo(identity, mes, rid)
      toast.success('Recibo borrado'); reload()
    } catch (e) { toast.error(`Error: ${e.message}`) }
  }

  const stats = {
    total: recibos.length,
    pagados: recibos.filter(r => r.estado === 'pagado').length,
    impagados: recibos.filter(r => r.estado === 'impagado').length,
    importeTotal: recibos.reduce((s, r) => s + Number(r.importe_total || 0), 0),
    importeCobrado: recibos.filter(r => r.estado === 'pagado').reduce((s, r) => s + Number(r.importe_total || 0), 0),
  }
  const pendientesEmision = recibos.filter(r => r.estado === 'pagado' && !r.account_payment_id).length

  return (
    <div>
      <Card style={{ padding: 16, marginBottom: 16,
                     background: 'var(--green-bg)', border: '1px solid var(--green-border)' }}>
        <p style={{ fontSize: 13, color: 'var(--text-1)', margin: 0 }}>
          <strong style={{ color: 'var(--green)' }}>Modo α</strong> — recibos mensuales + facturación trimestral.
          Los recibos se crean en BD (no son facturas todavía). Las facturas se generan trimestralmente
          en la pestaña <strong>Facturación trimestral</strong>.
        </p>
      </Card>

      <Card style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Mes a emitir</label>
            <input type="month" value={mes} onChange={e => setMes(e.target.value)}
                   style={{ padding: '8px 12px', borderRadius: 'var(--radius-sm)',
                             border: '1px solid var(--line)', background: 'var(--bg-1)',
                             color: 'var(--text-0)', fontFamily: 'var(--font-mono)', fontSize: 14 }} />
          </div>
          <div style={{ flex: 1 }} />
          {canValidar && (
            <Btn variant="secondary" onClick={validar} disabled={!mes}>
              <ShieldCheck size={14} /> Validar antes de emitir
            </Btn>
          )}
          {canEditPre && (
            <Btn variant="secondary" onClick={generar} disabled={generating || !mes}>
              {generating ? <><Loader2 size={14} className="animate-spin" /> Generando…</> : <><Play size={14} /> Generar recibos</>}
            </Btn>
          )}
          {canEmitirMes && (
            <Btn variant="primary" onClick={emitir} disabled={emitting || pendientesEmision === 0}>
              {emitting ? <><Loader2 size={14} className="animate-spin" /> Emitiendo…</> : <><Send size={14} /> Emitir ({pendientesEmision})</>}
            </Btn>
          )}
          {canDescargarSepa && (
            <Btn variant="secondary" onClick={descargarSepa} disabled={!mes}
                 title="Descarga el fichero pain.008 para subir al banco">
              <Download size={14} /> Descargar SEPA
            </Btn>
          )}
        </div>
      </Card>

      {/* Recibos manuales para incluir en esta remesa */}
      <RecibosManualesSection identity={identity} mes={mes} />

      {/* Stats */}
      {recibos.length > 0 && (
        <Card style={{ padding: 16, marginBottom: 16, display: 'grid',
                         gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
          <Stat label="Recibos del mes" value={stats.total} />
          <Stat label="Pagados (SEPA/tarjeta)" value={stats.pagados} color="green" />
          <Stat label="Impagados" value={stats.impagados} color="amber" />
          <Stat label="Importe total" value={`${stats.importeTotal.toFixed(2)} €`} />
          <Stat label="Cobrado" value={`${stats.importeCobrado.toFixed(2)} €`} color="green" />
        </Card>
      )}

      {/* Lista */}
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)' }}>
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : recibos.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)' }}>
            <p>No hay recibos para {mes}.</p>
            <p style={{ fontSize: 13 }}>Pulsa <strong>Generar recibos</strong> para emitir el mes.</p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-2)', borderBottom: '1px solid var(--line)' }}>
                <th style={th}>Cliente</th>
                <th style={th}>Cuota(s)</th>
                <th style={th}>Descuentos / mods</th>
                <th style={th}>Método</th>
                <th style={th}>Estado</th>
                <th style={{...th, textAlign: 'right'}}>Importe</th>
                <th style={th}>Pago Odoo</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {recibos.map(r => {
                const ajustes = parseAjustes(r.notas)
                return (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--line)' }}>
                  <td style={td}>{r.cliente_nombre}</td>
                  <td style={{...td, fontSize: 11, color: 'var(--text-2)'}}
                      title={r.cuota_descripcion || ''}>
                    {r.cuota_codigo}
                  </td>
                  <td style={{...td, fontSize: 11, maxWidth: 320}}>
                    {(ajustes.descuentos.length === 0 && !ajustes.modificaciones)
                      ? <span style={{ color: 'var(--text-3)' }}>—</span>
                      : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          {ajustes.descuentos.map((d, i) => (
                            <span key={i} title={d}
                                  style={{ color: 'var(--green)', fontSize: 10 }}>
                              ↓ {d}
                            </span>
                          ))}
                          {ajustes.modificaciones && (
                            <span title={ajustes.modificaciones}
                                  style={{ color: 'var(--amber)', fontSize: 10 }}>
                              ⚙ {ajustes.modificaciones.length > 60
                                  ? ajustes.modificaciones.slice(0, 60) + '…'
                                  : ajustes.modificaciones}
                            </span>
                          )}
                        </div>
                      )}
                  </td>
                  <td style={td}>{labelMetodo(r.metodo_pago)}</td>
                  <td style={td}>
                    {r.estado === 'pagado' && <Badge color="green">pagado</Badge>}
                    {r.estado === 'impagado' && <Badge color="amber">impagado</Badge>}
                    {r.estado === 'devuelto' && <Badge color="red">devuelto</Badge>}
                  </td>
                  <td style={{...td, textAlign: 'right', fontWeight: 600}}>
                    {Number(r.importe_total).toFixed(2)} €
                  </td>
                  <td style={td}>
                    {r.account_payment_id ? <Badge color="blue">#{r.account_payment_id}</Badge> : '—'}
                  </td>
                  <td style={td}>
                    {!r.account_payment_id && canBorrarPre && (
                      <button onClick={() => borrarRecibo(r.id)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red)', padding: 4 }}
                              title="Borrar recibo">
                        <Trash2 size={12} />
                      </button>
                    )}
                  </td>
                </tr>
              )})}
            </tbody>
          </table>
        )}
      </Card>

      {/* Modal validación */}
      {(validating || validResult) && (
        <ValidacionModal mes={mes} loading={validating} result={validResult}
          onClose={() => { setValidResult(null); setValidating(false) }}
          onDescargar={descargarValidacionExcel} />
      )}
    </div>
  )
}


function Stat({ label, value, color }) {
  return (
    <div style={{ padding: 12, borderRadius: 10,
                   background: color ? `var(--${color}-bg)` : 'var(--bg-2)',
                   border: `1px solid ${color ? `var(--${color}-border)` : 'var(--line)'}` }}>
      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color ? `var(--${color})` : 'var(--text-0)', marginTop: 2 }}>
        {value}
      </div>
    </div>
  )
}

function labelMetodo(m) {
  return ({ sepa: 'SEPA', tarjeta_token: 'Tarjeta', efectivo: 'Efectivo', enlace_pago: 'Enlace pago' })[m] || m
}

// Lee el campo `notas` del recibo y extrae los descuentos y modificaciones
// que se aplicaron en la emisión. Las notas vienen con el formato:
//   "Recibo unión: N sub(s) · forma_pago activa: X · descuentos: A (10€→8€), B (...)
//    · modificaciones: −5€ (descuento), +2€ (cargo_extra): cuota visita"
function parseAjustes(notas) {
  if (!notas) return { descuentos: [], modificaciones: '' }
  const out = { descuentos: [], modificaciones: '' }
  const md = notas.match(/·\s*descuentos:\s*([^·]+?)(?=\s*·|$)/i)
  if (md) {
    out.descuentos = md[1].split(/\),\s*/).map(s => s.replace(/\)$/, '').trim() + ')')
                          .map(s => s.replace(/\)\)$/, ')'))
                          .filter(Boolean)
  }
  const mm = notas.match(/·\s*modificaciones:\s*(.+?)$/i)
  if (mm) out.modificaciones = mm[1].trim()
  return out
}

const th = {
  padding: '10px 14px', textAlign: 'left',
  fontSize: 11, color: 'var(--text-3)', fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: '0.04em',
}
const td = { padding: '10px 14px', color: 'var(--text-1)' }


function ValidacionModal({ mes, loading, result, onClose, onDescargar }) {
  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }}
         style={{ position: 'fixed', inset: 0, zIndex: 1000,
                   display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
                   background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
                   overflowY: 'auto', padding: '40px 20px' }}>
      <div style={{ width: '100%', maxWidth: 700, background: 'var(--bg-2)',
                     border: '1px solid var(--line)', borderRadius: 24 }}>
        <div style={{ padding: '20px 28px', borderBottom: '1px solid var(--line)',
                       display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontFamily: 'Outfit', fontSize: 18, fontWeight: 600, margin: 0 }}>
            Validación · {mes}
          </h3>
          <button onClick={onClose} style={{ background: 'var(--bg-3)', border: '1px solid var(--line)',
                                              padding: 8, borderRadius: 10, cursor: 'pointer', color: 'var(--text-3)' }}>
            <X size={16} />
          </button>
        </div>
        <div style={{ padding: 24 }}>
          {loading ? <Loader2 size={20} className="animate-spin" /> : result && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
                <Stat label="Coherentes" value={result.coherentes} color="green" />
                <Stat label="Incoherencias" value={result.incoherencias}
                      color={result.incoherencias > 0 ? 'red' : undefined} />
              </div>
              {Object.entries(result.por_tipo || {}).map(([t, n]) => (
                <div key={t} style={{ padding: '8px 12px', background: 'var(--bg-1)',
                                        borderRadius: 8, marginBottom: 6, fontSize: 13,
                                        display: 'flex', justifyContent: 'space-between' }}>
                  <span>{t}</span><span style={{ fontWeight: 600 }}>{n}</span>
                </div>
              ))}
            </>
          )}
        </div>
        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--line)',
                       display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <Btn variant="secondary" onClick={onClose}>Cerrar</Btn>
          {result && <Btn variant="primary" onClick={onDescargar}><Download size={14} /> Descargar Excel</Btn>}
        </div>
      </div>
    </div>
  )
}
