// Listado "Recibos emitidos" — Cuotas Clientes → Listado.
//
// Muestra todos los recibos del manager (BD + Odoo unificados via
// /api/cuotas) con filtros (año, mes, forma de pago, estado, tipo, texto),
// orden por cualquier columna y acción "Pagar" inline en los impagados.
// La acción de pago refleja el cobro en Odoo (vía marcar_pagado del backend).
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Loader2, Search, Filter, X, StickyNote, ArrowUp, ArrowDown, ArrowUpDown,
  RefreshCw, Receipt, Download,
} from 'lucide-react'
import { Card, Btn, SectionTitle, Badge } from '../../components/UI'
import { useToast } from '../../components/Toast'
import { cuotasList, FORMA_PAGO_LABELS } from '../../utils/cuotasApi'
import PagarReciboBtn from '../../components/recibos/PagarReciboBtn'
import DevolverReciboBtn from '../../components/recibos/DevolverReciboBtn'
import ModificarReciboBtn from '../../components/recibos/ModificarReciboBtn'

const PERIODICIDAD_LABELS = {
  mensual: 'Mensual', bimensual: 'Bimensual', trimestral: 'Trimestral',
  semestral: 'Semestral', anual: 'Anual',
}

// Forma de pago: añadimos las opciones BD (efectivo, TPV físico/virtual)
// además de las opciones Odoo (sepa, tarjeta_token, enlace_pago).
const FORMA_PAGO_OPCIONES = [
  { id: '', label: 'Todas' },
  { id: 'sepa',             label: 'SEPA' },
  { id: 'tarjeta_token',    label: 'Tarjeta tokenizada' },
  { id: 'tarjeta_tok',      label: 'Tarjeta tokenizada (BD)' },
  { id: 'caja_efectivo',    label: 'Efectivo / caja' },
  { id: 'caja_tpv_fisico',  label: 'TPV físico' },
  { id: 'caja_tpv_virtual', label: 'TPV virtual' },
  { id: 'enlace_pago',      label: 'Enlace de pago' },
  { id: 'tokenizacion',     label: 'Tokenización (legacy)' },
]

// Etiqueta de estado replicando la lógica de la fila (Row) para el Excel.
function estadoLabelDe(r) {
  if (r.state !== 'posted') return 'Borrador'
  switch (r.payment_state) {
    case 'paid':       return 'Cobrado'
    case 'reversed':   return 'Devuelto'
    case 'in_payment': return 'En cobro'
    case 'partial':    return 'Parcial'
    default:           return 'Pendiente'
  }
}


