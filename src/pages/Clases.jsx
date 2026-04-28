import { useState, useEffect, useCallback } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import {
  ChevronLeft, ChevronRight, Loader2, Users, Clock, Plus, Pencil, Trash2,
  X, CheckCircle2, XCircle, UserPlus, UserMinus, Search, ArrowUpDown, QrCode,
} from 'lucide-react'
import { Card, Badge, Btn, Avatar } from '../components/UI'
import ConfirmDialog from '../components/ConfirmDialog'
import Modal from '../components/Modal'
import { useToast } from '../components/Toast'
import {
  getSalasByRange, invalidateSalasCache, saveSala, removeSala,
  getUsuariosBySala, updateUsuarioSala, userJoinSalas, userRemoveSala, getClientes,
  getActividades,
} from '../utils/api'
import { colorFromName } from '../utils/colors'
import { formatHora } from '../utils/formatters'

const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

function startOfDay(d) {
  const n = new Date(d)
  n.setHours(0, 0, 0, 0)
  return n
}

function toLocalDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function isClaseActiva(sala, now) {
  if (!sala?.dateStart) return false
  const start = new Date(sala.dateStart).getTime()
  const duration = (sala.durationTraining || 3600) * 1000
  return now >= start - 15 * 60 * 1000 && now <= start + duration
}

