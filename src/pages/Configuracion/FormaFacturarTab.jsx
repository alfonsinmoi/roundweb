// Pestaña Facturación (manager) — modelo de 2 sistemas + config per-trainer.
// Reemplaza el antiguo selector de 3 modos. SIEMPRE partner por cliente; 430XXX
// por trainer; series compartibles; IVA por tipo. La ACTIVACIÓN (activo=true)
// queda deshabilitada hasta cerrar el plan de activación/migración.
import { useEffect, useMemo, useState, useCallback } from 'react'
import { Receipt, Zap, CalendarClock, Save, Loader2, Building2, Hash, Percent, Plus, Trash2, RefreshCw } from 'lucide-react'
import { Card, Btn, SectionTitle, Badge } from '../../components/UI'
import { useToast } from '../../components/Toast'
import { useAuth } from '../../contexts/AuthContext'
import { getRoundIdentity } from '../../utils/configApi'

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
  }), [identity?.managerId])

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
            : <Badge color="amber">No activo (configuración; la activación está pendiente del plan de migración)</Badge>}
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

      <SeriesSection snap={snap} headers={headers} reload={reload} toast={toast} />
      <TrainersSection snap={snap} headers={headers} reload={reload} toast={toast} />
      <TiposIvaSection snap={snap} headers={headers} reload={reload} toast={toast} />
    </div>
  )
}

function SeriesSection({ snap, headers, reload, toast }) {
  const [clave, setClave] = useState(''); const [prefijo, setPrefijo] = useState('')
  const add = async () => {
    if (!clave.trim()) return
    const r = await fetch(`/api/config/facturacion/series`, { method: 'POST', headers: headers(true),
      body: JSON.stringify({ clave: clave.trim(), prefijo: prefijo.trim() }) })
    const d = await r.json(); if (!d.ok) return toast.error(d.error || 'Error')
    setClave(''); setPrefijo(''); reload(); toast.success('Serie creada')
  }
  const del = async (id) => {
    if (!window.confirm('¿Borrar serie?')) return
    const r = await fetch(`/api/config/facturacion/series/${id}`, { method: 'DELETE', headers: headers() })
    const d = await r.json(); if (!d.ok) return toast.error(d.error || 'Error'); reload()
  }
  return (
    <Card style={{ padding: 20 }}>
      <SectionTitle><Hash size={15} style={{ marginRight: 8 }} /> Series de numeración (compartibles)</SectionTitle>
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <input placeholder="clave (ej. MALAGA)" value={clave} onChange={e => setClave(e.target.value)}
          style={inp} />
        <input placeholder="prefijo (ej. M-)" value={prefijo} onChange={e => setPrefijo(e.target.value)} style={inp} />
        <Btn variant="ghost" onClick={add}><Plus size={14} /> Añadir</Btn>
      </div>
      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {(snap?.series || []).map(s => (
          <div key={s.id} style={row}>
            <span><b>{s.clave}</b> {s.prefijo ? `· ${s.prefijo}` : ''} {s.es_cliente_final ? <Badge color="blue">cliente final</Badge> : ''}</span>
            <Btn variant="ghost" onClick={() => del(s.id)}><Trash2 size={13} /></Btn>
          </div>
        ))}
        {!(snap?.series || []).length && <span style={muted}>Sin series.</span>}
      </div>
    </Card>
  )
}

