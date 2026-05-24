import { useState, useEffect, useCallback, useRef } from 'react'
import { UserPlus, RefreshCcw, UserMinus, UserCheck, Info, Pencil, History, Save, CalendarDays, Plus, Trash2, Copy } from 'lucide-react'
import { Card, Btn, Badge, Table, EmptyState, Input, Select } from '../../components/UI'
import { useToast } from '../../components/Toast'
import Modal from '../../components/Modal'
import {
  trabajadoresList, trabajadoresPendientes, trabajadorAlta,
  trabajadorBaja, trabajadorReactivar, trabajadorUpdate, trabajadorHistorial,
  trabajadorHorario, trabajadorHorarioSave,
} from '../../utils/horarioApi'
import { getEntrenadores } from '../../utils/api'


export default function TrabajadoresTab({ identity }) {
  const toast = useToast()
  const [activos, setActivos] = useState([])
  const [pendientes, setPendientes] = useState([])
  const [bajas, setBajas] = useState([])
  const [loading, setLoading] = useState(true)
  const [trainers, setTrainers] = useState([])
  const [showAlta, setShowAlta] = useState(null)     // pendiente seleccionado o objeto vacío
  const [showEditar, setShowEditar] = useState(null) // trabajador a editar
  const [view, setView] = useState('activos')        // activos | pendientes | bajas
  const initialViewSet = useRef(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [act, pen, baj, trs] = await Promise.all([
        trabajadoresList(identity, { estado: 'activo' }),
        trabajadoresPendientes(identity),
        trabajadoresList(identity, { estado: 'baja' }),
        getEntrenadores().catch(() => []),
      ])
      setActivos(act || [])
      setPendientes(pen || [])
      setBajas(baj || [])
      setTrainers(trs || [])
      // UX: la primera carga decide la vista inicial. Si no hay activos
      // pero sí pendientes, abre en "Pendientes" (es lo más útil para
      // alguien que entra por primera vez al módulo).
      if (!initialViewSet.current) {
        initialViewSet.current = true
        if ((act || []).length === 0 && (pen || []).length > 0) {
          setView('pendientes')
        }
      }
    } catch (e) {
      toast.error('Error: ' + (e.message || 'desconocido'))
    } finally { setLoading(false) }
  }, [identity, toast])

  useEffect(() => { reload() }, [reload])

  async function handleBaja(t) {
    if (!confirm(`¿Dar de baja a ${t.nombre_completo}?`)) return
    try {
      await trabajadorBaja(identity, t.id, {})
      toast.success('Trabajador dado de baja')
      reload()
    } catch (e) { toast.error('Error: ' + e.message) }
  }

  async function handleReactivar(t) {
    try {
      await trabajadorReactivar(identity, t.id)
      toast.success('Trabajador reactivado')
      reload()
    } catch (e) { toast.error('Error: ' + e.message) }
  }

  return (
    <div>
      {/* Banner explicativo */}
      {view === 'pendientes' && pendientes.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 10,
          padding: '12px 14px', borderRadius: 12, marginBottom: 12,
          background: 'rgba(59,130,246,0.08)', color: 'var(--text-1)',
          border: '1px solid rgba(59,130,246,0.20)', fontSize: 13, lineHeight: 1.5,
        }}>
          <Info size={16} style={{ color: '#3b82f6', flexShrink: 0, marginTop: 1 }} />
          <div>
            <strong>Pendientes de alta laboral.</strong>{' '}
            Son los clientes con categoría <em>Trabajador</em> en NoofitPro
            que todavía no tienen su alta laboral en Round. Para que puedan
            fichar, pulsa <strong>"Alta laboral"</strong> y rellena los datos
            obligatorios (NIF, jornada y trainer empleador). Hasta entonces no podrán fichar.
          </div>
        </div>
      )}

      {/* Barra de acciones */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button onClick={() => setView('activos')}      style={subTabStyle(view === 'activos')}>
          Activos ({activos.length})
        </button>
        <button onClick={() => setView('pendientes')}   style={subTabStyle(view === 'pendientes')}>
          Pendientes alta ({pendientes.length})
        </button>
        <button onClick={() => setView('bajas')}        style={subTabStyle(view === 'bajas')}>
          Bajas ({bajas.length})
        </button>
        <div style={{ flex: 1 }} />
        <Btn variant="ghost" size="sm" onClick={reload}>
          <RefreshCcw size={14} /> Recargar
        </Btn>
      </div>

      {loading && <p style={{ color: 'var(--text-3)' }}>Cargando…</p>}

      {!loading && view === 'pendientes' && (
        <PendientesView pendientes={pendientes} onAlta={(p) => setShowAlta(p)} />
      )}
      {!loading && view === 'activos' && (
        <ListView trabajadores={activos} onBaja={handleBaja} onEditar={t => setShowEditar(t)} />
      )}
      {!loading && view === 'bajas' && (
        <ListView trabajadores={bajas} onReactivar={handleReactivar} onEditar={t => setShowEditar(t)} />
      )}

      {showAlta && (
        <AltaModal pendiente={showAlta} trainers={trainers}
                   onClose={() => setShowAlta(null)}
                   onSaved={() => { setShowAlta(null); reload() }}
                   identity={identity} />
      )}
      {showEditar && (
        <EditarTrabajadorModal
          trabajador={showEditar}
          trainers={trainers}
          identity={identity}
          onClose={() => setShowEditar(null)}
          onSaved={() => { setShowEditar(null); reload() }} />
      )}
    </div>
  )
}


