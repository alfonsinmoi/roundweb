import { useState, useEffect, useCallback } from 'react'
import {
  Loader2, Trash2, Clock, Users, Monitor, RepeatIcon,
  CalendarDays, Info, ChevronDown, ChevronUp, Eye,
} from 'lucide-react'
import { Card, Badge, Btn } from '../components/UI'
import Modal from '../components/Modal'
import ConfirmDialog from '../components/ConfirmDialog'
import { useToast } from '../components/Toast'
import {
  getSalasByRange, saveSala, removeSala, invalidateSalasCache,
  getActividades, getEntrenadores, getSensores,
} from '../utils/api'
import { formatHora } from '../utils/formatters'

// ── Constants ────────────────────────────────────────────────────────────────

const DIAS_LABEL = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
// ISO weekday index (0=Mon…6=Sun) → display label (Mon first)
const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

// ── Helpers ──────────────────────────────────────────────────────────────────

function toDateLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Returns HH:mm string from ISO date
function toHHMM(isoStr) {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  return isNaN(d) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// Normalize name: lowercase, trim
function normName(s) {
  return (s || '').trim().toLowerCase()
}

// Returns ISO weekday 0=Mon…6=Sun
function isoWeekday(d) {
  return (new Date(d).getDay() + 6) % 7
}

// Format date range as "dd/mm/yyyy – dd/mm/yyyy"
function fmtRange(d1, d2) {
  const fmt = d => new Date(d).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })
  return `${fmt(d1)} – ${fmt(d2)}`
}

// Convert a datetime-local string value to an ISO string preserving local timezone
function datetimeLocalToISO(val) {
  if (!val) return null
  return new Date(val).toISOString()
}

