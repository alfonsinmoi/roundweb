// Pestaña Facturación (manager) — modelo de 2 sistemas + config per-trainer.
// Reemplaza el antiguo selector de 3 modos. SIEMPRE partner por cliente; 430XXX
// por trainer; series compartibles; IVA por tipo. La ACTIVACIÓN (activo=true)
// exige fecha de corte + validador de completitud: factura SOLO desde el corte,
// sin tocar nada de lo anterior.
import { useEffect, useMemo, useState, useCallback } from 'react'
import { Receipt, Zap, CalendarClock, Save, Loader2, Building2, Hash, Percent, Plus, RefreshCw, Power, CheckCircle2, AlertTriangle } from 'lucide-react'
import { Card, Btn, SectionTitle, Badge } from '../../components/UI'
import { useToast } from '../../components/Toast'
import { useAuth } from '../../contexts/AuthContext'
import { getRoundIdentity, centrosList } from '../../utils/configApi'

const TOKEN = import.meta.env.VITE_CONFIG_API_TOKEN || ''
const BASE = '/api/config/facturacion'

const SISTEMAS = [
  { id: 'inmediata', icon: Zap, color: 'amber', titulo: 'Facturación inmediata',
    desc: 'Cada cobro, devolución o recobro genera su factura al instante (out_invoice / rectificativa) al partner del cliente.' },
  { id: 'fin_de_mes', icon: CalendarClock, color: 'green', titulo: 'Facturación a fin de mes',
    desc: 'Al cierre, una relación seleccionable de los cobros del mes (con forma de cobro) y devoluciones de meses anteriores → facturas por cliente.' },
]

