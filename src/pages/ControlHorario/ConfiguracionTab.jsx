import { useState, useEffect, useCallback, useMemo } from 'react'
import { Building2, ListChecks, Save, Trash2, Plus, Info, Check, Copy, Crown, X } from 'lucide-react'
import { Card, Btn, Badge, Input, Select } from '../../components/UI'
import { useToast } from '../../components/Toast'
import {
  convenios, empresasList, empresaUpsert,
  motivosPausa, motivoCreate, motivoUpdate, motivoDelete,
} from '../../utils/horarioApi'
import { getEntrenadores } from '../../utils/api'


export default function ConfiguracionTab({ identity }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <EmpresaSection identity={identity} />
      <MotivosSection identity={identity} />
    </div>
  )
}


// ─── Empresa por trainer ────────────────────────────────────────────────────

function EmpresaSection({ identity }) {
  const toast = useToast()
  const [convs, setConvs] = useState([])
  const [trainers, setTrainers] = useState([])
  const [empresas, setEmpresas] = useState([])
  const [trainerId, setTrainerId] = useState('')

  const reload = useCallback(async () => {
    try {
      const [cs, es, ts] = await Promise.all([
        convenios(identity),
        empresasList(identity),
        getEntrenadores().catch(() => []),
      ])
      setConvs(cs || [])
      setEmpresas(es || [])
      setTrainers(ts || [])
    } catch (e) { toast.error('Error: ' + e.message) }
  }, [identity, toast])

  useEffect(() => { reload() }, []) // eslint-disable-line

  // Ordenar trainers: manager primero, resto por nombre
  const managerId = identity?.managerId ? String(identity.managerId) : ''
  const trainersOrdenados = useMemo(() => {
    const arr = [...trainers]
    arr.sort((a, b) => {
      const aMgr = String(a.id) === managerId
      const bMgr = String(b.id) === managerId
      if (aMgr && !bMgr) return -1
      if (!aMgr && bMgr) return 1
      const na = (a.nombre || a.name || '').toLowerCase()
      const nb = (b.nombre || b.name || '').toLowerCase()
      return na.localeCompare(nb)
    })
    return arr
  }, [trainers, managerId])

  // Auto-seleccionar manager al cargar
  useEffect(() => {
    if (!trainerId && trainersOrdenados.length) {
      setTrainerId(String(trainersOrdenados[0].id))
    }
  }, [trainersOrdenados, trainerId])

  const empresa = empresas.find(e => String(e.id_trainer) === String(trainerId)) || null
  const empresasById = useMemo(() => {
    const m = {}
    for (const e of empresas) m[String(e.id_trainer)] = e
    return m
  }, [empresas])

  function isConfigured(t) {
    const e = empresasById[String(t.id)]
    if (!e) return false
    // Considerar configurado si tiene al menos razón social O CIF
    return !!(e.razon_social || e.cif)
  }

  return (
    <Card style={{ padding: 18 }}>
      <SectionHeader icon={Building2} title="Datos de empresa por trainer / centro"
        subtitle="El trainer es la entidad jurídica empleadora del trabajador (art. 34.9 ET). El primero es el manager principal — desde su ficha puedes copiar los datos al resto." />

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16, marginTop: 8 }}>
        {/* Lista de trainers */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {trainersOrdenados.map(t => {
            const isMgr = String(t.id) === managerId
            const isSel = String(t.id) === trainerId
            const cfg = isConfigured(t)
            return (
              <button key={t.id} type="button"
                      onClick={() => setTrainerId(String(t.id))}
                      style={{
                        textAlign: 'left', padding: '10px 12px', borderRadius: 8,
                        background: isSel ? 'var(--green-bg, rgba(16,185,129,0.10))' : 'transparent',
                        border: isSel ? '1px solid var(--green, #10b981)' : '1px solid var(--line)',
                        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                      }}>
                {isMgr && <Crown size={14} style={{ color: '#f59e0b', flexShrink: 0 }} title="Manager" />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-0)',
                                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {(`${t.nombre || t.name || ''} ${t.apellidos || t.surname || ''}`).trim() || t.email}
                  </div>
                  {isMgr && (
                    <div style={{ fontSize: 10, color: '#f59e0b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Manager
                    </div>
                  )}
                </div>
                {cfg ? (
                  <Badge color="green">
                    <Check size={10} style={{ verticalAlign: '-1px' }} /> Configurado
                  </Badge>
                ) : (
                  <Badge color="gray">Sin datos</Badge>
                )}
              </button>
            )
          })}
        </div>

        {/* Form */}
        {trainerId && (
          <EmpresaForm key={trainerId}
                       identity={identity}
                       idTrainer={trainerId}
                       isManager={trainerId === managerId}
                       trainers={trainersOrdenados}
                       managerId={managerId}
                       empresa={empresa}
                       empresasById={empresasById}
                       convenios={convs}
                       onSaved={reload} />
        )}
      </div>
    </Card>
  )
}


function EmpresaForm({ identity, idTrainer, isManager, trainers, managerId, empresa, empresasById, convenios, onSaved }) {
  const toast = useToast()
  const [form, setForm] = useState(() => ({
    razon_social: empresa?.razon_social || '',
    cif: empresa?.cif || '',
    direccion_fiscal: empresa?.direccion_fiscal || '',
    convenio_id: empresa?.convenio_id || '',
    horas_anuales_override: empresa?.horas_anuales_override || '',
    horas_semana_override: empresa?.horas_semana_override || '',
    vacaciones_dias_override: empresa?.vacaciones_dias_override || '',
    vacaciones_tipo_override: empresa?.vacaciones_tipo_override || '',
    asuntos_propios_dias_override: empresa?.asuntos_propios_dias_override || '',
    representante_legal: empresa?.representante_legal || '',
    fecha_acuerdo_representantes: empresa?.fecha_acuerdo_representantes || '',
    notas: empresa?.notas || '',
  }))
  const [saving, setSaving] = useState(false)
  const [showCopyModal, setShowCopyModal] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const conv = convenios.find(c => c.id === Number(form.convenio_id))

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const body = { ...form }
      // strings vacíos -> null para campos numéricos
      ;['convenio_id','horas_anuales_override','horas_semana_override',
        'vacaciones_dias_override','vacaciones_tipo_override',
        'asuntos_propios_dias_override',
        'fecha_acuerdo_representantes'].forEach(k => {
        if (body[k] === '') body[k] = null
      })
      await empresaUpsert(identity, idTrainer, body)
      toast.success('Empresa guardada')
      onSaved()
    } catch (e) { toast.error('Error: ' + e.message) }
    finally { setSaving(false) }
  }

  return (
    <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
        <Input label="Razón social" value={form.razon_social}
               onChange={e => set('razon_social', e.target.value)} />
        <Input label="CIF" value={form.cif}
               onChange={e => set('cif', e.target.value.toUpperCase())} />
      </div>
      <Input label="Dirección fiscal" value={form.direccion_fiscal}
             onChange={e => set('direccion_fiscal', e.target.value)} />
      <Select label="Convenio aplicable" value={form.convenio_id || ''}
              onChange={e => set('convenio_id', e.target.value)}>
        <option value="">— Sin convenio asignado —</option>
        {convenios.map(c => (
          <option key={c.id} value={c.id}>
            {c.nombre}{c.es_global ? ' (global)' : ''} — {c.horas_anuales}h/año, {c.vacaciones_dias}d {c.vacaciones_tipo === 'laborales' ? 'lab.' : 'nat.'}
          </option>
        ))}
      </Select>
      {conv && (
        <div style={{ background: 'var(--bg-2)', padding: 10, borderRadius: 8, fontSize: 12, color: 'var(--text-3)' }}>
          <Badge color="cyan">Heredado del convenio</Badge>{' '}
          {conv.horas_anuales}h/año · {conv.horas_semana}h/sem · {conv.vacaciones_dias}d vacaciones ({conv.vacaciones_tipo || 'naturales'}) · {conv.asuntos_propios_dias}d asuntos propios
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
        <Input label="Horas/año (override)" type="number"
               value={form.horas_anuales_override}
               onChange={e => set('horas_anuales_override', e.target.value)} />
        <Input label="Horas/sem (override)" type="number" step="0.5"
               value={form.horas_semana_override}
               onChange={e => set('horas_semana_override', e.target.value)} />
        <Input label="Vacaciones (días)" type="number"
               value={form.vacaciones_dias_override}
               onChange={e => set('vacaciones_dias_override', e.target.value)} />
        <Input label="Asuntos propios (días)" type="number"
               value={form.asuntos_propios_dias_override}
               onChange={e => set('asuntos_propios_dias_override', e.target.value)} />
      </div>
      <Select label="Vacaciones contadas en (override)"
              value={form.vacaciones_tipo_override || ''}
              onChange={e => set('vacaciones_tipo_override', e.target.value)}>
        <option value="">
          — Hereda del convenio ({conv?.vacaciones_tipo || 'naturales'}) —
        </option>
        <option value="naturales">Días naturales (incluye fines de semana y festivos)</option>
        <option value="laborales">Días laborales (sólo lunes a viernes)</option>
      </Select>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
        <Input label="Representante legal" value={form.representante_legal}
               onChange={e => set('representante_legal', e.target.value)} />
        <Input label="Fecha acuerdo (art. 34.9 ET)" type="date"
               value={form.fecha_acuerdo_representantes}
               onChange={e => set('fecha_acuerdo_representantes', e.target.value)} />
      </div>
      <Input label="Notas" value={form.notas}
             onChange={e => set('notas', e.target.value)} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        {isManager && empresa && (form.razon_social || form.cif) ? (
          <Btn type="button" variant="ghost" onClick={() => setShowCopyModal(true)}>
            <Copy size={13} /> Copiar a otros trainers…
          </Btn>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
            {isManager
              ? 'Guarda los datos del manager para poder copiarlos al resto.'
              : ''}
          </span>
        )}
        <Btn type="submit" disabled={saving}>
          <Save size={14} /> {saving ? 'Guardando…' : 'Guardar'}
        </Btn>
      </div>
      {showCopyModal && (
        <CopiarEmpresaModal
          identity={identity}
          form={form}
          trainers={trainers}
          managerId={managerId}
          empresasById={empresasById}
          onClose={() => setShowCopyModal(false)}
          onDone={() => { setShowCopyModal(false); onSaved() }} />
      )}
    </form>
  )
}


function CopiarEmpresaModal({ identity, form, trainers, managerId, empresasById, onClose, onDone }) {
  const toast = useToast()
  const destinos = trainers.filter(t => String(t.id) !== managerId)
  const [seleccion, setSeleccion] = useState(new Set())
  const [saving, setSaving] = useState(false)

  function toggle(id) {
    setSeleccion(s => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function todos() {
    if (seleccion.size === destinos.length) setSeleccion(new Set())
    else setSeleccion(new Set(destinos.map(t => String(t.id))))
  }

  async function aplicar() {
    if (seleccion.size === 0) {
      toast.error('Selecciona al menos un trainer'); return
    }
    setSaving(true)
    const body = { ...form }
    ;['convenio_id','horas_anuales_override','horas_semana_override',
      'vacaciones_dias_override','vacaciones_tipo_override',
      'asuntos_propios_dias_override',
      'fecha_acuerdo_representantes'].forEach(k => {
      if (body[k] === '') body[k] = null
    })
    let ok = 0, ko = 0
    for (const tid of seleccion) {
      try {
        await empresaUpsert(identity, tid, body)
        ok++
      } catch (e) { ko++ }
    }
    setSaving(false)
    if (ko === 0) toast.success(`Copiado a ${ok} trainer${ok === 1 ? '' : 's'}`)
    else toast.error(`Copiados ${ok}, fallaron ${ko}`)
    onDone()
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--bg-0)', borderRadius: 12, padding: 20,
        width: '90%', maxWidth: 500, maxHeight: '80vh', overflow: 'auto',
        border: '1px solid var(--line)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <strong style={{ fontSize: 15, color: 'var(--text-0)' }}>Copiar datos a trainers</strong>
          <button onClick={onClose} type="button"
                  style={{ padding: 4, border: 'none', background: 'transparent', color: 'var(--text-3)', cursor: 'pointer' }}>
            <X size={16} />
          </button>
        </div>
        <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--text-3)' }}>
          Se copiará razón social, CIF, dirección, convenio y overrides a los trainers marcados.
          Reemplaza cualquier dato previo.
        </p>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
            {seleccion.size} de {destinos.length} seleccionados
          </span>
          <Btn size="sm" variant="ghost" onClick={todos}>
            {seleccion.size === destinos.length ? 'Quitar todos' : 'Seleccionar todos'}
          </Btn>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 16 }}>
          {destinos.map(t => {
            const e = empresasById[String(t.id)]
            const cfg = e && (e.razon_social || e.cif)
            const checked = seleccion.has(String(t.id))
            return (
              <label key={t.id} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 10px', borderRadius: 8,
                background: checked ? 'var(--green-bg, rgba(16,185,129,0.08))' : 'transparent',
                border: `1px solid ${checked ? 'var(--green, #10b981)' : 'var(--line)'}`,
                cursor: 'pointer',
              }}>
                <input type="checkbox" checked={checked}
                       onChange={() => toggle(String(t.id))}
                       style={{ width: 16, height: 16, cursor: 'pointer' }} />
                <span style={{ flex: 1, fontSize: 13, color: 'var(--text-0)' }}>
                  {(`${t.nombre || t.name || ''} ${t.apellidos || t.surname || ''}`).trim() || t.email}
                </span>
                {cfg && <Badge color="amber">⚠ se sobrescribe</Badge>}
              </label>
            )
          })}
          {destinos.length === 0 && (
            <p style={{ color: 'var(--text-3)', fontSize: 12, fontStyle: 'italic' }}>
              No hay otros trainers a los que copiar.
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn size="sm" variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Btn>
          <Btn size="sm" onClick={aplicar} disabled={saving || seleccion.size === 0}>
            <Copy size={13} /> {saving ? 'Copiando…' : `Copiar a ${seleccion.size}`}
          </Btn>
        </div>
      </div>
    </div>
  )
}


