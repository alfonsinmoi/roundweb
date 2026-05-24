import { useState, useEffect, useCallback } from 'react'
import { Check, X, RefreshCcw, Filter, CalendarRange, Sun, Stethoscope, Coffee, Plus } from 'lucide-react'
import { Card, Btn, Badge, Table, EmptyState, Select, Input } from '../../components/UI'
import { useToast } from '../../components/Toast'
import Modal from '../../components/Modal'
import {
  ausenciasList, ausenciaAprobar, ausenciaRechazar,
  ausenciaCrearAdmin, trabajadoresList,
} from '../../utils/horarioApi'


const TIPO_LABEL = {
  vacaciones:         { label: 'Vacaciones',         icon: Sun,         color: 'cyan'   },
  asuntos_propios:    { label: 'Asuntos propios',    icon: CalendarRange, color: 'purple' },
  medico:             { label: 'Médico',             icon: Stethoscope, color: 'red'    },
  personal:           { label: 'Personal',           icon: Coffee,      color: 'amber'  },
  baja_medica:        { label: 'Baja médica',        icon: Stethoscope, color: 'red'    },
  permiso_retribuido: { label: 'Permiso retribuido', icon: CalendarRange, color: 'green'  },
  otros:              { label: 'Otros',              icon: Coffee,      color: 'gray'   },
}


