import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, User, Dumbbell, ClipboardList, FlaskConical,
  CalendarCheck, BookMarked, Archive, UserX, CheckCircle2,
  XCircle, Heart, Ruler, Weight, Target, Info, Loader2,
  Activity, Smartphone, Settings, Shield, Mail, Phone, MapPin,
  Pencil
} from 'lucide-react'
import { Card, Badge, Btn, Avatar, SectionTitle } from '../../components/UI'
import ConfirmDialog from '../../components/ConfirmDialog'
import Modal from '../../components/Modal'
import { useToast } from '../../components/Toast'
import { getClientes, getTrainingsUser, getPlanesCliente, postClientes, desvinculaCliente as apiDesvincular } from '../../utils/api'

const tabs = [
  { id: 'perfil',         label: 'Perfil',           icon: User },
  { id: 'entrenamientos', label: 'Entrenamientos',    icon: Dumbbell },
  { id: 'planes',         label: 'Planes asignados',  icon: ClipboardList },
  { id: 'tests',          label: 'Tests físicos',     icon: FlaskConical },
  { id: 'reservas',       label: 'Reservas clases',   icon: CalendarCheck },
  { id: 'bonos',          label: 'Reservas LP',       icon: BookMarked },
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

function Field({ label, value, children, editing, fieldKey, editForm, setEditForm, type = 'text' }) {
  if (editing && fieldKey && editForm && setEditForm) {
    return (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
        <dt style={{ fontSize: 13, color: 'var(--text-3)', flexShrink: 0 }}>{label}</dt>
        <dd>
          <input
            type={type}
            value={editForm[fieldKey] ?? ''}
            onChange={e => setEditForm(f => ({ ...f, [fieldKey]: type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value }))}
            className="form-input"
            style={{
              width: '100%', maxWidth: 240, padding: '8px 12px', borderRadius: 10, fontSize: 13,
              background: 'var(--bg-1)', border: '1px solid var(--line)', color: 'var(--text-0)',
              textAlign: 'right', transition: 'border-color 0.15s',
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

function BoolField({ label, value, editing, fieldKey, editForm, setEditForm }) {
  if (editing && fieldKey && editForm && setEditForm) {
    const checked = editForm[fieldKey] === true || editForm[fieldKey] === 1
    return (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
        <dt style={{ fontSize: 13, color: 'var(--text-3)', flexShrink: 0 }}>{label}</dt>
        <dd>
          <button type="button"
            onClick={() => setEditForm(f => ({ ...f, [fieldKey]: !checked }))}
            aria-pressed={checked}
            style={{
              padding: '6px 16px', borderRadius: 10, fontSize: 12, fontWeight: 500, cursor: 'pointer',
              background: checked ? 'rgba(248,113,113,0.1)' : 'rgba(45,212,168,0.1)',
              color: checked ? 'var(--red)' : 'var(--green)',
              border: `1px solid ${checked ? 'rgba(248,113,113,0.2)' : 'rgba(45,212,168,0.2)'}`,
            }}>
            {checked ? 'Sí' : 'No'}
          </button>
        </dd>
      </div>
    )
  }

  const yes = value === true || value === 1
  return (
    <Field label={label}>
      {yes
        ? <Badge color="red"><XCircle size={10} aria-hidden="true" /> Sí</Badge>
        : <Badge color="green"><CheckCircle2 size={10} aria-hidden="true" /> No</Badge>
      }
    </Field>
  )
}

export default function ClientProfile() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const [tab, setTab] = useState('perfil')
  const [cliente, setCliente] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [actionLoading, setActionLoading] = useState('')
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState(null)

  // Dialog states (replaces window.confirm/prompt/alert)
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
    const isArchived = cliente.enabled === false
    if (isArchived) {
      setConfirmArchivar(true)
    } else {
      setMotivoModal(true)
      setMotivo('')
    }
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

  const handleDesvincular = () => {
    if (!cliente) return
    setConfirmDesvincular(true)
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

  const handleModificar = () => {
    setEditForm({ ...cliente })
    setEditing(true)
    setTab('perfil')
  }

  const handleSaveEdit = async () => {
    if (!editForm) return
    setActionLoading('guardar')
    try {
      await postClientes([editForm])
      setCliente({ ...editForm })
      setEditing(false)
      setEditForm(null)
      toast.success('Cambios guardados correctamente')
    } catch {
      toast.error('Error al guardar los cambios')
    } finally {
      setActionLoading('')
    }
  }

  const handleCancelEdit = () => {
    setEditing(false)
    setEditForm(null)
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
                  {cliente.alias && (
                    <span style={{ fontSize: 16, fontWeight: 400, color: 'var(--text-3)', marginLeft: 10 }}>"{cliente.alias}"</span>
                  )}
                </h1>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 8, fontSize: 13, color: 'var(--text-3)' }}>
                  {cliente.email && <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Mail size={13} aria-hidden="true" /> {cliente.email}</span>}
                  {cliente.cellPhone && <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Phone size={13} aria-hidden="true" /> {cliente.cellPhone}</span>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {cliente.enabled === false
                  ? <Badge color="gray"><Archive size={10} aria-hidden="true" /> Archivado</Badge>
                  : cliente.activo === false
                    ? <Badge color="yellow">Inactivo</Badge>
                    : <Badge color="green">Activo</Badge>
                }
                {cliente.nivelConocimiento != null && <Badge color="blue">Nivel {cliente.nivelConocimiento}</Badge>}
                {cliente.rol != null && <Badge color="purple">Rol {cliente.rol}</Badge>}
              </div>
            </div>

            {/* Key metrics */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 20, marginTop: 24 }}>
              {[
                { icon: User, label: 'Edad', value: edad != null ? `${edad} años` : '—' },
                { icon: Ruler, label: 'Talla', value: cliente.height ? `${cliente.height} cm` : '—' },
                { icon: Weight, label: 'Peso', value: cliente.weight ? `${cliente.weight} kg` : '—' },
                { icon: Heart, label: 'FC reposo', value: cliente.hrReposo ? `${cliente.hrReposo} ppm` : '—' },
                { icon: Target, label: 'VO₂max', value: cliente.vo2max ?? '—' },
                { icon: Dumbbell, label: 'Entrenam.', value: cliente.numTrainings ?? '—' },
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

        {/* Action buttons */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 28, paddingTop: 24, borderTop: '1px solid var(--line)' }}>
          {editing ? (
            <>
              <Btn variant="primary" size="md" onClick={handleSaveEdit} disabled={actionLoading === 'guardar'}>
                {actionLoading === 'guardar' ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <CheckCircle2 size={15} aria-hidden="true" />}
                {' Guardar cambios'}
              </Btn>
              <Btn variant="secondary" size="md" onClick={handleCancelEdit} disabled={actionLoading === 'guardar'}>
                <XCircle size={15} aria-hidden="true" /> Cancelar
              </Btn>
            </>
          ) : (
            <>
              <Btn variant="primary" size="md" onClick={handleModificar} disabled={!!actionLoading}>
                <Pencil size={15} aria-hidden="true" /> Modificar
              </Btn>
              <Btn variant="secondary" size="md" onClick={handleArchivar} disabled={!!actionLoading}>
                {actionLoading === 'archivar' ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Archive size={15} aria-hidden="true" />}
                {cliente.enabled === false ? ' Desarchivar' : ' Archivar'}
              </Btn>
              <Btn variant="danger" size="md" onClick={handleDesvincular} disabled={!!actionLoading}>
                {actionLoading === 'desvincular' ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <UserX size={15} aria-hidden="true" />}
                {' Desvincular'}
              </Btn>
            </>
          )}
        </div>
      </Card>

      {/* Tabs */}
      <div role="tablist" aria-label="Secciones del cliente" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, marginBottom: 24 }}>
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

      {tab === 'perfil'         && <TabPerfil cliente={cliente} editing={editing} editForm={editForm} setEditForm={setEditForm} />}
      {tab === 'entrenamientos' && <TabEntrenamientos clienteId={cliente.id} />}
      {tab === 'planes'         && <TabPlanes clienteId={cliente.id} />}
      {tab === 'tests'          && <TabPlaceholder icon={FlaskConical} msg="Tests físicos no disponibles en esta versión de la API" />}
      {tab === 'reservas'       && <TabPlaceholder icon={CalendarCheck} msg="Reservas de clases no disponibles en esta versión de la API" />}
      {tab === 'bonos'          && <TabPlaceholder icon={BookMarked} msg="Reservas de largo plazo no disponibles en esta versión de la API" />}

      {/* Confirm: Desarchivar */}
      <ConfirmDialog
        open={confirmArchivar}
        title="Desarchivar cliente"
        message={`¿Quieres desarchivar a ${cliente.name} ${cliente.surname}?`}
        confirmText="Desarchivar"
        variant="primary"
        onConfirm={() => doArchivar(null)}
        onCancel={() => setConfirmArchivar(false)}
      />

      {/* Confirm: Desvincular */}
      <ConfirmDialog
        open={confirmDesvincular}
        title="Desvincular cliente"
        message={`¿Desvincular a ${cliente.name} ${cliente.surname}? Esta acción no se puede deshacer.`}
        confirmText="Desvincular"
        onConfirm={doDesvincular}
        onCancel={() => setConfirmDesvincular(false)}
      />

      {/* Modal: Motivo archivado (replaces window.prompt) */}
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
                   transition: 'border-color 0.15s',
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

// ── Tab Perfil ────────────────────────────────────────────────────────────────
function TabPerfil({ cliente, editing, editForm, setEditForm }) {
  const ep = { editing, editForm, setEditForm }

  return (
    <div role="tabpanel" aria-label="Perfil" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(380px, 100%), 1fr))', gap: 20 }}>

      {editing && (
        <div style={{ gridColumn: '1 / -1', padding: '14px 20px', borderRadius: 14, background: 'rgba(45,212,168,0.08)', border: '1px solid rgba(45,212,168,0.2)', fontSize: 13, color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Pencil size={14} aria-hidden="true" /> Modo edición — modifica los campos y pulsa "Guardar cambios"
        </div>
      )}

      <Card style={{ padding: 32 }}>
        <SectionTitle><User size={16} style={{ display: 'inline', marginRight: 8, verticalAlign: 'middle' }} />Datos personales</SectionTitle>
        <dl>
          <Field label="ID" value={cliente.id} />
          <Field label="ID Espejo" value={cliente.idEspejo} fieldKey="idEspejo" type="number" {...ep} />
          <Field label="Nombre" value={cliente.name} fieldKey="name" {...ep} />
          <Field label="Apellidos" value={cliente.surname} fieldKey="surname" {...ep} />
          <Field label="Alias" value={cliente.alias} fieldKey="alias" {...ep} />
          <Field label="Email" value={cliente.email} fieldKey="email" type="email" {...ep} />
          <Field label="Email base" value={cliente.emailBase} />
          <Field label="Email verificado">{boolLabel(cliente.emailVerificado)}</Field>
          <Field label="Username" value={cliente.username} fieldKey="username" {...ep} />
          <Field label="Teléfono" value={cliente.cellPhone} fieldKey="cellPhone" type="tel" {...ep} />
          <Field label="DNI" value={cliente.dni} fieldKey="dni" {...ep} />
          <Field label="Género" value={editing ? undefined : (cliente.gender === 'F' ? 'Femenino' : cliente.gender === 'M' ? 'Masculino' : cliente.gender ?? '—')} fieldKey="gender" {...ep} />
          <Field label="Fecha nacimiento" value={editing ? undefined : formatDate(cliente.birthdate)} fieldKey="birthdate" type="date" {...ep} />
          <Field label="Edad" value={cliente.age ?? calcEdad(cliente.birthdate) ?? '—'} />
          <Field label="Dirección" value={cliente.address} fieldKey="address" {...ep} />
          <Field label="Localidad" value={cliente.town} fieldKey="town" {...ep} />
          <Field label="Código postal" value={cliente.postal_code} fieldKey="postal_code" {...ep} />
          <Field label="Imagen URL" value={cliente.imgUrl} fieldKey="imgUrl" {...ep} />
          <Field label="Rol" value={cliente.rol} />
          <Field label="Código activación" value={cliente.codigoActivacion} />
        </dl>
      </Card>

      <Card style={{ padding: 32 }}>
        <SectionTitle><Activity size={16} style={{ display: 'inline', marginRight: 8, verticalAlign: 'middle' }} />Datos físicos y salud</SectionTitle>
        <dl>
          <Field label="Altura (cm)" value={editing ? undefined : (cliente.height ? `${cliente.height} cm` : null)} fieldKey="height" type="number" {...ep} />
          <Field label="Peso (kg)" value={editing ? undefined : (cliente.weight ? `${cliente.weight} kg` : null)} fieldKey="weight" type="number" {...ep} />
          <Field label="VO₂ máx" value={cliente.vo2max} fieldKey="vo2max" type="number" {...ep} />
          <Field label="FC reposo" value={editing ? undefined : (cliente.hrReposo ? `${cliente.hrReposo} ppm` : null)} fieldKey="hrReposo" type="number" {...ep} />
          <Field label="Estado de forma" value={cliente.estadoForma} fieldKey="estadoForma" {...ep} />
          <Field label="Nivel conocimiento" value={cliente.nivelConocimiento} fieldKey="nivelConocimiento" type="number" {...ep} />
          <Field label="Valoración senior" value={cliente.valoracionSenior} fieldKey="valoracionSenior" {...ep} />
          <Field label="Motivación" value={cliente.motivacion} fieldKey="motivacion" {...ep} />
          <Field label="Ciclo" value={cliente.ciclo} fieldKey="ciclo" {...ep} />
        </dl>
      </Card>

      <Card style={{ padding: 32 }}>
        <SectionTitle><Dumbbell size={16} style={{ display: 'inline', marginRight: 8, verticalAlign: 'middle' }} />Entrenamiento</SectionTitle>
        <dl>
          <Field label="Nº entrenamientos" value={cliente.numTrainings} />
          <Field label="Objetivo" value={cliente.objective} fieldKey="objective" {...ep} />
          <Field label="ID Entrenador" value={cliente.idTrainer} />
          <Field label="ID Entrenamiento Eval." value={cliente.idEntrenamientoEv} />
          <Field label="Última evaluación" value={formatDate(cliente.fechaUltimaEvaluacion)} />
          <BoolField label="Quiere evaluación" value={cliente.quiereEvaluacion} fieldKey="quiereEvaluacion" {...ep} />
          <Field label="Tiempo entre eval." value={cliente.tiempoEntreEvaluaciones} fieldKey="tiempoEntreEvaluaciones" type="number" {...ep} />
          <Field label="Tiempo subida" value={cliente.tiempoSubida} fieldKey="tiempoSubida" type="number" {...ep} />
          <BoolField label="Virtual Coach" value={cliente.virtualCoach} fieldKey="virtualCoach" {...ep} />
        </dl>
      </Card>

      <Card style={{ padding: 32 }}>
        <SectionTitle><Shield size={16} style={{ display: 'inline', marginRight: 8, verticalAlign: 'middle' }} />Cuestionario médico (PAR-Q)</SectionTitle>
        <dl>
          <BoolField label="PAR-Q 1 — ¿Cardiopatía?" value={cliente.parq1} fieldKey="parq1" {...ep} />
          <BoolField label="PAR-Q 2 — ¿Dolor pecho?" value={cliente.parq2} fieldKey="parq2" {...ep} />
          <BoolField label="PAR-Q 3 — ¿Mareos?" value={cliente.parq3} fieldKey="parq3" {...ep} />
          <BoolField label="PAR-Q 4 — ¿Articulaciones?" value={cliente.parq4} fieldKey="parq4" {...ep} />
          <BoolField label="PAR-Q 5 — ¿Medicación?" value={cliente.parq5} fieldKey="parq5" {...ep} />
          <BoolField label="PAR-Q 6 — ¿Embarazo?" value={cliente.parq6} fieldKey="parq6" {...ep} />
          <BoolField label="PAR-Q 7 — ¿Otro motivo?" value={cliente.parq7} fieldKey="parq7" {...ep} />
          <BoolField label="PAR-Q 8" value={cliente.parq8} fieldKey="parq8" {...ep} />
          <BoolField label="Medicación" value={cliente.medicacion} fieldKey="medicacion" {...ep} />
          <Field label="Detalle medicación" value={cliente.medicacion_info} fieldKey="medicacion_info" {...ep} />
          <BoolField label="Enfermedad" value={cliente.enfermedad} fieldKey="enfermedad" {...ep} />
          <Field label="Detalle enfermedad" value={cliente.enfermedad_info} fieldKey="enfermedad_info" {...ep} />
        </dl>
      </Card>

      <Card style={{ padding: 32 }}>
        <SectionTitle><Smartphone size={16} style={{ display: 'inline', marginRight: 8, verticalAlign: 'middle' }} />Dispositivo y sensores</SectionTitle>
        <dl>
          <Field label="HRM UUID" value={cliente.hrm_uuid} />
          <Field label="HRM Modelo" value={cliente.hrm_model} />
          <Field label="Plataforma" value={cliente.platform} />
          <Field label="OneSignal Token" value={cliente.oneSignalToken} />
        </dl>
      </Card>

      <Card style={{ padding: 32 }}>
        <SectionTitle><Settings size={16} style={{ display: 'inline', marginRight: 8, verticalAlign: 'middle' }} />Estado y configuración</SectionTitle>
        <dl>
          <BoolField label="Habilitado (enabled)" value={cliente.enabled} fieldKey="enabled" {...ep} />
          <BoolField label="Activo" value={cliente.activo} fieldKey="activo" {...ep} />
          <BoolField label="Compartido (shared)" value={cliente.shared} fieldKey="shared" {...ep} />
          <BoolField label="Bidireccional" value={cliente.bidireccional} fieldKey="bidireccional" {...ep} />
          <BoolField label="Cliente Home" value={cliente.clienteHome} fieldKey="clienteHome" {...ep} />
          <BoolField label="Aviso visual" value={cliente.avisoVisual} fieldKey="avisoVisual" {...ep} />
          <BoolField label="Aviso acústico" value={cliente.avisoAcustico} fieldKey="avisoAcustico" {...ep} />
          <BoolField label="Tour realizado" value={cliente.tourRealizado} fieldKey="tourRealizado" {...ep} />
          <BoolField label="Pendiente de envío" value={cliente.toSend} fieldKey="toSend" {...ep} />
          <Field label="Fecha edición" value={formatDate(cliente.editionDate)} />
          <Field label="Motivo archivado" value={cliente.motivoArchivado} fieldKey="motivoArchivado" {...ep} />
          <Field label="User ID" value={cliente.userId} />
        </dl>
      </Card>
    </div>
  )
}

// ── Tab Entrenamientos ────────────────────────────────────────────────────────
function TabEntrenamientos({ clienteId }) {
  const [trainings, setTrainings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    getTrainingsUser(clienteId)
      .then(data => setTrainings(data))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [clienteId])

  if (loading) return <LoadingCard />
  if (error) return <ErrorCard msg="Error cargando entrenamientos" />

  return (
    <div role="tabpanel" aria-label="Entrenamientos">
      <Card style={{ padding: 32 }}>
        <SectionTitle>Últimos entrenamientos ({trainings.length})</SectionTitle>
        {trainings.length === 0
          ? <p style={{ fontSize: 14, padding: '40px 0', textAlign: 'center', color: 'var(--text-3)' }}>Sin entrenamientos registrados</p>
          : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line)' }}>
                  {['Fecha','Entrenamiento','Duración','FC media','Calorías','Estado'].map(h => (
                    <th key={h} scope="col" style={{ padding: '12px 16px 12px 0', textAlign: 'left', fontSize: 12, fontWeight: 500, color: 'var(--text-3)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {trainings.map((e, i) => (
                  <tr key={e.id ?? i} style={{ borderBottom: i < trainings.length - 1 ? '1px solid var(--line)' : 'none' }}>
                    <td style={{ padding: '14px 16px 14px 0', color: 'var(--text-1)' }}>
                      {e.fecha ? new Date(e.fecha).toLocaleDateString('es-ES') : '—'}
                    </td>
                    <td style={{ padding: '14px 16px 14px 0', color: 'var(--text-2)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {e.nombre ?? e.idEntrenamiento ?? '—'}
                    </td>
                    <td style={{ padding: '14px 16px 14px 0', color: 'var(--text-1)' }}>
                      {e.duracion != null ? `${e.duracion} min` : '—'}
                    </td>
                    <td style={{ padding: '14px 16px 14px 0' }}>
                      {e.fcMedia != null
                        ? <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--red)' }}><Heart size={12} aria-hidden="true" />{e.fcMedia}</span>
                        : '—'}
                    </td>
                    <td style={{ padding: '14px 16px 14px 0', color: 'var(--text-2)' }}>
                      {e.calorias != null ? `${e.calorias} kcal` : '—'}
                    </td>
                    <td style={{ padding: '14px 0' }}>
                      {e.completado != null
                        ? e.completado
                          ? <Badge color="green">Completado</Badge>
                          : <Badge color="red">Interrumpido</Badge>
                        : <Badge color="gray">—</Badge>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

// ── Tab Planes ────────────────────────────────────────────────────────────────
function TabPlanes({ clienteId }) {
  const [planes, setPlanes] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    getPlanesCliente(clienteId)
      .then(data => setPlanes(data))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [clienteId])

  if (loading) return <LoadingCard />
  if (error) return <ErrorCard msg="Error cargando planes" />

  if (planes.length === 0) return (
    <div role="tabpanel" aria-label="Planes asignados">
      <Card style={{ padding: 48, textAlign: 'center' }}>
        <p style={{ color: 'var(--text-3)', fontSize: 14 }}>Sin planes asignados</p>
      </Card>
    </div>
  )

  return (
    <div role="tabpanel" aria-label="Planes asignados" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {planes.map((p, i) => {
        const pct = p.sesionesTotal > 0
          ? Math.round((p.sesionesCompletadas / p.sesionesTotal) * 100)
          : 0
        const estadoColor = { 1: 'orange', 2: 'green', 3: 'red' }
        const estadoLabel = { 1: 'En curso', 2: 'Completado', 3: 'Interrumpido' }
        return (
          <Card key={p.id ?? i} style={{ padding: 28 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <div>
                <p style={{ fontFamily: 'Outfit', fontWeight: 600, fontSize: 15, color: 'var(--text-0)' }}>
                  {p.nombre ?? `Plan #${p.idPlan ?? p.id}`}
                </p>
                {(p.fechaInicio || p.fechaFin) && (
                  <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 6 }}>
                    {formatDate(p.fechaInicio)} → {formatDate(p.fechaFin)}
                  </p>
                )}
              </div>
              {p.estado != null && (
                <Badge color={estadoColor[p.estado] ?? 'gray'}>
                  {estadoLabel[p.estado] ?? `Estado ${p.estado}`}
                </Badge>
              )}
            </div>
            {p.sesionesTotal != null && (
              <div style={{ marginTop: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 8 }}>
                  <span style={{ color: 'var(--text-3)' }}>Progreso</span>
                  <span style={{ color: 'var(--green)' }}>{p.sesionesCompletadas ?? 0}/{p.sesionesTotal} ({pct}%)</span>
                </div>
                <div style={{ height: 6, borderRadius: 99, overflow: 'hidden', background: 'var(--bg-4)' }}>
                  <div style={{ height: '100%', borderRadius: 99, width: `${pct}%`, background: 'var(--green)', transition: 'width 0.4s ease' }} />
                </div>
              </div>
            )}
          </Card>
        )
      })}
    </div>
  )
}

function TabPlaceholder({ icon: Icon, msg }) {
  return (
    <Card style={{ padding: '64px 32px', textAlign: 'center' }}>
      <Icon size={28} style={{ color: 'var(--text-3)', margin: '0 auto 12px' }} aria-hidden="true" />
      <p style={{ fontSize: 14, color: 'var(--text-3)' }}>{msg}</p>
    </Card>
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
