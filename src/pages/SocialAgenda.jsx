import { useState, useEffect, useMemo } from 'react'
import {
  Instagram, Facebook, Calendar, Plus, Loader2, Trash2, Edit3, Send,
  CheckCircle2, AlertCircle, Clock, Image as ImageIcon, Film, X, ExternalLink, Settings,
} from 'lucide-react'
import { Card, Btn, SectionTitle, Badge } from '../components/UI'
import { useToast } from '../components/Toast'
import { useAuth } from '../contexts/AuthContext'
import {
  getRoundIdentity, socialCuentasList, socialPostsList,
  socialPostCreate, socialPostUpdate, socialPostDelete, socialPostPublishNow,
} from '../utils/configApi'

const TIPO_LABELS = {
  image:    { label: 'Foto',     icon: ImageIcon, color: 'var(--blue)' },
  carousel: { label: 'Carrusel', icon: ImageIcon, color: 'var(--violet)' },
  reel:     { label: 'Reel',     icon: Film,      color: 'var(--rose)' },
  story:    { label: 'Story',    icon: Film,      color: 'var(--orange)' },
  fb_post:  { label: 'FB Post',  icon: Facebook,  color: 'var(--blue)' },
}

const ESTADO_BADGE = {
  pendiente:  { label: 'Programado', color: 'blue' },
  publicando: { label: 'Publicando…', color: 'yellow' },
  publicado:  { label: 'Publicado',  color: 'green' },
  fallido:    { label: 'Fallido',    color: 'red' },
  cancelado:  { label: 'Cancelado',  color: 'gray' },
}


export default function SocialAgenda() {
  const { user } = useAuth()
  const identity = useMemo(() => getRoundIdentity(user), [user])
  const toast = useToast()
  const [cuentas, setCuentas] = useState([])
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [editorOpen, setEditorOpen] = useState(null)  // null | post | {} (nuevo)
  const [filtroEstado, setFiltroEstado] = useState('')

  async function load() {
    setLoading(true)
    try {
      const [c, p] = await Promise.all([
        socialCuentasList(identity).catch(() => []),
        socialPostsList(identity).catch(() => []),
      ])
      setCuentas(c || []); setPosts(p || [])
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setLoading(false)
  }
  useEffect(() => { load() }, [identity.managerId, identity.trainerId])

  const postsFiltered = useMemo(() => {
    if (!filtroEstado) return posts
    return posts.filter(p => p.estado === filtroEstado)
  }, [posts, filtroEstado])

  const postsPorDia = useMemo(() => {
    const map = {}
    for (const p of postsFiltered) {
      const d = new Date(p.schedule_at)
      const k = d.toISOString().slice(0, 10)
      if (!map[k]) map[k] = []
      map[k].push(p)
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b))
  }, [postsFiltered])

  async function handleDelete(post) {
    if (!confirm(`¿Borrar el post programado del ${new Date(post.schedule_at).toLocaleString('es-ES')}?`)) return
    try { await socialPostDelete(identity, post.id); toast.success('Post borrado'); load() }
    catch (e) { toast.error(`Error: ${e.message}`) }
  }
  async function handlePublishNow(post) {
    if (!confirm('¿Publicar este post ahora? (siguiente ciclo del cron, máx 5 min)')) return
    try { await socialPostPublishNow(identity, post.id); toast.success('Programado para publicar'); load() }
    catch (e) { toast.error(`Error: ${e.message}`) }
  }

  return (
    <div style={{ maxWidth: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <Calendar size={22} style={{ color: 'var(--green)' }} />
        <h1 style={{ fontFamily: 'Outfit', fontSize: 28, fontWeight: 700, color: 'var(--text-0)', margin: 0 }}>
          Agenda Social
        </h1>
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 20 }}>
        Programa publicaciones en Instagram y Facebook. El sistema las publica automáticamente
        a la fecha y hora indicadas (precisión ~5 min).
      </p>

      {/* Estado cuentas conectadas */}
      <CuentasBar cuentas={cuentas} />

      {/* Acciones + filtros */}
      <Card style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Btn variant="primary" onClick={() => setEditorOpen({})}
               disabled={cuentas.filter(c => c.has_access_token && c.active).length === 0}>
            <Plus size={14} /> Nuevo post
          </Btn>
          <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}
                  style={selectStyle}>
            <option value="">Todos los estados</option>
            <option value="pendiente">Programados</option>
            <option value="publicado">Publicados</option>
            <option value="fallido">Fallidos</option>
            <option value="cancelado">Cancelados</option>
          </select>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
            {postsFiltered.length} post{postsFiltered.length !== 1 ? 's' : ''}
          </span>
        </div>
      </Card>

      {/* Lista por día */}
      {loading && posts.length === 0 ? (
        <Card style={{ padding: 60, textAlign: 'center' }}>
          <Loader2 size={28} className="animate-spin" style={{ color: 'var(--green)' }} />
        </Card>
      ) : postsPorDia.length === 0 ? (
        <Card style={{ padding: 40, textAlign: 'center' }}>
          <p style={{ color: 'var(--text-3)' }}>
            {posts.length === 0
              ? 'Sin posts programados. Pulsa "Nuevo post" para empezar.'
              : 'Ningún post cumple el filtro.'}
          </p>
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {postsPorDia.map(([dia, items]) => (
            <DayGroup key={dia} dia={dia} items={items} cuentas={cuentas}
                       onEdit={p => setEditorOpen(p)}
                       onDelete={handleDelete}
                       onPublishNow={handlePublishNow} />
          ))}
        </div>
      )}

      {editorOpen !== null && (
        <PostEditor post={editorOpen}
                    cuentas={cuentas}
                    identity={identity}
                    onClose={() => setEditorOpen(null)}
                    onSaved={() => { setEditorOpen(null); load() }} />
      )}
    </div>
  )
}


