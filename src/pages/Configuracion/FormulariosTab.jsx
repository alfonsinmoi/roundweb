// Configuración → Formularios. Builder de formularios de captación
// embebibles. El manager crea un form, elige campos, y copia el código
// <iframe> para pegarlo en su web. El submit público crea leads (o reservas
// de prueba) en su propio CRM. Ver routes/lead_forms.py + /f/<public_id>.
import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, Edit2, Copy, ExternalLink, ArrowUp, ArrowDown, Check, X } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { Card, Btn, Badge } from '../../components/UI'
import Modal from '../../components/Modal'
import { useToast } from '../../components/Toast'
import { getRoundIdentity } from '../../utils/configApi'
import {
  formulariosList, formularioCreate, formularioUpdate, formularioDelete,
} from '../../utils/authUsuarioApi'

const ORIGIN = 'https://noofit.wiemspro.com'

const TIPOS_CAMPO = [
  { type: 'texto',     label: 'Texto' },
  { type: 'email',     label: 'Email' },
  { type: 'telefono',  label: 'Teléfono' },
  { type: 'textarea',  label: 'Texto largo' },
  { type: 'select',    label: 'Desplegable' },
  { type: 'dni',       label: 'DNI / NIE' },
]

function camposPorDefecto(tipo) {
  const base = [
    { key: 'nombre',    label: 'Nombre',   type: 'texto',    required: true },
    { key: 'email',     label: 'Email',    type: 'email',    required: true },
    { key: 'telefono',  label: 'Teléfono', type: 'telefono', required: true },
  ]
  if (tipo === 'prueba') {
    base.splice(1, 0, { key: 'apellidos', label: 'Apellidos', type: 'texto', required: false })
    base.push({ key: 'dni', label: 'DNI / NIE', type: 'dni', required: true })
  } else {
    base.push({ key: 'objetivo', label: '¿Cuál es tu objetivo?', type: 'textarea', required: false })
  }
  return base
}

const slugifyKey = (s) => (s || '').toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'campo'


