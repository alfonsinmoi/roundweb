import { useState, useEffect, useMemo } from 'react'
import { Plus, Pencil, Trash2, Check, X, RefreshCw, Download, Loader2, Users } from 'lucide-react'
import { Card, Btn, Badge, Avatar } from '../../components/UI'
import { useToast } from '../../components/Toast'
import {
  descuentosList, descuentoCreate, descuentoUpdate, descuentoDelete, descuentoAdoptar,
  asignacionesList, asignacionCreate, asignacionDelete,
  TIPOS_DESCUENTO, cuotasList,
} from '../../utils/configApi'
import { getClientes } from '../../utils/api'


export default function DescuentosTab({ identity }) {
  const toast = useToast()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [asignandoDesc, setAsignandoDesc] = useState(null)  // descuento sobre el que abrir modal
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
          <Btn variant="primary" size="sm" onClick={() => setEditing({})}><Plus size={13} /> Nuevo</Btn>
        </div>
      </div>

      {plantillas.length > 0 && (
        <Section titulo={isTrainer ? 'Plantillas del manager' : 'Plantillas (manager)'}>
          {plantillas.map(d => (
            <DescRow key={d.id} d={d} isTrainer={isTrainer}
                     onEdit={!isTrainer ? () => setEditing(d) : null}
                     onDelete={!isTrainer ? () => onDelete(d) : null}
                     onAsignar={!isTrainer ? () => setAsignandoDesc(d) : null}
                     onAdoptar={isTrainer && !items.some(t => t.scope === 'trainer' && t.plantilla_origen_id === d.id) ? () => onAdoptar(d.id) : null} />
          ))}
        </Section>
      )}

      {isTrainer && propios.length > 0 && (
        <Section titulo="Mis descuentos">
          {propios.map(d => (
            <DescRow key={d.id} d={d} isTrainer
                     onEdit={() => setEditing(d)} onDelete={() => onDelete(d)}
                     onAsignar={() => setAsignandoDesc(d)} />
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

function DescRow({ d, isTrainer, onEdit, onDelete, onAdoptar, onAsignar }) {
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
  const [clientes, setClientes] = useState([])
  const [asignaciones, setAsignaciones] = useState([])
  const [familias, setFamilias] = useState(null) // sólo cuando tipo='familiares'
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(new Set())
  const [fechaDesde, setFechaDesde] = useState(new Date().toISOString().slice(0, 10))
  const [fechaHasta, setFechaHasta] = useState('')
  const [saving, setSaving] = useState(false)

  const isFamiliares = desc.tipo === 'familiares'

  async function loadAll() {
    setLoading(true)
    try {
      const [cls, resp] = await Promise.all([
        getClientes(),
        asignacionesList(identity, desc.id),
      ])
      setClientes(cls || [])
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

  async function onAsignar() {
    if (selected.size === 0) { toast.error('Selecciona al menos 1 cliente'); return }
    setSaving(true)
    try {
      const r = await asignacionCreate(identity, desc.id, {
        clientes_idnoofit: [...selected],
        fecha_desde: fechaDesde || null,
        fecha_hasta: fechaHasta || null,
      })
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
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                    {cuotasDesc.map(c => (
                      <span key={c.cuota_codigo} style={{
                        fontSize: 11, padding: '3px 8px', borderRadius: 'var(--radius-pill)',
                        background: 'var(--amber-bg)', border: '1px solid var(--amber-border)',
                        color: 'var(--text-1)',
                      }}>
                        {c.cuota_codigo} ·{' '}
                        {c.unidad === 'porcentaje' ? `${c.valor}%` : `−${c.valor}€`}
                      </span>
                    ))}
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
                      <button onClick={() => onRevocar(a.id)} title="Revocar"
                              style={{ background: 'none', border: 'none', cursor: 'pointer',
                                       color: 'var(--red)', padding: 2, display: 'flex' }}>
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}

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
  })
  const set = (k, v) => setData(d => ({ ...d, [k]: v }))

  useEffect(() => {
    cuotasList(identity).then(arr => setCuotas(arr || [])).catch(() => setCuotas([]))
  }, [identity])

  const isVarias = data.tipo === 'varias_cuotas'
  const isFamiliares = data.tipo === 'familiares'

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
    if (isFamiliares) {
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
      } else if (isFamiliares) {
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
      } else {
        payload.cuota_requerida_codigo = null
        payload.cuota_aplicada_codigo  = null
        payload.precio_final           = null
        payload.combo_secundarias      = []
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
                    maxWidth: isVarias ? 620 : 480, boxShadow: 'var(--shadow-lg)',
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

          {!isVarias && !isFamiliares && (
            <Field label={data.tipo === 'porcentaje' ? 'Porcentaje (%)' : 'Importe a restar (€)'}>
              <input type="number" step="0.01" value={data.valor}
                     onChange={e => set('valor', parseFloat(e.target.value) || 0)}
                     placeholder={data.tipo === 'porcentaje' ? '15' : '10.00'}
                     style={inputStyle} />
            </Field>
          )}

          {isFamiliares && (() => {
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
                  <strong>Descuento por familiares (automático)</strong>. Marca
                  cada actividad y define su descuento (%, €). Se aplica
                  automáticamente a los miembros de un grupo familiar cuando hay
                  <strong> ≥ 2 miembros</strong> con esa cuota activa. Cada
                  actividad tiene su propio descuento independiente.
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
                                      gridTemplateColumns: '24px 1fr 100px 110px 90px',
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
                          <span style={{ fontSize: 11, color: 'var(--text-3)',
                                         textAlign: 'right' }}>
                            tarifa {tarifa}€
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
