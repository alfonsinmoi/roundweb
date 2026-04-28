import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, User, CalendarCheck, Send,
  Archive, UserX, CheckCircle2, XCircle,
  Heart, Ruler, Weight, Target, Loader2,
  Activity, Smartphone, Settings, Shield, Mail, Phone, Pencil, Dumbbell,
  BarChart3, TrendingUp, TrendingDown, Clock, Users, Download, Code, Copy, Check,
  Plus, Lock, Unlock, X, AlertCircle, Eye, EyeOff, Trash2,
} from 'lucide-react'
import { Card, Badge, Btn, Avatar, SectionTitle } from '../../components/UI'
import ConfirmDialog from '../../components/ConfirmDialog'
import Modal from '../../components/Modal'
import { useToast } from '../../components/Toast'
import { useAuth } from '../../contexts/AuthContext'
import {
  getClientes, postClientes, desvinculaCliente as apiDesvincular,
  getClasesCliente, getTrainingsUser, getTrainingsFromSalas, getERPDatosCliente,
  postERPDatosCliente, loginEasy,
  getSalasByRange, getUsuariosBySala,
} from '../../utils/api'

const ERP_PASSWORD = 'Cambiamos!2026'

const tabs = [
  { id: 'personal', label: 'Datos personales', icon: User },
  { id: 'clases',   label: 'Clases realizadas', icon: CalendarCheck },
  { id: 'analisis', label: 'Análisis uso',      icon: BarChart3 },
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
      {tab === 'analisis' && <TabAnalisis cliente={cliente} />}
      {tab === 'erp'      && <TabERP clienteId={cliente.id} cliente={cliente} />}

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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))', gap: 20 }}>

        {/* Contact card — editable with auth */}
        <Card style={{ padding: 24 }}>
          <SectionTitle action={editAction}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <User size={16} aria-hidden="true" /> Datos de contacto
            </span>
          </SectionTitle>

          {editing && (
            <div style={{
              padding: '10px 14px', borderRadius: 12, marginBottom: 16,
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

        {/* Estado */}
        <Card style={{ padding: 24 }}>
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
function pickFecha(t) {
  // `date` suele venir como timestamp en ms; el resto como string ISO
  return t.date ?? t.dateStart ?? t.fecha ?? t.fechaInicio ?? t.startDate ?? t.dateInit ?? null
}
function pickNombre(t) {
  return t.name ?? t.nombre ?? t.nameTraining ?? t.trainingName ?? t.nombreEntrenamiento ?? t.nombrePlan ?? t.plan ?? '—'
}
function pickNombreEntrenamiento(t) {
  return t.name ?? t.nameTraining ?? t.trainingName ?? t.nombreEntrenamiento ?? t.nombrePlan ?? t.planName ?? t.plan ?? null
}
function pickFrecuencia(t) {
  // Hz de EMS — `frequency` es el campo del backend
  return t.frequency ?? t.frecuenciaEMS ?? t.frecuenciaEms ?? t.frequencyEMS ?? t.frequencyEms
      ?? t.hzEMS ?? t.hzEms ?? t.emsFrequency ?? t.fqEMS ?? t.fqEms
      ?? t.frecuencia ?? t.hz ?? null
}
function pickWorkingTime(t) {
  return t.workingTime ?? t.working ?? t.tiempoTrabajo ?? null
}
function pickRestingTime(t) {
  return t.restingTime ?? t.resting ?? t.tiempoDescanso ?? null
}
function pickDuracionProgramada(t) {
  // En segundos (según backend: programedDuration)
  return t.programedDuration ?? t.programmedDuration ?? t.durationTraining ?? t.durationPlan
      ?? t.duracionPlan ?? t.duracionProgramada ?? t.tiempoProgramado ?? t.tiempoEntrenamiento ?? null
}
function pickDuracionReal(t) {
  return t.realDuration ?? t.duration ?? t.durationReal ?? t.duracionReal
      ?? t.duracion ?? t.totalTime ?? t.time ?? t.tiempo ?? null
}
// Convierte segundos → minutos si el valor es grande. Heurística: >180 → segundos.
function fmtMinutes(v) {
  if (v == null) return '—'
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return '—'
  const mins = n > 180 ? Math.round(n / 60) : Math.round(n)
  return `${mins} min`
}

// Descarga cualquier objeto JS como fichero .json
function downloadJSON(data, filename) {
  try {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 0)
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[downloadJSON] error:', e)
  }
}
function safeSlug(s) {
  return String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 60) || 'clase'
}

function TabClases({ clienteId }) {
  const [trainings, setTrainings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [noData, setNoData] = useState(false)
  const [jsonViewer, setJsonViewer] = useState(null) // { title, data, filename }
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        // Primero intentamos el endpoint directo
        let data = await getTrainingsUser(clienteId).catch(() => [])
        // Si viene vacío, derivamos desde salas (último año)
        if (!data || data.length === 0) {
          data = await getTrainingsFromSalas(clienteId, { dias: 365 }).catch(() => [])
        }
        if (!active) return
        const sorted = [...(data ?? [])].sort((a, b) => {
          const da = new Date(pickFecha(a) ?? 0).getTime()
          const db = new Date(pickFecha(b) ?? 0).getTime()
          return db - da
        })
        setTrainings(sorted)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[TabClases] error:', err)
        if (active) setNoData(true)
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [clienteId])

  if (loading) return <LoadingCard />

  if (noData || !trainings || trainings.length === 0) return (
    <div role="tabpanel" aria-label="Clases realizadas">
      <Card style={{ padding: '64px 32px', textAlign: 'center' }}>
        <CalendarCheck size={28} style={{ color: 'var(--text-3)', margin: '0 auto 12px' }} aria-hidden="true" />
        <p style={{ fontSize: 14, color: 'var(--text-3)' }}>
          {noData ? 'No hay datos de clases disponibles' : 'Sin clases registradas'}
        </p>
      </Card>
    </div>
  )

  const onViewAll = () => {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    setJsonViewer({
      title: `Todas las clases del cliente (${trainings.length})`,
      data: { clienteId, descargado: new Date().toISOString(), total: trainings.length, clases: trainings },
      filename: `clases_cliente-${clienteId}_${ts}.json`,
    })
  }

  return (
    <div role="tabpanel" aria-label="Clases realizadas">
      <Card style={{ padding: 32 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <SectionTitle>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <CalendarCheck size={16} aria-hidden="true" /> Clases realizadas ({trainings.length})
            </span>
          </SectionTitle>
          <Btn variant="secondary" size="sm" onClick={onViewAll} title="Ver/descargar todas las clases en JSON">
            <Code size={14} aria-hidden="true" /> Ver JSON completo
          </Btn>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--line)' }}>
                {['Fecha', 'Entrenamiento', 'Duración entrenamiento', 'Frecuencia', 'W/R', ''].map((h, idx) => (
                  <th key={idx} scope="col" style={{ padding: '12px 16px 12px 0', textAlign: 'left', fontSize: 12, fontWeight: 500, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {trainings.map((t, i) => {
                const fecha = pickFecha(t)
                const nombreEntreno = pickNombreEntrenamiento(t)
                const durProg = pickDuracionProgramada(t)
                const freq = pickFrecuencia(t)
                const wt = pickWorkingTime(t)
                const rt = pickRestingTime(t)
                return (
                  <tr key={t.id ?? i} style={{ borderBottom: i < trainings.length - 1 ? '1px solid var(--line)' : 'none' }}>
                    <td style={{ padding: '14px 16px 14px 0', color: 'var(--text-1)', whiteSpace: 'nowrap' }}>
                      {fecha ? new Date(fecha).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                    </td>
                    <td style={{ padding: '14px 16px 14px 0', color: 'var(--text-1)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={nombreEntreno || ''}>
                      {nombreEntreno ?? '—'}
                    </td>
                    <td style={{ padding: '14px 16px 14px 0', color: 'var(--text-1)', whiteSpace: 'nowrap' }}>
                      {fmtMinutes(durProg)}
                    </td>
                    <td style={{ padding: '14px 16px 14px 0', color: 'var(--text-1)', whiteSpace: 'nowrap' }}>
                      {freq != null ? `${freq} Hz` : '—'}
                    </td>
                    <td style={{ padding: '14px 16px 14px 0', color: 'var(--text-1)', whiteSpace: 'nowrap' }}>
                      {wt != null && rt != null ? `${wt}/${rt}` : '—'}
                    </td>
                    <td style={{ padding: '14px 0' }}>
                      <button
                        onClick={() => {
                          const label = nombreEntreno || `clase-${t.id ?? i}`
                          const fstr = fecha ? new Date(fecha).toISOString().replace(/[:.]/g, '-').slice(0, 16) : 'sinfecha'
                          setJsonViewer({
                            title: `${label}${fecha ? ' · ' + new Date(fecha).toLocaleString('es-ES') : ''}`,
                            data: t,
                            filename: `${safeSlug(label)}_${fstr}.json`,
                          })
                        }}
                        title="Ver JSON de esta clase"
                        aria-label="Ver JSON de esta clase"
                        style={{
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          width: 30, height: 30, borderRadius: 8,
                          background: 'var(--bg-2)', border: '1px solid var(--line)',
                          color: 'var(--text-2)', cursor: 'pointer',
                        }}>
                        <Code size={13} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Visor de JSON */}
      {jsonViewer && (() => {
        const pretty = JSON.stringify(jsonViewer.data, null, 2)
        return (
          <Modal open onClose={() => { setJsonViewer(null); setCopied(false) }}
                 title={jsonViewer.title}
                 subtitle={`${pretty.length.toLocaleString('es-ES')} caracteres`}
                 maxWidth={820}>
            <div style={{ padding: '12px 24px 20px' }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                <Btn variant="primary" size="sm"
                     onClick={() => downloadJSON(jsonViewer.data, jsonViewer.filename)}>
                  <Download size={14} aria-hidden="true" /> Descargar .json
                </Btn>
                <Btn variant="secondary" size="sm"
                     onClick={async () => {
                       try {
                         await navigator.clipboard.writeText(pretty)
                         setCopied(true)
                         setTimeout(() => setCopied(false), 1500)
                       } catch { /* no-op */ }
                     }}>
                  {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                  {copied ? '¡Copiado!' : 'Copiar al portapapeles'}
                </Btn>
              </div>
              <pre style={{
                margin: 0,
                padding: 16,
                borderRadius: 10,
                background: 'var(--bg-3)',
                border: '1px solid var(--line)',
                color: 'var(--text-1)',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 12,
                lineHeight: 1.55,
                maxHeight: '60vh',
                overflow: 'auto',
                whiteSpace: 'pre',
              }}>
                {pretty}
              </pre>
            </div>
          </Modal>
        )
      })()}
    </div>
  )
}

// ── Tab: Análisis de uso ───────────────────────────────────────────────────────
const DOW_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

function isoWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  return `${date.getUTCFullYear()}-W${String(Math.ceil(((date - yearStart) / 86400000 + 1) / 7)).padStart(2, '0')}`
}
function monthKey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }

function BarChart({ data, color = 'var(--green)', suffix = '', height = 140 }) {
  const max = Math.max(1, ...data.map(d => d.value))
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height, padding: '4px 0' }}>
      {data.map((d, i) => {
        const h = (d.value / max) * (height - 28)
        return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 0 }}>
            <span style={{ fontSize: 10, color: 'var(--text-2)', fontWeight: 600 }}>{d.value > 0 ? `${d.value}${suffix}` : ''}</span>
            <div style={{ width: '100%', height: Math.max(2, h), background: color, borderRadius: 4, opacity: d.value > 0 ? 1 : 0.15 }} />
            <span style={{ fontSize: 10, color: 'var(--text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{d.label}</span>
          </div>
        )
      })}
    </div>
  )
}

function Kpi({ label, value, hint, color = 'var(--text-0)' }) {
  return (
    <Card style={{ padding: 20 }}>
      <p style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase' }}>{label}</p>
      <p style={{ fontFamily: 'Outfit', fontSize: 26, fontWeight: 700, color, marginTop: 4 }}>{value}</p>
      {hint && <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>{hint}</p>}
    </Card>
  )
}

function TabAnalisis({ cliente }) {
  const navigate = useNavigate()
  const [trainings, setTrainings] = useState(null)
  const [coAttendees, setCoAttendees] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadingCo, setLoadingCo] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        let list = await getTrainingsUser(cliente.id).catch(() => [])
        if (!list || list.length === 0) {
          list = await getTrainingsFromSalas(cliente.id, { dias: 365 }).catch(() => [])
        }
        if (!active) return
        const withDate = list.map(t => ({
          raw: t,
          date: new Date(pickFecha(t)),
          name: pickNombre(t),
          duration: pickDuracionReal(t) ?? 0,
        })).filter(t => !isNaN(t.date))
        withDate.sort((a, b) => b.date - a.date)
        setTrainings(withDate)
      } catch {
        if (active) setError('Error cargando entrenamientos')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [cliente.id])

  // Compañeros de horario: carga salas de los últimos 90 días y sus usuarios
  useEffect(() => {
    const hasta = new Date()
    const desde = new Date(); desde.setDate(desde.getDate() - 90)
    Promise.all([
      getSalasByRange(desde, hasta),
      getClientes().catch(() => []),
    ])
      .then(async ([salas, clientes]) => {
        // Mapa de clientes: id -> { nombre, apellidos, enabled }
        const clientMap = {}
        clientes.forEach(c => { clientMap[String(c.id)] = c })

        const usuariosPorSala = await Promise.all(
          salas.map(s => getUsuariosBySala(s.id).then(us => ({ s, us })).catch(() => ({ s, us: [] })))
        )
        const salasCliente = usuariosPorSala.filter(({ us }) => us.some(u => u.idClient === cliente.id))

        const counts = {}
        salasCliente.forEach(({ us }) => {
          us.forEach(u => {
            if (u.idClient === cliente.id) return
            if (!u.verify) return
            const info = clientMap[String(u.idClient)]
            // Solo clientes activos
            if (!info || info.enabled === false) return
            if (!counts[u.idClient]) {
              counts[u.idClient] = {
                idClient: u.idClient,
                nombre:    info.nombre    || info.name    || (u.nameClient || '').split(/\s+/)[0]  || `Cliente #${u.idClient}`,
                apellidos: info.apellidos || info.surname || (u.nameClient || '').split(/\s+/).slice(1).join(' ') || '',
                imgUrl:    info.imgUrl || u.pictureClient || '',
                count: 0,
              }
            }
            counts[u.idClient].count++
          })
        })
        const top = Object.values(counts).sort((a, b) => b.count - a.count).slice(0, 10)
        setCoAttendees({ top, sesionesCompartidas: salasCliente.length })
      })
      .catch(() => setCoAttendees({ top: [], sesionesCompartidas: 0 }))
      .finally(() => setLoadingCo(false))
  }, [cliente.id])

  if (loading) return <LoadingCard />
  if (error)   return <ErrorCard msg={error} />
  if (!trainings || trainings.length === 0) return (
    <div role="tabpanel" aria-label="Análisis uso">
      <Card style={{ padding: '64px 32px', textAlign: 'center' }}>
        <BarChart3 size={28} style={{ color: 'var(--text-3)', margin: '0 auto 12px' }} aria-hidden="true" />
        <p style={{ fontSize: 14, color: 'var(--text-3)' }}>Sin entrenamientos registrados</p>
      </Card>
    </div>
  )

  // ── Métricas agregadas ──
  const total = trainings.length
  const totalMin = trainings.reduce((s, t) => s + (t.duration || 0), 0)
  const avgMin = total > 0 ? Math.round(totalMin / total) : 0

  const now = new Date()
  const hoyInicio = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const hace30  = new Date(hoyInicio); hace30.setDate(hace30.getDate() - 30)
  const hace60  = new Date(hoyInicio); hace60.setDate(hace60.getDate() - 60)
  const hace7   = new Date(hoyInicio); hace7.setDate(hace7.getDate() - 7)
  const hace14  = new Date(hoyInicio); hace14.setDate(hace14.getDate() - 14)

  const ult30 = trainings.filter(t => t.date >= hace30).length
  const prev30 = trainings.filter(t => t.date >= hace60 && t.date < hace30).length
  const ult7  = trainings.filter(t => t.date >= hace7).length
  const prev7 = trainings.filter(t => t.date >= hace14 && t.date < hace7).length

  const deltaMes  = prev30 === 0 ? (ult30 > 0 ? 100 : 0) : Math.round(((ult30 - prev30) / prev30) * 100)
  const deltaSem  = prev7  === 0 ? (ult7  > 0 ? 100 : 0) : Math.round(((ult7  - prev7)  / prev7)  * 100)

  // Distribución por día de la semana
  const dowCounts = Array(7).fill(0)
  trainings.forEach(t => {
    const d = t.date.getDay() // 0=Dom
    const idx = d === 0 ? 6 : d - 1
    dowCounts[idx]++
  })
  const dowData = DOW_LABELS.map((l, i) => ({ label: l, value: dowCounts[i] }))

  // Distribución por franja horaria
  const hourBuckets = [
    { label: '6-9',   from: 6,  to: 9  },
    { label: '9-12',  from: 9,  to: 12 },
    { label: '12-15', from: 12, to: 15 },
    { label: '15-18', from: 15, to: 18 },
    { label: '18-21', from: 18, to: 21 },
    { label: '21-24', from: 21, to: 24 },
  ]
  const hourData = hourBuckets.map(b => ({
    label: b.label,
    value: trainings.filter(t => { const h = t.date.getHours(); return h >= b.from && h < b.to }).length,
  }))

  // Tipos de entrenamiento (top 6)
  const tipoCounts = {}
  trainings.forEach(t => { tipoCounts[t.name] = (tipoCounts[t.name] || 0) + 1 })
  const tipos = Object.entries(tipoCounts).sort((a, b) => b[1] - a[1]).slice(0, 6)
  const maxTipo = Math.max(1, ...tipos.map(([, v]) => v))

  // Últimas 12 semanas
  const semanasMap = {}
  for (let i = 11; i >= 0; i--) {
    const d = new Date(hoyInicio); d.setDate(d.getDate() - i * 7)
    semanasMap[isoWeek(d)] = { label: `S${isoWeek(d).slice(-2)}`, value: 0 }
  }
  trainings.forEach(t => {
    const k = isoWeek(t.date)
    if (semanasMap[k]) semanasMap[k].value++
  })
  const semanaData = Object.values(semanasMap)

  // Últimos 12 meses
  const mesesMap = {}
  for (let i = 11; i >= 0; i--) {
    const d = new Date(hoyInicio); d.setMonth(d.getMonth() - i)
    const k = monthKey(d)
    mesesMap[k] = { label: d.toLocaleDateString('es-ES', { month: 'short' }).replace('.', ''), value: 0 }
  }
  trainings.forEach(t => {
    const k = monthKey(t.date)
    if (mesesMap[k]) mesesMap[k].value++
  })
  const mesData = Object.values(mesesMap)

  // Tendencias: comparar media semanal de últimas 4 semanas vs 4 anteriores
  const last4 = semanaData.slice(-4).reduce((s, d) => s + d.value, 0) / 4
  const prev4 = semanaData.slice(-8, -4).reduce((s, d) => s + d.value, 0) / 4
  const trendPct = prev4 === 0 ? (last4 > 0 ? 100 : 0) : Math.round(((last4 - prev4) / prev4) * 100)

  const TrendBadge = ({ pct }) => {
    const up = pct > 0, down = pct < 0
    const color = up ? 'var(--green)' : down ? 'var(--red)' : 'var(--text-3)'
    const Icon = up ? TrendingUp : down ? TrendingDown : Clock
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color, fontSize: 12, fontWeight: 600 }}>
        <Icon size={12} aria-hidden="true" /> {pct > 0 ? '+' : ''}{pct}%
      </span>
    )
  }

  return (
    <div role="tabpanel" aria-label="Análisis uso" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <Kpi label="Total sesiones" value={total} hint={`${Math.round(totalMin / 60)} h totales`} color="var(--green)" />
        <Kpi label="Duración media" value={`${avgMin} min`} hint="por sesión" />
        <Kpi label="Últimos 7 días"   value={ult7}  hint={<TrendBadge pct={deltaSem} />} />
        <Kpi label="Últimos 30 días"  value={ult30} hint={<TrendBadge pct={deltaMes} />} />
      </div>

      {/* Tendencia */}
      <Card style={{ padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <SectionTitle>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <TrendingUp size={16} aria-hidden="true" /> Tendencia de entrenamiento
            </span>
          </SectionTitle>
          <TrendBadge pct={trendPct} />
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 12 }}>
          Media 4 sem. recientes: <strong style={{ color: 'var(--text-1)' }}>{last4.toFixed(1)}</strong> · Previas: <strong style={{ color: 'var(--text-1)' }}>{prev4.toFixed(1)}</strong>
        </p>
        <p style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8 }}>Sesiones por semana (últimas 12 semanas)</p>
        <BarChart data={semanaData} color="var(--green)" />
      </Card>

      {/* Por mes */}
      <Card style={{ padding: 24 }}>
        <SectionTitle>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <CalendarCheck size={16} aria-hidden="true" /> Sesiones por mes (12 meses)
          </span>
        </SectionTitle>
        <div style={{ marginTop: 12 }}>
          <BarChart data={mesData} color="#4361EE" />
        </div>
      </Card>

      {/* Horarios y tipos */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        <Card style={{ padding: 24 }}>
          <SectionTitle>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Clock size={16} aria-hidden="true" /> Día favorito
            </span>
          </SectionTitle>
          <div style={{ marginTop: 12 }}>
            <BarChart data={dowData} color="var(--amber)" />
          </div>
        </Card>

        <Card style={{ padding: 24 }}>
          <SectionTitle>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Clock size={16} aria-hidden="true" /> Franja horaria
            </span>
          </SectionTitle>
          <div style={{ marginTop: 12 }}>
            <BarChart data={hourData} color="#A855F7" />
          </div>
        </Card>
      </div>

      {/* Tipos */}
      <Card style={{ padding: 24 }}>
        <SectionTitle>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Dumbbell size={16} aria-hidden="true" /> Tipos de entrenamiento
          </span>
        </SectionTitle>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
          {tipos.map(([nombre, cnt]) => (
            <div key={nombre}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                <span style={{ color: 'var(--text-1)' }}>{nombre}</span>
                <span style={{ color: 'var(--text-3)' }}>{cnt} · {Math.round((cnt / total) * 100)}%</span>
              </div>
              <div style={{ height: 6, background: 'var(--line)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ width: `${(cnt / maxTipo) * 100}%`, height: '100%', background: 'var(--green)' }} />
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Compañeros de horario */}
      <Card style={{ padding: 24 }}>
        <SectionTitle>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Users size={16} aria-hidden="true" /> Compañeros de horario (90 días)
          </span>
        </SectionTitle>
        {loadingCo ? (
          <div style={{ padding: 20, textAlign: 'center' }}>
            <Loader2 size={18} className="animate-spin" style={{ color: 'var(--green)' }} aria-hidden="true" />
          </div>
        ) : !coAttendees || coAttendees.top.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-3)', padding: '12px 0' }}>
            Sin compañeros de entrenamiento en el rango
          </p>
        ) : (
          <>
            <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 12 }}>
              {coAttendees.sesionesCompartidas} sesiones compartidas · Top 10 por coincidencia
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {coAttendees.top.map(c => (
                <button key={c.idClient}
                        onClick={() => navigate(`/clientes/${c.idClient}`)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 12,
                          padding: '10px 12px', borderRadius: 10,
                          background: 'var(--bg-3)', border: '1px solid var(--line)',
                          cursor: 'pointer', textAlign: 'left', width: '100%',
                        }}>
                  <Avatar nombre={`${c.nombre} ${c.apellidos}`} size={32} imgUrl={c.imgUrl} />
                  <div style={{ flex: 1, display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
                    <span style={{ fontFamily: 'Outfit', fontSize: 14, fontWeight: 700, color: 'var(--text-0)' }}>{c.nombre}</span>
                    {c.apellidos && <span style={{ fontSize: 13, color: 'var(--text-1)' }}>{c.apellidos}</span>}
                  </div>
                  <span style={{ fontFamily: 'Outfit', fontSize: 16, fontWeight: 700, color: 'var(--green)' }}>{c.count}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>coincidencias</span>
                </button>
              ))}
            </div>
          </>
        )}
      </Card>
    </div>
  )
}

// ── Tab: Datos ERP ─────────────────────────────────────────────────────────────
// Definición canónica de los 10 campos que espera el MCP / GestPlus.
// Esto es la fuente de verdad mientras el backend `GET /api/erp/configuracion`
// no devuelva esta misma lista. Los nombres internos coinciden EXACTAMENTE con
// los que espera el webhook (snake_case, sin renombrar).
const MCP_CAMPOS = [
  { nombreCampo: 'dni',                 nombreAMostrar: 'DNI / NIE',                  tipo: 'string',   formato: 'dni',       obligatorio: true,  orden: 1 },
  { nombreCampo: 'movil',               nombreAMostrar: 'Móvil',                      tipo: 'string',   formato: 'telefono',  obligatorio: true,  orden: 2 },
  { nombreCampo: 'curso',               nombreAMostrar: 'Curso / Tipo de cuota',      tipo: 'string',   formato: 'texto',     obligatorio: true,  orden: 3 },
  { nombreCampo: 'precio_curso',        nombreAMostrar: 'Precio del curso (€/mes)',   tipo: 'decimal',  formato: 'moneda',    obligatorio: true,  orden: 4 },
  { nombreCampo: 'fecha_alta',          nombreAMostrar: 'Fecha de alta',              tipo: 'datetime', formato: 'fecha',     obligatorio: true,  orden: 5, defaultHoy: true },
  { nombreCampo: 'tipo_pago',           nombreAMostrar: 'Tipo de pago',               tipo: 'string',   formato: 'select',    obligatorio: true,  orden: 6,
    opciones: ['Banco', 'Caja'] },
  { nombreCampo: 'iban',                nombreAMostrar: 'IBAN',                       tipo: 'string',   formato: 'iban',      obligatorio: false, orden: 7,
    obligatorioSi: { campo: 'tipo_pago', valor: 'Banco' } },
  { nombreCampo: 'forma_primera_cuota', nombreAMostrar: 'Forma de la primera cuota',  tipo: 'string',   formato: 'select',    obligatorio: true,  orden: 8,
    opciones: ['Efectivo', 'Tarjeta'] },
  { nombreCampo: 'periodo_pago',        nombreAMostrar: 'Periodo de pago',            tipo: 'string',   formato: 'select',    obligatorio: true,  orden: 9,
    opciones: ['Mensual', 'Trimestral', 'Semestral'] },
  { nombreCampo: 'tipo_descuento',      nombreAMostrar: 'Tipo de descuento',          tipo: 'string',   formato: 'select',    obligatorio: false, orden: 10,
    opciones: ['Sin descuento', 'Familiar', 'Estudiante', 'Pensionista'] },
]

function tipoFromCampo(campo, key) {
  if (campo?.tipo) return campo.tipo
  for (const t of ['datetime', 'decimal', 'number', 'string', 'bool']) {
    if (typeof key === 'string' && key.startsWith(t)) return t
  }
  return 'string'
}

function esObligatorio(campo, fuente) {
  if (campo.obligatorio) return true
  if (campo.obligatorioSi) {
    const ref = fuente?.[campo.obligatorioSi.campo]
    return ref === campo.obligatorioSi.valor
  }
  return false
}

function todayISO() {
  const d = new Date()
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

function formatValueDisplay(key, val) {
  if (val === null || val === undefined || val === '') return '—'
  if (key.startsWith('bool')) return (val === true || val === 1 || val === 'true') ? 'Sí' : 'No'
  if (key.startsWith('datetime')) {
    const d = typeof val === 'number' ? new Date(val) : new Date(String(val))
    return isNaN(d) ? String(val) : d.toLocaleDateString('es-ES')
  }
  return String(val)
}

// Mapea género NoofitPro (M=Masculino, F=Femenino) → MCP/GestPlus (H=Hombre, M=Mujer)
function genderToMCP(g) {
  if (g === 'F' || g === 'f') return 'M'
  return 'H'
}

// Convierte fecha ISO/timestamp a "dd/MM/yyyy" (formato que espera GestPlus para fecha_nacimiento)
function fechaNacimientoToMCP(birthdate) {
  if (!birthdate) return ''
  const d = typeof birthdate === 'number' ? new Date(birthdate) : new Date(String(birthdate))
  if (isNaN(d)) return ''
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${d.getFullYear()}`
}

// Dispara webhook al MCP (fire-and-forget, best-effort)
function dispararWebhookERP(cliente, formValues) {
  const payload = {
    // 6 campos desde la BD NoofitPro
    id_cliente:          cliente.id,
    nombre:              cliente.name ?? '',
    apellidos:           cliente.surname ?? '',
    email:               cliente.email ?? '',
    sexo:                genderToMCP(cliente.gender),
    fecha_nacimiento:    fechaNacimientoToMCP(cliente.birthdate),
    // 10 campos del formulario ERP
    dni:                 formValues.dni ?? '',
    movil:               formValues.movil ?? '',
    curso:               formValues.curso ?? '',
    precio_curso:        formValues.precio_curso != null ? String(formValues.precio_curso) : '',
    fecha_alta:          formValues.fecha_alta ?? '',
    tipo_pago:           formValues.tipo_pago ?? '',
    iban:                formValues.iban ?? '',
    forma_primera_cuota: formValues.forma_primera_cuota ?? '',
    periodo_pago:        formValues.periodo_pago ?? '',
    tipo_descuento:      formValues.tipo_descuento ?? '',
  }
  // Fire-and-forget: no esperamos la respuesta para no bloquear la UI
  fetch('/api/erp-webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true, // por si el usuario navega antes de que termine
  })
    .then(r => {
      if (r.status !== 202) {
        // eslint-disable-next-line no-console
        console.warn('[Webhook ERP] respuesta inesperada', r.status)
      }
    })
    .catch(err => {
      // eslint-disable-next-line no-console
      console.error('[Webhook ERP] error de red', err)
    })
}

function TabERP({ clienteId, cliente }) {
  const toast = useToast()

  // Lista canónica de campos (fuente de verdad para el envío al MCP)
  const campos = MCP_CAMPOS

  const [values,  setValues]  = useState({})    // { nombreCampo: valor } persistidos
  const [draft,   setDraft]   = useState({})    // copia editable
  const [editing, setEditing] = useState(false)
  const [saving,  setSaving]  = useState(false)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  const [sending, setSending] = useState(false)
  const [sent,    setSent]    = useState(false)
  const [unlocked,setUnlocked]= useState(false)
  const [pwdOpen, setPwdOpen] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const d = await getERPDatosCliente(clienteId).catch(() => null)
        const datosIniciales = d?.campos ?? {}
        // Pre-rellenar fecha_alta con hoy si no hay valor guardado
        if (!datosIniciales.fecha_alta) datosIniciales.fecha_alta = todayISO()
        setValues(datosIniciales)
      } catch {
        setError('Error cargando datos ERP')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [clienteId])

  function setDraftValue(key, val) {
    setDraft(d => ({ ...d, [key]: val }))
  }

  function startEdit() {
    setDraft({ ...values })
    setEditing(true)
  }

  function cancelEdit() {
    setDraft({})
    setEditing(false)
  }

  function buildPayload(source) {
    const payload = {}
    for (const c of campos) {
      const k = c.nombreCampo ?? c.nombre
      if (source[k] !== undefined && source[k] !== '' && source[k] !== null) {
        payload[k] = source[k]
      }
    }
    return payload
  }

  function checkObligatorios(payload, fuente) {
    return campos
      .filter(c => esObligatorio(c, fuente))
      .filter(c => {
        const v = payload[c.nombreCampo ?? c.nombre]
        return v === undefined || v === null || v === ''
      })
  }

  async function handleSave() {
    setSaving(true)
    try {
      const payload = buildPayload(draft)
      await postERPDatosCliente(clienteId, payload)
      setValues(payload)
      setEditing(false)
      setDraft({})
      toast.success('Cambios guardados')
    } catch (e) {
      toast.error(e?.message ?? 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  async function doSend() {
    setSending(true)
    try {
      const payload = buildPayload(values)
      const faltan = checkObligatorios(payload, values)
      if (faltan.length > 0) {
        const lista = faltan.map(c => c.nombreAMostrar ?? c.nombreCampo).join(', ')
        toast.error(`No se puede enviar: faltan campos obligatorios → ${lista}`)
        setSending(false)
        return
      }
      await postERPDatosCliente(clienteId, payload)
      // Disparar webhook al MCP — fire-and-forget, no bloquea la UI
      dispararWebhookERP(cliente, payload)
      toast.success('Datos enviados al ERP correctamente')
      setSent(true)
      setUnlocked(false)
    } catch (e) {
      toast.error(e?.message ?? 'Error al enviar al ERP')
    } finally {
      setSending(false)
    }
  }

  function handleSendClick() {
    if (editing) { toast.error('Guarda los cambios antes de enviar'); return }
    if (sent && !unlocked) { setPwdOpen(true); return }
    doSend()
  }

  if (loading) return <LoadingCard />
  if (error) return <ErrorCard msg={error} />

  // Lista de obligatorios sin rellenar (sobre values en lectura, sobre draft en edición)
  const fuente = editing ? draft : values
  const faltanObligatorios = campos
    .filter(c => esObligatorio(c, fuente))
    .filter(c => {
      const k = c.nombreCampo ?? c.nombre
      const v = fuente[k]
      return v === undefined || v === null || v === ''
    })

  return (
    <div role="tabpanel" aria-label="Datos ERP">
      <Card style={{ padding: 32 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <SectionTitle>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Send size={16} aria-hidden="true" /> Datos para envío ERP
            </span>
          </SectionTitle>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {editing ? (
              <>
                <Btn variant="secondary" size="sm" onClick={cancelEdit} disabled={saving}>
                  <XCircle size={14} aria-hidden="true" /> Cancelar
                </Btn>
                <Btn variant="primary" size="sm" onClick={handleSave} disabled={saving}>
                  {saving
                    ? <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                    : <CheckCircle2 size={14} aria-hidden="true" />}
                  {saving ? ' Guardando…' : ' Guardar'}
                </Btn>
              </>
            ) : (
              <>
                <Btn variant="secondary" size="sm" onClick={startEdit} disabled={campos.length === 0}>
                  <Pencil size={14} aria-hidden="true" /> Editar campos
                </Btn>
                <Btn variant="primary" size="sm"
                     onClick={handleSendClick}
                     disabled={sending || campos.length === 0 || faltanObligatorios.length > 0}
                     title={faltanObligatorios.length > 0 ? 'Rellena los campos obligatorios antes de enviar' : undefined}>
                  {sending
                    ? <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                    : (sent && !unlocked) ? <Lock size={14} aria-hidden="true" /> : <Send size={14} aria-hidden="true" />}
                  {sending ? ' Enviando…' : sent ? ' Reenviar a ERP' : ' Enviar a ERP'}
                </Btn>
              </>
            )}
          </div>
        </div>

        {editing && (
          <div style={{
            padding: '10px 14px', borderRadius: 12, marginBottom: 16,
            background: 'rgba(45,212,168,0.08)', border: '1px solid rgba(45,212,168,0.2)',
            fontSize: 13, color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <Pencil size={13} aria-hidden="true" />
            Modo edición — modifica los valores y pulsa <strong>Guardar</strong>
          </div>
        )}

        {!editing && sent && !unlocked && (
          <div style={{
            padding: '10px 14px', borderRadius: 12, marginBottom: 16,
            background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)',
            fontSize: 13, color: '#22c55e', display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <CheckCircle2 size={13} aria-hidden="true" />
            Datos enviados — para volver a enviar se requerirá contraseña
          </div>
        )}

        {/* Banner de obligatorios sin rellenar */}
        {faltanObligatorios.length > 0 && (
          <div style={{
            padding: '10px 14px', borderRadius: 12, marginBottom: 16,
            background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
            fontSize: 13, color: 'var(--red)', display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <AlertCircle size={13} aria-hidden="true" />
            <span>
              {editing ? 'Faltan' : 'Antes de enviar, rellena'} los obligatorios:&nbsp;
              <strong>{faltanObligatorios.map(c => c.nombreAMostrar ?? c.nombreCampo).join(', ')}</strong>
            </span>
          </div>
        )}

        {campos.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-3)', padding: '20px 0' }}>
            No hay campos definidos. Añade definiciones en <strong>Config. ERP</strong> (menú lateral) y vuelve aquí para rellenar los valores de este cliente.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {campos.map(campo => {
              const key       = campo.nombreCampo ?? campo.nombre ?? campo.id ?? String(campo)
              const tipo      = tipoFromCampo(campo, key)
              const label     = campo.nombreAMostrar ?? campo.nombre ?? key
              const val       = (editing ? draft[key] : values[key]) ?? ''
              const obligNow  = esObligatorio(campo, fuente)
              const isSelect  = campo.formato === 'select'

              let valueEl
              if (!editing) {
                const display = formatValueDisplay(key, values[key])
                const empty   = display === '—'
                const missing = empty && obligNow
                valueEl = (
                  <span style={{
                    fontSize: 13,
                    fontWeight: missing ? 600 : 400,
                    color: missing ? 'var(--red)' : empty ? 'var(--text-3)' : 'var(--text-1)',
                  }}>
                    {missing ? '⚠ falta' : display}
                  </span>
                )
              } else if (isSelect) {
                valueEl = (
                  <select value={val} onChange={e => setDraftValue(key, e.target.value)}
                          className="form-input"
                          style={{ ...inputStyleERP(), cursor: 'pointer' }}>
                    <option value="">— Selecciona —</option>
                    {(campo.opciones ?? []).map(op => (
                      <option key={op} value={op}>{op}</option>
                    ))}
                  </select>
                )
              } else if (tipo === 'bool') {
                valueEl = (
                  <div style={{ display: 'flex', gap: 8 }}>
                    {[[true, 'Sí'], [false, 'No']].map(([v, l]) => (
                      <button key={String(v)} type="button"
                              onClick={() => setDraftValue(key, v)}
                              style={{
                                padding: '6px 14px', borderRadius: 10, fontSize: 12, fontWeight: 500, cursor: 'pointer',
                                background: val === v ? 'rgba(45,212,168,0.1)' : 'var(--bg-3)',
                                color:      val === v ? 'var(--green)'         : 'var(--text-2)',
                                border: `1px solid ${val === v ? 'rgba(45,212,168,0.3)' : 'var(--line)'}`,
                              }}>
                        {l}
                      </button>
                    ))}
                  </div>
                )
              } else if (tipo === 'datetime') {
                const dateVal = (() => {
                  if (!val) return ''
                  if (typeof val === 'number') return new Date(val).toISOString().slice(0, 10)
                  return String(val).slice(0, 10)
                })()
                valueEl = (
                  <input type="date" value={dateVal}
                         onChange={e => setDraftValue(key, e.target.value)}
                         className="form-input"
                         style={inputStyleERP()} />
                )
              } else if (tipo === 'number' || tipo === 'decimal') {
                valueEl = (
                  <input type="number" value={val}
                         step={tipo === 'decimal' ? '0.01' : '1'}
                         onChange={e => setDraftValue(key, e.target.value === '' ? '' : Number(e.target.value))}
                         className="form-input"
                         style={inputStyleERP()} />
                )
              } else {
                valueEl = (
                  <input type="text" value={val}
                         onChange={e => setDraftValue(key, e.target.value)}
                         placeholder={campo.formato && campo.formato !== 'texto' ? `Formato: ${campo.formato}` : ''}
                         className="form-input"
                         style={inputStyleERP()} />
                )
              }

              return (
                <div key={key} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  gap: 16, padding: '10px 0', borderBottom: '1px solid var(--line)',
                }}>
                  <dt style={{ fontSize: 13, color: 'var(--text-3)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {label}
                    {obligNow && <span style={{ color: 'var(--red)' }} aria-label="obligatorio">*</span>}
                    {campo.formato && campo.formato !== 'texto' && campo.formato !== 'select' && (
                      <span style={{ fontSize: 11, color: 'var(--text-3)' }}>({campo.formato})</span>
                    )}
                  </dt>
                  <dd style={{ display: 'flex', alignItems: 'center', gap: 8, textAlign: 'right' }}>
                    {valueEl}
                  </dd>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {pwdOpen && (
        <ERPPasswordModal
          onClose={() => setPwdOpen(false)}
          onUnlocked={() => { setPwdOpen(false); setUnlocked(true); doSend() }}
        />
      )}
    </div>
  )
}

function inputStyleERP() {
  return {
    padding: '8px 12px', borderRadius: 10, fontSize: 13,
    background: 'var(--bg-1)', border: '1px solid var(--line)', color: 'var(--text-0)',
    minWidth: 200, textAlign: 'right',
  }
}

// ── Modal: contraseña para reenviar ───────────────────────────────────────────
function ERPPasswordModal({ onClose, onUnlocked }) {
  const [pwd, setPwd] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')

  function handleSubmit(e) {
    e.preventDefault()
    if (pwd === ERP_PASSWORD) {
      onUnlocked()
    } else {
      setError('Contraseña incorrecta')
      setPwd('')
    }
  }

  return (
    <Modal open onClose={onClose} title="Reenviar al ERP"
           subtitle="Introduce la contraseña para volver a enviar" maxWidth={420}>
      <form onSubmit={handleSubmit}>
        <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5 }}>
            Estos datos ya se enviaron al ERP. Para volver a enviarlos se necesita la contraseña de configuración ERP.
          </p>
          <div style={{ position: 'relative' }}>
            <input autoFocus type={show ? 'text' : 'password'}
                   value={pwd}
                   onChange={e => { setPwd(e.target.value); setError('') }}
                   placeholder="Contraseña"
                   style={{
                     width: '100%', padding: '10px 42px 10px 14px', borderRadius: 10, fontSize: 13,
                     background: 'var(--bg-1)', border: `1px solid ${error ? 'var(--red)' : 'var(--line)'}`,
                     color: 'var(--text-0)',
                   }} />
            <button type="button" onClick={() => setShow(s => !s)}
                    style={{
                      position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                      background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)',
                      display: 'flex', alignItems: 'center', padding: 4,
                    }}>
              {show ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          {error && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'rgba(239,68,68,0.08)', borderRadius: 10 }}>
              <AlertCircle size={14} style={{ color: 'var(--red)' }} />
              <span style={{ fontSize: 13, color: 'var(--red)' }}>{error}</span>
            </div>
          )}
        </div>
        <div style={{ padding: '16px 28px', borderTop: '1px solid var(--line)', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Btn variant="secondary" size="md" type="button" onClick={onClose}>Cancelar</Btn>
          <Btn variant="primary" size="md" type="submit"><Unlock size={14} aria-hidden="true" /> Desbloquear y enviar</Btn>
        </div>
      </form>
    </Modal>
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
