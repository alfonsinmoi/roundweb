import { useState, useEffect, useMemo } from 'react'
import {
  Instagram, Facebook, Loader2, Save, Trash2, AlertCircle, ExternalLink,
  Eye, EyeOff, CheckCircle2, RefreshCw, Building2,
} from 'lucide-react'
import { Card, Btn, SectionTitle } from '../../components/UI'
import { useToast } from '../../components/Toast'
import { useAuth } from '../../contexts/AuthContext'
import {
  getRoundIdentity, socialCuentasList, socialCuentaUpsert,
  socialCuentaDelete, socialCuentaInfo, centrosList,
} from '../../utils/configApi'


export default function CuentasMetaTab({ identity: identityProp }) {
  const { user, isImpersonating } = useAuth()
  const identity = useMemo(() => identityProp || getRoundIdentity(user), [identityProp, user])
  const toast = useToast()
  const [cuentas, setCuentas] = useState([])
  const [centros, setCentros] = useState([])
  const [loading, setLoading] = useState(true)
  const [editor, setEditor] = useState(null)

  async function load() {
    setLoading(true)
    try {
      const [cs, c] = await Promise.all([
        socialCuentasList(identity),
        centrosList(identity),
      ])
      setCuentas(cs || []); setCentros(c || [])
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setLoading(false)
  }
  useEffect(() => { load() }, [identity.managerId])

  if (isImpersonating || user?.kind === 'usuario_web') {
    return (
      <Card style={{ padding: 32, textAlign: 'center' }}>
        <AlertCircle size={32} style={{ color: 'var(--text-3)', margin: '0 auto 12px' }} />
        <p style={{ color: 'var(--text-2)', fontSize: 13 }}>
          Las cuentas Meta solo se gestionan a nivel manager.
        </p>
      </Card>
    )
  }

  if (loading) {
    return <Card style={{ padding: 40, textAlign: 'center' }}>
      <Loader2 size={20} className="animate-spin" style={{ color: 'var(--green)' }} />
    </Card>
  }

  return (
    <div>
      <Card style={{ padding: 20, marginBottom: 16 }}>
        <SectionTitle><Instagram size={16} style={{ marginRight: 8 }} /> Cuentas Meta (Instagram + Facebook)</SectionTitle>
        <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8, lineHeight: 1.7 }}>
          Conecta una cuenta de Instagram <b>Business o Creator</b> vinculada a una Página de
          Facebook. Una cuenta por <b>centro</b> (con el sufijo del trainer) o una sola
          a nivel manager. Necesitas el <b>Page Access Token</b> de larga duración (60 días).
        </p>
        <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6 }}>
          ⚠ Antes de poder publicar, tu app Meta necesita los permisos
          <code style={mono}>instagram_content_publish</code> y
          <code style={mono}>pages_manage_posts</code> aprobados (App Review de Meta).
        </p>
        <div style={{ marginTop: 14 }}>
          <Btn variant="primary" onClick={() => setEditor({})}>
            <Instagram size={14} /> Conectar nueva cuenta Meta
          </Btn>
        </div>
      </Card>

      {cuentas.length === 0 ? (
        <Card style={{ padding: 32, textAlign: 'center' }}>
          <p style={{ color: 'var(--text-3)' }}>
            Aún no hay cuentas Meta conectadas. Pulsa "Conectar nueva cuenta Meta" arriba.
          </p>
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {cuentas.map(c => (
            <CuentaCard key={c.id} cuenta={c} centros={centros} identity={identity}
                         onEdit={() => setEditor(c)}
                         onDeleted={load}
                         onRefresh={load} />
          ))}
        </div>
      )}

      {editor && (
        <CuentaEditor cuenta={editor} centros={centros} identity={identity}
                       onClose={() => setEditor(null)}
                       onSaved={() => { setEditor(null); load() }} />
      )}
    </div>
  )
}