export default function ListadoTab({ identity }) {
  const toast = useToast()
  const [recibos, setRecibos] = useState([])
  const [loading, setLoading] = useState(false)

  // Filtros (vacío = todos). `anio` y `mes` se combinan: si están los dos se
  // envía `mes='2026-06'`; si solo año, se filtra cliente-side por prefijo.
  // Por defecto: año + mes actuales (lo más útil al abrir el tab).
  const [filters, setFilters] = useState(() => {
    const now = new Date()
    return {
      anio: String(now.getFullYear()),
      mes:  String(now.getMonth() + 1).padStart(2, '0'),
      estado: '',
      tipo: '',
      forma_pago: '',
      buscar: '',
    }
  })
  // Orden
  const [sort, setSort] = useState({ col: 'invoice_date', dir: 'desc' })

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const params = {}
      if (filters.anio && filters.mes) params.mes = `${filters.anio}-${filters.mes}`
      // estado al backend solo si es 'paid' o 'not_paid'; los otros filtramos local
      if (filters.estado === 'paid' || filters.estado === 'not_paid') {
        params.estado = filters.estado
      }
      const data = await cuotasList(identity, params)
      setRecibos(data || [])
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setLoading(false)
  }, [identity, filters.anio, filters.mes, filters.estado, toast])

  useEffect(() => { reload() }, [reload])

  // Filtros locales (estado avanzado / tipo / forma_pago / texto / año-solo)
  const filtered = useMemo(() => {
    return recibos.filter(r => {
      // Año solo (sin mes) → filtrar por prefijo
      if (filters.anio && !filters.mes) {
        const yr = (r.mes_ref || r.invoice_date || '').slice(0, 4)
        if (yr !== filters.anio) return false
      }
      // Estado avanzado (in_payment, reversed, draft) — se aplican localmente
      if (filters.estado && !['paid', 'not_paid'].includes(filters.estado)) {
        if (filters.estado === 'draft') {
          if (r.state === 'posted') return false
        } else {
          if (r.payment_state !== filters.estado) return false
        }
      }
      if (filters.tipo && r.tipo !== filters.tipo) return false
      if (filters.forma_pago && r.forma_pago !== filters.forma_pago) return false
      if (filters.buscar) {
        const q = filters.buscar.toLowerCase()
        const cliente = (r.partner_id?.name || '').toLowerCase()
        const cuota = (r.cuota_codigo || '').toLowerCase()
        const idn = String(r.partner_idnoofit || '').toLowerCase()
        if (!cliente.includes(q) && !cuota.includes(q) && !idn.includes(q))
          return false
      }
      return true
    })
  }, [recibos, filters])

  // Ordenación
  const sorted = useMemo(() => {
    const sortFn = (a, b) => {
      const get = (x) => {
        switch (sort.col) {
          case 'cliente':       return (x.partner_id?.name || '').toLowerCase()
          case 'mes_ref':       return x.mes_ref || ''
          case 'cuota_codigo':  return (x.cuota_codigo || '').toLowerCase()
          case 'periodicidad':  return x.periodicidad || ''
          case 'tipo':          return x.tipo || ''
          case 'amount_total':  return Number(x.amount_total || 0)
          case 'forma_pago':    return x.forma_pago || ''
          case 'invoice_date':  return x.invoice_date || ''
          case 'invoice_date_due': return x.invoice_date_due || ''
          case 'payment_state': return x.payment_state || ''
          default: return ''
        }
      }
      const va = get(a), vb = get(b)
      if (va < vb) return sort.dir === 'asc' ? -1 : 1
      if (va > vb) return sort.dir === 'asc' ?  1 : -1
      return 0
    }
    return [...filtered].sort(sortFn)
  }, [filtered, sort])

  const toggleSort = (col) => {
    setSort(s => s.col === col
      ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { col, dir: 'asc' })
  }

  // Exporta a Excel EXACTAMENTE lo que hay filtrado (y en el orden mostrado).
  // xlsx se carga bajo demanda (dynamic import) para no pesar en la carga.
  const exportarExcel = async () => {
    if (!sorted.length) return
    const XLSX = await import('xlsx')
    const rows = sorted.map(r => ({
      'Cliente':       r.partner_id?.name || (r.partner_id?.id ? `#${r.partner_id.id}` : ''),
      'ID cliente':    r.partner_idnoofit || '',
      'Mes':           r.mes_ref || '',
      'Cuota':         r.cuota_codigo || '',
      'Tipo':          r.tipo === 'alta' ? 'Alta' : 'Mensualidad',
      'Periodicidad':  PERIODICIDAD_LABELS[r.periodicidad] || r.periodicidad || '',
      'Importe (€)':   Number(r.amount_total || 0),
      'Forma de pago': FORMA_PAGO_LABELS[r.forma_pago] || r.forma_pago || '',
      'Emisión':       r.invoice_date || '',
      'Cobro':         r.state === 'posted' ? (r.invoice_date_due || '') : '',
      'Estado':        estadoLabelDe(r),
      'Notas':         (r.narration || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    }))
    const header = ['Cliente', 'ID cliente', 'Mes', 'Cuota', 'Tipo', 'Periodicidad',
                    'Importe (€)', 'Forma de pago', 'Emisión', 'Cobro', 'Estado', 'Notas']
    const ws = XLSX.utils.json_to_sheet(rows, { header })
    ws['!cols'] = [{ wch: 26 }, { wch: 12 }, { wch: 9 }, { wch: 18 }, { wch: 12 },
                   { wch: 12 }, { wch: 11 }, { wch: 18 }, { wch: 12 }, { wch: 12 },
                   { wch: 11 }, { wch: 40 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Recibos')
    // Nombre de archivo con los filtros aplicados + fecha de descarga.
    const partes = ['recibos']
    if (filters.anio) partes.push(filters.mes ? `${filters.anio}-${filters.mes}` : filters.anio)
    const estLbl = { paid: 'cobrados', not_paid: 'pendientes', in_payment: 'en-cobro',
                     reversed: 'devueltos', draft: 'borradores' }
    if (filters.estado) partes.push(estLbl[filters.estado] || filters.estado)
    if (filters.tipo) partes.push(filters.tipo)
    if (filters.forma_pago) partes.push(filters.forma_pago)
    if (filters.buscar) partes.push('busq')
    const hoy = new Date().toISOString().slice(0, 10)
    XLSX.writeFile(wb, `${partes.join('_')}_${hoy}.xlsx`)
  }

  // Stats sobre filtrados (no ordenados)
  const totalImporte = filtered.reduce((s, r) => s + (r.amount_total || 0), 0)
  const cobrado = filtered.filter(r => r.payment_state === 'paid')
                          .reduce((s, r) => s + (r.amount_total || 0), 0)
  const pendiente = filtered.filter(r => r.state === 'posted' &&
                                          (r.payment_state === 'not_paid' || r.payment_state === 'reversed'))
                            .reduce((s, r) => s + (r.amount_total || 0), 0)

  // Años disponibles para el selector (de los datos cargados + año actual ± 1)
  const aniosDisponibles = useMemo(() => {
    const yrs = new Set()
    recibos.forEach(r => {
      const y = (r.mes_ref || r.invoice_date || '').slice(0, 4)
      if (y) yrs.add(y)
    })
    const now = new Date().getFullYear()
    yrs.add(String(now)); yrs.add(String(now - 1)); yrs.add(String(now + 1))
    return Array.from(yrs).filter(Boolean).sort().reverse()
  }, [recibos])

  return (
    <div>
      {/* ── Header con título y refrescar ─────────────────────────────── */}
      <Card style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <SectionTitle>
            <Receipt size={18} style={{ marginRight: 8, color: 'var(--green)' }} />
            Recibos emitidos
          </SectionTitle>
          <div style={{ flex: 1 }} />
          <Btn variant="secondary" size="sm" onClick={exportarExcel}
               disabled={loading || sorted.length === 0}
               title={sorted.length === 0
                 ? 'No hay recibos con el filtro actual'
                 : `Exportar ${sorted.length} recibos filtrados a Excel`}>
            <Download size={13} /> Exportar Excel
          </Btn>
          <Btn variant="secondary" size="sm" onClick={reload} disabled={loading}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refrescar
          </Btn>
        </div>

        {/* ── Filtros ───────────────────────────────────────────────────── */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 10, marginTop: 12,
        }}>
          <Field label="Año">
            <select value={filters.anio}
                    onChange={e => setFilters(f => ({ ...f, anio: e.target.value }))}
                    style={inputStyle}>
              <option value="">Todos</option>
              {aniosDisponibles.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </Field>
          <Field label="Mes">
            <select value={filters.mes}
                    onChange={e => setFilters(f => ({ ...f, mes: e.target.value }))}
                    style={inputStyle} disabled={!filters.anio}>
              <option value="">Todos</option>
              {['01','02','03','04','05','06','07','08','09','10','11','12'].map(m =>
                <option key={m} value={m}>{m}</option>
              )}
            </select>
          </Field>
          <Field label="Estado">
            <select value={filters.estado}
                    onChange={e => setFilters(f => ({ ...f, estado: e.target.value }))}
                    style={inputStyle}>
              <option value="">Todos</option>
              <option value="paid">Cobrados</option>
              <option value="not_paid">Pendientes</option>
              <option value="in_payment">En cobro</option>
              <option value="reversed">Devueltos</option>
              <option value="draft">Borradores</option>
            </select>
          </Field>
          <Field label="Tipo">
            <select value={filters.tipo}
                    onChange={e => setFilters(f => ({ ...f, tipo: e.target.value }))}
                    style={inputStyle}>
              <option value="">Todos</option>
              <option value="alta">Alta</option>
              <option value="mensualidad">Mensualidad</option>
            </select>
          </Field>
          <Field label="Forma pago">
            <select value={filters.forma_pago}
                    onChange={e => setFilters(f => ({ ...f, forma_pago: e.target.value }))}
                    style={inputStyle}>
              {FORMA_PAGO_OPCIONES.map(o =>
                <option key={o.id} value={o.id}>{o.label}</option>
              )}
            </select>
          </Field>
          <Field label="Buscar">
            <div style={{ position: 'relative' }}>
              <Search size={13} style={{
                position: 'absolute', left: 8, top: '50%',
                transform: 'translateY(-50%)', color: 'var(--text-3)',
              }} />
              <input type="text" value={filters.buscar}
                     onChange={e => setFilters(f => ({ ...f, buscar: e.target.value }))}
                     placeholder="Cliente / cuota / id…"
                     style={{ ...inputStyle, paddingLeft: 28 }} />
              {filters.buscar && (
                <button onClick={() => setFilters(f => ({ ...f, buscar: '' }))}
                        style={{
                          position: 'absolute', right: 6, top: '50%',
                          transform: 'translateY(-50%)',
                          background: 'none', border: 'none', cursor: 'pointer',
                          color: 'var(--text-3)', padding: 2,
                        }}>
                  <X size={12} />
                </button>
              )}
            </div>
          </Field>
        </div>

        {/* ── Stats ─────────────────────────────────────────────────────── */}
        <div style={{
          display: 'flex', gap: 24, marginTop: 16, paddingTop: 12,
          borderTop: '1px solid var(--line)', flexWrap: 'wrap',
        }}>
          <Stat label="Recibos" value={filtered.length} />
          <Stat label="Total" value={`${totalImporte.toFixed(2)} €`} mono />
          <Stat label="Cobrado" value={`${cobrado.toFixed(2)} €`} mono color="var(--green)" />
          <Stat label="Pendiente" value={`${pendiente.toFixed(2)} €`} mono color="var(--amber)" />
        </div>
      </Card>

      {/* ── Tabla ───────────────────────────────────────────────────────── */}
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
            <Loader2 size={20} className="animate-spin" style={{ color: 'var(--green)' }} />
          </div>
        ) : sorted.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-3)',
                       textAlign: 'center', padding: 32 }}>
            Sin resultados con los filtros aplicados.
          </p>
        ) : (
          <RecibosTable recibos={sorted} sort={sort} toggleSort={toggleSort}
                        onReload={reload} />
        )}
      </Card>
    </div>
  )
}