export default function FormulariosTab() {
  const { user } = useAuth()
  const identity = useMemo(() => getRoundIdentity(user), [user])
  const toast = useToast()
  const [forms, setForms] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)   // form o {} (nuevo)

  const reload = () => {
    setLoading(true)
    formulariosList(identity)
      .then(r => setForms(r.formularios || []))
      .catch(e => toast.error('No se pudo cargar: ' + e.message))
      .finally(() => setLoading(false))
  }
  useEffect(() => { if (identity?.managerId) reload() }, [identity?.managerId])  // eslint-disable-line

  const onDelete = async (f) => {
    if (!window.confirm(`¿Borrar el formulario "${f.nombre}"? El iframe dejará de funcionar.`)) return
    try { await formularioDelete(identity, f.id); toast.success('Formulario borrado'); reload() }
    catch (e) { toast.error('Error: ' + e.message) }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 20, color: 'var(--text-0)', margin: 0 }}>Formularios de captación</h2>
          <p style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4, maxWidth: 560 }}>
            Crea formularios y pégalos en tu web con un <code>&lt;iframe&gt;</code>. Cada envío
            crea un lead (o una reserva de prueba) directamente en tu CRM.
          </p>
        </div>
        <Btn variant="primary" onClick={() => setEditing({})}>
          <Plus size={14} aria-hidden="true" /> Nuevo formulario
        </Btn>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-2)' }}>Cargando…</div>
      ) : !forms.length ? (
        <Card style={{ padding: 32, textAlign: 'center', color: 'var(--text-2)' }}>
          Aún no tienes formularios. Crea el primero.
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {forms.map(f => (
            <Card key={f.id} style={{ padding: 16, opacity: f.activo ? 1 : 0.5 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <strong style={{ color: 'var(--text-0)', fontSize: 15 }}>{f.nombre}</strong>
                    <Badge color={f.tipo === 'prueba' ? 'amber' : 'blue'}>
                      {f.tipo === 'prueba' ? 'Reserva prueba' : 'Lead'}
                    </Badge>
                    {!f.activo && <Badge color="red">Inactivo</Badge>}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
                    {ORIGIN}/f/{f.public_id} · {(f.campos || []).length} campos
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <Btn variant="secondary" size="sm"
                       onClick={() => window.open(`${ORIGIN}/f/${f.public_id}`, '_blank')} title="Previsualizar">
                    <ExternalLink size={12} aria-hidden="true" />
                  </Btn>
                  <Btn variant="secondary" size="sm" onClick={() => setEditing(f)}>
                    <Edit2 size={12} aria-hidden="true" /> Editar
                  </Btn>
                  <Btn variant="secondary" size="sm" onClick={() => onDelete(f)}>
                    <Trash2 size={12} aria-hidden="true" />
                  </Btn>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <FormEditor identity={identity} form={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload() }} />
      )}
    </div>
  )
}


function FormEditor({ identity, form, onClose, onSaved }) {
  const toast = useToast()
  const esNuevo = !form.id
  const [nombre, setNombre] = useState(form.nombre || '')
  const [tipo, setTipo] = useState(form.tipo || 'lead')
  const [campos, setCampos] = useState(
    form.campos && form.campos.length ? form.campos : camposPorDefecto(form.tipo || 'lead'))
  const [cfg, setCfg] = useState(form.config || {
    titulo: '', subtitulo: '', gracias_msg: '', boton_texto: '',
    color: '#2DD4A8', redirect_url: '', centro_slug: '',
    consent_required: true, consent_text: 'Acepto la política de privacidad y el tratamiento de mis datos.',
  })
  const [saving, setSaving] = useState(false)
  const [savedPid, setSavedPid] = useState(form.public_id || null)

  const setCfgK = (k, v) => setCfg(prev => ({ ...prev, [k]: v }))

  const cambiarTipo = (t) => {
    setTipo(t)
    // Si los campos son los de por defecto del tipo anterior, regenéralos
    setCampos(camposPorDefecto(t))
  }

  const addCampo = () => setCampos(c => [...c, { key: `campo_${c.length + 1}`, label: 'Nuevo campo', type: 'texto', required: false, options: [] }])
  const rmCampo = (i) => setCampos(c => c.filter((_, idx) => idx !== i))
  const move = (i, dir) => setCampos(c => {
    const j = i + dir
    if (j < 0 || j >= c.length) return c
    const n = [...c]; [n[i], n[j]] = [n[j], n[i]]; return n
  })
  const setCampoK = (i, k, v) => setCampos(c => c.map((f, idx) => idx === i ? { ...f, [k]: v } : f))

  const handleSave = async () => {
    if (!nombre.trim()) { toast.error('Pon un nombre al formulario'); return }
    // Normalizar keys (únicas, slug)
    const seen = new Set()
    const camposNorm = campos.map(f => {
      let key = slugifyKey(f.key || f.label)
      while (seen.has(key)) key += '_'
      seen.add(key)
      const out = { key, label: f.label || key, type: f.type || 'texto', required: !!f.required }
      if (f.type === 'select') {
        out.options = (typeof f.options === 'string'
          ? f.options.split('\n') : (f.options || []))
          .map(o => (o || '').trim()).filter(Boolean)
      }
      return out
    })
    const payload = { nombre: nombre.trim(), tipo, campos: camposNorm, config: cfg }
    setSaving(true)
    try {
      let res
      if (esNuevo) res = await formularioCreate(identity, payload)
      else         res = await formularioUpdate(identity, form.id, payload)
      setSavedPid(res.formulario?.public_id || savedPid)
      toast.success('Formulario guardado')
      if (esNuevo) {
        // No cerramos: mostramos el embed del recién creado
        form.id = res.formulario?.id
      } else {
        onSaved()
      }
    } catch (e) { toast.error('Error: ' + e.message) }
    finally { setSaving(false) }
  }

  const embed = savedPid
    ? `<iframe src="${ORIGIN}/f/${savedPid}" width="100%" height="720" frameborder="0" style="border:0;max-width:480px"></iframe>`
    : null

  const inp = { width: '100%', padding: 9, borderRadius: 8, fontSize: 13,
                background: 'var(--bg-2)', border: '1px solid var(--line)', color: 'var(--text-0)' }
  const lbl = { display: 'block', fontSize: 12, color: 'var(--text-3)', marginBottom: 5 }

  return (
    <Modal open={true} onClose={onClose} maxWidth={760}
           title={esNuevo ? 'Nuevo formulario' : `Editar: ${form.nombre}`}>
      <div style={{ padding: 24, overflowY: 'auto' }}>
        {/* Datos base */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px', gap: 14, marginBottom: 18 }}>
          <div>
            <label style={lbl}>Nombre del formulario *</label>
            <input style={inp} value={nombre} onChange={e => setNombre(e.target.value)}
                   placeholder="Ej: Prueba gratuita web" />
          </div>
          <div>
            <label style={lbl}>Tipo</label>
            <select style={inp} value={tipo} onChange={e => cambiarTipo(e.target.value)}>
              <option value="lead">Captación de lead</option>
              <option value="prueba">Reserva de clase de prueba</option>
            </select>
          </div>
        </div>

        {tipo === 'prueba' && (
          <div style={{ background: 'var(--bg-2)', borderRadius: 8, padding: 10, fontSize: 12,
                        color: 'var(--text-2)', marginBottom: 16 }}>
            ⚠ La reserva de prueba muestra un selector de horarios del centro indicado abajo
            y requiere DNI. El centro debe tener su trainer con credenciales NoofitPro.
          </div>
        )}

        {/* Campos */}
        <h3 style={{ fontSize: 14, color: 'var(--text-1)', margin: '0 0 8px' }}>Campos del formulario</h3>
        <div style={{ display: 'grid', gap: 8, marginBottom: 8 }}>
          {campos.map((f, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 130px 70px auto',
                                  gap: 8, alignItems: 'center', background: 'var(--bg-2)',
                                  borderRadius: 8, padding: 8 }}>
              <input style={{ ...inp, marginBottom: 0 }} value={f.label}
                     onChange={e => setCampoK(i, 'label', e.target.value)} placeholder="Etiqueta" />
              <select style={{ ...inp, marginBottom: 0 }} value={f.type}
                      onChange={e => setCampoK(i, 'type', e.target.value)}>
                {TIPOS_CAMPO.map(t => <option key={t.type} value={t.type}>{t.label}</option>)}
              </select>
              <label style={{ fontSize: 12, color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <input type="checkbox" checked={!!f.required}
                       onChange={e => setCampoK(i, 'required', e.target.checked)} /> Oblig.
              </label>
              <div style={{ display: 'flex', gap: 2 }}>
                <button onClick={() => move(i, -1)} title="Subir" style={iconBtn}><ArrowUp size={13} /></button>
                <button onClick={() => move(i, 1)} title="Bajar" style={iconBtn}><ArrowDown size={13} /></button>
                <button onClick={() => rmCampo(i)} title="Quitar" style={{ ...iconBtn, color: 'var(--red)' }}><X size={14} /></button>
              </div>
              {f.type === 'select' && (
                <textarea style={{ ...inp, gridColumn: '1 / -1', marginBottom: 0, fontSize: 12 }}
                          rows={2}
                          value={Array.isArray(f.options) ? f.options.join('\n') : (f.options || '')}
                          onChange={e => setCampoK(i, 'options', e.target.value)}
                          placeholder="Una opción por línea" />
              )}
            </div>
          ))}
        </div>
        <Btn variant="secondary" size="sm" onClick={addCampo}><Plus size={12} /> Añadir campo</Btn>

        {/* Config visual */}
        <h3 style={{ fontSize: 14, color: 'var(--text-1)', margin: '20px 0 8px' }}>Apariencia y textos</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div><label style={lbl}>Título</label><input style={inp} value={cfg.titulo || ''} onChange={e => setCfgK('titulo', e.target.value)} /></div>
          <div><label style={lbl}>Subtítulo</label><input style={inp} value={cfg.subtitulo || ''} onChange={e => setCfgK('subtitulo', e.target.value)} /></div>
          <div><label style={lbl}>Texto del botón</label><input style={inp} value={cfg.boton_texto || ''} onChange={e => setCfgK('boton_texto', e.target.value)} placeholder={tipo === 'prueba' ? 'Reservar mi clase' : 'Enviar'} /></div>
          <div><label style={lbl}>Color principal</label><input type="color" style={{ ...inp, height: 38, padding: 3 }} value={cfg.color || '#2DD4A8'} onChange={e => setCfgK('color', e.target.value)} /></div>
          <div style={{ gridColumn: '1 / -1' }}><label style={lbl}>Mensaje de agradecimiento (tras enviar)</label><input style={inp} value={cfg.gracias_msg || ''} onChange={e => setCfgK('gracias_msg', e.target.value)} placeholder="¡Gracias! Te contactaremos pronto." /></div>
          <div><label style={lbl}>Centro (slug)</label><input style={inp} value={cfg.centro_slug || ''} onChange={e => setCfgK('centro_slug', e.target.value)} placeholder="(opcional) Configuración → Centros" /></div>
          <div><label style={lbl}>Redirección tras enviar (URL)</label><input style={inp} value={cfg.redirect_url || ''} onChange={e => setCfgK('redirect_url', e.target.value)} placeholder="(opcional) https://…/gracias" /></div>
        </div>

        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: 'var(--text-2)', marginTop: 14 }}>
          <input type="checkbox" checked={!!cfg.consent_required} onChange={e => setCfgK('consent_required', e.target.checked)} style={{ marginTop: 2 }} />
          <span>Exigir consentimiento RGPD (recomendado)</span>
        </label>
        {cfg.consent_required && (
          <input style={{ ...inp, marginTop: 6 }} value={cfg.consent_text || ''}
                 onChange={e => setCfgK('consent_text', e.target.value)}
                 placeholder="Texto del consentimiento" />
        )}

        {/* Embed code (tras guardar) */}
        {embed && (
          <div style={{ marginTop: 20, background: 'var(--bg-3)', borderRadius: 10, padding: 14,
                        border: '1px solid var(--green-border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <strong style={{ fontSize: 13, color: 'var(--green)' }}>📋 Código para tu web</strong>
              <Btn variant="secondary" size="sm" onClick={() => {
                navigator.clipboard.writeText(embed).then(() => toast.success('Copiado al portapapeles'))
              }}><Copy size={12} /> Copiar</Btn>
            </div>
            <code style={{ display: 'block', fontSize: 11, color: 'var(--text-1)', wordBreak: 'break-all',
                           fontFamily: 'var(--font-mono)', lineHeight: 1.5 }}>{embed}</code>
            <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8 }}>
              Pega este código en tu web (WordPress: bloque HTML personalizado; Wix/Squarespace:
              elemento "Embed/HTML"). El formulario funciona en cualquier sitio.
            </p>
          </div>
        )}
      </div>

      <div style={{ padding: '16px 24px', borderTop: '1px solid var(--line)',
                     display: 'flex', gap: 10, justifyContent: 'flex-end', background: 'var(--bg-2)' }}>
        <Btn variant="secondary" onClick={onClose} disabled={saving}>
          {savedPid && esNuevo ? 'Cerrar' : 'Cancelar'}
        </Btn>
        <Btn variant="primary" onClick={handleSave} disabled={saving}>
          <Check size={14} aria-hidden="true" /> {esNuevo && !savedPid ? 'Crear formulario' : 'Guardar cambios'}
        </Btn>
      </div>
    </Modal>
  )
}

const iconBtn = {
  background: 'var(--bg-1)', border: '1px solid var(--line)', borderRadius: 6,
  cursor: 'pointer', color: 'var(--text-2)', padding: 4, display: 'flex', alignItems: 'center',
}