// Convert an ISO string to the value expected by datetime-local inputs
function isoToDatetimeLocal(isoStr) {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  if (isNaN(d)) return ''
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ── Cyclic detection ─────────────────────────────────────────────────────────
// Group salas where same (normalizedName + HH:mm) appears on 2+ different calendar dates.
// Returns { cyclicGroups: [ { key, instances, days, dateFirst, dateLast } ], singles: [ sala ] }

function detectCyclic(salas) {
  const map = new Map()

  for (const s of salas) {
    const key = `${normName(s.name || s.nameTraining)}|${toHHMM(s.dateStart)}`
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(s)
  }

  const cyclicGroups = []
  const singleIds = new Set()

  for (const [key, instances] of map) {
    // Check that instances span at least 2 different calendar dates
    const dates = [...new Set(instances.map(s => toDateLocal(new Date(s.dateStart))))]
    if (dates.length >= 2) {
      const sorted = [...instances].sort((a, b) => new Date(a.dateStart) - new Date(b.dateStart))
      // Collect distinct weekdays (ISO 0=Mon)
      const weekdaySet = new Set(sorted.map(s => isoWeekday(s.dateStart)))
      cyclicGroups.push({
        key,
        instances: sorted,
        days: [...weekdaySet].sort(),
        dateFirst: sorted[0].dateStart,
        dateLast: sorted[sorted.length - 1].dateStart,
      })
      for (const s of instances) singleIds.add(s.id)
    }
  }

  const singles = salas.filter(s => !singleIds.has(s.id))
    .sort((a, b) => new Date(a.dateStart) - new Date(b.dateStart))

  // Sort cyclic groups by earliest occurrence time-of-day then name
  cyclicGroups.sort((a, b) => {
    const ta = toHHMM(a.dateFirst)
    const tb = toHHMM(b.dateFirst)
    return ta.localeCompare(tb) || (a.key).localeCompare(b.key)
  })

  return { cyclicGroups, singles }
}

// ── Blank form state ─────────────────────────────────────────────────────────

function blankForm() {
  return {
    nombre: '',
    nameTraining: '',
    nameTrainer: '',
    dateStart: '',
    duracionMin: '60',
    aforo: '10',
    idEspejo: '',
    enabled: true,
  }
}

function salaToForm(sala) {
  return {
    nombre: sala.name || '',
    nameTraining: sala.nameTraining || '',
    nameTrainer: sala.nameTrainer || '',
    dateStart: isoToDatetimeLocal(sala.dateStart),
    duracionMin: sala.durationTraining ? String(Math.round(sala.durationTraining / 60)) : '60',
    aforo: String(sala.aforo ?? '10'),
    idEspejo: sala.idEspejo != null ? String(sala.idEspejo) : '',
    enabled: sala.enabled !== false,
  }
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ClasesModificacion() {
  const toast = useToast()

  const [salas, setSalas]     = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  // Catalogues
  const [actividades, setActividades]   = useState([])
  const [entrenadores, setEntrenadores] = useState([])
  const [sensores, setSensores]         = useState([])

  // Edit/create modal
  const [modal, setModal] = useState({ open: false, sala: null, cyclicGroup: null })
  const [form, setForm]   = useState(blankForm())
  const [saving, setSaving] = useState(false)

  // Delete confirm
  const [confirmDelete, setConfirmDelete] = useState({ open: false, sala: null })

  // Collapsed state for cyclic groups (key → bool)
  const [collapsed, setCollapsed] = useState({})

  // ── Load data ──────────────────────────────────────────────────────────────

  const loadSalas = useCallback(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const until = new Date(today)
    until.setDate(today.getDate() + 56) // 8 weeks

    setLoading(true)
    setError('')
    getSalasByRange(today, until)
      .then(d => setSalas(Array.isArray(d) ? d : []))
      .catch(() => setError('Error cargando clases'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { loadSalas() }, [loadSalas])

  useEffect(() => {
    getActividades().then(d => setActividades(Array.isArray(d) ? d : [])).catch(() => {})
    getEntrenadores().then(d => setEntrenadores(Array.isArray(d) ? d : [])).catch(() => {})
    getSensores().then(d => setSensores(Array.isArray(d) ? d : [])).catch(() => {})
  }, [])

  // ── Derived data ───────────────────────────────────────────────────────────

  const { cyclicGroups, singles } = detectCyclic(salas)

  // ── Sensor lookup helper ───────────────────────────────────────────────────

  function sensorLabel(idEspejo) {
    if (idEspejo == null || idEspejo === '') return null
    const s = sensores.find(x => x.id === Number(idEspejo) || x.id === idEspejo)
    if (!s) return `ID ${idEspejo}`
    return s.alias || (s.numero != null ? `Espejo #${s.numero}` : s.uuid || `ID ${idEspejo}`)
  }

  // ── Modal open helpers ─────────────────────────────────────────────────────

  function openView(sala, cyclicGroup = null) {
    setForm(salaToForm(sala))
    setModal({ open: true, sala, cyclicGroup })
  }

  function closeModal() {
    if (saving) return
    setModal({ open: false, sala: null, cyclicGroup: null })
  }

  // ── Save ───────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!form.nombre.trim()) { toast.warning('El nombre es obligatorio'); return }
    if (!form.dateStart) { toast.warning('La fecha de inicio es obligatoria'); return }

    setSaving(true)
    try {
      const payload = {
        ...(modal.sala ?? {}),
        name: form.nombre.trim(),
        nameTraining: form.nameTraining || undefined,
        nameTrainer: form.nameTrainer || undefined,
        dateStart: datetimeLocalToISO(form.dateStart),
        durationTraining: form.duracionMin ? Number(form.duracionMin) * 60 : undefined,
        aforo: form.aforo ? Number(form.aforo) : undefined,
        idEspejo: form.idEspejo !== '' ? Number(form.idEspejo) : undefined,
        enabled: form.enabled,
      }
      await saveSala(payload)
      toast.success(modal.sala ? 'Clase guardada' : 'Clase creada')
      setModal({ open: false, sala: null, cyclicGroup: null })
      invalidateSalasCache()
      loadSalas()
    } catch {
      toast.error(modal.sala ? 'Error al guardar la clase' : 'Error al crear la clase')
    } finally {
      setSaving(false)
    }
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  async function handleDelete() {
    const { sala } = confirmDelete
    if (!sala) return
    try {
      await removeSala(sala.id)
      setSalas(prev => prev.filter(s => s.id !== sala.id))
      toast.success('Clase eliminada')
      invalidateSalasCache()
    } catch {
      toast.error('Error al eliminar la clase')
    }
    setConfirmDelete({ open: false, sala: null })
  }

  // ── Loading / error states ─────────────────────────────────────────────────

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '120px 0' }}>
      <Loader2 size={22} className="animate-spin" style={{ color: 'var(--green)' }} />
    </div>
  )

  if (error) return (
    <div style={{ padding: '80px 0', textAlign: 'center', fontSize: 14, color: 'var(--red)' }}>{error}</div>
  )

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* ── Header toolbar ── */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontFamily: 'Outfit', fontSize: 22, fontWeight: 700, color: 'var(--text-0)', margin: 0 }}>
          Gestión de clases
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>
          Próximas 8 semanas · {salas.length} clase{salas.length !== 1 ? 's' : ''}
        </p>
      </div>

      {salas.length === 0 && (
        <div style={{ padding: '80px 20px', textAlign: 'center' }}>
          <CalendarDays size={32} style={{ color: 'var(--text-3)', margin: '0 auto 12px', display: 'block' }} />
          <p style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-2)' }}>No hay clases programadas</p>
          <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 6 }}>Crea la primera clase usando el botón superior</p>
        </div>
      )}

      {/* ── Cíclicas section ── */}
      {cyclicGroups.length > 0 && (
        <section style={{ marginBottom: 36 }}>
          <SectionHeader icon={RepeatIcon} label="Cíclicas" count={cyclicGroups.length} color="var(--green)" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {cyclicGroups.map(group => {
              const isCollapsed = collapsed[group.key] !== false // default collapsed
              const repSala = group.instances[0]
              return (
                <div key={group.key} style={{
                  borderRadius: 14,
                  border: '1px solid var(--line)',
                  borderLeft: '3px solid var(--green)',
                  background: 'var(--bg-2)',
                  overflow: 'hidden',
                }}>
                  {/* Group header row */}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '14px 20px', cursor: 'pointer',
                  }}
                    onClick={() => setCollapsed(c => ({ ...c, [group.key]: !isCollapsed }))}>

                    <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                      {/* Name */}
                      <span style={{ fontFamily: 'Outfit', fontSize: 15, fontWeight: 700, color: 'var(--text-0)', whiteSpace: 'nowrap' }}>
                        {repSala.name || repSala.nameTraining || '—'}
                      </span>

                      {/* Activity */}
                      {repSala.nameTraining && repSala.name !== repSala.nameTraining && (
                        <span style={{ fontSize: 13, color: 'var(--text-1)', whiteSpace: 'nowrap' }}>
                          {repSala.nameTraining}
                        </span>
                      )}

                      {/* Trainer */}
                      {repSala.nameTrainer && (
                        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-1)', whiteSpace: 'nowrap' }}>
                          {repSala.nameTrainer}
                        </span>
                      )}

                      {/* Time */}
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, fontWeight: 500, color: 'var(--text-1)', whiteSpace: 'nowrap' }}>
                        <Clock size={12} aria-hidden="true" />
                        {toHHMM(repSala.dateStart)}
                        {repSala.durationTraining > 0 && ` · ${Math.round(repSala.durationTraining / 60)} min`}
                      </span>

                      {/* Aforo */}
                      {repSala.aforo > 0 && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 500, color: 'var(--text-1)', whiteSpace: 'nowrap' }}>
                          <Users size={11} aria-hidden="true" />
                          {repSala.aforo} plazas
                        </span>
                      )}

                      {/* Display */}
                      {repSala.idEspejo != null && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 500, color: 'var(--text-1)', whiteSpace: 'nowrap' }}>
                          <Monitor size={11} aria-hidden="true" />
                          {sensorLabel(repSala.idEspejo)}
                        </span>
                      )}

                      {/* Cíclica badge */}
                      <Badge color="green">
                        <RepeatIcon size={9} aria-hidden="true" />
                        Cíclica
                      </Badge>

                      {/* Day-of-week badges */}
                      <DayBadges days={group.days} />

                      {/* Date range */}
                      <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-2)', whiteSpace: 'nowrap' }}>
                        {fmtRange(group.dateFirst, group.dateLast)}
                      </span>
                    </div>

                    {/* View + expand */}
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0, marginLeft: 8 }}>
                      <ActionBtn title="Ver clase" onClick={e => { e.stopPropagation(); openView(repSala, group) }}>
                        <Eye size={13} />
                      </ActionBtn>
                      <button
                        aria-label={isCollapsed ? 'Expandir sesiones' : 'Contraer sesiones'}
                        onClick={e => { e.stopPropagation(); setCollapsed(c => ({ ...c, [group.key]: !isCollapsed })) }}
                        style={{ padding: 6, borderRadius: 8, background: 'var(--bg-3)', border: '1px solid var(--line)', color: 'var(--text-2)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                        <span>{group.instances.length} sesiones</span>
                        {isCollapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
                      </button>
                    </div>
                  </div>

                  {/* Expanded: list of individual instances */}
                  {!isCollapsed && (
                    <div style={{ borderTop: '1px solid var(--line)', background: 'var(--bg-1)' }}>
                      {group.instances.map((s, i) => (
                        <InstanceRow
                          key={s.id}
                          sala={s}
                          sensorLabel={sensorLabel(s.idEspejo)}
                          isLast={i === group.instances.length - 1}
                          onEdit={() => openView(s, group)}
                          onDelete={() => setConfirmDelete({ open: true, sala: s })}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ── Únicas section ── */}
      {singles.length > 0 && (
        <section>
          <SectionHeader icon={CalendarDays} label="Únicas" count={singles.length} color="var(--text-3)" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {singles.map(s => (
              <SingleRow
                key={s.id}
                sala={s}
                sensorLabel={sensorLabel(s.idEspejo)}
                onEdit={() => openView(s, null)}
                onDelete={() => setConfirmDelete({ open: true, sala: s })}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── Edit / Create modal ── */}
      <Modal
        open={modal.open}
        onClose={closeModal}
        title={modal.sala ? (modal.sala.name || modal.sala.nameTraining || 'Clase') : ''}
        subtitle={modal.sala?.nameTraining && modal.sala.name !== modal.sala.nameTraining ? modal.sala.nameTraining : undefined}
        maxWidth={480}>

        <div style={{ padding: '24px 32px', display: 'flex', flexDirection: 'column', gap: 0 }}>

          {/* Cyclic info block */}
          {modal.cyclicGroup && (
            <div style={{
              display: 'flex', gap: 10, padding: '14px 16px', borderRadius: 12,
              background: 'var(--green-bg)', border: '1px solid rgba(45,212,168,0.25)', marginBottom: 20,
            }}>
              <Info size={16} style={{ color: 'var(--green)', flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--green)', marginBottom: 6 }}>Clase cíclica</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                  <DayBadges days={modal.cyclicGroup.days} />
                </div>
                <p style={{ fontSize: 12, color: 'var(--text-2)' }}>
                  {fmtRange(modal.cyclicGroup.dateFirst, modal.cyclicGroup.dateLast)} · {modal.cyclicGroup.instances.length} sesiones
                </p>
              </div>
            </div>
          )}

          {/* Read-only fields */}
          {[
            { label: 'Actividad',        value: form.nameTraining || '—' },
            { label: 'Monitor',          value: form.nameTrainer  || '—' },
            { label: 'Fecha y hora',     value: form.dateStart ? new Date(form.dateStart).toLocaleString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—' },
            { label: 'Duración',         value: form.duracionMin ? `${form.duracionMin} minutos` : '—' },
            { label: 'Aforo máximo',     value: form.aforo ? `${form.aforo} plazas` : '—' },
            { label: 'Display / Espejo', value: form.idEspejo ? (sensorLabel(form.idEspejo) ?? `ID ${form.idEspejo}`) : '—' },
            { label: 'Estado',           value: form.enabled ? 'Habilitada' : 'Deshabilitada' },
          ].map(({ label, value }) => (
            <div key={label} style={{
              display: 'flex', alignItems: 'baseline', gap: 12,
              padding: '12px 0', borderBottom: '1px solid var(--line)',
            }}>
              <span style={{ fontSize: 12, color: 'var(--text-3)', width: 130, flexShrink: 0 }}>{label}</span>
              <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-0)' }}>{value}</span>
            </div>
          ))}
        </div>

        <div style={{ padding: '20px 32px', borderTop: '1px solid var(--line)' }}>
          <Btn variant="secondary" size="md" onClick={closeModal} style={{ width: '100%', justifyContent: 'center' }}>
            Cerrar
          </Btn>
        </div>
      </Modal>

      {/* ── Delete confirmation ── */}
      <ConfirmDialog
        open={confirmDelete.open}
        title="Eliminar clase"
        message={`¿Eliminar la clase "${confirmDelete.sala?.name || confirmDelete.sala?.nameTraining || ''}"? Esta acción no se puede deshacer.`}
        confirmText="Eliminar"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete({ open: false, sala: null })}
      />
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, label, count, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      <Icon size={15} style={{ color }} aria-hidden="true" />
      <h2 style={{ fontFamily: 'Outfit', fontSize: 15, fontWeight: 600, color: 'var(--text-1)', margin: 0 }}>
        {label}
      </h2>
      <span style={{
        fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 8,
        background: 'var(--bg-3)', color: 'var(--text-3)', border: '1px solid var(--line)',
      }}>
        {count}
      </span>
    </div>
  )
}

// Row for an individual instance inside a cyclic group
function InstanceRow({ sala, sensorLabel, isLast, onEdit, onDelete }) {
  const d = new Date(sala.dateStart)
  const dateLabel = d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '12px 20px',
      borderBottom: isLast ? 'none' : '1px solid var(--line)',
    }}>
      <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-1)', minWidth: 160, whiteSpace: 'nowrap' }}>
        {dateLabel}
      </span>
      <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-1)', whiteSpace: 'nowrap' }}>
        {toHHMM(sala.dateStart)}
        {sala.durationTraining > 0 && <span> · {Math.round(sala.durationTraining / 60)} min</span>}
      </span>
      {sala.aforo > 0 && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 12, fontWeight: 500, color: 'var(--text-1)' }}>
          <Users size={11} aria-hidden="true" /> {sala.aforo} plazas
        </span>
      )}
      {sensorLabel && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 12, fontWeight: 500, color: 'var(--text-1)' }}>
          <Monitor size={11} aria-hidden="true" /> {sensorLabel}
        </span>
      )}
      {sala.enabled === false && <Badge color="gray">Desactivada</Badge>}
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
        <ActionBtn title="Ver" onClick={onEdit}><Eye size={13} /></ActionBtn>
        <ActionBtn title="Eliminar" onClick={onDelete} danger><Trash2 size={13} /></ActionBtn>
      </div>
    </div>
  )
}

