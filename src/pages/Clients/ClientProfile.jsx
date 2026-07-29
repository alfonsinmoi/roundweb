import { useState, useEffect, useMemo } from 'react'
import { useOverlayClose } from '../../hooks/useOverlayClose'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, User, CalendarCheck, Send,
  Archive, UserX, CheckCircle2, XCircle,
  Heart, Ruler, Weight, Target, Loader2,
  Activity, Smartphone, Settings, Shield, Mail, Phone, Pencil, Dumbbell,
  BarChart3, TrendingUp, TrendingDown, Clock, Users, Download, Code, Copy, Check,
  Plus, Lock, Unlock, X, AlertCircle, Eye, EyeOff, Trash2, Receipt, RefreshCw,
  QrCode, Bell, MessageCircle, Zap, UserCog, History, StickyNote, ShoppingBag,
  PauseCircle, Save,
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { Card, Badge, Btn, Avatar, SectionTitle } from '../../components/UI'
import ConfirmDialog from '../../components/ConfirmDialog'
import Modal from '../../components/Modal'
import { useToast } from '../../components/Toast'
import { useAuth } from '../../contexts/AuthContext'
import {
  getClientes, postClientes, desvinculaCliente as apiDesvincular,
  getClasesCliente, getTrainingsUser, getTrainingsFromSalas, getERPDatosCliente,
  postERPDatosCliente, apiPostRaw, apiGetRaw, loginEasy,
  getSalasByRange, getUsuariosBySala,
} from '../../utils/api'
import { useCategoriasMap } from '../../hooks/useCategoriasMap'
import { listarNotasCliente } from '../../utils/notasApi'
import { useOdooStatus } from '../../hooks/useOdooStatus'
import { useCan } from '../../hooks/useCan'
import AltaClienteModal from '../../components/AltaClienteModal'
import GenerarReciboModal from '../../components/GenerarReciboModal'
import CrearUsuarioWebDesdeClienteModal from '../../components/CrearUsuarioWebDesdeClienteModal'
import TrazabilidadModal from '../../components/TrazabilidadModal'
import { useAltaModo } from '../../components/QrAltaCliente'
import DevolverReciboBtn from '../../components/recibos/DevolverReciboBtn'
import CorregirFormaPagoBtn from '../../components/recibos/CorregirFormaPagoBtn'
import ModificarReciboBtn from '../../components/recibos/ModificarReciboBtn'
import { usuarioWebFindByEmail } from '../../utils/authUsuarioApi'
import { recibosImpagadosCliente } from '../../utils/configApi'
import InformesEstadoFisicoButton from '../../components/InformesEstadoFisicoButton'
import CompeticionesClienteButton from '../../components/CompeticionesClienteButton'
import ClienteNotasTab from '../../components/notas/ClienteNotasTab'
import TabComprasTPV from './TabComprasTPV'
import CuotasClienteCard from '../../components/subs/CuotasClienteCard'
import DescuentosClienteCard from '../../components/subs/DescuentosClienteCard'
import ModificacionesClienteCard from '../../components/subs/ModificacionesClienteCard'
import FamiliaresClienteCard from '../../components/subs/FamiliaresClienteCard'
import { clienteFechas, getRoundIdentity, notifPorCliente, notifEnvioCreate,
         bajaProgramadaGet, bajaProgramadaCreate, bajaProgramadaCancel,
         temporalInactivoGet, temporalInactivoCreate, temporalInactivoCancel,
         temporalInactivoUpdate } from '../../utils/configApi'
import { NOTIF_SECCIONES, NOTIF_TIPOS, tiposDeSeccion } from '../../utils/notifCatalog'

const ERP_PASSWORD = 'Cambiamos!2026'

// Motivos de inactividad temporal (pausa). Keys = lo que espera el backend.
const MOTIVOS_PAUSA = [
  ['baja_medica', 'Baja médica'],
  ['lesion', 'Lesión'],
  ['vacaciones', 'Vacaciones'],
  ['cambio_trabajo_domicilio', 'Cambio de trabajo/domicilio'],
  ['otros', 'Otros'],
]
const MOTIVO_PAUSA_LABEL = Object.fromEntries(MOTIVOS_PAUSA)

// Tab "Datos ERP" eliminado: la gestión de cuotas/descuentos/forma de pago
// del cliente vive ahora en "Datos personales → Cuota y fechas" (componente
// CuotasClienteCard). El alta-cliente nuevo se hace desde el banner
// "Cliente esperando cobro" (BannerNuevosClientes → AltaClienteModal).
const tabs = [
  { id: 'personal', label: 'Datos personales', icon: User },
  { id: 'notas',    label: 'Notas',             icon: MessageCircle },
  { id: 'clases',   label: 'Clases realizadas', icon: CalendarCheck },
  { id: 'analisis', label: 'Análisis uso',      icon: BarChart3 },
  { id: 'cuotas',   label: 'Recibos',           icon: Receipt },
  { id: 'compras',  label: 'Compras TPV',       icon: ShoppingBag },
  { id: 'notificaciones', label: 'Notificaciones', icon: Bell },
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

// Editable categoría selector (catálogo del manager)
function CategoriaField({ label, categorias, valueId, editing, editForm, setEditForm }) {
  if (editing && editForm && setEditForm) {
    return (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
        <dt style={{ fontSize: 13, color: 'var(--text-3)', flexShrink: 0 }}>{label}</dt>
        <dd>
          <select
            value={editForm.categoriaId ?? ''}
            onChange={e => setEditForm(f => ({
              ...f,
              categoriaId: e.target.value === '' ? null : Number(e.target.value),
            }))}
            className="form-input"
            style={{
              width: '100%', maxWidth: 240, padding: '8px 12px', borderRadius: 10, fontSize: 13,
              background: 'var(--bg-1)', border: '1px solid var(--line)', color: 'var(--text-0)',
              textAlign: 'right',
            }}
          >
            <option value="">— Sin categoría —</option>
            {(categorias || []).filter(c => c.activa !== false).map(c => (
              <option key={c.id} value={c.id}>{c.nombre}</option>
            ))}
          </select>
        </dd>
      </div>
    )
  }
  const cat = (categorias || []).find(c => c.id === valueId)
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16, padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
      <dt style={{ fontSize: 13, color: 'var(--text-3)', flexShrink: 0 }}>{label}</dt>
      <dd style={{ fontSize: 13, color: 'var(--text-1)', textAlign: 'right', wordBreak: 'break-word' }}>
        {cat ? (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 500,
            background: cat.color ? `${cat.color}22` : 'var(--bg-3)',
            color: cat.color || 'var(--text-1)',
            border: `1px solid ${cat.color ? `${cat.color}55` : 'var(--line)'}`,
          }}>
            {cat.nombre}
          </span>
        ) : '—'}
      </dd>
    </div>
  )
}