function CuentasBar({ cuentas }) {
  if (!cuentas || cuentas.length === 0) {
    return (
      <Card style={{ padding: 16, marginBottom: 16, background: 'var(--amber-bg)',
                     border: '1px solid var(--amber-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <AlertCircle size={18} style={{ color: 'var(--amber)' }} />
          <span style={{ fontSize: 13, color: 'var(--text-1)', flex: 1 }}>
            <b>Sin cuentas Meta configuradas.</b> Ve a Configuración → Cuentas Meta para
            conectar Instagram/Facebook antes de programar publicaciones.
          </span>
        </div>
      </Card>
    )
  }
  return (
    <Card style={{ padding: 12, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase',
                       letterSpacing: '0.04em' }}>Cuentas conectadas:</span>
        {cuentas.map(c => (
          <CuentaChip key={c.id} c={c} />
        ))}
      </div>
    </Card>
  )
}


function CuentaChip({ c }) {
  const Icon = c.red === 'facebook' ? Facebook : Instagram
  const ok = c.has_access_token && c.active
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '5px 10px', borderRadius: 999, fontSize: 12,
      background: ok ? 'var(--green-bg)' : 'var(--bg-3)',
      color: ok ? 'var(--green)' : 'var(--text-3)',
      border: `1px solid ${ok ? 'var(--green-border)' : 'var(--line)'}`,
    }}>
      <Icon size={11} />
      {c.ig_username || c.fb_page_name || c.nombre || c.red}
      {!ok && <span style={{ fontSize: 10 }}>· sin token</span>}
    </span>
  )
}


