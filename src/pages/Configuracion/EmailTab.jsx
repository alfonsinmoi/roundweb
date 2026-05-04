import { useState, useEffect, useMemo } from 'react'
import {
  Mail, Save, Eye, EyeOff, Loader2, Send, AlertCircle, ExternalLink,
  ChevronDown, ChevronRight, Trash2, Building2, Users,
} from 'lucide-react'
import { Card, Btn, SectionTitle } from '../../components/UI'
import { useToast } from '../../components/Toast'
import { useAuth } from '../../contexts/AuthContext'
import {
  emailListAll, emailUpsert, emailDelete, emailTest,
  centrosList, getRoundIdentity,
} from '../../utils/configApi'

const PROVEEDOR_OPTIONS = [
  { v: 'gmail',    l: 'Gmail',          sub: 'SMTP Google · cuenta personal o Workspace', preset: { smtp_host: 'smtp.gmail.com', smtp_port: 587, smtp_tls: true } },
  { v: 'resend',   l: 'Resend',         sub: '3000/mes gratis · recomendado', href: 'https://resend.com' },
  { v: 'postmark', l: 'Postmark',       sub: '~12 €/mes · entrega excelente',  href: 'https://postmarkapp.com' },
  { v: 'smtp',     l: 'SMTP propio',    sub: 'Tu hosting / otro proveedor SMTP' },
]

function emptyForm() {
  return {
    proveedor: 'gmail', api_key: '',
    smtp_host: 'smtp.gmail.com', smtp_port: 587,
    smtp_user: '', smtp_pass: '', smtp_tls: true,
    from_name: 'Round', from_email: '', reply_to: '',
    active: true, notas: '',
  }
}


export default function EmailTab({ identity: identityProp }) {
  const { user, isImpersonating } = useAuth()
  const identity = useMemo(() => identityProp || getRoundIdentity(user), [identityProp, user])
  const toast = useToast()
  const [centros, setCentros] = useState([])
  const [configs, setConfigs] = useState([])  // todas las filas email_proveedor
  const [loading, setLoading] = useState(true)
  const [openKey, setOpenKey] = useState('manager')   // 'manager' o id_trainer

  async function load() {
    setLoading(true)
    try {
      const [{ rows }, c] = await Promise.all([
        emailListAll(identity),
        centrosList(identity),
      ])
      setConfigs(rows || [])
      setCentros(c || [])
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setLoading(false)
  }
  useEffect(() => { load() }, [identity.managerId])

  if (isImpersonating) {
    return (
      <Card style={{ padding: 32, textAlign: 'center' }}>
        <AlertCircle size={32} style={{ color: 'var(--text-3)', margin: '0 auto 12px' }} />
        <p style={{ color: 'var(--text-2)', fontSize: 13 }}>
          Esta sección solo está disponible para el manager.
        </p>
      </Card>
    )
  }

  if (loading) {
    return <Card style={{ padding: 40, textAlign: 'center' }}>
      <Loader2 size={20} className="animate-spin" style={{ color: 'var(--green)' }} />
    </Card>
  }

  // Dividir configs en manager (id_trainer null) + por trainer
  const managerCfg = configs.find(c => !c.id_trainer)
  const trainerCfgs = new Map(configs.filter(c => c.id_trainer).map(c => [String(c.id_trainer), c]))

  return (
    <div>
      {/* Intro */}
      <Card style={{ padding: 20, marginBottom: 16 }}>
        <SectionTitle><Mail size={16} style={{ marginRight: 8 }} /> Email transaccional</SectionTitle>
        <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8, lineHeight: 1.6 }}>
          Configura qué cuenta envía los emails automáticos. Tienes dos niveles:
        </p>
        <ul style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 6, paddingLeft: 18, lineHeight: 1.7 }}>
          <li><b>Manager (global)</b>: la cuenta por defecto si un centro no tiene la suya. Recomendado: Resend o tu Gmail principal.</li>
          <li><b>Por centro</b>: cada trainer puede tener su Gmail personal — los leads asignados a su centro recibirán los emails desde ahí.</li>
        </ul>
      </Card>

      {/* Config manager (global) */}
      <ProveedorCard
        title="Configuración global (manager)"
        subtitle="Se usa por defecto. Fallback si un centro no tiene config propia."
        icon={<Users size={14} style={{ marginRight: 6 }} />}
        existing={managerCfg}
        identity={identity}
        trainerId={null}
        isOpen={openKey === 'manager'}
        onToggle={() => setOpenKey(openKey === 'manager' ? null : 'manager')}
        onChanged={load}
      />

      {/* Configs por centro */}
      {centros.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <p style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase',
                      letterSpacing: '0.04em', marginBottom: 8 }}>
            Por centro / trainer
          </p>
          {centros.map(c => {
            const cfg = trainerCfgs.get(String(c.id_trainer))
            const key = `t-${c.id_trainer}`
            return (
              <ProveedorCard
                key={key}
                title={c.nombre_centro}
                subtitle={cfg
                  ? `Activo · ${cfg.proveedor} · ${cfg.from_email}`
                  : 'Sin config · usa la global del manager'}
                icon={<Building2 size={14} style={{ marginRight: 6 }} />}
                existing={cfg}
                identity={identity}
                trainerId={c.id_trainer}
                centro={c}
                isOpen={openKey === key}
                onToggle={() => setOpenKey(openKey === key ? null : key)}
                onChanged={load}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}


/** Card colapsable con el formulario de proveedor (manager o trainer). */
function ProveedorCard({ title, subtitle, icon, existing, identity, trainerId, centro, isOpen, onToggle, onChanged }) {
  return (
    <Card style={{ padding: 0, marginBottom: 10, overflow: 'hidden' }}>
      <button onClick={onToggle} style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 10,
        padding: '14px 18px', background: 'transparent', border: 'none',
        cursor: 'pointer', textAlign: 'left',
      }}>
        {isOpen ? <ChevronDown size={16} style={{ color: 'var(--text-3)' }} />
                : <ChevronRight size={16} style={{ color: 'var(--text-3)' }} />}
        {icon}
        <span style={{ flex: 1 }}>
          <span style={{ fontFamily: 'Outfit', fontWeight: 700, fontSize: 14, color: 'var(--text-0)', display: 'block' }}>
            {title}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{subtitle}</span>
        </span>
        {existing?.active && (
          <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 999,
                         background: 'var(--green-bg)', color: 'var(--green)',
                         border: '1px solid var(--green-border)' }}>
            ACTIVO
          </span>
        )}
      </button>

      {isOpen && (
        <div style={{ padding: '0 18px 18px', borderTop: '1px solid var(--line)' }}>
          <ProveedorForm
            existing={existing}
            identity={identity}
            trainerId={trainerId}
            centro={centro}
            onSaved={onChanged}
          />
        </div>
      )}
    </Card>
  )
}


