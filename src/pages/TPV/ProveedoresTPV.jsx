// Página de Facturas de proveedor (Fase 7, mayo 2026).
//
// Reglas carajfam:
//   * Cuentas PGC: 600 (default) / 622 / 623 / 625 / 626 / 628 / 629…
//   * Total negativo → in_refund (factura rectificativa) en Odoo.
//   * Partner por VAT/NIF con supplier_rank=1, auto-creado al sincronizar.
//   * Move queda en DRAFT en Odoo — admin valida manualmente.
//   * NIF/CIF/NIE validado por mod 23 / dígito control antes de aceptar.
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Loader2, Plus, Truck, Search, RefreshCw, X, AlertCircle,
  FileText, Upload, Trash2, Calendar, Pencil, Archive,
} from 'lucide-react'
import { Card, Btn, SectionTitle, Badge } from '../../components/UI'
import { useToast } from '../../components/Toast'
import { useAuth } from '../../contexts/AuthContext'
import { useCan } from '../../hooks/useCan'
import { getRoundIdentity } from '../../utils/configApi'
import { validarNifCifNie } from '../../utils/validators'
import {
  posProveedoresList, posProveedorCreate, posProveedorUpdate,
  posProveedorAnular, posProveedorSync, posUploadMedia,
} from '../../utils/posApi'


// Mismo set que el backend (pos_proveedores.py CUENTAS_VALIDAS)
const CUENTAS_OPCIONES = [
  ['600', 'Compras de mercaderías'],
  ['602', 'Compras otros aprovisionamientos'],
  ['607', 'Trabajos por otras empresas'],
  ['621', 'Arrendamientos y cánones'],
  ['622', 'Reparaciones y conservación'],
  ['623', 'Servicios profesionales'],
  ['624', 'Transportes'],
  ['625', 'Primas de seguros'],
  ['626', 'Servicios bancarios'],
  ['627', 'Publicidad y RR.PP.'],
  ['628', 'Suministros (luz, agua, gas, internet)'],
  ['629', 'Otros servicios'],
]