function CuentaCard({ cuenta, centros, identity, onEdit, onDeleted, onRefresh }) {
  const toast = useToast()
  const [info, setInfo] = useState(null)
  const [loadingInfo, setLoadingInfo] = useState(false)
  const centro = centros.find(c => String(c.id_trainer) === String(cuenta.id_trainer))

  async function loadInfo() {
    setLoadingInfo(true)
    try { setInfo(await socialCuentaInfo(identity, cuenta.id)) }
    catch (e) { toast.error(`Validación Meta falló: ${e.message}`) }
    setLoadingInfo(false)
  }
  async function handleDelete() {
    if (!confirm('¿Borrar esta cuenta Meta? Los posts programados se borrarán también.')) return
    try { await socialCuentaDelete(identity, cuenta.id); toast.success('Cuenta borrada'); onDeleted() }
    catch (e) { toast.error(`Error: ${e.message}`) }
  }

  const expIso = cuenta.expires_at
  const expDays = expIso ? Math.round((new Date(expIso) - Date.now()) / (1000*60*60*24)) : null

  return (
    <Card style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12,
                       background: cuenta.red === 'facebook' ? '#1877F2' : 'linear-gradient(135deg,#E1306C,#FD1D1D,#F77737)',
                       display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {cuenta.red === 'facebook' ? <Facebook size={22} color="#fff" /> : <Instagram size={22} color="#fff" />}
        </div>
        <div style={{ flex: 1 }}>
          <p style={{ fontFamily: 'Outfit', fontWeight: 700, fontSize: 14, color: 'var(--text-0)' }}>
            {cuenta.nombre || cuenta.ig_username || cuenta.fb_page_name || `Cuenta #${cuenta.id}`}
          </p>
          <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
            {cuenta.ig_username && <span>📷 @{cuenta.ig_username}</span>}
            {cuenta.fb_page_name && <span>📘 {cuenta.fb_page_name}</span>}
            <span>{centro ? <><Building2 size={10} style={{display:'inline'}}/> {centro.nombre_centro}</> : 'Manager (todos los centros)'}</span>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {cuenta.has_access_token ? (
              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 999,
                              background: 'var(--green-bg)', color: 'var(--green)' }}>
                ✓ Token configurado
              </span>
            ) : (
              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 999,
                              background: 'var(--red-bg)', color: 'var(--red)' }}>
                ⚠ Sin token
              </span>
            )}
            {expDays != null && (
              <span style={{ fontSize: 10, color: expDays < 7 ? 'var(--red)' : 'var(--text-3)' }}>
                Token caduca {expDays > 0 ? `en ${expDays} días` : 'YA · renovar'}
              </span>
            )}
            {cuenta.active === false && (
              <span style={{ fontSize: 10, color: 'var(--amber)' }}>(inactiva)</span>
            )}
          </div>
          {info && (
            <div style={{ marginTop: 10, padding: 10, background: 'var(--bg-2)', borderRadius: 8, fontSize: 12 }}>
              {info.instagram && (
                <p>📷 <b>{info.instagram.username}</b> · {info.instagram.followers_count ?? '-'} seguidores · {info.instagram.media_count ?? 0} publicaciones</p>
              )}
              {info.facebook && (
                <p>📘 <b>{info.facebook.name}</b> · {info.facebook.fan_count ?? '-'} fans · {info.facebook.category}</p>
              )}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <Btn variant="secondary" size="sm" onClick={loadInfo} disabled={loadingInfo}
               title="Validar token y traer info actual">
            {loadingInfo ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          </Btn>
          <Btn variant="secondary" size="sm" onClick={onEdit}>Editar</Btn>
          <Btn variant="ghost" size="sm" onClick={handleDelete}><Trash2 size={12} /></Btn>
        </div>
      </div>
    </Card>
  )
}


function CuentaEditor({ cuenta, centros, identity, onClose, onSaved }) {
  const toast = useToast()
  const [form, setForm] = useState({
    id_trainer: cuenta.id_trainer || '',
    red: cuenta.red || 'meta',
    nombre: cuenta.nombre || '',
    fb_page_id: cuenta.fb_page_id || '',
    fb_page_name: cuenta.fb_page_name || '',
    ig_business_account_id: cuenta.ig_business_account_id || '',
    ig_username: cuenta.ig_username || '',
    access_token: '',
    active: cuenta.active ?? true,
    notas: cuenta.notas || '',
  })
  const [showToken, setShowToken] = useState(false)
  const [saving, setSaving] = useState(false)
  const set = patch => setForm(f => ({ ...f, ...patch }))
  const isNew = !cuenta.id

  async function handleSave() {
    if (!form.red) { toast.error('Selecciona red'); return }
    setSaving(true)
    try {
      await socialCuentaUpsert(identity, { ...form, id_trainer: form.id_trainer || null })
      toast.success('Cuenta guardada')
      onSaved()
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setSaving(false)
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 20, overflowY: 'auto',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 580, background: 'var(--bg-1)',
        border: '1px solid var(--line-2)', borderRadius: 16, padding: 24, marginTop: 20,
      }}>
        <h3 style={{ fontFamily: 'Outfit', fontSize: 18, fontWeight: 700, color: 'var(--text-0)', marginBottom: 12 }}>
          {isNew ? 'Conectar nueva cuenta Meta' : 'Editar cuenta Meta'}
        </h3>

        <div style={{ padding: 12, marginBottom: 16, borderRadius: 8,
                       background: 'rgba(91,156,246,0.08)', border: '1px solid rgba(91,156,246,0.2)',
                       fontSize: 12, color: 'var(--text-1)', lineHeight: 1.7 }}>
          <p style={{ fontWeight: 600, marginBottom: 6 }}>📋 Datos que necesitas obtener de Meta:</p>
          <ol style={{ paddingLeft: 18 }}>
            <li>Entra a <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noreferrer" style={{ color: 'var(--blue)' }}>Graph API Explorer</a> con tu app</li>
            <li>Genera un <b>User Access Token</b> con permisos: <code style={mono}>instagram_content_publish</code>, <code style={mono}>pages_manage_posts</code>, <code style={mono}>pages_read_engagement</code></li>
            <li>Llama a <code style={mono}>GET /me/accounts</code> → obtén tu <b>Page ID</b> y el <b>Page Access Token</b></li>
            <li>Llama a <code style={mono}>GET /{'{page-id}'}?fields=instagram_business_account</code> → obtén el <b>Instagram Business Account ID</b></li>
            <li>Pégalos abajo y guarda</li>
          </ol>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <Field label="Centro / trainer">
            <select value={form.id_trainer} onChange={e => set({ id_trainer: e.target.value })} style={inputStyle}>
              <option value="">— Manager (todos los centros) —</option>
              {centros.map(c => (
                <option key={c.id_trainer} value={c.id_trainer}>{c.nombre_centro}</option>
              ))}
            </select>
          </Field>
          <Field label="Tipo de cuenta" required>
            <select value={form.red} onChange={e => set({ red: e.target.value })} style={inputStyle}>
              <option value="meta">Instagram + Facebook (recomendado)</option>
              <option value="instagram">Solo Instagram</option>
              <option value="facebook">Solo Facebook</option>
            </select>
          </Field>
        </div>

        <Field label="Nombre / alias">
          <input value={form.nombre} onChange={e => set({ nombre: e.target.value })}
                 placeholder="Round Málaga · IG" style={inputStyle} />
        </Field>

        {(form.red === 'meta' || form.red === 'facebook') && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginTop: 12 }}>
            <Field label="Facebook Page ID">
              <input value={form.fb_page_id} onChange={e => set({ fb_page_id: e.target.value })}
                     placeholder="1234567890" style={inputStyle} />
            </Field>
            <Field label="FB Page Name">
              <input value={form.fb_page_name} onChange={e => set({ fb_page_name: e.target.value })}
                     placeholder="Round Training Center" style={inputStyle} />
            </Field>
          </div>
        )}

        {(form.red === 'meta' || form.red === 'instagram') && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginTop: 12 }}>
            <Field label="IG Business Account ID">
              <input value={form.ig_business_account_id}
                     onChange={e => set({ ig_business_account_id: e.target.value })}
                     placeholder="17841400000000000" style={inputStyle} />
            </Field>
            <Field label="IG Username">
              <input value={form.ig_username} onChange={e => set({ ig_username: e.target.value })}
                     placeholder="roundtrainingcenter" style={inputStyle} />
            </Field>
          </div>
        )}

        <Field label="Page Access Token (60 días)" required={isNew}>
          <div style={{ position: 'relative' }}>
            <input type={showToken ? 'text' : 'password'}
                   value={form.access_token} onChange={e => set({ access_token: e.target.value })}
                   placeholder={cuenta.has_access_token ? `actual: ${cuenta.access_token_preview} (vacío = mantener)` : 'EAAxxx...'}
                   style={{ ...inputStyle, paddingRight: 40, fontFamily: 'monospace', fontSize: 12 }} />
            <button type="button" onClick={() => setShowToken(s => !s)} tabIndex={-1}
                    style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                              background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)' }}>
              {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </Field>

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-2)', marginTop: 12 }}>
          <input type="checkbox" checked={!!form.active} onChange={e => set({ active: e.target.checked })} />
          Cuenta activa (puede publicar)
        </label>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
          <Btn variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Guardar
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
const mono = {
  fontFamily: 'monospace', fontSize: 11, background: 'var(--bg-2)',
  padding: '1px 6px', borderRadius: 4, margin: '0 2px',
}
