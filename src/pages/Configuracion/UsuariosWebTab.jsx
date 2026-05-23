// CRUD de usuarios web (los que entran con email + password propios)
import { useEffect, useState, useMemo } from 'react'
import { Plus, Trash2, Edit2, Mail, RotateCcw, Send, Lock, CheckCircle2, AlertCircle } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { Card, Btn, Badge } from '../../components/UI'
import Modal from '../../components/Modal'
import { useToast } from '../../components/Toast'
import { getRoundIdentity } from '../../utils/configApi'
import {
  usuariosWebList, usuarioWebCreate, usuarioWebUpdate,
  usuarioWebResetPassword, usuarioWebResendVerification, usuarioWebDelete,
  perfilesList,
} from '../../utils/authUsuarioApi'
import { getEntrenadores } from '../../utils/api'

function fmtDate(s) {
  if (!s) return '—'
  try {
    const d = new Date(s)
    if (isNaN(d.getTime())) return s
    return d.toLocaleDateString('es-ES') + ' ' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  } catch { return s }
}

export default function UsuariosWebTab() {
  const { user } = useAuth()
  const identity = useMemo(() => getRoundIdentity(user), [user])
  const toast = useToast()
  const [usuarios, setUsuarios] = useState([])
  const [perfiles, setPerfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState(null)

  const [centros, setCentros] = useState([])

  const reload = async () => {
    setLoading(true)
    try {
      const [u, p, c] = await Promise.all([
        usuariosWebList(identity),
        perfilesList(identity),
        getEntrenadores().catch(() => []),
      ])
      setUsuarios(u.usuarios || [])
      setPerfiles(p.perfiles || [])
      setCentros(c || [])
    } catch (e) { toast.error('Error: ' + e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { if (identity?.managerId) reload() }, [identity?.managerId])

  // Si el backend devuelve `email_send_failed`, el mensaje real está en
  // `e.body.detalle` (+ `e.body.sugerencia`). Lo desglosamos para que el
  // manager sepa exactamente qué pasa (típicamente "Gmail necesita App Password").
  const formatEmailError = (e) => {
    const b = e?.body || {}
    if (b.error === 'email_send_failed') {
      const detalle = b.detalle ? `\n${b.detalle}` : ''
      const sug = b.sugerencia ? `\n\n${b.sugerencia}` : ''
      return `No se ha podido enviar el email.${detalle}${sug}`
    }
    return 'Error: ' + (e.message || 'desconocido')
  }

  const handleResetPwd = async (u) => {
    if (!window.confirm(`¿Forzar reset de contraseña a ${u.email}?\nLe llegará un email para que cree una nueva.`)) return
    try {
      await usuarioWebResetPassword(identity, u.id)
      toast.success(`Email de reset enviado a ${u.email}`)
      reload()
    } catch (e) {
      toast.error(formatEmailError(e))
    }
  }
  const handleResendVerif = async (u) => {
    try {
      await usuarioWebResendVerification(identity, u.id)
      toast.success(`Email de verificación reenviado a ${u.email}`)
    } catch (e) {
      toast.error(formatEmailError(e))
    }
  }
  const handleDelete = async (u) => {
    if (!window.confirm(`¿Desactivar usuario ${u.email}?`)) return
    try { await usuarioWebDelete(identity, u.id); toast.success('Usuario desactivado'); reload() }
    catch (e) { toast.error('Error: ' + e.message) }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 20, color: 'var(--text-0)', margin: 0 }}>Usuarios web</h2>
          <p style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4 }}>
            Personas con acceso a la web Round. Cada uno tiene un perfil que define qué puede hacer.
          </p>
        </div>
        <Btn variant="primary" onClick={() => setCreating(true)}>
          <Plus size={14} aria-hidden="true" /> Nuevo usuario
        </Btn>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-2)' }}>Cargando…</div>
      ) : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-2)', textAlign: 'left' }}>
                <th style={{ padding: 12 }}>Email</th>
                <th style={{ padding: 12 }}>Nombre</th>
                <th style={{ padding: 12 }}>Perfil</th>
                <th style={{ padding: 12 }}>Estado</th>
                <th style={{ padding: 12 }}>Último login</th>
                <th style={{ padding: 12 }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {usuarios.map(u => (
                <tr key={u.id} style={{ borderTop: '1px solid var(--line)', opacity: u.activo ? 1 : 0.5 }}>
                  <td style={{ padding: 12 }}>
                    <code style={{ fontSize: 12, color: 'var(--text-1)' }}>{u.email}</code>
                  </td>
                  <td style={{ padding: 12, color: 'var(--text-1)' }}>
                    {u.nombre} {u.apellidos || ''}
                  </td>
                  <td style={{ padding: 12 }}>
                    {u.perfil_admin ? (
                      <Badge color="amber">{u.perfil_nombre || '—'}</Badge>
                    ) : (
                      <Badge color="blue">{u.perfil_nombre || '—'}</Badge>
                    )}
                  </td>
                  <td style={{ padding: 12 }}>
                    <div style={{ display: 'flex', gap: 4, flexDirection: 'column', alignItems: 'flex-start' }}>
                      {!u.activo && <Badge color="gray">Desactivado</Badge>}
                      {!u.email_verificado && <Badge color="amber">Sin verificar</Badge>}
                      {u.must_change_password && <Badge color="amber">Cambiar pwd</Badge>}
                      {u.locked_until && new Date(u.locked_until) > new Date() && <Badge color="red">Bloqueado</Badge>}
                      {u.activo && u.email_verificado && !u.must_change_password && (!u.locked_until || new Date(u.locked_until) <= new Date()) && (
                        <Badge color="green">OK</Badge>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: 12, color: 'var(--text-2)', fontSize: 12 }}>
                    {fmtDate(u.last_login_at)}
                  </td>
                  <td style={{ padding: 12 }}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <Btn variant="secondary" size="sm" onClick={() => setEditing(u)} title="Editar">
                        <Edit2 size={12} aria-hidden="true" />
                      </Btn>
                      <Btn variant="secondary" size="sm" onClick={() => handleResetPwd(u)} title="Forzar reset password">
                        <RotateCcw size={12} aria-hidden="true" />
                      </Btn>
                      {!u.email_verificado && (
                        <Btn variant="secondary" size="sm" onClick={() => handleResendVerif(u)} title="Reenviar verificación">
                          <Mail size={12} aria-hidden="true" />
                        </Btn>
                      )}
                      <Btn variant="secondary" size="sm" onClick={() => handleDelete(u)} title="Desactivar">
                        <Trash2 size={12} aria-hidden="true" />
                      </Btn>
                    </div>
                  </td>
                </tr>
              ))}
              {!usuarios.length && (
                <tr><td colSpan={6} style={{ padding: 32, textAlign: 'center', color: 'var(--text-2)' }}>
                  No hay usuarios. Crea el primero.
                </td></tr>
              )}
            </tbody>
          </table>
        </Card>
      )}

      {(creating || editing) && (
        <UsuarioEditor
          identity={identity}
          usuario={editing}
          perfiles={perfiles}
          centros={centros}
          onClose={() => { setCreating(false); setEditing(null) }}
          onSaved={() => { setCreating(false); setEditing(null); reload() }}
        />
      )}
    </div>
  )
}