function TrainersSection({ snap, headers, reload, toast }) {
  const [idt, setIdt] = useState(''); const [suf, setSuf] = useState(''); const [serie, setSerie] = useState('')
  const save = async () => {
    if (!idt.trim()) return
    const body = {}
    if (suf) body.cuenta_430_sufijo = parseInt(suf, 10)
    if (serie) body.serie_id = parseInt(serie, 10)
    const r = await fetch(`/api/config/facturacion/trainer/${idt.trim()}`, { method: 'PUT', headers: headers(true),
      body: JSON.stringify(body) })
    const d = await r.json(); if (!d.ok) return toast.error(d.error || 'Error')
    setIdt(''); setSuf(''); setSerie(''); reload(); toast.success(`Trainer ${idt} · ${d.cuenta_430 || ''}`)
  }
  return (
    <Card style={{ padding: 20 }}>
      <SectionTitle><Building2 size={15} style={{ marginRight: 8 }} /> Trainers · cuenta 430XXX + serie</SectionTitle>
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <input placeholder="id_trainer" value={idt} onChange={e => setIdt(e.target.value)} style={inp} />
        <input placeholder="430 sufijo (1-999)" value={suf} onChange={e => setSuf(e.target.value)} style={{ ...inp, width: 130 }} />
        <select value={serie} onChange={e => setSerie(e.target.value)} style={inp}>
          <option value="">(serie)</option>
          {(snap?.series || []).map(s => <option key={s.id} value={s.id}>{s.clave}</option>)}
        </select>
        <Btn variant="ghost" onClick={save}><Save size={14} /> Guardar</Btn>
      </div>
      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {(snap?.trainers || []).map(t => (
          <div key={t.id_trainer} style={row}>
            <span>Trainer <b>{t.id_trainer}</b> → cuenta <b>{t.cuenta_430_sufijo ? `430${String(t.cuenta_430_sufijo).padStart(3, '0')}` : '—'}</b> · serie {t.serie_id || '—'}</span>
          </div>
        ))}
        {!(snap?.trainers || []).length && <span style={muted}>Sin trainers configurados.</span>}
      </div>
    </Card>
  )
}

function TiposIvaSection({ snap, headers, reload, toast }) {
  const [idt, setIdt] = useState(''); const [nombre, setNombre] = useState(''); const [pct, setPct] = useState('21')
  const add = async () => {
    if (!idt.trim() || !nombre.trim()) return
    const r = await fetch(`/api/config/facturacion/tipos-iva`, { method: 'POST', headers: headers(true),
      body: JSON.stringify({ id_trainer: idt.trim(), nombre: nombre.trim(), pct: parseFloat(pct) }) })
    const d = await r.json(); if (!d.ok) return toast.error(d.error || 'Error')
    setNombre(''); reload(); toast.success('Tipo IVA creado')
  }
  const del = async (id) => {
    if (!window.confirm('¿Borrar tipo IVA?')) return
    const r = await fetch(`/api/config/facturacion/tipos-iva/${id}`, { method: 'DELETE', headers: headers() })
    const d = await r.json(); if (!d.ok) return toast.error(d.error || 'Error'); reload()
  }
  return (
    <Card style={{ padding: 20 }}>
      <SectionTitle><Percent size={15} style={{ marginRight: 8 }} /> Tipos de IVA (por trainer)</SectionTitle>
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <input placeholder="id_trainer" value={idt} onChange={e => setIdt(e.target.value)} style={inp} />
        <input placeholder="nombre (ej. General)" value={nombre} onChange={e => setNombre(e.target.value)} style={inp} />
        <input placeholder="%" value={pct} onChange={e => setPct(e.target.value)} style={{ ...inp, width: 80 }} />
        <Btn variant="ghost" onClick={add}><Plus size={14} /> Añadir</Btn>
      </div>
      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {(snap?.tipos_iva || []).map(t => (
          <div key={t.id} style={row}>
            <span>Trainer <b>{t.id_trainer}</b> · {t.nombre} · <b>{t.pct}%</b></span>
            <Btn variant="ghost" onClick={() => del(t.id)}><Trash2 size={13} /></Btn>
          </div>
        ))}
        {!(snap?.tipos_iva || []).length && <span style={muted}>Sin tipos de IVA.</span>}
      </div>
    </Card>
  )
}

const inp = { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--bg-0)', fontSize: 13, color: 'var(--text-0)' }
const row = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderRadius: 8, background: 'var(--bg-1)', fontSize: 13 }
const muted = { fontSize: 12.5, color: 'var(--text-3)' }