function Field({ label, children }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{
        fontSize: 10, color: 'var(--text-3)',
        textTransform: 'uppercase', letterSpacing: '0.05em',
        display: 'block', marginBottom: 4,
      }}>{label}</span>
      {children}
    </label>
  )
}

function Stat({ label, value, mono, color }) {
  return (
    <div>
      <div style={{
        fontSize: 10, color: 'var(--text-3)',
        textTransform: 'uppercase', letterSpacing: '0.05em',
      }}>{label}</div>
      <div style={{
        fontSize: 18, fontWeight: 700,
        fontFamily: mono ? 'var(--font-mono)' : 'inherit',
        color: color || 'var(--text-0)',
      }}>{value}</div>
    </div>
  )
}

const inputStyle = {
  padding: '8px 10px', borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--line)', background: 'var(--bg-1)',
  color: 'var(--text-0)', fontSize: 13, width: '100%',
}


// ─── Tabla ──────────────────────────────────────────────────────────────
function RecibosTable({ recibos, sort, toggleSort, onReload }) {
  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <table style={{
        width: '100%', borderCollapse: 'collapse', fontSize: 11,
        tableLayout: 'auto',
      }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--line)',
                        textAlign: 'left', background: 'var(--bg-2)' }}>
            <ThSort col="cliente"      sort={sort} toggle={toggleSort}>Cliente</ThSort>
            <ThSort col="mes_ref"      sort={sort} toggle={toggleSort}>Mes</ThSort>
            <ThSort col="cuota_codigo" sort={sort} toggle={toggleSort}>Cuota</ThSort>
            <ThSort col="tipo"         sort={sort} toggle={toggleSort}>Tipo</ThSort>
            <ThSort col="amount_total" sort={sort} toggle={toggleSort}>Importe</ThSort>
            <ThSort col="forma_pago"   sort={sort} toggle={toggleSort}>F. pago</ThSort>
            <ThSort col="invoice_date" sort={sort} toggle={toggleSort}>Emisión</ThSort>
            <ThSort col="invoice_date_due" sort={sort} toggle={toggleSort}>Cobro</ThSort>
            <ThSort col="payment_state" sort={sort} toggle={toggleSort}>Estado</ThSort>
            <Th>Notas</Th>
            <Th style={{ position: 'sticky', right: 0, zIndex: 3,
                          background: 'var(--bg-2)',
                          boxShadow: '-8px 0 8px -6px rgba(0,0,0,0.28)' }}>Acciones</Th>
          </tr>
        </thead>
        <tbody>
          {recibos.map(r => <Row key={r.id} r={r} onReload={onReload} />)}
        </tbody>
      </table>
    </div>
  )
}