// Row for a single (non-cyclic) class
function SingleRow({ sala, sensorLabel, onEdit, onDelete }) {
  const d = new Date(sala.dateStart)
  const dateLabel = d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
      padding: '14px 20px',
      borderRadius: 14,
      border: '1px solid var(--line)',
      borderLeft: '3px solid var(--line)',
      background: 'var(--bg-2)',
    }}>
      {/* Date */}
      <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-1)', minWidth: 150, whiteSpace: 'nowrap' }}>
        {dateLabel}
      </span>

      {/* Name */}
      <span style={{ fontFamily: 'Outfit', fontSize: 14, fontWeight: 700, color: 'var(--text-0)', whiteSpace: 'nowrap' }}>
        {sala.name || sala.nameTraining || '—'}
      </span>

      {/* Activity (if different from name) */}
      {sala.nameTraining && sala.name && sala.name !== sala.nameTraining && (
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-1)', whiteSpace: 'nowrap' }}>
          {sala.nameTraining}
        </span>
      )}

      {/* Trainer */}
      {sala.nameTrainer && (
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-1)', whiteSpace: 'nowrap' }}>
          {sala.nameTrainer}
        </span>
      )}

      {/* Time + duration */}
      <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, fontWeight: 500, color: 'var(--text-1)', whiteSpace: 'nowrap' }}>
        <Clock size={12} aria-hidden="true" />
        {toHHMM(sala.dateStart)}
        {sala.durationTraining > 0 && <span> · {Math.round(sala.durationTraining / 60)} min</span>}
      </span>

      {/* Aforo */}
      {sala.aforo > 0 && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 12, fontWeight: 500, color: 'var(--text-1)', whiteSpace: 'nowrap' }}>
          <Users size={11} aria-hidden="true" /> {sala.aforo} plazas
        </span>
      )}

      {/* Sensor */}
      {sensorLabel && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 12, fontWeight: 500, color: 'var(--text-1)', whiteSpace: 'nowrap' }}>
          <Monitor size={11} aria-hidden="true" /> {sensorLabel}
        </span>
      )}

      {/* Enabled badge */}
      {sala.enabled === false && <Badge color="gray">Desactivada</Badge>}

      {/* Actions */}
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
        <ActionBtn title="Ver" onClick={onEdit}><Eye size={13} /></ActionBtn>
        <ActionBtn title="Eliminar" onClick={onDelete} danger><Trash2 size={13} /></ActionBtn>
      </div>
    </div>
  )
}

