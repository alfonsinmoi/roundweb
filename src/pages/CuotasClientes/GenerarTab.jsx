import { useState, useEffect, useMemo } from 'react'
import { Loader2, Play, Send, Download, Trash2, Edit2, Check, X, AlertTriangle, Filter, Search, ShieldCheck, FileWarning } from 'lucide-react'
import { Card, Btn, SectionTitle, Badge } from '../../components/UI'
import { useToast } from '../../components/Toast'
import {
  preemisionGenerar, preemisionListar, preemisionModificar,
  preemisionEliminar, emitirRemesa, descargarSepa,
  cuotasList, FORMA_PAGO_LABELS,
} from '../../utils/cuotasApi'

// Por defecto en validación/emisión usamos el MES PRÓXIMO (lo habitual es
// pre-emitir recibos del mes siguiente). El operador puede cambiarlo desde
// el selector.
function nextMonth() {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() + 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// "2026-05" → "2026-04"
function prevMonth(mes) {
  const [y, m] = mes.split('-').map(Number)
  const py = m === 1 ? y - 1 : y
  const pm = m === 1 ? 12 : m - 1
  return `${py}-${String(pm).padStart(2, '0')}`
}

// "2026-05" → "2025-05"
function sameMonthLastYear(mes) {
  const [y, m] = mes.split('-').map(Number)
  return `${y - 1}-${String(m).padStart(2, '0')}`
}

const EMPTY_FILTERS = {
  cliente: '', cuota: '', forma_pago: '', descuento: '',
  importeMin: '', importeMax: '',
}

export default function GenerarTab({ identity }) {
  const toast = useToast()
  const [mes, setMes] = useState(nextMonth())
  const [borradores, setBorradores] = useState([])
  const [emitidos, setEmitidos] = useState([])
  const [recibosPrev, setRecibosPrev] = useState([])      // mes anterior
  const [recibosYearAgo, setRecibosYearAgo] = useState([])// mismo mes año anterior
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [emitting, setEmitting] = useState(false)
  const [emitResult, setEmitResult] = useState(null)
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [validResult, setValidResult] = useState(null)
  const [validating, setValidating] = useState(false)

  const TOKEN = import.meta.env.VITE_CONFIG_API_TOKEN || ''
  const _hdrs = () => ({
    'X-Round-Token': TOKEN,
    'X-Round-Manager-Id': String(identity?.managerId || ''),
    ...(identity?.trainerId ? { 'X-Round-Trainer-Id': String(identity.trainerId) } : {}),
  })

  async function abrirValidacion() {
    if (!mes) return
    setValidating(true); setValidResult(null)
    try {
      const r = await fetch(`/api/cuotas/preemision/${mes}/validar`, { headers: _hdrs() })
      const d = await r.json()
      if (!d.ok) throw new Error(d.error || 'Error validando')
      setValidResult(d)
    } catch (e) { toast.error(e.message) }
    finally { setValidating(false) }
  }

  async function descargarValidacionExcel() {
    if (!mes) return
    try {
      const r = await fetch(`/api/cuotas/preemision/${mes}/validar/excel`, { headers: _hdrs() })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `validacion_emision_${mes}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) { toast.error(e.message) }
  }

  async function reload() {
    if (!mes) return
    setLoading(true)
    try {
      const [drafts, all, prev, yearAgo] = await Promise.all([
        preemisionListar(identity, mes),
        cuotasList(identity, { mes }),
        cuotasList(identity, { mes: prevMonth(mes) }).catch(() => []),
        cuotasList(identity, { mes: sameMonthLastYear(mes) }).catch(() => []),
      ])
      setBorradores(drafts || [])
      setEmitidos((all || []).filter(r => r.state === 'posted'))
      setRecibosPrev(prev || [])
      setRecibosYearAgo(yearAgo || [])
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setLoading(false)
  }

  useEffect(() => { reload() }, [mes, identity.managerId, identity.trainerId])

  async function generar() {
    if (!confirm(`¿Generar borradores de recibos para ${mes}?`)) return
    setGenerating(true)
    try {
      const r = await preemisionGenerar(identity, mes)
      const nCre = (r.creados || []).length
      const nYa  = (r.ya_emitido || []).length
      const nNa  = (r.no_aplica || []).length
      const parts = [`${nCre} creado${nCre !== 1 ? 's' : ''}`]
      if (nYa) parts.push(`${nYa} ya emitido${nYa !== 1 ? 's' : ''}`)
      if (nNa) parts.push(`${nNa} no aplica`)
      ;(nCre === 0 && nYa > 0 ? toast.warning : toast.success)(parts.join(' · '))
      await reload()
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setGenerating(false)
  }

  async function emitir() {
    if (!confirm(`¿Emitir TODOS los borradores de ${mes}? Acción no reversible.`)) return
    setEmitting(true)
    try {
      const r = await emitirRemesa(identity, mes)
      setEmitResult(r)
      toast.success(`Remesa emitida: ${r.recibos_emitidos || 0} recibos`)
      await reload()
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setEmitting(false)
  }

  async function bajarSepa() {
    if (!emitResult?.sepa_attachment_id) return
    try { await descargarSepa(identity, emitResult.sepa_attachment_id, `remesa_${mes}.xml`) }
    catch (e) { toast.error(`Error: ${e.message}`) }
  }

  // Opciones únicas para filtros
  const opcionesCuota = useMemo(() => [...new Set(borradores.map(b => b.cuota_codigo).filter(Boolean))].sort(), [borradores])
  const opcionesForma = useMemo(() => [...new Set(borradores.map(b => b.forma_pago).filter(Boolean))].sort(), [borradores])
  const opcionesDesc = useMemo(() => {
    const s = new Set()
    borradores.forEach(b => (b.descuentos_aplicados || []).forEach(d => s.add(d.codigo)))
    return [...s].sort()
  }, [borradores])

  // Borradores filtrados
  const filtered = useMemo(() => {
    return borradores.filter(b => {
      if (filters.cliente) {
        const q = filters.cliente.toLowerCase()
        const name = (b.partner_id?.name || '').toLowerCase()
        if (!name.includes(q)) return false
      }
      if (filters.cuota && b.cuota_codigo !== filters.cuota) return false
      if (filters.forma_pago && b.forma_pago !== filters.forma_pago) return false
      if (filters.descuento) {
        const has = (b.descuentos_aplicados || []).some(d => d.codigo === filters.descuento)
        if (!has) return false
      }
      if (filters.importeMin && b.amount_total < parseFloat(filters.importeMin)) return false
      if (filters.importeMax && b.amount_total > parseFloat(filters.importeMax)) return false
      return true
    })
  }, [borradores, filters])

  // Stats agregadas (sobre filtered)
  const stats = useMemo(() => computeStats(filtered), [filtered])
  const statsPrev = useMemo(() => computeStats(recibosPrev), [recibosPrev])
  const statsYearAgo = useMemo(() => computeStats(recibosYearAgo), [recibosYearAgo])

  return (
    <div>
      {/* Selector mes + acciones */}
      <Card style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Mes de referencia</label>
            <input type="month" value={mes} onChange={e => setMes(e.target.value)}
                   style={{
                     padding: '8px 12px', borderRadius: 'var(--radius-sm)',
                     border: '1px solid var(--line)', background: 'var(--bg-1)',
                     color: 'var(--text-0)', fontFamily: 'var(--font-mono)', fontSize: 14,
                   }} />
          </div>
          <div style={{ flex: 1 }} />
          <Btn variant="secondary" onClick={() => abrirValidacion()} disabled={!mes}>
            <ShieldCheck size={14} /> Validar antes de emitir
          </Btn>
          <Btn variant="secondary" onClick={generar} disabled={generating || !mes}>
            {generating ? <><Loader2 size={14} className="animate-spin" /> Generando…</> : <><Play size={14} /> Generar borradores</>}
          </Btn>
          <Btn variant="primary" onClick={emitir} disabled={emitting || borradores.length === 0}>
            {emitting ? <><Loader2 size={14} className="animate-spin" /> Emitiendo…</> : <><Send size={14} /> Emitir remesa ({borradores.length})</>}
          </Btn>
          {emitResult?.sepa_attachment_id && (
            <Btn variant="primary" onClick={bajarSepa}><Download size={14} /> Descargar SEPA</Btn>
          )}
        </div>
      </Card>

      {/* Stats agregadas */}
      {borradores.length > 0 && <StatsPanel
        stats={stats} statsPrev={statsPrev} statsYearAgo={statsYearAgo}
        labelMes={mes} labelPrev={prevMonth(mes)} labelYearAgo={sameMonthLastYear(mes)}
        filteredCount={filtered.length} totalCount={borradores.length} />}

      {/* Filtros */}
      {borradores.length > 0 && (
        <Card style={{ padding: 16, marginTop: 16, marginBottom: 16 }}>
          <SectionTitle action={
            <Btn size="sm" variant="secondary" onClick={() => setFilters(EMPTY_FILTERS)}>
              <X size={12} /> Limpiar
            </Btn>
          }>
            <Filter size={14} style={{ marginRight: 6 }} /> Filtros
          </SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginTop: 10 }}>
            <Field label="Cliente">
              <div style={{ position: 'relative' }}>
                <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }} />
                <input value={filters.cliente} onChange={e => setFilters(f => ({ ...f, cliente: e.target.value }))}
                       placeholder="nombre…" style={{ ...inputStyle, paddingLeft: 26 }} />
              </div>
            </Field>
            <Field label="Cuota">
              <select value={filters.cuota} onChange={e => setFilters(f => ({ ...f, cuota: e.target.value }))} style={inputStyle}>
                <option value="">Todas</option>
                {opcionesCuota.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Forma pago">
              <select value={filters.forma_pago} onChange={e => setFilters(f => ({ ...f, forma_pago: e.target.value }))} style={inputStyle}>
                <option value="">Todas</option>
                {opcionesForma.map(f => <option key={f} value={f}>{FORMA_PAGO_LABELS[f] || f}</option>)}
              </select>
            </Field>
            <Field label="Descuento">
              <select value={filters.descuento} onChange={e => setFilters(f => ({ ...f, descuento: e.target.value }))} style={inputStyle}>
                <option value="">Todos</option>
                {opcionesDesc.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
            <Field label="Importe min">
              <input type="number" step="0.01" value={filters.importeMin}
                     onChange={e => setFilters(f => ({ ...f, importeMin: e.target.value }))}
                     placeholder="0,00" style={inputStyle} />
            </Field>
            <Field label="Importe max">
              <input type="number" step="0.01" value={filters.importeMax}
                     onChange={e => setFilters(f => ({ ...f, importeMax: e.target.value }))}
                     placeholder="∞" style={inputStyle} />
            </Field>
          </div>
        </Card>
      )}

      {/* Lista de borradores */}
      <Card style={{ padding: 20 }}>
        <SectionTitle>
          Borradores pendientes de emitir · {filtered.length}
          {filtered.length !== borradores.length && <span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 400, marginLeft: 8 }}>de {borradores.length}</span>}
        </SectionTitle>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
            <Loader2 size={20} className="animate-spin" style={{ color: 'var(--green)' }} />
          </div>
        ) : borradores.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-3)' }}>
            <AlertTriangle size={32} style={{ opacity: 0.4, marginBottom: 8 }} />
            <p style={{ fontSize: 13, margin: 0 }}>
              No hay borradores pendientes para este mes. {emitidos.length > 0 && (
                <>Ya hay <strong style={{ color: 'var(--text-1)' }}>{emitidos.length}</strong> recibo{emitidos.length !== 1 ? 's' : ''} emitido{emitidos.length !== 1 ? 's' : ''} (ver abajo).</>
              )}
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-3)', textAlign: 'center', padding: 32 }}>
            Ningún borrador coincide con los filtros aplicados.
          </p>
        ) : (
          <BorradoresTable borradores={filtered} identity={identity} onChange={reload} />
        )}
      </Card>

      {emitidos.length > 0 && (
        <Card style={{ padding: 20, marginTop: 16 }}>
          <SectionTitle>Recibos ya emitidos en {mes} · {emitidos.length}</SectionTitle>
          <EmitidosTable recibos={emitidos} />
        </Card>
      )}

      {/* Modal validación */}
      {(validating || validResult) && (
        <ValidacionModal
          mes={mes}
          loading={validating}
          result={validResult}
          onClose={() => { setValidResult(null); setValidating(false) }}
          onDescargar={descargarValidacionExcel}
        />
      )}
    </div>
  )
}


function ValidacionModal({ mes, loading, result, onClose, onDescargar }) {
  return (
    <div role="dialog" aria-modal="true"
         onClick={e => { if (e.target === e.currentTarget) onClose() }}
         style={{
           position: 'fixed', inset: 0, zIndex: 1000,
           display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
           background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
           overflowY: 'auto', padding: '40px 20px',
         }}>
      <div style={{
        width: '100%', maxWidth: 700, background: 'var(--bg-2)',
        border: '1px solid var(--line)', borderRadius: 24,
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: '24px 32px', borderBottom: '1px solid var(--line)',
                       display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontFamily: 'Outfit', fontSize: 20, fontWeight: 600, color: 'var(--text-0)' }}>
            Validación pre-emisión · {mes}
          </h3>
          <button onClick={onClose} aria-label="Cerrar" style={{
            padding: 10, borderRadius: 12, cursor: 'pointer',
            background: 'var(--bg-3)', border: '1px solid var(--line)',
            color: 'var(--text-3)',
          }}><X size={18} /></button>
        </div>

        <div style={{ padding: 24 }}>
          {loading && (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)' }}>
              <Loader2 size={20} className="animate-spin" />
              <p style={{ marginTop: 8 }}>Validando…</p>
            </div>
          )}
          {result && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
                <div style={{ padding: 16, borderRadius: 12, background: 'var(--green-bg)',
                                border: '1px solid var(--green-border)' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Coherentes (OK)</div>
                  <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--green)' }}>
                    {result.coherentes}
                  </div>
                </div>
                <div style={{ padding: 16, borderRadius: 12,
                                background: result.incoherencias > 0 ? 'var(--red-bg)' : 'var(--bg-3)',
                                border: `1px solid ${result.incoherencias > 0 ? 'var(--red-border)' : 'var(--line)'}` }}>
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Incoherencias</div>
                  <div style={{ fontSize: 32, fontWeight: 700, color: result.incoherencias > 0 ? 'var(--red)' : 'var(--text-3)' }}>
                    {result.incoherencias}
                  </div>
                </div>
              </div>

              {result.incoherencias > 0 && (
                <>
                  <h4 style={{ fontSize: 14, color: 'var(--text-1)', marginBottom: 10 }}>Por tipo:</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
                    {Object.entries(result.por_tipo || {}).map(([tipo, n]) => (
                      <div key={tipo} style={{ padding: '10px 14px', background: 'var(--bg-1)',
                                                 borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
                        <FileWarning size={14} style={{ color: 'var(--amber)' }} />
                        <strong style={{ fontSize: 13, color: 'var(--text-1)' }}>{tipo}</strong>
                        <span style={{ marginLeft: 'auto', color: 'var(--text-2)' }}>{n}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <p style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 16 }}>
                Descarga el Excel para ver el detalle de cada incoherencia + propuesta de solución y la lista
                completa de los OK.
              </p>
            </>
          )}
        </div>

        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--line)',
                       display: 'flex', gap: 10, justifyContent: 'flex-end',
                       background: 'var(--bg-2)' }}>
          <Btn variant="secondary" onClick={onClose}>Cerrar</Btn>
          {result && (
            <Btn variant="primary" onClick={onDescargar}>
              <Download size={14} /> Descargar Excel
            </Btn>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Stats agregadas ─────────────────────────────────────────────────────────

function computeStats(rows) {
  let total = 0
  const porCuota = {}
  const porFormaPago = {}
  const porPeriodicidad = {}
  const descuentos = {}        // codigo → { count, importe }
  const modificaciones = {}    // tipo → { count, importe }

  for (const r of rows) {
    total += r.amount_total || 0
    const ck = r.cuota_codigo || '—'
    porCuota[ck] = porCuota[ck] || { count: 0, importe: 0 }
    porCuota[ck].count++
    porCuota[ck].importe += r.amount_total || 0

    const fk = r.forma_pago || '—'
    porFormaPago[fk] = porFormaPago[fk] || { count: 0, importe: 0 }
    porFormaPago[fk].count++
    porFormaPago[fk].importe += r.amount_total || 0

    const pk = r.periodicidad || 'mensual'
    porPeriodicidad[pk] = porPeriodicidad[pk] || { count: 0, importe: 0 }
    porPeriodicidad[pk].count++
    porPeriodicidad[pk].importe += r.amount_total || 0

    for (const d of r.descuentos_aplicados || []) {
      const k = d.codigo
      descuentos[k] = descuentos[k] || { codigo: k, descripcion: d.descripcion, count: 0, importe: 0 }
      descuentos[k].count++
      descuentos[k].importe += d.importe || 0
    }
    for (const m of r.modificaciones_aplicadas || []) {
      const k = m.tipo
      modificaciones[k] = modificaciones[k] || { tipo: k, count: 0, importe: 0 }
      modificaciones[k].count++
      modificaciones[k].importe += m.importe || 0
    }
  }
  return {
    total,
    count: rows.length,
    porCuota: Object.entries(porCuota).map(([k, v]) => ({ key: k, ...v })),
    porFormaPago: Object.entries(porFormaPago).map(([k, v]) => ({ key: k, ...v })),
    porPeriodicidad: Object.entries(porPeriodicidad).map(([k, v]) => ({ key: k, ...v })),
    descuentos: Object.values(descuentos),
    modificaciones: Object.values(modificaciones),
  }
}

const PERIODICIDAD_LABELS = {
  mensual: 'Mensual', bimensual: 'Bimensual', trimestral: 'Trimestral',
  semestral: 'Semestral', anual: 'Anual',
}

const TIPO_MOD_LABELS = {
  descuento: 'Descuento puntual',
  cargo_extra: 'Cargo extra',
  precio_alternativo: 'Precio alternativo',
}

function StatsPanel({ stats, statsPrev, statsYearAgo, labelMes, labelPrev, labelYearAgo, filteredCount, totalCount }) {
  const totalDesc = stats.descuentos.reduce((s, d) => s + d.importe, 0)
  const totalDescPrev = statsPrev.descuentos.reduce((s, d) => s + d.importe, 0)
  const totalDescYA = statsYearAgo.descuentos.reduce((s, d) => s + d.importe, 0)
  const totalMod = stats.modificaciones.reduce((s, m) => s + m.importe, 0)
  const totalModPrev = statsPrev.modificaciones.reduce((s, m) => s + m.importe, 0)
  const totalModYA = statsYearAgo.modificaciones.reduce((s, m) => s + m.importe, 0)

  return (
    <Card style={{ padding: 20 }}>
      <SectionTitle>
        Resumen de remesa · {labelMes}
        {filteredCount !== totalCount && <span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 400, marginLeft: 8 }}>(filtrado: {filteredCount}/{totalCount})</span>}
      </SectionTitle>

      {/* Totales con comparativa */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginTop: 12 }}>
        <BigStat label="Importe total a emitir" color="var(--green)"
                 actual={stats.total} prev={statsPrev.total} yearAgo={statsYearAgo.total}
                 fmt={v => `${v.toFixed(2)} €`} />
        <BigStat label="Recibos"
                 actual={filteredCount} prev={statsPrev.count} yearAgo={statsYearAgo.count}
                 fmt={v => v} />
        <BigStat label="Total descuentos (no cobrado)" color="var(--amber)"
                 actual={totalDesc} prev={totalDescPrev} yearAgo={totalDescYA}
                 fmt={v => `-${v.toFixed(2)} €`} />
        <BigStat label="Total modificaciones"
                 actual={totalMod} prev={totalModPrev} yearAgo={totalModYA}
                 fmt={v => `${v >= 0 ? '+' : ''}${v.toFixed(2)} €`}
                 colorFn={v => v < 0 ? 'var(--red)' : v > 0 ? 'var(--blue)' : 'var(--text-0)'} />
      </div>

      {/* Sub-tablas con columnas comparativas */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 24, marginTop: 20 }}>
        <MiniTable title="Por cuota" labelPrev={labelPrev} labelYearAgo={labelYearAgo}
                   rows={mergeRows(stats.porCuota, statsPrev.porCuota, statsYearAgo.porCuota,
                     'key', x => ({ label: x.key }))} />
        <MiniTable title="Por forma de pago" labelPrev={labelPrev} labelYearAgo={labelYearAgo}
                   rows={mergeRows(stats.porFormaPago, statsPrev.porFormaPago, statsYearAgo.porFormaPago,
                     'key', x => ({ label: FORMA_PAGO_LABELS[x.key] || x.key }))} />
        <MiniTable title="Por periodicidad" labelPrev={labelPrev} labelYearAgo={labelYearAgo}
                   rows={mergeRows(stats.porPeriodicidad, statsPrev.porPeriodicidad, statsYearAgo.porPeriodicidad,
                     'key', x => ({ label: PERIODICIDAD_LABELS[x.key] || x.key }))} />
        <MiniTable title="Descuentos aplicados (no cobrado)"
                   labelPrev={labelPrev} labelYearAgo={labelYearAgo}
                   empty="Sin descuentos en estos recibos"
                   negative
                   rows={mergeRows(stats.descuentos, statsPrev.descuentos, statsYearAgo.descuentos,
                     'codigo', x => ({ label: x.codigo, sub: x.descripcion !== x.codigo ? x.descripcion : null }))} />
        <MiniTable title="Modificaciones (no cobrado / extra)"
                   labelPrev={labelPrev} labelYearAgo={labelYearAgo}
                   empty="Sin modificaciones en estos recibos"
                   signed
                   rows={mergeRows(stats.modificaciones, statsPrev.modificaciones, statsYearAgo.modificaciones,
                     'tipo', x => ({ label: TIPO_MOD_LABELS[x.tipo] || x.tipo }))} />
      </div>
    </Card>
  )
}

// Une 3 listas (actual, prev, yearAgo) por una clave y devuelve filas con los 3 valores
function mergeRows(actual, prev, yearAgo, keyField, decorate) {
  const map = new Map()
  for (const r of actual) {
    map.set(r[keyField], { ...decorate(r), count: r.count, importe: r.importe, prev: 0, yearAgo: 0 })
  }
  for (const r of prev) {
    const k = r[keyField]
    if (map.has(k)) map.get(k).prev = r.importe
    else map.set(k, { ...decorate(r), count: 0, importe: 0, prev: r.importe, yearAgo: 0 })
  }
  for (const r of yearAgo) {
    const k = r[keyField]
    if (map.has(k)) map.get(k).yearAgo = r.importe
    else map.set(k, { ...decorate(r), count: 0, importe: 0, prev: 0, yearAgo: r.importe })
  }
  return [...map.values()].sort((a, b) => Math.abs(b.importe) - Math.abs(a.importe))
}

function BigStat({ label, color, colorFn, actual, prev, yearAgo, fmt }) {
  const c = colorFn ? colorFn(actual) : color
  return (
    <div style={{
      padding: 12, borderRadius: 'var(--radius-sm)',
      background: 'var(--bg-1)', border: '1px solid var(--line)',
    }}>
      <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-mono)', color: c || 'var(--text-0)', marginTop: 4 }}>{fmt(actual)}</div>
      <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>
        <span title="Mes anterior">m-1: <strong style={{ color: 'var(--text-2)' }}>{fmt(prev)}</strong></span>
        <span title="Mismo mes año anterior">a-1: <strong style={{ color: 'var(--text-2)' }}>{fmt(yearAgo)}</strong></span>
      </div>
    </div>
  )
}

function MiniTable({ title, labelPrev, labelYearAgo, rows, empty, negative, signed }) {
  const fmtImporte = v => {
    if (negative) return `-${v.toFixed(2)} €`
    if (signed)   return `${v >= 0 ? '+' : ''}${v.toFixed(2)} €`
    return `${v.toFixed(2)} €`
  }
  const colorFor = v => {
    if (negative) return 'var(--amber)'
    if (signed)   return v < 0 ? 'var(--red)' : v > 0 ? 'var(--blue)' : 'var(--text-1)'
    return 'var(--text-1)'
  }
  return (
    <div>
      <h4 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 8px' }}>{title}</h4>
      {rows.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--text-3)', fontStyle: 'italic', margin: 0 }}>{empty || 'Sin datos'}</p>
      ) : (
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--line)' }}>
              <th style={thS}>&nbsp;</th>
              <th style={{ ...thS, textAlign: 'right' }}>Actual</th>
              <th style={{ ...thS, textAlign: 'right' }} title={labelPrev}>m-1</th>
              <th style={{ ...thS, textAlign: 'right' }} title={labelYearAgo}>a-1</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--line)' }}>
                <td style={{ padding: '6px 0' }}>
                  <div style={{ color: 'var(--text-1)', fontWeight: 500 }}>{r.label}</div>
                  {r.sub && <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{r.sub}</div>}
                  <div style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>{r.count} ×</div>
                </td>
                <td style={{ padding: '6px 4px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, color: colorFor(r.importe), whiteSpace: 'nowrap' }}>{fmtImporte(r.importe)}</td>
                <td style={{ padding: '6px 4px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{r.prev ? fmtImporte(r.prev) : '—'}</td>
                <td style={{ padding: '6px 4px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{r.yearAgo ? fmtImporte(r.yearAgo) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

const thS = { padding: '4px 0', fontSize: 10, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'left' }

function Field({ label, children }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  )
}

// ── Tablas ──────────────────────────────────────────────────────────────────

function BorradoresTable({ borradores, identity, onChange }) {
  return (
    <div style={{ width: '100%' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--line)', textAlign: 'left' }}>
            <Th>Cliente</Th>
            <Th>Cuota</Th>
            <Th>Periodicidad</Th>
            <Th>Tipo</Th>
            <Th>Importe</Th>
            <Th>Forma pago</Th>
            <Th>Vencimiento</Th>
            <Th>Descuentos</Th>
            <Th>Modificaciones</Th>
            <Th>Notas</Th>
            <Th></Th>
          </tr>
        </thead>
        <tbody>
          {borradores.map(b => <BorradorRow key={b.id} b={b} identity={identity} onChange={onChange} />)}
        </tbody>
      </table>
    </div>
  )
}

function BorradorRow({ b, identity, onChange }) {
  const toast = useToast()
  const [editing, setEditing] = useState(false)

  async function eliminar() {
    if (!confirm('¿Eliminar este borrador?')) return
    try {
      await preemisionEliminar(identity, b.id)
      toast.success('Borrador eliminado')
      onChange()
    } catch (e) { toast.error(`Error: ${e.message}`) }
  }

  const descs = b.descuentos_aplicados || []
  const mods = b.modificaciones_aplicadas || []
  const partnerName = b.partner_id?.name || `#${b.partner_id?.id}`
  const descsTip = descs.length === 0 ? '' : descs.map(d => `${d.codigo}${d.descripcion && d.descripcion !== d.codigo ? ` (${d.descripcion})` : ''}: -${d.importe.toFixed(2)} €`).join('\n')
  const modsTip = mods.length === 0 ? '' : mods.map(m => `${TIPO_MOD_LABELS[m.tipo] || m.tipo}: ${m.importe >= 0 ? '+' : ''}${m.importe.toFixed(2)} €${m.razon ? ` — ${m.razon}` : ''}`).join('\n')

  return (
    <>
      <tr>
        <Td title={partnerName}>{partnerName}</Td>
        <Td>{b.cuota_codigo || '—'}</Td>
        <Td>{PERIODICIDAD_LABELS[b.periodicidad] || b.periodicidad || '—'}</Td>
        <Td>
          <span style={{
            fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999,
            background: b.tipo === 'alta' ? 'rgba(45,212,168,0.12)' : 'var(--bg-3)',
            color: b.tipo === 'alta' ? 'var(--green)' : 'var(--text-2)',
          }}>{b.tipo === 'alta' ? 'Alta' : 'Mens.'}</span>
        </Td>
        <Td mono style={{ fontWeight: 600 }}>{b.amount_total?.toFixed(2)} €</Td>
        <Td title={FORMA_PAGO_LABELS[b.forma_pago] || b.forma_pago}>
          {FORMA_PAGO_LABELS[b.forma_pago] || b.forma_pago || '—'}
        </Td>
        <Td mono>{b.invoice_date_due || '—'}</Td>
        <Td wrap title={descsTip} style={{ fontSize: 11 }}>
          {descs.length === 0 ? <span style={{ color: 'var(--text-3)' }}>—</span> : descs.map((d, i) => (
            <div key={i} style={{ marginBottom: 2 }}>
              <span style={{ color: 'var(--amber)', fontWeight: 600 }}>-{d.importe.toFixed(2)} €</span>
              <span style={{ color: 'var(--text-3)', marginLeft: 4 }}>{d.codigo}</span>
            </div>
          ))}
        </Td>
        <Td wrap title={modsTip} style={{ fontSize: 11 }}>
          {mods.length === 0 ? <span style={{ color: 'var(--text-3)' }}>—</span> : mods.map((m, i) => (
            <div key={i} style={{ marginBottom: 2 }}>
              <span style={{ color: m.importe < 0 ? 'var(--red)' : 'var(--blue)', fontWeight: 600 }}>
                {m.importe >= 0 ? '+' : ''}{m.importe.toFixed(2)} €
              </span>
              <span style={{ color: 'var(--text-3)', marginLeft: 4 }}>{TIPO_MOD_LABELS[m.tipo] || m.tipo}</span>
            </div>
          ))}
        </Td>
        <Td wrap title={b.narration || ''} style={{ fontSize: 11, color: 'var(--text-3)' }}>
          {b.narration || '—'}
        </Td>
        <Td>
          <div style={{ display: 'flex', gap: 4 }}>
            <Btn size="sm" variant="secondary" onClick={() => setEditing(e => !e)}>
              {editing ? <X size={12} /> : <Edit2 size={12} />}
            </Btn>
            <Btn size="sm" variant="secondary" onClick={eliminar}><Trash2 size={12} /></Btn>
          </div>
        </Td>
      </tr>
      {editing && (
        <tr>
          <td colSpan={11} style={{ padding: 0, background: 'var(--bg-1)' }}>
            <BorradorEditor b={b} identity={identity}
                            onClose={() => setEditing(false)}
                            onSaved={() => { setEditing(false); onChange() }} />
          </td>
        </tr>
      )}
    </>
  )
}

// ── Editor expandido para un borrador ──────────────────────────────────────
function BorradorEditor({ b, identity, onClose, onSaved }) {
  const toast = useToast()
  const [saving, setSaving] = useState(false)

  // Datos editables generales
  const [precio, setPrecio] = useState(b.amount_total)
  const [overridePrecio, setOverridePrecio] = useState(false)
  const [vencimiento, setVencimiento] = useState(b.invoice_date_due || '')
  const [narration, setNarration] = useState(b.narration || '')

  // Descuentos: lista de IDs (catálogo) seleccionados actualmente
  const [descuentoIds, setDescuentoIds] = useState(() => (b.descuentos_aplicados || []).map(d => null)) // se rellena al cargar catálogo
  const [catalogoDesc, setCatalogoDesc] = useState([])

  // Modificaciones nuevas a añadir en este guardado
  const [modsNuevas, setModsNuevas] = useState([]) // [{tipo, valor, razon, fecha_desde, fecha_hasta}]

  // Cargar catálogo descuentos al montar
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const { descuentosList } = await import('../../utils/configApi')
        const data = await descuentosList(identity)
        if (!alive) return
        setCatalogoDesc(data || [])
        // Match descuentos aplicados → ids del catálogo via codigo
        const codigosAplicados = (b.descuentos_aplicados || []).map(d => d.codigo)
        const ids = (data || [])
          .filter(d => codigosAplicados.includes(d.codigo))
          .map(d => d.id)
        setDescuentoIds(ids)
      } catch (e) { toast.error(`Error catálogo: ${e.message}`) }
    })()
    return () => { alive = false }
  }, [b.id])

  function toggleDescuento(id) {
    setDescuentoIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }
  function addModNueva() {
    setModsNuevas(prev => [...prev, { tipo: 'descuento', valor: '', razon: '', fecha_desde: b.invoice_date || '', fecha_hasta: '' }])
  }
  function updateModNueva(i, field, val) {
    setModsNuevas(prev => prev.map((m, idx) => idx === i ? { ...m, [field]: val } : m))
  }
  function removeModNueva(i) {
    setModsNuevas(prev => prev.filter((_, idx) => idx !== i))
  }

  async function save() {
    setSaving(true)
    try {
      const payload = {
        invoice_date_due: vencimiento || undefined,
        narration,
        descuento_ids: descuentoIds,
        modificaciones_nuevas: modsNuevas
          .filter(m => m.valor !== '' && parseFloat(m.valor) >= 0)
          .map(m => ({ ...m, valor: parseFloat(m.valor) })),
      }
      if (overridePrecio) payload.precio = parseFloat(precio)
      await preemisionModificar(identity, b.id, payload)
      toast.success('Borrador actualizado, importe recalculado')
      onSaved()
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setSaving(false)
  }

  return (
    <div style={{ padding: 16, borderTop: '2px solid var(--green)', borderBottom: '1px solid var(--line)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        {/* Bloque 1: campos generales */}
        <div>
          <h4 style={titleStyle}>General</h4>
          <Field label="Vencimiento">
            <input type="date" value={vencimiento} onChange={e => setVencimiento(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="Notas">
            <textarea value={narration} onChange={e => setNarration(e.target.value)} rows={3}
                      style={{ ...inputStyle, resize: 'vertical' }} />
          </Field>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-2)', marginTop: 8 }}>
            <input type="checkbox" checked={overridePrecio} onChange={e => setOverridePrecio(e.target.checked)} />
            Forzar importe manual (ignora cálculo)
          </label>
          {overridePrecio && (
            <Field label="Importe forzado (€)">
              <input type="number" step="0.01" value={precio}
                     onChange={e => setPrecio(e.target.value)} style={inputStyle} />
            </Field>
          )}
        </div>

        {/* Bloque 2: descuentos */}
        <div>
          <h4 style={titleStyle}>Descuentos del catálogo aplicados al cliente</h4>
          {catalogoDesc.length === 0 ? (
            <p style={{ fontSize: 11, color: 'var(--text-3)' }}>Cargando catálogo…</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto' }}>
              {catalogoDesc.map(d => {
                const checked = descuentoIds.includes(d.id)
                return (
                  <label key={d.id} style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
                    background: checked ? 'rgba(251,191,36,0.08)' : 'var(--bg-2)',
                    borderRadius: 6, cursor: 'pointer', fontSize: 12,
                    border: `1px solid ${checked ? 'rgba(251,191,36,0.3)' : 'var(--line)'}`,
                  }}>
                    <input type="checkbox" checked={checked}
                           onChange={() => toggleDescuento(d.id)} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: 'var(--text-1)' }}>{d.codigo}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{d.descripcion || ''}</div>
                    </div>
                    <span style={{ color: 'var(--amber)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                      {d.tipo === 'porcentaje' ? `-${d.valor}%` : `-${d.valor}€`}
                    </span>
                  </label>
                )
              })}
            </div>
          )}
          <p style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 6 }}>
            Marcar/desmarcar afecta a la suscripción del cliente y a futuros recibos.
          </p>
        </div>

        {/* Bloque 3: modificaciones */}
        <div>
          <h4 style={titleStyle}>Modificaciones puntuales</h4>
          {modsNuevas.length === 0 && (
            <p style={{ fontSize: 11, color: 'var(--text-3)', fontStyle: 'italic' }}>
              Sin modificaciones nuevas. Añade una para aplicar un descuento puntual, cargo extra o precio alternativo solo a este recibo (o periodo).
            </p>
          )}
          {modsNuevas.map((m, i) => (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: '1fr 90px auto', gap: 6,
              padding: 8, background: 'var(--bg-2)', border: '1px solid var(--line)',
              borderRadius: 6, marginBottom: 6,
            }}>
              <select value={m.tipo} onChange={e => updateModNueva(i, 'tipo', e.target.value)} style={inputStyle}>
                <option value="descuento">Descuento (resta)</option>
                <option value="cargo_extra">Cargo extra (suma)</option>
                <option value="precio_alternativo">Precio alternativo (sustituye)</option>
              </select>
              <input type="number" step="0.01" value={m.valor}
                     onChange={e => updateModNueva(i, 'valor', e.target.value)}
                     placeholder="€" style={inputStyle} />
              <Btn size="sm" variant="secondary" onClick={() => removeModNueva(i)}>
                <X size={12} />
              </Btn>
              <input type="text" value={m.razon} onChange={e => updateModNueva(i, 'razon', e.target.value)}
                     placeholder="Razón / observación" style={{ ...inputStyle, gridColumn: '1 / 4' }} />
            </div>
          ))}
          <Btn size="sm" variant="secondary" onClick={addModNueva}>
            <Edit2 size={12} /> Añadir modificación
          </Btn>
        </div>
      </div>

      {/* Acciones */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
        <Btn variant="secondary" onClick={onClose}>Cancelar</Btn>
        <Btn variant="primary" onClick={save} disabled={saving}>
          {saving ? <><Loader2 size={14} className="animate-spin" /> Guardando…</> : <><Check size={14} /> Guardar y recalcular</>}
        </Btn>
      </div>
    </div>
  )
}

