import { useState, useEffect, useMemo } from 'react'
import {
  Mail, Save, Trash2, Plus, Send, AlertCircle, Loader2, Copy, Sparkles, FileText, X,
} from 'lucide-react'
import { Card, Btn, SectionTitle } from '../../components/UI'
import { useToast } from '../../components/Toast'
import { useAuth } from '../../contexts/AuthContext'
import {
  emailTemplatesList, emailTemplatesEvents, emailTemplateCreate,
  emailTemplateUpdate, emailTemplateDelete, emailTemplatesSeed,
  emailTemplateTest, getRoundIdentity,
} from '../../utils/configApi'
import { useOverlayClose } from '../../hooks/useOverlayClose'

export default function EmailTemplatesTab({ identity: identityProp }) {
  const { user, isImpersonating } = useAuth()
  const identity = useMemo(() => identityProp || getRoundIdentity(user), [identityProp, user])
  const toast = useToast()
  const [rows, setRows] = useState([])
  const [meta, setMeta] = useState({ eventos: [], destinatarios: [], variables: [] })
  const [loading, setLoading] = useState(true)
  const [editor, setEditor] = useState(null)   // template en edición
  const [seeding, setSeeding] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const [list, m] = await Promise.all([
        emailTemplatesList(identity),
        emailTemplatesEvents(identity),
      ])
      setRows(list || [])
      setMeta({
        eventos: m.eventos || [],
        destinatarios: m.destinatarios || [],
        variables: m.variables || [],
      })
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setLoading(false)
  }
  useEffect(() => { load() }, [identity.managerId])

  if (isImpersonating || user?.kind === 'usuario_web') {
    return (
      <Card style={{ padding: 32, textAlign: 'center' }}>
        <AlertCircle size={32} style={{ color: 'var(--text-3)', margin: '0 auto 12px' }} />
        <p style={{ color: 'var(--text-2)', fontSize: 13 }}>
          Las plantillas de email solo se gestionan a nivel manager.
        </p>
      </Card>
    )
  }

  async function handleSeed() {
    setSeeding(true)
    try {
      const r = await emailTemplatesSeed(identity)
      toast.success(`Plantillas por defecto insertadas: ${r.inserted} (de ${r.total_defaults} disponibles)`)
      load()
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setSeeding(false)
  }

  async function handleDelete(id) {
    if (!confirm('¿Borrar esta plantilla? Si el evento se dispara y no hay otra plantilla, no se enviará email para este destinatario.')) return
    try {
      await emailTemplateDelete(identity, id)
      toast.success('Plantilla borrada')
      load()
    } catch (e) { toast.error(`Error: ${e.message}`) }
  }

  function eventoLabel(value) {
    return meta.eventos.find(e => e.value === value)?.label || value
  }

  // Agrupar por evento
  const groups = useMemo(() => {
    const map = {}
    for (const r of rows) {
      if (!map[r.evento]) map[r.evento] = []
      map[r.evento].push(r)
    }
    return map
  }, [rows])

  const eventosCubiertos = Object.keys(groups).length
  const eventosTotales = meta.eventos.length

  if (loading) {
    return <Card style={{ padding: 40, textAlign: 'center' }}>
      <Loader2 size={20} className="animate-spin" style={{ color: 'var(--green)' }} />
    </Card>
  }

  return (
    <div>
      <Card style={{ padding: 20, marginBottom: 16 }}>
        <SectionTitle>
          <Mail size={16} style={{ marginRight: 8 }} /> Plantillas de email
        </SectionTitle>
        <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8, lineHeight: 1.6 }}>
          Cada plantilla se asocia a un <b>evento</b> del CRM (ej. lead creado, etapa Visita…)
          y a un <b>destinatario</b> (lead, trainer o manager). Cuando ocurre el evento,
          el sistema envía a ese destinatario el email correspondiente, sustituyendo las
          variables <code style={{ background: 'var(--bg-2)', padding: '1px 5px', borderRadius: 4 }}>{'{{variable}}'}</code>.
        </p>
        <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8 }}>
          Cobertura: <strong style={{ color: eventosCubiertos === 0 ? 'var(--red)' : 'var(--green)' }}>
            {eventosCubiertos}/{eventosTotales}
          </strong> eventos con plantilla.
        </p>
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <Btn variant="secondary" onClick={handleSeed} disabled={seeding}>
            {seeding ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            Cargar plantillas por defecto
          </Btn>
          <Btn variant="primary" onClick={() => setEditor({
            id: null, evento: meta.eventos[0]?.value || '', destinatario: 'lead',
            subject: '', body_html: '', active: true, delay_minutes: 0,
          })}>
            <Plus size={14} /> Nueva plantilla
          </Btn>
        </div>
      </Card>

      {meta.eventos.map(ev => {
        const items = groups[ev.value] || []
        return (
          <Card key={ev.value} style={{ padding: 16, marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <p style={{ fontFamily: 'Outfit', fontWeight: 700, fontSize: 14, color: 'var(--text-0)' }}>
                  {ev.label}
                </p>
                <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2, fontFamily: 'monospace' }}>
                  evento: <code>{ev.value}</code>
                </p>
              </div>
              {items.length === 0 && (
                <span style={{
                  fontSize: 10, padding: '3px 8px', borderRadius: 999,
                  background: 'var(--red-bg)', color: 'var(--red)',
                  border: '1px solid var(--red-border)',
                }}>SIN PLANTILLA</span>
              )}
            </div>

            {items.length > 0 && (
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {items.map(r => (
                  <div key={r.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: 10, background: 'var(--bg-2)', borderRadius: 8,
                    border: '1px solid var(--line)',
                  }}>
                    <span style={{
                      fontSize: 10, padding: '3px 8px', borderRadius: 999,
                      background: r.destinatario === 'lead' ? 'var(--blue-bg)'
                                : r.destinatario === 'trainer' ? 'var(--green-bg)' : 'var(--violet-bg)',
                      color:      r.destinatario === 'lead' ? 'var(--blue)'
                                : r.destinatario === 'trainer' ? 'var(--green)' : 'var(--violet)',
                      fontFamily: 'monospace',
                    }}>{r.destinatario}</span>
                    <span style={{ fontSize: 13, color: 'var(--text-1)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.subject}
                    </span>
                    {!r.active && <span style={{ fontSize: 10, color: 'var(--amber)' }}>(inactiva)</span>}
                    <Btn variant="secondary" onClick={() => setEditor(r)}><FileText size={12} /> Editar</Btn>
                    <Btn variant="ghost" onClick={() => handleDelete(r.id)}><Trash2 size={12} /></Btn>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )
      })}

      {editor && (
        <EditorModal
          tpl={editor}
          meta={meta}
          identity={identity}
          onClose={() => setEditor(null)}
          onSaved={() => { setEditor(null); load() }}
        />
      )}
    </div>
  )
}


function EditorModal({ tpl, meta, identity, onClose, onSaved }) {
  const toast = useToast()
  const [form, setForm] = useState({
    evento:        tpl.evento || '',
    destinatario:  tpl.destinatario || 'lead',
    subject:       tpl.subject || '',
    body_html:     tpl.body_html || '',
    active:        tpl.active ?? true,
    delay_minutes: tpl.delay_minutes || 0,
  })
  const [saving, setSaving] = useState(false)
  const [testEmail, setTestEmail] = useState('')
  const [testing, setTesting] = useState(false)
  const set = patch => setForm(f => ({ ...f, ...patch }))
  const overlayClose = useOverlayClose(onClose)

  async function handleSave() {
    setSaving(true)
    try {
      if (tpl.id) {
        await emailTemplateUpdate(identity, tpl.id, form)
      } else {
        await emailTemplateCreate(identity, form)
      }
      toast.success('Plantilla guardada')
      onSaved()
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setSaving(false)
  }

  async function handleTest() {
    if (!tpl.id) { toast.error('Guarda primero la plantilla'); return }
    if (!testEmail) { toast.error('Indica un email destino'); return }
    setTesting(true)
    try {
      const r = await emailTemplateTest(identity, tpl.id, testEmail)
      if (r.ok) toast.success(`Email de prueba enviado a ${testEmail}`)
      else      toast.error(`Falló: ${r.error || 'desconocido'}`)
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setTesting(false)
  }

  function copyVariable(v) {
    const text = `{{${v}}}`
    navigator.clipboard?.writeText(text)
    toast.success(`Copiada ${text}`)
  }

  return (
    <div {...overlayClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 20,
      overflowY: 'auto',
    }}>
      <div style={{
        width: '100%', maxWidth: 820, background: 'var(--bg-1)',
        border: '1px solid var(--line-2)', borderRadius: 'var(--radius-lg)',
        padding: 24, marginTop: 20, marginBottom: 20,
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ fontFamily: 'Outfit', fontWeight: 700, fontSize: 18, color: 'var(--text-0)' }}>
            {tpl.id ? 'Editar plantilla' : 'Nueva plantilla'}
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)' }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <Field label="Evento" required>
            <select value={form.evento} onChange={e => set({ evento: e.target.value })}
                    disabled={!!tpl.id} style={inputStyle}>
              <option value="">— elige —</option>
              {meta.eventos.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Destinatario" required>
            <select value={form.destinatario} onChange={e => set({ destinatario: e.target.value })}
                    disabled={!!tpl.id} style={inputStyle}>
              {meta.destinatarios.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>
        </div>

        <div style={{ marginTop: 12 }}>
          <Field label="Asunto" required>
            <input value={form.subject} onChange={e => set({ subject: e.target.value })}
                   placeholder="Hola {{lead_name}}, hemos recibido tu solicitud" style={inputStyle} />
          </Field>
        </div>

        <div style={{ marginTop: 12 }}>
          <Field label="Cuerpo (HTML)" required>
            <textarea value={form.body_html} onChange={e => set({ body_html: e.target.value })}
                      rows={12} style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }} />
          </Field>
        </div>

        <Card style={{ padding: 12, marginTop: 12, background: 'var(--bg-2)' }}>
          <p style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Variables disponibles (clic para copiar):
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {(meta.variables || []).map(v => (
              <button key={v} type="button" onClick={() => copyVariable(v)}
                      style={{
                        fontSize: 11, fontFamily: 'monospace',
                        padding: '3px 8px', borderRadius: 6,
                        background: 'var(--bg-3)', border: '1px solid var(--line)',
                        color: 'var(--text-1)', cursor: 'pointer',
                      }}>
                <Copy size={9} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                {`{{${v}}}`}
              </button>
            ))}
          </div>
        </Card>

        <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 12, color: 'var(--text-2)' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={!!form.active} onChange={e => set({ active: e.target.checked })} />
            Activa (se envía cuando ocurre el evento)
          </label>
        </div>

        {tpl.id && (
          <Card style={{ padding: 12, marginTop: 16, background: 'var(--bg-2)' }}>
            <p style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Probar plantilla (datos de ejemplo):
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input type="email" value={testEmail} onChange={e => setTestEmail(e.target.value)}
                     placeholder="tu@email.com" style={{ ...inputStyle, flex: 1 }} />
              <Btn variant="secondary" onClick={handleTest} disabled={testing}>
                {testing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                Enviar prueba
              </Btn>
            </div>
          </Card>
        )}

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
