import { useState, useEffect, useCallback } from 'react'
import { Building2, ListChecks, Save, Trash2, Plus, Info } from 'lucide-react'
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
      if (ts?.length && !trainerId) setTrainerId(String(ts[0].id))
    } catch (e) { toast.error('Error: ' + e.message) }
  }, [identity, toast, trainerId])

  useEffect(() => { reload() }, []) // eslint-disable-line

  const empresa = empresas.find(e => String(e.id_trainer) === String(trainerId)) || null

  return (
    <Card style={{ padding: 18 }}>
      <SectionHeader icon={Building2} title="Datos de empresa por trainer"
        subtitle="El trainer es la entidad jurídica empleadora del trabajador (art. 34.9 ET). Estos datos heredan a los trabajadores adscritos." />
      <Select label="Trainer / centro" value={trainerId}
              onChange={e => setTrainerId(e.target.value)}>
        {trainers.map(t => (
          <option key={t.id} value={t.id}>
            {`${t.nombre || t.name || ''} ${t.apellidos || t.surname || ''}`.trim() || t.email}
          </option>
        ))}
      </Select>
      {trainerId && (
        <EmpresaForm key={trainerId}
                     identity={identity}
                     idTrainer={trainerId}
                     empresa={empresa}
                     convenios={convs}
                     onSaved={reload} />
      )}
    </Card>
  )
}


function EmpresaForm({ identity, idTrainer, empresa, convenios, onSaved }) {
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
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Btn type="submit" disabled={saving}>
          <Save size={14} /> {saving ? 'Guardando…' : 'Guardar'}
        </Btn>
      </div>
    </form>
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