export default function Clases() {
  const toast = useToast()
  const [baseDate, setBaseDate]   = useState(startOfDay(new Date()))
  const [salas, setSalas]         = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')
  const [filtroAct, setFiltroAct] = useState('todas')
  const [orden, setOrden]         = useState('hora')   // 'hora' | 'actividad'

  // Catálogo de actividades (cached, loaded once)
  const [catActividades, setCatActividades] = useState([])
  useEffect(() => { getActividades().then(setCatActividades).catch(() => {}) }, [])

  // Right panel
  const [selSala, setSelSala]         = useState(null)
  const [selActividad, setSelActividad] = useState(null)
  const [usuarios, setUsuarios]       = useState([])
  const [loadingPanel, setLoadingPanel] = useState(false)
  const [actionLoading, setActionLoading] = useState('')

  // Confirm dialogs
  const [confirmAsist, setConfirmAsist] = useState(null)   // { usuario }
  const [confirmRemove, setConfirmRemove] = useState(null) // usuario
  const [confirmBaja, setConfirmBaja]   = useState({ open: false, sala: null })

  // Inscribir modal
  const [showInscribir, setShowInscribir]   = useState(false)
  const [clientes, setClientes]             = useState([])
  const [clientSearch, setClientSearch]     = useState('')
  const [loadingClients, setLoadingClients] = useState(false)

  // Class form modal
  const [formModal, setFormModal] = useState({ open: false, sala: null })
  const [formData, setFormData]   = useState({ nombre: '', aforo: '10', idEspejo: '' })

  // ── fetch (date-range aware, re-fetches when week changes) ───────────────────
  const loadSalas = useCallback(() => {
    // Round to Monday of current week for stable cache keys while navigating day by day
    const mon = new Date(baseDate)
    mon.setDate(baseDate.getDate() - ((baseDate.getDay() + 6) % 7))
    const from = new Date(mon); from.setDate(mon.getDate() - 14) // 2 weeks back
    const to   = new Date(mon); to.setDate(mon.getDate() + 21)   // 3 weeks forward

    setLoading(true)
    setError('')
    getSalasByRange(from, to)
      .then(d => setSalas(d))
      .catch(() => setError('Error cargando clases'))
      .finally(() => setLoading(false))
  }, [baseDate])

  useEffect(() => { loadSalas() }, [loadSalas])

  // ── navigation ───────────────────────────────────────────────────────────────
  const moveDay  = n => { setBaseDate(d => { const nd = startOfDay(d); nd.setDate(nd.getDate() + n); return nd }); setFiltroAct('todas') }
  const moveWeek = n => { setBaseDate(d => { const nd = startOfDay(d); nd.setDate(nd.getDate() + n * 7); return nd }); setFiltroAct('todas') }
  const goToday  = () => setBaseDate(startOfDay(new Date()))

  const todayStr = toLocalDateStr(startOfDay(new Date()))
  const isToday  = toLocalDateStr(baseDate) === todayStr
  const dias3    = [0, 1, 2].map(i => { const d = new Date(baseDate); d.setDate(baseDate.getDate() + i); return d })

  // Live clock for QR window detection (updates every 30s)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  // ── filtering / sorting ──────────────────────────────────────────────────────
  // Active activities that actually have classes in the loaded range
  const actividadesConClases = catActividades.filter(a =>
    a.enabled !== false && salas.some(s => s.idActividad != null && String(s.idActividad) === String(a.id))
  )

  const salasPorDia = fecha => {
    const str = toLocalDateStr(fecha)
    let r = salas.filter(s => s.dateStart && toLocalDateStr(new Date(s.dateStart)) === str)
    if (filtroAct !== 'todas') r = r.filter(s => String(s.idActividad) === filtroAct)
    return orden === 'actividad'
      ? r.sort((a, b) => (a.nameTraining || '').localeCompare(b.nameTraining || ''))
      : r.sort((a, b) => new Date(a.dateStart) - new Date(b.dateStart))
  }

  // ── select class → load attendees + resolve actividad ───────────────────────
  const handleSelect = async sala => {
    if (selSala?.id === sala.id) { setSelSala(null); setSelActividad(null); return }
    setSelSala(sala)
    const act = catActividades.find(a => (a.Nombre ?? a.nombre) === sala.nameTraining) ?? null
    setSelActividad(act)
    setLoadingPanel(true)
    setUsuarios([])
    try { setUsuarios(await getUsuariosBySala(sala.id)) }
    catch { toast.error('Error cargando asistentes') }
    finally { setLoadingPanel(false) }
  }

  // ── attendance toggle (with confirm) ─────────────────────────────────────────
  const doToggle = async () => {
    const u = confirmAsist?.usuario
    if (!u) return
    setConfirmAsist(null)
    setActionLoading(`toggle-${u.id}`)
    try {
      await updateUsuarioSala({ ...u, verify: !u.verify })
      setUsuarios(prev => prev.map(p => p.id === u.id ? { ...p, verify: !p.verify } : p))
      toast.success(u.verify ? 'Asistencia desmarcada' : 'Asistencia confirmada')
    } catch { toast.error('No se pudo actualizar la asistencia') }
    finally { setActionLoading('') }
  }

  // ── remove user ──────────────────────────────────────────────────────────────
  const doRemove = async () => {
    const u = confirmRemove
    if (!u) return
    setConfirmRemove(null)
    setActionLoading(`remove-${u.id}`)
    try {
      await userRemoveSala(u.id)
      setUsuarios(prev => prev.filter(p => p.id !== u.id))
      toast.success(`${u.nameClient} eliminado de la clase`)
    } catch { toast.error('No se pudo eliminar al usuario') }
    finally { setActionLoading('') }
  }

  // ── inscribir cliente ────────────────────────────────────────────────────────
  const handleOpenInscribir = async () => {
    setShowInscribir(true)
    if (clientes.length === 0) {
      setLoadingClients(true)
      try { setClientes((await getClientes()).filter(c => c.enabled !== false)) }
      catch { }
      finally { setLoadingClients(false) }
    }
  }

  const handleInscribir = async cliente => {
    if (!selSala) return
    setActionLoading(`join-${cliente.id}`)
    try {
      await userJoinSalas({
        idClient: cliente.id,
        nameClient: `${cliente.name} ${cliente.surname}`,
        pictureClient: cliente.imgUrl || '',
        verify: false, isPause: false,
        idSalaJoin: selSala.id, idsSala: [selSala.id],
        ems: false, tem: false, pulsometro: false, idEquipoJoin: 0, posicion: 0,
      })
      setShowInscribir(false)
      setClientSearch('')
      setUsuarios(await getUsuariosBySala(selSala.id))
      toast.success(`${cliente.name} ${cliente.surname} inscrito correctamente`)
    } catch { toast.error('No se pudo inscribir al cliente') }
    finally { setActionLoading('') }
  }

  const idsInscritos = new Set(usuarios.map(u => u.idClient))
  const clientesFiltrados = clientes
    .filter(c => !idsInscritos.has(c.id))
    .filter(c => {
      if (!clientSearch) return true
      const q = clientSearch.toLowerCase()
      return `${c.name} ${c.surname} ${c.email}`.toLowerCase().includes(q)
    })

  // ── class form ───────────────────────────────────────────────────────────────
  const openAlta = () => {
    setFormData({ nombre: '', aforo: '10', idEspejo: '' })
    setFormModal({ open: true, sala: null })
  }
  const openModificar = sala => {
    setFormData({ nombre: sala.name || sala.nameTraining || '', aforo: String(sala.aforo || ''), idEspejo: String(sala.idEspejo ?? '') })
    setFormModal({ open: true, sala })
  }
  const handleSaveForm = async () => {
    const { sala } = formModal
    if (!formData.nombre.trim()) { toast.warning('El nombre es obligatorio'); return }
    try {
      if (sala) {
        await saveSala({ ...sala, name: formData.nombre.trim(), aforo: Number(formData.aforo) || sala.aforo, idEspejo: formData.idEspejo ? Number(formData.idEspejo) : sala.idEspejo })
        if (selSala?.id === sala.id) setSelSala(s => ({ ...s, name: formData.nombre.trim() }))
        toast.success('Clase modificada')
      } else {
        await saveSala({ name: formData.nombre.trim(), aforo: Number(formData.aforo) || 10, enabled: true, idEspejo: formData.idEspejo ? Number(formData.idEspejo) : undefined })
        toast.success('Clase creada correctamente')
      }
      setFormModal({ open: false, sala: null })
      invalidateSalasCache()
      loadSalas()
    } catch { toast.error(sala ? 'Error al modificar la clase' : 'Error al crear la clase') }
  }
  const handleBaja = async () => {
    const { sala } = confirmBaja
    if (!sala) return
    try {
      await removeSala(sala.id)
      setSalas(prev => prev.filter(s => s.id !== sala.id))
      if (selSala?.id === sala.id) setSelSala(null)
      toast.success('Clase eliminada')
      invalidateSalasCache()
    } catch { toast.error('Error al eliminar la clase') }
    setConfirmBaja({ open: false, sala: null })
  }

  // ── render ───────────────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '120px 0' }}>
      <Loader2 size={22} className="animate-spin" style={{ color: 'var(--green)' }} />
    </div>
  )
  if (error) return (
    <div style={{ padding: '80px 0', textAlign: 'center', fontSize: 14, color: 'var(--red)' }}>{error}</div>
  )

  return (
    <div>
      {/* ── Toolbar (sticky, compact) ── */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 50,
        isolation: 'isolate',
        background: 'var(--bg-0)',
        // Extend horizontally to cover the full content width (incl. the
        // horizontal page padding) so cards scrolling beneath are fully
        // hidden behind the opaque background.
        marginLeft: 'calc(-1 * clamp(20px, 4vw, 48px))',
        marginRight: 'calc(-1 * clamp(20px, 4vw, 48px))',
        paddingLeft: 'clamp(20px, 4vw, 48px)',
        paddingRight: 'clamp(20px, 4vw, 48px)',
        paddingTop: 12,
        paddingBottom: 10,
        marginBottom: 12,
        borderBottom: '1px solid var(--line)',
        // Soft shadow emphasises separation from scrolled content underneath.
        boxShadow: '0 4px 10px -6px rgba(0,0,0,0.25)',
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8,
      }}>

        {/* Day arrows */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <NavBtn onClick={() => moveDay(-1)} title="Día anterior"><ChevronLeft size={14} /></NavBtn>
          <div style={{ minWidth: 150, textAlign: 'center' }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-0)' }}>
              {dias3[0].toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
              {' — '}
              {dias3[2].toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })}
            </p>
          </div>
          <NavBtn onClick={() => moveDay(1)} title="Día siguiente"><ChevronRight size={14} /></NavBtn>
        </div>

        {/* Week arrows */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <NavBtn onClick={() => moveWeek(-1)} title="Semana anterior" small>
            <ChevronLeft size={12} /><ChevronLeft size={12} style={{ marginLeft: -5 }} />
          </NavBtn>
          <span style={{ fontSize: 11, color: 'var(--text-3)', padding: '0 3px', userSelect: 'none' }}>sem</span>
          <NavBtn onClick={() => moveWeek(1)} title="Semana siguiente" small>
            <ChevronRight size={12} /><ChevronRight size={12} style={{ marginLeft: -5 }} />
          </NavBtn>
        </div>

        {!isToday && (
          <button onClick={goToday}
                  style={{ padding: '6px 12px', borderRadius: 9, fontSize: 12, cursor: 'pointer', color: 'var(--green)', background: 'rgba(45,212,168,0.1)', border: 'none', fontWeight: 500 }}>
            Hoy
          </button>
        )}

        <div style={{ width: 1, height: 22, background: 'var(--line)', flexShrink: 0 }} />

        {/* Activity filter */}
        {actividadesConClases.length > 0 && (
          <select value={filtroAct} onChange={e => setFiltroAct(e.target.value)}
                  style={{
                    padding: '7px 12px', borderRadius: 10, fontSize: 12, cursor: 'pointer',
                    background: 'var(--bg-2)', border: '1px solid var(--line)', color: 'var(--text-1)',
                    fontFamily: 'inherit',
                  }}>
            <option value="todas">Todas las actividades</option>
            {actividadesConClases.map(a => (
              <option key={a.id} value={String(a.id)}>{a.Nombre ?? a.nombre ?? `Actividad #${a.id}`}</option>
            ))}
          </select>
        )}

        {/* Sort toggle */}
        <button onClick={() => setOrden(o => o === 'hora' ? 'actividad' : 'hora')}
                title={`Ordenar por ${orden === 'hora' ? 'actividad' : 'hora'}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '7px 12px', borderRadius: 10, fontSize: 12, cursor: 'pointer',
                  background: 'var(--bg-2)', border: '1px solid var(--line)', color: 'var(--text-2)', fontFamily: 'inherit',
                }}>
          <ArrowUpDown size={13} aria-hidden="true" />
          {orden === 'hora' ? 'Por hora' : 'Por actividad'}
        </button>
      </div>

      {/* ── Content: 3 días + panel derecho ── */}
      <div style={{ display: 'flex', gap: 0, alignItems: 'flex-start' }}>

        {/* 3-day columns — right padding when panel is open so content doesn't hide under it */}
        <div style={{ flex: 1, minWidth: 0, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, paddingRight: selSala ? 384 : 0, transition: 'padding-right 0.2s' }}>
          {dias3.map(dia => {
            const diaStr = toLocalDateStr(dia)
            const esHoy = diaStr === todayStr
            const clases = salasPorDia(dia)
            return (
              <div key={diaStr}>
                {/* Day header — compact */}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  paddingBottom: 6, marginBottom: 8,
                  borderBottom: `2px solid ${esHoy ? 'var(--green)' : 'var(--line)'}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
                    <p style={{ fontFamily: 'Outfit', fontSize: 20, fontWeight: 700, color: esHoy ? 'var(--green)' : 'var(--text-0)', lineHeight: 1 }}>
                      {dia.getDate()}
                    </p>
                    <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: esHoy ? 'var(--green)' : 'var(--text-3)' }}>
                      {DIAS[dia.getDay()]}
                    </p>
                    <p style={{ fontSize: 11, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {dia.toLocaleDateString('es-ES', { month: 'short' })}
                    </p>
                  </div>
                  <button onClick={openAlta} title="Nueva clase"
                          style={{
                            width: 26, height: 26, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                            cursor: 'pointer', background: 'var(--bg-3)', border: '1px solid var(--line)', color: 'var(--text-3)',
                          }}>
                    <Plus size={13} aria-hidden="true" />
                  </button>
                </div>

                {/* Class cards — compact */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {clases.length === 0 && (
                    <p style={{ textAlign: 'center', fontSize: 12, padding: '16px 0', color: 'var(--text-3)' }}>Sin clases</p>
                  )}
                  {clases.map(s => {
                    const isSelected = selSala?.id === s.id
                    const inscritos = s.users?.length ?? 0
                    const pct = s.aforo ? inscritos / s.aforo : 0
                    const cardColor = pct > 0.9 ? '#fca5a5' : pct >= 0.7 ? '#fed7aa' : pct >= 0.5 ? '#bfdbfe' : pct >= 0.25 ? '#bbf7d0' : '#f1f5f9'
                    const cardText  = pct < 0.25 ? '#334155' : '#1e293b'
                    return (
                      <div key={s.id} onClick={() => handleSelect(s)}
                           style={{
                             borderRadius: 10, padding: '8px 10px', cursor: 'pointer',
                             background: cardColor,
                             borderLeft: `3px solid ${isSelected ? cardText : cardText + '66'}`,
                             outline: isSelected ? `2px solid ${cardText}` : 'none',
                             opacity: isSelected ? 1 : 0.92,
                             transition: 'all 0.12s',
                           }}>
                        <p style={{ fontSize: 15, fontWeight: 700, color: cardText, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.2 }}>
                          {s.name || s.nameTraining}
                        </p>
                        {s.nameTraining && s.name && s.name !== s.nameTraining && (
                          <p style={{ fontSize: 11, fontWeight: 500, color: cardText + 'aa', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {s.nameTraining}
                          </p>
                        )}
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 12, color: cardText + 'cc' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                            <Clock size={12} aria-hidden="true" /> {formatHora(s.dateStart)}
                          </span>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                            <Users size={12} aria-hidden="true" />
                            {inscritos}/{s.aforo || '∞'}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        {/* Right panel — sticky below the toolbar */}
        {selSala && (
          <div key={selSala.id} style={{
            width: 360, flexShrink: 0,
            background: 'var(--bg-2)',
            borderLeft: '1px solid var(--line)',
            borderRadius: 0,
            position: 'sticky',
            top: 52,
            alignSelf: 'flex-start',
          }}>
            <PanelClase
              sala={selSala}
              actividad={selActividad}
              usuarios={usuarios}
              loading={loadingPanel}
              actionLoading={actionLoading}
              isActive={isClaseActiva(selSala, now)}
              onClose={() => { setSelSala(null); setSelActividad(null) }}
              onToggleAsistencia={u => setConfirmAsist({ usuario: u })}
              onRemoveUsuario={u => setConfirmRemove(u)}
              onInscribir={handleOpenInscribir}
              onModificar={() => openModificar(selSala)}
              onBaja={() => setConfirmBaja({ open: true, sala: selSala })}
            />
          </div>
        )}

      </div>

      {/* ── Dialogs & Modals ── */}

      <ConfirmDialog
        open={confirmAsist !== null}
        title={confirmAsist?.usuario?.verify ? 'Desmarcar asistencia' : 'Confirmar asistencia'}
        message={confirmAsist
          ? `¿${confirmAsist.usuario.verify ? 'Desmarcar' : 'Confirmar'} la asistencia de ${confirmAsist.usuario.nameClient}?`
          : ''}
        confirmText={confirmAsist?.usuario?.verify ? 'Desmarcar' : 'Confirmar'}
        variant={confirmAsist?.usuario?.verify ? 'danger' : 'primary'}
        onConfirm={doToggle}
        onCancel={() => setConfirmAsist(null)}
      />

      <ConfirmDialog
        open={confirmRemove !== null}
        title="Eliminar de la clase"
        message={confirmRemove ? `¿Eliminar a ${confirmRemove.nameClient} de esta clase?` : ''}
        confirmText="Eliminar"
        variant="danger"
        onConfirm={doRemove}
        onCancel={() => setConfirmRemove(null)}
      />

      <ConfirmDialog
        open={confirmBaja.open}
        title="Dar de baja clase"
        message={`¿Dar de baja la clase "${confirmBaja.sala?.name || confirmBaja.sala?.nameTraining || ''}"?`}
        confirmText="Dar de baja"
        onConfirm={handleBaja}
        onCancel={() => setConfirmBaja({ open: false, sala: null })}
      />

      {/* Class form modal */}
      <Modal open={formModal.open} onClose={() => setFormModal({ open: false, sala: null })}
             title={formModal.sala ? 'Modificar clase' : 'Nueva clase'}
             subtitle={formModal.sala ? (formModal.sala.name || formModal.sala.nameTraining) : undefined}
             maxWidth={480}>
        <div style={{ padding: '28px 32px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {[
            { id: 'clase-nombre', label: 'Nombre de la clase *', key: 'nombre', type: 'text' },
            { id: 'clase-aforo',  label: 'Aforo máximo',          key: 'aforo',  type: 'number', min: 1 },
            { id: 'clase-espejo', label: 'ID Espejo (opcional)',   key: 'idEspejo', type: 'text' },
          ].map(({ id, label, key, type, min }) => (
            <div key={id}>
              <label htmlFor={id} style={{ display: 'block', fontSize: 13, color: 'var(--text-2)', marginBottom: 8 }}>{label}</label>
              <input id={id} type={type} min={min} value={formData[key]}
                     onChange={e => setFormData(f => ({ ...f, [key]: e.target.value }))}
                     className="form-input"
                     style={{ width: '100%', padding: '14px 18px', borderRadius: 14, fontSize: 14, background: 'var(--bg-1)', border: '1px solid var(--line)', color: 'var(--text-0)' }} />
            </div>
          ))}
        </div>
        <div style={{ padding: '20px 32px', borderTop: '1px solid var(--line)', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Btn variant="secondary" size="md" onClick={() => setFormModal({ open: false, sala: null })}>Cancelar</Btn>
          <Btn variant="primary"   size="md" onClick={handleSaveForm}>{formModal.sala ? 'Guardar' : 'Crear clase'}</Btn>
        </div>
      </Modal>

      {/* Inscribir modal */}
      <Modal open={showInscribir} onClose={() => { setShowInscribir(false); setClientSearch('') }}
             title="Alta en clase"
             subtitle={selSala ? (selSala.name || selSala.nameTraining) : ''}
             maxWidth={520}>
        <div style={{ padding: '20px 32px 0' }}>
          <div style={{ position: 'relative', marginBottom: 20 }}>
            <Search size={15} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }} />
            <input type="search" placeholder="Buscar cliente..." value={clientSearch}
                   onChange={e => setClientSearch(e.target.value)} autoFocus className="form-input"
                   style={{ width: '100%', padding: '14px 18px 14px 48px', borderRadius: 14, fontSize: 14, background: 'var(--bg-1)', border: '1px solid var(--line)', color: 'var(--text-0)' }} />
          </div>
        </div>
        <div style={{ overflowY: 'auto', padding: '0 32px 28px', maxHeight: '50vh' }}>
          {loadingClients ? (
            <div style={{ padding: 40, textAlign: 'center' }}>
              <Loader2 size={20} className="animate-spin" style={{ color: 'var(--green)' }} />
            </div>
          ) : clientesFiltrados.length === 0 ? (
            <p style={{ padding: 40, textAlign: 'center', fontSize: 13, color: 'var(--text-3)' }}>
              {clientSearch ? 'No se encontraron clientes' : 'Todos los clientes ya están inscritos'}
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {clientesFiltrados.slice(0, 30).map(c => (
                <button key={c.id} onClick={() => handleInscribir(c)}
                        disabled={!!actionLoading}
                        className="interactive-row"
                        style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 14, borderRadius: 14, cursor: 'pointer', background: 'transparent', border: '1px solid transparent', textAlign: 'left', width: '100%' }}>
                  <Avatar nombre={`${c.name} ${c.surname}`} size={38} imgUrl={c.imgUrl} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-0)' }}>{c.name} {c.surname}</p>
                    <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{c.email}</p>
                  </div>
                  {actionLoading === `join-${c.id}`
                    ? <Loader2 size={16} className="animate-spin" style={{ color: 'var(--green)' }} />
                    : <UserPlus size={16} style={{ color: 'var(--green)', flexShrink: 0 }} />
                  }
                </button>
              ))}
              {clientesFiltrados.length > 30 && (
                <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-3)', padding: 10 }}>
                  +{clientesFiltrados.length - 30} más — usa el buscador
                </p>
              )}
            </div>
          )}
        </div>
        <div style={{ padding: '16px 32px', borderTop: '1px solid var(--line)' }}>
          <Btn variant="secondary" size="md" onClick={() => { setShowInscribir(false); setClientSearch('') }}
               style={{ width: '100%', justifyContent: 'center' }}>Cerrar</Btn>
        </div>
      </Modal>
    </div>
  )
}

// ── NavBtn ────────────────────────────────────────────────────────────────────
function NavBtn({ children, onClick, title, small }) {
  return (
    <button onClick={onClick} title={title}
            style={{
              display: 'flex', alignItems: 'center',
              padding: small ? '6px 7px' : '7px 9px',
              borderRadius: 10, cursor: 'pointer',
              background: 'var(--bg-2)', border: '1px solid var(--line)',
              color: 'var(--text-3)', transition: 'color 0.1s',
            }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--text-1)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-3)'}>
      {children}
    </button>
  )
}

// ── Panel derecho ─────────────────────────────────────────────────────────────
function PanelClase({ sala, actividad, usuarios, loading, actionLoading, isActive, onClose, onToggleAsistencia, onRemoveUsuario, onInscribir, onModificar, onBaja }) {
  const col = colorFromName(sala.nameTraining || sala.name)
  const inscritos  = usuarios.length
  const asistieron = usuarios.filter(u => u.verify).length
  const qrValue    = String(sala.idEspejo ?? sala.id)
  const [fotoPreview, setFotoPreview] = useState(null)  // { imgUrl, nombre }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Header */}
      <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid var(--line)', ...(!isActive && { borderTop: `3px solid ${col}` }) }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontFamily: 'Outfit', fontSize: 17, fontWeight: 700, color: 'var(--text-0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {sala.name || sala.nameTraining}
            </p>
            {sala.nameTraining && sala.name && sala.name !== sala.nameTraining && (
              <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{sala.nameTraining}</p>
            )}
          </div>
          <button onClick={onClose} aria-label="Cerrar panel"
                  style={{ padding: 8, borderRadius: 10, cursor: 'pointer', background: 'var(--bg-3)', border: '1px solid var(--line)', color: 'var(--text-3)', flexShrink: 0 }}>
            <X size={15} />
          </button>
        </div>

        {/* Meta */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 12, color: 'var(--text-3)', marginBottom: 14 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Clock size={12} aria-hidden="true" />
            {formatHora(sala.dateStart)}
            {sala.durationTraining > 0 && ` · ${Math.round(sala.durationTraining / 60)} min`}
          </span>
          {sala.nameTrainer && <span>Monitor: {sala.nameTrainer}</span>}
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Users size={12} aria-hidden="true" />
            <span style={{ color: inscritos >= (sala.aforo || 9999) ? 'var(--red)' : 'inherit' }}>
              {inscritos}/{sala.aforo || '∞'}
            </span>
          </span>
        </div>

        {/* Actividad info */}
        {actividad && (
          <div style={{ marginBottom: 14, padding: '10px 12px', borderRadius: 12, background: `${col}12`, border: `1px solid ${col}30` }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: col, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
              Actividad
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }}>
              {actividad.numMaxReservas != null && (
                <span style={{ fontSize: 12, color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Users size={11} aria-hidden="true" /> Aforo: {actividad.numMaxReservas}
                </span>
              )}
              {actividad.tiempoAntelacionReserva != null && (
                <span style={{ fontSize: 12, color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Clock size={11} aria-hidden="true" /> Antelación: {actividad.tiempoAntelacionReserva}h
                </span>
              )}
              {actividad.listaEspera && (
                <Badge color="yellow">Lista espera</Badge>
              )}
              {actividad.reservarLargoPlazo && (
                <Badge color="blue">Largo plazo</Badge>
              )}
              {actividad.enabled === false && (
                <Badge color="gray">Inactiva</Badge>
              )}
            </div>
          </div>
        )}

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 14 }}>
          {[
            { label: 'Inscritos',     val: inscritos,            c: 'var(--text-0)' },
            { label: 'Asistieron',    val: asistieron,           c: 'var(--green)' },
            { label: 'No asistieron', val: inscritos - asistieron, c: inscritos - asistieron > 0 ? 'var(--red)' : 'var(--text-3)' },
          ].map(({ label, val, c }) => (
            <div key={label} style={{ textAlign: 'center', padding: '10px 6px', background: 'var(--bg-3)', borderRadius: 12 }}>
              <p style={{ fontFamily: 'Outfit', fontSize: 22, fontWeight: 700, color: c }}>{val}</p>
              <p style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>{label}</p>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn variant="primary" size="sm" onClick={onInscribir} style={{ flex: 1, justifyContent: 'center' }}>
            <UserPlus size={14} aria-hidden="true" /> Alta clase
          </Btn>
          <button title="Modificar clase" onClick={onModificar}
                  style={{ padding: '10px 14px', borderRadius: 10, cursor: 'pointer', background: 'var(--bg-3)', border: '1px solid var(--line)', color: 'var(--text-2)', transition: 'all 0.1s' }}
                  onMouseEnter={e => { e.currentTarget.style.color = 'var(--green)'; e.currentTarget.style.borderColor = 'var(--green)' }}
                  onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-2)'; e.currentTarget.style.borderColor = 'var(--line)' }}>
            <Pencil size={14} aria-hidden="true" />
          </button>
          <button title="Dar de baja clase" onClick={onBaja}
                  style={{ padding: '10px 14px', borderRadius: 10, cursor: 'pointer', background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.16)', color: 'var(--red)', transition: 'background 0.1s' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(248,113,113,0.12)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'rgba(248,113,113,0.06)'}>
            <Trash2 size={14} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Attendance list */}
      <div>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
            <Loader2 size={20} className="animate-spin" style={{ color: 'var(--green)' }} />
          </div>
        ) : usuarios.length === 0 ? (
          <div style={{ padding: '40px 20px', textAlign: 'center' }}>
            <Users size={24} style={{ color: 'var(--text-3)', margin: '0 auto 8px' }} />
            <p style={{ fontSize: 13, color: 'var(--text-3)' }}>Sin inscritos</p>
          </div>
        ) : (
          <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {usuarios.map(u => (
              <div key={u.id} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 14,
                background: u.verify ? 'rgba(45,212,168,0.06)' : 'var(--bg-3)',
                border: `1px solid ${u.verify ? 'rgba(45,212,168,0.2)' : 'var(--line)'}`,
              }}>
                <button onClick={() => setFotoPreview({ imgUrl: u.pictureClient, nombre: u.nameClient || `#${u.idClient}` })}
                        title="Ampliar foto"
                        aria-label={`Ampliar foto de ${u.nameClient || 'cliente'}`}
                        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0 }}>
                  <Avatar nombre={u.nameClient || '?'} size={34} imgUrl={u.pictureClient} />
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {u.nameClient || `#${u.idClient}`}
                  </p>
                  <div style={{ marginTop: 3 }}>
                    {u.verify
                      ? <Badge color="green"><CheckCircle2 size={9} aria-hidden="true" /> Asistió</Badge>
                      : <Badge color="gray"><XCircle size={9} aria-hidden="true" /> Sin confirmar</Badge>
                    }
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <Btn variant={u.verify ? 'danger' : 'primary'} size="sm"
                       onClick={() => onToggleAsistencia(u)}
                       disabled={actionLoading === `toggle-${u.id}`}>
                    {actionLoading === `toggle-${u.id}`
                      ? <Loader2 size={12} className="animate-spin" />
                      : u.verify ? <XCircle size={12} aria-hidden="true" /> : <CheckCircle2 size={12} aria-hidden="true" />
                    }
                  </Btn>
                  <Btn variant="secondary" size="sm"
                       onClick={() => onRemoveUsuario(u)}
                       disabled={actionLoading === `remove-${u.id}`}>
                    {actionLoading === `remove-${u.id}`
                      ? <Loader2 size={12} className="animate-spin" />
                      : <UserMinus size={12} aria-hidden="true" />
                    }
                  </Btn>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Overlay: foto ampliada 5×4 cm */}
      {fotoPreview && (
        <div onClick={() => setFotoPreview(null)}
             role="dialog" aria-modal="true" aria-label={`Foto de ${fotoPreview.nombre}`}
             style={{
               position: 'fixed', inset: 0, zIndex: 1000,
               background: 'rgba(0,0,0,0.75)',
               display: 'flex', alignItems: 'center', justifyContent: 'center',
               cursor: 'zoom-out',
             }}>
          <div onClick={e => e.stopPropagation()}
               style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            {fotoPreview.imgUrl ? (
              <img src={fotoPreview.imgUrl} alt={fotoPreview.nombre}
                   style={{ width: '5cm', height: '4cm', objectFit: 'cover',
                            borderRadius: 12, border: '2px solid var(--line)', background: 'var(--bg-3)' }} />
            ) : (
              <div style={{
                width: '5cm', height: '4cm',
                borderRadius: 12, border: '2px solid var(--line)', background: 'var(--bg-3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--text-3)', fontSize: 14,
              }}>
                Sin foto
              </div>
            )}
            <p style={{ color: '#fff', fontFamily: 'Outfit', fontSize: 14, fontWeight: 600 }}>
              {fotoPreview.nombre}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