function subTabStyle(active) {
  return {
    padding: '6px 12px', borderRadius: 8, fontSize: 13,
    background: active ? 'var(--green-bg)' : 'var(--bg-2)',
    color: active ? 'var(--green)' : 'var(--text-2)',
    border: active ? '1px solid var(--green)' : '1px solid var(--line)',
    cursor: 'pointer', fontWeight: active ? 600 : 500,
  }
}


function PendientesView({ pendientes, onAlta }) {
  if (pendientes.length === 0) {
    return <EmptyState icon={UserPlus} title="Sin pendientes"
             description="Todos los clientes NoofitPro con categoría 'Trabajador' ya tienen su alta laboral hecha." />
  }
  return (
    <Card style={{ padding: 0 }}>
      <Table
        ariaLabel="Pendientes de alta laboral"
        columns={[
          { key: 'nombre',  label: 'Nombre',    render: (_, r) => r.nombre_completo },
          { key: 'email',   label: 'Email',     render: (_, r) => r.email || '—' },
          { key: 'cat',     label: 'Categoría', render: (_, r) => <Badge color="cyan">{r.categoria_nombre}</Badge> },
          { key: 'acciones', label: '', render: (_, r) => (
            <Btn size="sm" onClick={() => onAlta(r)}>
              <UserCheck size={13} /> Alta laboral
            </Btn>
          )},
        ]}
        data={pendientes}
      />
    </Card>
  )
}


function ListView({ trabajadores, onBaja, onReactivar, onEditar }) {
  if (trabajadores.length === 0) {
    return <EmptyState icon={UserPlus} title="Sin trabajadores"
             description="No hay trabajadores en esta vista." />
  }
  return (
    <Card style={{ padding: 0 }}>
      <Table
        ariaLabel="Trabajadores"
        columns={[
          { key: 'nombre',  label: 'Nombre',           render: (_, r) => r.nombre_completo || '—' },
          { key: 'nif',     label: 'NIF',              render: (_, r) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{r.nif || '—'}</span> },
          { key: 'empl',    label: 'Trainer empleador', render: (_, r) => r.id_trainer_empleador || '—' },
          { key: 'jor',     label: 'h/sem',             render: (_, r) => r.jornada_h_semana ?? '—' },
          { key: 'alta',    label: 'Alta',              render: (_, r) => r.fecha_alta_laboral || '—' },
          { key: 'baja',    label: 'Baja',              render: (_, r) => r.fecha_baja_laboral || '—' },
          { key: 'acciones', label: '',                 render: (_, r) => (
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              {onEditar && (
                <Btn size="sm" variant="ghost" onClick={() => onEditar(r)} title="Editar / ver historial">
                  <Pencil size={13} /> Editar
                </Btn>
              )}
              {onBaja && (
                <Btn size="sm" variant="ghost" onClick={() => onBaja(r)}>
                  <UserMinus size={13} /> Baja
                </Btn>
              )}
              {onReactivar && (
                <Btn size="sm" onClick={() => onReactivar(r)}>
                  <UserCheck size={13} /> Reactivar
                </Btn>
              )}
            </div>
          )},
        ]}
        data={trabajadores}
      />
    </Card>
  )
}