export default function ProveedoresTPV() {
  const { user } = useAuth()
  const toast = useToast()
  const identity = useMemo(() => getRoundIdentity(user), [user])
  const canCrear = useCan('tpv.proveedores.crear')
  const canAnular = useCan('tpv.proveedores.anular')
  const canEditar = useCan('tpv.proveedores.editar')
  const canSyncOdoo = useCan('tpv.proveedores.sync_odoo')

  const [facturas, setFacturas] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)   // null=closed, {}=new, {...}=edit
  // Filtros
  const today = new Date().toISOString().slice(0, 10)
  const monthAgo = new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10)
  const [filtros, setFiltros] = useState({
    desde: monthAgo, hasta: today, estado: '', proveedor_nif: '', cuenta: '',
  })

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const params = { ...filtros }
      // Limpiar vacíos
      Object.keys(params).forEach(k => { if (!params[k]) delete params[k] })
      const r = await posProveedoresList(identity, params)
      setFacturas(r)
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setLoading(false)
  }, [identity, filtros, toast])
  useEffect(() => { reload() }, [reload])

  // Resumen
  const totales = useMemo(() => {
    const activas = facturas.filter(f => f.estado !== 'anulada')
    return {
      n: activas.length,
      base: activas.reduce((s, f) => s + Number(f.base || 0), 0),
      iva:  activas.reduce((s, f) => s + Number(f.iva_importe || 0), 0),
      total: activas.reduce((s, f) => s + Number(f.total || 0), 0),
    }
  }, [facturas])

  const onAnular = async (f) => {
    const motivo = prompt(`Motivo de anulación de la factura de ${f.proveedor_nombre}:`)
    if (motivo === null) return
    try {
      await posProveedorAnular(identity, f.id, motivo || 'sin motivo')
      toast.success('Anulada')
      reload()
    } catch (e) { toast.error(`Error: ${e.message}`) }
  }
  const onSyncRetry = async (f) => {
    try {
      const r = await posProveedorSync(identity, f.id)
      toast.success(r.skipped ? 'Sin Odoo (skipped)'
                  : r.busy ? 'En curso…'
                  : `Sincronizado · move #${r.move_id}`)
      reload()
    } catch (e) { toast.error(`Error: ${e.message}`) }
  }

  return (
    <div style={{ padding: 16, maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center',
                     justifyContent: 'space-between', marginBottom: 16 }}>
        <SectionTitle>
          <Truck size={20} style={{ marginRight: 8, color: 'var(--green)' }} />
          Facturas de proveedor
        </SectionTitle>
        {canCrear && (
          <Btn variant="primary" onClick={() => setEditing({})}>
            <Plus size={14} /> Nueva factura
          </Btn>
        )}
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
                     gap: 10, marginBottom: 16 }}>
        <Stat label="Facturas activas" v={totales.n} />
        <Stat label="Base imponible" v={`${totales.base.toFixed(2)} €`} />
        <Stat label="IVA" v={`${totales.iva.toFixed(2)} €`} />
        <Stat label="Total" v={`${totales.total.toFixed(2)} €`} color="var(--green)" />
      </div>

      {/* Filtros */}
      <Card style={{ padding: 12, marginBottom: 12,
                     display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <Calendar size={14} style={{ color: 'var(--text-3)' }} />
        <input type="date" value={filtros.desde} max={filtros.hasta}
               onChange={e => setFiltros(f => ({ ...f, desde: e.target.value }))}
               style={inp} />
        <span style={{ color: 'var(--text-3)' }}>→</span>
        <input type="date" value={filtros.hasta} min={filtros.desde} max={today}
               onChange={e => setFiltros(f => ({ ...f, hasta: e.target.value }))}
               style={inp} />
        <select value={filtros.cuenta}
                onChange={e => setFiltros(f => ({ ...f, cuenta: e.target.value }))}
                style={{ ...inp, width: 220 }}>
          <option value="">Todas las cuentas</option>
          {CUENTAS_OPCIONES.map(([c, lbl]) =>
            <option key={c} value={c}>{c} · {lbl}</option>
          )}
        </select>
        <select value={filtros.estado}
                onChange={e => setFiltros(f => ({ ...f, estado: e.target.value }))}
                style={{ ...inp, width: 150 }}>
          <option value="">Todos los estados</option>
          <option value="pendiente">Pendiente</option>
          <option value="sincronizada">Sincronizada</option>
          <option value="anulada">Anulada</option>
        </select>
        <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
          <Search size={13} style={{ position: 'absolute', left: 8, top: '50%',
                                      transform: 'translateY(-50%)',
                                      color: 'var(--text-3)' }} />
          <input value={filtros.proveedor_nif}
                 onChange={e => setFiltros(f => ({ ...f, proveedor_nif: e.target.value.toUpperCase() }))}
                 placeholder="NIF proveedor…"
                 style={{ ...inp, paddingLeft: 28, width: '100%',
                          fontFamily: 'var(--font-mono)' }} />
        </div>
        <button onClick={reload} title="Recargar" style={miniBtn}>
          <RefreshCw size={12} />
        </button>
      </Card>

      {/* Listado */}
      <Card style={{ padding: 0 }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <Loader2 size={22} className="animate-spin"
                     style={{ color: 'var(--green)' }} />
          </div>
        ) : facturas.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)' }}>
            <Truck size={32} style={{ opacity: 0.4 }} />
            <p style={{ marginTop: 8 }}>
              No hay facturas con esos filtros.
              {canCrear && ' Crea la primera con el botón "Nueva factura".'}
            </p>
          </div>
        ) : (
          <table style={{ width: '100%', fontSize: 12 }}>
            <thead><tr style={{ color: 'var(--text-3)', textAlign: 'left' }}>
              <th style={th}>Fecha</th>
              <th style={th}>Proveedor</th>
              <th style={th}>NIF</th>
              <th style={th}>Concepto</th>
              <th style={th}>Cuenta</th>
              <th style={{ ...th, textAlign: 'right' }}>Base</th>
              <th style={{ ...th, textAlign: 'right' }}>IVA</th>
              <th style={{ ...th, textAlign: 'right' }}>Total</th>
              <th style={th}>Estado</th>
              <th style={th}>Odoo</th>
              <th style={th}>PDF</th>
              <th style={th}></th>
            </tr></thead>
            <tbody>
              {facturas.map(f => {
                const anulada = f.estado === 'anulada'
                const refund = Number(f.total) < 0
                return (
                  <tr key={f.id} style={{ borderTop: '1px solid var(--line)',
                                            opacity: anulada ? 0.55 : 1 }}>
                    <td style={td}>{(f.fecha || '').slice(0, 10)}</td>
                    <td style={{ ...td, fontWeight: 600 }}>
                      {f.proveedor_nombre}
                      {refund && <Badge color="amber" small style={{ marginLeft: 6 }}>RECT</Badge>}
                    </td>
                    <td style={{ ...td, fontFamily: 'var(--font-mono)' }}>{f.proveedor_nif}</td>
                    <td style={{ ...td, maxWidth: 220, overflow: 'hidden',
                                  textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={f.concepto}>
                      {f.concepto}
                      {f.numero_factura && (
                        <div style={{ fontSize: 10, color: 'var(--text-3)',
                                       fontFamily: 'var(--font-mono)' }}>
                          #{f.numero_factura}
                        </div>
                      )}
                    </td>
                    <td style={{ ...td, fontFamily: 'var(--font-mono)' }}>{f.cuenta_contable}</td>
                    <td style={{ ...td, textAlign: 'right',
                                  fontFamily: 'var(--font-mono)' }}>
                      {Number(f.base).toFixed(2)}
                    </td>
                    <td style={{ ...td, textAlign: 'right',
                                  fontFamily: 'var(--font-mono)' }}>
                      {Number(f.iva_importe).toFixed(2)}
                      <span style={{ color: 'var(--text-3)', marginLeft: 4 }}>
                        ({f.iva_pct}%)
                      </span>
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700,
                                  fontFamily: 'var(--font-mono)',
                                  color: refund ? 'var(--red)' : 'var(--text-0)' }}>
                      {Number(f.total).toFixed(2)} €
                    </td>
                    <td style={td}>
                      {anulada ? <span style={{ color: 'var(--red)' }}>anulada</span>
                       : f.estado === 'sincronizada'
                         ? <span style={{ color: 'var(--green)' }}>✓</span>
                         : <span style={{ color: 'var(--text-3)' }}>pendiente</span>}
                    </td>
                    <td style={td}>
                      <SyncBadge f={f} onRetry={canSyncOdoo ? () => onSyncRetry(f) : null} />
                    </td>
                    <td style={td}>
                      {f.pdf_url ? (
                        <a href={f.pdf_url} target="_blank" rel="noreferrer"
                           style={{ color: 'var(--green)' }}>
                          <FileText size={14} />
                        </a>
                      ) : <span style={{ color: 'var(--text-3)' }}>—</span>}
                    </td>
                    <td style={td}>
                      {!anulada && (
                        <div style={{ display: 'flex', gap: 4 }}>
                          {f.sync_status !== 'synced' && canEditar && (
                            <button onClick={() => setEditing(f)} style={iconBtn}
                                    title="Editar">
                              <Pencil size={11} />
                            </button>
                          )}
                          {canAnular && (
                            <button onClick={() => onAnular(f)}
                                    style={{ ...iconBtn, color: 'var(--red)' }}
                                    title="Anular">
                              <Archive size={11} />
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Card>

      {editing !== null && (
        <FacturaModal identity={identity} initial={editing}
                      onClose={() => setEditing(null)}
                      onSaved={() => { setEditing(null); reload() }} />
      )}
    </div>
  )
}


function SyncBadge({ f, onRetry }) {
  const s = f.sync_status
  if (s === 'synced' && f.odoo_move_id) {
    return <span title={`Move Odoo #${f.odoo_move_id} (draft)`}
                 style={{ color: 'var(--green)', fontSize: 11 }}>
      ✓ #{f.odoo_move_id}
    </span>
  }
  if (s === 'skipped') return <span style={{ color: 'var(--text-3)', fontSize: 10 }}>—</span>
  if (s === 'syncing') return <Loader2 size={12} className="animate-spin" />
  // Sin permiso de re-sync: mostrar estado pero sin botón clicable
  if (s === 'error') {
    if (!onRetry) {
      return <span style={{ color: 'var(--red)', fontSize: 11 }}>error</span>
    }
    return (
      <button onClick={onRetry} title={f.sync_error || 'Reintentar'}
              style={{ background: 'none', border: 'none', cursor: 'pointer',
                       color: 'var(--red)', fontSize: 11, padding: 0,
                       display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        <RefreshCw size={11} /> error
      </button>
    )
  }
  if (!onRetry) {
    return <span style={{ color: 'var(--text-3)', fontSize: 11 }}>pendiente</span>
  }
  return (
    <button onClick={onRetry} title="Sincronizar"
            style={{ background: 'none', border: 'none', cursor: 'pointer',
                     color: 'var(--text-3)', fontSize: 11, padding: 0,
                     display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      <RefreshCw size={11} /> pendiente
    </button>
  )
}


// ═══════════════════════════════════════════════════════════════════════
//                       MODAL CREAR / EDITAR
// ═══════════════════════════════════════════════════════════════════════

function FacturaModal({ identity, initial, onClose, onSaved }) {
  const toast = useToast()
  const isEdit = !!initial?.id
  const [f, setF] = useState({
    fecha:            initial?.fecha?.slice(0, 10) || new Date().toISOString().slice(0, 10),
    proveedor_nombre: initial?.proveedor_nombre || '',
    proveedor_nif:    initial?.proveedor_nif || '',
    proveedor_email:  initial?.proveedor_email || '',
    numero_factura:   initial?.numero_factura || '',
    cuenta_contable:  initial?.cuenta_contable || '600',
    concepto:         initial?.concepto || '',
    base:             initial?.base ?? '',
    iva_pct:          initial?.iva_pct ?? 21,
    iva_importe:      initial?.iva_importe ?? '',
    total:            initial?.total ?? '',
    pdf_url:          initial?.pdf_url || '',
    notas:            initial?.notas || '',
  })
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)

  // Auto-calcular IVA y total cuando cambian base/iva_pct, salvo que el
  // usuario haya tocado manualmente. Heurística: si total queda vacío
  // recalculamos siempre.
  useEffect(() => {
    if (!f.base || isNaN(Number(f.base))) return
    const base = Number(f.base)
    const ivaP = Number(f.iva_pct || 0)
    const ivaI = Math.round(base * ivaP) / 100
    set('iva_importe', ivaI.toFixed(2))
    set('total', (base + ivaI).toFixed(2))
  // eslint-disable-next-line
  }, [f.base, f.iva_pct])

  // Negativo → mostrar warning rectificativa
  const totalNum = Number(f.total || 0)
  const esRect = totalNum < 0

  const subirPDF = async (file) => {
    if (!file) return
    if (file.size > 20 * 1024 * 1024) {
      toast.error('PDF demasiado grande (máx 20MB)'); return
    }
    setUploading(true)
    try {
      const r = await posUploadMedia(identity, file, 'image')   // backend acepta cualquier ext
      set('pdf_url', r.url)
      toast.success('PDF subido')
    } catch (e) { toast.error(`Error subiendo PDF: ${e.message}`) }
    setUploading(false)
  }

  const submit = async () => {
    if (!f.proveedor_nombre.trim()) { toast.error('Nombre proveedor obligatorio'); return }
    if (!f.proveedor_nif.trim()) { toast.error('NIF obligatorio'); return }
    // Sprint 3c — Validación NIF/CIF/NIE client-side antes de mandar al backend
    const nifCheck = validarNifCifNie(f.proveedor_nif)
    if (!nifCheck.ok) {
      toast.error(`NIF inválido: ${nifCheck.msg}`); return
    }
    if (!f.concepto.trim()) { toast.error('Concepto obligatorio'); return }
    if (!f.base) { toast.error('Base imponible obligatoria'); return }
    setSaving(true)
    try {
      const body = {
        ...f,
        base: Number(f.base),
        iva_pct: Number(f.iva_pct),
        iva_importe: f.iva_importe !== '' ? Number(f.iva_importe) : undefined,
        total: f.total !== '' ? Number(f.total) : undefined,
      }
      if (isEdit) await posProveedorUpdate(identity, initial.id, body)
      else        await posProveedorCreate(identity, body)
      toast.success(isEdit ? 'Actualizada' : 'Creada · sync en curso')
      onSaved?.()
    } catch (e) {
      toast.error(`Error: ${e.message}`)
    }
    setSaving(false)
  }

  return (
    <div role="dialog" aria-modal="true" onClick={onClose}
         style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  zIndex: 10000 }}>
      <div onClick={e => e.stopPropagation()}
           style={{ background: 'var(--bg-1)', borderRadius: 14, maxWidth: 720,
                    width: '94%', maxHeight: '92vh', display: 'flex',
                    flexDirection: 'column', border: '1px solid var(--line)',
                    boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
                    color: 'var(--text-0)' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line)',
                       display: 'flex', alignItems: 'center', gap: 8 }}>
          <strong style={{ fontSize: 15 }}>
            {isEdit ? `Editar factura ${initial.proveedor_nombre}` : 'Nueva factura proveedor'}
          </strong>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} style={{ background: 'none', border: 'none',
                                              cursor: 'pointer', color: 'var(--text-2)' }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>
          {/* Proveedor */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
            <Fld label="Proveedor *">
              <input value={f.proveedor_nombre}
                     onChange={e => set('proveedor_nombre', e.target.value)}
                     placeholder="ej. Distribuidora Suplementos SL" style={inp2} />
            </Fld>
            <Fld label="NIF / CIF / NIE *">
              <input value={f.proveedor_nif}
                     onChange={e => set('proveedor_nif', e.target.value.toUpperCase())}
                     placeholder="B12345678"
                     style={{ ...inp2, fontFamily: 'var(--font-mono)' }} />
            </Fld>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Fld label="Email proveedor">
              <input value={f.proveedor_email}
                     onChange={e => set('proveedor_email', e.target.value)}
                     placeholder="opcional" style={inp2} />
            </Fld>
            <Fld label="Nº factura del proveedor">
              <input value={f.numero_factura}
                     onChange={e => set('numero_factura', e.target.value)}
                     placeholder="A-2026/00123 (opcional)"
                     style={{ ...inp2, fontFamily: 'var(--font-mono)' }} />
            </Fld>
            <Fld label="Fecha *">
              <input type="date" value={f.fecha}
                     onChange={e => set('fecha', e.target.value)} style={inp2} />
            </Fld>
          </div>

          {/* Concepto + cuenta */}
          <Fld label="Concepto *">
            <input value={f.concepto} onChange={e => set('concepto', e.target.value)}
                   placeholder="ej. Suplementación pre-entreno marca X — 12 botes"
                   style={inp2} />
          </Fld>
          <Fld label="Cuenta contable PGC * (regla carajfam)">
            <select value={f.cuenta_contable}
                    onChange={e => set('cuenta_contable', e.target.value)}
                    style={inp2}>
              {CUENTAS_OPCIONES.map(([c, lbl]) =>
                <option key={c} value={c}>{c} · {lbl}</option>
              )}
            </select>
          </Fld>

          {/* Importes */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
            <Fld label="Base imponible (€) *">
              <input type="number" step="0.01" value={f.base}
                     onChange={e => set('base', e.target.value)}
                     style={{ ...inp2, textAlign: 'right',
                              fontFamily: 'var(--font-mono)' }} />
            </Fld>
            <Fld label="IVA %">
              <select value={f.iva_pct} onChange={e => set('iva_pct', e.target.value)}
                      style={inp2}>
                <option value="0">0% exento</option>
                <option value="4">4%</option>
                <option value="10">10%</option>
                <option value="21">21%</option>
              </select>
            </Fld>
            <Fld label="IVA importe (€)">
              <input type="number" step="0.01" value={f.iva_importe}
                     onChange={e => set('iva_importe', e.target.value)}
                     style={{ ...inp2, textAlign: 'right',
                              fontFamily: 'var(--font-mono)' }} />
            </Fld>
            <Fld label="Total (€) *" hint={esRect ? 'Negativo = rectificativa' : null}>
              <input type="number" step="0.01" value={f.total}
                     onChange={e => set('total', e.target.value)}
                     style={{ ...inp2, textAlign: 'right',
                              fontFamily: 'var(--font-mono)',
                              fontWeight: 700, fontSize: 16,
                              color: esRect ? 'var(--red)' : 'var(--text-0)' }} />
            </Fld>
          </div>

          {esRect && (
            <div style={{ padding: 10, borderRadius: 8, background: '#fef3c7',
                           color: '#92400e', fontSize: 12, marginBottom: 12 }}>
              <AlertCircle size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
              Total negativo → se creará como <strong>in_refund</strong> (factura
              rectificativa) en Odoo.
            </div>
          )}

          {/* PDF */}
          <Fld label="PDF de la factura (opcional, se adjunta al asiento Odoo)">
            {f.pdf_url ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center',
                             padding: 8, background: 'var(--bg-2)', borderRadius: 8 }}>
                <FileText size={16} style={{ color: 'var(--green)' }} />
                <a href={f.pdf_url} target="_blank" rel="noreferrer"
                   style={{ flex: 1, color: 'var(--text-0)', fontSize: 12,
                            overflow: 'hidden', textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap' }}>
                  {f.pdf_url.split('/').pop()}
                </a>
                <button onClick={() => set('pdf_url', '')}
                        style={{ background: 'none', border: 'none',
                                 cursor: 'pointer', color: 'var(--red)' }}>
                  <Trash2 size={14} />
                </button>
              </div>
            ) : (
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
                              padding: '8px 14px', borderRadius: 8, fontSize: 13,
                              background: 'var(--green)', color: '#fff',
                              cursor: uploading ? 'wait' : 'pointer',
                              opacity: uploading ? 0.6 : 1 }}>
                <input type="file" accept="application/pdf,image/*"
                       onChange={e => subirPDF(e.target.files?.[0])}
                       style={{ display: 'none' }} />
                {uploading ? <Loader2 size={14} className="animate-spin" />
                          : <Upload size={14} />}
                Subir PDF
              </label>
            )}
          </Fld>

          <Fld label="Notas internas">
            <textarea value={f.notas} onChange={e => set('notas', e.target.value)}
                      rows={2} style={{ ...inp2, resize: 'vertical' }} />
          </Fld>

          <div style={{ padding: 10, borderRadius: 8, background: 'var(--bg-2)',
                         fontSize: 11, color: 'var(--text-3)' }}>
            🔒 Las facturas proveedor quedan en <strong>DRAFT</strong> en Odoo.
            El admin debe validarlas manualmente desde Odoo (regla carajfam).
          </div>
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--line)',
                       display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Btn variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Btn>
          <Btn variant="primary" onClick={submit} disabled={saving}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : null}
            {' '}{isEdit ? 'Guardar cambios' : 'Crear factura'}
          </Btn>
        </div>
      </div>
    </div>
  )
}


function Stat({ label, v, color }) {
  return (
    <Card style={{ padding: 12 }}>
      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4,
                     color: color || 'var(--text-0)',
                     fontFamily: 'var(--font-mono)' }}>{v}</div>
    </Card>
  )
}

function Fld({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 11, color: 'var(--text-3)',
                       marginBottom: 4 }}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 3 }}>{hint}</div>}
    </div>
  )
}

const inp = {
  padding: 7, borderRadius: 6, fontSize: 13, background: 'var(--bg-2)',
  border: '1px solid var(--line)', color: 'var(--text-0)',
}
const inp2 = { ...inp, width: '100%', padding: 8 }
const miniBtn = {
  padding: 7, borderRadius: 6, background: 'var(--bg-2)',
  border: '1px solid var(--line)', color: 'var(--text-2)',
  cursor: 'pointer', display: 'inline-flex', alignItems: 'center',
}
const iconBtn = {
  background: 'transparent', border: 'none', cursor: 'pointer',
  padding: 4, borderRadius: 4, color: 'var(--text-2)',
}
const th = { padding: '8px 6px', fontSize: 11, fontWeight: 600 }
const td = { padding: '8px 6px' }
