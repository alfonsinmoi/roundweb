// Modal para dar de alta a un cliente (categoría Trabajador) como usuario web.
//
// Pre-rellena email/nombre/apellidos/teléfono desde la ficha del cliente.
// Pregunta perfil + centros (multi-select). Llama POST /api/config/usuarios-web.
//
// Tras crearlo, el banner "Usuario web" debería aparecer en la ficha del
// cliente (lo gestiona el componente padre re-fetcheando la búsqueda por email).

import { useState, useEffect, useMemo } from 'react'
import { UserCog, Loader2, Check, Mail, AlertCircle } from 'lucide-react'
import Modal from './Modal'
import { Btn } from './UI'
import { useToast } from './Toast'
import { useAuth } from '../contexts/AuthContext'
import { getRoundIdentity } from '../utils/configApi'
import {
  usuarioWebCreate, perfilesList,
} from '../utils/authUsuarioApi'
import { getEntrenadores } from '../utils/api'

const inputStyle = {
  width: '100%', padding: 10, borderRadius: 10, fontSize: 13,
  background: 'var(--bg-2)', border: '1px solid var(--line)', color: 'var(--text-0)',
}

function Field({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 12, color: 'var(--text-3)', marginBottom: 4 }}>{label}</label>
      {children}
      {hint && <p style={{ fontSize: 11, color: 'var(--text-3)', margin: '4px 0 0 0' }}>{hint}</p>}
    </div>
  )
}


