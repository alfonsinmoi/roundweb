import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Check, X, RefreshCcw, Filter, CalendarRange, Sun, Stethoscope, Coffee, Plus,
  Download, Users, Clock as ClockIcon, CheckCircle2, BarChart3,
} from 'lucide-react'
import { Card, Btn, Badge, Table, EmptyState, Select, Input } from '../../components/UI'
import { useToast } from '../../components/Toast'
import Modal from '../../components/Modal'
import {
  ausenciasList, ausenciaAprobar, ausenciaRechazar,
  ausenciaCrearAdmin, trabajadoresList,
} from '../../utils/horarioApi'


const TIPOS_LIST = [
  { id: 'vacaciones',         label: 'Vacaciones',          color: 'cyan'   },
  { id: 'asuntos_propios',    label: 'Asuntos propios',      color: 'purple' },
  { id: 'medico',             label: 'Médico',               color: 'red'    },
  { id: 'personal',           label: 'Personal',             color: 'amber'  },
  { id: 'baja_medica',        label: 'Baja médica',          color: 'red'    },
  { id: 'permiso_retribuido', label: 'Permiso retribuido',   color: 'green'  },
  { id: 'otros',              label: 'Otros',                color: 'gray'   },
]
const TIPO_MAP = Object.fromEntries(TIPOS_LIST.map(t => [t.id, t]))

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
               'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']


