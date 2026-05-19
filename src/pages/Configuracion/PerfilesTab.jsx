// CRUD de perfiles + editor de árbol de permisos
import { useEffect, useState, useMemo, useRef } from 'react'
import { Plus, Trash2, Edit2, Check, X, ChevronRight, ChevronDown, Shield, Users } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { Card, Btn, Badge } from '../../components/UI'
import Modal from '../../components/Modal'
import { useToast } from '../../components/Toast'
import { getRoundIdentity } from '../../utils/configApi'
import { perfilesList, perfilCreate, perfilUpdate, perfilDelete } from '../../utils/authUsuarioApi'
import { PERMISSIONS } from '../../config/permissions'

export default function PerfilesTab() {
  const { user } = useAuth()
  const identity = useMemo(() => getRoundIdentity(user), [user])
  const toast = useToast()
  const [perfiles, setPerfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)  // perfil a editar (null = ninguno)
  const [creating, setCreating] = useState(false)

  const reload = async () => {
    setLoading(true)
    try {
      const r = await perfilesList(identity)
      setPerfiles(r.perfiles || [])
    } catch (e) { toast.error('No se pudo cargar perfiles: ' + e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { if (identity?.managerId) reload() }, [identity?.managerId])

  const handleDelete = async (p) => {
    if (!window.confirm(`¿Borrar perfil "${p.nombre}"?\n${p.usuarios > 0 ? 'Tiene ' + p.usuarios + ' usuarios — se desactivará en su lugar.' : 'No hay usuarios asociados.'}`)) return
    try {
      const r = await perfilDelete(identity, p.id)
      toast.success(r.mode === 'soft' ? 'Perfil desactivado' : 'Perfil borrado')
      reload()
    } catch (e) { toast.error('Error: ' + e.message) }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 20, color: 'var(--text-0)', margin: 0 }}>Perfiles</h2>
          <p style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4 }}>
            Define qué puede hacer cada usuario web según su rol.
          </p>
        </div>
        <Btn variant="primary" onClick={() => setCreating(true)}>
          <Plus size={14} aria-hidden="true" /> Nuevo perfil
        </Btn>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-2)' }}>Cargando…</div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {perfiles.map(p => (
            <Card key={p.id} style={{ padding: 16, opacity: p.activa ? 1 : 0.5 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
                  <Shield size={18} style={{ color: p.is_admin ? 'var(--amber)' : 'var(--blue)' }} aria-hidden="true" />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <strong style={{ color: 'var(--text-0)', fontSize: 15 }}>{p.nombre}</strong>
                      {p.is_admin && <Badge color="amber">Control total</Badge>}
                      {!p.activa && <Badge color="red">Inactivo</Badge>}
                      <Badge color="gray"><Users size={10} aria-hidden="true" /> {p.usuarios}</Badge>
                    </div>
                    {p.descripcion && (
                      <p style={{ fontSize: 12, color: 'var(--text-2)', margin: '4px 0 0' }}>{p.descripcion}</p>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <Btn variant="secondary" size="sm" onClick={() => setEditing(p)}>
                    <Edit2 size={12} aria-hidden="true" /> Editar
                  </Btn>
                  <Btn variant="secondary" size="sm" onClick={() => handleDelete(p)}>
                    <Trash2 size={12} aria-hidden="true" />
                  </Btn>
                </div>
              </div>
            </Card>
          ))}
          {!perfiles.length && (
            <Card style={{ padding: 32, textAlign: 'center', color: 'var(--text-2)' }}>
              No hay perfiles. Crea el primero.
            </Card>
          )}
        </div>
      )}

      {(editing || creating) && (
        <PerfilEditor
          identity={identity}
          perfil={editing}
          onClose={() => { setEditing(null); setCreating(false) }}
          onSaved={() => { setEditing(null); setCreating(false); reload() }}
        />
      )}
    </div>
  )
}