export default function CrearUsuarioWebDesdeClienteModal({ cliente, onClose, onSaved }) {
  const { user } = useAuth()
  const identity = useMemo(() => getRoundIdentity(user), [user])
  const toast = useToast()

  // Datos copiados del cliente (editables — los pre-rellenados aparecen
  // en gris claro indicando que vienen de la ficha)
  const [email, setEmail] = useState(cliente?.email || '')
  const [nombre, setNombre] = useState(cliente?.name || '')
  const [apellidos, setApellidos] = useState(cliente?.surname || '')
  const [telefono, setTelefono] = useState(cliente?.cellPhone || '')

  // Datos pedidos en el formulario (no están en la ficha del cliente)
  const [perfilId, setPerfilId] = useState('')
  // Por defecto le asignamos el trainer del cliente (la mayoría de
  // trabajadores ficharán en su mismo centro). El usuario puede marcar más
  // si tiene acceso a varios centros del manager.
  const initialTrainer = cliente?.idTrainer ? [String(cliente.idTrainer)] : []
  const [idTrainers, setIdTrainers] = useState(initialTrainer)

  const [perfiles, setPerfiles] = useState([])
  const [centros, setCentros] = useState([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    (async () => {
      setLoading(true)
      try {
        const [p, c] = await Promise.all([
          perfilesList(identity).catch(() => ({ perfiles: [] })),
          getEntrenadores().catch(() => []),
        ])
        setPerfiles(p.perfiles || [])
        setCentros(c || [])
      } finally { setLoading(false) }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggleTrainer = (id) => {
    const s = String(id)
    setIdTrainers(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])
  }

  const handleSubmit = async () => {
    if (!email.trim() || !email.includes('@')) { toast.error('Email no válido'); return }
    if (!nombre.trim()) { toast.error('Nombre requerido'); return }
    if (!telefono.trim()) { toast.error('Teléfono requerido'); return }
    if (!perfilId) { toast.error('Selecciona un perfil'); return }
    setSubmitting(true)
    try {
      const payload = {
        email: email.trim().toLowerCase(),
        nombre: nombre.trim(),
        apellidos: apellidos.trim(),
        telefono: telefono.trim(),
        perfil_id: Number(perfilId),
        id_trainers: idTrainers,
      }
      const r = await usuarioWebCreate(identity, payload)
      if (r.email_sent === false) {
        toast.error(`Usuario creado, pero NO se envió el email: ${r.email_warning || 'comprueba SMTP'}`)
      } else {
        toast.success('Usuario web creado — recibirá email de verificación')
      }
      onSaved && onSaved(r.usuario)
      onClose && onClose()
    } catch (e) {
      const detail = e.body?.error
      if (detail === 'email_already_exists') {
        toast.error('Este email ya está dado de alta como usuario web')
      } else {
        toast.error('Error al crear: ' + (detail || e.message))
      }
    } finally { setSubmitting(false) }
  }

  return (
    <Modal open={true} onClose={onClose} maxWidth={560}
           title={<><UserCog size={16} style={{ marginRight: 6 }} /> Crear acceso web para trabajador</>}>
      <div style={{ padding: 24, flex: 1, overflowY: 'auto', minHeight: 0 }}>

        <div style={{ padding: 12, borderRadius: 10, background: 'rgba(91,156,246,0.08)',
                      border: '1px solid rgba(91,156,246,0.2)',
                      fontSize: 12, color: 'var(--text-2)', marginBottom: 16, lineHeight: 1.5 }}>
          <Mail size={12} style={{ marginRight: 6, verticalAlign: 'middle' }} />
          <strong>{cliente?.name} {cliente?.surname}</strong> recibirá un email para verificar
          su cuenta y crear su contraseña. Si el servicio de email no está
          configurado, el manager puede compartirle el link de reset manualmente
          desde Configuración → Usuarios web.
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-3)' }}>
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : (
          <>
            <Field label="Email *">
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                     style={inputStyle} />
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              <Field label="Nombre *">
                <input value={nombre} onChange={e => setNombre(e.target.value)} style={inputStyle} />
              </Field>
              <Field label="Apellidos">
                <input value={apellidos} onChange={e => setApellidos(e.target.value)} style={inputStyle} />
              </Field>
            </div>
            <Field label="Teléfono *">
              <input value={telefono} onChange={e => setTelefono(e.target.value)} style={inputStyle} />
            </Field>

            <Field label="Perfil *"
                   hint="Determina qué menús y acciones podrá usar en el sistema.">
              <select value={perfilId} onChange={e => setPerfilId(e.target.value)} style={inputStyle}>
                <option value="">— Selecciona perfil —</option>
                {perfiles.filter(p => p.activa).map(p => (
                  <option key={p.id} value={p.id}>{p.nombre}{p.is_admin ? ' (admin)' : ''}</option>
                ))}
              </select>
              {perfiles.length === 0 && (
                <p style={{ fontSize: 11, color: 'var(--amber)', marginTop: 4 }}>
                  <AlertCircle size={11} style={{ verticalAlign: 'middle' }} /> No
                  hay perfiles. Créalos en Configuración → Perfiles antes de continuar.
                </p>
              )}
            </Field>

            <Field label={`Centros con acceso (${idTrainers.length} seleccionado${idTrainers.length === 1 ? '' : 's'})`}
                   hint="Por defecto se asigna el centro del cliente. Si selecciona más de uno, al iniciar sesión podrá elegir.">
              <div style={{
                border: '1px solid var(--line)', borderRadius: 10,
                background: 'var(--bg-2)', maxHeight: 160, overflowY: 'auto',
              }}>
                {centros.length === 0 ? (
                  <p style={{ padding: 12, fontSize: 12, color: 'var(--text-3)', margin: 0 }}>
                    No se han podido cargar los centros (sin sesión NoofitPro activa).
                  </p>
                ) : (
                  centros.map(c => {
                    const id = String(c.id)
                    const checked = idTrainers.includes(id)
                    const nombreCentro = `${c.nombre ?? c.name ?? ''} ${c.apellidos ?? c.surname ?? ''}`.trim()
                              || c.email || `Centro ${c.id}`
                    return (
                      <label key={c.id}
                             style={{
                               display: 'flex', alignItems: 'center', gap: 10,
                               padding: '8px 12px', cursor: 'pointer', fontSize: 13,
                               borderBottom: '1px solid var(--line)',
                             }}>
                        <input type="checkbox" checked={checked}
                               onChange={() => toggleTrainer(c.id)} />
                        <span style={{ flex: 1 }}>{nombreCentro}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>id {c.id}</span>
                      </label>
                    )
                  })
                )}
              </div>
            </Field>
          </>
        )}
      </div>

      <div style={{ padding: '16px 24px', borderTop: '1px solid var(--line)',
                    display: 'flex', gap: 10, justifyContent: 'flex-end',
                    flexShrink: 0, background: 'var(--bg-2)' }}>
        <Btn variant="secondary" onClick={onClose} disabled={submitting}>Cancelar</Btn>
        <Btn variant="primary" onClick={handleSubmit} disabled={submitting || loading}>
          {submitting ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          {' '}Crear usuario web
        </Btn>
      </div>
    </Modal>
  )
}