function ProveedorForm({ existing, identity, trainerId, centro, onSaved }) {
  const toast = useToast()
  const [form, setForm] = useState(existing
    ? hydrate(existing, centro)
    : seedFormFromCentro(centro))
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testEmail, setTestEmail] = useState('')
  const [testing, setTesting] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Si cambian existing/centro (cargar datos nuevos), refrescar form
  useEffect(() => {
    setForm(existing ? hydrate(existing, centro) : seedFormFromCentro(centro))
  }, [existing?.id, centro?.id_trainer])

  const set = patch => setForm(f => ({ ...f, ...patch }))

  async function handleSave() {
    if (!form.from_email) { toast.error('From email es obligatorio'); return }
    setSaving(true)
    try {
      await emailUpsert(identity, form, trainerId)
      toast.success('Configuración guardada')
      onSaved && onSaved()
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setSaving(false)
  }

  async function handleTest() {
    if (!testEmail) { toast.error('Indica un email destino para la prueba'); return }
    setTesting(true)
    try {
      const r = await emailTest(identity, testEmail, trainerId)
      if (r.ok) toast.success(`Email enviado a ${testEmail}`)
      else      toast.error(`Falló: ${r.detail || r.error}`)
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setTesting(false)
  }

  async function handleDelete() {
    if (!trainerId) return
    if (!confirm('¿Borrar la config de este centro? Se usará la del manager como fallback.')) return
    setDeleting(true)
    try {
      await emailDelete(identity, trainerId)
      toast.success('Config del centro borrada')
      onSaved && onSaved()
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setDeleting(false)
  }

  function setProveedor(v) {
    const opt = PROVEEDOR_OPTIONS.find(o => o.v === v)
    setForm(f => ({ ...f, proveedor: v, ...(opt?.preset || {}) }))
  }

  return (
    <div style={{ paddingTop: 14 }}>
      {/* Selector de proveedor */}
      <p style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase',
                  letterSpacing: '0.04em', marginBottom: 8 }}>
        Proveedor
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {PROVEEDOR_OPTIONS.map(o => (
          <button key={o.v} onClick={() => setProveedor(o.v)} type="button"
                  style={{
                    flex: '1 1 200px', padding: 12, borderRadius: 10, cursor: 'pointer',
                    background: form.proveedor === o.v ? 'rgba(45,212,168,0.1)' : 'var(--bg-2)',
                    border: `1px solid ${form.proveedor === o.v ? 'rgba(45,212,168,0.4)' : 'var(--line)'}`,
                    textAlign: 'left',
                  }}>
            <p style={{ fontFamily: 'Outfit', fontWeight: 600, fontSize: 13,
                        color: form.proveedor === o.v ? 'var(--green)' : 'var(--text-0)' }}>
              {o.l}
            </p>
            <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{o.sub}</p>
            {o.href && <a href={o.href} target="_blank" rel="noreferrer"
                          onClick={e => e.stopPropagation()}
                          style={{ fontSize: 11, color: 'var(--blue)',
                                   display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
              Web <ExternalLink size={10} />
            </a>}
          </button>
        ))}
      </div>

      {/* Aviso Gmail */}
      {form.proveedor === 'gmail' && (
        <div style={{ padding: 12, marginBottom: 14, borderRadius: 8,
                      background: 'rgba(91,156,246,0.08)', border: '1px solid rgba(91,156,246,0.2)',
                      fontSize: 12, color: 'var(--text-1)', lineHeight: 1.6 }}>
          <p style={{ fontWeight: 600, marginBottom: 4 }}>
            ℹ Cómo configurar Gmail (5 min):
          </p>
          <ol style={{ paddingLeft: 18, margin: '4px 0' }}>
            <li>Activa la <a href="https://myaccount.google.com/security" target="_blank" rel="noreferrer" style={{ color: 'var(--blue)' }}>verificación en 2 pasos</a> en la cuenta Gmail.</li>
            <li>Genera una <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" style={{ color: 'var(--blue)' }}>contraseña de aplicación</a> (16 caracteres). Cópiala antes de cerrar la ventana.</li>
            <li>Pega abajo el email Gmail en <b>From email</b> y la contraseña de aplicación en <b>Password SMTP</b>.</li>
          </ol>
          <p style={{ marginTop: 6, color: 'var(--text-3)', fontSize: 11 }}>
            ⚠ Cuentas <code>@gmail.com</code> personales: límite ~500 emails/día.
            Workspace <code>@tu-dominio</code>: ~2000/día.
          </p>
        </div>
      )}

      {/* Credenciales */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        {(form.proveedor === 'resend' || form.proveedor === 'postmark') && (
          <Field label={form.proveedor === 'resend' ? 'API Key Resend' : 'Server Token Postmark'}
                 required={!form._has_api_key}>
            <div style={{ position: 'relative' }}>
              <input type={showKey ? 'text' : 'password'} value={form.api_key}
                     onChange={e => set({ api_key: e.target.value })}
                     placeholder={form._has_api_key ? `actual: ${form._api_preview} (vacío = mantener)` : 'pega aquí la key'}
                     style={inputStyle} />
              <button onClick={() => setShowKey(s => !s)} type="button"
                      style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                               background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)' }}>
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </Field>
        )}
        {(form.proveedor === 'smtp' || form.proveedor === 'gmail') && (
          <>
            <Field label="Host SMTP" required>
              <input value={form.smtp_host}
                     onChange={e => set({ smtp_host: e.target.value })}
                     placeholder="smtp.gmail.com" style={inputStyle}
                     disabled={form.proveedor === 'gmail'} />
            </Field>
            <Field label="Puerto" required>
              <input type="number" value={form.smtp_port}
                     onChange={e => set({ smtp_port: parseInt(e.target.value) || 587 })}
                     style={inputStyle} disabled={form.proveedor === 'gmail'} />
            </Field>
            <Field label="Usuario SMTP" required>
              <input value={form.smtp_user}
                     onChange={e => set({ smtp_user: e.target.value })}
                     placeholder={form.proveedor === 'gmail' ? 'tu@gmail.com' : 'usuario'}
                     style={inputStyle} />
            </Field>
            <Field label={form.proveedor === 'gmail' ? 'App Password (16 chars)' : 'Password SMTP'}
                   required={!form._has_smtp_pass}>
              <input type="password" value={form.smtp_pass}
                     onChange={e => set({ smtp_pass: e.target.value.replace(/\s/g, '') })}
                     placeholder={form._has_smtp_pass ? '(mantener actual)' : 'xxxxxxxxxxxxxxxx'}
                     style={inputStyle} />
            </Field>
            {form.proveedor === 'smtp' && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-2)' }}>
                <input type="checkbox" checked={!!form.smtp_tls}
                       onChange={e => set({ smtp_tls: e.target.checked })} />
                STARTTLS
              </label>
            )}
          </>
        )}
      </div>

      {/* Remitente */}
      <p style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase',
                  letterSpacing: '0.04em', marginTop: 18, marginBottom: 8 }}>
        Remitente
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <Field label="Nombre del remitente">
          <input value={form.from_name}
                 onChange={e => set({ from_name: e.target.value })}
                 placeholder="Round Training Center" style={inputStyle} />
        </Field>
        <Field label="From email" required>
          <input type="email" value={form.from_email}
                 onChange={e => {
                   const v = e.target.value
                   set({ from_email: v, ...(form.proveedor === 'gmail' && !form.smtp_user ? { smtp_user: v } : {}) })
                 }}
                 placeholder={form.proveedor === 'gmail' ? 'centro@gmail.com' : 'noreply@tudominio.com'}
                 style={inputStyle} />
        </Field>
        <Field label="Reply-To">
          <input type="email" value={form.reply_to}
                 onChange={e => set({ reply_to: e.target.value })}
                 placeholder="info@tudominio.com" style={inputStyle} />
        </Field>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-2)' }}>
          <input type="checkbox" checked={!!form.active}
                 onChange={e => set({ active: e.target.checked })} />
          Configuración activa
        </label>
      </div>

      {/* Acciones */}
      <div style={{ display: 'flex', gap: 8, marginTop: 18, flexWrap: 'wrap', alignItems: 'center' }}>
        <Btn variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Guardar
        </Btn>
        {existing && trainerId && (
          <Btn variant="ghost" onClick={handleDelete} disabled={deleting}>
            <Trash2 size={14} /> Borrar (usar fallback manager)
          </Btn>
        )}
        <div style={{ flex: 1 }} />
        {existing && (
          <>
            <input type="email" value={testEmail}
                   onChange={e => setTestEmail(e.target.value)}
                   placeholder="email para prueba"
                   style={{ ...inputStyle, maxWidth: 240, flex: 'none' }} />
            <Btn variant="secondary" onClick={handleTest} disabled={testing}>
              {testing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              Probar
            </Btn>
          </>
        )}
      </div>
    </div>
  )
}