// ── Editor con árbol checkboxable ─────────────────────────────────────────────
function PerfilEditor({ identity, perfil, onClose, onSaved }) {
  const toast = useToast()
  const [nombre, setNombre] = useState(perfil?.nombre || '')
  const [descripcion, setDescripcion] = useState(perfil?.descripcion || '')
  const [isAdmin, setIsAdmin] = useState(perfil?.is_admin || false)
  const [activa, setActiva] = useState(perfil?.activa ?? true)
  const [permisos, setPermisos] = useState(perfil?.permisos || {})
  const [saving, setSaving] = useState(false)

  // Inmutable: siempre devuelve un nuevo objeto (React detecta cambio)
  const setPermAt = (path, value) => {
    setPermisos(prev => {
      const root = (prev && typeof prev === 'object' && !Array.isArray(prev)) ? prev : {}
      const parts = path.split('.')

      // Helper recursivo: clona y aplica
      const apply = (node, idx) => {
        const isObj = node && typeof node === 'object' && !Array.isArray(node)
        const base = isObj ? { ...node } : {}
        const key = parts[idx]
        if (idx === parts.length - 1) {
          base[key] = !!value     // siempre boolean
        } else {
          base[key] = apply(base[key], idx + 1)
        }
        return base
      }
      return apply(root, 0)
    })
  }

  const getPermAt = (path) => {
    if (!permisos || typeof permisos !== 'object') return false
    const parts = path.split('.')
    let cur = permisos
    for (const p of parts) {
      if (cur == null || typeof cur !== 'object') return false
      cur = cur[p]
    }
    return cur === true
  }

  const handleSave = async () => {
    if (!nombre.trim()) { toast.error('Pon un nombre'); return }
    setSaving(true)
    try {
      const payload = { nombre: nombre.trim(), descripcion: descripcion.trim() || null,
                        permisos, is_admin: isAdmin, activa }
      if (perfil) await perfilUpdate(identity, perfil.id, payload)
      else await perfilCreate(identity, payload)
      toast.success('Perfil guardado')
      onSaved()
    } catch (e) { toast.error('Error: ' + e.message) }
    finally { setSaving(false) }
  }

  return (
    <Modal open={true} onClose={onClose} maxWidth={780}
           title={perfil ? `Editar perfil: ${perfil.nombre}` : 'Nuevo perfil'}>
      <div style={{ padding: 24, flex: 1, overflowY: 'auto', minHeight: 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-3)', marginBottom: 6 }}>Nombre *</label>
            <input value={nombre} onChange={e => setNombre(e.target.value)} className="form-input"
                   style={{ width: '100%', padding: 10, borderRadius: 10, fontSize: 14,
                            background: 'var(--bg-2)', border: '1px solid var(--line)', color: 'var(--text-0)' }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-3)', marginBottom: 6 }}>Descripción</label>
            <input value={descripcion} onChange={e => setDescripcion(e.target.value)} className="form-input"
                   style={{ width: '100%', padding: 10, borderRadius: 10, fontSize: 14,
                            background: 'var(--bg-2)', border: '1px solid var(--line)', color: 'var(--text-0)' }} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={isAdmin} onChange={e => setIsAdmin(e.target.checked)} />
            <span><strong>Control total</strong> (ignora todos los permisos individuales)</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={activa} onChange={e => setActiva(e.target.checked)} />
            <span>Activa</span>
          </label>
        </div>

        {!isAdmin && (
          <>
            <h3 style={{ fontSize: 14, color: 'var(--text-1)', marginBottom: 8, marginTop: 8 }}>
              Permisos por pantalla
            </h3>
            <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 12, padding: 12 }}>
              <PermTree node={PERMISSIONS} prefix="" getPermAt={getPermAt} setPermAt={setPermAt} />
            </div>
          </>
        )}
      </div>
      <div style={{ padding: '16px 24px', borderTop: '1px solid var(--line)',
                     display: 'flex', gap: 10, justifyContent: 'flex-end',
                     flexShrink: 0, background: 'var(--bg-2)' }}>
        <Btn variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Btn>
        <Btn variant="primary" onClick={handleSave} disabled={saving}>
          <Check size={14} aria-hidden="true" /> Guardar
        </Btn>
      </div>
    </Modal>
  )
}


