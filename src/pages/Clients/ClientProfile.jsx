import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, User, CalendarCheck, Send,
  Archive, UserX, CheckCircle2, XCircle,
  Heart, Ruler, Weight, Target, Loader2,
  Activity, Smartphone, Settings, Shield, Mail, Phone, Pencil, Dumbbell,
} from 'lucide-react'
import { Card, Badge, Btn, Avatar, SectionTitle } from '../../components/UI'
import ConfirmDialog from '../../components/ConfirmDialog'
import Modal from '../../components/Modal'
import { useToast } from '../../components/Toast'
import { useAuth } from '../../contexts/AuthContext'
import {
  getClientes, postClientes, desvinculaCliente as apiDesvincular,
  getClasesCliente, getERPConfiguracion, getERPDatosCliente, loginEasy,
} from '../../utils/api'

const tabs = [
  { id: 'personal', label: 'Datos personales', icon: User },
  { id: 'clases',   label: 'Clases realizadas', icon: CalendarCheck },
  { id: 'erp',      label: 'Datos ERP',         icon: Send },
]

function calcEdad(birthdate) {
  if (!birthdate) return null
  const d = new Date(birthdate)
  if (isNaN(d)) return null
  const hoy = new Date()
  let age = hoy.getFullYear() - d.getFullYear()
  if (hoy < new Date(hoy.getFullYear(), d.getMonth(), d.getDate())) age--
  return age
}