function AltaModal({ pendiente, trainers, onClose, onSaved, identity }) {
  const toast = useToast()
  const [form, setForm] = useState({
    cliente_idnoofit:      pendiente.cliente_idnoofit,
    nombre_completo:       pendiente.nombre_completo || `${pendiente.nombre || ''} ${pendiente.apellidos || ''}`.trim(),
    email:                 pendiente.email || '',
    nif:                   '',
    jornada_h_semana:      '40',
    id_trainer_empleador:  pendiente.id_trainer_actual || '',
    categoria_profesional: '',
    tipo_contrato:         'indefinido',
    fecha_alta_laboral:    new Date().toISOString().slice(0, 10),
    notas:                 '',
  })
  const [saving, setSaving] = useState(false)

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function handleSave(e) {
    e.preventDefault()
    if (!form.nif.trim() || !form.jornada_h_semana || !form.id_trainer_empleador) {
      toast.error('NIF, jornada y trainer son obligatorios')
      return
    }
    setSaving(true)
    try {
      await trabajadorAlta(identity, form)
      toast.success('Trabajador activado')
      onSaved()
    } catch (e) {
      toast.error('No se pudo activar: ' + (e.body?.detalle || e.message))
    } finally { setSaving(false) }
  }

  return (
    <Modal open onClose={onClose}
           title="Alta laboral del trabajador"
           subtitle={pendiente.nombre_completo || pendiente.email}
           maxWidth={620}>
      <form onSubmit={handleSave}
            style={{
              display: 'flex', flexDirection: 'column',
              flex: 1, minHeight: 0,    // permite que el body interno scrollee
            }}>
        {/* Cuerpo scrolleable */}
        <div style={{
          flex: 1, overflowY: 'auto',
          padding: '20px 32px',
          display: 'flex', flexDirection: 'column', gap: 14,
        }}>
          <Input label="Nombre completo" value={form.nombre_completo}
                 onChange={e => set('nombre_completo', e.target.value)} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Input label="NIF / NIE / Pasaporte *" value={form.nif}
                   onChange={e => set('nif', e.target.value.toUpperCase())} required />
            <Input label="Jornada (h/semana) *" type="number" step="0.5"
                   value={form.jornada_h_semana}
                   onChange={e => set('jornada_h_semana', e.target.value)} required />
          </div>
          <Select label="Trainer empleador *"
                  value={form.id_trainer_empleador}
                  onChange={e => set('id_trainer_empleador', e.target.value)} required>
            <option value="">— Selecciona trainer —</option>
            {trainers.map(t => (
              <option key={t.id} value={t.id}>
                {`${t.nombre || t.name || ''} ${t.apellidos || t.surname || ''}`.trim() || t.email}
              </option>
            ))}
          </Select>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Select label="Tipo de contrato"
                    value={form.tipo_contrato}
                    onChange={e => set('tipo_contrato', e.target.value)}>
              <option value="indefinido">Indefinido</option>
              <option value="temporal">Temporal</option>
              <option value="formacion">Formación / aprendizaje</option>
              <option value="practicas">Prácticas</option>
            </Select>
            <Input label="Fecha alta laboral" type="date"
                   value={form.fecha_alta_laboral}
                   onChange={e => set('fecha_alta_laboral', e.target.value)} />
          </div>
          <Input label="Categoría profesional (opcional)" value={form.categoria_profesional}
                 onChange={e => set('categoria_profesional', e.target.value)} />
          <Input label="Notas" value={form.notas}
                 onChange={e => set('notas', e.target.value)} />
        </div>

        {/* Footer fijo con botones — siempre visible */}
        <div style={{
          padding: '16px 32px',
          borderTop: '1px solid var(--line)',
          background: 'var(--bg-2)',
          display: 'flex', justifyContent: 'flex-end', gap: 8,
          flexShrink: 0,
        }}>
          <Btn variant="ghost" type="button" onClick={onClose}>Cancelar</Btn>
          <Btn type="submit" disabled={saving}>
            {saving ? 'Guardando…' : 'Activar trabajador'}
          </Btn>
        </div>
      </form>
    </Modal>
  )
}