function PermTree({ node, prefix, getPermAt, setPermAt }) {
  return (
    <div>
      {Object.entries(node).map(([key, def]) => {
        const path = prefix ? `${prefix}.${key}` : key
        if (def.action) {
          return (
            <label key={path} style={{ display: 'flex', alignItems: 'center', gap: 8,
                                         padding: '4px 0 4px 24px', fontSize: 13, color: 'var(--text-1)' }}>
              <input type="checkbox" checked={getPermAt(path)}
                     onChange={e => setPermAt(path, e.target.checked)} />
              <span>{def.label}</span>
            </label>
          )
        }
        return (
          <Section key={path} path={path} def={def} getPermAt={getPermAt} setPermAt={setPermAt} />
        )
      })}
    </div>
  )
}

// Recolecta todos los paths leaf descendientes de un nodo
function collectLeaves(node, prefix) {
  const out = []
  Object.entries(node || {}).forEach(([k, d]) => {
    if (k === '_') return
    const p = prefix ? `${prefix}.${k}` : k
    if (d.action) out.push(p)
    else if (d.children) out.push(...collectLeaves(d.children, p))
  })
  return out
}

// Clasifica una acción como 'view' o 'edit' según su clave.
// Sirve para los atajos rápidos "Solo ver" y "Editar".
const VIEW_KEYS = new Set([
  'ver', 'ver_listado', 'ver_perfil', 'ver_kanban', 'ver_posts', 'ver_detalle',
  'ver_datos_erp', 'ver_pivot', 'ver_pl', 'ver_documentos', 'ver_movimientos',
  'ver_faltantes', 'ver_centros', 'ver_cuentas',
  'faltas', 'tendencias', 'comparativa', 'ranking_clases', 'ocupacion_sala',
  'analisis_patrones',
])
function classifyAction(leafPath) {
  const key = leafPath.split('.').pop()
  if (VIEW_KEYS.has(key) || key.startsWith('ver_') || key === 'ver') return 'view'
  return 'edit'
}
function leavesByCategory(leaves) {
  return {
    view: leaves.filter(p => classifyAction(p) === 'view'),
    edit: leaves.filter(p => classifyAction(p) === 'edit'),
  }
}

