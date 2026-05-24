import { useState, useEffect, useCallback } from 'react'
import { Check, X, RefreshCcw, Filter, CalendarRange, Sun, Stethoscope, Coffee } from 'lucide-react'
import { Card, Btn, Badge, Table, EmptyState, Select } from '../../components/UI'
import { useToast } from '../../components/Toast'
import {
  ausenciasList, ausenciaAprobar, ausenciaRechazar,
  trabajadoresList,
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
        </div>
      </Card>

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