// ═══════════════════════════════════════════════════════════════════════════
// ║  EditarTrabajadorModal — edición + tab Historial de cambios            ║
// ═══════════════════════════════════════════════════════════════════════════

function EditarTrabajadorModal({ trabajador, trainers, identity, onClose, onSaved }) {
  const toast = useToast()
  const [tab, setTab] = useState('datos')
  const [form, setForm] = useState(() => ({
    nombre_completo:                trabajador.nombre_completo || '',
    email:                          trabajador.email || '',
    nif:                            trabajador.nif || '',
    jornada_h_semana:               trabajador.jornada_h_semana ?? '',
    id_trainer_empleador:           trabajador.id_trainer_empleador || '',
    categoria_profesional:          trabajador.categoria_profesional || '',
    tipo_contrato:                  trabajador.tipo_contrato || 'indefinido',
    fecha_alta_laboral:             trabajador.fecha_alta_laboral || '',
    vacaciones_dias_override:       trabajador.vacaciones_dias_override ?? '',
    asuntos_propios_dias_override:  trabajador.asuntos_propios_dias_override ?? '',
    notas:                          trabajador.notas || '',
  }))
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function handleSave(e) {
    e.preventDefault()
    if (!form.nif.trim() || !form.jornada_h_semana || !form.id_trainer_empleador) {
      toast.error('NIF, jornada y trainer son obligatorios')
      return
    }
    setSaving(true)
    try {
      // Diff client-side: solo enviar campos que cambian.
      const diff = {}
      Object.keys(form).forEach(k => {
        const orig = trabajador[k]
        const nuevo = form[k] === '' ? null : form[k]
        const origNorm = (orig === null || orig === undefined) ? null : orig
        if (String(nuevo ?? '') !== String(origNorm ?? '')) {
          diff[k] = form[k] === '' ? null : form[k]
        }
      })
      if (Object.keys(diff).length === 0) {
        toast.success('Sin cambios')
        onClose()
        return
      }
      await trabajadorUpdate(identity, trabajador.id, diff)
      toast.success('Cambios guardados')
      onSaved()
    } catch (e) {
      toast.error('Error: ' + (e.body?.detalle || e.message))
    } finally { setSaving(false) }
  }

  return (
    <Modal open onClose={onClose}
           title={'Trabajador · ' + (trabajador.nombre_completo || trabajador.email || '—')}
           subtitle={'NIF ' + (trabajador.nif || '—') + ' · estado ' + trabajador.estado}
           maxWidth={720}>
      <div style={{
        display: 'flex', gap: 6, padding: '12px 32px 0',
        borderBottom: '1px solid var(--line)', flexShrink: 0,
      }}>
        <TabBtn active={tab === 'datos'}     onClick={() => setTab('datos')}><Pencil size={14} /> Datos</TabBtn>
        <TabBtn active={tab === 'horario'}   onClick={() => setTab('horario')}><CalendarDays size={14} /> Horario</TabBtn>
        <TabBtn active={tab === 'historial'} onClick={() => setTab('historial')}><History size={14} /> Historial</TabBtn>
      </div>

      {tab === 'datos' && (
        <form onSubmit={handleSave}
              style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <div style={{
            flex: 1, overflowY: 'auto', padding: '20px 32px',
            display: 'flex', flexDirection: 'column', gap: 14,
          }}>
            <Input label="Nombre completo" value={form.nombre_completo}
                   onChange={e => set('nombre_completo', e.target.value)} />
            <Input label="Email" type="email" value={form.email}
                   onChange={e => set('email', e.target.value)} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Input label="NIF / NIE / Pasaporte *" value={form.nif}
                     onChange={e => set('nif', e.target.value.toUpperCase())} required />
              <Input label="Jornada (h/semana) *" type="number" step="0.5"
                     value={form.jornada_h_semana}
                     onChange={e => set('jornada_h_semana', e.target.value)} required />
            </div>
            <Select label="Trainer empleador *"
                    value={form.id_trainer_empleador}
                    onChange={e => set('id_trainer_empleador', e.target.value)} required>
              <option value="">— Selecciona trainer —</option>
              {trainers.map(t => (
                <option key={t.id} value={t.id}>
                  {(t.nombre || t.name || '') + ' ' + (t.apellidos || t.surname || '')}
                </option>
              ))}
            </Select>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Select label="Tipo de contrato"
                      value={form.tipo_contrato}
                      onChange={e => set('tipo_contrato', e.target.value)}>
                <option value="indefinido">Indefinido</option>
                <option value="temporal">Temporal</option>
                <option value="formacion">Formación / aprendizaje</option>
                <option value="practicas">Prácticas</option>
              </Select>
              <Input label="Fecha alta laboral" type="date"
                     value={form.fecha_alta_laboral}
                     onChange={e => set('fecha_alta_laboral', e.target.value)} />
            </div>
            <Input label="Categoría profesional" value={form.categoria_profesional}
                   onChange={e => set('categoria_profesional', e.target.value)} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Input label="Vacaciones override (días)" type="number"
                     value={form.vacaciones_dias_override}
                     onChange={e => set('vacaciones_dias_override', e.target.value)} />
              <Input label="Asuntos propios override (días)" type="number"
                     value={form.asuntos_propios_dias_override}
                     onChange={e => set('asuntos_propios_dias_override', e.target.value)} />
            </div>
            <Input label="Notas" value={form.notas}
                   onChange={e => set('notas', e.target.value)} />
          </div>

          <div style={{
            padding: '16px 32px', borderTop: '1px solid var(--line)',
            background: 'var(--bg-2)', flexShrink: 0,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
          }}>
            <p style={{ margin: 0, fontSize: 11, color: 'var(--text-3)' }}>
              Cada cambio queda registrado en "Historial de cambios" (auditoría).
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn variant="ghost" type="button" onClick={onClose}>Cancelar</Btn>
              <Btn type="submit" disabled={saving}>
                <Save size={13} /> {saving ? 'Guardando…' : 'Guardar cambios'}
              </Btn>
            </div>
          </div>
        </form>
      )}

      {tab === 'horario' && (
        <HorarioPanel trabajadorId={trabajador.id} identity={identity} />
      )}
      {tab === 'historial' && (
        <HistorialPanel trabajadorId={trabajador.id} identity={identity} />
      )}
    </Modal>
  )
}


