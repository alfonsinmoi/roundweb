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
  { i: 1, label: 'L', long: 'Lunes' },
  { i: 2, label: 'M', long: 'Martes' },
  { i: 3, label: 'X', long: 'Miércoles' },
  { i: 4, label: 'J', long: 'Jueves' },
  { i: 5, label: 'V', long: 'Viernes' },
  { i: 6, label: 'S', long: 'Sábado' },
  { i: 7, label: 'D', long: 'Domingo' },
]

const TIPOS = [
  { id: 'trabajo',  label: 'Trabajo',  color: 'var(--green, #10b981)' },
  { id: 'comida',   label: 'Comida',   color: '#f59e0b' },
  { id: 'descanso', label: 'Descanso', color: '#60a5fa' },
  { id: 'otros',    label: 'Otros',    color: 'var(--text-3)' },
]


// `franja` UI = { hora_inicio, hora_fin, tipo, dias: Set<int> }
// BD              = una fila por (franja × dia marcado).
// Al cargar, agrupamos filas idénticas (mismo HH:MM y tipo) en una franja.
function agruparEnFranjas(horario) {
  const mapa = new Map()
  for (const dia of Object.keys(horario || {})) {
    for (const b of (horario[dia] || [])) {
      const key = `${b.hora_inicio}|${b.hora_fin}|${b.tipo || 'trabajo'}`
      if (!mapa.has(key)) {
        mapa.set(key, {
          hora_inicio: b.hora_inicio,
          hora_fin:    b.hora_fin,
          tipo:        b.tipo || 'trabajo',
          dias:        new Set(),
        })
      }
      mapa.get(key).dias.add(Number(dia))
    }
  }
  return Array.from(mapa.values())
    .sort((a, b) => (a.hora_inicio || '').localeCompare(b.hora_inicio || ''))
}


function franjasACargaBD(franjas) {
  // Expande franjas → estructura {dia: [bloques]} para el PUT
  const out = { '1': [], '2': [], '3': [], '4': [], '5': [], '6': [], '7': [] }
  for (const f of franjas) {
    for (const d of f.dias) {
      out[String(d)].push({
        hora_inicio: f.hora_inicio,
        hora_fin:    f.hora_fin,
        tipo:        f.tipo,
      })
    }
  }
  return out
}


function minutosFranja(f) {
  if (!f.hora_inicio || !f.hora_fin) return 0
  const [h1, m1] = f.hora_inicio.split(':').map(Number)
  const [h2, m2] = f.hora_fin.split(':').map(Number)
  return Math.max(0, (h2 * 60 + m2) - (h1 * 60 + m1))
}