export default function AusenciasTab({ identity }) {
  const toast = useToast()

  const currentYear = new Date().getFullYear()
  const [filters, setFilters] = useState({
    estado:        '',                // '' = todos
    trabajador_id: '',
    tipo:          '',
    ano:           String(currentYear),
    mes:           '',
    desde:         '',
    hasta:         '',
  })
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
      Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v })
      const list = await ausenciasList(identity, params)
      setItems(list || [])
    } catch (e) {
      toast.error('Error: ' + (e.message || '?'))
    } finally { setLoading(false) }
  }, [identity, filters, toast])

  useEffect(() => { reload() }, [reload])

  async function handleAprobar(s) {
    const motivo = prompt('Comentario al aprobar (opcional):', '') ?? ''
    try {
      await ausenciaAprobar(identity, s.id, { motivo })
      toast.success('Solicitud aprobada'); reload()
    } catch (e) { toast.error('Error: ' + (e.body?.detalle || e.message)) }
  }
  async function handleRechazar(s) {
    const motivo = prompt(`Motivo del rechazo (lo verá ${s.trabajador_nombre}):`, '')
    if (motivo === null) return
    try {
      await ausenciaRechazar(identity, s.id, { motivo })
      toast.success('Solicitud rechazada'); reload()
    } catch (e) { toast.error('Error: ' + (e.body?.detalle || e.message)) }
  }

  // ── KPIs derivados del listado actual ──────────────────────────────────
  const kpis = useMemo(() => {
    const aprobadas = items.filter(x => x.estado === 'aprobada')
    const pendientes = items.filter(x => x.estado === 'pendiente')
    const totalDiasAprob = aprobadas.reduce((acc, s) => acc + diasSolicitud(s), 0)
    const trabajadoresAfectados = new Set(aprobadas.map(s => s.trabajador_id)).size
    const porTipo = {}
    aprobadas.forEach(s => {
      porTipo[s.tipo] = (porTipo[s.tipo] || 0) + diasSolicitud(s)
    })
    return {
      totalSolicitudes:    items.length,
      aprobadas:           aprobadas.length,
      pendientes:          pendientes.length,
      diasTotales:         totalDiasAprob,
      trabajadoresAfectados,
      porTipo,
    }
  }, [items])

  function exportCsv() {
    if (!items.length) { toast.error('Sin datos para exportar'); return }
    const cols = ['id', 'trabajador_id', 'trabajador_nombre', 'tipo',
                  'fecha_desde', 'fecha_hasta', 'jornada_completa',
                  'hora_desde', 'hora_hasta', 'dias',
                  'motivo_trabajador', 'estado', 'motivo_resolucion', 'ts_resolucion', 'created_at']
    const csv = [
      cols.join(','),
      ...items.map(s => cols.map(c => {
        const v = c === 'dias' ? diasSolicitud(s) : s[c]
        if (v == null) return ''
        const str = String(v).replace(/"/g, '""')
        return /[,"\n]/.test(str) ? `"${str}"` : str
      }).join(',')),
    ].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    const tag = [filters.estado, filters.ano, filters.tipo].filter(Boolean).join('_') || 'todas'
    a.download = `ausencias_${tag}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  function setF(k, v) { setFilters(f => ({ ...f, [k]: v })) }

  return (
    <div>
      {/* ── KPIs ─────────────────────────────────────────────────────── */}
      <div style={{
        display: 'grid', gap: 10,
        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        marginBottom: 14,
      }}>
        <Kpi icon={CheckCircle2} label="Aprobadas" value={kpis.aprobadas}
             sub={`${kpis.diasTotales} días totales`} color="green" />
        <Kpi icon={ClockIcon} label="Pendientes" value={kpis.pendientes}
             sub="esperando autorización" color="amber" />
        <Kpi icon={Users} label="Trabajadores" value={kpis.trabajadoresAfectados}
             sub="con ausencia aprobada" />
        <Kpi icon={Sun} label="Vacaciones" value={`${kpis.porTipo.vacaciones || 0}d`}
             sub="aprobadas" color="cyan" />
        <Kpi icon={CalendarRange} label="As. propios" value={`${kpis.porTipo.asuntos_propios || 0}d`}
             sub="aprobados" color="purple" />
        <Kpi icon={Stethoscope} label="Médico" value={`${(kpis.porTipo.medico || 0) + (kpis.porTipo.baja_medica || 0)}d`}
             sub="médico + baja" color="red" />
      </div>

      {/* ── Filtros ──────────────────────────────────────────────────── */}
      <Card style={{ padding: 12, marginBottom: 14 }}>
        <div style={{
          display: 'grid', gap: 10, alignItems: 'end',
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
        }}>
          <FilterField label="Estado">
            <select value={filters.estado} onChange={e => setF('estado', e.target.value)} style={selectStyle}>
              <option value="">Todos</option>
              <option value="pendiente">Pendientes</option>
              <option value="aprobada">Aprobadas</option>
              <option value="rechazada">Rechazadas</option>
              <option value="cancelada">Canceladas</option>
            </select>
          </FilterField>
          <FilterField label="Trabajador">
            <select value={filters.trabajador_id} onChange={e => setF('trabajador_id', e.target.value)} style={selectStyle}>
              <option value="">Todos</option>
              {trabajadores.map(t => (
                <option key={t.id} value={t.id}>{t.nombre_completo || t.email || `#${t.id}`}</option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Tipo">
            <select value={filters.tipo} onChange={e => setF('tipo', e.target.value)} style={selectStyle}>
              <option value="">Todos</option>
              {TIPOS_LIST.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </FilterField>
          <FilterField label="Año">
            <select value={filters.ano} onChange={e => setF('ano', e.target.value)} style={selectStyle}>
              <option value="">Todos</option>
              {Array.from({ length: 5 }, (_, i) => currentYear - i).map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Mes">
            <select value={filters.mes} onChange={e => setF('mes', e.target.value)} style={selectStyle}>
              <option value="">Todos</option>
              {MESES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
            </select>
          </FilterField>
          <FilterField label="Desde (fecha)">
            <input type="date" value={filters.desde} onChange={e => setF('desde', e.target.value)} style={inputStyle} />
          </FilterField>
          <FilterField label="Hasta (fecha)">
            <input type="date" value={filters.hasta} onChange={e => setF('hasta', e.target.value)} style={inputStyle} />
          </FilterField>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <Btn variant="ghost" size="sm" onClick={() => setFilters({
            estado: '', trabajador_id: '', tipo: '',
            ano: String(currentYear), mes: '', desde: '', hasta: '',
          })}>
            Limpiar
          </Btn>
          <Btn variant="ghost" size="sm" onClick={exportCsv}>
            <Download size={14} /> CSV
          </Btn>
          <Btn variant="ghost" size="sm" onClick={reload}>
            <RefreshCcw size={14} /> Recargar
          </Btn>
          <Btn size="sm" onClick={() => setShowNueva(true)}>
            <Plus size={14} /> Nueva ausencia
          </Btn>
        </div>
      </Card>

      {showNueva && (
        <NuevaAusenciaModal identity={identity}
                            trabajadores={trabajadores}
                            onClose={() => setShowNueva(false)}
                            onSaved={() => { setShowNueva(false); reload() }} />
      )}

      {loading && <p style={{ color: 'var(--text-3)' }}>Cargando…</p>}

      {!loading && items.length === 0 && (
        <EmptyState icon={Filter} title="Sin solicitudes"
                    description="No hay solicitudes que coincidan con los filtros." />
      )}

      {!loading && items.length > 0 && (
        <Card style={{ padding: 0 }}>
          <Table
            ariaLabel="Solicitudes de ausencia"
            columns={[
              { key: 'trab', label: 'Trabajador', render: (_, r) => r.trabajador_nombre || `#${r.trabajador_id}` },
              { key: 'tipo', label: 'Tipo', render: (_, r) => {
                const cfg = TIPO_MAP[r.tipo] || TIPO_MAP.otros
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
                  {diasSolicitud(r)}
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


// ═══════════════════════════════════════════════════════════════════════════
// Helpers + KPI card
// ═══════════════════════════════════════════════════════════════════════════

function Kpi({ icon: Icon, label, value, sub, color = 'gray' }) {
  const fg = color === 'green'  ? 'var(--green, #10b981)'
           : color === 'amber'  ? '#f59e0b'
           : color === 'red'    ? 'var(--red, #f87171)'
           : color === 'cyan'   ? '#22d3ee'
           : color === 'purple' ? '#a78bfa'
           : 'var(--text-0)'
  return (
    <div style={{
      padding: '12px 14px', borderRadius: 12,
      background: 'var(--bg-1)', border: '1px solid var(--line)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        {Icon && <Icon size={14} style={{ color: fg }} />}
        <p style={{ margin: 0, fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
          {label}
        </p>
      </div>
      <p style={{ margin: 0, fontFamily: 'var(--font-display, Outfit)', fontSize: 22, fontWeight: 700, color: fg, lineHeight: 1 }}>
        {value}
      </p>
      {sub && (
        <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-3)' }}>{sub}</p>
      )}
    </div>
  )
}


function FilterField({ label, children }) {
  return (
    <div>
      <label style={lblStyle}>{label}</label>
      {children}
    </div>
  )
}


function fmtDate(iso) {
  if (!iso) return '—'
  try { return new Date(iso + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) }
  catch { return iso }
}
function diasSolicitud(s) {
  if (!s.jornada_completa) return 0.5
  try {
    const a = new Date(s.fecha_desde + 'T00:00:00')
    const b = new Date(s.fecha_hasta + 'T00:00:00')
    return Math.round((b - a) / 86400000) + 1
  } catch { return 1 }
}
function estadoColor(e) {
  return ({ pendiente: 'amber', aprobada: 'green', rechazada: 'red', cancelada: 'gray' })[e] || 'gray'
}


const lblStyle = {
  display: 'block', marginBottom: 4, fontSize: 11,
  color: 'var(--text-3)', fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: '0.05em',
}
const selectStyle = {
  width: '100%', padding: '8px 10px', borderRadius: 8,
  border: '1px solid var(--line)', background: 'var(--bg-1)',
  color: 'var(--text-1)', fontSize: 13, cursor: 'pointer',
}
const inputStyle = {
  width: '100%', padding: '8px 10px', borderRadius: 8,
  border: '1px solid var(--line)', background: 'var(--bg-1)',
  color: 'var(--text-1)', fontSize: 13,
}


// ═══════════════════════════════════════════════════════════════════════════
// ║  NuevaAusenciaModal — admin crea ausencia directamente (aprobada)      ║
// ═══════════════════════════════════════════════════════════════════════════

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