function TabBtn({ active, children, ...rest }) {
  return (
    <button type="button" {...rest}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '10px 14px',
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: active ? 'var(--text-0)' : 'var(--text-3)',
              fontWeight: active ? 700 : 500, fontSize: 13,
              borderBottom: active ? '2px solid var(--green, #10b981)' : '2px solid transparent',
              marginBottom: -1,
            }}>
      {children}
    </button>
  )
}


function HistorialPanel({ trabajadorId, identity }) {
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    trabajadorHistorial(identity, trabajadorId)
      .then(setItems)
      .catch(e => setError(e.message || 'Error'))
  }, [trabajadorId, identity])

  if (error) return <div style={{ padding: 24, color: 'var(--red)' }}>No se pudo cargar: {error}</div>
  if (items === null) return <div style={{ padding: 24, color: 'var(--text-3)' }}>Cargando historial…</div>
  if (items.length === 0) {
    return <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-3)' }}>
      Sin acciones registradas todavía.
    </div>
  }
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 32px 24px' }}>
      <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map(h => (
          <li key={h.id} style={{
            padding: '12px 14px', borderRadius: 10,
            background: 'var(--bg-2)', border: '1px solid var(--line)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>
                <Badge color={accionColor(h.accion)}>{h.accion}</Badge>
                <span style={{ marginLeft: 8, color: 'var(--text-2)' }}>{h.actor}</span>
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)' }}>
                {fmtTs(h.ts)}
              </span>
            </div>
            {h.resumen && (
              <p style={{ margin: '4px 0 6px', fontSize: 12, color: 'var(--text-3)' }}>
                {h.resumen}
              </p>
            )}
            {h.cambios && Object.keys(h.cambios).length > 0 && (
              <DiffTable cambios={h.cambios} />
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}


function DiffTable({ cambios }) {
  return (
    <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', marginTop: 4 }}>
      <thead>
        <tr style={{ color: 'var(--text-3)' }}>
          <th style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid var(--line)' }}>Campo</th>
          <th style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid var(--line)' }}>Antes</th>
          <th style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid var(--line)' }}>Después</th>
        </tr>
      </thead>
      <tbody>
        {Object.entries(cambios).map(([k, v]) => (
          <tr key={k}>
            <td style={{ padding: '4px 8px', fontFamily: 'var(--font-mono)', color: 'var(--text-2)' }}>{k}</td>
            <td style={{ padding: '4px 8px', color: 'var(--text-3)', textDecoration: 'line-through' }}>{fmtVal(v?.before)}</td>
            <td style={{ padding: '4px 8px', color: 'var(--green, #10b981)', fontWeight: 600 }}>{fmtVal(v?.after)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}


function fmtVal(v) {
  if (v === null || v === undefined || v === '') return '—'
  return String(v)
}
function fmtTs(iso) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'medium' }) }
  catch { return iso }
}
function accionColor(a) {
  return ({
    'alta_laboral': 'green',
    'editar': 'cyan',
    'horario_editar': 'cyan',
    'baja': 'red',
    'reactivar': 'green',
    'autorizar': 'green',
    'rechazar': 'red',
  })[a] || 'gray'
}


// ═══════════════════════════════════════════════════════════════════════════
// ║  HorarioPanel — planning semanal (Lun-Dom, bloques editables)          ║
// ═══════════════════════════════════════════════════════════════════════════

const DIAS = [
  { i: 1, label: 'Lun', long: 'Lunes' },
  { i: 2, label: 'Mar', long: 'Martes' },
  { i: 3, label: 'Mié', long: 'Miércoles' },
  { i: 4, label: 'Jue', long: 'Jueves' },
  { i: 5, label: 'Vie', long: 'Viernes' },
  { i: 6, label: 'Sáb', long: 'Sábado' },
  { i: 7, label: 'Dom', long: 'Domingo' },
]


function HorarioPanel({ trabajadorId, identity }) {
  const toast = useToast()
  const [horario, setHorario] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setLoading(true)
    trabajadorHorario(identity, trabajadorId)
      .then(h => setHorario(h || {}))
      .catch(e => toast.error('Error: ' + (e.message || '?')))
      .finally(() => setLoading(false))
  }, [trabajadorId, identity, toast])

  function setDia(dia, blocks) {
    setHorario(h => ({ ...h, [String(dia)]: blocks }))
  }

  function addBloque(dia) {
    const actuales = horario[String(dia)] || []
    setDia(dia, [...actuales, { hora_inicio: '09:00', hora_fin: '14:00' }])
  }

  function removeBloque(dia, idx) {
    const actuales = (horario[String(dia)] || []).slice()
    actuales.splice(idx, 1)
    setDia(dia, actuales)
  }

  function updateBloque(dia, idx, field, value) {
    const actuales = (horario[String(dia)] || []).slice()
    actuales[idx] = { ...actuales[idx], [field]: value }
    setDia(dia, actuales)
  }

  function copyLunToWeekdays() {
    const lun = horario['1'] || []
    setHorario(h => ({
      ...h,
      '2': lun.map(b => ({ ...b })),
      '3': lun.map(b => ({ ...b })),
      '4': lun.map(b => ({ ...b })),
      '5': lun.map(b => ({ ...b })),
    }))
    toast.success('Copiado lun → mar/mié/jue/vie')
  }

  async function handleSave() {
    setSaving(true)
    try {
      await trabajadorHorarioSave(identity, trabajadorId, horario)
      toast.success('Horario guardado')
    } catch (e) {
      toast.error('Error: ' + (e.body?.detalle || e.message || '?'))
    } finally { setSaving(false) }
  }

  if (loading) {
    return <div style={{ padding: 24, color: 'var(--text-3)' }}>Cargando horario…</div>
  }
  if (!horario) return null

  const lunHasContent = (horario['1'] || []).length > 0
  const totalBlocks = DIAS.reduce((acc, d) => acc + (horario[String(d.i)] || []).length, 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={{
        flex: 1, overflowY: 'auto', padding: '16px 24px',
        display: 'flex', flexDirection: 'column', gap: 12,
      }}>
        <div style={{
          padding: '10px 12px', borderRadius: 10,
          background: 'rgba(59,130,246,0.06)', color: 'var(--text-2)',
          border: '1px solid rgba(59,130,246,0.16)',
          fontSize: 12, lineHeight: 1.5,
        }}>
          Cada día puede tener varios bloques (jornada partida).
          Para jornada nocturna (22:00–06:00), añade un bloque hasta 23:59
          y otro 00:00–06:00 al día siguiente. Los cambios quedan en el
          historial del trabajador.
        </div>

        {lunHasContent && (
          <Btn variant="ghost" size="sm" onClick={copyLunToWeekdays}
               style={{ alignSelf: 'flex-start' }}>
            <Copy size={13} /> Copiar lunes a mar/mié/jue/vie
          </Btn>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {DIAS.map(d => {
            const bloques = horario[String(d.i)] || []
            return (
              <div key={d.i} style={{
                padding: 12, borderRadius: 12,
                background: 'var(--bg-2)', border: '1px solid var(--line)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <strong style={{ fontSize: 13, color: 'var(--text-1)' }}>{d.long}</strong>
                  <button onClick={() => addBloque(d.i)}
                          type="button"
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            padding: '4px 10px', borderRadius: 8,
                            background: 'var(--bg-1)', border: '1px solid var(--line)',
                            color: 'var(--green, #10b981)',
                            cursor: 'pointer', fontSize: 11, fontWeight: 600,
                          }}>
                    <Plus size={12} /> Añadir bloque
                  </button>
                </div>
                {bloques.length === 0 && (
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--text-3)' }}>
                    Día libre.
                  </p>
                )}
                {bloques.map((b, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    marginTop: i === 0 ? 0 : 6,
                  }}>
                    <input type="time" value={b.hora_inicio}
                           onChange={e => updateBloque(d.i, i, 'hora_inicio', e.target.value)}
                           style={timeInput} />
                    <span style={{ color: 'var(--text-3)' }}>→</span>
                    <input type="time" value={b.hora_fin}
                           onChange={e => updateBloque(d.i, i, 'hora_fin', e.target.value)}
                           style={timeInput} />
                    <button onClick={() => removeBloque(d.i, i)}
                            type="button" title="Eliminar bloque"
                            style={{
                              padding: 6, borderRadius: 8, border: 'none',
                              background: 'transparent', color: 'var(--red, #f87171)',
                              cursor: 'pointer',
                            }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </div>

      <div style={{
        padding: '16px 32px', borderTop: '1px solid var(--line)',
        background: 'var(--bg-2)', flexShrink: 0,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
      }}>
        <p style={{ margin: 0, fontSize: 11, color: 'var(--text-3)' }}>
          {totalBlocks} bloques en total · zona horaria Europe/Madrid
        </p>
        <Btn type="button" onClick={handleSave} disabled={saving}>
          <Save size={13} /> {saving ? 'Guardando…' : 'Guardar horario'}
        </Btn>
      </div>
    </div>
  )
}


const timeInput = {
  padding: '6px 10px', borderRadius: 8,
  border: '1px solid var(--line)', background: 'var(--bg-1)',
  color: 'var(--text-0)', fontSize: 13, fontFamily: 'var(--font-mono)',
  width: 110,
}