// ─── Motivos de pausa ──────────────────────────────────────────────────────

function MotivosSection({ identity }) {
  const toast = useToast()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [nuevo, setNuevo] = useState({ codigo: '', etiqueta: '', computa: false, justif: false })

  const reload = useCallback(async () => {
    setLoading(true)
    try { setItems(await motivosPausa(identity) || []) }
    catch (e) { toast.error('Error: ' + e.message) }
    finally { setLoading(false) }
  }, [identity, toast])

  useEffect(() => { reload() }, [reload])

  async function handleAdd(e) {
    e.preventDefault()
    if (!nuevo.codigo.trim() || !nuevo.etiqueta.trim()) {
      toast.error('Código y etiqueta requeridos'); return
    }
    try {
      await motivoCreate(identity, {
        codigo: nuevo.codigo.toLowerCase().replace(/\s+/g, '_'),
        etiqueta: nuevo.etiqueta,
        computa_jornada: nuevo.computa,
        requiere_justificante: nuevo.justif,
      })
      setNuevo({ codigo: '', etiqueta: '', computa: false, justif: false })
      toast.success('Motivo añadido')
      reload()
    } catch (e) { toast.error('Error: ' + e.message) }
  }

  async function handleToggle(m, k, v) {
    if (m.es_global) {
      toast.error('Los motivos globales no se editan directamente. Crea uno propio con el mismo código para sobrescribir.')
      return
    }
    try {
      await motivoUpdate(identity, m.id, { [k]: v })
      reload()
    } catch (e) { toast.error('Error: ' + e.message) }
  }

  async function handleDelete(m) {
    if (m.es_global) {
      toast.error('Los motivos globales no se borran. Crea un override con activo=false para desactivarlo.')
      return
    }
    if (!confirm(`¿Borrar motivo "${m.etiqueta}"?`)) return
    try { await motivoDelete(identity, m.id); toast.success('Motivo borrado'); reload() }
    catch (e) { toast.error('Error: ' + e.message) }
  }

  return (
    <Card style={{ padding: 18 }}>
      <SectionHeader icon={ListChecks} title="Motivos de pausa"
        subtitle="Los motivos globales del sistema vienen marcados. Tu manager puede añadir motivos propios o desactivar globales creando un motivo con el mismo código y activo=false." />

      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 10,
        padding: '10px 12px', borderRadius: 10, marginBottom: 14,
        background: 'rgba(59,130,246,0.06)',
        border: '1px solid rgba(59,130,246,0.16)',
        fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5,
      }}>
        <Info size={14} style={{ color: '#3b82f6', flexShrink: 0, marginTop: 2 }} />
        <div>
          <strong>Computa</strong> = la pausa cuenta como tiempo trabajado.
          Ej. los 15 min de descanso obligatorio del art. 34.4 ET sí computan
          (el trabajador cobra esa media hora). El descanso para comer
          normalmente NO computa.
          {' · '}
          <strong>Justificante</strong> = el sistema exige al trabajador
          adjuntar un motivo o justificante al iniciar la pausa (típico en
          médico).
        </div>
      </div>

      {loading && <p style={{ color: 'var(--text-3)' }}>Cargando…</p>}

      {!loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
          {items.map(m => (
            <div key={m.id} style={{
              display: 'grid', gridTemplateColumns: '1fr 2fr auto auto auto',
              gap: 8, alignItems: 'center', padding: '8px 10px',
              border: '1px solid var(--line)', borderRadius: 8,
            }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-3)' }}>
                {m.codigo}
              </span>
              <span style={{ fontSize: 13 }}>
                {m.etiqueta}
                {m.es_global && <Badge color="cyan" style={{ marginLeft: 6 }}>global</Badge>}
              </span>
              <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 11, color: 'var(--text-3)' }}>
                <input type="checkbox" checked={m.computa_jornada}
                       onChange={e => handleToggle(m, 'computa_jornada', e.target.checked)}
                       disabled={m.es_global} />
                computa
              </label>
              <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 11, color: 'var(--text-3)' }}>
                <input type="checkbox" checked={m.requiere_justificante}
                       onChange={e => handleToggle(m, 'requiere_justificante', e.target.checked)}
                       disabled={m.es_global} />
                justif.
              </label>
              <Btn size="sm" variant="ghost" onClick={() => handleDelete(m)} disabled={m.es_global}>
                <Trash2 size={13} />
              </Btn>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleAdd} style={{
        display: 'grid', gridTemplateColumns: '1fr 2fr auto auto auto',
        gap: 8, alignItems: 'end', padding: '12px 10px',
        background: 'var(--bg-2)', borderRadius: 8,
      }}>
        <Input label="Código" value={nuevo.codigo}
               onChange={e => setNuevo(n => ({ ...n, codigo: e.target.value }))} />
        <Input label="Etiqueta" value={nuevo.etiqueta}
               onChange={e => setNuevo(n => ({ ...n, etiqueta: e.target.value }))} />
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: 11, color: 'var(--text-3)' }}>
          computa
          <input type="checkbox" checked={nuevo.computa}
                 onChange={e => setNuevo(n => ({ ...n, computa: e.target.checked }))} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: 11, color: 'var(--text-3)' }}>
          justif.
          <input type="checkbox" checked={nuevo.justif}
                 onChange={e => setNuevo(n => ({ ...n, justif: e.target.checked }))} />
        </label>
        <Btn type="submit" size="sm">
          <Plus size={13} /> Añadir
        </Btn>
      </form>
    </Card>
  )
}


function SectionHeader({ icon: Icon, title, subtitle }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Icon size={18} style={{ color: 'var(--green)' }} aria-hidden="true" />
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 16, margin: 0 }}>
          {title}
        </h2>
      </div>
      {subtitle && (
        <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0, lineHeight: 1.5 }}>
          {subtitle}
        </p>
      )}
    </div>
  )
}
