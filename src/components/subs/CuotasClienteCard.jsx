// Card "Cuota y fechas" para el perfil de cliente.
// Lista las subscriptions del cliente (activas + canceladas), permite
// añadir/editar/cancelar cada una. Cualquier modificación cierra la actual
// y crea una nueva (histórico estricto).
import { useEffect, useMemo, useState } from 'react'
import { Plus, Edit2, X as XIcon, Check, Loader2, CalendarDays, CreditCard } from 'lucide-react'
import { Card, Btn, Badge, SectionTitle } from '../UI'
import { useToast } from '../Toast'
import { useAuth } from '../../contexts/AuthContext'
import {
  listSubsByCliente, cuotasCatalogo, descuentosCatalogo,
  createSub, replaceSub, cancelSub, getRoundIdentity,
  listFormasPagoCliente, createFormaPago, cancelFormaPago,
} from '../../utils/subscriptionsApi'
import Modal from '../Modal'

const PERIODICIDADES = [
  { id: 'mensual', label: 'Mensual' },
  { id: 'trimestral', label: 'Trimestral' },
  { id: 'semestral', label: 'Semestral' },
  { id: 'anual',     label: 'Anual' },
]
const FORMAS_PAGO = [
  { id: 'sepa',          label: 'SEPA' },
  { id: 'tarjeta_token', label: 'Tarjeta tokenizada' },
  { id: 'efectivo',      label: 'Efectivo / caja' },
  { id: 'enlace_pago',   label: 'Enlace de pago' },
]