export default function FormaFacturarTab() {
  const { user } = useAuth()
  const identity = useMemo(() => getRoundIdentity(user), [user])
  const toast = useToast()
  const [snap, setSnap] = useState(null)
  const [sistema, setSistema] = useState('fin_de_mes')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [provisioning, setProvisioning] = useState(false)

  const headers = useCallback((json = false) => ({
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    'X-Round-Token': TOKEN,
    'X-Round-Manager-Id': String(identity?.managerId || ''),
    // Mandamos el trainer REAL de la sesión (no el override del selector):
    // así el backend (@require_manager) bloquea a un trainer scopeado y deja
    // pasar al manager (cuyo identity.trainerId es null), aunque tenga un
    // centro elegido en el selector global.
    ...(identity?.trainerId ? { 'X-Round-Trainer-Id': String(identity.trainerId) } : {}),
  }), [identity?.managerId, identity?.trainerId])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(BASE, { headers: headers() })
      const d = await r.json()
      if (d.ok) { setSnap(d); setSistema(d.config?.sistema || 'fin_de_mes') }
    } catch { toast.error('No se pudo cargar la configuración') }
    finally { setLoading(false) }
  }, [headers, toast])
  useEffect(() => { if (identity?.managerId) reload() }, [identity?.managerId, reload])

  const guardarSistema = async () => {
    setSaving(true)
    try {
      const r = await fetch(BASE, { method: 'PUT', headers: headers(true),
        body: JSON.stringify({ sistema, destino: 'por_cliente', activo: !!snap?.config?.activo }) })
      const d = await r.json()
      if (!d.ok) throw new Error(d.error || 'Error')
      toast.success('Sistema de facturación guardado')
      reload()
    } catch (e) { toast.error(e.message) } finally { setSaving(false) }
  }

  const provisionar = async () => {
    if (!window.confirm('¿Crear en Odoo las cuentas 430XXX y las series configuradas? (idempotente)')) return
    setProvisioning(true)
    try {
      const r = await fetch(`${BASE}/provisionar`, { method: 'POST', headers: headers(true), body: '{}' })
      const d = await r.json()
      if (!d.ok) throw new Error(d.error || 'Error')
      toast.success(`Provisión OK: ${d.cuentas?.length || 0} cuentas, ${d.journals?.length || 0} series` +
        (d.errores?.length ? ` · ${d.errores.length} errores` : ''))
    } catch (e) { toast.error(e.message) } finally { setProvisioning(false) }
  }

  if (loading) return <Card style={{ padding: 40, textAlign: 'center' }}><Loader2 size={20} className="animate-spin" /></Card>

  const activo = !!snap?.config?.activo

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <Card style={{ padding: 20 }}>
        <SectionTitle><Receipt size={16} style={{ marginRight: 8 }} /> Sistema de facturación</SectionTitle>
        <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6, marginTop: 8 }}>
          Elige el sistema. En ambos, cada cliente se factura como tercero (partner) dentro de la cuenta 430XXX de su trainer.
          Es igual para todos los trainers de la misma empresa.
        </p>
        <div style={{ marginTop: 10 }}>
          {activo
            ? <Badge color="green">ACTIVO</Badge>
            : <Badge color="amber">No activo — configúralo y actívalo abajo (con fecha de corte)</Badge>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 14 }}>
          {SISTEMAS.map(s => {
            const Icon = s.icon, sel = sistema === s.id
            return (
              <button key={s.id} type="button" onClick={() => setSistema(s.id)}
                style={{ all: 'unset', cursor: 'pointer', padding: 16, borderRadius: 14,
                  background: sel ? `var(--${s.color}-bg)` : 'var(--bg-1)',
                  border: `2px solid ${sel ? `var(--${s.color})` : 'var(--line)'}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <Icon size={18} style={{ color: `var(--${s.color})` }} />
                  <strong style={{ fontFamily: 'Outfit', fontSize: 15 }}>{s.titulo}</strong>
                  {sel && <Badge color={s.color}>elegido</Badge>}
                </div>
                <p style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5, margin: 0 }}>{s.desc}</p>
              </button>
            )
          })}
        </div>
        <div style={{ marginTop: 14, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Btn variant="ghost" onClick={provisionar} disabled={provisioning}>
            {provisioning ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Provisionar Odoo
          </Btn>
          <Btn variant="primary" onClick={guardarSistema} disabled={saving || sistema === snap?.config?.sistema}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Guardar sistema
          </Btn>
        </div>
      </Card>

      <TrainerConfigSection snap={snap} headers={headers} reload={reload} toast={toast} identity={identity} />
      <ActivacionSection snap={snap} headers={headers} reload={reload} toast={toast} />
      <RelacionEmitirSection headers={headers} toast={toast} activo={activo} sistema={snap?.config?.sistema} />
    </div>
  )
}

// Activación del sistema con fecha de corte + validador de completitud.
// Sin tocar lo ya facturado: solo factura a partir de la fecha de corte.
function ActivacionSection({ snap, headers, reload, toast }) {
  const activo = !!snap?.config?.activo
  const sistema = snap?.config?.sistema || 'fin_de_mes'
  const [corte, setCorte] = useState(snap?.config?.fecha_corte || '')
  const [val, setVal] = useState(null)
  const [checking, setChecking] = useState(false)
  const [working, setWorking] = useState(false)

  useEffect(() => { setCorte(snap?.config?.fecha_corte || '') }, [snap?.config?.fecha_corte])

  const validar = useCallback(async () => {
    setChecking(true)
    try {
      const r = await fetch(`${BASE}/validacion`, { headers: headers() })
      const d = await r.json()
      if (d.ok) setVal(d)
    } catch { /* noop */ } finally { setChecking(false) }
  }, [headers])
  useEffect(() => { validar() }, [validar])

  const activar = async () => {
    if (!corte) return toast.error('Indica la fecha de corte (desde cuándo factura)')
    if (!window.confirm(
      `¿ACTIVAR facturación «${sistema}» con corte ${corte}?\n\n` +
      `Solo se facturará a partir de esa fecha. NO se toca nada anterior.`)) return
    setWorking(true)
    try {
      const r = await fetch(BASE, { method: 'PUT', headers: headers(true),
        body: JSON.stringify({ sistema, destino: 'por_cliente', activo: true, fecha_corte: corte }) })
      const d = await r.json()
      if (!d.ok) {
        if (d.error === 'config_incompleta') { setVal({ listo: false, faltantes: d.faltantes }); throw new Error('Configuración incompleta — revisa los pendientes') }
        throw new Error(d.error || 'Error')
      }
      toast.success(`Facturación ACTIVADA (corte ${corte})`)
      reload(); validar()
    } catch (e) { toast.error(e.message) } finally { setWorking(false) }
  }

  const desactivar = async () => {
    if (!window.confirm('¿Desactivar la facturación? El sistema dejará de emitir (lo ya emitido permanece).')) return
    setWorking(true)
    try {
      const r = await fetch(BASE, { method: 'PUT', headers: headers(true),
        body: JSON.stringify({ sistema, destino: 'por_cliente', activo: false, fecha_corte: corte || null }) })
      const d = await r.json()
      if (!d.ok) throw new Error(d.error || 'Error')
      toast.success('Facturación desactivada')
      reload()
    } catch (e) { toast.error(e.message) } finally { setWorking(false) }
  }

  const faltantes = val?.faltantes || []
  const listo = !!val?.listo

  return (
    <Card style={{ padding: 20, border: `2px solid ${activo ? 'var(--green)' : 'var(--line)'}` }}>
      <SectionTitle><Power size={15} style={{ marginRight: 8 }} /> Activación del sistema</SectionTitle>
      <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6, marginTop: 8 }}>
        Al activar, el sistema empieza a facturar <b>solo desde la fecha de corte</b>. Todo lo anterior
        queda intacto (no se re-factura nada). Puedes desactivar en cualquier momento.
      </p>
      <div style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 13, color: 'var(--text-1)' }}>Fecha de corte:</label>
        <input type="date" value={corte || ''} onChange={e => setCorte(e.target.value)} disabled={activo} style={inp} />
        {activo
          ? <Badge color="green">ACTIVO desde {snap?.config?.fecha_corte || '—'}</Badge>
          : <Badge color="amber">No activo</Badge>}
        <Btn variant="ghost" onClick={validar} disabled={checking}>
          {checking ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Revisar requisitos
        </Btn>
      </div>

      {!activo && val && (
        <div style={{ marginTop: 12 }}>
          {listo
            ? <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--green)', fontSize: 13 }}>
                <CheckCircle2 size={16} /> Todo listo para activar.
              </div>
            : <div style={{ fontSize: 13 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--amber)', marginBottom: 6 }}>
                  <AlertTriangle size={16} /> Faltan requisitos antes de activar:
                </div>
                <ul style={{ margin: 0, paddingLeft: 22, color: 'var(--text-2)', lineHeight: 1.7 }}>
                  {faltantes.map((f, i) => <li key={i}><code style={{ fontSize: 12 }}>{f}</code></li>)}
                </ul>
              </div>}
        </div>
      )}

      <div style={{ marginTop: 14, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        {activo
          ? <Btn variant="ghost" onClick={desactivar} disabled={working}>
              {working ? <Loader2 size={14} className="animate-spin" /> : <Power size={14} />} Desactivar
            </Btn>
          : <Btn variant="primary" onClick={activar} disabled={working || !corte || (val && !listo)}>
              {working ? <Loader2 size={14} className="animate-spin" /> : <Power size={14} />} Activar facturación
            </Btn>}
      </div>
    </Card>
  )
}

function RelacionEmitirSection({ headers, toast, activo, sistema }) {
  const hoy = new Date().toISOString().slice(0, 7)
  const [mes, setMes] = useState(hoy)
  const [rel, setRel] = useState(null)
  const [sel, setSel] = useState(() => new Set())
  const [loading, setLoading] = useState(false)
  const [emitiendo, setEmitiendo] = useState(false)

  const cargar = async () => {
    setLoading(true); setRel(null); setSel(new Set())
    try {
      const r = await fetch(`/api/config/facturacion/relacion/${mes}`, { headers: headers() })
      const d = await r.json()
      if (!d.ok) throw new Error(d.error || 'Error')
      setRel(d); setSel(new Set((d.cobros || []).map(c => c.id)))
    } catch (e) { toast.error(e.message) } finally { setLoading(false) }
  }
  const toggle = (id) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const emitir = async () => {
    const ids = [...sel]
    if (!ids.length) return toast.error('Selecciona al menos un cobro')
    if (!window.confirm(`¿Emitir factura (BORRADOR) para ${ids.length} recibos de ${mes}?`)) return
    setEmitiendo(true)
    try {
      const r = await fetch(`/api/config/facturacion/emitir-mes/${mes}`, { method: 'POST', headers: headers(true),
        body: JSON.stringify({ recibo_ids: ids, postear: false }) })
      const d = await r.json()
      if (!d.ok) throw new Error(d.error || 'Error')
      if (d.skipped) toast.error(`No emitido: ${d.skipped} (activa el sistema fin_de_mes primero)`)
      else toast.success(`Emitido: ${d.creadas} facturas, ${d.errores} errores`)
    } catch (e) { toast.error(e.message) } finally { setEmitiendo(false) }
  }

  return (
    <Card style={{ padding: 20 }}>
      <SectionTitle><CalendarClock size={15} style={{ marginRight: 8 }} /> Relación del mes / Emitir</SectionTitle>
      <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="month" value={mes} onChange={e => setMes(e.target.value)} style={inp} />
        <Btn variant="ghost" onClick={cargar} disabled={loading}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Cargar relación
        </Btn>
        {rel && (
          <Btn variant="primary" onClick={emitir} disabled={emitiendo || !sel.size}>
            {emitiendo ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Emitir {sel.size} (borrador)
          </Btn>
        )}
        {!activo && <Badge color="amber">no activo · emitir queda inerte hasta activar</Badge>}
      </div>
      {rel && (
        <div style={{ marginTop: 14 }}>
          <p style={muted}>Cobros: <b>{rel.totales?.cobros}</b> · Devoluciones: <b>{rel.totales?.devoluciones}</b> · Recobros: <b>{rel.totales?.recobros}</b></p>
          <div style={{ marginTop: 8, maxHeight: 360, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {(rel.cobros || []).map(c => (
              <label key={c.id} style={{ ...row, cursor: 'pointer' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={sel.has(c.id)} onChange={() => toggle(c.id)} />
                  <b>{c.cliente_nombre}</b> · {c.cuota_codigo} · {Number(c.importe_total).toFixed(2)}€
                </span>
                <span style={muted}>{c.metodo_pago} · {String(c.fecha).slice(0, 16)}</span>
              </label>
            ))}
            {!(rel.cobros || []).length && <span style={muted}>Sin cobros este mes.</span>}
          </div>
        </div>
      )}
    </Card>
  )
}

// ── Configuración por trainer: UN solo selector → 430XXX + serie + IVA cuotas.
function TrainerConfigSection({ snap, headers, reload, toast, identity }) {
  const [centros, setCentros] = useState([])
  const [sel, setSel] = useState('')   // id_trainer seleccionado

  useEffect(() => {
    let alive = true
    if (identity?.managerId) {
      centrosList(identity).then(rows => { if (alive) setCentros(rows || []) }).catch(() => {})
    }
    return () => { alive = false }
  }, [identity?.managerId])

  // Fila de facturacion_trainer del seleccionado (430 sufijo + serie)
  const ftRow = (snap?.trainers || []).find(t => String(t.id_trainer) === String(sel)) || null
  const nombreCentro = (centros.find(c => String(c.id_trainer) === String(sel))?.nombre_centro) || sel

  return (
    <Card style={{ padding: 20 }}>
      <SectionTitle><Building2 size={15} style={{ marginRight: 8 }} /> Configuración por centro / trainer</SectionTitle>
      <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6, marginTop: 8 }}>
        Elige un centro y configura su cuenta contable, su serie de numeración y el IVA de sus cuotas.
        Todo lo que no toques usa los valores por defecto (IVA 21%).
      </p>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 13, color: 'var(--text-1)' }}>Centro:</label>
        <select value={sel} onChange={e => setSel(e.target.value)} style={{ ...inp, minWidth: 240 }}>
          <option value="">— Selecciona un centro —</option>
          {centros.map(c => (
            <option key={c.id_trainer} value={c.id_trainer}>
              {c.nombre_centro || `Trainer ${c.id_trainer}`} ({c.id_trainer})
            </option>
          ))}
        </select>
        {ftRow && (
          <Badge color="green">
            430{String(ftRow.cuenta_430_sufijo || 0).padStart(3, '0')}{ftRow.serie_id ? ' · serie ✓' : ' · sin serie'}
          </Badge>
        )}
      </div>

      {sel && (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Cuenta430Block sel={sel} nombre={nombreCentro} ftRow={ftRow} headers={headers} reload={reload} toast={toast} />
          <SerieBlock sel={sel} ftRow={ftRow} series={snap?.series || []} headers={headers} reload={reload} toast={toast} />
          <CuotasIvaBlock sel={sel} headers={headers} toast={toast} />
        </div>
      )}
    </Card>
  )
}

// 1) Cuenta 430XXX del centro
function Cuenta430Block({ sel, nombre, ftRow, headers, reload, toast }) {
  const [suf, setSuf] = useState('')
  useEffect(() => { setSuf(ftRow?.cuenta_430_sufijo ? String(ftRow.cuenta_430_sufijo) : '') }, [sel, ftRow?.cuenta_430_sufijo])
  const guardar = async () => {
    const n = parseInt(suf, 10)
    if (!(n >= 1 && n <= 999)) return toast.error('Sufijo entre 1 y 999')
    const r = await fetch(`/api/config/facturacion/trainer/${sel}`, { method: 'PUT', headers: headers(true),
      body: JSON.stringify({ cuenta_430_sufijo: n }) })
    const d = await r.json(); if (!d.ok) return toast.error(d.error || 'Error')
    reload(); toast.success(`Cuenta ${d.cuenta_430 || ''} asignada a ${nombre}`)
  }
  const preview = suf && /^\d+$/.test(suf) ? `430${String(parseInt(suf, 10)).padStart(3, '0')}` : '430—'
  return (
    <div style={blk}>
      <div style={blkTitle}><Building2 size={14} /> Cuenta contable (430XXX)</div>
      <p style={muted}>Subcuenta de clientes en Odoo para este centro. Cada centro tiene la suya (430 + nº de 3 dígitos);
        sus clientes cuelgan de ella como terceros. Rango 1–999.</p>
      <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="number" min="1" max="999" placeholder="nº (1-999)" value={suf}
          onChange={e => setSuf(e.target.value)} style={{ ...inp, width: 130 }} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700, color: 'var(--green)' }}>{preview}</span>
        <Btn variant="primary" onClick={guardar}><Save size={14} /> Guardar cuenta</Btn>
      </div>
    </div>
  )
}

// 2) Serie de numeración de factura
function SerieBlock({ sel, ftRow, series, headers, reload, toast }) {
  const [serieId, setSerieId] = useState('')
  const [creando, setCreando] = useState(false)
  const [clave, setClave] = useState(''); const [prefijo, setPrefijo] = useState('')
  useEffect(() => { setSerieId(ftRow?.serie_id ? String(ftRow.serie_id) : '') }, [sel, ftRow?.serie_id])

  const asignar = async (sid) => {
    const r = await fetch(`/api/config/facturacion/trainer/${sel}`, { method: 'PUT', headers: headers(true),
      body: JSON.stringify({ serie_id: sid ? parseInt(sid, 10) : null }) })
    const d = await r.json(); if (!d.ok) return toast.error(d.error || 'Error')
    reload(); toast.success('Serie asignada al centro')
  }
  const crearSerie = async () => {
    if (!clave.trim()) return toast.error('Indica una clave (ej. ANORETA)')
    const r = await fetch(`/api/config/facturacion/series`, { method: 'POST', headers: headers(true),
      body: JSON.stringify({ clave: clave.trim(), prefijo: prefijo.trim() }) })
    const d = await r.json(); if (!d.ok) return toast.error(d.error || 'Error')
    setCreando(false); setClave(''); setPrefijo(''); reload()
    toast.success('Serie creada — asígnala al centro en el desplegable')
  }
  const serieSel = series.find(s => String(s.id) === String(serieId))
  const ejemplo = (serieSel?.prefijo || '') + '2026-0001'
  return (
    <div style={blk}>
      <div style={blkTitle}><Hash size={14} /> Serie de numeración de factura</div>
      <p style={muted}>La serie define el <b>prefijo</b> y la <b>numeración correlativa</b> de las facturas de este centro
        (p. ej. <code>{ejemplo || '2026-0001'}</code>). Cada centro puede tener su propia serie o compartir una.
        Las facturas se numeran sin huecos dentro de cada serie (requisito legal).</p>
      <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={serieId} onChange={e => { setSerieId(e.target.value); asignar(e.target.value) }} style={{ ...inp, minWidth: 220 }}>
          <option value="">— Sin serie —</option>
          {series.map(s => <option key={s.id} value={s.id}>{s.clave}{s.prefijo ? ` (prefijo ${s.prefijo})` : ''}</option>)}
        </select>
        <Btn variant="ghost" onClick={() => setCreando(v => !v)}><Plus size={14} /> Nueva serie</Btn>
      </div>
      {creando && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <input placeholder="clave (ej. ANORETA)" value={clave} onChange={e => setClave(e.target.value)} style={inp} />
          <input placeholder="prefijo factura (ej. A-)" value={prefijo} onChange={e => setPrefijo(e.target.value)} style={inp} />
          <Btn variant="primary" onClick={crearSerie}><Save size={14} /> Crear</Btn>
        </div>
      )}
    </div>
  )
}

// 3) Cuotas del trainer con IVA ≠ 21%
function CuotasIvaBlock({ sel, headers, toast }) {
  const [cuotas, setCuotas] = useState(null)
  const [saving, setSaving] = useState(null)
  const cargar = useCallback(async () => {
    setCuotas(null)
    try {
      const r = await fetch(`/api/config/facturacion/trainer/${sel}/cuotas`, { headers: headers() })
      const d = await r.json()
      if (d.ok) setCuotas(d.cuotas || [])
    } catch { toast.error('No se pudieron cargar las cuotas') }
  }, [sel, headers, toast])
  useEffect(() => { cargar() }, [cargar])

  const guardarIva = async (cuota, valor) => {
    const pct = valor === '' ? null : parseFloat(valor)
    if (valor !== '' && (isNaN(pct) || pct < 0 || pct > 100)) return toast.error('IVA entre 0 y 100')
    setSaving(cuota.id)
    try {
      const r = await fetch(`/api/config/facturacion/cuota/${cuota.id}/iva`, { method: 'PUT', headers: headers(true),
        body: JSON.stringify({ pct }) })
      const d = await r.json(); if (!d.ok) throw new Error(d.error || 'Error')
      setCuotas(cs => cs.map(c => c.id === cuota.id ? { ...c, iva_pct: d.iva_pct, iva_personalizado: d.iva_personalizado } : c))
      toast.success(`${cuota.codigo}: IVA ${d.iva_pct}%`)
    } catch (e) { toast.error(e.message) } finally { setSaving(null) }
  }

  return (
    <div style={blk}>
      <div style={blkTitle}><Percent size={14} /> IVA de las cuotas</div>
      <p style={muted}>Por defecto todas las cuotas se facturan al <b>21%</b>. Cambia aquí solo las que tengan
        un IVA distinto (p. ej. 10% reducido o 0% exento). Lo que dejes en 21% no necesita configuración.</p>
      {cuotas === null && <div style={{ marginTop: 8 }}><Loader2 size={14} className="animate-spin" /></div>}
      {cuotas && !cuotas.length && <span style={muted}>Este centro no tiene cuotas.</span>}
      {cuotas && cuotas.length > 0 && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {cuotas.map(c => (
            <div key={c.id} style={row}>
              <span><b>{c.codigo}</b>{c.descripcion ? ` · ${c.descripcion}` : ''}
                {c.iva_personalizado && <Badge color="amber" style={{ marginLeft: 6 }}>IVA {c.iva_pct}%</Badge>}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="number" min="0" max="100" step="0.5" defaultValue={c.iva_pct}
                  onBlur={e => { if (parseFloat(e.target.value) !== Number(c.iva_pct)) guardarIva(c, e.target.value) }}
                  style={{ ...inp, width: 80 }} disabled={saving === c.id} />
                <span style={muted}>%</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const blk = { padding: 14, borderRadius: 12, background: 'var(--bg-1)', border: '1px solid var(--line)' }
const blkTitle = { display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'Outfit', fontWeight: 700, fontSize: 14, marginBottom: 4 }

const inp = { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--bg-0)', fontSize: 13, color: 'var(--text-0)' }
const row = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderRadius: 8, background: 'var(--bg-1)', fontSize: 13 }
const muted = { fontSize: 12.5, color: 'var(--text-3)' }