function Section({ path, def, getPermAt, setPermAt }) {
  // Calcular estado agregado de la rama
  const allLeaves = def.children ? collectLeaves(def.children, path) : []
  const checkedCount = allLeaves.filter(p => getPermAt(p)).length
  const totalCount = allLeaves.length

  // Auto-expandir por defecto si la rama tiene algún permiso marcado, para
  // que al abrir el editor "salga lo marcado" en vez de quedar plegado.
  const [open, setOpen] = useState(checkedCount > 0)
  const allChecked  = totalCount > 0 && checkedCount === totalCount
  const someChecked = checkedCount > 0 && checkedCount < totalCount

  // Desglose ver / editar
  const { view: viewLeaves, edit: editLeaves } = leavesByCategory(allLeaves)
  const viewChecked = viewLeaves.filter(p => getPermAt(p)).length
  const editChecked = editLeaves.filter(p => getPermAt(p)).length
  const viewAll = viewLeaves.length > 0 && viewChecked === viewLeaves.length
  const viewSome = viewChecked > 0 && viewChecked < viewLeaves.length
  const editAll = editLeaves.length > 0 && editChecked === editLeaves.length
  const editSome = editChecked > 0 && editChecked < editLeaves.length

  const toggleAll = (val) => {
    const recurse = (n, p) => {
      Object.entries(n).forEach(([k, d]) => {
        if (k === '_') return
        const np = p ? `${p}.${k}` : k
        if (d.action) setPermAt(np, val)
        else if (d.children) recurse(d.children, np)
      })
    }
    if (def.children) recurse(def.children, path)
  }

  const toggleViewOnly = (val) => {
    viewLeaves.forEach(p => setPermAt(p, val))
  }
  const toggleEditOnly = (val) => {
    editLeaves.forEach(p => setPermAt(p, val))
    // Si se marca editar, asegurar que también pueda ver (si no, no tiene sentido)
    if (val && viewLeaves.length > 0) viewLeaves.forEach(p => setPermAt(p, true))
  }

  // Ref para checkbox indeterminado (la propiedad no existe en JSX, hay que setearla en el DOM)
  const tristateRef = useRef(null)
  const viewRef = useRef(null)
  const editRef = useRef(null)
  useEffect(() => {
    if (tristateRef.current) tristateRef.current.indeterminate = someChecked
    if (viewRef.current)     viewRef.current.indeterminate = viewSome
    if (editRef.current)     editRef.current.indeterminate = editSome
  }, [someChecked, viewSome, editSome])

  // Estilos: fondo verde sutil cuando está totalmente activa la rama
  const headerBg =
    allChecked  ? 'rgba(45,212,168,0.12)' :
    someChecked ? 'rgba(45,212,168,0.05)' : 'transparent'
  const borderLeft =
    allChecked  ? '3px solid var(--green)' :
    someChecked ? '3px solid var(--green-soft)' :
                  '3px solid transparent'

  return (
    <div style={{ marginBottom: 8, borderRadius: 8, overflow: 'hidden', background: headerBg, borderLeft, transition: 'all 0.15s' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px' }}>
        <button type="button" onClick={() => setOpen(o => !o)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-2)', padding: 2 }}
                aria-label={open ? 'Contraer' : 'Expandir'}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>

        {/* Checkbox tri-estado */}
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
               title={allChecked ? 'Toda la rama activa — click para desmarcar todo' : someChecked ? `Activos ${checkedCount}/${totalCount} — click para marcar todo` : `Click para marcar todo (${totalCount})`}>
          <input ref={tristateRef} type="checkbox"
                 checked={allChecked}
                 onChange={() => toggleAll(!allChecked)} />
        </label>

        <strong style={{ fontSize: 13, color: allChecked ? 'var(--green)' : 'var(--text-0)' }}>{def.label}</strong>

        {/* Indicador numérico — siempre visible para no buscar en el árbol */}
        {totalCount > 0 && (
          <span style={{
            fontSize: 11, fontWeight: 600,
            padding: '2px 8px', borderRadius: 99,
            background: allChecked ? 'var(--green-bg)' : someChecked ? 'rgba(45,212,168,0.04)' : 'var(--bg-3)',
            color: allChecked ? 'var(--green)' : someChecked ? 'var(--green-soft)' : 'var(--text-3)',
            border: `1px solid ${allChecked ? 'var(--green-border)' : 'var(--line)'}`,
          }}>
            {allChecked ? '✓ todo' : `${checkedCount}/${totalCount}`}
          </span>
        )}

        {/* Atajos rápidos: 👁 Ver / ✏️ Editar */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          {viewLeaves.length > 0 && (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12,
                            color: viewAll ? 'var(--blue)' : 'var(--text-2)',
                            padding: '2px 8px', borderRadius: 8,
                            background: viewAll ? 'rgba(59,130,246,0.08)' : 'transparent',
                            border: `1px solid ${viewAll ? 'rgba(59,130,246,0.4)' : 'var(--line)'}` }}
                   title={`Permite ver — ${viewChecked}/${viewLeaves.length}`}>
              <input ref={viewRef} type="checkbox" checked={viewAll}
                     onChange={() => toggleViewOnly(!viewAll)} />
              👁 Ver
            </label>
          )}
          {editLeaves.length > 0 && (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12,
                            color: editAll ? 'var(--amber)' : 'var(--text-2)',
                            padding: '2px 8px', borderRadius: 8,
                            background: editAll ? 'rgba(245,158,11,0.08)' : 'transparent',
                            border: `1px solid ${editAll ? 'rgba(245,158,11,0.4)' : 'var(--line)'}` }}
                   title={`Permite editar / acciones — ${editChecked}/${editLeaves.length}`}>
              <input ref={editRef} type="checkbox" checked={editAll}
                     onChange={() => toggleEditOnly(!editAll)} />
              ✏️ Editar
            </label>
          )}
          <button type="button" onClick={() => toggleAll(false)}
                  style={{ fontSize: 11, color: 'var(--text-3)', background: 'none', border: 'none', cursor: 'pointer' }}>
            desmarcar todo
          </button>
        </div>
      </div>
      {open && def.children && (
        <div style={{ paddingLeft: 12, marginLeft: 8, borderLeft: '1px solid var(--line)', paddingTop: 4, paddingBottom: 4 }}>
          <PermTree node={def.children} prefix={path} getPermAt={getPermAt} setPermAt={setPermAt} />
        </div>
      )}
    </div>
  )
}