// ── helpers ───────────────────────────────────────────────────────────────
function hydrate(r, centro) {
  return {
    proveedor: r.proveedor || 'gmail',
    api_key: '',
    smtp_host: r.smtp_host || (r.proveedor === 'gmail' ? 'smtp.gmail.com' : ''),
    smtp_port: r.smtp_port || (r.proveedor === 'gmail' ? 587 : 587),
    smtp_user: r.smtp_user || '',
    smtp_pass: '',
    smtp_tls: r.smtp_tls ?? true,
    from_name: r.from_name || centro?.nombre_centro || 'Round',
    from_email: r.from_email || '',
    reply_to: r.reply_to || centro?.email || '',
    active: r.active ?? true,
    notas: r.notas || '',
    _has_api_key: r.has_api_key,
    _api_preview: r.api_key_preview,
    _has_smtp_pass: r.has_smtp_pass,
  }
}
function seedFormFromCentro(centro) {
  const f = {
    proveedor: 'gmail', api_key: '',
    smtp_host: 'smtp.gmail.com', smtp_port: 587,
    smtp_user: '', smtp_pass: '', smtp_tls: true,
    from_name: centro?.nombre_centro || 'Round',
    from_email: '', reply_to: centro?.email || '',
    active: true, notas: '',
  }
  return f
}

function Field({ label, required, children }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase',
                     letterSpacing: '0.04em', display: 'block', marginBottom: 4 }}>
        {label} {required && <span style={{ color: 'var(--red)' }}>*</span>}
      </span>
      {children}
    </label>
  )
}

const inputStyle = {
  padding: '8px 10px', borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--line)', background: 'var(--bg-1)',
  color: 'var(--text-0)', fontSize: 13, width: '100%',
}