function Row({ r, onReload }) {
  const isPosted = r.state === 'posted'
  const isImpagado = isPosted &&
    (r.payment_state === 'not_paid' || r.payment_state === 'reversed')
  const isCobrado = isPosted && r.payment_state === 'paid'
  const isBd = r._source === 'bd'
  // Junio 2026: modificar disponible para BD en estados no cerrados.
  // El backend re-valida; el botón se oculta para Odoo (sin id_bd).
  const isDevuelto = r.payment_state === 'reversed'
  const isModificable = isBd && (isImpagado || isDevuelto ||
                                  r.estado_bd === 'pendiente' ||
                                  r.estado_bd === 'borrador_remesa')
  // Pagable: impagado/devuelto en Odoo, O recibo BD en estado abierto
  // (pendiente/impagado/devuelto/borrador). Los BD llevan su estado en
  // `estado_bd`, que isImpagado (campos Odoo) no captura → por eso el botón
  // Pagar había desaparecido para esos recibos. (junio 2026)
  const estadoBd = (r.estado_bd || '').toLowerCase()
  const isPagable = isImpagado ||
    (isBd && ['pendiente', 'impagado', 'devuelto', 'borrador_remesa'].includes(estadoBd))
  const stateColor =
    r.payment_state === 'paid'       ? 'green' :
    r.payment_state === 'reversed'   ? 'red'   :
    r.payment_state === 'in_payment' ? 'blue'  :
    !isPosted                        ? 'gray'  : 'amber'
  const stateLabel =
    !isPosted                        ? 'Borrador' :
    r.payment_state === 'paid'       ? 'Cobrado' :
    r.payment_state === 'reversed'   ? 'Devuelto' :
    r.payment_state === 'in_payment' ? 'En cobro' :
    r.payment_state === 'partial'    ? 'Parcial' : 'Pendiente'
  const partnerName = r.partner_id?.name || `#${r.partner_id?.id}`

  return (
    <tr style={{ borderBottom: '1px solid var(--line)' }}>
      <Td title={partnerName} style={{ maxWidth: 200 }}>{partnerName}</Td>
      <Td mono>{r.mes_ref || '—'}</Td>
      <Td>
        {r.cuota_codigo || '—'}
        {isBd && (
          <span title="Recibo aún no facturado a Odoo"
                style={{ marginLeft: 6, fontSize: 9, padding: '1px 5px',
                          borderRadius: 4,
                          background: 'rgba(91,156,246,0.12)',
                          color: 'var(--blue)', fontWeight: 700,
                          letterSpacing: '0.04em' }}>BD</span>
        )}
      </Td>
      <Td>
        <span style={{
          fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999,
          background: r.tipo === 'alta' ? 'rgba(45,212,168,0.12)' : 'var(--bg-3)',
          color: r.tipo === 'alta' ? 'var(--green)' : 'var(--text-2)',
        }}>{r.tipo === 'alta' ? 'Alta' : 'Mens.'}</span>
      </Td>
      <Td mono style={{ fontWeight: 600 }}>{Number(r.amount_total || 0).toFixed(2)} €</Td>
      <Td title={FORMA_PAGO_LABELS[r.forma_pago] || r.forma_pago}>
        {FORMA_PAGO_LABELS[r.forma_pago] || r.forma_pago || '—'}
      </Td>
      <Td mono>{r.invoice_date || '—'}</Td>
      <Td mono>{isPosted ? (r.invoice_date_due || '—') : '—'}</Td>
      <Td><Badge color={stateColor}>{stateLabel}</Badge></Td>
      <NotaCell texto={r.narration} />
      <Td style={{ whiteSpace: 'nowrap', position: 'sticky', right: 0, zIndex: 2,
                    background: 'var(--bg-1)', padding: '8px 6px',
                    boxShadow: '-8px 0 8px -6px rgba(0,0,0,0.28)' }}>
        <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center',
                       flexWrap: 'nowrap' }}>
          {isPagable && <PagarReciboBtn r={r} onReload={onReload} />}
          {isCobrado && isBd && <DevolverReciboBtn r={r} onReload={onReload} />}
          {isModificable && <ModificarReciboBtn r={r} onReload={onReload} />}
          {!isPagable && !(isCobrado && isBd) && !isModificable &&
           <span style={{ color: 'var(--text-3)' }}>—</span>}
        </div>
      </Td>
    </tr>
  )
}