const titleStyle = {
  fontSize: 11, fontWeight: 600, color: 'var(--text-2)',
  textTransform: 'uppercase', letterSpacing: '0.05em',
  margin: '0 0 8px',
}

function EmitidosTable({ recibos }) {
  return (
    <div style={{ width: '100%' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--line)', textAlign: 'left' }}>
            <Th>Cliente</Th>
            <Th>Cuota</Th>
            <Th>Periodicidad</Th>
            <Th>Importe</Th>
            <Th>Forma pago</Th>
            <Th>Día emisión</Th>
            <Th>Vencimiento</Th>
            <Th>Estado pago</Th>
          </tr>
        </thead>
        <tbody>
          {recibos.map(r => {
            const sc = r.payment_state === 'paid' ? 'green'
                    : r.payment_state === 'reversed' ? 'red'
                    : r.payment_state === 'in_payment' ? 'blue' : 'yellow'
            const sl = r.payment_state === 'paid' ? 'Cobrado'
                    : r.payment_state === 'reversed' ? 'Devuelto'
                    : r.payment_state === 'in_payment' ? 'En cobro'
                    : r.payment_state === 'partial' ? 'Parcial' : 'Pendiente'
            const partnerName = r.partner_id?.name || `#${r.partner_id?.id}`
            return (
              <tr key={r.id}>
                <Td title={partnerName}>{partnerName}</Td>
                <Td>{r.cuota_codigo || '—'}</Td>
                <Td>{PERIODICIDAD_LABELS[r.periodicidad] || r.periodicidad || '—'}</Td>
                <Td mono style={{ fontWeight: 600 }}>{r.amount_total?.toFixed(2)} €</Td>
                <Td>{FORMA_PAGO_LABELS[r.forma_pago] || r.forma_pago || '—'}</Td>
                <Td mono>{r.invoice_date || '—'}</Td>
                <Td mono>{r.invoice_date_due || '—'}</Td>
                <Td><Badge color={sc}>{sl}</Badge></Td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

const inputStyle = {
  padding: '6px 10px', borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--line)', background: 'var(--bg-1)',
  color: 'var(--text-0)', fontFamily: 'var(--font-mono)', fontSize: 12,
  width: '100%',
}

function Th({ children }) {
  return <th style={{
    padding: '8px 8px', fontSize: 10, fontWeight: 600, color: 'var(--text-3)',
    textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap',
  }}>{children}</th>
}

// Td:
//   `wrap` = el contenido envuelve líneas (cliente largo, listas, notas)
//   por defecto = nowrap con ellipsis y tooltip automático con title del texto
function Td({ children, mono, style, wrap, title }) {
  // si es texto plano, usamos como tooltip por defecto
  const tip = title ?? (typeof children === 'string' ? children : undefined)
  return <td title={tip} style={{
    padding: '8px 8px', borderBottom: '1px solid var(--line)',
    fontFamily: mono ? 'var(--font-mono)' : 'inherit',
    color: 'var(--text-1)',
    whiteSpace: wrap ? 'normal' : 'nowrap',
    overflow: wrap ? 'visible' : 'hidden',
    textOverflow: wrap ? 'clip' : 'ellipsis',
    wordBreak: wrap ? 'break-word' : 'normal',
    verticalAlign: 'top',
    ...(style || {}),
  }}>{children}</td>
}
