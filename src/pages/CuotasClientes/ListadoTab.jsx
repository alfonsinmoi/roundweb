import { useState, useEffect } from 'react'
import { Loader2, Search, Filter, X } from 'lucide-react'
import { Card, Btn, SectionTitle, Badge } from '../../components/UI'
import { useToast } from '../../components/Toast'
import { cuotasList, FORMA_PAGO_LABELS } from '../../utils/cuotasApi'

const PERIODICIDAD_LABELS = {
  mensual: 'Mensual', bimensual: 'Bimensual', trimestral: 'Trimestral',
  semestral: 'Semestral', anual: 'Anual',
}

export default function ListadoTab({ identity }) {
  const toast = useToast()
  const [recibos, setRecibos] = useState([])
  const [loading, setLoading] = useState(false)
  const [filters, setFilters] = useState({
    mes: '',
    estado: '',
    tipo: '',
    forma_pago: '',
    buscar: '',
  })

  async function reload() {
    setLoading(true)
    try {
      const params = {}
      if (filters.mes)        params.mes = filters.mes
      if (filters.estado)     params.estado = filters.estado
      const data = await cuotasList(identity, params)
      setRecibos(data || [])
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setLoading(false)
  }

  useEffect(() => { reload() }, [identity.managerId, identity.trainerId])

  // Filtros locales (tipo / forma_pago / texto)
  const filtered = recibos.filter(r => {
    if (filters.tipo && r.tipo !== filters.tipo) return false
    if (filters.forma_pago && r.forma_pago !== filters.forma_pago) return false
    if (filters.buscar) {
      const q = filters.buscar.toLowerCase()
      const cliente = (r.partner_id?.name || '').toLowerCase()
      const cuota = (r.cuota_codigo || '').toLowerCase()
      if (!cliente.includes(q) && !cuota.includes(q)) return false
    }
    return true
  })

  const totalImporte = filtered.reduce((s, r) => s + (r.amount_total || 0), 0)
  const cobrado = filtered.filter(r => r.payment_state === 'paid').reduce((s, r) => s + (r.amount_total || 0), 0)
  const pendiente = filtered.filter(r => r.state === 'posted' && (r.payment_state === 'not_paid' || r.payment_state === 'reversed')).reduce((s, r) => s + (r.amount_total || 0), 0)

  return (
    <div>
      <Card style={{ padding: 20, marginBottom: 16 }}>
        <SectionTitle action={<Btn variant="secondary" size="sm" onClick={reload}>Recargar</Btn>}>
          <Filter size={16} style={{ marginRight: 8 }} /> Filtros
        </SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginTop: 12 }}>
          <Field label="Mes">
            <input type="month" value={filters.mes} onChange={e => setFilters(f => ({ ...f, mes: e.target.value }))}
                   style={inputStyle} />
          </Field>
          <Field label="Estado pago">
            <select value={filters.estado} onChange={e => setFilters(f => ({ ...f, estado: e.target.value }))}
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
            <select value={filters.tipo} onChange={e => setFilters(f => ({ ...f, tipo: e.target.value }))}
                    style={inputStyle}>
              <option value="">Todos</option>
              <option value="alta">Alta</option>
              <option value="mensualidad">Mensualidad</option>
            </select>
          </Field>
          <Field label="Forma pago">
            <select value={filters.forma_pago} onChange={e => setFilters(f => ({ ...f, forma_pago: e.target.value }))}
                    style={inputStyle}>
              <option value="">Todas</option>
              <option value="sepa">SEPA</option>
              <option value="tarjeta_token">Tarjeta tokenizada</option>
              <option value="enlace_pago">Enlace/Caja</option>
            </select>
          </Field>
          <Field label="Buscar">
            <div style={{ position: 'relative' }}>
              <Search size={13} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }} />
              <input type="text" value={filters.buscar} onChange={e => setFilters(f => ({ ...f, buscar: e.target.value }))}
                     placeholder="Cliente o cuota…"
                     style={{ ...inputStyle, paddingLeft: 28 }} />
            </div>
          </Field>
        </div>

        {/* Stats */}
        <div style={{ display: 'flex', gap: 24, marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--line)', flexWrap: 'wrap' }}>
          <Stat label="Recibos" value={filtered.length} />
          <Stat label="Total" value={`${totalImporte.toFixed(2)} €`} mono />
          <Stat label="Cobrado" value={`${cobrado.toFixed(2)} €`} mono color="var(--green)" />
          <Stat label="Pendiente" value={`${pendiente.toFixed(2)} €`} mono color="var(--amber)" />
        </div>
      </Card>

      <Card style={{ padding: 20 }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
            <Loader2 size={20} className="animate-spin" style={{ color: 'var(--green)' }} />
          </div>
        ) : filtered.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-3)', textAlign: 'center', padding: 32 }}>
            Sin resultados con los filtros aplicados.
          </p>
        ) : (
          <RecibosTable recibos={filtered} />
        )}
      </Card>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  )
}