function precioCuota(cuota, periodicidad) {
  if (!cuota) return 0
  return Number(cuota[`precio_${periodicidad}`] || 0)
}
function fmt(d) {
  if (!d) return '—'
  try {
    return new Date(d).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch { return d }
}


export default function CuotasClienteCard({ cliente }) {
  const { user } = useAuth()
  const identity = useMemo(() => getRoundIdentity(user), [user])
  const toast = useToast()
  const [subs, setSubs] = useState([])
  const [cuotas, setCuotas] = useState([])
  const [descuentos, setDescuentos] = useState([])
  const [formasPago, setFormasPago] = useState([])    // historial completo
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)   // { mode: 'create'|'replace', sid?: int }
  const [editingFP, setEditingFP] = useState(false)   // edición forma de pago

  async function reload() {
    setLoading(true)
    try {
      const [s, c, d, fp] = await Promise.all([
        listSubsByCliente(identity, cliente.id),
        cuotasCatalogo(identity).catch(() => []),
        descuentosCatalogo(identity).catch(() => []),
        listFormasPagoCliente(identity, cliente.id).catch(() => []),
      ])
      setSubs(s.subs || [])
      setCuotas(c)
      setDescuentos(d)
      setFormasPago(fp)
    } catch (e) {
      toast.error(`Error cargando suscripciones: ${e.message}`)
    } finally { setLoading(false) }
  }
  useEffect(() => { if (cliente?.id) reload() }, [cliente?.id])

  const activas = subs.filter(s => s.estado === 'activa')
  const canceladas = subs.filter(s => s.estado !== 'activa')

  const totalMensual = activas.reduce((sum, s) => {
    const c = cuotas.find(c => c.id === s.cuota_id?.id)
    return sum + precioCuota(c, s.periodicidad === 'mensual' ? 'mensual' : 'mensual')
  }, 0)

  return (
    <Card style={{ padding: 24 }}>
      <SectionTitle>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <CalendarDays size={16} aria-hidden="true" /> Cuota y fechas
        </span>
      </SectionTitle>

      {/* Sección cuotas activas */}
      <div style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <strong style={{ fontSize: 12, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Cuotas
          </strong>
          <Btn size="sm" variant="primary" onClick={() => setEditing({ mode: 'create' })}>
            <Plus size={11} /> Asignar nueva cuota
          </Btn>
        </div>

        {loading ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-3)' }}>
            <Loader2 size={16} className="animate-spin" />
          </div>
        ) : activas.length === 0 ? (
          <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-3)',
                         border: '1px dashed var(--line-2)', borderRadius: 10, fontSize: 13 }}>
            Sin cuota asignada — el cliente no recibirá recibos hasta que se le asigne una.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {activas.map(s => {
              const cuota = cuotas.find(c => c.id === s.cuota_id?.id)
              const precio = precioCuota(cuota, s.periodicidad)
              return (
                <SubRow key={s.id} sub={s} cuota={cuota} precio={precio}
                        onEdit={() => setEditing({ mode: 'replace', sid: s.id, sub: s })}
                        onCancel={async () => {
                          const motivo = window.prompt('Motivo de cancelación (opcional):') || ''
                          if (motivo === null) return
                          try {
                            await cancelSub(identity, s.id, { motivo })
                            toast.success('Cuota cancelada')
                            reload()
                          } catch (e) { toast.error(`Error: ${e.message}`) }
                        }} />
              )
            })}
            {activas.length > 1 && (
              <div style={{ marginTop: 6, padding: '8px 12px', borderRadius: 8,
                             background: 'var(--green-bg)', color: 'var(--green)', fontSize: 12, fontWeight: 600 }}>
                Total mensual cuotas activas: {totalMensual.toFixed(2)} €
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── FORMA DE PAGO (1 activa por cliente, con histórico) ── */}
      <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <strong style={{ fontSize: 12, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.05em',
                            display: 'flex', alignItems: 'center', gap: 6 }}>
            <CreditCard size={12} aria-hidden="true" /> Forma de pago
          </strong>
          <Btn size="sm" variant="primary" onClick={() => setEditingFP(true)}>
            <Edit2 size={11} /> Cambiar
          </Btn>
        </div>
        {(() => {
          const activa = formasPago.find(f => f.estado === 'activa')
          const canceladas = formasPago.filter(f => f.estado !== 'activa')
          return (
            <>
              {activa ? (
                <div style={{
                  padding: '12px 14px', borderRadius: 10,
                  border: '1px solid var(--blue-border)', background: 'var(--blue-bg)',
                  display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                }}>
                  <strong style={{ fontSize: 14, color: 'var(--text-0)' }}>
                    {labelFormaPago(activa.forma_pago)}
                  </strong>
                  <Badge color="blue">activa</Badge>
                  {activa.iban && <span style={{ fontSize: 12, color: 'var(--text-2)', fontFamily: 'monospace' }}>
                    {activa.iban}
                  </span>}
                  {activa.card_last4 && <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
                    •••• {activa.card_last4}{activa.card_brand ? ` ${activa.card_brand}` : ''}
                  </span>}
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-3)' }}>
                    desde {fmt(activa.fecha_inicio)}
                  </span>
                </div>
              ) : (
                <div style={{ padding: 14, textAlign: 'center', color: 'var(--text-3)',
                                border: '1px dashed var(--line-2)', borderRadius: 10, fontSize: 13 }}>
                  Sin forma de pago configurada
                </div>
              )}
              {canceladas.length > 0 && (
                <details style={{ marginTop: 8 }}>
                  <summary style={{ cursor: 'pointer', fontSize: 11, color: 'var(--text-3)' }}>
                    Histórico ({canceladas.length})
                  </summary>
                  <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {canceladas.map(f => (
                      <div key={f.id} style={{ padding: '6px 10px', background: 'var(--bg-2)', borderRadius: 6,
                                                 fontSize: 11, color: 'var(--text-2)', display: 'flex', gap: 8 }}>
                        <span>{labelFormaPago(f.forma_pago)}</span>
                        {f.iban && <span style={{ fontFamily: 'monospace' }}>{f.iban}</span>}
                        <span style={{ marginLeft: 'auto', color: 'var(--text-3)' }}>
                          {fmt(f.fecha_inicio)} → {fmt(f.fecha_fin)}
                        </span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </>
          )
        })()}
      </div>

      {editingFP && (
        <FormaPagoModal
          identity={identity}
          cliente={cliente}
          actual={formasPago.find(f => f.estado === 'activa')}
          onClose={() => setEditingFP(false)}
          onSaved={() => { setEditingFP(false); reload() }}
        />
      )}

      {/* Histórico canceladas */}
      {canceladas.length > 0 && (
        <details style={{ marginTop: 16 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--text-3)', textTransform: 'uppercase',
                             letterSpacing: '0.05em' }}>
            Cuotas inactivas ({canceladas.length})
          </summary>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {canceladas.map(s => (
              <div key={s.id} style={{
                padding: '8px 12px', borderRadius: 8, background: 'var(--bg-2)',
                fontSize: 12, color: 'var(--text-2)',
                display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
              }}>
                <Badge color="gray">{s.cuota_id?.name}</Badge>
                <span>{s.periodicidad}</span>
                <span style={{ color: 'var(--text-3)' }}>·</span>
                <span>{fmt(s.fecha_inicio)} → {fmt(s.fecha_fin)}</span>
                <span style={{ marginLeft: 'auto', color: 'var(--text-3)' }}>{s.estado}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Modal edición */}
      {editing && (
        <SubEditModal
          identity={identity}
          cliente={cliente}
          mode={editing.mode}
          sub={editing.sub}
          cuotasCatalogo={cuotas}
          descuentosCatalogo={descuentos}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload() }}
        />
      )}

      {/* Fechas clave del cliente — al final, separadas */}
      <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
        <strong style={{ fontSize: 12, color: 'var(--text-2)', textTransform: 'uppercase',
                          letterSpacing: '0.05em', display: 'block', marginBottom: 10 }}>
          Fechas
        </strong>
        <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
          <Field label="Alta" value={fmt(cliente.dtCreated || cliente.fechaAlta)} />
          <Field label="Última edición" value={fmt(cliente.editionDate)} />
        </dl>
      </div>
    </Card>
  )
}


function SubRow({ sub, cuota, precio, onEdit, onCancel }) {
  return (
    <div style={{
      padding: '12px 14px', borderRadius: 10,
      border: '1px solid var(--green-border)', background: 'var(--green-bg)',
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
    }}>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 14, color: 'var(--text-0)' }}>
            {sub.cuota_id?.name || 'Cuota'}
          </strong>
          <Badge color="green">activa</Badge>
          <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{sub.periodicidad}</span>
          {sub.forma_pago && (
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>· {sub.forma_pago}</span>
          )}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
          desde {fmt(sub.fecha_inicio)}
          {sub.descuentos_activos_ids?.length > 0 && (
            <span> · con descuento</span>
          )}
        </div>
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--green)' }}>
        {precio ? `${precio.toFixed(2)} €` : '—'}
      </div>
      <Btn size="sm" variant="secondary" onClick={onEdit}>
        <Edit2 size={11} /> Editar
      </Btn>
      <Btn size="sm" variant="secondary" onClick={onCancel}>
        <XIcon size={11} /> Cancelar
      </Btn>
    </div>
  )
}


function SubEditModal({ identity, cliente, mode, sub, cuotasCatalogo, descuentosCatalogo, onClose, onSaved }) {
  const toast = useToast()
  const [cuotaId, setCuotaId] = useState(sub?.cuota_id?.id || '')
  const [periodicidad, setPeriodicidad] = useState(sub?.periodicidad || 'mensual')
  const [formaPago, setFormaPago] = useState(sub?.forma_pago || 'sepa')
  const [fechaInicio, setFechaInicio] = useState(sub?.fecha_inicio || new Date().toISOString().slice(0, 10))
  const [descuentoIds, setDescuentoIds] = useState(sub?.descuentos_activos_ids || [])
  const [motivo, setMotivo] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const cuotaSel = cuotasCatalogo.find(c => c.id === Number(cuotaId))
  const precio = cuotaSel ? Number(cuotaSel[`precio_${periodicidad}`] || 0) : 0

  const isEdit = mode === 'replace'

  const handleConfirm = async () => {
    if (!cuotaId) { toast.error('Selecciona una cuota'); return }
    setSubmitting(true)
    try {
      const payload = {
        cliente_idnoofit: cliente.id,
        cuota_id: Number(cuotaId),
        periodicidad, forma_pago: formaPago,
        fecha_inicio: fechaInicio,
        descuento_ids: descuentoIds.map(Number),
      }
      if (isEdit) {
        payload.motivo = motivo || 'Cambio de cuota / periodicidad / descuento'
        await replaceSub(identity, sub.id, payload)
        toast.success('Cuota reemplazada (la antigua queda cancelada en histórico)')
      } else {
        await createSub(identity, payload)
        toast.success('Cuota asignada')
      }
      onSaved()
    } catch (e) { toast.error(`Error: ${e.message}`) }
    finally { setSubmitting(false) }
  }

  return (
    <Modal open={true} onClose={onClose} maxWidth={520}
           title={isEdit ? `Modificar cuota: ${sub?.cuota_id?.name}` : 'Asignar nueva cuota'}>
      <div style={{ padding: 24, flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {!confirming ? (
          <>
            <Field2 label="Cuota *">
              <select value={cuotaId} onChange={e => setCuotaId(e.target.value)} style={inputStyle}>
                <option value="">— Selecciona —</option>
                {cuotasCatalogo.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.codigo} — {c.descripcion} (mensual: {c.precio_mensual?.toFixed?.(2) || c.precio_mensual} €)
                  </option>
                ))}
              </select>
            </Field2>
            <Field2 label="Periodicidad *">
              <select value={periodicidad} onChange={e => setPeriodicidad(e.target.value)} style={inputStyle}>
                {PERIODICIDADES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </Field2>
            <Field2 label="Forma de pago *">
              <select value={formaPago} onChange={e => setFormaPago(e.target.value)} style={inputStyle}>
                {FORMAS_PAGO.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            </Field2>
            <Field2 label="Fecha inicio">
              <input type="date" value={fechaInicio} onChange={e => setFechaInicio(e.target.value)} style={inputStyle} />
            </Field2>
            {descuentosCatalogo.length > 0 && (
              <Field2 label="Descuento">
                <select value={descuentoIds[0] || ''}
                        onChange={e => setDescuentoIds(e.target.value ? [Number(e.target.value)] : [])}
                        style={inputStyle}>
                  <option value="">(ninguno)</option>
                  {descuentosCatalogo.map(d => (
                    <option key={d.id} value={d.id}>
                      {d.codigo} — {d.descripcion} ({d.tipo === 'porcentaje' ? d.valor + '%' : d.valor + ' €'})
                    </option>
                  ))}
                </select>
              </Field2>
            )}
            {isEdit && (
              <Field2 label="Motivo del cambio (opcional)">
                <input value={motivo} onChange={e => setMotivo(e.target.value)} style={inputStyle}
                       placeholder="Ej. cambio de plan / petición del cliente..." />
              </Field2>
            )}
          </>
        ) : (
          // Confirmación
          <div>
            <div style={{ padding: 14, borderRadius: 10,
                           background: 'var(--amber-bg)', border: '1px solid var(--amber-border)',
                           color: 'var(--amber)', marginBottom: 16, fontSize: 13 }}>
              <strong>⚠ Confirmación necesaria</strong> — esta operación tiene impacto contable.
            </div>
            <h4 style={{ fontSize: 14, color: 'var(--text-0)', marginBottom: 10 }}>Cambios a aplicar:</h4>
            <ul style={{ fontSize: 13, color: 'var(--text-1)', lineHeight: 1.7, paddingLeft: 18 }}>
              {isEdit && (
                <>
                  <li>Se <strong>cancelará</strong> la suscripción <strong>{sub.cuota_id?.name}</strong> ({sub.periodicidad})
                    con fecha fin <strong>hoy</strong>.</li>
                  <li>Quedará en histórico (cuotas inactivas).</li>
                </>
              )}
              <li>Se <strong>{isEdit ? 'creará una nueva' : 'creará la'}</strong> suscripción:
                <ul>
                  <li>Cuota: <strong>{cuotaSel?.codigo} — {cuotaSel?.descripcion}</strong></li>
                  <li>Periodicidad: <strong>{periodicidad}</strong></li>
                  <li>Forma de pago: <strong>{formaPago}</strong></li>
                  <li>Inicio: <strong>{fechaInicio}</strong></li>
                  <li>Importe: <strong>{precio.toFixed(2)} €</strong> por {periodicidad}</li>
                  {descuentoIds.length > 0 && (
                    <li>Descuento: <strong>{descuentosCatalogo.find(d => d.id === descuentoIds[0])?.codigo}</strong></li>
                  )}
                </ul>
              </li>
              {isEdit && motivo && <li>Motivo: <em>{motivo}</em></li>}
            </ul>
          </div>
        )}
      </div>
      <div style={{ padding: '16px 24px', borderTop: '1px solid var(--line)',
                     display: 'flex', gap: 10, justifyContent: 'flex-end',
                     flexShrink: 0, background: 'var(--bg-2)' }}>
        {confirming ? (
          <>
            <Btn variant="secondary" onClick={() => setConfirming(false)} disabled={submitting}>
              Volver atrás
            </Btn>
            <Btn variant="primary" onClick={handleConfirm} disabled={submitting}>
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Confirmar y aplicar
            </Btn>
          </>
        ) : (
          <>
            <Btn variant="secondary" onClick={onClose}>Cancelar</Btn>
            <Btn variant="primary" onClick={() => {
              if (!cuotaId) { toast.error('Selecciona una cuota'); return }
              setConfirming(true)
            }}>
              Aceptar modificación
            </Btn>
          </>
        )}
      </div>
    </Modal>
  )
}


function Field({ label, value }) {
  return (
    <div>
      <span style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </span>
      <div style={{ fontSize: 13, color: 'var(--text-1)' }}>{value}</div>
    </div>
  )
}
function Field2({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 12, color: 'var(--text-3)', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  )
}
const inputStyle = {
  width: '100%', padding: 10, borderRadius: 10, fontSize: 13,
  background: 'var(--bg-2)', border: '1px solid var(--line)', color: 'var(--text-0)',
}


function labelFormaPago(f) {
  switch (f) {
    case 'sepa':           return 'SEPA'
    case 'tarjeta_token':  return 'Tarjeta tokenizada'
    case 'efectivo':       return 'Efectivo / caja'
    case 'enlace_pago':    return 'Enlace de pago'
    default:               return f || '—'
  }
}


function FormaPagoModal({ identity, cliente, actual, onClose, onSaved }) {
  const toast = useToast()
  const [forma, setForma] = useState(actual?.forma_pago || 'sepa')
  const [iban, setIban] = useState(actual?.iban || '')
  const [ibanTitular, setIbanTitular] = useState(actual?.iban_titular || '')
  const [bic, setBic] = useState(actual?.bic || '')
  const [cardToken, setCardToken] = useState(actual?.card_token || '')
  const [cardBrand, setCardBrand] = useState(actual?.card_brand || '')
  const [cardLast4, setCardLast4] = useState(actual?.card_last4 || '')
  const [motivo, setMotivo] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const handleSave = async () => {
    setSubmitting(true)
    try {
      const payload = {
        cliente_idnoofit: cliente.id,
        forma_pago: forma,
        ...(forma === 'sepa' ? { iban, iban_titular: ibanTitular || null, bic: bic || null } : {}),
        ...(forma === 'tarjeta_token' ? {
          card_token: cardToken, card_brand: cardBrand || null, card_last4: cardLast4 || null,
        } : {}),
        motivo_cambio: motivo || (actual ? 'Cambio de forma de pago' : 'Alta forma de pago'),
      }
      await createFormaPago(identity, payload)
      toast.success(actual ? 'Forma de pago actualizada (anterior queda en histórico)' : 'Forma de pago asignada')
      onSaved()
    } catch (e) { toast.error(`Error: ${e.message}`) }
    finally { setSubmitting(false) }
  }

  return (
    <Modal open={true} onClose={onClose} maxWidth={520}
           title={actual ? 'Cambiar forma de pago' : 'Asignar forma de pago'}>
      <div style={{ padding: 24, flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {!confirming ? (
          <>
            <Field2 label="Forma de pago *">
              <select value={forma} onChange={e => setForma(e.target.value)} style={inputStyle}>
                <option value="sepa">SEPA</option>
                <option value="tarjeta_token">Tarjeta tokenizada</option>
                <option value="efectivo">Efectivo / caja</option>
                <option value="enlace_pago">Enlace de pago</option>
              </select>
            </Field2>
            {forma === 'sepa' && (
              <>
                <Field2 label="IBAN *">
                  <input value={iban} onChange={e => setIban(e.target.value.toUpperCase())}
                         placeholder="ES00 0000 0000 0000 0000 0000" style={inputStyle} />
                </Field2>
                <Field2 label="Titular (si distinto del cliente)">
                  <input value={ibanTitular} onChange={e => setIbanTitular(e.target.value)} style={inputStyle} />
                </Field2>
                <Field2 label="BIC">
                  <input value={bic} onChange={e => setBic(e.target.value.toUpperCase())} style={inputStyle} />
                </Field2>
              </>
            )}
            {forma === 'tarjeta_token' && (
              <>
                <Field2 label="Token de tarjeta *">
                  <input value={cardToken} onChange={e => setCardToken(e.target.value)} style={inputStyle} />
                </Field2>
                <Field2 label="Marca tarjeta (Visa / MasterCard)">
                  <input value={cardBrand} onChange={e => setCardBrand(e.target.value)} style={inputStyle} />
                </Field2>
                <Field2 label="Últimos 4 dígitos">
                  <input value={cardLast4} maxLength={4}
                         onChange={e => setCardLast4(e.target.value.replace(/\D/g, ''))}
                         style={inputStyle} />
                </Field2>
              </>
            )}
            {actual && (
              <Field2 label="Motivo del cambio (opcional)">
                <input value={motivo} onChange={e => setMotivo(e.target.value)} style={inputStyle}
                       placeholder="Cambio de banco / etc." />
              </Field2>
            )}
          </>
        ) : (
          <div>
            <div style={{ padding: 14, borderRadius: 10, marginBottom: 16,
                           background: 'var(--amber-bg)', border: '1px solid var(--amber-border)',
                           color: 'var(--amber)', fontSize: 13 }}>
              <strong>⚠ Confirmación necesaria</strong> — todos los recibos futuros se cobrarán por esta forma.
            </div>
            <h4 style={{ fontSize: 14, color: 'var(--text-0)', marginBottom: 10 }}>Cambios:</h4>
            <ul style={{ fontSize: 13, color: 'var(--text-1)', lineHeight: 1.7, paddingLeft: 18 }}>
              {actual && <li>Se cancelará la forma actual: <strong>{labelFormaPago(actual.forma_pago)}</strong></li>}
              <li>Se establecerá: <strong>{labelFormaPago(forma)}</strong>
                {forma === 'sepa' && iban && <> (IBAN: <code>{iban}</code>)</>}
                {forma === 'tarjeta_token' && cardLast4 && <> (•••• {cardLast4})</>}
              </li>
              {motivo && <li>Motivo: <em>{motivo}</em></li>}
            </ul>
          </div>
        )}
      </div>
      <div style={{ padding: '16px 24px', borderTop: '1px solid var(--line)',
                     display: 'flex', gap: 10, justifyContent: 'flex-end',
                     flexShrink: 0, background: 'var(--bg-2)' }}>
        {confirming ? (
          <>
            <Btn variant="secondary" onClick={() => setConfirming(false)} disabled={submitting}>Volver</Btn>
            <Btn variant="primary" onClick={handleSave} disabled={submitting}>
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Confirmar y aplicar
            </Btn>
          </>
        ) : (
          <>
            <Btn variant="secondary" onClick={onClose}>Cancelar</Btn>
            <Btn variant="primary" onClick={() => {
              if (forma === 'sepa' && !iban.trim()) { toast.error('IBAN requerido para SEPA'); return }
              if (forma === 'tarjeta_token' && !cardToken.trim()) { toast.error('Token tarjeta requerido'); return }
              setConfirming(true)
            }}>
              Aceptar modificación
            </Btn>
          </>
        )}
      </div>
    </Modal>
  )
}
