import { useState, useEffect } from 'react'
import { Users, Clock, Loader2, Plus, Pencil, ToggleLeft, ToggleRight } from 'lucide-react'
import { Card, Badge, Btn } from '../components/UI'
import { useToast } from '../components/Toast'
import ConfirmDialog from '../components/ConfirmDialog'
import Modal from '../components/Modal'
import { colorFromName } from '../utils/colors'
import { getActividades, guardarActividad } from '../utils/api'

const EMPTY_FORM = { nombre: '', aforo: '10', tiempoAntelacion: '', idEspejo: '' }

export default function Actividades() {
  const [actividades, setActividades] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
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
    getActividades()
      .then(data => setActividades(data))
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
        <Btn variant="primary" size="md" onClick={openCreateModal}>
          <Plus size={15} aria-hidden="true" /> Nueva actividad
        </Btn>
      </div>

      {/* Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 16 }}>
        {actividades.map(act => {
          const nombre = act.Nombre ?? act.nombre ?? '—'
          const color = colorFromName(nombre)
          const activa = act.enabled !== false
          return (
            <Card key={act.id} style={{ padding: 28 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                <div style={{ width: 16, height: 16, borderRadius: '50%', marginTop: 3, flexShrink: 0, background: color }} aria-hidden="true" />
                <div style={{ flex: 1, minWidth: 0 }}>

                  {/* Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
                    <h3 style={{ fontFamily: 'Outfit', fontWeight: 600, fontSize: 15, color: 'var(--text-0)' }}>{nombre}</h3>
                    <Badge color={activa ? 'green' : 'gray'}>{activa ? 'Activa' : 'Inactiva'}</Badge>
                  </div>

                  {/* Info */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, marginBottom: 20 }}>
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
                        <span style={{ fontSize: 13, color: 'var(--text-2)' }}>Antelaci\u00f3n: {act.tiempoAntelacionReserva}h</span>
                      </div>
                    )}
                  </div>

                  {/* Badges */}
                  {(act.listaEspera || act.reservarLargoPlazo) && (
                    <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
                      {act.listaEspera && <Badge color="yellow">Lista espera</Badge>}
                      {act.reservarLargoPlazo && <Badge color="blue">Largo plazo</Badge>}
                    </div>
                  )}

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 10, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
                    <button
                      onClick={() => requestToggle(act)}
                      className={activa ? 'act-btn-toggle-off' : 'act-btn-toggle-on'}
                    >
                      {activa
                        ? <ToggleRight size={15} aria-hidden="true" />
                        : <ToggleLeft size={15} aria-hidden="true" />}
                      {activa ? 'Desactivar' : 'Activar'}
                    </button>
                    <button
                      onClick={() => openEditModal(act)}
                      className="act-btn-edit"
                    >
                      <Pencil size={14} aria-hidden="true" /> Modificar
                    </button>
                  </div>
                </div>
              </div>
            </Card>
          )
        })}

        {actividades.length === 0 && (
          <div style={{ gridColumn: '1 / -1', padding: '80px 0', textAlign: 'center', color: 'var(--text-3)', fontSize: 14 }}>
            No hay actividades registradas
          </div>
        )}
      </div>

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
    </div>
  )
}