function HorarioPanel({ trabajadorId, identity }) {
  const toast = useToast()
  const [franjas, setFranjas] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setLoading(true)
    trabajadorHorario(identity, trabajadorId)
      .then(h => setFranjas(agruparEnFranjas(h || {})))
      .catch(e => toast.error('Error: ' + (e.message || '?')))
      .finally(() => setLoading(false))
  }, [trabajadorId, identity, toast])

  function addFranja() {
    setFranjas(fs => [...(fs || []), {
      hora_inicio: '09:00', hora_fin: '14:00', tipo: 'trabajo',
      dias: new Set([1, 2, 3, 4, 5]),
    }])
  }

  function setFranja(idx, patch) {
    setFranjas(fs => {
      const next = fs.slice()
      next[idx] = { ...next[idx], ...patch }
      return next
    })
  }

  function toggleDia(idx, dia) {
    setFranjas(fs => {
      const next = fs.slice()
      const dias = new Set(next[idx].dias)
      if (dias.has(dia)) dias.delete(dia)
      else dias.add(dia)
      next[idx] = { ...next[idx], dias }
      return next
    })
  }

  function removeFranja(idx) {
    setFranjas(fs => fs.filter((_, i) => i !== idx))
  }

  async function handleSave() {
    setSaving(true)
    try {
      const body = franjasACargaBD(franjas)
      await trabajadorHorarioSave(identity, trabajadorId, body)
      toast.success('Horario guardado')
    } catch (e) {
      toast.error('Error: ' + (e.body?.detalle || e.message || '?'))
    } finally { setSaving(false) }
  }

  if (loading) {
    return <div style={{ padding: 24, color: 'var(--text-3)' }}>Cargando horario…</div>
  }
  if (!franjas) return null

  // Totales por día y semanales
  const totDia = DIAS.map(d => {
    let trabajo = 0, pausa = 0
    for (const f of franjas) {
      if (!f.dias.has(d.i)) continue
      const m = minutosFranja(f)
      if (f.tipo === 'trabajo') trabajo += m
      else pausa += m
    }
    return { dia: d, trabajo, pausa }
  })
  const totSemTrabajo = totDia.reduce((a, x) => a + x.trabajo, 0)
  const totSemPausa   = totDia.reduce((a, x) => a + x.pausa,   0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
        <div style={{
          padding: '10px 12px', borderRadius: 10, marginBottom: 12,
          background: 'rgba(59,130,246,0.06)', color: 'var(--text-2)',
          border: '1px solid rgba(59,130,246,0.16)',
          fontSize: 12, lineHeight: 1.5,
        }}>
          Cada fila es una franja horaria. Marca los días en los que se
          aplica. Para nocturna (22:00–06:00) añade dos franjas: una
          22:00–23:59 lun-vie y otra 00:00–06:00 mar-sáb.
        </div>

        <div style={{ overflowX: 'auto', borderRadius: 12, border: '1px solid var(--line)' }}>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--bg-2)' }}>
                <th style={thStyle}>Hora ini</th>
                <th style={thStyle}>Hora fin</th>
                <th style={thStyle}>Tipo</th>
                {DIAS.map(d => (
                  <th key={d.i} style={{ ...thStyle, textAlign: 'center', width: 36 }}>{d.label}</th>
                ))}
                <th style={{ ...thStyle, width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {franjas.map((f, idx) => (
                <tr key={idx} style={{ borderTop: '1px solid var(--line)' }}>
                  <td style={tdStyle}>
                    <input type="time" value={f.hora_inicio}
                           onChange={e => setFranja(idx, { hora_inicio: e.target.value })}
                           style={timeInput} />
                  </td>
                  <td style={tdStyle}>
                    <input type="time" value={f.hora_fin}
                           onChange={e => setFranja(idx, { hora_fin: e.target.value })}
                           style={timeInput} />
                  </td>
                  <td style={tdStyle}>
                    <select value={f.tipo}
                            onChange={e => setFranja(idx, { tipo: e.target.value })}
                            style={selectInput}>
                      {TIPOS.map(t => (
                        <option key={t.id} value={t.id}>{t.label}</option>
                      ))}
                    </select>
                  </td>
                  {DIAS.map(d => (
                    <td key={d.i} style={{ ...tdStyle, textAlign: 'center' }}>
                      <input type="checkbox" checked={f.dias.has(d.i)}
                             onChange={() => toggleDia(idx, d.i)}
                             style={{ width: 18, height: 18, cursor: 'pointer', accentColor: 'var(--green, #10b981)' }} />
                    </td>
                  ))}
                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                    <button onClick={() => removeFranja(idx)}
                            type="button" title="Eliminar franja"
                            style={{
                              padding: 6, borderRadius: 8, border: 'none',
                              background: 'transparent', color: 'var(--red, #f87171)',
                              cursor: 'pointer',
                            }}>
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
              {franjas.length === 0 && (
                <tr><td colSpan={11} style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)' }}>
                  Sin franjas todavía. Pulsa "Añadir franja".
                </td></tr>
              )}
            </tbody>
            <tfoot>
              <tr style={{ background: 'var(--bg-2)', borderTop: '2px solid var(--line)' }}>
                <td colSpan={3} style={{ ...tdStyle, fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Trabajo / día
                </td>
                {totDia.map(t => (
                  <td key={t.dia.i} style={{ ...tdStyle, textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, color: t.trabajo > 0 ? 'var(--green, #10b981)' : 'var(--text-3)' }}>
                    {fmtMin(t.trabajo)}
                  </td>
                ))}
                <td style={tdStyle}></td>
              </tr>
              <tr style={{ background: 'var(--bg-2)' }}>
                <td colSpan={3} style={{ ...tdStyle, fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Pausa / día
                </td>
                {totDia.map(t => (
                  <td key={t.dia.i} style={{ ...tdStyle, textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, color: t.pausa > 0 ? '#f59e0b' : 'var(--text-3)' }}>
                    {fmtMin(t.pausa)}
                  </td>
                ))}
                <td style={tdStyle}></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Btn variant="ghost" size="sm" onClick={addFranja}>
            <Plus size={13} /> Añadir franja
          </Btn>
          <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
            <strong>Total semanal:</strong>{' '}
            <span style={{ color: 'var(--green, #10b981)', fontWeight: 600 }}>
              {fmtMin(totSemTrabajo)}
            </span>
            <span style={{ color: 'var(--text-3)' }}> trabajo</span>
            {totSemPausa > 0 && (
              <>
                {' · '}
                <span style={{ color: '#f59e0b', fontWeight: 600 }}>{fmtMin(totSemPausa)}</span>
                <span style={{ color: 'var(--text-3)' }}> pausa</span>
              </>
            )}
          </div>
        </div>
      </div>

      <div style={{
        padding: '16px 32px', borderTop: '1px solid var(--line)',
        background: 'var(--bg-2)', flexShrink: 0,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
      }}>
        <p style={{ margin: 0, fontSize: 11, color: 'var(--text-3)' }}>
          {franjas.length} franjas · zona horaria Europe/Madrid
        </p>
        <Btn type="button" onClick={handleSave} disabled={saving}>
          <Save size={13} /> {saving ? 'Guardando…' : 'Guardar horario'}
        </Btn>
      </div>
    </div>
  )
}


function fmtMin(mins) {
  if (!mins) return '—'
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${String(m).padStart(2, '0')}m`
}


const timeInput = {
  padding: '6px 10px', borderRadius: 8,
  border: '1px solid var(--line)', background: 'var(--bg-1)',
  color: 'var(--text-0)', fontSize: 13, fontFamily: 'var(--font-mono)',
  width: 100,
}
const selectInput = {
  padding: '6px 10px', borderRadius: 8,
  border: '1px solid var(--line)', background: 'var(--bg-1)',
  color: 'var(--text-0)', fontSize: 13, cursor: 'pointer',
  minWidth: 110,
}
const thStyle = {
  textAlign: 'left', padding: '10px 12px',
  fontSize: 11, fontWeight: 600, color: 'var(--text-3)',
  textTransform: 'uppercase', letterSpacing: '0.05em',
}
const tdStyle = {
  padding: '8px 12px',
}

