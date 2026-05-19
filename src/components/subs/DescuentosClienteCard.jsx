// Card "Descuentos del cliente" — para el perfil del cliente.
// Muestra los descuentos asignados al cliente (activos arriba, histórico
// debajo) y permite asignar nuevos del catálogo.
import { useEffect, useMemo, useState } from 'react'
import { Plus, Loader2, Tag, X as XIcon } from 'lucide-react'
import { Card, Btn, Badge, SectionTitle } from '../UI'
import { useToast } from '../Toast'
import { useAuth } from '../../contexts/AuthContext'
import {
  getRoundIdentity, descuentosList, asignacionesClienteList,
  asignacionCreate, asignacionDelete,
} from '../../utils/configApi'

function fmt(d) {
  if (!d) return '—'
  try {
    return new Date(d).toLocaleDateString('es-ES',
      { day: 'numeric', month: 'short', year: 'numeric' })
  } catch { return d }
}

function descLabel(a) {
  if (a.tipo === 'porcentaje') return `${a.valor}%`
  if (a.tipo === 'precio_combo')
    return `Combo ${a.cuota_requerida_codigo}+${a.cuota_aplicada_codigo} → ${a.precio_final}€`
  if (a.tipo === 'varias_cuotas') {
    const sec = Array.isArray(a.combo_secundarias) ? a.combo_secundarias : []
    if (sec.length === 1) return `Combo ${a.cuota_requerida_codigo}+${sec[0].cuota_codigo} → ${sec[0].precio}€`
    return `Combo ${a.cuota_requerida_codigo} → ${sec.length} cuotas`
  }
  return `${a.valor}€`
}

// Los descuentos automáticos (acumulación de cuotas, familiares) se gestionan
// por el sistema al cumplir/dejar de cumplir la condición. El trainer NO debe
// quitarlos manualmente.
function esAcumulacion(tipo) {
  return tipo === 'varias_cuotas' || tipo === 'precio_combo' || tipo === 'familiares'
}

