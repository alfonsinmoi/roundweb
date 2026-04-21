import { useState, useEffect } from 'react'
import { Users, Clock, Loader2, Plus, Pencil, ToggleLeft, ToggleRight, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react'
import { Card, Badge, Btn } from '../components/UI'
import { useToast } from '../components/Toast'
import ConfirmDialog from '../components/ConfirmDialog'
import Modal from '../components/Modal'
import { colorFromName } from '../utils/colors'
import { formatHora } from '../utils/formatters'
import { getActividades, guardarActividad, getSalas } from '../utils/api'

const EMPTY_FORM = { nombre: '', aforo: '10', tiempoAntelacion: '', idEspejo: '' }
const DIAS_CORTO = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

function toLocalDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getMondayOf(d) {
  const n = new Date(d)
  n.setHours(0, 0, 0, 0)
  n.setDate(n.getDate() - ((n.getDay() + 6) % 7))
  return n
}

export default function Actividades() {
  const [actividades, setActividades] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [salas, setSalas] = useState([])
  const [selActId, setSelActId] = useState(null)
  const [selActDate, setSelActDate] = useState(new Date())
  const [showSemana, setShowSemana] = useState(false)
  const [semanaBase, setSemanaBase] = useState(() => getMondayOf(new Date()))
  const toast = useToast()

  // Modal state for create/edit
  const [modalOpen, setModalOpen] = useState(false)
  const [editingAct, setEditingAct] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  // Confirm dialog state for toggle
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [toggleTarget, setToggleTarget] = useState(null)

  const fetchData = () => {
    setLoading(true)
    Promise.all([
      getActividades(),
      getSalas().catch(() => []),
    ])
      .then(([acts, s]) => {
        setActividades(acts)
        setSalas(s.filter(x => x.enabled !== false))
      })
      .catch(() => setError('No se pudieron cargar las actividades'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchData() }, [])

  const updateField = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  const openCreateModal = () => {
    setEditingAct(null)
    setForm(EMPTY_FORM)
    setModalOpen(true)
  }

  const openEditModal = (act) => {
    const nombre = act.Nombre ?? act.nombre ?? ''
    setEditingAct(act)
    setForm({
      nombre,
      aforo: String(act.numMaxReservas ?? '10'),
      tiempoAntelacion: String(act.tiempoAntelacionReserva ?? ''),
      idEspejo: String(act.idEspejo ?? ''),
    })
    setModalOpen(true)
  }

  const closeModal = () => {
    if (!saving) {
      setModalOpen(false)
      setEditingAct(null)
      setForm(EMPTY_FORM)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const nombre = form.nombre.trim()
    if (!nombre) return

    setSaving(true)
    try {
      if (editingAct) {
        await guardarActividad({
          ...editingAct,
          Nombre: nombre,
          numMaxReservas: Number(form.aforo) || editingAct.numMaxReservas,
          tiempoAntelacionReserva: form.tiempoAntelacion ? Number(form.tiempoAntelacion) : editingAct.tiempoAntelacionReserva,
          idEspejo: form.idEspejo ? Number(form.idEspejo) : editingAct.idEspejo,
        })
        toast.success('Actividad modificada correctamente')
      } else {
        await guardarActividad({
          Nombre: nombre,
          numMaxReservas: Number(form.aforo) || 10,
          enabled: true,
          idEspejo: form.idEspejo ? Number(form.idEspejo) : undefined,
        })
        toast.success('Actividad creada correctamente')
      }
      closeModal()
      fetchData()
    } catch {
      toast.error('No se pudo guardar la actividad. Inténtalo de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  const requestToggle = (act) => {
    setToggleTarget(act)
    setConfirmOpen(true)
  }

  const handleToggleConfirm = async () => {
    if (!toggleTarget) return
    const activa = toggleTarget.enabled !== false
    setConfirmOpen(false)
    try {
      await guardarActividad({ ...toggleTarget, enabled: !activa })
      setActividades(prev => prev.map(a => a.id === toggleTarget.id ? { ...a, enabled: !activa } : a))
      toast.success(activa ? 'Actividad desactivada' : 'Actividad activada')
    } catch {
      toast.error('No se pudo cambiar el estado de la actividad.')
    } finally {
      setToggleTarget(null)
    }
  }

  const handleToggleCancel = () => {
    setConfirmOpen(false)
    setToggleTarget(null)
  }

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '120px 0' }}>
      <Loader2 size={22} className="animate-spin" style={{ color: 'var(--green)' }} aria-label="Cargando actividades" />
    </div>
  )

  if (error) return (
    <div style={{ padding: '80px 0', textAlign: 'center', fontSize: 14, color: 'var(--red)' }}>
      {error}
    </div>
  )

  const toggleActiva = toggleTarget ? toggleTarget.enabled !== false : false

  return (
    <div style={{ maxWidth: 900 }}>

      {/* Toolbar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <p style={{ fontSize: 13, color: 'var(--text-3)' }}>
          {actividades.length} actividad{actividades.length !== 1 ? 'es' : ''}
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <Btn variant="secondary" size="md" onClick={() => { setSemanaBase(getMondayOf(new Date())); setShowSemana(true) }}>
            <CalendarDays size={15} aria-hidden="true" /> Clases de la semana
          </Btn>
          <Btn variant="primary" size="md" onClick={openCreateModal}>
            <Plus size={15} aria-hidden="true" /> Nueva actividad
          </Btn>
        </div>
      </div>

      {/* Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 16 }}>
        {actividades.map(act => {
          const nombre = act.Nombre ?? act.nombre ?? '—'
          const color  = colorFromName(nombre)
          const activa = act.enabled !== false
          const open      = selActId === act.id
          const fechaStr  = toLocalDateStr(selActDate)
          const clasesHoy = salas.filter(s => s.nameTraining === nombre && toLocalDateStr(new Date(s.dateStart)) === fechaStr)
          return (
            <Card key={act.id} style={{ padding: 0, overflow: 'hidden' }}>
              {/* Card header — clickable to expand */}
              <button
                onClick={() => { if (open) { setSelActId(null) } else { setSelActId(act.id); setSelActDate(new Date()) } }}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 16,
                  width: '100%', padding: 28, background: 'none', border: 'none',
                  cursor: 'pointer', textAlign: 'left',
                  borderBottom: open ? '1px solid var(--line)' : 'none',
                }}
              >
                <div style={{ width: 16, height: 16, borderRadius: '50%', marginTop: 3, flexShrink: 0, background: color }} aria-hidden="true" />
                <div style={{ flex: 1, minWidth: 0 }}>

                  {/* Header row */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
                    <h3 style={{ fontFamily: 'Outfit', fontWeight: 600, fontSize: 15, color: 'var(--text-0)' }}>{nombre}</h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Badge color={activa ? 'green' : 'gray'}>{activa ? 'Activa' : 'Inactiva'}</Badge>
                      {open ? <ChevronUp size={14} style={{ color: 'var(--text-3)', flexShrink: 0 }} /> : <ChevronDown size={14} style={{ color: 'var(--text-3)', flexShrink: 0 }} />}
                    </div>
                  </div>

                  {/* Info */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, marginBottom: act.listaEspera || act.reservarLargoPlazo ? 12 : 0 }}>
                    {act.idEspejo != null && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 13, color: 'var(--text-3)' }}>ID Espejo:</span>
                        <span style={{ fontSize: 13, color: 'var(--text-2)', fontFamily: 'monospace' }}>{act.idEspejo}</span>
                      </div>
                    )}
                    {act.numMaxReservas != null && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Users size={13} style={{ color: 'var(--text-3)' }} aria-hidden="true" />
                        <span style={{ fontSize: 13, color: 'var(--text-2)' }}>Aforo: {act.numMaxReservas}</span>
                      </div>
                    )}
                    {act.tiempoAntelacionReserva != null && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Clock size={13} style={{ color: 'var(--text-3)' }} aria-hidden="true" />
                        <span style={{ fontSize: 13, color: 'var(--text-2)' }}>Antelación: {act.tiempoAntelacionReserva}h</span>
                      </div>
                    )}
                  </div>

                  {/* Badges */}
                  {(act.listaEspera || act.reservarLargoPlazo) && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      {act.listaEspera && <Badge color="yellow">Lista espera</Badge>}
                      {act.reservarLargoPlazo && <Badge color="blue">Largo plazo</Badge>}
                    </div>
                  )}
                </div>
              </button>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 10, padding: '14px 28px', borderTop: '1px solid var(--line)' }}>
                <button onClick={() => requestToggle(act)} className={activa ? 'act-btn-toggle-off' : 'act-btn-toggle-on'}>
                  {activa ? <ToggleRight size={15} aria-hidden="true" /> : <ToggleLeft size={15} aria-hidden="true" />}
                  {activa ? 'Desactivar' : 'Activar'}
                </button>
                <button onClick={() => openEditModal(act)} className="act-btn-edit">
                  <Pencil size={14} aria-hidden="true" /> Modificar
                </button>
              </div>

              {/* Clases del día seleccionado — expanded */}
              {open && (
                <div style={{ padding: '16px 28px 20px', background: 'var(--bg-3)' }}>
                  {/* Date navigator */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <button onClick={() => setSelActDate(d => { const n = new Date(d); n.setDate(n.getDate() - 1); return n })}
                            style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--bg-2)', cursor: 'pointer', color: 'var(--text-3)', display: 'flex', alignItems: 'center' }}>
                      <ChevronLeft size={14} />
                    </button>
                    <p style={{ fontSize: 12, fontWeight: 600, color: color, textTransform: 'capitalize', flex: 1, textAlign: 'center' }}>
                      {selActDate.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}
                      {toLocalDateStr(selActDate) === toLocalDateStr(new Date()) && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text-3)', fontWeight: 400, textTransform: 'uppercase' }}>hoy</span>}
                    </p>
                    <button onClick={() => setSelActDate(d => { const n = new Date(d); n.setDate(n.getDate() + 1); return n })}
                            style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--bg-2)', cursor: 'pointer', color: 'var(--text-3)', display: 'flex', alignItems: 'center' }}>
                      <ChevronRight size={14} />
                    </button>
                  </div>
                  {clasesHoy.length === 0 ? (
                    <p style={{ fontSize: 13, color: 'var(--text-3)', padding: '12px 0' }}>
                      Sin clases programadas el {selActDate.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}
                    </p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {clasesHoy.sort((a, b) => new Date(a.dateStart) - new Date(b.dateStart)).map(s => (
                        <div key={s.id} style={{
                          display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                          borderRadius: 12, background: 'var(--bg-2)', border: '1px solid var(--line)',
                        }}>
                          <div style={{ width: 3, height: 32, borderRadius: 2, background: color, flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-0)' }}>{s.name || s.nameTraining}</p>
                            {s.nameTrainer && <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{s.nameTrainer}</p>}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-3)', flexShrink: 0 }}>
                            <Clock size={11} aria-hidden="true" />
                            {formatHora(s.dateStart)}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-3)', flexShrink: 0 }}>
                            <Users size={11} aria-hidden="true" />
                            {s.users?.length ?? 0}/{s.aforo || '∞'}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Card>
          )
        })}

        {actividades.length === 0 && (
          <div style={{ gridColumn: '1 / -1', padding: '80px 0', textAlign: 'center', color: 'var(--text-3)', fontSize: 14 }}>
            No hay actividades registradas
          </div>
        )}
      </div>

      {/* Sin actividad */}
      {(() => {
        const nombresAct = new Set(actividades.map(a => a.Nombre ?? a.nombre).filter(Boolean))
        const hoyStr = toLocalDateStr(new Date())
        const sinAct = salas.filter(s =>
          toLocalDateStr(new Date(s.dateStart)) === hoyStr &&
          (!s.nameTraining || !nombresAct.has(s.nameTraining))
        )
        return (
          <div style={{ marginTop: 32 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <h2 style={{ fontFamily: 'Outfit', fontSize: 16, fontWeight: 600, color: 'var(--text-0)' }}>Sin actividad</h2>
              <Badge color="gray">{sinAct.length}</Badge>
            </div>
            <Card style={{ padding: sinAct.length === 0 ? '32px 28px' : '20px 28px' }}>
              {sinAct.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--text-3)', textAlign: 'center' }}>
                  Todas las clases de hoy tienen actividad asignada
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {sinAct.sort((a, b) => new Date(a.dateStart) - new Date(b.dateStart)).map(s => (
                    <div key={s.id} style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                      borderRadius: 12, background: 'var(--bg-3)', border: '1px solid var(--line)',
                    }}>
                      <div style={{ width: 3, height: 32, borderRadius: 2, background: 'var(--text-3)', flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-0)' }}>{s.name || '—'}</p>
                        {s.nameTrainer && <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{s.nameTrainer}</p>}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-3)', flexShrink: 0 }}>
                        <Clock size={11} aria-hidden="true" />
                        {formatHora(s.dateStart)}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-3)', flexShrink: 0 }}>
                        <Users size={11} aria-hidden="true" />
                        {s.users?.length ?? 0}/{s.aforo || '∞'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        )
      })()}

      {/* Create / Edit Modal */}
      <Modal open={modalOpen} onClose={closeModal} title={editingAct ? 'Modificar actividad' : 'Nueva actividad'} disabled={saving}>
        <form onSubmit={handleSubmit}>
          <div style={{ padding: '28px 32px', display: 'flex', flexDirection: 'column', gap: 20 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-2)' }}>Nombre</span>
              <input
                type="text"
                value={form.nombre}
                onChange={e => updateField('nombre', e.target.value)}
                required
                autoFocus
                style={{
                  padding: '10px 14px', borderRadius: 10, fontSize: 14,
                  background: 'var(--bg-3)', border: '1px solid var(--line)',
                  color: 'var(--text-0)', outline: 'none',
                }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-2)' }}>Aforo m\u00e1ximo (n\u00ba reservas)</span>
              <input
                type="number"
                min="1"
                value={form.aforo}
                onChange={e => updateField('aforo', e.target.value)}
                style={{
                  padding: '10px 14px', borderRadius: 10, fontSize: 14,
                  background: 'var(--bg-3)', border: '1px solid var(--line)',
                  color: 'var(--text-0)', outline: 'none',
                }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-2)' }}>Tiempo antelaci\u00f3n reserva (horas)</span>
              <input
                type="number"
                min="0"
                value={form.tiempoAntelacion}
                onChange={e => updateField('tiempoAntelacion', e.target.value)}
                placeholder="Opcional"
                style={{
                  padding: '10px 14px', borderRadius: 10, fontSize: 14,
                  background: 'var(--bg-3)', border: '1px solid var(--line)',
                  color: 'var(--text-0)', outline: 'none',
                }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-2)' }}>ID Espejo</span>
              <input
                type="number"
                value={form.idEspejo}
                onChange={e => updateField('idEspejo', e.target.value)}
                placeholder="Opcional"
                style={{
                  padding: '10px 14px', borderRadius: 10, fontSize: 14,
                  background: 'var(--bg-3)', border: '1px solid var(--line)',
                  color: 'var(--text-0)', outline: 'none',
                }}
              />
            </label>
          </div>
          <div style={{ padding: '20px 32px', borderTop: '1px solid var(--line)', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Btn variant="secondary" size="md" onClick={closeModal} type="button" disabled={saving}>Cancelar</Btn>
            <Btn variant="primary" size="md" type="submit" disabled={saving || !form.nombre.trim()}>
              {saving ? 'Guardando\u2026' : (editingAct ? 'Guardar cambios' : 'Crear actividad')}
            </Btn>
          </div>
        </form>
      </Modal>

      {/* Toggle Confirm Dialog */}
      <ConfirmDialog
        open={confirmOpen}
        title={toggleActiva ? 'Desactivar actividad' : 'Activar actividad'}
        message={toggleActiva ? '\u00bfDesactivar esta actividad? No aparecer\u00e1 disponible para nuevas reservas.' : '\u00bfActivar esta actividad? Estar\u00e1 disponible para reservas.'}
        confirmText={toggleActiva ? 'Desactivar' : 'Activar'}
        variant={toggleActiva ? 'danger' : 'primary'}
        onConfirm={handleToggleConfirm}
        onCancel={handleToggleCancel}
      />

      {/* Button styles via CSS classes instead of onMouseEnter/Leave */}
      <style>{`
        .act-btn-toggle-off,
        .act-btn-toggle-on,
        .act-btn-edit {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 16px;
          border-radius: 10px;
          font-size: 13px;
          cursor: pointer;
          border: none;
          transition: background 0.1s, color 0.1s, border-color 0.1s;
        }
        .act-btn-toggle-off {
          background: rgba(248,113,113,0.06);
          color: var(--red);
        }
        .act-btn-toggle-off:hover {
          background: rgba(248,113,113,0.12);
        }
        .act-btn-toggle-on {
          background: rgba(45,212,168,0.08);
          color: var(--green);
        }
        .act-btn-toggle-on:hover {
          background: rgba(45,212,168,0.15);
        }
        .act-btn-edit {
          background: var(--bg-3);
          border: 1px solid var(--line);
          color: var(--text-2);
        }
        .act-btn-edit:hover {
          color: var(--green);
          border-color: var(--green);
        }
      `}</style>

      {/* Modal: clases de la semana ordenadas por actividad */}
      <Modal
        open={showSemana}
        onClose={() => setShowSemana(false)}
        title="Clases de la semana"
        maxWidth={700}
      >
        {(() => {
          const domingo = new Date(semanaBase); domingo.setDate(semanaBase.getDate() + 6)
          const clasesSemanales = salas.filter(s => {
            const d = new Date(s.dateStart)
            return d >= semanaBase && d <= domingo
          })

          // Group by nameTraining (actividad), sort groups alphabetically, within each group sort by dateStart
          const grupos = {}
          clasesSemanales.forEach(s => {
            const key = s.nameTraining || '— Sin actividad'
            if (!grupos[key]) grupos[key] = []
            grupos[key].push(s)
          })
          const gruposOrdenados = Object.entries(grupos)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([act, clases]) => ({ act, clases: clases.sort((a, b) => new Date(a.dateStart) - new Date(b.dateStart)) }))

          return (
            <>
              {/* Week navigator */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 32px', borderBottom: '1px solid var(--line)' }}>
                <button onClick={() => setSemanaBase(d => { const n = new Date(d); n.setDate(n.getDate() - 7); return n })}
                        style={{ padding: '6px 10px', borderRadius: 9, border: '1px solid var(--line)', background: 'var(--bg-2)', cursor: 'pointer', color: 'var(--text-3)', display: 'flex' }}>
                  <ChevronLeft size={15} />
                </button>
                <p style={{ flex: 1, textAlign: 'center', fontSize: 14, fontWeight: 600, color: 'var(--text-0)' }}>
                  {semanaBase.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
                  {' — '}
                  {domingo.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })}
                </p>
                <button onClick={() => setSemanaBase(d => { const n = new Date(d); n.setDate(n.getDate() + 7); return n })}
                        style={{ padding: '6px 10px', borderRadius: 9, border: '1px solid var(--line)', background: 'var(--bg-2)', cursor: 'pointer', color: 'var(--text-3)', display: 'flex' }}>
                  <ChevronRight size={15} />
                </button>
              </div>

              {/* Class list */}
              <div style={{ overflowY: 'auto', maxHeight: '60vh', padding: '20px 32px 28px' }}>
                {gruposOrdenados.length === 0 ? (
                  <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-3)', padding: '40px 0' }}>
                    No hay clases esta semana
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                    {gruposOrdenados.map(({ act, clases }) => {
                      const col = act === '— Sin actividad' ? 'var(--text-3)' : colorFromName(act)
                      return (
                        <div key={act}>
                          {/* Activity header */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                            <div style={{ width: 10, height: 10, borderRadius: '50%', background: col, flexShrink: 0 }} />
                            <p style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: col }}>
                              {act}
                            </p>
                            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>({clases.length})</span>
                          </div>
                          {/* Classes */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 18 }}>
                            {clases.map(s => (
                              <div key={s.id} style={{
                                display: 'grid', gridTemplateColumns: '90px 1fr 1fr auto',
                                alignItems: 'center', gap: 12,
                                padding: '9px 14px', borderRadius: 10,
                                background: 'var(--bg-3)', border: '1px solid var(--line)',
                              }}>
                                {/* Day + time */}
                                <div>
                                  <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase' }}>
                                    {DIAS_CORTO[new Date(s.dateStart).getDay()]} {new Date(s.dateStart).getDate()}
                                  </p>
                                  <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-0)', marginTop: 1, display: 'flex', alignItems: 'center', gap: 3 }}>
                                    <Clock size={10} aria-hidden="true" /> {formatHora(s.dateStart)}
                                  </p>
                                </div>
                                {/* Name */}
                                <p style={{ fontSize: 13, color: 'var(--text-0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {s.name || s.nameTraining}
                                </p>
                                {/* Trainer */}
                                <p style={{ fontSize: 12, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {s.nameTrainer || '—'}
                                </p>
                                {/* Inscribed */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-3)', flexShrink: 0 }}>
                                  <Users size={11} aria-hidden="true" />
                                  {s.users?.length ?? 0}/{s.aforo || '∞'}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              <div style={{ padding: '14px 32px', borderTop: '1px solid var(--line)' }}>
                <Btn variant="secondary" size="md" onClick={() => setShowSemana(false)} style={{ width: '100%', justifyContent: 'center' }}>
                  Cerrar
                </Btn>
              </div>
            </>
          )
        })()}
      </Modal>
    </div>
  )
}