function DayGroup({ dia, items, cuentas, onEdit, onDelete, onPublishNow }) {
  const dt = new Date(dia)
  const titulo = dt.toLocaleDateString('es-ES',
    { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  return (
    <Card style={{ padding: 16 }}>
      <p style={{ fontFamily: 'Outfit', fontWeight: 700, fontSize: 13, color: 'var(--green)',
                  textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 12 }}>
        {titulo}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map(p => (
          <PostRow key={p.id} p={p} onEdit={onEdit} onDelete={onDelete}
                   onPublishNow={onPublishNow} />
        ))}
      </div>
    </Card>
  )
}


function PostRow({ p, onEdit, onDelete, onPublishNow }) {
  const tipoConf = TIPO_LABELS[p.tipo] || TIPO_LABELS.image
  const Icon = tipoConf.icon
  const RedIcon = p.cuenta_red === 'facebook' ? Facebook : Instagram
  const estado = ESTADO_BADGE[p.estado] || { label: p.estado, color: 'gray' }
  const hora = new Date(p.schedule_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  const media = (p.media_urls || [])
  const previewUrl = media[0]
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: 10, background: 'var(--bg-2)', borderRadius: 10,
      border: '1px solid var(--line)',
    }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-0)',
                     fontFamily: 'var(--font-mono)', minWidth: 50 }}>
        {hora}
      </span>
      {previewUrl ? (
        <img src={previewUrl} alt="preview"
             style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 8 }}
             onError={e => { e.target.style.display = 'none' }} />
      ) : (
        <div style={{ width: 48, height: 48, borderRadius: 8,
                      background: 'var(--bg-3)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={18} style={{ color: 'var(--text-3)' }} />
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <RedIcon size={12} style={{ color: 'var(--text-3)' }} />
          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
            {p.ig_username || p.fb_page_name || p.cuenta_nombre}
          </span>
          <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4,
                          background: 'var(--bg-3)', color: tipoConf.color }}>
            {tipoConf.label}
          </span>
          {media.length > 1 && (
            <span style={{ fontSize: 10, color: 'var(--text-3)' }}>· {media.length} archivos</span>
          )}
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-1)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {p.caption || <span style={{ fontStyle: 'italic', color: 'var(--text-3)' }}>(sin caption)</span>}
        </p>
        {p.error_msg && (
          <p style={{ fontSize: 11, color: 'var(--red)', marginTop: 2 }}>⚠ {p.error_msg}</p>
        )}
      </div>
      <Badge color={estado.color}>{estado.label}</Badge>
      <div style={{ display: 'flex', gap: 4 }}>
        {p.meta_permalink && (
          <a href={p.meta_permalink} target="_blank" rel="noreferrer"
             style={{ padding: 6, color: 'var(--text-3)' }} title="Ver post publicado">
            <ExternalLink size={13} />
          </a>
        )}
        {p.estado === 'pendiente' && (
          <>
            <button onClick={() => onPublishNow(p)} title="Publicar ya"
                    style={iconBtn}><Send size={13} /></button>
            <button onClick={() => onEdit(p)} title="Editar"
                    style={iconBtn}><Edit3 size={13} /></button>
          </>
        )}
        {(p.estado === 'pendiente' || p.estado === 'fallido' || p.estado === 'cancelado') && (
          <button onClick={() => onDelete(p)} title="Borrar"
                  style={{ ...iconBtn, color: 'var(--red)' }}><Trash2 size={13} /></button>
        )}
      </div>
    </div>
  )
}