export default function AusenciasTab({ identity }) {
  const toast = useToast()
  const [estado, setEstado] = useState('pendiente')
  const [trabajadorId, setTrabajadorId] = useState('')
  const [items, setItems] = useState([])
  const [trabajadores, setTrabajadores] = useState([])
  const [loading, setLoading] = useState(true)
  const [showNueva, setShowNueva] = useState(false)

  useEffect(() => {
    trabajadoresList(identity, { incluir_bajas: 1 }).then(setTrabajadores).catch(() => {})
  }, [identity])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const params = {}
      if (estado) params.estado = estado
      if (trabajadorId) params.trabajador_id = trabajadorId
      const list = await ausenciasList(identity, params)
      setItems(list || [])
    } catch (e) {
      toast.error('Error: ' + (e.message || '?'))
    } finally { setLoading(false) }
  }, [identity, estado, trabajadorId, toast])

  useEffect(() => { reload() }, [reload])

  async function handleAprobar(s) {
    const motivo = prompt('Comentario al aprobar (opcional):', '') ?? ''
    try {
      await ausenciaAprobar(identity, s.id, { motivo })
      toast.success('Solicitud aprobada')
      reload()
    } catch (e) { toast.error('Error: ' + (e.body?.detalle || e.message)) }
  }

  async function handleRechazar(s) {
    const motivo = prompt(`Motivo del rechazo (lo verá ${s.trabajador_nombre}):`, '')
    if (motivo === null) return
    try {
      await ausenciaRechazar(identity, s.id, { motivo })
      toast.success('Solicitud rechazada')
      reload()
    } catch (e) { toast.error('Error: ' + (e.body?.detalle || e.message)) }
  }

  const counts = {
    pendiente:  items.filter(x => x.estado === 'pendiente').length,
  }

  return (
    <div>
      {/* ── Filtros ─────────────────────────────────────────────────── */}
      <Card style={{ padding: 12, marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap' }}>
          <div>
            <label style={lblStyle}>Estado</label>
            <select value={estado} onChange={e => setEstado(e.target.value)} style={selectStyle}>
              <option value="pendiente">Pendientes</option>
              <option value="aprobada">Aprobadas</option>
              <option value="rechazada">Rechazadas</option>
              <option value="cancelada">Canceladas</option>
              <option value="">Todas</option>
            </select>
          </div>
          <div>
            <label style={lblStyle}>Trabajador</label>
            <select value={trabajadorId} onChange={e => setTrabajadorId(e.target.value)} style={selectStyle}>
              <option value="">Todos</option>
              {trabajadores.map(t => (
                <option key={t.id} value={t.id}>{t.nombre_completo || t.email || `#${t.id}`}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1 }} />
          <Btn variant="ghost" size="sm" onClick={reload}>
            <RefreshCcw size={14} /> Recargar
          </Btn>
          <Btn size="sm" onClick={() => setShowNueva(true)}>
            <Plus size={14} /> Nueva ausencia
          </Btn>
        </div>
      </Card>

      {loading && <p style={{ color: 'var(--text-3)' }}>Cargando…</p>}

      {!loading && items.length === 0 && (
        <EmptyState icon={Filter} title="Sin solicitudes"
                    description="No hay solicitudes que coincidan con los filtros." />
      )}

      {showNueva && (
        <NuevaAusenciaModal identity={identity}
                            trabajadores={trabajadores}
                            onClose={() => setShowNueva(false)}
                            onSaved={() => { setShowNueva(false); reload() }} />
      )}

      {!loading && items.length > 0 && (
        <Card style={{ padding: 0 }}>
          <Table
            ariaLabel="Solicitudes de ausencia"
            columns={[
              { key: 'trab', label: 'Trabajador', render: (_, r) => r.trabajador_nombre || `#${r.trabajador_id}` },
              { key: 'tipo', label: 'Tipo', render: (_, r) => {
                const cfg = TIPO_LABEL[r.tipo] || TIPO_LABEL.otros
                return <Badge color={cfg.color}>{cfg.label}</Badge>
              }},
              { key: 'periodo', label: 'Periodo', render: (_, r) => (
                <span>
                  <strong>{fmtDate(r.fecha_desde)}</strong>
                  {r.fecha_hasta !== r.fecha_desde && (
                    <> → <strong>{fmtDate(r.fecha_hasta)}</strong></>
                  )}
                  {!r.jornada_completa && (
                    <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-3)' }}>
                      ({r.hora_desde}–{r.hora_hasta})
                    </span>
                  )}
                </span>
              )},
              { key: 'dias', label: 'Días', render: (_, r) => (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                  {r.jornada_completa ? diasEntre(r.fecha_desde, r.fecha_hasta) : '½'}
                </span>
              )},
              { key: 'motivo', label: 'Motivo', render: (_, r) => (
                <span style={{ display: 'block', maxWidth: 240, whiteSpace: 'normal', fontSize: 12, color: 'var(--text-3)', fontStyle: 'italic' }}>
                  {r.motivo_trabajador || '—'}
                </span>
              )},
              { key: 'estado', label: 'Estado', render: (_, r) => (
                <Badge color={estadoColor(r.estado)}>{r.estado}</Badge>
              )},
              { key: 'acciones', label: '', render: (_, r) => r.estado === 'pendiente' ? (
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <Btn size="sm" variant="ghost" onClick={() => handleRechazar(r)}>
                    <X size={13} /> Rechazar
                  </Btn>
                  <Btn size="sm" onClick={() => handleAprobar(r)}>
                    <Check size={13} /> Aprobar
                  </Btn>
                </div>
              ) : (
                <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                  {r.motivo_resolucion || '—'}
                </span>
              )},
            ]}
            data={items}
          />
        </Card>
      )}
    </div>
  )
}


function fmtDate(iso) {
  if (!iso) return '—'
  try { return new Date(iso + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) }
  catch { return iso }
}
function diasEntre(d1, d2) {
  try {
    const a = new Date(d1 + 'T00:00:00')
    const b = new Date(d2 + 'T00:00:00')
    return Math.round((b - a) / 86400000) + 1
  } catch { return 1 }
}
function estadoColor(e) {
  return ({ pendiente: 'amber', aprobada: 'green', rechazada: 'red', cancelada: 'gray' })[e] || 'gray'
}


const lblStyle = { display: 'block', marginBottom: 4, fontSize: 11, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }
const selectStyle = {
  padding: '8px 10px', borderRadius: 8,
  border: '1px solid var(--line)', background: 'var(--bg-1)',
  color: 'var(--text-1)', fontSize: 13, minWidth: 180, cursor: 'pointer',
}


// ═══════════════════════════════════════════════════════════════════════════
// ║  NuevaAusenciaModal — admin crea ausencia directamente (aprobada)      ║
// ═══════════════════════════════════════════════════════════════════════════

const TIPOS_LIST = [
  { id: 'vacaciones',         label: 'Vacaciones' },
  { id: 'asuntos_propios',    label: 'Asuntos propios' },
  { id: 'medico',             label: 'Médico' },
  { id: 'personal',           label: 'Personal' },
  { id: 'baja_medica',        label: 'Baja médica' },
  { id: 'permiso_retribuido', label: 'Permiso retribuido' },
  { id: 'otros',              label: 'Otros' },
]


function NuevaAusenciaModal({ identity, trabajadores, onClose, onSaved }) {
  const toast = useToast()
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState({
    trabajador_id: '',
    tipo: 'vacaciones',
    fecha_desde: today,
    fecha_hasta: today,
    jornada_completa: true,
    hora_desde: '09:00',
    hora_hasta: '11:00',
    motivo_trabajador: '',
    motivo_resolucion: '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function handle(e) {
    e.preventDefault()
    if (!form.trabajador_id) {
      toast.error('Selecciona el trabajador')
      return
    }
    setSaving(true)
    try {
      await ausenciaCrearAdmin(identity, form)
      toast.success('Ausencia creada')
      onSaved()
    } catch (e) {
      toast.error('Error: ' + (e.body?.detalle || e.body?.error || e.message))
    } finally { setSaving(false) }
  }

  return (
    <Modal open onClose={onClose}
           title="Nueva ausencia"
           subtitle="Se creará como aprobada (sin pasar por solicitud)"
           maxWidth={560}>
      <form onSubmit={handle} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 32px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Select label="Trabajador *" value={form.trabajador_id}
                  onChange={e => set('trabajador_id', e.target.value)} required>
            <option value="">— Selecciona —</option>
            {trabajadores.map(t => (
              <option key={t.id} value={t.id}>
                {t.nombre_completo || t.email || `#${t.id}`}
              </option>
            ))}
          </Select>
          <Select label="Tipo" value={form.tipo}
                  onChange={e => set('tipo', e.target.value)}>
            {TIPOS_LIST.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </Select>

          <div>
            <label style={lblStyle}>Duración</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <SegBtn active={form.jornada_completa} onClick={() => set('jornada_completa', true)}>
                Día(s) completo(s)
              </SegBtn>
              <SegBtn active={!form.jornada_completa}
                      onClick={() => setForm(f => ({ ...f, jornada_completa: false, fecha_hasta: f.fecha_desde }))}>
                Por horas (mismo día)
              </SegBtn>
            </div>
          </div>

          {form.jornada_completa ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Input label="Desde" type="date" required value={form.fecha_desde}
                     onChange={e => setForm(f => ({ ...f, fecha_desde: e.target.value, fecha_hasta: f.fecha_hasta || e.target.value }))} />
              <Input label="Hasta" type="date" required value={form.fecha_hasta}
                     onChange={e => set('fecha_hasta', e.target.value)} />
            </div>
          ) : (
            <>
              <Input label="Día" type="date" required value={form.fecha_desde}
                     onChange={e => setForm(f => ({ ...f, fecha_desde: e.target.value, fecha_hasta: e.target.value }))} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Input label="Hora desde" type="time" required value={form.hora_desde}
                       onChange={e => set('hora_desde', e.target.value)} />
                <Input label="Hora hasta" type="time" required value={form.hora_hasta}
                       onChange={e => set('hora_hasta', e.target.value)} />
              </div>
            </>
          )}

          <Input label="Comentario interno (motivo, opcional)" value={form.motivo_trabajador}
                 onChange={e => set('motivo_trabajador', e.target.value)} />
          <Input label="Nota de resolución (visible para el trabajador, opcional)"
                 value={form.motivo_resolucion}
                 onChange={e => set('motivo_resolucion', e.target.value)} />
        </div>

        <div style={{
          padding: '14px 32px', borderTop: '1px solid var(--line)',
          background: 'var(--bg-2)', flexShrink: 0,
          display: 'flex', justifyContent: 'flex-end', gap: 8,
        }}>
          <Btn variant="ghost" type="button" onClick={onClose}>Cancelar</Btn>
          <Btn type="submit" disabled={saving}>
            <Plus size={13} /> {saving ? 'Creando…' : 'Crear ausencia'}
          </Btn>
        </div>
      </form>
    </Modal>
  )
}


function SegBtn({ active, children, onClick }) {
  return (
    <button type="button" onClick={onClick}
            style={{
              flex: 1, padding: '10px 12px', borderRadius: 10,
              border: active ? '1px solid var(--green, #10b981)' : '1px solid var(--line)',
              background: active ? 'var(--green-bg, rgba(16,185,129,0.10))' : 'var(--bg-0)',
              color: active ? 'var(--green, #10b981)' : 'var(--text-2)',
              fontSize: 13, fontWeight: active ? 700 : 500,
              cursor: 'pointer',
            }}>
      {children}
    </button>
  )
}