function Stat({ label, value, mono, color }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
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

// Tabla local (no reutilizamos la de ClientProfile para evitar dep cruzada)
function RecibosTable({ recibos }) {
  return (
    <div style={{ width: '100%' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--line)', textAlign: 'left' }}>
            <Th>Cliente</Th>
            <Th>Mes</Th>
            <Th>Cuota</Th>
            <Th>Periodicidad</Th>
            <Th>Tipo</Th>
            <Th>Importe</Th>
            <Th>Forma pago</Th>
            <Th>Día emisión</Th>
            <Th>Día cobro</Th>
            <Th>Estado</Th>
            <Th>Notas</Th>
          </tr>
        </thead>
        <tbody>
          {recibos.map(r => <Row key={r.id} r={r} />)}
        </tbody>
      </table>
    </div>
  )
}

function Row({ r }) {
  const isPosted = r.state === 'posted'
  const stateColor =
    r.payment_state === 'paid'      ? 'green' :
    r.payment_state === 'reversed'  ? 'red'   :
    r.payment_state === 'in_payment'? 'blue'  :
    !isPosted                       ? 'gray'  : 'yellow'
  const stateLabel =
    !isPosted                       ? 'Borrador' :
    r.payment_state === 'paid'      ? 'Cobrado' :
    r.payment_state === 'reversed'  ? 'Devuelto' :
    r.payment_state === 'in_payment'? 'En cobro' :
    r.payment_state === 'partial'   ? 'Parcial' : 'Pendiente'
  const partnerName = r.partner_id?.name || `#${r.partner_id?.id}`

  return (
    <tr>
      <Td title={partnerName}>{partnerName}</Td>
      <Td mono>{r.mes_ref || '—'}</Td>
      <Td>{r.cuota_codigo || '—'}</Td>
      <Td>{PERIODICIDAD_LABELS[r.periodicidad] || r.periodicidad || '—'}</Td>
      <Td>
        <span style={{
          fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999,
          background: r.tipo === 'alta' ? 'rgba(45,212,168,0.12)' : 'var(--bg-3)',
          color: r.tipo === 'alta' ? 'var(--green)' : 'var(--text-2)',
        }}>{r.tipo === 'alta' ? 'Alta' : 'Mens.'}</span>
      </Td>
      <Td mono style={{ fontWeight: 600 }}>{r.amount_total?.toFixed(2)} €</Td>
      <Td title={FORMA_PAGO_LABELS[r.forma_pago] || r.forma_pago}>{FORMA_PAGO_LABELS[r.forma_pago] || r.forma_pago || '—'}</Td>
      <Td mono>{r.invoice_date || '—'}</Td>
      <Td mono>{isPosted ? (r.invoice_date_due || '—') : '—'}</Td>
      <Td><Badge color={stateColor}>{stateLabel}</Badge></Td>
      <Td wrap title={r.narration || ''} style={{ fontSize: 11, color: 'var(--text-3)' }}>
        {r.narration || '—'}
      </Td>
    </tr>
  )
}

function Th({ children }) {
  return <th style={{
    padding: '8px 8px', fontSize: 10, fontWeight: 600, color: 'var(--text-3)',
    textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap',
  }}>{children}</th>
}

function Td({ children, mono, style, wrap, title }) {
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
