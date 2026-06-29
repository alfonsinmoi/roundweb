import { useState, useEffect, useMemo } from 'react'
import { Plus, Pencil, Trash2, Check, X, RefreshCw, Download, Loader2, Users, List } from 'lucide-react'
import { Card, Btn, Badge, Avatar } from '../../components/UI'
import { useToast } from '../../components/Toast'
import {
  descuentosList, descuentoCreate, descuentoUpdate, descuentoDelete, descuentoAdoptar,
  asignacionesList, asignacionCreate, asignacionDelete,
  TIPOS_DESCUENTO, RELACIONES_TRABAJADOR, cuotasList,
} from '../../utils/configApi'
import { trabajadoresList } from '../../utils/horarioApi'
import { getClientes, getActividades } from '../../utils/api'
import { coincideTexto } from '../../utils/texto'
import { useCan } from '../../hooks/useCan'


// Aplica un descuento a un precio base. Compartido entre AsignarModal (lista
// resultados al asignar a clientes) y el editor de descuento (preview en vivo
// de cuánto queda cada cuota). Devuelve número redondeado a 2 decimales o null.
function aplicarDescuento(precioBase, valor, unidad) {
  if (!precioBase || isNaN(Number(precioBase))) return null
  const v = Number(valor) || 0
  let res
  if (unidad === 'porcentaje') res = precioBase * (1 - v / 100)
  else res = precioBase - v
  return Math.max(0, Math.round(res * 100) / 100)
}

// Estilo inline para fórmulas embedded en el texto de ayuda.
const inlineCodeStyle = {
  background: 'var(--bg-2)', padding: '1px 6px', borderRadius: 4,
  fontFamily: 'var(--font-mono, monospace)', fontSize: 11,
  color: 'var(--text-1)',
}


export default function DescuentosTab({ identity }) {
  const toast = useToast()
  const canCrear = useCan('configuracion.descuentos.crear')
  const canBorrar = useCan('configuracion.descuentos.borrar')
  const canAdoptar = useCan('configuracion.descuentos.adoptar')
  const canAsignar = useCan('configuracion.descuentos.asignar_a_cliente')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [asignandoDesc, setAsignandoDesc] = useState(null)  // descuento sobre el que abrir modal de asignar
  const [verAsignadosDesc, setVerAsignadosDesc] = useState(null)  // descuento sobre el que ver lista de asignados
  const isTrainer = !!identity.trainerId

  async function reload() {
    setLoading(true)
    try {
      setItems(await descuentosList(identity) || [])
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setLoading(false)
  }

  useEffect(() => { reload() }, [identity.managerId, identity.trainerId])

  async function onAdoptar(id) {
    try { await descuentoAdoptar(identity, id); toast.success('Plantilla adoptada'); reload() }
    catch (e) { toast.error(e.message) }
  }
  async function onDelete(d) {
    if (!confirm(`¿Eliminar "${d.codigo}"?`)) return
    try { await descuentoDelete(identity, d.id); toast.success('Descuento eliminado'); reload() }
    catch (e) { toast.error(e.message) }
  }

  const plantillas = items.filter(d => d.scope === 'plantilla_manager')
  const propios    = items.filter(d => d.scope === 'trainer')

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14, gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: 'var(--text-2)' }}>
          {loading ? 'Cargando…' : `${items.length} descuento${items.length !== 1 ? 's' : ''}`}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn variant="secondary" size="sm" onClick={reload}><RefreshCw size={13} /> Refrescar</Btn>
          {canCrear && (
            <Btn variant="primary" size="sm" onClick={() => setEditing({})}><Plus size={13} /> Nuevo</Btn>
          )}
        </div>
      </div>

      {plantillas.length > 0 && (
        <Section titulo={isTrainer ? 'Plantillas del manager' : 'Plantillas (manager)'}>
          {plantillas.map(d => (
            <DescRow key={d.id} d={d} isTrainer={isTrainer}
                     onEdit={!isTrainer ? () => setEditing(d) : null}
                     onDelete={!isTrainer && canBorrar ? () => onDelete(d) : null}
                     onAsignar={!isTrainer && canAsignar ? () => setAsignandoDesc(d) : null}
                     onVerAsignados={!isTrainer ? () => setVerAsignadosDesc(d) : null}
                     onAdoptar={isTrainer && canAdoptar && !items.some(t => t.scope === 'trainer' && t.plantilla_origen_id === d.id) ? () => onAdoptar(d.id) : null} />
          ))}
        </Section>
      )}

      {propios.length > 0 && (
        <Section titulo={isTrainer ? 'Mis descuentos' : 'Descuentos por centro'}>
          {propios.map(d => (
            <DescRow key={d.id} d={d} isTrainer={isTrainer}
                     onEdit={() => setEditing(d)}
                     onDelete={canBorrar ? () => onDelete(d) : null}
                     onAsignar={canAsignar ? () => setAsignandoDesc(d) : null} />
          ))}
        </Section>
      )}

      {!loading && items.length === 0 && (
        <Card style={{ padding: 32, textAlign: 'center' }}>
          <p style={{ fontSize: 14, color: 'var(--text-3)' }}>Sin descuentos. Crea el primero con «Nuevo».</p>
        </Card>
      )}

      {editing && (
        <DescForm desc={editing} identity={identity}
                  onClose={() => setEditing(null)}
                  onSaved={() => { setEditing(null); reload() }} />
      )}

      {asignandoDesc && (
        <AsignarModal desc={asignandoDesc} identity={identity}
                      onClose={() => setAsignandoDesc(null)} />
      )}

      {verAsignadosDesc && (
        <ClientesAsignadosModal desc={verAsignadosDesc} identity={identity}
                                onClose={() => setVerAsignadosDesc(null)} />
      )}
    </div>
  )
}


function Section({ titulo, children }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700,
                   color: 'var(--text-3)', textTransform: 'uppercase',
                   letterSpacing: '0.05em', marginBottom: 8 }}>{titulo}</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
    </div>
  )
}