// Small icon-only action button
function ActionBtn({ children, onClick, title, danger = false }) {
  return (
    <button
      title={title}
      onClick={e => { e.stopPropagation(); onClick() }}
      style={{
        padding: '8px 10px', borderRadius: 9, cursor: 'pointer',
        background: danger ? 'rgba(248,113,113,0.06)' : 'var(--bg-3)',
        border: `1px solid ${danger ? 'rgba(248,113,113,0.16)' : 'var(--line)'}`,
        color: danger ? 'var(--red)' : 'var(--text-3)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'background 0.12s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = danger ? 'rgba(248,113,113,0.14)' : 'var(--bg-1)' }}
      onMouseLeave={e => { e.currentTarget.style.background = danger ? 'rgba(248,113,113,0.06)' : 'var(--bg-3)' }}>
      {children}
    </button>
  )
}

// Day-of-week badge strip (days: array of ISO weekday 0=Mon…6=Sun)
function DayBadges({ days }) {
  const daySet = new Set(days)
  return (
    <span style={{ display: 'inline-flex', gap: 3 }}>
      {DIAS_SEMANA.map((label, i) => (
        <span key={i} style={{
          fontSize: 10, fontWeight: 600, padding: '3px 7px', borderRadius: 7,
          background: daySet.has(i) ? 'var(--green-bg)' : 'var(--bg-3)',
          color: daySet.has(i) ? 'var(--green)' : 'var(--text-3)',
          border: `1px solid ${daySet.has(i) ? 'rgba(45,212,168,0.25)' : 'var(--line)'}`,
        }}>
          {label}
        </span>
      ))}
    </span>
  )
}

// Label + children wrapper for form fields
function FormField({ label, id, children }) {
  return (
    <div>
      <label htmlFor={id} style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--text-2)', marginBottom: 8 }}>
        {label}
      </label>
      {children}
    </div>
  )
}

// Toggle switch (replaces checkbox)
function ToggleSwitch({ id, checked, onChange }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{
        position: 'relative', display: 'inline-flex', alignItems: 'center',
        width: 44, height: 24, borderRadius: 99, border: 'none', cursor: 'pointer',
        background: checked ? 'var(--green)' : 'var(--bg-3)',
        outline: '1px solid var(--line)',
        transition: 'background 0.2s',
        flexShrink: 0,
      }}>
      <span style={{
        position: 'absolute', width: 18, height: 18, borderRadius: '50%',
        background: checked ? '#fff' : 'var(--text-3)',
        left: checked ? 22 : 3,
        transition: 'left 0.2s, background 0.2s',
      }} />
    </button>
  )
}

// Shared input style
const inputStyle = {
  width: '100%',
  padding: '13px 16px',
  borderRadius: 12,
  fontSize: 14,
  background: 'var(--bg-1)',
  border: '1px solid var(--line)',
  color: 'var(--text-0)',
  fontFamily: 'inherit',
}