function formatDate(val) {
  if (!val) return '—'
  const d = new Date(val)
  return isNaN(d) ? '—' : d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function boolLabel(val) {
  if (val === true || val === 1) return 'Sí'
  if (val === false || val === 0) return 'No'
  return '—'
}

// Editable text/number/date/email/tel field
function Field({ label, value, children, editing, fieldKey, editForm, setEditForm, type = 'text' }) {
  if (editing && fieldKey && editForm && setEditForm) {
    return (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
        <dt style={{ fontSize: 13, color: 'var(--text-3)', flexShrink: 0 }}>{label}</dt>
        <dd>
          <input
            type={type}
            value={editForm[fieldKey] ?? ''}
            onChange={e => setEditForm(f => ({
              ...f,
              [fieldKey]: type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value,
            }))}
            className="form-input"
            style={{
              width: '100%', maxWidth: 240, padding: '8px 12px', borderRadius: 10, fontSize: 13,
              background: 'var(--bg-1)', border: '1px solid var(--line)', color: 'var(--text-0)',
              textAlign: 'right',
            }}
          />
        </dd>
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16, padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
      <dt style={{ fontSize: 13, color: 'var(--text-3)', flexShrink: 0 }}>{label}</dt>
      <dd style={{ fontSize: 13, color: 'var(--text-1)', textAlign: 'right', wordBreak: 'break-word' }}>
        {children ?? (value != null && value !== '' ? String(value) : '—')}
      </dd>
    </div>
  )
}

// Read-only boolean field
function BoolField({ label, value }) {
  const yes = value === true || value === 1
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16, padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
      <dt style={{ fontSize: 13, color: 'var(--text-3)', flexShrink: 0 }}>{label}</dt>
      <dd>
        {yes
          ? <Badge color="red"><XCircle size={10} aria-hidden="true" /> Sí</Badge>
          : <Badge color="green"><CheckCircle2 size={10} aria-hidden="true" /> No</Badge>
        }
      </dd>
    </div>
  )
}

// Editable gender selector
function GenderField({ label, value, editing, editForm, setEditForm }) {
  if (editing && editForm && setEditForm) {
    return (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
        <dt style={{ fontSize: 13, color: 'var(--text-3)', flexShrink: 0 }}>{label}</dt>
        <dd style={{ display: 'flex', gap: 8 }}>
          {[['M','Masculino'],['F','Femenino']].map(([v, l]) => (
            <button key={v} type="button"
                    onClick={() => setEditForm(f => ({ ...f, gender: v }))}
                    style={{
                      padding: '6px 14px', borderRadius: 10, fontSize: 12, fontWeight: 500, cursor: 'pointer',
                      background: editForm.gender === v ? 'rgba(45,212,168,0.1)' : 'var(--bg-3)',
                      color: editForm.gender === v ? 'var(--green)' : 'var(--text-2)',
                      border: `1px solid ${editForm.gender === v ? 'rgba(45,212,168,0.3)' : 'var(--line)'}`,
                    }}>
              {l}
            </button>
          ))}
        </dd>
      </div>
    )
  }
  return <Field label={label} value={value === 'F' ? 'Femenino' : value === 'M' ? 'Masculino' : value} />
}

// ── Auth modal ─────────────────────────────────────────────────────────────────
function AuthModal({ open, onClose, onAuthorized, clienteName }) {
  const { user } = useAuth()
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!password) return
    setLoading(true)
    setError('')
    try {
      await loginEasy(user.email, password)
      setPassword('')
      onAuthorized()
    } catch {
      setError('Contraseña incorrecta')
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    if (loading) return
    setPassword('')
    setError('')
    onClose()
  }

  return (
    <Modal open={open} onClose={handleClose} disabled={loading}
           title="Autorización requerida"
           subtitle={clienteName ? `Modificar datos de ${clienteName}` : ''}
           maxWidth={440}>
      <form onSubmit={handleSubmit}>
        <div style={{ padding: '28px 32px' }}>
          <p style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: 24, lineHeight: 1.6 }}>
            Confirma tu contraseña para poder modificar los datos personales.
          </p>
          <label htmlFor="auth-password" style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-3)', marginBottom: 8 }}>
            Contraseña
          </label>
          <input
            id="auth-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={e => { setPassword(e.target.value); setError('') }}
            className="form-input"
            style={{
              width: '100%', padding: '14px 18px', borderRadius: 14, fontSize: 14,
              background: 'var(--bg-1)', border: `1px solid ${error ? 'var(--red)' : 'var(--line)'}`,
              color: 'var(--text-0)', outline: 'none',
            }}
          />
          {error && <p role="alert" style={{ fontSize: 13, color: 'var(--red)', marginTop: 10 }}>{error}</p>}
        </div>
        <div style={{ padding: '20px 32px', borderTop: '1px solid var(--line)', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Btn variant="secondary" size="md" type="button" onClick={handleClose} disabled={loading}>Cancelar</Btn>
          <Btn variant="primary" size="md" type="submit" disabled={loading || !password}>
            {loading
              ? <><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Verificando...</>
              : <><Shield size={15} aria-hidden="true" /> Autorizar</>
            }
          </Btn>
        </div>
      </form>
    </Modal>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function ClientProfile() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const [tab, setTab] = useState('personal')
  const [cliente, setCliente] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [actionLoading, setActionLoading] = useState('')

  const [confirmArchivar, setConfirmArchivar] = useState(false)
  const [confirmDesvincular, setConfirmDesvincular] = useState(false)
  const [motivoModal, setMotivoModal] = useState(false)
  const [motivo, setMotivo] = useState('')

  useEffect(() => {
    getClientes()
      .then(list => {
        const found = list.find(c => String(c.id) === String(id))
        if (!found) setNotFound(true)
        else setCliente(found)
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [id])

  const handleArchivar = () => {
    if (!cliente) return
    if (cliente.enabled === false) setConfirmArchivar(true)
    else { setMotivoModal(true); setMotivo('') }
  }

  const doArchivar = async (motivoArchivado = null) => {
    const isArchived = cliente.enabled === false
    setConfirmArchivar(false)
    setMotivoModal(false)
    setActionLoading('archivar')
    try {
      const updated = { ...cliente, enabled: isArchived, motivoArchivado: isArchived ? null : motivoArchivado }
      await postClientes([updated])
      setCliente(updated)
      toast.success(isArchived ? 'Cliente desarchivado' : 'Cliente archivado')
    } catch {
      toast.error('Error al archivar/desarchivar el cliente')
    } finally {
      setActionLoading('')
    }
  }

  const doDesvincular = async () => {
    setConfirmDesvincular(false)
    setActionLoading('desvincular')
    try {
      await apiDesvincular(cliente.id)
      toast.success('Cliente desvinculado')
      navigate('/clientes')
    } catch {
      toast.error('Error al desvincular el cliente')
    } finally {
      setActionLoading('')
    }
  }

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '120px 0' }} role="status" aria-label="Cargando perfil">
      <Loader2 size={22} className="animate-spin" style={{ color: 'var(--green)' }} aria-hidden="true" />
    </div>
  )

  if (notFound || !cliente) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '120px 0' }}>
      <p style={{ color: 'var(--text-3)', fontSize: 15 }}>Cliente no encontrado</p>
      <Btn onClick={() => navigate('/clientes')} variant="secondary"><ArrowLeft size={14} aria-hidden="true" /> Volver</Btn>
    </div>
  )

  const edad = cliente.age ?? calcEdad(cliente.birthdate)

  return (
    <div style={{ maxWidth: 1000 }}>
      {/* Back */}
      <button onClick={() => navigate('/clientes')}
              aria-label="Volver a la lista de clientes"
              className="nav-link"
              style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer', color: 'var(--text-3)', background: 'none', border: 'none', marginBottom: 28, transition: 'color 0.15s' }}>
        <ArrowLeft size={15} aria-hidden="true" /> Clientes
      </button>

      {/* Hero card */}
      <Card style={{ padding: 36, marginBottom: 24 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 24 }}>
          <Avatar nombre={`${cliente.name} ${cliente.surname}`} size={72} imgUrl={cliente.imgUrl} />
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 8 }}>
              <div>
                <h1 style={{ fontFamily: 'Outfit', fontSize: 28, fontWeight: 700, color: 'var(--text-0)', lineHeight: 1.2 }}>
                  {cliente.name} {cliente.surname}
                  {cliente.alias && <span style={{ fontSize: 16, fontWeight: 400, color: 'var(--text-3)', marginLeft: 10 }}>"{cliente.alias}"</span>}
                </h1>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 8, fontSize: 13, color: 'var(--text-3)' }}>
                  {cliente.email    && <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Mail  size={13} aria-hidden="true" /> {cliente.email}</span>}
                  {cliente.cellPhone && <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Phone size={13} aria-hidden="true" /> {cliente.cellPhone}</span>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {cliente.enabled === false
                  ? <Badge color="gray"><Archive size={10} aria-hidden="true" /> Archivado</Badge>
                  : cliente.activo === false ? <Badge color="yellow">Inactivo</Badge> : <Badge color="green">Activo</Badge>
                }
                {cliente.nivelConocimiento != null && <Badge color="blue">Nivel {cliente.nivelConocimiento}</Badge>}
              </div>
            </div>

            {/* Key metrics */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 20, marginTop: 24 }}>
              {[
                { icon: User,     label: 'Edad',      value: edad != null ? `${edad} años` : '—' },
                { icon: Ruler,    label: 'Talla',     value: cliente.height ? `${cliente.height} cm` : '—' },
                { icon: Weight,   label: 'Peso',      value: cliente.weight ? `${cliente.weight} kg` : '—' },
                { icon: Heart,    label: 'FC reposo', value: cliente.hrReposo ? `${cliente.hrReposo} ppm` : '—' },
                { icon: Target,   label: 'VO₂max',    value: cliente.vo2max ?? '—' },
                { icon: Dumbbell, label: 'Sesiones',  value: cliente.numTrainings ?? '—' },
              ].map(({ icon: Icon, label, value }) => (
                <div key={label}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <Icon size={13} style={{ color: 'var(--text-3)' }} aria-hidden="true" />
                    <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{label}</span>
                  </div>
                  <p style={{ fontFamily: 'Outfit', fontSize: 22, fontWeight: 700, color: 'var(--text-0)' }}>{value}</p>
                </div>
              ))}
            </div>

            {cliente.objective && (
              <div style={{ marginTop: 24, padding: '16px 20px', borderRadius: 14, background: 'var(--bg-3)' }}>
                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Objetivo</span>
                <p style={{ fontSize: 14, color: 'var(--text-0)', marginTop: 4 }}>{cliente.objective}</p>
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 28, paddingTop: 24, borderTop: '1px solid var(--line)' }}>
          <Btn variant="secondary" size="md" onClick={handleArchivar} disabled={!!actionLoading}>
            {actionLoading === 'archivar'
              ? <Loader2 size={15} className="animate-spin" aria-hidden="true" />
              : <Archive size={15} aria-hidden="true" />}
            {cliente.enabled === false ? ' Desarchivar' : ' Archivar'}
          </Btn>
          <Btn variant="danger" size="md" onClick={() => setConfirmDesvincular(true)} disabled={!!actionLoading}>
            {actionLoading === 'desvincular'
              ? <Loader2 size={15} className="animate-spin" aria-hidden="true" />
              : <UserX size={15} aria-hidden="true" />}
            {' Desvincular'}
          </Btn>
        </div>
      </Card>

      {/* Tabs */}
      <div role="tablist" aria-label="Secciones del cliente"
           style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, marginBottom: 24 }}>
        {tabs.map(({ id: tid, label, icon: Icon }) => (
          <button key={tid} role="tab" aria-selected={tab === tid} onClick={() => setTab(tid)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '12px 20px', borderRadius: 14,
                    fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap',
                    cursor: 'pointer', flexShrink: 0, border: 'none',
                    background: tab === tid ? 'rgba(45,212,168,0.12)' : 'var(--bg-2)',
                    color: tab === tid ? 'var(--green)' : 'var(--text-2)',
                    outline: tab === tid ? '1px solid rgba(45,212,168,0.3)' : '1px solid var(--line)',
                    transition: 'all 0.1s',
                  }}>
            <Icon size={14} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'personal' && <TabPersonal cliente={cliente} onClienteUpdate={setCliente} />}
      {tab === 'clases'   && <TabClases clienteId={cliente.id} />}
      {tab === 'erp'      && <TabERP clienteId={cliente.id} />}

      {/* Dialogs */}
      <ConfirmDialog
        open={confirmArchivar}
        title="Desarchivar cliente"
        message={`¿Quieres desarchivar a ${cliente.name} ${cliente.surname}?`}
        confirmText="Desarchivar"
        variant="primary"
        onConfirm={() => doArchivar(null)}
        onCancel={() => setConfirmArchivar(false)}
      />
      <ConfirmDialog
        open={confirmDesvincular}
        title="Desvincular cliente"
        message={`¿Desvincular a ${cliente.name} ${cliente.surname}? Esta acción no se puede deshacer.`}
        confirmText="Desvincular"
        onConfirm={doDesvincular}
        onCancel={() => setConfirmDesvincular(false)}
      />
      <Modal open={motivoModal} onClose={() => setMotivoModal(false)} title="Archivar cliente"
             subtitle={`${cliente.name} ${cliente.surname}`} maxWidth={480}>
        <div style={{ padding: '28px 32px' }}>
          <label htmlFor="motivo-archivado" style={{ display: 'block', fontSize: 13, color: 'var(--text-2)', marginBottom: 8 }}>
            Motivo del archivado (opcional)
          </label>
          <input id="motivo-archivado" type="text" value={motivo} onChange={e => setMotivo(e.target.value)}
                 placeholder="Ej: Baja voluntaria, cambio de centro..."
                 className="form-input"
                 style={{
                   width: '100%', padding: '14px 18px', borderRadius: 14, fontSize: 14,
                   background: 'var(--bg-1)', border: '1px solid var(--line)', color: 'var(--text-0)',
                 }} />
        </div>
        <div style={{ padding: '20px 32px', borderTop: '1px solid var(--line)', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Btn variant="secondary" size="md" onClick={() => setMotivoModal(false)}>Cancelar</Btn>
          <Btn variant="primary" size="md" onClick={() => doArchivar(motivo)}>Archivar</Btn>
        </div>
      </Modal>
    </div>
  )
}

// ── Tab: Datos personales ──────────────────────────────────────────────────────
function TabPersonal({ cliente, onClienteUpdate }) {
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState(null)
  const [authOpen, setAuthOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const startEdit = () => {
    setEditForm({ ...cliente })
    setEditing(true)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await postClientes([editForm])
      onClienteUpdate({ ...editForm })
      setEditing(false)
      setEditForm(null)
      toast.success('Cambios guardados correctamente')
    } catch {
      toast.error('Error al guardar los cambios')
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    setEditing(false)
    setEditForm(null)
  }

  const editAction = editing ? (
    <div style={{ display: 'flex', gap: 8 }}>
      <Btn variant="primary" size="sm" onClick={handleSave} disabled={saving}>
        {saving ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />}
        {' Guardar'}
      </Btn>
      <Btn variant="secondary" size="sm" onClick={handleCancel} disabled={saving}>
        <XCircle size={14} aria-hidden="true" /> Cancelar
      </Btn>
    </div>
  ) : (
    <Btn variant="secondary" size="sm" onClick={() => setAuthOpen(true)}>
      <Pencil size={14} aria-hidden="true" /> Editar
    </Btn>
  )

  const ep = editing ? { editing, editForm, setEditForm } : {}

  return (
    <div role="tabpanel" aria-label="Datos personales">

      {/* Contact card — editable with auth */}
      <Card style={{ padding: 32, marginBottom: 20 }}>
        <SectionTitle action={editAction}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <User size={16} aria-hidden="true" /> Datos de contacto
          </span>
        </SectionTitle>

        {editing && (
          <div style={{
            padding: '12px 16px', borderRadius: 12, marginBottom: 20,
            background: 'rgba(45,212,168,0.08)', border: '1px solid rgba(45,212,168,0.2)',
            fontSize: 13, color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <Pencil size={13} aria-hidden="true" /> Modo edición activo — modifica los campos y pulsa Guardar
          </div>
        )}

        <dl>
          <Field label="ID"             value={cliente.id} />
          <Field label="Nombre"         value={cliente.name}      fieldKey="name"       {...ep} />
          <Field label="Apellidos"      value={cliente.surname}   fieldKey="surname"    {...ep} />
          <Field label="Alias"          value={cliente.alias}     fieldKey="alias"      {...ep} />
          <Field label="Email"          value={cliente.email}     fieldKey="email"      type="email" {...ep} />
          <Field label="Teléfono"       value={cliente.cellPhone} fieldKey="cellPhone"  type="tel"   {...ep} />
          <Field label="DNI"            value={cliente.dni}       fieldKey="dni"        {...ep} />
          <GenderField label="Género"   value={cliente.gender}    editing={editing}     editForm={editForm} setEditForm={setEditForm} />
          <Field label="Fecha nacimiento"
                 value={editing ? undefined : formatDate(cliente.birthdate)}
                 fieldKey="birthdate" type="date" {...ep} />
          <Field label="Dirección"      value={cliente.address}     fieldKey="address"      {...ep} />
          <Field label="Localidad"      value={cliente.town}        fieldKey="town"         {...ep} />
          <Field label="Código postal"  value={cliente.postal_code} fieldKey="postal_code"  {...ep} />
        </dl>
      </Card>

      {/* Read-only sections */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(380px, 100%), 1fr))', gap: 20 }}>

        <Card style={{ padding: 32 }}>
          <SectionTitle>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Activity size={16} aria-hidden="true" /> Datos físicos
            </span>
          </SectionTitle>
          <dl>
            <Field label="Altura"           value={cliente.height    ? `${cliente.height} cm`      : null} />
            <Field label="Peso"             value={cliente.weight    ? `${cliente.weight} kg`      : null} />
            <Field label="VO₂ máx"          value={cliente.vo2max} />
            <Field label="FC reposo"        value={cliente.hrReposo  ? `${cliente.hrReposo} ppm`   : null} />
            <Field label="Estado de forma"  value={cliente.estadoForma} />
            <Field label="Nivel conocimiento" value={cliente.nivelConocimiento} />
            <Field label="Objetivo"         value={cliente.objective} />
          </dl>
        </Card>

        <Card style={{ padding: 32 }}>
          <SectionTitle>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Shield size={16} aria-hidden="true" /> Cuestionario PAR-Q
            </span>
          </SectionTitle>
          <dl>
            <BoolField label="¿Cardiopatía?"     value={cliente.parq1} />
            <BoolField label="¿Dolor en pecho?"  value={cliente.parq2} />
            <BoolField label="¿Mareos?"          value={cliente.parq3} />
            <BoolField label="¿Articulaciones?"  value={cliente.parq4} />
            <BoolField label="¿Medicación?"      value={cliente.parq5} />
            <BoolField label="¿Embarazo?"        value={cliente.parq6} />
            <BoolField label="¿Otro motivo?"     value={cliente.parq7} />
            <BoolField label="PAR-Q 8"           value={cliente.parq8} />
            <BoolField label="Medicación activa" value={cliente.medicacion} />
            <Field     label="Detalle medicación"  value={cliente.medicacion_info} />
            <BoolField label="Enfermedad"          value={cliente.enfermedad} />
            <Field     label="Detalle enfermedad"  value={cliente.enfermedad_info} />
          </dl>
        </Card>

        <Card style={{ padding: 32 }}>
          <SectionTitle>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Smartphone size={16} aria-hidden="true" /> Dispositivo
            </span>
          </SectionTitle>
          <dl>
            <Field label="Plataforma"  value={cliente.platform} />
            <Field label="HRM UUID"    value={cliente.hrm_uuid} />
            <Field label="HRM Modelo"  value={cliente.hrm_model} />
          </dl>
        </Card>

        <Card style={{ padding: 32 }}>
          <SectionTitle>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Settings size={16} aria-hidden="true" /> Estado
            </span>
          </SectionTitle>
          <dl>
            <Field label="ID Espejo"         value={cliente.idEspejo} />
            <Field label="Username"          value={cliente.username} />
            <Field label="Email verificado">{boolLabel(cliente.emailVerificado)}</Field>
            <BoolField label="Habilitado"    value={cliente.enabled} />
            <BoolField label="Activo"        value={cliente.activo} />
            <BoolField label="Virtual Coach" value={cliente.virtualCoach} />
            <Field label="Última evaluación" value={formatDate(cliente.fechaUltimaEvaluacion)} />
            <Field label="Fecha edición"     value={formatDate(cliente.editionDate)} />
            {cliente.motivoArchivado && <Field label="Motivo archivado" value={cliente.motivoArchivado} />}
          </dl>
        </Card>

      </div>

      <AuthModal
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        onAuthorized={startEdit}
        clienteName={`${cliente.name} ${cliente.surname}`}
      />
    </div>
  )
}

// ── Tab: Clases realizadas ─────────────────────────────────────────────────────
function TabClases({ clienteId }) {
  const [clases, setClases] = useState(null)
  const [loading, setLoading] = useState(true)
  const [noData, setNoData] = useState(false)

  useEffect(() => {
    getClasesCliente(clienteId)
      .then(data => setClases(data))
      .catch(() => setNoData(true))
      .finally(() => setLoading(false))
  }, [clienteId])

  if (loading) return <LoadingCard />

  if (noData || !clases || clases.length === 0) return (
    <div role="tabpanel" aria-label="Clases realizadas">
      <Card style={{ padding: '64px 32px', textAlign: 'center' }}>
        <CalendarCheck size={28} style={{ color: 'var(--text-3)', margin: '0 auto 12px' }} aria-hidden="true" />
        <p style={{ fontSize: 14, color: 'var(--text-3)' }}>
          {noData ? 'No hay datos de clases disponibles' : 'Sin clases registradas'}
        </p>
      </Card>
    </div>
  )

  return (
    <div role="tabpanel" aria-label="Clases realizadas">
      <Card style={{ padding: 32 }}>
        <SectionTitle>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <CalendarCheck size={16} aria-hidden="true" /> Clases realizadas ({clases.length})
          </span>
        </SectionTitle>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--line)' }}>
                {['Fecha', 'Clase', 'Duración', 'Estado'].map(h => (
                  <th key={h} scope="col" style={{ padding: '12px 16px 12px 0', textAlign: 'left', fontSize: 12, fontWeight: 500, color: 'var(--text-3)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {clases.map((c, i) => (
                <tr key={c.id ?? i} style={{ borderBottom: i < clases.length - 1 ? '1px solid var(--line)' : 'none' }}>
                  <td style={{ padding: '14px 16px 14px 0', color: 'var(--text-1)' }}>
                    {c.fecha ? new Date(c.fecha).toLocaleDateString('es-ES') : '—'}
                  </td>
                  <td style={{ padding: '14px 16px 14px 0', color: 'var(--text-2)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.nombre ?? c.nombreClase ?? c.idClase ?? '—'}
                  </td>
                  <td style={{ padding: '14px 16px 14px 0', color: 'var(--text-1)' }}>
                    {c.duracion != null ? `${c.duracion} min` : '—'}
                  </td>
                  <td style={{ padding: '14px 0' }}>
                    {c.completado != null
                      ? c.completado
                        ? <Badge color="green">Completada</Badge>
                        : <Badge color="red">Cancelada</Badge>
                      : c.estado
                        ? <Badge color="gray">{c.estado}</Badge>
                        : <Badge color="gray">—</Badge>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

// ── Tab: Datos ERP ─────────────────────────────────────────────────────────────
function TabERP({ clienteId }) {
  const [config, setConfig] = useState(null)
  const [datos, setDatos] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      getERPConfiguracion().catch(() => null),
      getERPDatosCliente(clienteId).catch(() => null),
    ]).then(([cfg, d]) => {
      const campos = cfg?.campos ?? []
      setConfig(campos.length > 0 ? cfg : null)
      setDatos(d?.campos ?? {})
    }).catch(() => setError('Error cargando datos ERP'))
     .finally(() => setLoading(false))
  }, [clienteId])

  if (loading) return <LoadingCard />
  if (error) return <ErrorCard msg={error} />

  if (!config) return (
    <div role="tabpanel" aria-label="Datos ERP">
      <Card style={{ padding: '64px 32px', textAlign: 'center' }}>
        <Send size={28} style={{ color: 'var(--text-3)', margin: '0 auto 12px' }} aria-hidden="true" />
        <p style={{ fontSize: 14, color: 'var(--text-3)' }}>ERP no configurado para este centro</p>
      </Card>
    </div>
  )

  const campos = [...config.campos].sort((a, b) => a.orden - b.orden)

  return (
    <div role="tabpanel" aria-label="Datos ERP">
      <Card style={{ padding: 32 }}>
        <SectionTitle>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Send size={16} aria-hidden="true" /> Datos para envío ERP
          </span>
        </SectionTitle>
        <dl>
          {campos.map(campo => {
            const val = datos?.[campo.nombreCampo]
            let display = '—'
            if (val !== null && val !== undefined && val !== '') {
              if (campo.nombreCampo.startsWith('bool')) {
                display = (val === true || val === 1) ? 'Sí' : 'No'
              } else if (campo.nombreCampo.startsWith('datetime') && typeof val === 'number') {
                display = new Date(val).toLocaleDateString('es-ES')
              } else {
                display = String(val)
              }
            }
            return (
              <div key={campo.nombreCampo} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                gap: 16, padding: '10px 0', borderBottom: '1px solid var(--line)',
              }}>
                <dt style={{ fontSize: 13, color: 'var(--text-3)', flexShrink: 0 }}>
                  {campo.nombreAMostrar}
                  {campo.obligatorio && <span style={{ color: 'var(--red)', marginLeft: 4 }} aria-label="obligatorio">*</span>}
                  {campo.formato && <span style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 6 }}>({campo.formato})</span>}
                </dt>
                <dd style={{ fontSize: 13, color: display === '—' ? 'var(--text-3)' : 'var(--text-1)', textAlign: 'right' }}>
                  {display}
                </dd>
              </div>
            )
          })}
        </dl>
      </Card>
    </div>
  )
}

function LoadingCard() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }} role="status" aria-label="Cargando datos">
      <Loader2 size={20} className="animate-spin" style={{ color: 'var(--green)' }} aria-hidden="true" />
    </div>
  )
}

function ErrorCard({ msg }) {
  return (
    <Card style={{ padding: 48, textAlign: 'center' }}>
      <p role="alert" style={{ fontSize: 14, color: 'var(--red)' }}>{msg}</p>
    </Card>
  )
}