function DescRow({ d, isTrainer, onEdit, onDelete, onAdoptar, onAsignar, onVerAsignados }) {
  return (
    <Card style={{ padding: '12px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, color: 'var(--text-0)' }}>{d.codigo}</span>
            <Badge color={d.tipo === 'porcentaje' ? 'green'
                          : d.tipo === 'familiares' ? 'amber' : 'blue'}>
              {d.tipo === 'porcentaje' ? `${d.valor}%`
                : d.tipo === 'varias_cuotas' ? `Combo (${(d.combo_secundarias || []).length} cuotas)`
                : d.tipo === 'precio_combo' ? `${d.precio_final ?? '?'}€ combo`
                : d.tipo === 'familiares' ? `Familiares · ${(d.combo_secundarias || []).length || 1} actividad${((d.combo_secundarias || []).length || 1) !== 1 ? 'es' : ''}`
                : `${d.valor}€`}
            </Badge>
            {!d.active && <Badge color="gray">Inactivo</Badge>}
            {d.plantilla_origen_id && <Badge color="blue">Adoptada</Badge>}
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>{d.descripcion}</p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {onAsignar && <Btn variant="secondary" size="sm" onClick={onAsignar}><Users size={12} /> Asignar</Btn>}
          {onVerAsignados && <Btn variant="secondary" size="sm" onClick={onVerAsignados}><List size={12} /> Clientes asignados</Btn>}
          {onAdoptar && <Btn variant="secondary" size="sm" onClick={onAdoptar}><Download size={12} /> Adoptar</Btn>}
          {onEdit && <Btn variant="secondary" size="sm" onClick={onEdit}><Pencil size={12} /></Btn>}
          {onDelete && <Btn variant="danger" size="sm" onClick={onDelete}><Trash2 size={12} /></Btn>}
        </div>
      </div>
    </Card>
  )
}


// ── Modal: asignar descuento a clientes ──────────────────────────────────────
function AsignarModal({ desc, identity, onClose }) {
  const toast = useToast()
  const canBorrarAsig = useCan('configuracion.descuentos.borrar_asignacion')
  const [clientes, setClientes] = useState([])
  const [asignaciones, setAsignaciones] = useState([])
  const [familias, setFamilias] = useState(null) // sólo cuando tipo='familiares'
  const [cuotasCat, setCuotasCat] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(new Set())
  const [fechaDesde, setFechaDesde] = useState(new Date().toISOString().slice(0, 10))
  const [fechaHasta, setFechaHasta] = useState('')
  const [saving, setSaving] = useState(false)
  // Para familiar_trabajador: selección de trabajador + relación
  const [trabajadores, setTrabajadores] = useState([])
  const [trabajadorId, setTrabajadorId] = useState('')
  const [relacion, setRelacion] = useState('')
  const [relacionOtro, setRelacionOtro] = useState('')

  const isFamiliares = desc.tipo === 'familiares'
  const isFamiliarTrab = desc.tipo === 'familiar_trabajador'

  async function loadAll() {
    setLoading(true)
    try {
      const [cls, resp, cuotas] = await Promise.all([
        getClientes(),
        asignacionesList(identity, desc.id),
        cuotasList(identity),
      ])
      setClientes(cls || [])
      setCuotasCat(cuotas || [])
      if (isFamiliarTrab) {
        trabajadoresList(identity, { estado: 'activo' })
          .then(t => setTrabajadores(t || []))
          .catch(() => setTrabajadores([]))
      }
      if (resp?.tipo === 'familiares') {
        setFamilias(resp.familias || [])
        setAsignaciones([])
      } else {
        setAsignaciones(resp?.asignaciones || [])
        setFamilias(null)
      }
    } catch (e) { toast.error(e.message) }
    setLoading(false)
  }
  useEffect(() => { loadAll() }, [desc.id])

  const yaAsignados = new Set(asignaciones.map(a => String(a.cliente_idnoofit)))
  const candidatos = clientes.filter(c => {
    const id = String(c.id)
    if (yaAsignados.has(id)) return false
    if (!search) return true
    const q = search.toLowerCase()
    return (c.nombre || c.name || '').toLowerCase().includes(q)
        || (c.apellidos || c.surname || '').toLowerCase().includes(q)
        || (c.email || '').toLowerCase().includes(q)
        || id.includes(q)
  })

  function toggleSelect(id) {
    const s = new Set(selected)
    if (s.has(id)) s.delete(id); else s.add(id)
    setSelected(s)
  }

  // Relación efectiva: si eligió "Otro" usa el texto libre
  const relacionFinal = relacion === 'Otro' ? relacionOtro.trim() : relacion

  async function onAsignar() {
    if (selected.size === 0) { toast.error('Selecciona al menos 1 cliente'); return }
    if (isFamiliarTrab) {
      if (!trabajadorId) { toast.error('Selecciona el trabajador'); return }
      if (!relacionFinal) { toast.error('Indica la relación con el trabajador'); return }
    }
    setSaving(true)
    try {
      const body = {
        clientes_idnoofit: [...selected],
        fecha_desde: fechaDesde || null,
        fecha_hasta: fechaHasta || null,
      }
      if (isFamiliarTrab) {
        body.trabajador_id = Number(trabajadorId)
        body.relacion = relacionFinal
      }
      const r = await asignacionCreate(identity, desc.id, body)
      const nCreadas = r.creadas?.length ?? 0
      const nExist = r.ya_existentes?.length ?? 0
      toast.success(`${nCreadas} asignaciones creadas${nExist ? `, ${nExist} ya existían` : ''}`)
      setSelected(new Set())
      loadAll()
    } catch (e) { toast.error(e.message) }
    setSaving(false)
  }

  async function onRevocar(asigId) {
    try {
      await asignacionDelete(identity, desc.id, asigId)
      toast.success('Asignación revocada')
      loadAll()
    } catch (e) { toast.error(e.message) }
  }

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }}
         style={{ position: 'fixed', inset: 0, zIndex: 600, background: 'rgba(0,0,0,0.6)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: 'var(--bg-1)', borderRadius: 'var(--radius-lg)', width: '100%',
                    maxWidth: 720, maxHeight: '90vh', overflow: 'hidden',
                    boxShadow: 'var(--shadow-lg)', display: 'flex', flexDirection: 'column' }}>
        <header style={{ padding: '18px 22px', borderBottom: '1px solid var(--line)',
                         display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--text-0)' }}>
              Asignar descuento <span style={{ color: 'var(--green)' }}>{desc.codigo}</span> a clientes
            </h2>
            <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '2px 0 0' }}>
              {desc.tipo === 'porcentaje' ? `${desc.valor}%`
                : desc.tipo === 'varias_cuotas'
                  ? `Combo: ${desc.cuota_requerida_codigo} → ${(desc.combo_secundarias||[]).length} cuotas`
                  : desc.tipo === 'precio_combo'
                    ? `Combo: ${desc.cuota_requerida_codigo} + ${desc.cuota_aplicada_codigo} → ${desc.precio_final}€`
                    : `${desc.valor}€`} · {desc.descripcion}
            </p>
          </div>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 8,
                  border: '1px solid var(--line)', background: 'var(--bg-3)',
                  color: 'var(--text-2)', cursor: 'pointer' }}><X size={14} /></button>
        </header>

        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14, overflow: 'auto', flex: 1 }}>
          {/* Caso 'familiares': agrupado por familia, sin asignación manual */}
          {isFamiliares && (() => {
            const cuotasDesc = (desc.combo_secundarias && desc.combo_secundarias.length > 0)
              ? desc.combo_secundarias
              : (desc.cuota_aplicada_codigo
                  ? [{cuota_codigo: desc.cuota_aplicada_codigo,
                      valor: desc.valor, unidad: desc.unidad || 'porcentaje'}]
                  : [])
            return (
              <div>
                <p style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 10, lineHeight: 1.5 }}>
                  Este descuento se aplica <strong>automáticamente</strong> a
                  cada actividad cuando hay <strong>≥ 2 miembros</strong> activos
                  con esa cuota en la misma familia.
                </p>
                {cuotasDesc.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                    {cuotasDesc.map(c => {
                      // Buscar cuota en catálogo para mostrar precio resultante
                      const cuota = cuotasCat.find(x => x.codigo === c.cuota_codigo)
                      const precioBase = cuota?.precio_mensual ?? cuota?.precio_trimestral ?? null
                      const precioFinal = precioBase != null
                        ? aplicarDescuento(precioBase, c.valor, c.unidad)
                        : null
                      return (
                        <div key={c.cuota_codigo} style={{
                          fontSize: 12, padding: '8px 12px', borderRadius: 8,
                          background: 'var(--amber-bg)', border: '1px solid var(--amber-border)',
                          color: 'var(--text-1)',
                          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                        }}>
                          <strong style={{ color: 'var(--text-0)' }}>{c.cuota_codigo}</strong>
                          {precioBase != null && (
                            <>
                              <span style={{ color: 'var(--text-3)' }}>
                                {precioBase.toFixed(2)}€/mes
                              </span>
                              <span style={{ color: 'var(--amber)', fontWeight: 600 }}>
                                {c.unidad === 'porcentaje' ? `−${c.valor}%` : `−${c.valor}€`}
                              </span>
                              <span style={{ color: 'var(--text-3)' }}>→</span>
                              <strong style={{ color: 'var(--green)', fontSize: 13 }}>
                                {precioFinal.toFixed(2)}€/mes
                              </strong>
                              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                                (ahorra {(precioBase - precioFinal).toFixed(2)}€)
                              </span>
                            </>
                          )}
                          {precioBase == null && (
                            <span style={{ color: 'var(--text-3)' }}>
                              {c.unidad === 'porcentaje' ? `−${c.valor}%` : `−${c.valor}€`}
                              {' '}
                              <em>(precio base no disponible)</em>
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
                {loading ? (
                  <p style={{ fontSize: 13, color: 'var(--text-3)' }}>Cargando familias…</p>
                ) : (familias || []).length === 0 ? (
                  <p style={{ fontSize: 13, color: 'var(--text-3)' }}>
                    No hay familias creadas todavía. Crea grupos familiares desde
                    la pestaña «Familiares» del perfil del cliente.
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {(familias || []).map(fam => (
                      <div key={fam.familia_id} style={{
                        border: `1px solid ${fam.aplica ? 'var(--green-border)' : 'var(--line)'}`,
                        borderRadius: 'var(--radius-sm)',
                        background: fam.aplica ? 'var(--green-bg)' : 'var(--bg-2)',
                        padding: 12,
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between',
                                      alignItems: 'center', marginBottom: 8 }}>
                          <div>
                            <span style={{ fontWeight: 700, color: 'var(--text-0)', fontSize: 13 }}>
                              {fam.nombre || `Familia #${fam.familia_id}`}
                            </span>
                            <span style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 8 }}>
                              {fam.miembros.length} miembro{fam.miembros.length !== 1 ? 's' : ''}
                            </span>
                          </div>
                          {fam.aplica
                            ? <Badge color="green">Aplica</Badge>
                            : <Badge color="gray">No aplica</Badge>}
                        </div>
                        {/* Resumen por cuota: nº de miembros con cada actividad */}
                        {(fam.cuotas_aplicadas || []).length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4,
                                        marginBottom: 8 }}>
                            {fam.cuotas_aplicadas.map(c => (
                              <span key={c.cuota_codigo} style={{
                                fontSize: 10, padding: '2px 6px',
                                borderRadius: 4,
                                background: c.aplica ? 'var(--green)' : 'var(--bg-3)',
                                color: c.aplica ? '#fff' : 'var(--text-3)',
                              }} title={c.aplica
                                ? `${c.n_miembros} miembros con ${c.cuota_codigo} → descuento aplicado`
                                : `Sólo ${c.n_miembros} miembro con ${c.cuota_codigo} (hacen falta ≥ 2)`}>
                                {c.cuota_codigo}: {c.n_miembros}
                              </span>
                            ))}
                          </div>
                        )}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {fam.miembros.map(m => (
                            <div key={m.cliente_idnoofit} style={{
                              display: 'flex', alignItems: 'center', gap: 8,
                              fontSize: 12, color: 'var(--text-1)',
                            }}>
                              <span style={{
                                width: 8, height: 8, borderRadius: '50%',
                                background: (m.cuotas_activas || []).length > 0
                                  ? 'var(--green)' : 'var(--text-3)',
                              }} />
                              <span style={{ flex: 1 }}>
                                {m.cliente_nombre || `#${m.cliente_idnoofit}`}
                              </span>
                              <span style={{ fontSize: 10, color: 'var(--text-3)',
                                             fontFamily: 'var(--font-mono)' }}>
                                #{m.cliente_idnoofit}
                              </span>
                              <span style={{ fontSize: 10,
                                             color: (m.cuotas_activas || []).length > 0
                                                    ? 'var(--green)' : 'var(--text-3)' }}>
                                {(m.cuotas_activas || []).length > 0
                                  ? m.cuotas_activas.join(', ')
                                  : '—'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })()}

          {/* Asignaciones existentes — combo con scroll, todos por nombre */}
          {!isFamiliares && asignaciones.length > 0 && (() => {
            // Resolver nombre: primero el que viene del backend (Odoo), si no
            // está, lookup en `clientes` cargados, y finalmente fallback al
            // ID. Ordenamos alfabéticamente para que sea fácil escanear.
            const filas = asignaciones.map(a => {
              let nombre = (a.cliente_nombre || '').trim()
              if (!nombre) {
                const c = clientes.find(x => String(x.id) === String(a.cliente_idnoofit))
                if (c) {
                  nombre = `${c.nombre || c.name || ''} ${c.apellidos || c.surname || ''}`.trim()
                }
              }
              if (!nombre) nombre = `#${a.cliente_idnoofit}`
              return { ...a, _nombre: nombre }
            }).sort((x, y) => x._nombre.localeCompare(y._nombre, 'es', { sensitivity: 'base' }))

            return (
              <div>
                <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)',
                            textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
                  Ya asignados ({asignaciones.length})
                </p>
                <div style={{
                  border: '1px solid var(--green-border)',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--green-bg)',
                  maxHeight: 180, overflowY: 'auto',
                }}>
                  {filas.map(a => (
                    <div key={a.id} style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '6px 10px',
                      borderBottom: '1px solid var(--green-border)',
                      fontSize: 12, color: 'var(--text-1)',
                    }}>
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden',
                                     textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                            title={a._nombre}>
                        {a._nombre}
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--text-3)',
                                     fontFamily: 'var(--font-mono)' }}>
                        #{a.cliente_idnoofit}
                      </span>
                      {canBorrarAsig && (
                        <button onClick={() => onRevocar(a.id)} title="Revocar"
                                style={{ background: 'none', border: 'none', cursor: 'pointer',
                                         color: 'var(--red)', padding: 2, display: 'flex' }}>
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}

          {/* Familiar de trabajador: selector de trabajador + relación */}
          {isFamiliarTrab && (
            <div style={{
              padding: 14, borderRadius: 10,
              background: 'var(--blue-bg)', border: '1px solid var(--blue-border)',
              display: 'flex', flexDirection: 'column', gap: 12,
            }}>
              <p style={{ fontSize: 12, color: 'var(--text-2)', margin: 0, lineHeight: 1.5 }}>
                Este descuento es para <strong>familiares de un trabajador</strong>.
                Elige el trabajador y la relación; se aplicarán a los clientes que
                marques abajo.
              </p>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)',
                               textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Trabajador *
                </span>
                <select value={trabajadorId} onChange={e => setTrabajadorId(e.target.value)}
                        style={inputStyle}>
                  <option value="">— Selecciona trabajador —</option>
                  {trabajadores.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.nombre_completo || t.nombre || `#${t.id}`}{t.nif ? ` · ${t.nif}` : ''}
                    </option>
                  ))}
                </select>
                {trabajadores.length === 0 && (
                  <span style={{ fontSize: 11, color: 'var(--text-3)', fontStyle: 'italic' }}>
                    No hay trabajadores activos (requiere módulo Control horario).
                  </span>
                )}
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: relacion === 'Otro' ? '1fr 1fr' : '1fr', gap: 8 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)',
                                 textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Relación *
                  </span>
                  <select value={relacion} onChange={e => setRelacion(e.target.value)}
                          style={inputStyle}>
                    <option value="">— Selecciona relación —</option>
                    {RELACIONES_TRABAJADOR.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </label>
                {relacion === 'Otro' && (
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)',
                                   textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Especifica
                    </span>
                    <input value={relacionOtro} onChange={e => setRelacionOtro(e.target.value)}
                           placeholder="Ej. Suegro/a" style={inputStyle} />
                  </label>
                )}
              </div>
            </div>
          )}

          {/* Buscador + lista — sólo para descuentos manuales */}
          {!isFamiliares && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8, marginBottom: 8 }}>
              <input type="text" placeholder="Buscar cliente por nombre, email o ID…"
                     value={search} onChange={e => setSearch(e.target.value)}
                     style={inputStyle} />
              <input type="date" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)}
                     title="Vigente desde"
                     style={{ ...inputStyle, width: 140 }} />
              <input type="date" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)}
                     title="Vigente hasta (vacío = sin fin)"
                     style={{ ...inputStyle, width: 140 }} />
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6 }}>
              {candidatos.length} cliente{candidatos.length !== 1 ? 's' : ''} disponibles · {selected.size} seleccionado{selected.size !== 1 ? 's' : ''}
            </p>
            <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)',
                          background: 'var(--bg-2)', maxHeight: 300, overflowY: 'auto' }}>
              {loading ? (
                <p style={{ padding: 16, fontSize: 13, color: 'var(--text-3)' }}>Cargando…</p>
              ) : candidatos.length === 0 ? (
                <p style={{ padding: 16, fontSize: 13, color: 'var(--text-3)' }}>
                  {search ? 'Sin coincidencias' : 'Todos los clientes ya están asignados o no hay clientes en NoofitPro'}
                </p>
              ) : candidatos.slice(0, 200).map(c => {
                const id = String(c.id)
                const isSel = selected.has(id)
                const nombre = `${c.nombre || c.name || ''} ${c.apellidos || c.surname || ''}`.trim()
                return (
                  <label key={id} style={{ display: 'flex', alignItems: 'center', gap: 10,
                                           padding: '8px 12px', borderBottom: '1px solid var(--line)',
                                           cursor: 'pointer',
                                           background: isSel ? 'var(--green-bg)' : 'transparent' }}>
                    <input type="checkbox" checked={isSel} onChange={() => toggleSelect(id)} />
                    <Avatar nombre={nombre} size={28} imgUrl={c.imgUrl} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 13, color: 'var(--text-0)', fontWeight: 500 }}>{nombre || `#${id}`}</p>
                      <p style={{ fontSize: 11, color: 'var(--text-3)' }}>{c.email}</p>
                    </div>
                    <span style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>#{id}</span>
                  </label>
                )
              })}
              {candidatos.length > 200 && (
                <p style={{ padding: 12, fontSize: 12, color: 'var(--text-3)', textAlign: 'center' }}>
                  Mostrando primeros 200. Refina la búsqueda para ver más.
                </p>
              )}
            </div>
          </div>
          )}
        </div>

        <footer style={{ padding: '14px 22px', borderTop: '1px solid var(--line)',
                         display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn variant="secondary" onClick={onClose}>Cerrar</Btn>
          {!isFamiliares && (
            <Btn variant="primary" onClick={onAsignar} disabled={saving || selected.size === 0}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {saving ? ' Asignando…' : ` Asignar (${selected.size})`}
            </Btn>
          )}
        </footer>
      </div>
    </div>
  )
}