export default function DescuentosClienteCard({ cliente }) {
  const { user } = useAuth()
  const identity = useMemo(() => getRoundIdentity(user), [user])
  const toast = useToast()

  const [catalogo, setCatalogo] = useState([])
  const [asignaciones, setAsignaciones] = useState([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [selDescId, setSelDescId] = useState('')
  const [saving, setSaving] = useState(false)

  async function reload() {
    if (!cliente?.id) return
    setLoading(true)
    try {
      const [cat, asig] = await Promise.all([
        descuentosList(identity).catch(() => []),
        asignacionesClienteList(identity, cliente.id).catch(() => []),
      ])
      setCatalogo((cat || []).filter(d => d.active !== false))
      setAsignaciones(asig || [])
    } catch (e) {
      toast.error(`Error cargando descuentos: ${e.message}`)
    } finally { setLoading(false) }
  }
  useEffect(() => { reload() }, [cliente?.id])

  const activas = asignaciones.filter(a => a.estado === 'activa')
  const historico = asignaciones.filter(a => a.estado !== 'activa')
  const idsActivas = new Set(activas.map(a => a.descuento_id))
  const disponibles = catalogo.filter(d => !idsActivas.has(d.id))

  async function handleAsignar() {
    if (!selDescId) return
    setSaving(true)
    try {
      await asignacionCreate(identity, parseInt(selDescId, 10), {
        clientes_idnoofit: [String(cliente.id)],
        id_trainer: identity.trainerId || cliente.idTrainer || identity.managerId,
      })
      toast.success('Descuento asignado')
      setSelDescId(''); setAdding(false)
      reload()
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setSaving(false)
  }

  async function handleQuitar(asig) {
    if (!confirm(`¿Quitar el descuento "${asig.codigo}"?`)) return
    try {
      await asignacionDelete(identity, asig.descuento_id, asig.asig_id)
      toast.success('Descuento quitado')
      reload()
    } catch (e) { toast.error(`Error: ${e.message}`) }
  }

  return (
    <Card style={{ padding: 24 }}>
      <SectionTitle>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Tag size={16} aria-hidden="true" /> Descuentos
        </span>
      </SectionTitle>

      {loading ? (
        <div style={{ padding: 20, textAlign: 'center' }}>
          <Loader2 size={18} className="animate-spin" style={{ color: 'var(--green)' }} />
        </div>
      ) : (
        <>
          {/* Activos */}
          <div style={{ marginTop: 12 }}>
            <p style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase',
                        letterSpacing: '0.04em', marginBottom: 6 }}>
              Activos ({activas.length})
            </p>
            {activas.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--text-3)', fontStyle: 'italic' }}>
                Sin descuentos activos.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {activas.map(a => {
                  const auto = esAcumulacion(a.tipo)
                  return (
                  <div key={a.asig_id} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 10px', borderRadius: 8,
                    background: 'var(--green-bg)', border: '1px solid var(--green-border)',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-0)', margin: 0,
                                  display: 'flex', alignItems: 'center', gap: 6 }}>
                        {a.codigo}
                        {auto && (
                          <span title="Descuento por acumulación de cuotas — automático" style={{
                            fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
                            background: 'var(--blue)', color: '#fff', letterSpacing: '0.04em',
                          }}>AUTO</span>
                        )}
                      </p>
                      <p style={{ fontSize: 11, color: 'var(--text-2)', margin: '2px 0 0' }}>
                        {descLabel(a)}{a.descripcion ? ` · ${a.descripcion}` : ''}
                      </p>
                      <p style={{ fontSize: 10, color: 'var(--text-3)', margin: '2px 0 0' }}>
                        Desde {fmt(a.fecha_desde || a.created_at)}
                      </p>
                    </div>
                    {auto ? (
                      <span title="No se puede quitar: se asigna automáticamente al cumplir la combinación de cuotas. Para desactivarlo, quita una de las cuotas del cliente o desactiva el descuento en Configuración."
                            style={{ color: 'var(--text-3)', padding: 4, cursor: 'help' }}>
                        🔒
                      </span>
                    ) : (
                      <button onClick={() => handleQuitar(a)}
                              title="Quitar"
                              style={{ background: 'none', border: 'none',
                                       cursor: 'pointer', color: 'var(--red)', padding: 4 }}>
                        <XIcon size={14} />
                      </button>
                    )}
                  </div>
                )})}
              </div>
            )}

            {!adding ? (
              <Btn variant="secondary" size="sm" onClick={() => setAdding(true)}
                   style={{ marginTop: 8 }}>
                <Plus size={12} /> Añadir descuento
              </Btn>
            ) : (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <select value={selDescId} onChange={e => setSelDescId(e.target.value)}
                        style={inputStyle}>
                  <option value="">— Selecciona descuento —</option>
                  {disponibles.map(d => (
                    <option key={d.id} value={d.id}>
                      {d.codigo} · {d.tipo === 'porcentaje' ? `${d.valor}%`
                                    : d.tipo === 'precio_combo'
                                      ? `combo ${d.precio_final}€`
                                      : `${d.valor}€`}
                    </option>
                  ))}
                </select>
                <div style={{ display: 'flex', gap: 6 }}>
                  <Btn variant="primary" size="sm" onClick={handleAsignar}
                       disabled={!selDescId || saving}>
                    {saving ? <Loader2 size={12} className="animate-spin" /> : 'Aceptar'}
                  </Btn>
                  <Btn variant="secondary" size="sm"
                       onClick={() => { setAdding(false); setSelDescId('') }}>
                    Cancelar
                  </Btn>
                </div>
              </div>
            )}
          </div>

          {/* Histórico */}
          {historico.length > 0 && (
            <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
              <p style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase',
                          letterSpacing: '0.04em', marginBottom: 6 }}>
                Histórico ({historico.length})
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {historico.slice(0, 6).map(a => (
                  <div key={a.asig_id} style={{
                    display: 'flex', alignItems: 'center', gap: 6, fontSize: 11,
                    padding: '4px 8px', borderRadius: 6, background: 'var(--bg-2)',
                    color: 'var(--text-2)',
                  }}>
                    <Badge color="gray">{a.estado}</Badge>
                    <span style={{ flex: 1 }}>{a.codigo} · {descLabel(a)}</span>
                    <span style={{ color: 'var(--text-3)' }}>{fmt(a.updated_at)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  )
}

const inputStyle = {
  padding: '8px 10px', borderRadius: 8, fontSize: 13,
  background: 'var(--bg-2)', border: '1px solid var(--line)', color: 'var(--text-0)',
}