/** Celda compacta para Notas (1 línea + tooltip + click expande). */
function NotaCell({ texto }) {
  const [expanded, setExpanded] = useState(false)
  const raw = (texto || '').trim()
  if (!raw) return <Td style={{ fontSize: 11, color: 'var(--text-3)' }}>—</Td>
  const clean = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  const btnStyle = {
    background: 'none', border: 'none', padding: 0, margin: 0,
    cursor: 'pointer', textAlign: 'left', color: 'inherit',
    font: 'inherit', width: '100%',
    display: 'inline-flex', gap: 6, alignItems: 'flex-start',
  }
  if (expanded) {
    return (
      <Td wrap style={{ fontSize: 11, color: 'var(--text-3)', maxWidth: 200 }}>
        <button type="button" onClick={() => setExpanded(false)}
                title="Click para contraer" style={btnStyle}>
          <StickyNote size={11} style={{ flexShrink: 0, color: 'var(--blue)',
                                          marginTop: 2 }} aria-hidden="true" />
          <span style={{ wordBreak: 'break-word' }}>{clean}</span>
        </button>
      </Td>
    )
  }
  return (
    <Td title={clean} style={{ fontSize: 11, color: 'var(--text-3)', maxWidth: 140 }}>
      <button type="button" onClick={() => setExpanded(true)}
              title={clean} style={btnStyle}>
        <StickyNote size={11} style={{ flexShrink: 0, color: 'var(--blue)' }}
                    aria-hidden="true" />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis',
                       whiteSpace: 'nowrap', flex: 1 }}>{clean}</span>
      </button>
    </Td>
  )
}