// ── Modal: lista filtrable de clientes asignados a un descuento ──────────────
function ClientesAsignadosModal({ desc, identity, onClose }) {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [asignaciones, setAsignaciones] = useState([])
  const [familias, setFamilias] = useState(null)
  const [clientes, setClientes] = useState([])
  const [search, setSearch] = useState('')
  const [estadoFiltro, setEstadoFiltro] = useState('todos') // todos|vigentes|caducados
  const [relacionFiltro, setRelacionFiltro] = useState('')   // sólo familiar_trabajador
  const isFamiliarTrab = desc.tipo === 'familiar_trabajador'
  const isFamiliares = desc.tipo === 'familiares'

  useEffect(() => {
    let cancel = false
    setLoading(true)
    Promise.all([asignacionesList(identity, desc.id), getClientes().catch(() => [])])
      .then(([resp, cls]) => {
        if (cancel) return
        if (resp?.tipo === 'familiares') {
          setFamilias(resp.familias || [])
          setAsignaciones([])
        } else {
          setAsignaciones(resp?.asignaciones || [])
          setFamilias(null)
        }
        setClientes(cls || [])
      })
      .catch(e => toast.error(e.message))
      .finally(() => { if (!cancel) setLoading(false) })
    return () => { cancel = true }
  }, [desc.id])

  const hoy = new Date().toISOString().slice(0, 10)
  function esVigente(a) {
    if (a.fecha_desde && a.fecha_desde > hoy) return false
    if (a.fecha_hasta && a.fecha_hasta < hoy) return false
    return true
  }

  const filas = useMemo(() => {
    return asignaciones.map(a => {
      let nombre = (a.cliente_nombre || '').trim()
      if (!nombre) {
        const c = clientes.find(x => String(x.id) === String(a.cliente_idnoofit))
        if (c) nombre = `${c.nombre || c.name || ''} ${c.apellidos || c.surname || ''}`.trim()
      }
      if (!nombre) nombre = `#${a.cliente_idnoofit}`
      return { ...a, _nombre: nombre, _vigente: esVigente(a) }
    }).filter(a => {
      if (estadoFiltro === 'vigentes' && !a._vigente) return false
      if (estadoFiltro === 'caducados' && a._vigente) return false
      if (relacionFiltro && (a.relacion || '') !== relacionFiltro) return false
      if (!search) return true
      return coincideTexto(a._nombre, search)
          || coincideTexto(String(a.cliente_idnoofit), search)
          || coincideTexto(a.trabajador_nombre || '', search)
          || coincideTexto(a.trabajador_nif || '', search)
          || coincideTexto(a.relacion || '', search)
    }).sort((x, y) => x._nombre.localeCompare(y._nombre, 'es', { sensitivity: 'base' }))
  }, [asignaciones, clientes, search, estadoFiltro, relacionFiltro])

  // Relaciones presentes para el filtro
  const relacionesPresentes = useMemo(() => {
    const s = new Set(asignaciones.map(a => a.relacion).filter(Boolean))
    return [...s].sort()
  }, [asignaciones])

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }}
         style={{ position: 'fixed', inset: 0, zIndex: 600, background: 'rgba(0,0,0,0.6)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: 'var(--bg-1)', borderRadius: 'var(--radius-lg)', width: '100%',
                    maxWidth: 820, maxHeight: '90vh', overflow: 'hidden',
                    boxShadow: 'var(--shadow-lg)', display: 'flex', flexDirection: 'column' }}>
        <header style={{ padding: '18px 22px', borderBottom: '1px solid var(--line)',
                         display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--text-0)' }}>
              Clientes asignados · <span style={{ color: 'var(--green)' }}>{desc.codigo}</span>
            </h2>
            <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '2px 0 0' }}>
              {desc.descripcion}
            </p>
          </div>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 8,
                  border: '1px solid var(--line)', background: 'var(--bg-3)',
                  color: 'var(--text-2)', cursor: 'pointer' }}><X size={14} /></button>
        </header>

        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12, overflow: 'auto', flex: 1 }}>
          {isFamiliares ? (
            <p style={{ fontSize: 13, color: 'var(--text-3)' }}>
              Este descuento es automático por familias. Consulta su aplicación
              desde el botón «Asignar», que muestra el estado por familia.
            </p>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <input type="text" placeholder="Buscar por cliente, trabajador, relación, ID…"
                       value={search} onChange={e => setSearch(e.target.value)}
                       style={{ ...inputStyle, flex: 1, minWidth: 200 }} />
                <select value={estadoFiltro} onChange={e => setEstadoFiltro(e.target.value)}
                        style={{ ...inputStyle, width: 'auto' }}>
                  <option value="todos">Todos</option>
                  <option value="vigentes">Vigentes</option>
                  <option value="caducados">Caducados</option>
                </select>
                {isFamiliarTrab && relacionesPresentes.length > 0 && (
                  <select value={relacionFiltro} onChange={e => setRelacionFiltro(e.target.value)}
                          style={{ ...inputStyle, width: 'auto' }}>
                    <option value="">Toda relación</option>
                    {relacionesPresentes.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                )}
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-3)', margin: 0 }}>
                {loading ? 'Cargando…' : `${filas.length} de ${asignaciones.length} asignacion${asignaciones.length !== 1 ? 'es' : ''}`}
              </p>
              {loading ? (
                <p style={{ fontSize: 13, color: 'var(--text-3)' }}>Cargando…</p>
              ) : asignaciones.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--text-3)' }}>Sin clientes asignados.</p>
              ) : (
                <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)',
                              overflow: 'auto' }}>
                  <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ color: 'var(--text-3)', fontSize: 11, textAlign: 'left',
                                   background: 'var(--bg-2)' }}>
                        <th style={thStyle}>Cliente</th>
                        <th style={thStyle}>ID</th>
                        {isFamiliarTrab && <th style={thStyle}>Trabajador</th>}
                        {isFamiliarTrab && <th style={thStyle}>Relación</th>}
                        <th style={thStyle}>Desde</th>
                        <th style={thStyle}>Hasta</th>
                        <th style={thStyle}>Origen</th>
                        <th style={thStyle}>Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filas.map(a => (
                        <tr key={a.id} style={{ borderTop: '1px solid var(--line)' }}>
                          <td style={tdStyle}>{a._nombre}</td>
                          <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>
                            #{a.cliente_idnoofit}
                          </td>
                          {isFamiliarTrab && (
                            <td style={tdStyle}>
                              {a.trabajador_nombre || (a.trabajador_id ? `#${a.trabajador_id}` : '—')}
                              {a.trabajador_nif && (
                                <span style={{ color: 'var(--text-3)', marginLeft: 4 }}>
                                  ({a.trabajador_nif})
                                </span>
                              )}
                            </td>
                          )}
                          {isFamiliarTrab && <td style={tdStyle}>{a.relacion || '—'}</td>}
                          <td style={tdStyle}>{a.fecha_desde || '—'}</td>
                          <td style={tdStyle}>{a.fecha_hasta || '∞'}</td>
                          <td style={{ ...tdStyle, color: 'var(--text-3)' }}>{a.origen || 'manual'}</td>
                          <td style={tdStyle}>
                            {a._vigente
                              ? <Badge color="green">Vigente</Badge>
                              : <Badge color="gray">Caducado</Badge>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>

        <footer style={{ padding: '14px 22px', borderTop: '1px solid var(--line)',
                         display: 'flex', justifyContent: 'flex-end' }}>
          <Btn variant="secondary" onClick={onClose}>Cerrar</Btn>
        </footer>
      </div>
    </div>
  )
}

const thStyle = { padding: '8px 10px', fontWeight: 600, whiteSpace: 'nowrap' }
const tdStyle = { padding: '7px 10px', color: 'var(--text-1)', whiteSpace: 'nowrap' }


function DescForm({ desc, identity, onClose, onSaved }) {
  const isNew = !desc.id
  const toast = useToast()
  const [saving, setSaving] = useState(false)
  const [cuotas, setCuotas] = useState([])

  // combo_secundarias depende del tipo:
  //   - varias_cuotas: [{cuota_codigo, precio}]
  //   - familiares:    [{cuota_codigo, valor, unidad}]
  const initialCombo = Array.isArray(desc.combo_secundarias)
    ? desc.combo_secundarias
    : []
  // Fallback compat: si es familiares pero combo_secundarias está vacío y el
  // descuento tenía cuota_aplicada_codigo+valor+unidad raíz, construimos una
  // entrada inicial a partir de esos campos legacy.
  const initialFamiliares = (() => {
    if (desc.tipo !== 'familiares') return initialCombo
    if (initialCombo.length > 0) return initialCombo
    if (desc.cuota_aplicada_codigo) {
      return [{
        cuota_codigo: desc.cuota_aplicada_codigo,
        valor: Number(desc.valor || 0),
        unidad: desc.unidad || 'porcentaje',
      }]
    }
    return []
  })()
  const [data, setData] = useState({
    codigo: desc.codigo || '',
    descripcion: desc.descripcion || '',
    // Mapear tipo legacy 'precio_combo' al nuevo 'varias_cuotas' al editar
    tipo: desc.tipo === 'precio_combo' ? 'varias_cuotas' : (desc.tipo || 'porcentaje'),
    valor: desc.valor ?? 0,
    unidad: desc.unidad || 'porcentaje',
    active: desc.active ?? true,
    cuota_requerida_codigo: desc.cuota_requerida_codigo || '',
    cuota_aplicada_codigo: desc.cuota_aplicada_codigo || '',
    combo_secundarias: desc.tipo === 'familiares' ? initialFamiliares : initialCombo,
    // Filtro por actividad (solo tipo 'importe'/restar): ids de actividad
    // NoofitPro. Vacío = aplica a cualquier cuota.
    actividades_idnoofit: Array.isArray(desc.actividades_idnoofit)
      ? desc.actividades_idnoofit.map(Number) : [],
  })
  const set = (k, v) => setData(d => ({ ...d, [k]: v }))
  const [actividades, setActividades] = useState([])

  useEffect(() => {
    cuotasList(identity).then(arr => setCuotas(arr || [])).catch(() => setCuotas([]))
    getActividades().then(setActividades).catch(() => setActividades([]))
  }, [identity])

  const toggleActividad = (id) => setData(d => {
    const lista = d.actividades_idnoofit || []
    return { ...d, actividades_idnoofit: lista.includes(id)
      ? lista.filter(x => x !== id) : [...lista, id] }
  })

  const isVarias = data.tipo === 'varias_cuotas'
  const isFamiliares = data.tipo === 'familiares'
  const isFamiliarTrab = data.tipo === 'familiar_trabajador'
  const isRestarCuota = data.tipo === 'restar_cuota'

  // Map cuota_codigo → entry de combo_secundarias para acceso rápido
  const comboMap = useMemo(() => {
    const m = {}
    for (const c of (data.combo_secundarias || [])) {
      if (c?.cuota_codigo) m[c.cuota_codigo] = c
    }
    return m
  }, [data.combo_secundarias])

  function toggleCuotaSecundaria(codigo, defaultPrecio) {
    setData(d => {
      const lista = Array.isArray(d.combo_secundarias) ? d.combo_secundarias : []
      const idx = lista.findIndex(x => x.cuota_codigo === codigo)
      if (idx >= 0) {
        return { ...d, combo_secundarias: lista.filter((_, i) => i !== idx) }
      }
      return { ...d, combo_secundarias: [...lista, { cuota_codigo: codigo, precio: defaultPrecio }] }
    })
  }
  function setPrecioSecundaria(codigo, precio) {
    setData(d => {
      const lista = Array.isArray(d.combo_secundarias) ? d.combo_secundarias : []
      return {
        ...d,
        combo_secundarias: lista.map(x =>
          x.cuota_codigo === codigo ? { ...x, precio } : x
        ),
      }
    })
  }

  async function onSubmit(e) {
    e.preventDefault()
    if (!data.codigo.trim()) { toast.error('Código obligatorio'); return }
    if (isRestarCuota && !data.cuota_aplicada_codigo) {
      toast.error('Elige la cuota a la que se aplica el descuento'); return
    }
    if (isVarias) {
      if (!data.cuota_requerida_codigo) {
        toast.error('Elige la cuota principal'); return
      }
      const sec = (data.combo_secundarias || []).filter(c => c?.cuota_codigo)
      if (sec.length === 0) {
        toast.error('Marca al menos una cuota secundaria'); return
      }
      for (const c of sec) {
        if (c.precio === '' || c.precio == null || isNaN(Number(c.precio))) {
          toast.error(`Precio inválido para ${c.cuota_codigo}`); return
        }
        if (c.cuota_codigo === data.cuota_requerida_codigo) {
          toast.error('La cuota secundaria no puede ser la misma que la principal'); return
        }
      }
    }
    if (isFamiliares || isFamiliarTrab) {
      const lista = (data.combo_secundarias || []).filter(c => c?.cuota_codigo)
      if (lista.length === 0) {
        toast.error('Marca al menos una actividad'); return
      }
      for (const c of lista) {
        if (!c.unidad || !['porcentaje', 'importe'].includes(c.unidad)) {
          toast.error(`Unidad inválida para ${c.cuota_codigo}`); return
        }
        if (!c.valor || Number(c.valor) <= 0) {
          toast.error(`Valor inválido para ${c.cuota_codigo}`); return
        }
      }
    }
    setSaving(true)
    try {
      const payload = {
        codigo: data.codigo,
        descripcion: data.descripcion,
        tipo: data.tipo,
        valor: data.valor,
        active: data.active,
      }
      if (isVarias) {
        payload.cuota_requerida_codigo = data.cuota_requerida_codigo
        payload.combo_secundarias = (data.combo_secundarias || [])
          .filter(c => c?.cuota_codigo)
          .map(c => ({ cuota_codigo: c.cuota_codigo, precio: Number(c.precio) }))
      } else if (isFamiliares || isFamiliarTrab) {
        const lista = (data.combo_secundarias || [])
          .filter(c => c?.cuota_codigo)
          .map(c => ({
            cuota_codigo: c.cuota_codigo,
            valor: Number(c.valor),
            unidad: c.unidad || 'porcentaje',
          }))
        payload.combo_secundarias = lista
        // Mantener "raíz" para compat: primera entrada como cuota_aplicada / valor / unidad
        if (lista.length > 0) {
          payload.cuota_aplicada_codigo = lista[0].cuota_codigo
          payload.valor = lista[0].valor
          payload.unidad = lista[0].unidad
        }
        payload.cuota_requerida_codigo = null
        payload.precio_final           = null
      } else if (isRestarCuota) {
        // Restar € a UNA cuota concreta.
        payload.cuota_requerida_codigo = null
        payload.cuota_aplicada_codigo  = data.cuota_aplicada_codigo
        payload.precio_final           = null
        payload.combo_secundarias      = []
        payload.actividades_idnoofit   = []
      } else {
        payload.cuota_requerida_codigo = null
        payload.cuota_aplicada_codigo  = null
        payload.precio_final           = null
        payload.combo_secundarias      = []
        // Filtro por actividad solo para 'importe' (restar €).
        payload.actividades_idnoofit = data.tipo === 'importe'
          ? (data.actividades_idnoofit || []) : []
      }
      if (isNew) await descuentoCreate(identity, payload)
      else       await descuentoUpdate(identity, desc.id, payload)
      toast.success('Descuento guardado'); onSaved()
    } catch (e) { toast.error(e.message) }
    setSaving(false)
  }

  // Cuotas candidatas a "secundaria": todas excepto la principal
  const candidatasSec = cuotas.filter(c => c.codigo !== data.cuota_requerida_codigo)

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }}
         style={{ position: 'fixed', inset: 0, zIndex: 600, background: 'rgba(0,0,0,0.6)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: 'var(--bg-1)', borderRadius: 'var(--radius-lg)', width: '100%',
                    // Los tipos que muestran la rejilla de actividades (varias /
                    // familiares / familiar de trabajador) necesitan más ancho:
                    // si no, la columna del nombre se aprieta y el código se
                    // parte letra a letra (p.ej. "RT 4D" → "RT"/"4D").
                    maxWidth: (isVarias || isFamiliares || isFamiliarTrab) ? 780 : 480,
                    boxShadow: 'var(--shadow-lg)',
                    maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <header style={{ padding: '18px 22px', borderBottom: '1px solid var(--line)',
                         display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--text-0)' }}>
            {isNew ? 'Nuevo descuento' : `Editar ${desc.codigo}`}
          </h2>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 8,
                  border: '1px solid var(--line)', background: 'var(--bg-3)',
                  color: 'var(--text-2)', cursor: 'pointer' }}>
            <X size={14} />
          </button>
        </header>
        <form onSubmit={onSubmit} style={{ padding: 22, overflowY: 'auto', flex: 1 }}>
          <Field label="Código *">
            <input value={data.codigo} onChange={e => set('codigo', e.target.value)}
                   placeholder="DESC_FAMILIA" style={inputStyle} />
          </Field>
          <Field label="Descripción">
            <input value={data.descripcion} onChange={e => set('descripcion', e.target.value)}
                   style={inputStyle} />
          </Field>
          <Field label="Tipo de descuento">
            <select value={data.tipo} onChange={e => set('tipo', e.target.value)} style={inputStyle}>
              {TIPOS_DESCUENTO.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </Field>

          {/* familiar_trabajador: descuento manual por actividad (multi-cuota),
              igual que familiares pero asignado a mano (con trabajador + relación
              al asignarlo a cada cliente). El selector de cuotas va más abajo. */}
          {isFamiliarTrab && (
            <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 12px', lineHeight: 1.5,
                        padding: '10px 12px', borderRadius: 8,
                        background: 'var(--blue-bg)', border: '1px solid var(--blue-border)' }}>
              Descuento para <strong>familiares de un trabajador</strong>. Marca abajo
              en qué cuotas aplica y el importe a descontar en cada una (verás el
              precio resultante). Al asignarlo a un cliente se pedirá
              <strong> qué trabajador</strong> y la <strong>relación</strong>
              (cónyuge, hijo/a…). Es manual: lo asigna el operador.
            </p>
          )}

          {!isVarias && !isFamiliares && !isFamiliarTrab && (
            <>
              <Field label={(isFamiliarTrab ? (data.unidad === 'importe') : (data.tipo !== 'porcentaje'))
                              ? 'Importe a restar (€)' : 'Porcentaje (%)'}>
                <input type="number" step="0.01" value={data.valor}
                       onChange={e => set('valor', parseFloat(e.target.value) || 0)}
                       placeholder={(isFamiliarTrab ? data.unidad === 'importe' : data.tipo !== 'porcentaje') ? '10.00' : '15'}
                       style={inputStyle} />
                <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8, lineHeight: 1.55 }}>
                  {(isFamiliarTrab ? data.unidad !== 'importe' : data.tipo === 'porcentaje') ? (
                    <>
                      <strong>% (porcentaje)</strong>: se resta un porcentaje
                      <em> al precio</em> de cada cuota. Útil para descuentos
                      proporcionales (ej. 10% siempre será 10% sea cual sea
                      el precio). Fórmula:&nbsp;
                      <code style={inlineCodeStyle}>precio × (1 − %/100)</code>.
                    </>
                  ) : (
                    <>
                      <strong>€ (importe fijo)</strong>: se resta una cantidad
                      <em> fija en euros</em> al precio de cada cuota. Útil
                      para promos tipo "—10€ el primer mes". Fórmula:&nbsp;
                      <code style={inlineCodeStyle}>max(0, precio − valor)</code>.
                      {' '}Si el descuento es mayor que el precio, la cuota
                      queda en 0€ (no negativo).
                    </>
                  )}
                </p>
              </Field>

              {/* Selector de cuota única — solo para 'restar_cuota'. El
                  descuento se resta SOLO a la cuota elegida. */}
              {isRestarCuota && (
                <Field label="Cuota a la que se aplica (elige una)">
                  {cuotas.filter(c => c.active !== false).length === 0 ? (
                    <p style={{ fontSize: 12, color: 'var(--text-3)' }}>No hay cuotas activas.</p>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 220,
                                  overflow: 'auto', padding: 6, border: '1px solid var(--line)',
                                  borderRadius: 'var(--radius-sm)', background: 'var(--bg-2)' }}>
                      {cuotas.filter(c => c.active !== false).map(c => {
                        const sel = data.cuota_aplicada_codigo === c.codigo
                        return (
                          <button type="button" key={c.id || c.codigo}
                                  onClick={() => set('cuota_aplicada_codigo', c.codigo)}
                                  style={{
                                    padding: '7px 12px', borderRadius: 999, fontSize: 12, cursor: 'pointer',
                                    fontWeight: 600,
                                    border: `1.5px solid ${sel ? 'var(--green)' : 'var(--line)'}`,
                                    background: sel ? 'var(--green-bg)' : 'var(--bg-1)',
                                    color: sel ? 'var(--green)' : 'var(--text-2)',
                                  }}>
                            {c.codigo}{c.descripcion ? ` · ${c.descripcion}` : ''}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </Field>
              )}

              {/* Filtro por actividad — solo para 'importe' (restar €). Si se
                  seleccionan actividades, el descuento solo aplica a las cuotas
                  que incluyan alguna de ellas. Vacío = todas las cuotas. */}
              {data.tipo === 'importe' && (
                <Field label={`Aplicar solo a cuotas con estas actividades (${(data.actividades_idnoofit || []).length} seleccionadas)`}>
                  <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 8px', lineHeight: 1.5 }}>
                    Si no marcas ninguna, el descuento se resta a <strong>cualquier
                    cuota</strong>. Si marcas alguna, <strong>solo</strong> se aplica
                    cuando la cuota incluye al menos una de las actividades elegidas.
                  </p>
                  {actividades.filter(a => a.enabled !== false).length === 0 ? (
                    <p style={{ fontSize: 12, color: 'var(--text-3)' }}>Cargando actividades de NoofitPro…</p>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 200,
                                  overflow: 'auto', padding: 6, border: '1px solid var(--line)',
                                  borderRadius: 'var(--radius-sm)', background: 'var(--bg-2)' }}>
                      {actividades.filter(a => a.enabled !== false).map(a => {
                        const id = Number(a.id)
                        const sel = (data.actividades_idnoofit || []).includes(id)
                        return (
                          <button type="button" key={id} onClick={() => toggleActividad(id)}
                                  style={{
                                    padding: '6px 11px', borderRadius: 999, fontSize: 12, cursor: 'pointer',
                                    fontWeight: 600,
                                    border: `1.5px solid ${sel ? 'var(--green)' : 'var(--line)'}`,
                                    background: sel ? 'var(--green-bg)' : 'var(--bg-1)',
                                    color: sel ? 'var(--green)' : 'var(--text-2)',
                                  }}>
                            {a.Nombre || a.nombre || `#${id}`}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </Field>
              )}

              {/* Preview: muestra cómo queda cada cuota del manager con el
                  descuento aplicado. El operador ve al instante el impacto
                  real, sin tener que hacer la cuenta mental. */}
              {Number(data.valor) > 0 && cuotas && cuotas.length > 0 && (
                <div style={{
                  padding: 14, borderRadius: 10, marginBottom: 14,
                  background: 'var(--green-bg, rgba(45,212,168,0.08))',
                  border: '1px solid var(--green-border, rgba(45,212,168,0.3))',
                }}>
                  <p style={{ fontSize: 11, color: 'var(--text-3)',
                              textTransform: 'uppercase', letterSpacing: '0.04em',
                              margin: '0 0 8px' }}>
                    Cómo queda cada cuota con este descuento
                  </p>
                  <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ color: 'var(--text-3)', fontSize: 11 }}>
                        <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 500 }}>Cuota</th>
                        <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 500 }}>Precio</th>
                        <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 500 }}>Con descuento</th>
                        <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 500 }}>Ahorro</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cuotas
                        .filter(c => c.active !== false && Number(c.precio_mensual) > 0)
                        .slice(0, 8)
                        .map(c => {
                          const base = Number(c.precio_mensual)
                          // Para familiar_trabajador la unidad la marca data.unidad;
                          // para porcentaje/importe la marca el propio tipo.
                          const unidadCalc = isFamiliarTrab ? (data.unidad || 'porcentaje') : data.tipo
                          const nuevo = aplicarDescuento(base, data.valor, unidadCalc)
                          const ahorro = base - nuevo
                          return (
                            <tr key={c.id} style={{ borderTop: '1px solid var(--line-2, rgba(0,0,0,0.06))' }}>
                              <td style={{ padding: '6px 8px', color: 'var(--text-1)' }}>
                                {c.codigo} <span style={{ color: 'var(--text-3)' }}>· {c.descripcion}</span>
                              </td>
                              <td style={{ textAlign: 'right', padding: '6px 8px',
                                            color: 'var(--text-3)',
                                            textDecoration: 'line-through' }}>
                                {base.toFixed(2)}€
                              </td>
                              <td style={{ textAlign: 'right', padding: '6px 8px',
                                            color: 'var(--green)', fontWeight: 600 }}>
                                {nuevo != null ? `${nuevo.toFixed(2)}€` : '—'}
                              </td>
                              <td style={{ textAlign: 'right', padding: '6px 8px',
                                            color: 'var(--text-2)', fontSize: 12 }}>
                                −{ahorro.toFixed(2)}€
                              </td>
                            </tr>
                          )
                        })}
                    </tbody>
                  </table>
                  <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6, marginBottom: 0 }}>
                    Cálculo sobre el precio mensual de catálogo. Si una cuota
                    se cobra trimestral/semestral/anual, el descuento se aplica
                    sobre ese precio correspondiente.
                  </p>
                </div>
              )}
            </>
          )}

          {(isFamiliares || isFamiliarTrab) && (() => {
            const lista = data.combo_secundarias || []
            const byCode = Object.fromEntries(
              lista.filter(x => x?.cuota_codigo).map(x => [x.cuota_codigo, x])
            )
            const toggleCuota = (codigo, defaultPrecio) => {
              setData(d => {
                const arr = Array.isArray(d.combo_secundarias) ? d.combo_secundarias : []
                const idx = arr.findIndex(x => x.cuota_codigo === codigo)
                if (idx >= 0) {
                  return { ...d, combo_secundarias: arr.filter((_, i) => i !== idx) }
                }
                return { ...d, combo_secundarias: [...arr, {
                  cuota_codigo: codigo, valor: 0, unidad: 'porcentaje',
                }]}
              })
            }
            const setEntry = (codigo, key, val) => {
              setData(d => ({
                ...d,
                combo_secundarias: (d.combo_secundarias || []).map(x =>
                  x.cuota_codigo === codigo ? { ...x, [key]: val } : x
                ),
              }))
            }
            return (
              <div style={{
                padding: 14, marginBottom: 12, borderRadius: 10,
                background: 'var(--amber-bg)', border: '1px solid var(--amber-border)',
              }}>
                <p style={{ fontSize: 12, color: 'var(--text-2)', margin: '0 0 14px', lineHeight: 1.5 }}>
                  {isFamiliarTrab ? (
                    <>
                      <strong>Descuento por familiar de trabajador</strong>. Marca
                      cada actividad y define su descuento (%, €); verás el precio
                      resultante. Cada actividad tiene su propio descuento. Es
                      manual: lo asignas a cada cliente (con su trabajador y relación).
                    </>
                  ) : (
                    <>
                      <strong>Descuento por familiares (automático)</strong>. Marca
                      cada actividad y define su descuento (%, €). Se aplica
                      automáticamente a los miembros de un grupo familiar cuando hay
                      <strong> ≥ 2 miembros</strong> con esa cuota activa. Cada
                      actividad tiene su propio descuento independiente.
                    </>
                  )}
                </p>

                <p style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase',
                            letterSpacing: '0.04em', margin: '0 0 6px' }}>
                  Actividades con descuento *
                </p>
                {cuotas.length === 0 ? (
                  <p style={{ fontSize: 12, color: 'var(--text-3)', fontStyle: 'italic' }}>
                    No hay cuotas configuradas.
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6,
                                maxHeight: 280, overflowY: 'auto' }}>
                    {cuotas.map(c => {
                      const sel = !!byCode[c.codigo]
                      const entry = byCode[c.codigo]
                      const tarifa = c.precio_mensual ?? 0
                      return (
                        <div key={c.id || c.codigo}
                             style={{ display: 'grid',
                                      gridTemplateColumns: '24px 1fr 90px 100px 150px',
                                      alignItems: 'center', gap: 8,
                                      padding: '8px 10px', borderRadius: 8,
                                      background: sel ? 'var(--green-bg)' : 'var(--bg-2)',
                                      border: `1px solid ${sel ? 'var(--green)' : 'var(--line)'}` }}>
                          <input type="checkbox" checked={sel}
                                 onChange={() => toggleCuota(c.codigo, tarifa)} />
                          <div style={{ minWidth: 0 }}>
                            <p style={{ fontSize: 13, fontWeight: 600,
                                        color: 'var(--text-0)', margin: 0 }}>
                              {c.codigo}
                            </p>
                            {c.descripcion && (
                              <p style={{ fontSize: 11, color: 'var(--text-3)', margin: 0 }}>
                                {c.descripcion}
                              </p>
                            )}
                          </div>
                          <select disabled={!sel}
                                  value={sel ? (entry.unidad || 'porcentaje') : 'porcentaje'}
                                  onChange={e => setEntry(c.codigo, 'unidad', e.target.value)}
                                  style={{ ...inputStyle, padding: '6px 8px',
                                           opacity: sel ? 1 : 0.4 }}>
                            <option value="porcentaje">%</option>
                            <option value="importe">€</option>
                          </select>
                          <input type="number" step="0.01" min={0}
                                 disabled={!sel}
                                 value={sel ? (entry.valor ?? '') : ''}
                                 onChange={e => setEntry(c.codigo, 'valor', parseFloat(e.target.value) || 0)}
                                 placeholder={sel && entry.unidad === 'importe' ? '10.00' : '20'}
                                 style={{ ...inputStyle, padding: '6px 8px',
                                          textAlign: 'right',
                                          opacity: sel ? 1 : 0.4 }} />
                          <span style={{ fontSize: 11, textAlign: 'right', lineHeight: 1.35 }}>
                            <span style={{ color: 'var(--text-3)' }}>tarifa {tarifa}€</span>
                            {sel && Number(entry.valor) > 0 && tarifa > 0 && (() => {
                              const fin = aplicarDescuento(tarifa, entry.valor, entry.unidad || 'porcentaje')
                              return (
                                <>
                                  <br />
                                  <span style={{ color: 'var(--green)', fontWeight: 700 }}>
                                    → {fin.toFixed(2)}€
                                  </span>
                                  <span style={{ color: 'var(--text-3)' }}> (−{(tarifa - fin).toFixed(2)}€)</span>
                                </>
                              )
                            })()}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })()}

          {isVarias && (
            <div style={{
              padding: 14, marginBottom: 12, borderRadius: 10,
              background: 'var(--blue-bg)', border: '1px solid var(--blue-border)',
            }}>
              <p style={{ fontSize: 12, color: 'var(--text-2)', margin: '0 0 14px', lineHeight: 1.5 }}>
                <strong>Varias cuotas (precio combinado)</strong>. El cliente debe tener la
                <strong> cuota principal</strong> activa. Cuando se le añada cualquiera de las
                <strong> cuotas secundarias</strong> marcadas, esa cuota se cobrará al precio
                indicado en lugar del precio normal de tarifa.
              </p>

              <Field label="Cuota principal (la que el cliente debe tener) *">
                <select value={data.cuota_requerida_codigo}
                        onChange={e => set('cuota_requerida_codigo', e.target.value)}
                        style={inputStyle}>
                  <option value="">— Selecciona —</option>
                  {cuotas.map(c => (
                    <option key={c.id || c.codigo} value={c.codigo}>
                      {c.codigo}{c.descripcion ? ` — ${c.descripcion}` : ''}
                    </option>
                  ))}
                </select>
              </Field>

              <p style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase',
                          letterSpacing: '0.04em', margin: '14px 0 6px' }}>
                Cuotas secundarias y su precio combinado *
              </p>
              {!data.cuota_requerida_codigo ? (
                <p style={{ fontSize: 12, color: 'var(--text-3)', fontStyle: 'italic' }}>
                  Selecciona primero la cuota principal.
                </p>
              ) : candidatasSec.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--text-3)', fontStyle: 'italic' }}>
                  No hay otras cuotas configuradas.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {candidatasSec.map(c => {
                    const sel = !!comboMap[c.codigo]
                    const tarifa = c.precio_mensual ?? 0
                    const entry = comboMap[c.codigo]
                    return (
                      <div key={c.id || c.codigo}
                           style={{ display: 'grid',
                                    gridTemplateColumns: '24px 1fr 110px 24px 110px',
                                    alignItems: 'center', gap: 8,
                                    padding: '8px 10px', borderRadius: 8,
                                    background: sel ? 'var(--green-bg)' : 'var(--bg-2)',
                                    border: `1px solid ${sel ? 'var(--green)' : 'var(--line)'}` }}>
                        <input type="checkbox" checked={sel}
                               onChange={() => toggleCuotaSecundaria(c.codigo, tarifa)} />
                        <div style={{ minWidth: 0 }}>
                          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-0)', margin: 0 }}>
                            {c.codigo}
                          </p>
                          {c.descripcion && (
                            <p style={{ fontSize: 11, color: 'var(--text-3)', margin: 0 }}>
                              {c.descripcion}
                            </p>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-3)', textAlign: 'right' }}>
                          tarifa<br />
                          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)' }}>
                            {tarifa}€
                          </span>
                        </div>
                        <span style={{ color: 'var(--text-3)', textAlign: 'center' }}>→</span>
                        <input type="number" step="0.01" min={0}
                               disabled={!sel}
                               value={sel ? (entry.precio ?? '') : ''}
                               onChange={e => setPrecioSecundaria(c.codigo, e.target.value)}
                               placeholder={`${tarifa}`}
                               style={{ ...inputStyle, padding: '6px 8px', textAlign: 'right',
                                        opacity: sel ? 1 : 0.4 }} />
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          <Field>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text-1)' }}>
              <input type="checkbox" checked={data.active} onChange={e => set('active', e.target.checked)} /> Activo
            </label>
          </Field>
        </form>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end',
                      padding: '14px 22px', borderTop: '1px solid var(--line)',
                      flexShrink: 0, background: 'var(--bg-2)' }}>
          <Btn variant="secondary" type="button" onClick={onClose}>Cancelar</Btn>
          <Btn variant="primary" type="button" onClick={onSubmit} disabled={saving}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {saving ? ' Guardando…' : ' Guardar'}
          </Btn>
        </div>
      </div>
    </div>
  )
}

const inputStyle = {
  width: '100%', padding: '8px 10px', borderRadius: 'var(--radius-sm)',
  background: 'var(--bg-2)', border: '1px solid var(--line)',
  color: 'var(--text-0)', fontSize: 13, outline: 'none',
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
      {label && <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)',
                              textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>}
      {children}
    </label>
  )
}