function PostEditor({ post, cuentas, identity, onClose, onSaved }) {
  const toast = useToast()
  const [form, setForm] = useState({
    social_cuenta_id: post.social_cuenta_id || (cuentas[0]?.id || ''),
    tipo: post.tipo || 'image',
    media_urls: post.media_urls || [],
    caption: post.caption || '',
    schedule_at: post.schedule_at
      ? new Date(post.schedule_at).toISOString().slice(0, 16)
      : new Date(Date.now() + 60*60*1000).toISOString().slice(0, 16),
  })
  const [saving, setSaving] = useState(false)
  const [newMediaUrl, setNewMediaUrl] = useState('')
  const set = patch => setForm(f => ({ ...f, ...patch }))

  const cuenta = cuentas.find(c => c.id === form.social_cuenta_id)
  const tiposDisponibles = cuenta?.red === 'facebook'
    ? ['fb_post']
    : ['image', 'carousel', 'reel', 'story']

  async function handleSave() {
    if (!form.social_cuenta_id) { toast.error('Selecciona cuenta'); return }
    if (!form.schedule_at) { toast.error('Indica fecha y hora'); return }
    if (form.tipo === 'carousel' && form.media_urls.length < 2) {
      toast.error('Carrusel requiere mínimo 2 imágenes'); return
    }
    if (['image','reel','story'].includes(form.tipo) && form.media_urls.length === 0) {
      toast.error('Indica al menos 1 URL de media'); return
    }
    setSaving(true)
    try {
      const payload = {
        ...form,
        social_cuenta_id: parseInt(form.social_cuenta_id),
        schedule_at: new Date(form.schedule_at).toISOString(),
      }
      if (post.id) await socialPostUpdate(identity, post.id, payload)
      else         await socialPostCreate(identity, payload)
      toast.success('Post guardado')
      onSaved()
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setSaving(false)
  }

  function addMedia() {
    if (!newMediaUrl.trim()) return
    set({ media_urls: [...form.media_urls, newMediaUrl.trim()] })
    setNewMediaUrl('')
  }
  function removeMedia(i) {
    set({ media_urls: form.media_urls.filter((_, j) => j !== i) })
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 20, overflowY: 'auto',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 640, background: 'var(--bg-1)',
        border: '1px solid var(--line-2)', borderRadius: 16, padding: 24, marginTop: 20,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ fontFamily: 'Outfit', fontSize: 18, fontWeight: 700, color: 'var(--text-0)' }}>
            {post.id ? 'Editar post' : 'Nuevo post'}
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)' }}>
            <X size={18} />
          </button>
        </div>

        <Field label="Cuenta destino" required>
          <select value={form.social_cuenta_id}
                  onChange={e => set({ social_cuenta_id: parseInt(e.target.value) })}
                  style={inputStyle}>
            <option value="">— elige —</option>
            {cuentas.filter(c => c.has_access_token && c.active).map(c => (
              <option key={c.id} value={c.id}>
                {c.red === 'facebook' ? '📘' : '📷'} {c.ig_username || c.fb_page_name || c.nombre} ({c.red})
              </option>
            ))}
          </select>
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginTop: 12 }}>
          <Field label="Tipo" required>
            <select value={form.tipo} onChange={e => set({ tipo: e.target.value })} style={inputStyle}>
              {tiposDisponibles.map(t => <option key={t} value={t}>{TIPO_LABELS[t].label}</option>)}
            </select>
          </Field>
          <Field label="Fecha y hora" required>
            <input type="datetime-local" value={form.schedule_at}
                   onChange={e => set({ schedule_at: e.target.value })}
                   style={inputStyle} />
          </Field>
        </div>

        <Field label="Caption / texto">
          <textarea value={form.caption} onChange={e => set({ caption: e.target.value })}
                    rows={4} style={{ ...inputStyle, resize: 'vertical' }}
                    placeholder="¡Hola! Esta semana en Round..." />
        </Field>

        <Field label="Media (URLs públicas)">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {form.media_urls.map((u, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <img src={u} alt="" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 6 }}
                     onError={e => { e.target.style.display = 'none' }} />
                <input value={u} readOnly style={{ ...inputStyle, fontSize: 11, fontFamily: 'monospace' }} />
                <button onClick={() => removeMedia(i)} style={iconBtn}><Trash2 size={13} /></button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={newMediaUrl} onChange={e => setNewMediaUrl(e.target.value)}
                     placeholder="https://..."
                     onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addMedia())}
                     style={{ ...inputStyle, flex: 1, fontFamily: 'monospace', fontSize: 12 }} />
              <Btn variant="secondary" size="sm" onClick={addMedia}>Añadir</Btn>
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-3)' }}>
              Las URLs deben ser <b>públicamente accesibles</b> (Imgur, ImgBB, Cloudinary, S3...).
              Meta no acepta enlaces privados de Drive/Dropbox.
            </p>
          </div>
        </Field>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
          <Btn variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            {post.id ? 'Guardar cambios' : 'Programar post'}
          </Btn>
        </div>
      </div>
    </div>
  )
}


function Field({ label, required, children }) {
  return (
    <label style={{ display: 'block', marginTop: 12 }}>
      <span style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase',
                     letterSpacing: '0.04em', display: 'block', marginBottom: 4 }}>
        {label} {required && <span style={{ color: 'var(--red)' }}>*</span>}
      </span>
      {children}
    </label>
  )
}

const inputStyle = {
  padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line)',
  background: 'var(--bg-2)', color: 'var(--text-0)', fontSize: 13, width: '100%',
}
const selectStyle = {
  padding: '6px 10px', borderRadius: 8, fontSize: 13,
  background: 'var(--bg-1)', border: '1px solid var(--line)', color: 'var(--text-0)',
}
const iconBtn = {
  background: 'none', border: '1px solid var(--line)', borderRadius: 6,
  padding: 6, cursor: 'pointer', color: 'var(--text-2)', display: 'flex',
}