// ─── Cabecera ordenable ─────────────────────────────────────────────────
function ThSort({ col, sort, toggle, children }) {
  const active = sort.col === col
  const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown
  return (
    <th style={{
      padding: '8px 8px', fontSize: 10, fontWeight: 600,
      color: active ? 'var(--green)' : 'var(--text-3)',
      textTransform: 'uppercase', letterSpacing: '0.04em',
      whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none',
    }} onClick={() => toggle(col)}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {children}
        <Icon size={10} style={{ opacity: active ? 1 : 0.4 }} />
      </span>
    </th>
  )
}

function Th({ children, style }) {
  return <th style={{
    padding: '8px 8px', fontSize: 10, fontWeight: 600, color: 'var(--text-3)',
    textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap',
    ...(style || {}),
  }}>{children}</th>
}

function Td({ children, mono, style, wrap, title }) {
  const tip = title ?? (typeof children === 'string' ? children : undefined)
  return <td title={tip} style={{
    padding: '8px 8px',
    fontFamily: mono ? 'var(--font-mono)' : 'inherit',
    color: 'var(--text-1)',
    whiteSpace: wrap ? 'normal' : 'nowrap',
    overflow: wrap ? 'visible' : 'hidden',
    textOverflow: wrap ? 'clip' : 'ellipsis',
    wordBreak: wrap ? 'break-word' : 'normal',
    verticalAlign: 'middle',
    ...(style || {}),
  }}>{children}</td>
}
