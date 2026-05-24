import { useState, useEffect, useCallback } from 'react'
import { UserPlus, RefreshCcw, UserMinus, UserCheck } from 'lucide-react'
import { Card, Btn, Badge, Table, EmptyState, Input, Select } from '../../components/UI'
import { useToast } from '../../components/Toast'
import Modal from '../../components/Modal'
import {
  trabajadoresList, trabajadoresPendientes, trabajadorAlta,
  trabajadorBaja, trabajadorReactivar,
} from '../../utils/horarioApi'
import { getEntrenadores } from '../../utils/api'


export default function TrabajadoresTab({ identity }) {
  const toast = useToast()
  const [activos, setActivos] = useState([])
  const [pendientes, setPendientes] = useState([])
  const [bajas, setBajas] = useState([])
  const [loading, setLoading] = useState(true)
  const [trainers, setTrainers] = useState([])
  const [showAlta, setShowAlta] = useState(null)  // pendiente seleccionado o objeto vacío
  const [view, setView] = useState('activos')     // activos | pendientes | bajas

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
        <PendientesView pendientes={pendientes} trainers={trainers}
                        onAlta={(p) => setShowAlta(p)} />
      )}
      {!loading && view === 'activos' && (
        <ListView trabajadores={activos} onBaja={handleBaja} />
      )}
      {!loading && view === 'bajas' && (
        <ListView trabajadores={bajas} onReactivar={handleReactivar} />
      )}

      {showAlta && (
        <AltaModal pendiente={showAlta} trainers={trainers}
                   onClose={() => setShowAlta(null)}
                   onSaved={() => { setShowAlta(null); reload() }}
                   identity={identity} />
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
             description="Todos los clientes NoofitPro con categoría 'Trabajador' ya tienen su alta laboral completa." />
  }
  return (
    <Card style={{ padding: 0 }}>
      <Table
        ariaLabel="Trabajadores pendientes de alta laboral"
        columns={[
          { key: 'nombre',    label: 'Nombre',    render: (_, r) => r.nombre_completo },
          { key: 'email',     label: 'Email',     render: (_, r) => r.email || '—' },
          { key: 'cat',       label: 'Categoría', render: (_, r) => <Badge color="cyan">{r.categoria_nombre}</Badge> },
          { key: 'acciones',  label: '',          render: (_, r) => (
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


function ListView({ trabajadores, onBaja, onReactivar }) {
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
    <Modal open onClose={onClose} title="Alta laboral del trabajador">
      <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <Btn variant="ghost" type="button" onClick={onClose}>Cancelar</Btn>
          <Btn type="submit" disabled={saving}>
            {saving ? 'Guardando…' : 'Activar trabajador'}
          </Btn>
        </div>
      </form>
    </Modal>
  )
}