function UsuarioEditor({ identity, usuario, perfiles, centros = [], onClose, onSaved }) {
  const toast = useToast()
  const isEdit = !!usuario
  const [email, setEmail] = useState(usuario?.email || '')
  const [nombre, setNombre] = useState(usuario?.nombre || '')
  const [apellidos, setApellidos] = useState(usuario?.apellidos || '')
  const [telefono, setTelefono] = useState(usuario?.telefono || '')
  const [perfilId, setPerfilId] = useState(usuario?.perfil_id || '')
  const [idTrainer, setIdTrainer] = useState(usuario?.id_trainer || identity?.managerId || '')
  const [activo, setActivo] = useState(usuario?.activo ?? true)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!email.trim() || !email.includes('@')) { toast.error('Email no válido'); return }
    if (!nombre.trim()) { toast.error('Nombre requerido'); return }
    if (!telefono.trim()) { toast.error('Teléfono requerido'); return }
    if (!perfilId) { toast.error('Selecciona un perfil'); return }
    setSaving(true)
    try {
      const payload = {
        email: email.trim().toLowerCase(),
        nombre: nombre.trim(), apellidos: apellidos.trim(), telefono: telefono.trim(),
        perfil_id: Number(perfilId), id_trainer: idTrainer || null,
      }
      let resp = null
      if (isEdit) await usuarioWebUpdate(identity, usuario.id, { ...payload, activo })
      else resp = await usuarioWebCreate(identity, payload)
      // Si el alta fue OK pero el email NO se envió, avisamos en vez de
      // dar éxito silencioso. El usuario queda creado en BD igualmente.
      if (!isEdit && resp && resp.email_sent === false) {
        const sug = resp.email_warning || resp.email_error || 'comprueba la configuración SMTP'
        toast.error(`Usuario creado, pero NO se envió el email: ${sug}`)
      } else {
        toast.success(isEdit ? 'Usuario actualizado' : 'Usuario creado — email de verificación enviado')
      }
      onSaved()
    } catch (e) {
      const detail = e.body?.error
      if (detail === 'email_already_exists') toast.error('Ese email ya está registrado')
      else if (detail === 'perfil_not_found') toast.error('Perfil inválido')
      else if (detail) toast.error(detail)
      else toast.error('Error al guardar')
    } finally { setSaving(false) }
  }

  return (
    <Modal open={true} onClose={onClose} maxWidth={520}
           title={isEdit ? `Editar usuario: ${usuario.email}` : 'Nuevo usuario web'}>
      <div style={{ padding: 24, flex: 1, overflowY: 'auto', minHeight: 0 }}>
        <Field label="Email *">
          <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                 disabled={isEdit} className="form-input"
                 style={fieldStyle(isEdit)} />
        </Field>
        <Field label="Nombre *">
          <input value={nombre} onChange={e => setNombre(e.target.value)} className="form-input" style={fieldStyle()} />
        </Field>
        <Field label="Apellidos">
          <input value={apellidos} onChange={e => setApellidos(e.target.value)} className="form-input" style={fieldStyle()} />
        </Field>
        <Field label="Teléfono *">
          <input value={telefono} onChange={e => setTelefono(e.target.value)} className="form-input" style={fieldStyle()} />
        </Field>
        <Field label="Perfil *">
          <select value={perfilId} onChange={e => setPerfilId(e.target.value)} className="form-input" style={fieldStyle()}>
            <option value="">— Selecciona perfil —</option>
            {perfiles.filter(p => p.activa).map(p => (
              <option key={p.id} value={p.id}>{p.nombre}{p.is_admin ? ' (admin)' : ''}</option>
            ))}
          </select>
        </Field>
        <Field label="Centro">
          <select value={idTrainer || ''}
                  onChange={e => setIdTrainer(e.target.value)}
                  className="form-input" style={fieldStyle()}>
            <option value="">— Corporativo (sin centro asignado) —</option>
            {centros.map(c => {
              const nombre = `${c.nombre ?? c.name ?? ''} ${c.apellidos ?? c.surname ?? ''}`.trim()
                          || c.email
                          || `Centro ${c.id}`
              return <option key={c.id} value={c.id}>{nombre}</option>
            })}
          </select>
          {centros.length === 0 && (
            <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
              No se han podido cargar los centros (igual no hay sesión NoofitPro activa).
            </p>
          )}
        </Field>

        {isEdit && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 13 }}>
            <input type="checkbox" checked={activo} onChange={e => setActivo(e.target.checked)} />
            <span>Usuario activo</span>
          </label>
        )}

        {!isEdit && (
          <div style={{ marginTop: 16, padding: 12, borderRadius: 8, background: 'rgba(91,156,246,0.08)', fontSize: 12, color: 'var(--text-2)' }}>
            <Mail size={12} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            Al crear, le enviaremos un email para que verifique y elija su contraseña.
          </div>
        )}
      </div>
      <div style={{ padding: '16px 24px', borderTop: '1px solid var(--line)',
                     display: 'flex', gap: 10, justifyContent: 'flex-end',
                     flexShrink: 0, background: 'var(--bg-2)' }}>
        <Btn variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Btn>
        <Btn variant="primary" onClick={handleSave} disabled={saving}>Guardar</Btn>
      </div>
    </Modal>
  )
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 12, color: 'var(--text-3)', marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  )
}
function fieldStyle(disabled = false) {
  return {
    width: '100%', padding: 10, borderRadius: 10, fontSize: 14,
    background: disabled ? 'var(--bg-3)' : 'var(--bg-2)',
    border: '1px solid var(--line)', color: 'var(--text-0)',
    opacity: disabled ? 0.6 : 1,
  }
}
