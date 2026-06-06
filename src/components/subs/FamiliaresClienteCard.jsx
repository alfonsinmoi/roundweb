// Card "Familiares" — gestiona el grupo familiar del cliente.
// Permite añadir cualquier otro cliente como familiar (autocomplete con búsqueda)
// y muestra al resto de miembros de la familia. La pertenencia a una familia
// dispara el descuento automático "familiares" (ver Configuración → Descuentos).
import { useEffect, useMemo, useState } from 'react'
import { Plus, Loader2, Users, X as XIcon, Search } from 'lucide-react'
import { Card, Btn, SectionTitle } from '../UI'
import { useToast } from '../Toast'
import { useAuth } from '../../contexts/AuthContext'
import {
  getRoundIdentity, familiaDeCliente,
  familiaAddCliente, familiaRemoveCliente,
} from '../../utils/configApi'
import { getClientes } from '../../utils/api'
import { useCan } from '../../hooks/useCan'

export default function FamiliaresClienteCard({ cliente }) {
  const { user } = useAuth()
  const identity = useMemo(() => getRoundIdentity(user), [user])
  const toast = useToast()
  const canAsignar = useCan('clientes.familias.asignar')
  const canBorrar = useCan('clientes.familias.borrar')

  const [familia, setFamilia] = useState(null)
  const [clientes, setClientes] = useState([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)

  async function reload() {
    if (!cliente?.id) return
    setLoading(true)
    try {
      const [fam, cls] = await Promise.all([
        familiaDeCliente(identity, cliente.id).catch(() => null),
        clientes.length === 0 ? getClientes() : Promise.resolve(clientes),
      ])
      setFamilia(fam || null)
      if (cls && cls.length) setClientes(cls)
    } catch (e) {
      toast.error(`Error cargando familiares: ${e.message}`)
    } finally { setLoading(false) }
  }
  useEffect(() => { reload() }, [cliente?.id])

  // Mapa idnoofit → cliente para resolver nombres del listado de miembros
  const byId = useMemo(() => {
    const m = {}
    for (const c of clientes) m[String(c.id)] = c
    return m
  }, [clientes])

  function nombreDe(idnoofit) {
    const c = byId[String(idnoofit)]
    if (!c) return `#${idnoofit}`
    return `${c.nombre || c.name || ''} ${c.apellidos || c.surname || ''}`.trim() || `#${idnoofit}`
  }

  // Otros miembros = los de la familia, excluyendo el cliente actual
  const otrosMiembros = (familia?.miembros || [])
    .filter(m => String(m.cliente_idnoofit) !== String(cliente.id))

  // Candidatos a añadir = clientes distintos al actual y a los ya en la familia
  const yaIds = new Set([String(cliente.id),
    ...(familia?.miembros || []).map(m => String(m.cliente_idnoofit))])
  const candidatos = clientes.filter(c => {
    const id = String(c.id)
    if (yaIds.has(id)) return false
    if (!search) return true
    const q = search.toLowerCase()
    const nombre = `${c.nombre || c.name || ''} ${c.apellidos || c.surname || ''}`.toLowerCase()
    return nombre.includes(q) || (c.email || '').toLowerCase().includes(q) || id.includes(q)
  }).slice(0, 30)

  async function handleAddCliente(otroId) {
    setSaving(true)
    try {
      // Si ya existe familia, añadimos al "otroId" a esa familia.
      // Si no existe, creamos familia con ambos (yo + otro).
      if (familia?.id) {
        await familiaAddCliente(identity, otroId, { familia_id: familia.id })
      } else {
        await familiaAddCliente(identity, cliente.id, { otro_cliente_idnoofit: otroId })
      }
      toast.success('Familiar añadido')
      setSearch(''); setAdding(false)
      reload()
    } catch (e) {
      const code = e.message || ''
      if (code.includes('cliente_ya_en_familia')) {
        if (confirm('Ese cliente ya está en otra familia. ¿Moverlo a esta?')) {
          try {
            const targetId = familia?.id
              ? familia.id
              : (await familiaAddCliente(identity, cliente.id, {})).familia_id
            await familiaAddCliente(identity, otroId, {
              familia_id: targetId, force_move: true,
            })
            toast.success('Familiar movido a esta familia')
            setSearch(''); setAdding(false)
            reload()
          } catch (e2) { toast.error(e2.message) }
        }
      } else {
        toast.error(e.message)
      }
    } finally { setSaving(false) }
  }

  async function handleRemoveSelf() {
    if (!confirm('¿Quitar este cliente del grupo familiar?')) return
    try {
      await familiaRemoveCliente(identity, cliente.id)
      toast.success('Cliente quitado del grupo')
      reload()
    } catch (e) { toast.error(e.message) }
  }

  async function handleRemoveOtro(idn) {
    if (!confirm('¿Quitar a este familiar del grupo?')) return
    try {
      await familiaRemoveCliente(identity, idn)
      toast.success('Familiar quitado')
      reload()
    } catch (e) { toast.error(e.message) }
  }

  return (
    <Card style={{ padding: 24 }}>
      <SectionTitle>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Users size={16} aria-hidden="true" /> Familiares
        </span>
      </SectionTitle>

      {loading ? (
        <div style={{ padding: 20, textAlign: 'center' }}>
          <Loader2 size={18} className="animate-spin" style={{ color: 'var(--green)' }} />
        </div>
      ) : (
        <>
          {!familia ? (
            <p style={{ fontSize: 12, color: 'var(--text-3)', fontStyle: 'italic',
                        marginTop: 8, marginBottom: 12 }}>
              Este cliente no pertenece a ningún grupo familiar.
            </p>
          ) : (
            <div style={{ marginTop: 8, marginBottom: 12 }}>
              <p style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase',
                          letterSpacing: '0.04em', marginBottom: 6 }}>
                Grupo familiar ({familia.miembros.length})
              </p>
              {otrosMiembros.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  Sólo este cliente. Añade un familiar para activar los descuentos
                  automáticos por familia (cuando ≥ 2 miembros tienen la misma cuota).
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {otrosMiembros.map(m => (
                    <div key={m.id} style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '8px 10px', borderRadius: 8,
                      background: 'var(--bg-2)', border: '1px solid var(--line)',
                    }}>
                      <span style={{ flex: 1, minWidth: 0,
                                     overflow: 'hidden', textOverflow: 'ellipsis',
                                     whiteSpace: 'nowrap',
                                     fontSize: 13, color: 'var(--text-0)' }}
                            title={nombreDe(m.cliente_idnoofit)}>
                        {nombreDe(m.cliente_idnoofit)}
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--text-3)',
                                     fontFamily: 'var(--font-mono)' }}>
                        #{m.cliente_idnoofit}
                      </span>
                      {canAsignar && (
                        <button onClick={() => handleRemoveOtro(m.cliente_idnoofit)}
                                title="Quitar de la familia"
                                style={{ background: 'none', border: 'none', cursor: 'pointer',
                                         color: 'var(--red)', padding: 4 }}>
                          <XIcon size={13} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Botones acción */}
          {!adding ? (
            <div style={{ display: 'flex', gap: 6 }}>
              {canAsignar && (
                <Btn variant="secondary" size="sm" onClick={() => setAdding(true)}>
                  <Plus size={12} /> Añadir familiar
                </Btn>
              )}
              {familia && canAsignar && (
                <Btn variant="secondary" size="sm" onClick={handleRemoveSelf}>
                  Salir del grupo
                </Btn>
              )}
            </div>
          ) : (
            <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ position: 'relative' }}>
                <Search size={12} style={{ position: 'absolute', top: 10, left: 10,
                                            color: 'var(--text-3)' }} />
                <input type="text" placeholder="Buscar cliente por nombre o email…"
                       value={search} onChange={e => setSearch(e.target.value)}
                       autoFocus
                       style={{ ...inputStyle, paddingLeft: 28 }} />
              </div>
              <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)',
                            background: 'var(--bg-2)', maxHeight: 220, overflowY: 'auto' }}>
                {candidatos.length === 0 ? (
                  <p style={{ padding: 12, fontSize: 12, color: 'var(--text-3)' }}>
                    {search ? 'Sin coincidencias' : 'Escribe para buscar un cliente.'}
                  </p>
                ) : candidatos.map(c => {
                  const id = String(c.id)
                  const nombre = `${c.nombre || c.name || ''} ${c.apellidos || c.surname || ''}`.trim()
                  return (
                    <button key={id}
                            onClick={() => handleAddCliente(id)}
                            disabled={saving}
                            style={{ display: 'flex', alignItems: 'center', gap: 8,
                                     padding: '8px 10px', width: '100%', textAlign: 'left',
                                     borderBottom: '1px solid var(--line)',
                                     background: 'transparent', border: 'none', cursor: 'pointer',
                                     color: 'var(--text-0)', fontSize: 13 }}>
                      <span style={{ flex: 1, minWidth: 0,
                                     overflow: 'hidden', textOverflow: 'ellipsis',
                                     whiteSpace: 'nowrap' }}>
                        {nombre || `#${id}`}
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--text-3)',
                                     fontFamily: 'var(--font-mono)' }}>
                        #{id}
                      </span>
                    </button>
                  )
                })}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <Btn variant="secondary" size="sm"
                     onClick={() => { setAdding(false); setSearch('') }}>
                  Cancelar
                </Btn>
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
  width: '100%',
}