// ── Auth modal ─────────────────────────────────────────────────────────────────
function AuthModal({ open, onClose, onAuthorized, clienteName }) {
  const { user } = useAuth()
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd] = useState(false)
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
          <div style={{ position: 'relative' }}>
            <input
              id="auth-password"
              type={showPwd ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={e => { setPassword(e.target.value); setError('') }}
              className="form-input"
              style={{
                width: '100%', padding: '14px 48px 14px 18px', borderRadius: 14, fontSize: 14,
                background: 'var(--bg-1)', border: `1px solid ${error ? 'var(--red)' : 'var(--line)'}`,
                color: 'var(--text-0)', outline: 'none',
              }}
            />
            <button type="button" onClick={() => setShowPwd(s => !s)} tabIndex={-1}
                    aria-label={showPwd ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    style={{
                      position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--text-3)', padding: 6, display: 'flex',
                    }}>
              {showPwd ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
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
  const { user } = useAuth()
  const [searchParams] = useSearchParams()
  const initialTab = searchParams.get('tab') || 'personal'
  const [tab, setTab] = useState(initialTab)
  const [cliente, setCliente] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [actionLoading, setActionLoading] = useState('')
  // Si el manager no tiene Odoo desplegado, ocultamos las cards/botones
  // relacionados (cuotas, descuentos, modificaciones, familiares, alta ERP).
  const { odooEnabled: hasOdoo } = useOdooStatus()

  // Gates UI nuevos (baja programada). El botón "Inactivar/Reactivar" usa
  // pausar/archivar — aquí ramificamos: el flujo "programar baja futura"
  // requiere el permiso correspondiente y el de cancelarla otro distinto.
  const canProgramarBaja = useCan('clientes.baja_programada.programar')
  const canCancelarBajaProg = useCan('clientes.baja_programada.cancelar_programacion')
  // Gates UI acciones de la hero card / pestaña notificaciones.
  const canArchivar     = useCan('clientes.archivar')
  const canCrearUw      = useCan('configuracion.usuarios_web.crear')
  const canNotificar    = useCan('clientes.notificar')
  // "Generar recibo manual": permiso dedicado `crear_recibo` (nuevo) o el
  // antiguo `modificar_recibo` (retrocompat con perfiles ya configurados).
  const canCrearRecibo = useCan('economico.cuotas_mensuales.crear_recibo')
                      || useCan('economico.cuotas_mensuales.modificar_recibo')
  // TODO(perms): "Desvincular cliente" sigue sin clave de permiso fino.

  const [confirmArchivar, setConfirmArchivar] = useState(false)
  const [confirmDesvincular, setConfirmDesvincular] = useState(false)
  const [motivoModal, setMotivoModal] = useState(false)
  const [motivo, setMotivo] = useState('')
  // Modales de acciones operativas (Atender re-disparo, Generar recibo manual).
  // "Atender" reabre el wizard AltaClienteModal — útil si el operador se
  // equivocó al atender al cliente (categoría/cuota mal asignada, etc.) y
  // quiere repetir el flujo desde cero.
  const [atenderOpen, setAtenderOpen] = useState(false)
  const [generarReciboOpen, setGenerarReciboOpen] = useState(false)
  // Modal "Crear usuario web" — solo aparece para clientes con categoría
  // Trabajador que aún no tienen usuario_web activo con su email.
  const [crearUwOpen, setCrearUwOpen] = useState(false)
  const [trazaOpen, setTrazaOpen] = useState(false)
  // Estado del posible usuario_web asociado al email del cliente. null = no
  // existe / no activo. Si existe y activo, mostramos un badge en la cabecera.
  // Lo refrescamos al cargar la ficha y tras crear/desactivar.
  const [usuarioWebAsociado, setUsuarioWebAsociado] = useState(null)
  // Fechas del cliente (alta, baja, etc.) y recibos impagados — se muestran
  // como banner/badge prominente en la cabecera para que el operador los
  // vea al instante sin tener que bajar a la card de Cuota y fechas.
  const [fechasCliente, setFechasCliente] = useState(null)
  const [recibosImpagados, setRecibosImpagados] = useState([])
  // Junio 2026 — última nota del cliente, mostrada en cabecera de la ficha
  // (sustituye al bloque "Objetivo" que estaba casi siempre vacío).
  const [ultimaNota, setUltimaNota] = useState(null)
  const [ultimaNotaLoading, setUltimaNotaLoading] = useState(false)
  // Doble confirmación. inactivarStep: 1 = formulario (fecha + motivo);
  // 2 = aviso final + checkbox. desvincularConfirmText: texto que el usuario
  // debe tipear para habilitar el botón rojo (= 'DESVINCULAR').
  const [inactivarStep, setInactivarStep] = useState(1)
  const [inactivarConfirmCheck, setInactivarConfirmCheck] = useState(false)
  const [desvincularConfirmText, setDesvincularConfirmText] = useState('')
  // Hook de categorías a nivel main ClientProfile (también está en TabPersonal
  // pero lo necesitamos aquí para el badge + botón "Crear usuario web").
  const { getCategoria: getCategoriaMain } = useCategoriasMap()
  const categoriaCliente = cliente ? getCategoriaMain(cliente) : null
  const esTrabajador = !!(categoriaCliente?.nombre &&
    /trabaj/i.test(categoriaCliente.nombre))
  const identityMain = useMemo(() => getRoundIdentity(user), [user])
  // Fecha de inicio de inactividad. Default: hoy. Si el manager elige una
  // fecha futura, NoofitPro mantiene al cliente activo hasta esa fecha y el
  // cron `round_baja_programada` lo desactiva la noche del día indicado.
  const [fechaBaja, setFechaBaja] = useState('')
  // Baja programada pendiente cargada del backend (null si no hay).
  const [bajaPendiente, setBajaPendiente] = useState(null)
  const [confirmCancelarBaja, setConfirmCancelarBaja] = useState(false)
  // ── Inactividad temporal (pausa) ──────────────────────────────────────
  // Pausa activa del cliente (estado programada|en_curso) o null.
  const [pausaActiva, setPausaActiva] = useState(null)
  const [pausaModal, setPausaModal] = useState(false)
  const [pausaInicio, setPausaInicio] = useState('')
  const [pausaFin, setPausaFin] = useState('')
  const [pausaMotivo, setPausaMotivo] = useState('')
  const [pausaDetalle, setPausaDetalle] = useState('')
  const [confirmCancelarPausa, setConfirmCancelarPausa] = useState(false)
  // Edición de fechas de la pausa. Gate por permiso configurable en el perfil
  // (`clientes.editar_pausa`): el manager decide qué perfiles pueden hacerlo.
  const canEditarPausa = useCan('clientes.editar_pausa')
  const [editFinOpen, setEditFinOpen] = useState(false)
  const [editFinValue, setEditFinValue] = useState('')
  const [editInicioValue, setEditInicioValue] = useState('')
  const [editFinSaving, setEditFinSaving] = useState(false)
  const [qrOpen, setQrOpen] = useState(false)
  // Modo "Alta de cliente" del trainer al que pertenece este cliente.
  // Si modo='centro', el QR de la ficha NO se muestra (solo el del centro
  // del menú clientes). Si 'individual' o 'ambos' → se muestra.
  const trainerIdCliente = String(cliente?.idTrainer || cliente?.id_trainer || identityMain?.trainerId || '')
  const altaModo = useAltaModo(trainerIdCliente)
  // Junio 2026 — formato confirmado por NoofitPro (docs/QR_TRAINER_CLIENTE.md):
  //   "TRAINERLINK;<idCliente>" para cedeDatos=true (defecto).
  //   "cedeDatosFalse:<idCliente>:<dni>:<idTrainer>" si cedeDatos=false.
  // Hasta que el flag llegue por API, asumimos cedeDatos=true.
  // El QR de la ficha se muestra SIEMPRE (antes dependía del modo de alta y
  // por eso había desaparecido para algunos clientes).
  const mostrarQrFicha = true

  const identity = getRoundIdentity(user)

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

  // Cargar baja programada pendiente del cliente (si la hay).
  useEffect(() => {
    if (!id || !identity?.managerId) return
    let cancel = false
    bajaProgramadaGet(identity, id)
      .then(b => { if (!cancel) setBajaPendiente(b || null) })
      .catch(() => { if (!cancel) setBajaPendiente(null) })
    return () => { cancel = true }
  }, [id, identity?.managerId])

  // Cargar pausa (inactividad temporal) activa del cliente (si la hay).
  useEffect(() => {
    if (!id || !identity?.managerId) return
    let cancel = false
    temporalInactivoGet(identity, id)
      .then(p => { if (!cancel) setPausaActiva(p || null) })
      .catch(() => { if (!cancel) setPausaActiva(null) })
    return () => { cancel = true }
  }, [id, identity?.managerId])

  // Comprueba si el email del cliente está dado de alta como usuario_web.
  // Se ejecuta cuando carga el cliente (tenemos email) y tras crear/cambiar
  // un usuario_web (re-llamamos `refreshUsuarioWeb`). Si el usuario_web está
  // inactivo lo tratamos como "no asociado" → el banner desaparece.
  const refreshUsuarioWeb = async () => {
    if (!cliente?.email) { setUsuarioWebAsociado(null); return }
    try {
      const uw = await usuarioWebFindByEmail(identityMain, cliente.email)
      setUsuarioWebAsociado(uw && uw.activo ? uw : null)
    } catch { setUsuarioWebAsociado(null) }
  }
  useEffect(() => { refreshUsuarioWeb() }, [cliente?.email, cliente?.id])

  // Cargar fechas (alta/baja/inactivo) — se muestran en el header.
  useEffect(() => {
    if (!cliente?.id || !identityMain?.managerId) return
    let cancel = false
    clienteFechas(identityMain, cliente.id)
      .then(f => { if (!cancel) setFechasCliente(f || null) })
      .catch(() => { if (!cancel) setFechasCliente(null) })
    return () => { cancel = true }
  }, [cliente?.id, identityMain?.managerId])

  // Cargar recibos impagados/devueltos para banner rojo prominente.
  useEffect(() => {
    if (!cliente?.id || !identityMain?.managerId || !hasOdoo) return
    let cancel = false
    recibosImpagadosCliente(identityMain, cliente.id)
      .then(r => { if (!cancel) setRecibosImpagados(r || []) })
      .catch(() => { if (!cancel) setRecibosImpagados([]) })
    return () => { cancel = true }
  }, [cliente?.id, identityMain?.managerId, hasOdoo])

  // Cargar la última nota (no archivada) para la cabecera.
  useEffect(() => {
    if (!cliente?.id) return
    let cancel = false
    setUltimaNotaLoading(true)
    listarNotasCliente(user, cliente.id, { limit: 1, archivadas: false })
      .then(ns => { if (!cancel) setUltimaNota((ns && ns[0]) || null) })
      .catch(() => { if (!cancel) setUltimaNota(null) })
      .finally(() => { if (!cancel) setUltimaNotaLoading(false) })
    return () => { cancel = true }
  }, [cliente?.id, user])

  // Re-comprueba el usuario_web cuando la ventana vuelve a foco. Caso de uso:
  // el manager está en esta ficha, abre otra pestaña a Configuración → Usuarios
  // web → desactiva el usuario → vuelve a esta pestaña → el banner debe
  // desaparecer sin tener que recargar.
  useEffect(() => {
    const onFocus = () => refreshUsuarioWeb()
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cliente?.email])

  const handleArchivar = () => {
    if (!cliente) return
    // Si ya está inactivo en NoofitPro → reactivar (flujo clásico)
    if (cliente.enabled === false) { setConfirmArchivar(true); return }
    // Si hay baja pendiente → ofrecer cancelarla
    if (bajaPendiente) { setConfirmCancelarBaja(true); return }
    // Si no, abrir modal con fecha + motivo
    setFechaBaja(new Date().toISOString().slice(0,10))   // default: hoy
    setMotivo('')
    setInactivarStep(1)               // arranca en paso 1 (formulario)
    setInactivarConfirmCheck(false)
    setMotivoModal(true)
  }

  const doArchivar = async (motivoArchivado = null) => {
    // Solo se usa para REACTIVAR. La baja (programar inactivo) usa
    // doProgramarBaja que llama al backend.
    setConfirmArchivar(false)
    setActionLoading('archivar')
    try {
      const updated = { ...cliente, enabled: true, motivoArchivado: null }
      await postClientes([updated])
      setCliente(updated)
      toast.success('Cliente reactivado')
    } catch {
      toast.error('Error al reactivar el cliente')
    } finally {
      setActionLoading('')
    }
  }

  const doProgramarBaja = async () => {
    if (!fechaBaja) { toast.error('Elige una fecha'); return }
    setMotivoModal(false)
    setActionLoading('archivar')
    try {
      const r = await bajaProgramadaCreate(identity, cliente.id, {
        fecha_baja: fechaBaja,
        motivo: motivo || null,
        cliente_nombre: `${cliente.name || ''} ${cliente.surname || ''}`.trim(),
        cliente_email: cliente.email || null,
      })
      setBajaPendiente(r.baja)
      if (r.ejecutada_inmediato) {
        // Refrescar el cliente para reflejar enabled=false en NoofitPro.
        const refreshed = (await getClientes()).find(c => String(c.id) === String(id))
        if (refreshed) setCliente(refreshed)
        toast.success(r.retroactiva
          ? '⚠️ Baja retroactiva aplicada. Revisa recibos del mes si toca anular.'
          : 'Cliente marcado como inactivo')
      } else {
        const fecha = new Date(fechaBaja).toLocaleDateString('es-ES')
        toast.success(`Baja programada para el ${fecha}. Hasta entonces puede seguir reservando.`)
      }
    } catch (e) {
      toast.error('Error al programar la baja: ' + (e.body?.error || e.message))
    } finally {
      setActionLoading('')
    }
  }

  const doCancelarBaja = async () => {
    setConfirmCancelarBaja(false)
    setActionLoading('archivar')
    try {
      await bajaProgramadaCancel(identity, cliente.id)
      setBajaPendiente(null)
      toast.success('Baja programada cancelada')
    } catch (e) {
      toast.error('Error al cancelar: ' + (e.body?.error || e.message))
    } finally {
      setActionLoading('')
    }
  }

  // ── Inactividad temporal (pausa) ────────────────────────────────────
  const abrirPausaModal = () => {
    const hoy = new Date().toISOString().slice(0, 10)
    setPausaInicio(hoy)
    setPausaFin('')
    setPausaMotivo('')
    setPausaDetalle('')
    setPausaModal(true)
  }

  const doCrearPausa = async () => {
    if (!pausaInicio || !pausaFin) { toast.error('Indica fecha de inicio y fin'); return }
    if (pausaFin < pausaInicio) { toast.error('La fecha de fin debe ser igual o posterior al inicio'); return }
    if (!pausaMotivo) { toast.error('Elige un motivo'); return }
    setPausaModal(false)
    setActionLoading('pausa')
    try {
      const r = await temporalInactivoCreate(identity, cliente.id, {
        fecha_inicio: pausaInicio,
        fecha_fin: pausaFin,
        motivo: pausaMotivo,
        motivo_detalle: pausaMotivo === 'otros' ? (pausaDetalle || null) : null,
        cliente_nombre: `${cliente.name || ''} ${cliente.surname || ''}`.trim(),
        cliente_email: cliente.email || null,
      })
      setPausaActiva(r.pausa)
      if (r.aplicada_inmediato) {
        // Refrescar el cliente para reflejar enabled=false en NoofitPro.
        const refreshed = (await getClientes()).find(c => String(c.id) === String(id))
        if (refreshed) setCliente(refreshed)
      }
      const nAnulados = r.recibos_anulados || 0
      toast.success(nAnulados > 0
        ? `Pausa creada. ${nAnulados} recibo(s) sin pagar anulado(s).`
        : 'Pausa creada correctamente.')
    } catch (e) {
      toast.error('Error al crear la pausa: ' + (e.body?.error || e.message))
    } finally {
      setActionLoading('')
    }
  }

  const doCancelarPausa = async () => {
    setConfirmCancelarPausa(false)
    setActionLoading('pausa')
    try {
      await temporalInactivoCancel(identity, cliente.id)
      setPausaActiva(null)
      // El cliente puede haber sido reactivado en NoofitPro al terminar.
      const refreshed = (await getClientes()).find(c => String(c.id) === String(id))
      if (refreshed) setCliente(refreshed)
      toast.success('Pausa cancelada/terminada')
    } catch (e) {
      toast.error('Error al cancelar la pausa: ' + (e.body?.error || e.message))
    } finally {
      setActionLoading('')
    }
  }

  const abrirEditFin = () => {
    if (!pausaActiva) return
    setEditFinValue((pausaActiva.fecha_fin || '').slice(0, 10))
    setEditInicioValue((pausaActiva.fecha_inicio || '').slice(0, 10))
    setEditFinOpen(true)
  }

  const doEditarFin = async () => {
    if (!editFinValue) { toast.error('Indica la nueva fecha fin'); return }
    const programada = pausaActiva?.estado === 'programada'
    const inicioEfectivo = programada ? editInicioValue : (pausaActiva.fecha_inicio || '').slice(0, 10)
    if (editFinValue < inicioEfectivo) {
      toast.error('La fecha fin debe ser igual o posterior al inicio'); return
    }
    setEditFinSaving(true)
    try {
      const datos = { fecha_fin: editFinValue }
      if (programada && editInicioValue) datos.fecha_inicio = editInicioValue
      const r = await temporalInactivoUpdate(identity, cliente.id, datos)
      setPausaActiva(r.pausa)
      setEditFinOpen(false)
      const nAnulados = r.recibos_anulados || 0
      let msg = 'Fechas de la pausa actualizadas.'
      if (nAnulados > 0) msg += ` ${nAnulados} recibo(s) sin pagar anulado(s).`
      if (r.meses_destapados?.length) {
        msg += ` Revisa los meses ${r.meses_destapados.join(', ')}: sus recibos anulados NO se restauran solos.`
        toast.warning(msg)
      } else {
        toast.success(msg)
      }
    } catch (e) {
      toast.error('Error al modificar la pausa: ' + (e.body?.error || e.message))
    } finally {
      setEditFinSaving(false)
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
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '120px 0', textAlign: 'center', maxWidth: 480, margin: '0 auto' }}>
      <p style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 600 }}>
        Cliente no encontrado
      </p>
      <p style={{ color: 'var(--text-3)', fontSize: 13, lineHeight: 1.55 }}>
        Este cliente (id <code style={{ fontFamily: 'var(--font-mono)' }}>{id}</code>) no aparece
        en tu listado de NoofitPro. Posibles causas:
        <br/>· No pertenece a tu manager.
        <br/>· La sesión NoofitPro caducó (cierra y vuelve a entrar).
        <br/>· El cliente fue eliminado.
      </p>
      <Btn onClick={() => navigate('/clientes')} variant="secondary"><ArrowLeft size={14} aria-hidden="true" /> Volver al listado</Btn>
    </div>
  )

  // NoofitPro suele devolver age=0 cuando no se rellenó al alta. Si es 0/null,
  // lo calculamos desde birthdate.
  const edad = (cliente.age && cliente.age > 0) ? cliente.age : calcEdad(cliente.birthdate)

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
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {/* Badge GRANDE de estado con fecha incrustada. Es lo que más
                    rápido se debe leer al entrar en la ficha. */}
                <BigStatusBadge cliente={cliente} bajaPendiente={bajaPendiente}
                                fechas={fechasCliente} />
                {/* Botón trazabilidad: historial completo (altas/bajas + cambios) */}
                <Btn size="sm" variant="secondary" onClick={() => setTrazaOpen(true)}
                     title="Ver historial completo de altas, bajas y cambios">
                  <History size={13} aria-hidden="true" /> Trazabilidad
                </Btn>
                {cliente.nivelConocimiento != null && <Badge color="blue">Nivel {cliente.nivelConocimiento}</Badge>}
                {/* Badge "Usuario web": visible si existe un usuario_web ACTIVO
                    asociado al email del cliente. Si el manager desactiva al
                    usuario desde Configuración → Usuarios web, este badge
                    desaparece al volver a la ficha (ver `refreshUsuarioWeb`
                    en focus). Tooltip con perfil + nº centros. */}
                {usuarioWebAsociado && (
                  <Badge color="purple"
                         title={`Perfil: ${usuarioWebAsociado.perfil_nombre || '—'} · Centros: ${(usuarioWebAsociado.id_trainers || []).length}`}>
                    <UserCog size={10} aria-hidden="true" /> Usuario web
                  </Badge>
                )}
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

            {/* Junio 2026 — sustituye al bloque "Objetivo" (estaba casi siempre
                vacío). Mostramos la última nota del cliente, con fecha y
                autor. Si no hay notas, mostramos el objetivo como fallback. */}
            {ultimaNota ? (
              <div style={{ marginTop: 24, padding: '16px 20px', borderRadius: 14,
                            background: 'var(--bg-3)' }}>
                <div style={{ display: 'flex', alignItems: 'center',
                              justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                    Última nota
                    {ultimaNota.estado && ultimaNota.estado !== 'abierta' && (
                      <span style={{ marginLeft: 6, color: 'var(--amber)' }}>
                        · {ultimaNota.estado}
                      </span>
                    )}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                    {ultimaNota.created_by_label || 'Sistema'}
                    {ultimaNota.created_at && (() => {
                      try {
                        const d = new Date(ultimaNota.created_at)
                        if (isNaN(d.getTime())) return ''
                        return ' · ' + d.toLocaleDateString('es-ES')
                      } catch { return '' }
                    })()}
                  </span>
                </div>
                <p style={{ fontSize: 14, color: 'var(--text-0)', marginTop: 4,
                            lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>
                  {ultimaNota.contenido && ultimaNota.contenido.length > 280
                    ? ultimaNota.contenido.slice(0, 280) + '…'
                    : (ultimaNota.contenido || '')}
                </p>
              </div>
            ) : !ultimaNotaLoading && cliente.objective ? (
              <div style={{ marginTop: 24, padding: '16px 20px', borderRadius: 14, background: 'var(--bg-3)' }}>
                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Objetivo</span>
                <p style={{ fontSize: 14, color: 'var(--text-0)', marginTop: 4 }}>{cliente.objective}</p>
              </div>
            ) : null}
          </div>
        </div>

        {/* Actions — fila compacta. Usamos size="sm" + nowrap para que quepan
            todos en una sola línea en pantallas ≥1100px. En móvil / panel
            estrecho cae a wrap (gap más pequeño). */}
        <div className="cliente-actions-row" style={{
          display: 'flex', flexWrap: 'wrap', gap: 8,
          marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--line)',
        }}>
          {/* QR de la ficha: solo si modo Alta de cliente del trainer es
              'individual' o 'ambos' (configurado en Configuración → Alta
              de cliente). */}
          {mostrarQrFicha && (
            <Btn variant="secondary" size="sm" onClick={() => setQrOpen(true)}>
              <QrCode size={13} aria-hidden="true" /> Mostrar QR
            </Btn>
          )}
          <InformesEstadoFisicoButton cliente={cliente} />
          <CompeticionesClienteButton cliente={cliente} />
          {/* "Atender": vuelve a disparar el wizard AltaClienteModal para
              que el operador pueda corregir un alta mal hecha (categoría /
              cuota / descuento equivocado, etc.). Sólo si el manager tiene
              Odoo desplegado — sin Odoo el wizard no aplica. */}
          {hasOdoo && (
            <Btn variant="secondary" size="sm" onClick={() => setAtenderOpen(true)}
                 disabled={!!actionLoading}
                 title="Re-procesar al cliente con el wizard de alta (por si el alta anterior fue incorrecta)">
              <Zap size={13} aria-hidden="true" /> Atender
            </Btn>
          )}
          {/* "Generar recibo": emite un recibo manual puntual (cobro extra,
              recibo retroactivo, cobro en efectivo del día, etc.) sin esperar
              al cron mensual ni al wizard trimestral. Sólo si hay Odoo. */}
          {hasOdoo && canCrearRecibo && (
            <Btn variant="secondary" size="sm" onClick={() => setGenerarReciboOpen(true)}
                 disabled={!!actionLoading}
                 title="Emitir un recibo manual para este cliente">
              <Receipt size={13} aria-hidden="true" /> Generar recibo
            </Btn>
          )}
          {/* "Crear usuario web": SOLO si el cliente tiene categoría
              Trabajador y NO existe ya un usuario_web activo con su email.
              Si ya existe, mostramos en su lugar un botón "Gestionar" que
              lleva a Configuración → Usuarios web filtrado por su email
              (deep-link). */}
          {esTrabajador && !usuarioWebAsociado && canCrearUw && (
            <Btn variant="secondary" size="sm" onClick={() => setCrearUwOpen(true)}
                 disabled={!!actionLoading || !cliente.email}
                 title={cliente.email
                   ? 'Dar acceso web a este trabajador (email + contraseña propia)'
                   : 'El cliente no tiene email registrado — añádelo antes'}>
              <UserCog size={13} aria-hidden="true" /> Crear usuario web
            </Btn>
          )}
          {esTrabajador && usuarioWebAsociado && (
            <Btn variant="secondary" size="sm"
                 onClick={() => navigate(`/configuracion?tab=usuarios-web&email=${encodeURIComponent(cliente.email)}`)}
                 title="Gestionar este usuario web en Configuración → Usuarios web">
              <UserCog size={13} aria-hidden="true" /> Gestionar usuario web
            </Btn>
          )}
          {canArchivar && (
            <Btn variant="secondary" size="sm" onClick={handleArchivar} disabled={!!actionLoading}>
              {actionLoading === 'archivar'
                ? <Loader2 size={13} className="animate-spin" aria-hidden="true" />
                : <Archive size={13} aria-hidden="true" />}
              {cliente.enabled === false
                ? ' Reactivar'
                : bajaPendiente
                  ? ' Cancelar baja prog.'
                  : ' Inactivar'}
            </Btn>
          )}
          {/* Inactividad temporal (pausa con fecha de inicio/fin). Reusa el
              mismo permiso que la baja programada (clientes.archivar). */}
          {canArchivar && (
            <Btn variant="secondary" size="sm"
                 onClick={() => pausaActiva ? setConfirmCancelarPausa(true) : abrirPausaModal()}
                 disabled={!!actionLoading}
                 title={pausaActiva
                   ? 'Cancelar/terminar la pausa activa de este cliente'
                   : 'Pausar temporalmente al cliente entre dos fechas'}>
              {actionLoading === 'pausa'
                ? <Loader2 size={13} className="animate-spin" aria-hidden="true" />
                : <PauseCircle size={13} aria-hidden="true" />}
              {pausaActiva ? ' Cancelar pausa' : ' Inactividad temporal'}
            </Btn>
          )}
          <Btn variant="danger" size="sm" onClick={() => setConfirmDesvincular(true)} disabled={!!actionLoading}>
            {actionLoading === 'desvincular'
              ? <Loader2 size={13} className="animate-spin" aria-hidden="true" />
              : <UserX size={13} aria-hidden="true" />}
            {' Desvincular'}
          </Btn>
        </div>
      </Card>

      {/* Banner rojo de impagados — aparece JUSTO bajo la hero card si hay
          1+ recibos en estado impagado/devuelto. Click navega a tab Recibos. */}
      <ImpagadoBanner recibos={recibosImpagados} onClick={() => setTab('cuotas')} />

      {/* Banner ámbar de pausa (inactividad temporal) activa. */}
      {pausaActiva && (
        <div role="status" style={{
          margin: '0 0 16px', padding: '14px 18px', borderRadius: 14,
          background: 'rgba(251,191,36,0.10)',
          border: '1.5px solid rgba(251,191,36,0.4)',
          display: 'flex', alignItems: 'center', gap: 10,
          fontSize: 13, color: 'var(--text-1)', lineHeight: 1.5,
        }}>
          <PauseCircle size={16} aria-hidden="true" style={{ color: 'var(--amber, #d97706)', flexShrink: 0 }} />
          <span>
            <strong style={{ color: 'var(--amber, #d97706)' }}>
              Inactividad temporal {pausaActiva.estado === 'en_curso' ? 'en curso' : 'programada'}
            </strong>
            {' · '}{MOTIVO_PAUSA_LABEL[pausaActiva.motivo] || pausaActiva.motivo || '—'}
            {pausaActiva.motivo === 'otros' && pausaActiva.motivo_detalle
              ? ` (${pausaActiva.motivo_detalle})` : ''}
            {' · '}
            {(() => { try { return new Date(pausaActiva.fecha_inicio).toLocaleDateString('es-ES') } catch { return pausaActiva.fecha_inicio } })()}
            {' → '}
            {(() => { try { return new Date(pausaActiva.fecha_fin).toLocaleDateString('es-ES') } catch { return pausaActiva.fecha_fin } })()}
          </span>
          {canEditarPausa && (
            <button onClick={abrirEditFin}
                    title="Modificar fecha fin de la inactividad"
                    style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5,
                             background: 'none', border: '1px solid rgba(251,191,36,0.5)', borderRadius: 8,
                             padding: '5px 10px', cursor: 'pointer', color: 'var(--amber, #d97706)',
                             fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}>
              <Pencil size={12} aria-hidden="true" /> Editar fecha
            </button>
          )}
        </div>
      )}

      {editFinOpen && (
        <div role="dialog" aria-modal="true"
             onMouseDown={e => { if (e.target === e.currentTarget && !editFinSaving) setEditFinOpen(false) }}
             style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.55)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={e => e.stopPropagation()}
               style={{ background: 'var(--bg-1)', borderRadius: 14, width: '100%', maxWidth: 440,
                        border: '1px solid var(--line)', boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
                        color: 'var(--text-0)' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line)' }}>
              <strong style={{ fontSize: 15 }}>Modificar inactividad temporal</strong>
              <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 4, lineHeight: 1.5 }}>
                {pausaActiva?.estado === 'en_curso'
                  ? 'La pausa ya empezó: solo puedes cambiar la fecha fin.'
                  : 'Ajusta las fechas de la pausa programada.'}
                {' '}Ampliar la ventana anula los recibos sin pagar de los meses nuevos.
              </div>
            </div>
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {pausaActiva?.estado === 'programada' && (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-3)' }}>
                  Fecha inicio
                  <input type="date" value={editInicioValue}
                         onChange={e => setEditInicioValue(e.target.value)}
                         style={{ padding: 8, borderRadius: 8, fontSize: 13, background: 'var(--bg-2)',
                                  border: '1px solid var(--line)', color: 'var(--text-0)' }} />
                </label>
              )}
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-3)' }}>
                Fecha fin
                <input type="date" value={editFinValue}
                       min={pausaActiva?.estado === 'programada' ? editInicioValue : (pausaActiva?.fecha_inicio || '').slice(0, 10)}
                       onChange={e => setEditFinValue(e.target.value)}
                       style={{ padding: 8, borderRadius: 8, fontSize: 13, background: 'var(--bg-2)',
                                border: '1px solid var(--line)', color: 'var(--text-0)' }} />
              </label>
            </div>
            <div style={{ padding: '12px 20px', borderTop: '1px solid var(--line)',
                          display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Btn variant="secondary" onClick={() => setEditFinOpen(false)} disabled={editFinSaving}>
                Cancelar
              </Btn>
              <Btn variant="primary" onClick={doEditarFin} disabled={editFinSaving}>
                {editFinSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                {' '}Guardar
              </Btn>
            </div>
          </div>
        </div>
      )}

      {/* Tabs. La pestaña "Recibos" depende de Odoo (lee `cuotas/cliente/<id>`
          que toca account.move). Sin Odoo desplegado la ocultamos del
          listado para no exponer un botón que terminaría en 500. */}
      <div role="tablist" aria-label="Secciones del cliente"
           style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, marginBottom: 24 }}>
        {tabs.filter(t => t.id !== 'cuotas' || hasOdoo).map(({ id: tid, label, icon: Icon }) => (
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

      {tab === 'personal'        && <TabPersonal cliente={cliente} onClienteUpdate={setCliente} />}
      {tab === 'notas'           && <ClienteNotasTab cliente={cliente} />}
      {tab === 'clases'          && <TabClases clienteId={cliente.id} />}
      {tab === 'analisis'        && <TabAnalisis cliente={cliente} />}
      {tab === 'cuotas'          && hasOdoo && <TabCuotas cliente={cliente} />}
      {tab === 'compras'         && <TabComprasTPV cliente={cliente} />}
      {tab === 'notificaciones'  && <TabNotificaciones cliente={cliente} />}
      {/* Compatibilidad: enlaces antiguos ?tab=erp → redirigen a personal */}
      {tab === 'erp'             && <TabPersonal cliente={cliente} onClienteUpdate={setCliente} />}

      {/* Dialogs */}
      {atenderOpen && (
        <AltaClienteModal
          cliente={cliente}
          onClose={() => setAtenderOpen(false)}
          onSaved={() => { setAtenderOpen(false); toast.success('Cliente atendido correctamente') }}
        />
      )}
      {generarReciboOpen && (
        <GenerarReciboModal
          cliente={cliente}
          onClose={() => setGenerarReciboOpen(false)}
          onSaved={() => setGenerarReciboOpen(false)}
        />
      )}
      {crearUwOpen && (
        <CrearUsuarioWebDesdeClienteModal
          cliente={cliente}
          onClose={() => setCrearUwOpen(false)}
          onSaved={() => { setCrearUwOpen(false); refreshUsuarioWeb() }}
        />
      )}
      {trazaOpen && (
        <TrazabilidadModal cliente={cliente} onClose={() => setTrazaOpen(false)} />
      )}
      <ConfirmDialog
        open={confirmArchivar}
        title="Reactivar cliente"
        message={`¿Quieres reactivar a ${cliente.name} ${cliente.surname}?`}
        confirmText="Reactivar"
        variant="primary"
        onConfirm={() => doArchivar(null)}
        onCancel={() => setConfirmArchivar(false)}
      />
      {/* Desvincular: doble confirmación tipo "type to confirm". El usuario
          debe tipear DESVINCULAR (sin acentos, case-insensitive) para que
          el botón rojo se habilite. Acción irreversible. */}
      <Modal open={confirmDesvincular}
             onClose={() => { setConfirmDesvincular(false); setDesvincularConfirmText('') }}
             title="Desvincular cliente — acción irreversible"
             subtitle={`${cliente.name} ${cliente.surname}`} maxWidth={480}>
        <div style={{ padding: '28px 32px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{
            padding: '16px 18px', borderRadius: 14,
            background: 'rgba(248,113,133,0.10)',
            border: '1.5px solid rgba(248,113,133,0.5)',
            fontSize: 13, color: 'var(--text-1)', lineHeight: 1.6,
          }}>
            <strong style={{ color: 'var(--red, #f87185)', display: 'block', marginBottom: 6 }}>
              ⚠ Esta acción NO se puede deshacer
            </strong>
            Vas a desvincular a <strong>{cliente.name} {cliente.surname}</strong> de
            la cuenta del trainer. El cliente desaparecerá del listado, pero los
            recibos históricos se conservan por trazabilidad contable.
            <br/><br/>
            Si solo quieres pausar al cliente, mejor usa <strong>Inactivar</strong>
            {' '}(reversible).
          </div>
          <div>
            <label htmlFor="desvincular-confirm" style={{
              display: 'block', fontSize: 13, color: 'var(--text-2)', marginBottom: 8,
            }}>
              Para confirmar, escribe <code style={{
                background: 'var(--bg-2)', padding: '2px 6px', borderRadius: 4,
                fontFamily: 'var(--font-mono, monospace)', color: 'var(--red)',
              }}>DESVINCULAR</code> abajo:
            </label>
            <input id="desvincular-confirm" type="text" autoComplete="off"
                   value={desvincularConfirmText}
                   onChange={e => setDesvincularConfirmText(e.target.value)}
                   placeholder="DESVINCULAR"
                   style={{
                     width: '100%', padding: '14px 18px', borderRadius: 14, fontSize: 14,
                     background: 'var(--bg-1)',
                     border: `1.5px solid ${desvincularConfirmText.trim().toUpperCase() === 'DESVINCULAR'
                       ? 'var(--green)' : 'var(--line)'}`,
                     color: 'var(--text-0)', fontFamily: 'var(--font-mono, monospace)',
                     letterSpacing: '0.05em',
                   }} />
          </div>
        </div>
        <div style={{ padding: '20px 32px', borderTop: '1px solid var(--line)',
                      display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Btn variant="secondary" size="md"
               onClick={() => { setConfirmDesvincular(false); setDesvincularConfirmText('') }}
               disabled={!!actionLoading}>Cancelar</Btn>
          <Btn variant="danger" size="md"
               onClick={() => { doDesvincular(); setDesvincularConfirmText('') }}
               disabled={desvincularConfirmText.trim().toUpperCase() !== 'DESVINCULAR' || !!actionLoading}>
            {actionLoading === 'desvincular'
              ? <Loader2 size={14} className="animate-spin" />
              : <UserX size={14} aria-hidden="true" />}
            {' Sí, desvincular definitivamente'}
          </Btn>
        </div>
      </Modal>
      <Modal open={qrOpen} onClose={() => setQrOpen(false)} title="QR del cliente">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: 4 }}>
          <p style={{ fontSize: 13, color: 'var(--text-2)', textAlign: 'center', maxWidth: 360, lineHeight: 1.5 }}>
            Para que <strong style={{ color: 'var(--text-0)' }}>{cliente.name} {cliente.surname}</strong> se vincule
            a su cuenta en <strong style={{ color: 'var(--text-1)' }}>mynoofit</strong>, escanea este QR desde la app.
          </p>
          <div style={{
            background: '#fff', borderRadius: 14, padding: 18,
            display: 'flex', justifyContent: 'center',
          }}>
            {/* Formato confirmado NoofitPro: "TRAINERLINK;<idCliente>" sin
                cifrado para cedeDatos=true (caso defecto). */}
            <QRCodeSVG
              value={`TRAINERLINK;${cliente.id}`}
              size={320}
              level="M"
              includeMargin={false}
              style={{ display: 'block' }}
            />
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px',
            borderRadius: 10, background: 'var(--bg-3)', border: '1px solid var(--line)',
            fontSize: 12, color: 'var(--text-3)', fontFamily: 'monospace',
          }}>
            TRAINERLINK;<strong style={{ color: 'var(--text-1)' }}>{cliente.id}</strong>
          </div>
          <Btn variant="secondary" size="md" onClick={() => setQrOpen(false)}>Cerrar</Btn>
        </div>
      </Modal>

      <Modal open={motivoModal} onClose={() => setMotivoModal(false)}
             title={inactivarStep === 1 ? 'Inactivar cliente' : 'Confirmar inactivación'}
             subtitle={`${cliente.name} ${cliente.surname}`} maxWidth={480}>
        {inactivarStep === 1 ? (
          // ── Paso 1: formulario (fecha + motivo) ────────────────────
          <>
            <div style={{ padding: '28px 32px', display:'flex', flexDirection:'column', gap:18 }}>
              <div>
                <label htmlFor="fecha-baja" style={{ display: 'block', fontSize: 13, color: 'var(--text-2)', marginBottom: 8 }}>
                  Fecha de inicio de inactividad *
                </label>
                <input id="fecha-baja" type="date" value={fechaBaja}
                       onChange={e => setFechaBaja(e.target.value)}
                       style={{
                         width: '100%', padding: '14px 18px', borderRadius: 14, fontSize: 14,
                         background: 'var(--bg-1)', border: '1px solid var(--line)', color: 'var(--text-0)',
                       }} />
                <p style={{ fontSize:12, color:'var(--text-3)', marginTop:6, lineHeight:1.5 }}>
                  {(() => {
                    const today = new Date().toISOString().slice(0,10)
                    if (!fechaBaja) return null
                    if (fechaBaja < today) return '⚠️ Fecha en el pasado: el cliente se marca inactivo AHORA y si ya hay recibo del mes con día 1 ≥ fecha, deberás anularlo a mano.'
                    if (fechaBaja === today) return 'El cliente se marca inactivo ahora mismo.'
                    return `Hasta el ${new Date(fechaBaja).toLocaleDateString('es-ES')} el cliente puede seguir reservando con normalidad. El día indicado, el sistema lo desactiva automáticamente.`
                  })()}
                </p>
              </div>
              <div>
                <label htmlFor="motivo-archivado" style={{ display: 'block', fontSize: 13, color: 'var(--text-2)', marginBottom: 8 }}>
                  Motivo (opcional)
                </label>
                <input id="motivo-archivado" type="text" value={motivo} onChange={e => setMotivo(e.target.value)}
                       placeholder="Ej: Baja voluntaria, cambio de centro..."
                       className="form-input"
                       style={{
                         width: '100%', padding: '14px 18px', borderRadius: 14, fontSize: 14,
                         background: 'var(--bg-1)', border: '1px solid var(--line)', color: 'var(--text-0)',
                       }} />
              </div>
            </div>
            <div style={{ padding: '20px 32px', borderTop: '1px solid var(--line)', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <Btn variant="secondary" size="md" onClick={() => setMotivoModal(false)}>Cancelar</Btn>
              {/* Paso 1 → Continuar (pasa a la pantalla de confirmación) */}
              <Btn variant="primary" size="md"
                   onClick={() => setInactivarStep(2)}
                   disabled={!fechaBaja || !!actionLoading}>
                Continuar
              </Btn>
            </div>
          </>
        ) : (
          // ── Paso 2: doble confirmación con checkbox + resumen ─────
          <>
            <div style={{ padding: '28px 32px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{
                padding: '16px 18px', borderRadius: 14,
                background: 'rgba(251,191,36,0.10)',
                border: '1.5px solid rgba(251,191,36,0.4)',
                fontSize: 13, color: 'var(--text-1)', lineHeight: 1.6,
              }}>
                <strong style={{ color: 'var(--amber, #d97706)', display: 'block', marginBottom: 6 }}>
                  ⚠ Vas a inactivar a este cliente
                </strong>
                Confirma los datos antes de continuar:
                <ul style={{ margin: '10px 0 0 18px', padding: 0 }}>
                  <li><strong>Cliente:</strong> {cliente.name} {cliente.surname}</li>
                  <li><strong>Fecha de baja:</strong> {new Date(fechaBaja).toLocaleDateString('es-ES')}</li>
                  {motivo && <li><strong>Motivo:</strong> {motivo}</li>}
                </ul>
              </div>
              <label style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                padding: 12, borderRadius: 10,
                background: 'var(--bg-2)', cursor: 'pointer', fontSize: 13,
              }}>
                <input type="checkbox" checked={inactivarConfirmCheck}
                       onChange={e => setInactivarConfirmCheck(e.target.checked)}
                       style={{ marginTop: 2, flexShrink: 0 }} />
                <span style={{ color: 'var(--text-1)', lineHeight: 1.5 }}>
                  Entiendo que el cliente <strong>no recibirá recibos a partir
                  del día indicado</strong> y que sus cuotas activas se
                  cancelarán en esa fecha. Confirmo que quiero proceder.
                </span>
              </label>
            </div>
            <div style={{ padding: '20px 32px', borderTop: '1px solid var(--line)', display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center' }}>
              <Btn variant="secondary" size="md" onClick={() => setInactivarStep(1)}
                   disabled={!!actionLoading}>
                ← Volver
              </Btn>
              <div style={{ display: 'flex', gap: 10 }}>
                <Btn variant="secondary" size="md" onClick={() => setMotivoModal(false)}
                     disabled={!!actionLoading}>Cancelar</Btn>
                {canProgramarBaja && (
                  <Btn variant="danger" size="md" onClick={doProgramarBaja}
                       disabled={!inactivarConfirmCheck || !!actionLoading}>
                    {actionLoading === 'archivar'
                      ? <Loader2 size={14} className="animate-spin" />
                      : <Archive size={14} aria-hidden="true" />}
                    {' Sí, inactivar'}
                  </Btn>
                )}
              </div>
            </div>
          </>
        )}
      </Modal>

      <ConfirmDialog
        open={confirmCancelarBaja && canCancelarBajaProg}
        title="Cancelar baja programada"
        message={bajaPendiente
          ? `¿Cancelar la baja programada para el ${new Date(bajaPendiente.fecha_baja).toLocaleDateString('es-ES')}? El cliente permanecerá activo.`
          : ''}
        confirmText="Cancelar baja"
        variant="primary"
        onConfirm={doCancelarBaja}
        onCancel={() => setConfirmCancelarBaja(false)}
      />

      {/* ── Modal: inactividad temporal (pausa) ──────────────────────── */}
      <Modal open={pausaModal} onClose={() => setPausaModal(false)}
             title="Inactividad temporal"
             subtitle={cliente ? `${cliente.name} ${cliente.surname}` : ''} maxWidth={480}>
        <div style={{ padding: '28px 32px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="pausa-inicio" style={{ display: 'block', fontSize: 13, color: 'var(--text-2)', marginBottom: 8 }}>
                Fecha de inicio *
              </label>
              <input id="pausa-inicio" type="date" value={pausaInicio}
                     onChange={e => setPausaInicio(e.target.value)}
                     style={{
                       width: '100%', padding: '14px 18px', borderRadius: 14, fontSize: 14,
                       background: 'var(--bg-1)', border: '1px solid var(--line)', color: 'var(--text-0)',
                     }} />
            </div>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="pausa-fin" style={{ display: 'block', fontSize: 13, color: 'var(--text-2)', marginBottom: 8 }}>
                Fecha de fin *
              </label>
              <input id="pausa-fin" type="date" value={pausaFin} min={pausaInicio || undefined}
                     onChange={e => setPausaFin(e.target.value)}
                     style={{
                       width: '100%', padding: '14px 18px', borderRadius: 14, fontSize: 14,
                       background: 'var(--bg-1)', border: '1px solid var(--line)', color: 'var(--text-0)',
                     }} />
            </div>
          </div>
          {pausaInicio && pausaFin && pausaFin < pausaInicio && (
            <p style={{ fontSize: 12, color: 'var(--red)', marginTop: -8 }}>
              La fecha de fin debe ser igual o posterior al inicio.
            </p>
          )}
          <div>
            <label htmlFor="pausa-motivo" style={{ display: 'block', fontSize: 13, color: 'var(--text-2)', marginBottom: 8 }}>
              Motivo *
            </label>
            <select id="pausa-motivo" value={pausaMotivo}
                    onChange={e => setPausaMotivo(e.target.value)}
                    style={{
                      width: '100%', padding: '14px 18px', borderRadius: 14, fontSize: 14,
                      background: 'var(--bg-1)', border: '1px solid var(--line)', color: 'var(--text-0)',
                    }}>
              <option value="">— Elige un motivo —</option>
              {MOTIVOS_PAUSA.map(([k, l]) => (
                <option key={k} value={k}>{l}</option>
              ))}
            </select>
          </div>
          {pausaMotivo === 'otros' && (
            <div>
              <label htmlFor="pausa-detalle" style={{ display: 'block', fontSize: 13, color: 'var(--text-2)', marginBottom: 8 }}>
                Detalle del motivo
              </label>
              <input id="pausa-detalle" type="text" value={pausaDetalle}
                     onChange={e => setPausaDetalle(e.target.value)}
                     placeholder="Especifica el motivo..."
                     className="form-input"
                     style={{
                       width: '100%', padding: '14px 18px', borderRadius: 14, fontSize: 14,
                       background: 'var(--bg-1)', border: '1px solid var(--line)', color: 'var(--text-0)',
                     }} />
            </div>
          )}
          <p style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5 }}>
            Si la fecha de inicio es hoy o anterior, el cliente se marca inactivo
            de inmediato y los recibos sin pagar del periodo se anulan. Al llegar
            la fecha de fin se reactiva automáticamente.
          </p>
        </div>
        <div style={{ padding: '20px 32px', borderTop: '1px solid var(--line)', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Btn variant="secondary" size="md" onClick={() => setPausaModal(false)}
               disabled={!!actionLoading}>Cancelar</Btn>
          {canArchivar && (
            <Btn variant="primary" size="md" onClick={doCrearPausa}
                 disabled={!pausaInicio || !pausaFin || !pausaMotivo
                   || (pausaFin < pausaInicio) || !!actionLoading}>
              {actionLoading === 'pausa'
                ? <Loader2 size={14} className="animate-spin" />
                : <PauseCircle size={14} aria-hidden="true" />}
              {' Crear pausa'}
            </Btn>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmCancelarPausa && canArchivar}
        title="Cancelar pausa"
        message={pausaActiva
          ? (pausaActiva.estado === 'en_curso'
              ? `¿Terminar la pausa en curso? El cliente se reactivará de inmediato.`
              : `¿Cancelar la pausa programada (${(() => { try { return new Date(pausaActiva.fecha_inicio).toLocaleDateString('es-ES') } catch { return '' } })()} → ${(() => { try { return new Date(pausaActiva.fecha_fin).toLocaleDateString('es-ES') } catch { return '' } })()})?`)
          : ''}
        confirmText="Cancelar pausa"
        variant="primary"
        onConfirm={doCancelarPausa}
        onCancel={() => setConfirmCancelarPausa(false)}
      />
    </div>
  )
}

// ── Tab: Datos personales ──────────────────────────────────────────────────────
// Cache de autorización (10 min) — evita reintroducir contraseña por cada edición
const EDIT_AUTH_TTL_MS = 10 * 60 * 1000
const EDIT_AUTH_KEY = 'round.editAuth.until'

function isEditAuthValid() {
  try {
    const until = Number(localStorage.getItem(EDIT_AUTH_KEY) || 0)
    return until > Date.now()
  } catch { return false }
}

function setEditAuth() {
  try { localStorage.setItem(EDIT_AUTH_KEY, String(Date.now() + EDIT_AUTH_TTL_MS)) }
  catch { /* ignore */ }
}

function TabPersonal({ cliente, onClienteUpdate }) {
  const toast = useToast()
  const { user } = useAuth()
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState(null)
  const [saving, setSaving] = useState(false)
  // hasOdoo se usa para ocultar cards que dependen de Odoo desplegado
  // (Cuotas, Descuentos, Modificaciones, Familiares). Tiene que estar
  // en este scope porque `TabPersonal` es función a nivel de módulo,
  // no anidada en ClientProfile.
  const { odooEnabled: hasOdoo } = useOdooStatus()

  // Categoría: la guardamos en NUESTRA BD, no en NoofitPro
  const { categorias, getCategoria, setCategoria } = useCategoriasMap()
  const catActual = cliente ? getCategoria(cliente) : null
  const catActualId = catActual ? catActual.id : null

  const startEdit = () => {
    setEditForm({ ...cliente, categoriaId: catActualId })
    setEditing(true)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      // Categoría se guarda separadamente en nuestra BD
      const newCategoriaId = editForm.categoriaId ?? null
      if (newCategoriaId !== catActualId) {
        try { await setCategoria(cliente.id, newCategoriaId) }
        catch (e) { console.warn('categoria save:', e.message) }
      }
      // El resto de campos sí van a NoofitPro (sin categoriaId que lo descarta).
      // `postClientes` hace POST a /api/dispositivos/clientePlusv2 → actualiza
      // los datos del cliente en NoofitPro (BD del SaaS).
      const { categoriaId: _cat, ...payload } = editForm
      await postClientes([payload])
      onClienteUpdate({ ...editForm })
      setEditing(false)
      setEditForm(null)
      toast.success('Datos actualizados en NoofitPro')

      // Sync automático NoofitPro → Odoo (sin bloquear si falla — Odoo puede
      // no estar desplegado, el SaaS de Odoo puede estar caído, etc.).
      try {
        const { syncClienteOdoo, getRoundIdentity } = await import('../../utils/configApi')
        const identity = getRoundIdentity(user)
        const r = await syncClienteOdoo(identity, cliente.id)
        if (r?.ok) toast.success('Datos sincronizados con Odoo')
      } catch (e) { console.warn('sync odoo:', e?.message) }
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

  // Editor sin barrera de contraseña: el botón "Editar" entra directamente
  // en modo edición. "Guardar" persiste en NoofitPro (postClientes →
  // /api/dispositivos/clientePlusv2) y luego sincroniza a Odoo si está
  // desplegado. Antes había un prompt de contraseña ERP_PASSWORD que se
  // quitó en mayo 2026 — la auditoría queda en `accion_log` igualmente.
  const editAction = editing ? (
    <div style={{ display: 'flex', gap: 8 }}>
      <Btn variant="primary" size="sm" onClick={handleSave} disabled={saving}>
        {saving ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />}
        {' Guardar cambios'}
      </Btn>
      <Btn variant="secondary" size="sm" onClick={handleCancel} disabled={saving}>
        <XCircle size={14} aria-hidden="true" /> Cancelar
      </Btn>
    </div>
  ) : (
    <Btn variant="secondary" size="sm" onClick={startEdit}>
      <Pencil size={14} aria-hidden="true" /> Editar
    </Btn>
  )

  const ep = editing ? { editing, editForm, setEditForm } : {}

  return (
    <div role="tabpanel" aria-label="Datos personales">

      {/* Orden de importancia (mayo 2026):
            1. Cuota + Forma de pago      ← lo que se consulta primero
            2. Descuentos
            3. Modificaciones
            4. Categoría + fechas        \
            5. Familiares                / juntos (lado a lado)
            6. Datos personales (contacto)
          Es el orden visual al entrar en la ficha. */}
      <div style={{ display: 'grid',
                     gridTemplateColumns: 'repeat(auto-fit, minmax(min(360px, 100%), 1fr))',
                     gap: 20 }}>

        {/* 1. CUOTA Y FORMA DE PAGO — siempre primero. Requiere Odoo. */}
        {hasOdoo && <CuotasClienteCard cliente={cliente} />}

        {/* 2. DESCUENTOS + 3. MODIFICACIONES — apilados en una columna. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {hasOdoo && <DescuentosClienteCard cliente={cliente} />}
          {hasOdoo && <ModificacionesClienteCard cliente={cliente} />}
        </div>

        {/* 4. CATEGORÍA + FECHAS — celda propia del grid. */}
        <CategoriaYFechasCard cliente={cliente} />

        {/* 5. FAMILIARES — celda propia del grid, fluye al lado de Categoría
            por el auto-fit minmax(360px). */}
        {hasOdoo && <FamiliaresClienteCard cliente={cliente} />}

        {/* 5. DATOS PERSONALES — contacto, DNI, dirección. Editable con auth. */}
        <Card style={{ padding: 24 }}>
          <SectionTitle action={editAction}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <User size={16} aria-hidden="true" /> Datos personales
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
            <CategoriaField label="Categoría" categorias={categorias} valueId={catActualId} editing={editing} editForm={editForm} setEditForm={setEditForm} />
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
            {cliente.motivoArchivado && <Field label="Motivo inactivo" value={cliente.motivoArchivado} />}
          </dl>
        </Card>

      </div>
    </div>
  )
}

// ── Tab: Notificaciones recibidas por el cliente ──────────────────────────
function TabNotificaciones({ cliente }) {
  const { user } = useAuth()
  const identity = (() => { try { return getRoundIdentity(user) } catch { return null } })()
  const toast = useToast()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [filtros, setFiltros] = useState({ seccion: '', tipo: '' })
  const [modalNuevo, setModalNuevo] = useState(false)

  async function reload() {
    if (!identity?.managerId) return
    setLoading(true)
    try {
      const list = await notifPorCliente(identity, cliente.id, filtros)
      setItems(list)
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setLoading(false)
  }
  useEffect(() => { reload() /* eslint-disable-next-line */ }, [cliente?.id, filtros.seccion, filtros.tipo])

  const fmt = (iso) => {
    if (!iso) return '—'
    try { return new Date(iso).toLocaleString('es-ES', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) }
    catch { return '—' }
  }

  return (
    <div role="tabpanel" aria-label="Notificaciones del cliente">
      <Card style={{ padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
          <SectionTitle>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Bell size={16} aria-hidden="true" /> Notificaciones recibidas
            </span>
          </SectionTitle>
          {canNotificar && (
            <Btn variant="primary" size="sm" onClick={() => setModalNuevo(true)}>
              <Send size={13} /> Notificar
            </Btn>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          <select value={filtros.seccion}
                  onChange={e => setFiltros(f => ({ ...f, seccion: e.target.value, tipo: '' }))}
                  style={selStyle} aria-label="Sección">
            <option value="">Todas las secciones</option>
            {NOTIF_SECCIONES.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
          <select value={filtros.tipo}
                  onChange={e => setFiltros(f => ({ ...f, tipo: e.target.value }))}
                  style={selStyle} aria-label="Tipo">
            <option value="">Todos los tipos</option>
            {(filtros.seccion ? tiposDeSeccion(filtros.seccion) : NOTIF_TIPOS)
              .map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </select>
        </div>

        {loading ? (
          <div style={{ display:'flex', justifyContent:'center', padding: 40 }}>
            <Loader2 size={20} className="animate-spin" style={{ color: 'var(--green)' }} />
          </div>
        ) : items.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-3)', textAlign: 'center', padding: 30 }}>
            Sin notificaciones para este cliente.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map(n => (
              <div key={n.destinatario_id} style={{
                padding: 12, borderRadius: 10, border: '1px solid var(--line)', background: 'var(--bg-1)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Badge color={NOTIF_SECCIONES.find(s => s.id === n.seccion)?.color || 'gray'}>
                      {NOTIF_SECCIONES.find(s => s.id === n.seccion)?.nombre || n.seccion}
                    </Badge>
                    <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                      {NOTIF_TIPOS.find(t => t.id === n.tipo)?.nombre || n.tipo}
                    </span>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{fmt(n.fecha_envio || n.created_at)}</span>
                </div>
                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-0)' }}>{n.titulo}</p>
                {n.cuerpo && (
                  <p style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4 }}>{n.cuerpo}</p>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                    Origen: {n.origen}{n.origen_ref ? ` · ${n.origen_ref}` : ''}
                  </span>
                  {n.leida ? (
                    <Badge color="green">Leída · {fmt(n.fecha_lectura)}</Badge>
                  ) : (
                    <Badge color="gray">No leída</Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {modalNuevo && (
        <NotifNuevoModal cliente={cliente} identity={identity}
                         onClose={() => setModalNuevo(false)}
                         onCreated={() => { setModalNuevo(false); reload() }} />
      )}
    </div>
  )
}


function NotifNuevoModal({ cliente, identity, onClose, onCreated }) {
  const toast = useToast()
  const [form, setForm] = useState({ seccion: 'cobros', tipo: '', titulo: '', cuerpo: '' })
  const [saving, setSaving] = useState(false)
  const overlayClose = useOverlayClose(onClose)
  const tipos = tiposDeSeccion(form.seccion)
  useEffect(() => {
    if (!tipos.find(t => t.id === form.tipo)) setForm(f => ({ ...f, tipo: tipos[0]?.id || '' }))
  // eslint-disable-next-line
  }, [form.seccion])

  const enviar = async () => {
    if (!form.titulo) { toast.error('Título obligatorio'); return }
    setSaving(true)
    try {
      const r = await notifEnvioCreate(identity, {
        seccion: form.seccion, tipo: form.tipo,
        titulo: form.titulo, cuerpo: form.cuerpo || null,
        audience: { tipo: 'cliente', ref: cliente.id },
      })
      if (r.estado === 'fallida') toast.error(`Falló: ${r.error}`)
      else toast.success('Notificación enviada')
      onCreated()
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setSaving(false)
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 20,
    }} {...overlayClose}>
      <Card style={{ padding: 0, maxWidth: 480, width: '100%' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: 20, borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontFamily: 'Outfit', fontSize: 16, fontWeight: 700 }}>
            Notificar a {cliente.name} {cliente.surname}
          </h3>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-3)' }}><X size={14} /></button>
        </div>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <select value={form.seccion} onChange={e => setForm(f => ({ ...f, seccion: e.target.value }))} style={selStyle}>
              {NOTIF_SECCIONES.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
            <select value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))} style={selStyle}>
              {tipos.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
            </select>
          </div>
          <input value={form.titulo} onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))}
                 placeholder="Título *" style={inpStyle} />
          <textarea value={form.cuerpo} onChange={e => setForm(f => ({ ...f, cuerpo: e.target.value }))}
                    rows={3} placeholder="Mensaje" style={{ ...inpStyle, fontFamily: 'inherit' }} />
        </div>
        <div style={{ padding: 14, borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Btn variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Btn>
          <Btn variant="primary" onClick={enviar} disabled={saving}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Enviar
          </Btn>
        </div>
      </Card>
    </div>
  )
}

const selStyle = {
  padding: '8px 10px', borderRadius: 8, fontSize: 13,
  background: 'var(--bg-1)', border: '1px solid var(--line)', color: 'var(--text-0)', cursor: 'pointer',
}
const inpStyle = {
  width: '100%', padding: '8px 10px', borderRadius: 8, fontSize: 13,
  background: 'var(--bg-1)', border: '1px solid var(--line)', color: 'var(--text-0)',
}


// ── Card: Categoría + Fechas clave ─────────────────────────────────────────
function CategoriaYFechasCard({ cliente }) {
  const { user } = useAuth()
  const identity = (() => { try { return getRoundIdentity(user) } catch { return null } })()
  const { categorias, getCategoria, setCategoria } = useCategoriasMap()
  const [fechas, setFechas] = useState(null)
  const [savingCat, setSavingCat] = useState(false)
  const toast = useToast()

  useEffect(() => {
    if (!identity?.managerId || !cliente?.id) return
    let active = true
    clienteFechas(identity, cliente.id)
      .then(d => { if (active) setFechas(d) })
      .catch(() => { if (active) setFechas(null) })
    return () => { active = false }
  }, [identity?.managerId, cliente?.id])

  const catActual = getCategoria(cliente)

  const handleChange = async (e) => {
    const val = e.target.value
    const newCatId = val ? parseInt(val, 10) : null
    setSavingCat(true)
    try {
      await setCategoria(cliente.id, newCatId)
      toast.success(newCatId ? 'Categoría asignada' : 'Categoría eliminada')
    } catch (err) {
      toast.error(`Error: ${err.message}`)
    } finally {
      setSavingCat(false)
    }
  }

  const fmt = (iso) => {
    if (!iso) return '—'
    try {
      return new Date(iso).toLocaleDateString('es-ES',
        { day: 'numeric', month: 'short', year: 'numeric' })
    } catch { return '—' }
  }

  return (
    <Card style={{ padding: 24 }}>
      <SectionTitle>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Users size={16} aria-hidden="true" /> Categoría y fechas
        </span>
      </SectionTitle>
      <dl>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', gap: 12 }}>
          <dt style={{ fontSize: 13, color: 'var(--text-3)' }}>Categoría</dt>
          <dd style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-0)', flex: 1, textAlign: 'right' }}>
            <select value={catActual?.id ?? ''} onChange={handleChange} disabled={savingCat}
                    style={{
                      padding: '6px 10px', borderRadius: 8, fontSize: 13,
                      background: 'var(--bg-2)', border: '1px solid var(--line)',
                      color: 'var(--text-0)', cursor: 'pointer', minWidth: 180,
                    }}>
              <option value="">— Pagador con cuota</option>
              {categorias.map(c => (
                <option key={c.id} value={c.id} disabled={!c.activa}>
                  {c.nombre}{!c.activa ? ' (inactiva)' : ''}
                </option>
              ))}
            </select>
            {catActual && !catActual.puede_reservar && (
              <p style={{ fontSize: 11, color: 'var(--amber)', marginTop: 4 }}>
                ⚠ Esta categoría no permite reservar clases
              </p>
            )}
          </dd>
        </div>
        <Field label="Fecha primera alta"
               value={fechas?.fecha_primera_alta ? fmt(fechas.fecha_primera_alta) : '—'} />
        <Field label="Fecha alta actual"
               value={fechas?.fecha_alta_actual ? fmt(fechas.fecha_alta_actual) : '—'} />
        {cliente.enabled === false && (
          <Field label="Fecha inactivo"
                 value={fechas?.fecha_inactivo ? fmt(fechas.fecha_inactivo) : '—'} />
        )}
      </dl>
    </Card>
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
  const { user } = useAuth()
  const identity = useMemo(() => getRoundIdentity(user), [user])
  const [trainings, setTrainings] = useState(null)
  const [coAttendees, setCoAttendees] = useState(null)
  const [retosCliente, setRetosCliente] = useState(null)  // [{reto, valorAcumulado, ...}]
  const [loading, setLoading] = useState(true)
  const [loadingCo, setLoadingCo] = useState(true)
  const [error, setError] = useState('')

  // Cargar retos del cliente
  useEffect(() => {
    if (!identity?.managerId) return
    import('../../utils/configApi').then(mod => mod.retosList(identity))
      .then(arr => {
        // Filtra los retos en los que el cliente participa
        const out = []
        const idStr = String(cliente.id)
        for (const r of (arr || [])) {
          const part = (r.participantes || []).find(p =>
            String(p?.idClient || p?.clienteId) === idStr)
          if (!part) continue
          const rk = (r.rankingIndividual || []).find(x =>
            String(x?.idClient || x?.clienteId) === idStr)
          out.push({
            reto: r,
            valorAcumulado: rk?.valorAcumulado ?? part.valorAcumulado ?? 0,
            numRegistros:   rk?.numRegistros   ?? part.numRegistros   ?? 0,
            ranking:        rk?.rankingIndividual ?? null,
            activo:         part.activo,
            terminado:      Number(r.estado) === 2 || (typeof r.fechaFin === 'number' && r.fechaFin > 1e10 && r.fechaFin < Date.now()),
          })
        }
        setRetosCliente(out)
      })
      .catch(() => setRetosCliente([]))
  }, [cliente.id, identity?.managerId])

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

      {/* Retos del cliente */}
      <Card style={{ padding: 24 }}>
        <SectionTitle>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Zap size={16} aria-hidden="true" /> Retos NoofitPro
          </span>
        </SectionTitle>
        {retosCliente == null ? (
          <div style={{ padding: 20, textAlign: 'center' }}>
            <Loader2 size={18} className="animate-spin" style={{ color: 'var(--green)' }} aria-hidden="true" />
          </div>
        ) : retosCliente.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-3)', padding: '12px 0' }}>
            Este cliente no participa en ningún reto. Cuando se apunte a uno aparecerá aquí.
          </p>
        ) : (
          <>
            <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 12 }}>
              {retosCliente.length} reto{retosCliente.length !== 1 ? 's' : ''} (
              {retosCliente.filter(x => !x.terminado).length} activo{retosCliente.filter(x => !x.terminado).length !== 1 ? 's' : ''} ·{' '}
              {retosCliente.filter(x => x.terminado).length} terminado{retosCliente.filter(x => x.terminado).length !== 1 ? 's' : ''})
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {retosCliente.map(({ reto, valorAcumulado, numRegistros, ranking, activo, terminado }) => {
                const metricLabel = ({ 1: 'sesiones', 2: 'km', 3: 'min', 4: 'kcal' }[reto.tipoMetrica] || '')
                const valTxt = typeof valorAcumulado === 'number'
                  ? (Number.isInteger(valorAcumulado) ? valorAcumulado : valorAcumulado.toFixed(2))
                  : valorAcumulado
                return (
                  <div key={reto.id} style={{
                    padding: '10px 14px', borderRadius: 10,
                    background: terminado ? 'var(--bg-2)' : 'var(--green-bg)',
                    border: `1px solid ${terminado ? 'var(--line)' : 'var(--green-border)'}`,
                    opacity: !activo ? 0.6 : 1,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-0)' }}>
                        {reto.nombre}
                      </span>
                      {terminado
                        ? <Badge color="gray">Terminado</Badge>
                        : <Badge color="green">Activo</Badge>}
                      {!activo && <Badge color="red">Abandonó</Badge>}
                      {ranking != null && (
                        <Badge color={ranking <= 3 ? 'amber' : 'blue'}>
                          Puesto #{ranking}
                        </Badge>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 14, fontSize: 11.5, color: 'var(--text-2)', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, color: 'var(--text-0)' }}>
                        🏆 {valTxt} {metricLabel}
                      </span>
                      <span>📊 {numRegistros} sesiones</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
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
// El backend de Wiemspro solo acepta nombreCampo del tipo string1, string2,
// bool1, datetime1, double1, int1... (esquema legacy hardcodeado).
// Para no chocar con eso, usamos esos nombres en `nombreCampo` y ponemos las
// etiquetas MCP en `nombreAMostrar`. El campo `mcpKey` define cómo se llama
// cada valor cuando se envía al webhook del MCP.
const MCP_CAMPOS = [
  { nombreCampo: 'string1',   nombreAMostrar: 'DNI / NIE',                 tipo: 'string',   formato: 'dni',      obligatorio: true,  orden: 1,  mcpKey: 'dni' },
  { nombreCampo: 'string2',   nombreAMostrar: 'Móvil',                     tipo: 'string',   formato: 'telefono', obligatorio: true,  orden: 2,  mcpKey: 'movil' },
  { nombreCampo: 'string3',   nombreAMostrar: 'Curso / Tipo de cuota',     tipo: 'string',   formato: 'texto',    obligatorio: true,  orden: 3,  mcpKey: 'curso' },
  { nombreCampo: 'double1',   nombreAMostrar: 'Precio del curso (€/mes)',  tipo: 'decimal',  formato: 'moneda',   obligatorio: true,  orden: 4,  mcpKey: 'precio_curso' },
  { nombreCampo: 'datetime1', nombreAMostrar: 'Fecha de alta',             tipo: 'datetime', formato: 'fecha',    obligatorio: true,  orden: 5,  mcpKey: 'fecha_alta', defaultHoy: true },
  { nombreCampo: 'string4',   nombreAMostrar: 'Forma de pago recurrente',  tipo: 'string',   formato: 'select',   obligatorio: true,  orden: 6,  mcpKey: 'tipo_pago',
    opciones: ['SEPA', 'Tarjeta tokenizada', 'Enlace de pago / caja'] },
  { nombreCampo: 'string5',   nombreAMostrar: 'IBAN',                      tipo: 'string',   formato: 'iban',     obligatorio: false, orden: 7,  mcpKey: 'iban',
    obligatorioSi: { campo: 'string4', valor: 'SEPA' } },
  { nombreCampo: 'string6',   nombreAMostrar: 'Forma de la primera cuota', tipo: 'string',   formato: 'select',   obligatorio: true,  orden: 8,  mcpKey: 'forma_primera_cuota',
    opciones: ['Efectivo', 'TPV físico', 'Enlace de pago', 'Aplazar al próximo recibo'] },
  { nombreCampo: 'string7',   nombreAMostrar: 'Periodo de pago',           tipo: 'string',   formato: 'select',   obligatorio: true,  orden: 9,  mcpKey: 'periodo_pago',
    opciones: ['Mensual', 'Bimensual', 'Trimestral', 'Semestral', 'Anual'] },
  { nombreCampo: 'string8',   nombreAMostrar: 'Tipo de descuento',         tipo: 'string',   formato: 'select',   obligatorio: false, orden: 10, mcpKey: 'tipo_descuento',
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

// Convierte un valor según el mcpKey al formato que espera el MCP
function valueToMCP(mcpKey, raw) {
  if (raw == null || raw === '') return ''
  // precio_curso: numérico como string ("49.9")
  if (mcpKey === 'precio_curso') return String(raw)
  // fecha_alta: yyyy-MM-dd. Si viene timestamp, convertir
  if (mcpKey === 'fecha_alta') {
    if (typeof raw === 'number') return new Date(raw).toISOString().slice(0, 10)
    return String(raw).slice(0, 10)
  }
  return String(raw)
}

// Dispara webhook al MCP (fire-and-forget, best-effort).
// formValues está keyed por nombreCampo (string1, string2, double1...).
// Convertimos a mcpKey (dni, movil, precio_curso...) para el payload.
function dispararWebhookERP(cliente, formValues) {
  const camposMCP = {}
  for (const c of MCP_CAMPOS) {
    camposMCP[c.mcpKey] = valueToMCP(c.mcpKey, formValues[c.nombreCampo])
  }
  const payload = {
    // 6 campos desde la BD NoofitPro
    id_cliente:          cliente.id,
    nombre:              cliente.name ?? '',
    apellidos:           cliente.surname ?? '',
    email:               cliente.email ?? '',
    sexo:                genderToMCP(cliente.gender),
    fecha_nacimiento:    fechaNacimientoToMCP(cliente.birthdate),
    // 10 campos del formulario ERP traducidos a nombres MCP
    ...camposMCP,
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

// ── Tab: Cuotas/recibos del cliente ─────────────────────────────────────────
function TabCuotas({ cliente }) {
  const { user } = useAuth()
  const toast = useToast()
  const [recibos, setRecibos] = useState([])
  const [loading, setLoading] = useState(true)
  // Usa el helper centralizado (maneja correctamente usuario_web, manager
  // clásico e impersonación trainer). Antes había una versión inline aquí
  // que no contemplaba usuario_web → cuando un usuario_web entraba a un
  // centro la pestaña no enviaba bien el id_manager y la consulta volvía
  // sin recibos.
  const identity = useMemo(() => getRoundIdentity(user), [user])

  async function reload() {
    setLoading(true)
    try {
      const { cuotasCliente } = await import('../../utils/cuotasApi')
      const data = await cuotasCliente(identity, cliente.id)
      setRecibos(data || [])
    } catch (e) { toast.error(`Error cargando cuotas: ${e.message}`) }
    setLoading(false)
  }
  useEffect(() => { reload() }, [cliente.id])

  return (
    <div role="tabpanel" aria-label="Cuotas">
      <Card style={{ padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
          <div>
            <SectionTitle><Receipt size={16} style={{ marginRight: 8 }} /> Cuotas y recibos</SectionTitle>
            <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0 }}>
              {loading ? 'Cargando…' : `${recibos.length} recibo${recibos.length !== 1 ? 's' : ''} emitidos para este cliente`}
            </p>
          </div>
          <Btn variant="secondary" size="sm" onClick={reload}><RefreshCw size={13} /> Refrescar</Btn>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
            <Loader2 size={20} className="animate-spin" style={{ color: 'var(--green)' }} />
          </div>
        ) : recibos.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-3)', textAlign: 'center', padding: 32 }}>
            Sin recibos. Genera una preemisión desde el menú "Cuotas clientes".
          </p>
        ) : (
          <RecibosTable recibos={recibos} onReload={reload} />
        )}
      </Card>
    </div>
  )
}

// Tabla común de recibos (también usable desde Cuotas Clientes / Listado).
// onReload: callback opcional para refrescar la lista tras marcar pagado u otra
// acción mutativa. Si no se pasa, el botón Pagar pide reload manual.
function RecibosTable({ recibos, mostrarCliente = false, onReload = null }) {
  return (
    // Scroll horizontal por si la tabla no entra en el card — evita que la
    // columna de acciones se desborde o se apile a múltiples líneas en
    // pantallas estrechas.
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <table style={{
        width: '100%', minWidth: 1100, borderCollapse: 'collapse', fontSize: 12,
        fontFamily: 'inherit',
      }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--line)', textAlign: 'left' }}>
            {mostrarCliente && <Th>Cliente</Th>}
            <Th>Mes</Th>
            <Th>Cuota</Th>
            <Th>Periodicidad</Th>
            <Th>Tipo</Th>
            <Th>Importe</Th>
            <Th>Forma pago</Th>
            <Th>Día emisión</Th>
            <Th>Día cobro</Th>
            <Th>Día devolución</Th>
            <Th>Estado</Th>
            <Th>Notas</Th>
            <Th>Acciones</Th>
          </tr>
        </thead>
        <tbody>
          {recibos.map(r => (
            <ReciboRow key={r.id} r={r} mostrarCliente={mostrarCliente}
                       onReload={onReload} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Th({ children }) {
  return <th style={{
    padding: '8px 8px', fontSize: 10, fontWeight: 600, color: 'var(--text-3)',
    textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap',
  }}>{children}</th>
}


/**
 * Celda compacta para la columna "Notas" de la tabla de recibos.
 *
 * Por defecto cada recibo queda en UN renglón: la nota se trunca con
 * ellipsis y el tooltip nativo (`title`) muestra el texto completo al pasar
 * el ratón.  Al hacer click la celda se expande inline para esa fila sola
 * (las demás siguen en una línea).  Volver a hacer click la colapsa.
 *
 * Limpia HTML simple (Odoo guarda `narration` con `<p>…</p>`).
 */
function NotaCell({ texto }) {
  const [expanded, setExpanded] = useState(false)
  const raw = (texto || '').trim()
  if (!raw) {
    return <Td color="var(--text-3)" style={{ fontSize: 11 }}>—</Td>
  }
  const clean = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  const btnStyle = {
    background: 'none', border: 'none', padding: 0, margin: 0,
    cursor: 'pointer', textAlign: 'left', color: 'inherit',
    font: 'inherit', width: '100%',
    display: 'inline-flex', gap: 6, alignItems: 'flex-start',
  }
  if (expanded) {
    return (
      <Td wrap color="var(--text-3)" style={{ fontSize: 11, maxWidth: 320 }}>
        <button type="button" onClick={() => setExpanded(false)}
                title="Click para contraer" style={btnStyle}>
          <StickyNote size={11} style={{ flexShrink: 0, color: 'var(--blue)', marginTop: 2 }} aria-hidden="true" />
          <span style={{ wordBreak: 'break-word' }}>{clean}</span>
        </button>
      </Td>
    )
  }
  return (
    <Td color="var(--text-3)" title={clean}
        style={{ fontSize: 11, maxWidth: 220 }}>
      <button type="button" onClick={() => setExpanded(true)}
              title={clean} style={btnStyle}>
        <StickyNote size={11} style={{ flexShrink: 0, color: 'var(--blue)' }} aria-hidden="true" />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis',
                       whiteSpace: 'nowrap', flex: 1 }}>{clean}</span>
      </button>
    </Td>
  )
}

function Td({ children, mono, color, style, wrap, title }) {
  const tip = title ?? (typeof children === 'string' ? children : undefined)
  return <td title={tip} style={{
    padding: '8px 8px', borderBottom: '1px solid var(--line)',
    fontFamily: mono ? 'var(--font-mono)' : 'inherit',
    color: color || 'var(--text-1)',
    whiteSpace: wrap ? 'normal' : 'nowrap',
    overflow: wrap ? 'visible' : 'hidden',
    textOverflow: wrap ? 'clip' : 'ellipsis',
    wordBreak: wrap ? 'break-word' : 'normal',
    verticalAlign: 'top',
    ...(style || {}),
  }}>{children}</td>
}

function ReciboRow({ r, mostrarCliente, onReload }) {
  const formaPago = r.forma_pago || '—'
  const formaPagoLabels = {
    sepa: 'SEPA', tarjeta_token: 'Tarjeta', enlace_pago: 'Enlace/Caja', tokenizacion: 'Tarjeta',
  }
  const stateLabels = {
    not_paid:    { label: 'Pendiente',  bg: 'rgba(251,191,36,0.12)', color: 'var(--amber)' },
    in_payment:  { label: 'En cobro',   bg: 'rgba(91,156,246,0.12)', color: 'var(--blue)' },
    paid:        { label: 'Cobrado',    bg: 'rgba(45,212,168,0.12)', color: 'var(--green)' },
    partial:     { label: 'Parcial',    bg: 'rgba(251,191,36,0.12)', color: 'var(--amber)' },
    reversed:    { label: 'Devuelto',   bg: 'rgba(248,113,113,0.12)', color: 'var(--red)' },
  }
  const moveStateLabels = {
    draft:  { label: 'Borrador', bg: 'var(--bg-3)', color: 'var(--text-3)' },
    posted: { label: 'Emitido',  bg: 'rgba(91,156,246,0.12)', color: 'var(--blue)' },
    cancel: { label: 'Cancelado',bg: 'rgba(248,113,113,0.12)', color: 'var(--red)' },
  }
  const isPosted = r.state === 'posted'
  const isImpagado = isPosted && (r.payment_state === 'not_paid' || r.payment_state === 'reversed')
  // Marca "BD" — recibo aún no facturado a Odoo (preemisión, migración GP,
  // emisión manual). Lo enviamos desde el backend en _source='bd'.
  const isBd = r._source === 'bd'

  // Día cobro: si es SEPA y está posted = invoice_date_due; si paid = invoice_date_due tb (asumimos cobro al vencimiento)
  // Día devolución: solo si payment_state == 'reversed' (no tenemos campo R-transaction aún)
  const diaEmision = r.invoice_date || '—'
  const diaCobro = isPosted ? (r.invoice_date_due || '—') : '—'
  const diaDevol = r.payment_state === 'reversed' ? r.invoice_date_due : '—'

  return (
    <tr>
      {mostrarCliente && <Td title={r.partner_id?.name || `#${r.partner_id?.id}`}>{r.partner_id?.name || `#${r.partner_id?.id}`}</Td>}
      <Td mono>{r.mes_ref || '—'}</Td>
      <Td>
        {r.cuota_codigo || '—'}
        {isBd && (
          <span title="Recibo aún no facturado a Odoo (se facturará en el cierre trimestral)"
                style={{ marginLeft: 6, fontSize: 9, padding: '1px 5px', borderRadius: 4,
                         background: 'rgba(91,156,246,0.12)', color: 'var(--blue)',
                         fontWeight: 700, letterSpacing: '0.04em',
                         verticalAlign: 'middle' }}>
            BD
          </span>
        )}
      </Td>
      <Td>{({ mensual:'Mensual', bimensual:'Bimensual', trimestral:'Trimestral', semestral:'Semestral', anual:'Anual' })[r.periodicidad] || r.periodicidad || '—'}</Td>
      <Td>
        <span style={{
          fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999,
          background: r.tipo === 'alta' ? 'rgba(45,212,168,0.12)' : 'var(--bg-3)',
          color: r.tipo === 'alta' ? 'var(--green)' : 'var(--text-2)',
        }}>{r.tipo === 'alta' ? 'Alta' : 'Mensualidad'}</span>
      </Td>
      <Td mono style={{ fontWeight: 600, color: 'var(--text-0)' }}>{r.amount_total?.toFixed(2)} €</Td>
      <Td>{formaPagoLabels[formaPago] || formaPago}</Td>
      <Td mono>{diaEmision}</Td>
      <Td mono>{diaCobro}</Td>
      <Td mono color={diaDevol !== '—' ? 'var(--red)' : 'var(--text-3)'}>{diaDevol}</Td>
      <Td>
        {!isPosted ? (
          <Badge color={moveStateLabels[r.state]?.color === 'var(--text-3)' ? 'gray' : 'blue'}>
            {moveStateLabels[r.state]?.label || r.state}
          </Badge>
        ) : (
          <Badge color={
            r.payment_state === 'paid' ? 'green' :
            r.payment_state === 'reversed' ? 'red' :
            r.payment_state === 'in_payment' ? 'blue' : 'amber'
          }>
            {stateLabels[r.payment_state]?.label || r.payment_state}
          </Badge>
        )}
      </Td>
      <NotaCell texto={r.narration} />
      <Td style={{ whiteSpace: 'nowrap' }}>
        <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          {isImpagado && (
            <PagarBtn r={r} onReload={onReload} />
          )}
          {/* Modificar — cualquier recibo BD. El propio botón se oculta si no es
              BD o sin permiso, y limita los campos según el estado: no cobrados
              = todos; cobrados/facturados = solo fecha fin (próximo cobro) +
              descripciones/notas. */}
          {isBd && (
            <ModificarReciboBtn r={r} onReload={onReload} />
          )}
          {isPosted && r.payment_state === 'paid' && isBd && (
            <DevolverReciboBtn r={r} onReload={onReload} />
          )}
          {isPosted && r.payment_state === 'paid' && isBd && (
            <CorregirFormaPagoBtn r={r} onReload={onReload} />
          )}
          {isPosted && <EnviarFacturaBtn invoiceId={r.id} />}
        </div>
      </Td>
    </tr>
  )
}


/** Botón "Pagar" — marca un recibo BD impagado como pagado.
 *
 *  Para recibos de BD (`_source='bd'`, id_bd numérico) llama a
 *  POST /api/recibos/<id>/marcar-pagado con método de pago opcional.
 *
 *  Para recibos Odoo (account.move): no implementado todavía; el cobro de
 *  facturas Odoo va por el wizard trimestral, no por esta ficha. Mostramos
 *  mensaje informativo.
 */
function PagarBtn({ r, onReload }) {
  const { user } = useAuth()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [metodo, setMetodo] = useState(r.forma_pago || 'caja_efectivo')
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10))
  const overlayClose2 = useOverlayClose(() => setOpen(false), !submitting)

  const isBd = r._source === 'bd'

  const handleClick = () => {
    if (!isBd) {
      toast.error('Este recibo está en Odoo. Cóbralo desde Facturación trimestral.')
      return
    }
    setOpen(true)
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      const { reciboMarcarPagado, getRoundIdentity } = await import('../../utils/configApi')
      await reciboMarcarPagado(getRoundIdentity(user), r.id_bd,
                               { metodo, fecha })
      toast.success('Recibo marcado como pagado')
      setOpen(false)
      onReload && onReload()
    } catch (e) {
      toast.error(`Error: ${e.message}`)
    }
    setSubmitting(false)
  }

  return (
    <>
      <Btn variant="secondary" size="sm" onClick={handleClick}>
        Pagar
      </Btn>
      {open && (
        <div role="dialog" aria-modal="true"
             style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}
             {...overlayClose2}>
          <div onClick={e => e.stopPropagation()}
               style={{ background: 'var(--bg-1)', borderRadius: 12, padding: 20,
                        maxWidth: 380, width: '90%', border: '1px solid var(--line)' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>Marcar como pagado</h3>
            <div style={{ padding: 10, background: 'var(--bg-2)', borderRadius: 8,
                          fontSize: 12, marginBottom: 14 }}>
              <div><strong>{r.partner_id?.name || '—'}</strong></div>
              <div style={{ color: 'var(--text-3)' }}>
                {r.cuota_codigo || ''} · {r.mes_ref || ''} · {Number(r.amount_total || 0).toFixed(2)} €
              </div>
            </div>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>
              Método de pago
            </label>
            <select value={metodo} onChange={e => setMetodo(e.target.value)}
                    style={{ width: '100%', padding: 8, borderRadius: 8, marginBottom: 12,
                             background: 'var(--bg-2)', border: '1px solid var(--line)',
                             color: 'var(--text-0)', fontSize: 13 }}>
              <option value="sepa">SEPA</option>
              <option value="tarjeta_tok">Tarjeta tokenizada</option>
              <option value="caja_efectivo">Efectivo / caja</option>
              <option value="caja_tpv_fisico">TPV físico (caja)</option>
              <option value="caja_tpv_virtual">TPV virtual</option>
              <option value="enlace_pago">Enlace de pago</option>
            </select>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>
              Fecha de cobro
            </label>
            <input type="date" value={fecha} onChange={e => setFecha(e.target.value)}
                   style={{ width: '100%', padding: 8, borderRadius: 8, marginBottom: 16,
                            background: 'var(--bg-2)', border: '1px solid var(--line)',
                            color: 'var(--text-0)', fontSize: 13 }} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Btn variant="secondary" onClick={() => setOpen(false)} disabled={submitting}>
                Cancelar
              </Btn>
              <Btn variant="primary" onClick={handleSubmit} disabled={submitting}>
                {submitting ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                {' '}Confirmar pago
              </Btn>
            </div>
          </div>
        </div>
      )}
    </>
  )
}


/** Botón para enviar la factura por email al cliente con PDF adjunto.
 *  Pide confirmación del email destino (editable) — útil cuando el del
 *  cliente está mal o vacío. */
function EnviarFacturaBtn({ invoiceId }) {
  const { user } = useAuth()
  const toast = useToast()
  const [sending, setSending] = useState(false)
  const handleSend = async () => {
    if (sending) return
    const dest = window.prompt(
      'Enviar factura al email:\n(deja vacío para usar el del cliente registrado en Odoo)',
      ''
    )
    if (dest === null) return  // cancel
    const destClean = dest.trim()
    setSending(true)
    try {
      const { enviarFactura } = await import('../../utils/cuotasApi')
      const { getRoundIdentity } = await import('../../utils/configApi')
      const r = await enviarFactura(getRoundIdentity(user), invoiceId, destClean || null)
      if (r?.ok) toast.success(`Factura enviada a ${r.sent_to}`)
      else if (r?.error === 'email_invalido')
        toast.error(`Email inválido: ${r.email_invalido} — ${r.detalle || ''}`)
      else
        toast.error(`No se pudo enviar: ${r?.error || 'desconocido'}`)
    } catch (e) {
      toast.error(`Error: ${e.message}`)
    }
    setSending(false)
  }
  return (
    <Btn variant="ghost" size="sm" onClick={handleSend} disabled={sending}
         title="Enviar factura por email (editable antes de enviar)">
      {sending ? <Loader2 size={11} className="animate-spin" /> : <Mail size={11} />}
      Enviar
    </Btn>
  )
}


// Pestaña ERP del perfil — flujo guiado de alta-cliente.
// Sustituye al formulario MCP/Wiems heredado (que sigue como TabERPLegacy
// más abajo, sin uso, conservado por si hace falta consultarlo).
function TabERP({ clienteId, cliente }) {
  const [showModal, setShowModal] = useState(false)
  const { categorias: cats, mapa: catMap, loaded: catLoaded } = useCategoriasMap()
  const catActual = catMap[String(clienteId)]
  const subCli = cliente.id ? cliente : { id: clienteId, ...cliente }

  return (
    <div style={{ paddingTop: 14 }}>
      <Card style={{ padding: 28, marginBottom: 16 }}>
        <p style={{ fontSize: 12, color: 'var(--text-3)', textTransform: 'uppercase',
                    letterSpacing: '0.05em', marginBottom: 8 }}>Datos ERP</p>
        <h2 style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-0)', marginBottom: 12 }}>
          Alta del cliente
        </h2>
        <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6, marginBottom: 18 }}>
          Procesa el alta del cliente en un solo paso: categoría, cuotas, forma de pago,
          primer recibo. La suscripción quedará activa para los recibos automáticos
          futuros y el primer recibo se marcará como pagado según la forma de pago elegida.
        </p>

        {catLoaded && catActual && (
          <div style={{ padding: 10, marginBottom: 14, borderRadius: 10,
                        background: 'var(--bg-2)', border: '1px solid var(--line)',
                        fontSize: 13, color: 'var(--text-2)' }}>
            Categoría actual: <strong style={{ color: 'var(--text-0)' }}>{catActual.nombre}</strong>
            {catActual.tiene_cuota
              ? <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--green)' }}>· con cuota</span>
              : <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-3)' }}>· sin cuota</span>}
          </div>
        )}

        <Btn variant="primary" size="md" onClick={() => setShowModal(true)}>
          <Send size={14} aria-hidden="true" /> Procesar alta de cliente
        </Btn>
      </Card>

      {showModal && (
        <AltaClienteModal cliente={subCli}
                          onClose={() => setShowModal(false)}
                          onSaved={() => { setShowModal(false); window.location.reload() }} />
      )}
    </div>
  )
}


// Componente legacy — formulario dinámico MCP/Wiems. No se usa, conservado
// como referencia por si hace falta consultarlo.
function TabERPLegacy({ clienteId, cliente }) {
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
  const [infoDlg, setInfoDlg] = useState(null) // { title, message }
  const overlayClose3 = useOverlayClose(() => setInfoDlg(null))
  // Catálogo de cuotas para el dropdown de "Curso / Tipo de cuota"
  const [cuotasCatalogo, setCuotasCatalogo] = useState([])

  useEffect(() => {
    async function load() {
      try {
        const d = await getERPDatosCliente(clienteId).catch(() => null)
        const datosIniciales = d?.campos ?? {}
        // Pre-rellenar fecha_alta (datetime1) con hoy si no hay valor guardado
        if (!datosIniciales.datetime1) datosIniciales.datetime1 = todayISO()
        setValues(datosIniciales)
      } catch {
        setError('Error cargando datos ERP')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [clienteId])

  // Cargar catálogo de cuotas (vía /api/config/cuotas)
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const session = (() => { try { return JSON.parse(sessionStorage.getItem('round_session') || '{}') } catch { return {} } })()
        const [{ getRoundIdentity, cuotasList }, ] = await Promise.all([
          import('../../utils/configApi'),
        ])
        const identity = getRoundIdentity(session)
        const arr = await cuotasList(identity)
        if (alive) setCuotasCatalogo(arr || [])
      } catch (e) {
        console.warn('cuotas catalogo:', e?.message)
      }
    })()
    return () => { alive = false }
  }, [])

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
      let v = source[k]
      if (v === undefined || v === '' || v === null) continue
      // Wiems backend rechaza datetime1 como timestamp ms; lo enviamos siempre
      // como string ISO (yyyy-MM-dd o yyyy-MM-ddTHH:mm).
      if (k.startsWith('datetime')) {
        if (typeof v === 'number') {
          const isOnlyDate = c.formato === 'date' || c.formato === 'fecha'
          v = new Date(v).toISOString().slice(0, isOnlyDate ? 10 : 16)
        } else {
          v = String(v)
        }
      }
      payload[k] = v
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

  // Guarda los datos ERP del cliente. El backend exige que el body tenga
  // valor (aunque sea vacío) para CADA campo configurado. Como hay campos
  // huérfanos del primer intento (dni, movil...), los rellenamos con cadena
  // vacía para evitar el error "No se pudo leer el campo ERP: X".
  async function postDatosERPSmart(idCliente, payload) {
    // 1) Obtener la lista completa de campos configurados en el backend
    let allKeys = new Set()
    try {
      const cfg = await apiGetRaw('api/erp/configuracion')
      const configs = Array.isArray(cfg) ? cfg : (cfg ? [cfg] : [])
      for (const c of configs) {
        for (const campo of (c.campos ?? [])) {
          const k = campo.nombreCampo ?? campo.nombre
          if (k) allKeys.add(k)
        }
      }
    } catch { /* si falla, seguimos con lo que hay */ }

    // 2) Construir body completo: payload + ('' para campos sin valor)
    const fullCampos = {}
    for (const k of allKeys) fullCampos[k] = ''
    Object.assign(fullCampos, payload) // sobrescribe con los valores reales

    const r = await apiPostRaw(`api/erp/datos/${idCliente}`, { campos: fullCampos })
    const ok = r.ok && (r.data?.mensaje === 'OK' || r.data?.campos != null || r.text === '')
    if (ok) return { ok: true }
    return {
      ok: false,
      error: `POST api/erp/datos/${idCliente} → HTTP ${r.status} / ${r.data?.mensaje ?? r.text?.slice(0, 200)}\n\nBody enviado:\n${JSON.stringify({ campos: fullCampos }, null, 2).slice(0, 600)}`,
    }
  }

  async function handleSave() {
    setSaving(true)
    try {
      const payload = buildPayload(draft)
      const r = await postDatosERPSmart(clienteId, payload)
      if (!r.ok) {
        setInfoDlg({ title: 'Error al guardar datos ERP', message: r.error })
        return
      }
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
      const r = await postDatosERPSmart(clienteId, payload)
      if (!r.ok) {
        setInfoDlg({ title: 'Error al enviar datos al ERP', message: r.error })
        setSending(false)
        return
      }
      // Disparar webhook al MCP — fire-and-forget, no bloquea la UI
      dispararWebhookERP(cliente, payload)

      // ── Crear alta en Odoo (round_facturacion) ──
      // Mapear payload por mcpKey y construir estructura {cliente, suscripcion, alta}
      try {
        const mcp = {}
        for (const c of campos) {
          if (c.mcpKey && payload[c.nombreCampo] != null && payload[c.nombreCampo] !== '') {
            mcp[c.mcpKey] = payload[c.nombreCampo]
          }
        }
        // Mapear "tipo_pago" / "forma_primera_cuota" a las claves del backend Odoo.
        // tipo_pago indica forma recurrente; forma_primera_cuota es la del alta.
        const formaRecurrenteMap = {
          'sepa':'sepa',
          'tarjeta tokenizada':'tarjeta_token','tarjeta':'tarjeta_token','token':'tarjeta_token',
          // Odoo agrupa caja/efectivo dentro de 'enlace_pago' a nivel suscripción
          'enlace de pago':'enlace_pago','enlace':'enlace_pago',
          'enlace de pago / caja':'enlace_pago','enlace / caja':'enlace_pago',
          'efectivo':'enlace_pago','caja':'enlace_pago',
        }
        const formaAltaMap = {
          'efectivo':'efectivo','caja':'efectivo',
          'tpv físico':'tpv_fisico','tpv fisico':'tpv_fisico','tpv':'tpv_fisico','datafono':'tpv_fisico',
          'enlace de pago':'enlace_pago','enlace':'enlace_pago','paycomet':'enlace_pago',
          'aplazar al próximo recibo':'aplazar','aplazar al proximo recibo':'aplazar',
          'aplazar':'aplazar','aplazado':'aplazar','siguiente recibo':'aplazar',
        }
        const periodicidadMap = {
          'mensual':'mensual','bimensual':'bimensual','trimestral':'trimestral',
          'semestral':'semestral','anual':'anual',
        }
        const norm = s => (s || '').toString().trim().toLowerCase()
        const altaPayload = {
          cliente: {
            idnoofit: String(clienteId),
            nombre: cliente.nombre || cliente.name || '',
            apellidos: cliente.apellidos || cliente.surname || '',
            email: cliente.email || '',
            movil: mcp.movil || cliente.cellPhone || '',
            dni: mcp.dni || cliente.dni || '',
            iban: mcp.iban || '',
            fecha_nacimiento: cliente.birthdate || '',
          },
          suscripcion: {
            cuota_codigo: mcp.curso,
            periodicidad: periodicidadMap[norm(mcp.periodo_pago)] || 'mensual',
            forma_pago_recurrente: formaRecurrenteMap[norm(mcp.tipo_pago)] || 'sepa',
            fecha_alta: mcp.fecha_alta,
            descuento_codigo: mcp.tipo_descuento || null,
          },
          alta: {
            forma_pago_alta: formaAltaMap[norm(mcp.forma_primera_cuota)] || 'aplazar',
            importe_alta: parseFloat(mcp.precio_curso || 0),
            matricula: 0,
          },
        }
        // Importar dinámicamente para no inflar el chunk principal
        const [{ altaCliente }, { getRoundIdentity }] = await Promise.all([
          import('../../utils/cuotasApi'),
          import('../../utils/configApi'),
        ])
        // identity: leemos del sessionStorage round_session
        const session = (() => { try { return JSON.parse(sessionStorage.getItem('round_session') || '{}') } catch { return {} } })()
        const identity = getRoundIdentity(session)
        const r2 = await altaCliente(identity, altaPayload)
        if (r2?.ok) {
          let extra = ''
          if (r2.pago?.paid)                          extra = '· pago registrado'
          else if (r2.pago?.modificacion_proximo_mes) extra = '· cargo aplazado próximo recibo'
          else if (r2.pago?.warning)                  extra = '⚠ ' + r2.pago.warning
          if (r2.pago?.enlace_pago_url) {
            // PayComet: copiar al portapapeles + mostrar modal
            try { await navigator.clipboard.writeText(r2.pago.enlace_pago_url) } catch {}
            setInfoDlg({
              title: 'Enlace de pago generado',
              message: `Comparte este enlace con el cliente para que complete el cobro:\n\n${r2.pago.enlace_pago_url}\n\n(Ya copiado al portapapeles. Cuando el cliente pague, el recibo se marcará como cobrado automáticamente.)`,
            })
          } else if (r2.pago?.error_pago) {
            toast.warning(`Recibo #${r2.invoice_id} creado · ⚠ ${r2.pago.error_pago}`)
          } else {
            toast.success(`Alta creada en Odoo (recibo #${r2.invoice_id}) ${extra}`)
          }
        } else {
          toast.warning('Wiems OK · alta Odoo no realizada: ' + (r2?.error || 'desconocido'))
        }
      } catch (e) {
        console.error('alta Odoo:', e)
        toast.warning('Wiems OK · alta Odoo falló: ' + (e?.message || e))
      }

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
              // El campo "curso / tipo de cuota" se identifica por mcpKey === 'curso'.
              // (No usar regex sobre nombreAMostrar porque "Forma de la primera
              // cuota" también contiene "cuota" y no es el selector de catálogo.)
              const isCuotaField = campo.mcpKey === 'curso' && cuotasCatalogo.length > 0

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
              } else if (isCuotaField) {
                valueEl = (
                  <select value={val} onChange={e => setDraftValue(key, e.target.value)}
                          className="form-input"
                          style={{ ...inputStyleERP(), cursor: 'pointer' }}>
                    <option value="">— Selecciona cuota —</option>
                    {cuotasCatalogo.map(c => (
                      <option key={c.codigo} value={c.codigo}>
                        {c.codigo} — {c.descripcion || ''} {c.precio_mensual ? `(${c.precio_mensual} €/mes)` : ''}
                      </option>
                    ))}
                  </select>
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
                // Importes en € → step 0,5; otros decimales → 0,01; enteros → 1
                const step = campo.formato === 'moneda' ? '0.5'
                           : tipo === 'decimal' ? '0.01' : '1'
                valueEl = (
                  <input type="number" value={val}
                         step={step}
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

      {infoDlg && (
        <div {...overlayClose3}
             style={{
               position: 'fixed', inset: 0, zIndex: 700,
               background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
               display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
             }}>
          <div style={{
            background: 'var(--bg-1)', borderRadius: 16, width: '100%', maxWidth: 640,
            boxShadow: '0 24px 80px rgba(0,0,0,0.45)', overflow: 'hidden',
          }}>
            <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--line)' }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-0)', margin: 0 }}>{infoDlg.title}</h3>
            </div>
            <pre style={{
              margin: 0, padding: '16px 22px', maxHeight: '60vh', overflow: 'auto',
              fontSize: 12, lineHeight: 1.5, color: 'var(--text-1)', whiteSpace: 'pre-wrap',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            }}>{infoDlg.message}</pre>
            <div style={{ padding: '14px 22px', borderTop: '1px solid var(--line)',
                          display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => setInfoDlg(null)} style={{
                padding: '8px 18px', borderRadius: 10, border: 'none',
                background: 'var(--green)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}>Cerrar</button>
            </div>
          </div>
        </div>
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


// ──────────────────────────────────────────────────────────────────────────
// Badge GRANDE de estado del cliente con fecha de alta/baja incrustada.
// Es lo primero que debe ver el operador al entrar en la ficha.
// ──────────────────────────────────────────────────────────────────────────
function BigStatusBadge({ cliente, bajaPendiente, fechas }) {
  const fmt = (s) => {
    if (!s) return null
    try { return new Date(s).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) }
    catch { return null }
  }
  // 3 estados:
  //  1) Inactivo en NF → rojo "Baja DD/MM/YYYY"
  //  2) Baja programada pendiente → ámbar "Baja prog. DD/MM/YYYY"
  //  3) Activo → verde "Activo desde DD/MM/YYYY"
  let bg, borderC, fg, icon, label, fechaTxt
  if (cliente.enabled === false) {
    bg = 'rgba(248,113,133,0.10)'
    borderC = 'rgba(248,113,133,0.4)'
    fg = 'var(--red, #f87185)'
    icon = <Archive size={16} aria-hidden="true" />
    label = 'INACTIVO'
    fechaTxt = fechas?.fecha_inactivo
      ? `desde ${fmt(fechas.fecha_inactivo)}`
      : (cliente.motivoArchivado ? `(${cliente.motivoArchivado})` : '')
  } else if (bajaPendiente) {
    bg = 'rgba(251,191,36,0.10)'
    borderC = 'rgba(251,191,36,0.45)'
    fg = 'var(--amber, #d97706)'
    icon = <Clock size={16} aria-hidden="true" />
    label = 'BAJA PROGRAMADA'
    fechaTxt = `el ${new Date(bajaPendiente.fecha_baja).toLocaleDateString('es-ES')}`
  } else {
    bg = 'rgba(45,212,168,0.10)'
    borderC = 'rgba(45,212,168,0.4)'
    fg = 'var(--green, #2DD4A8)'
    icon = <CheckCircle2 size={16} aria-hidden="true" />
    label = 'ACTIVO'
    fechaTxt = fechas?.fecha_alta_actual
      ? `desde ${fmt(fechas.fecha_alta_actual)}`
      : fechas?.fecha_primera_alta
        ? `desde ${fmt(fechas.fecha_primera_alta)}`
        : ''
  }
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 10,
      padding: '8px 16px', borderRadius: 14,
      background: bg, border: `1.5px solid ${borderC}`,
      color: fg, fontWeight: 700, fontSize: 14, fontFamily: 'Outfit',
    }}>
      {icon}
      <span>{label}</span>
      {fechaTxt && (
        <span style={{ fontSize: 12, fontWeight: 500, opacity: 0.85,
                       borderLeft: `1px solid ${borderC}`, paddingLeft: 10 }}>
          {fechaTxt}
        </span>
      )}
    </div>
  )
}


// ──────────────────────────────────────────────────────────────────────────
// Banner rojo de recibos impagados — aparece justo después del hero card
// para que el operador NO se le pase. Solo si hay 1+ recibos en estado
// impagado o devuelto. Click → tab Recibos.
// ──────────────────────────────────────────────────────────────────────────
function ImpagadoBanner({ recibos, onClick }) {
  if (!recibos || recibos.length === 0) return null
  const total = recibos.reduce((s, r) => s + Number(r.importe_total || 0), 0)
  const n = recibos.length
  return (
    <button onClick={onClick}
            aria-label={`${n} recibo${n !== 1 ? 's' : ''} impagado${n !== 1 ? 's' : ''} — ver detalle`}
            style={{
              width: '100%', marginBottom: 24, padding: '16px 20px',
              borderRadius: 14, background: 'rgba(248,113,133,0.12)',
              border: '1.5px solid rgba(248,113,133,0.5)',
              display: 'flex', alignItems: 'center', gap: 14,
              cursor: 'pointer', textAlign: 'left',
              fontFamily: 'inherit',
            }}>
      <span style={{
        width: 40, height: 40, borderRadius: '50%',
        background: 'rgba(248,113,133,0.25)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--red, #f87185)', flexShrink: 0,
      }}>
        <AlertCircle size={20} aria-hidden="true" />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: 'Outfit', fontSize: 15, fontWeight: 700,
                      color: 'var(--red, #f87185)' }}>
          {n === 1 ? '1 recibo impagado' : `${n} recibos impagados`}
          {' · '}{total.toFixed(2)} €
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>
          {recibos.slice(0, 3).map(r =>
            `${r.cuota_codigo || 'Recibo'} ${r.periodo || ''} (${r.estado})`
          ).join(' · ')}
          {recibos.length > 3 && ` · y ${recibos.length - 3} más…`}
        </div>
      </div>
      <span style={{ fontSize: 12, color: 'var(--red, #f87185)', fontWeight: 600 }}>
        Ver Recibos →
      </span>
    </button>
  )
}
