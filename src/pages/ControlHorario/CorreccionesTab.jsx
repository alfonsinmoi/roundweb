import { useState, useEffect, useCallback } from 'react'
import { Check, X, RefreshCcw } from 'lucide-react'
import { Card, Btn, Badge, Table, EmptyState } from '../../components/UI'
import { useToast } from '../../components/Toast'
import { correccionesList, correccionAprobar, correccionRechazar } from '../../utils/horarioApi'
import { useCan } from '../../hooks/useCan'


export default function CorreccionesTab({ identity }) {
  const toast = useToast()
  const canAprobar = useCan('control_horario.correcciones.aprobar')
  const canRechazar = useCan('control_horario.correcciones.rechazar')
  const [estado, setEstado] = useState('pendiente')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const list = await correccionesList(identity, estado)
      setItems(list || [])
    } catch (e) {
      toast.error('Error: ' + (e.message || 'desconocido'))
    } finally { setLoading(false) }
  }, [identity, estado, toast])

  useEffect(() => { reload() }, [reload])

  async function handleAprobar(c) {
    const comentario = prompt('Comentario (opcional):', '') ?? ''
    try {
      await correccionAprobar(identity, c.id, { comentario })
      toast.success('Corrección aprobada')
      reload()
    } catch (e) { toast.error('Error: ' + e.message) }
  }

  async function handleRechazar(c) {
    const comentario = prompt('Motivo del rechazo:', '')
    if (comentario === null) return
    try {
      await correccionRechazar(identity, c.id, { comentario })
      toast.success('Corrección rechazada')
      reload()
    } catch (e) { toast.error('Error: ' + e.message) }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <button onClick={() => setEstado('pendiente')}  style={pillStyle(estado === 'pendiente')}>Pendientes</button>
        <button onClick={() => setEstado('aprobada')}   style={pillStyle(estado === 'aprobada')}>Aprobadas</button>
        <button onClick={() => setEstado('rechazada')}  style={pillStyle(estado === 'rechazada')}>Rechazadas</button>
        <div style={{ flex: 1 }} />
        <Btn variant="ghost" size="sm" onClick={reload}>
          <RefreshCcw size={14} /> Recargar
        </Btn>
      </div>

      {loading && <p style={{ color: 'var(--text-3)' }}>Cargando…</p>}
      {!loading && items.length === 0 && (
        <EmptyState icon={Check} title="Sin solicitudes"
                    description={`No hay correcciones en estado "${estado}".`} />
      )}
      {!loading && items.length > 0 && (
        <Card style={{ padding: 0 }}>
          <Table
            ariaLabel="Solicitudes de corrección"
            columns={[
              { key: 'created',  label: 'Solicitada',    render: (_, r) => fmt(r.created_at) },
              { key: 'trab',     label: 'Trabajador',    render: (_, r) => r.trabajador_nombre || `#${r.trabajador_id}` },
              { key: 'tipo',     label: 'Tipo',          render: (_, r) => <Badge color="purple">{r.tipo_propuesto}</Badge> },
              { key: 'when',     label: 'Cuando',        render: (_, r) => fmt(r.ts_propuesto) },
              { key: 'motivo',   label: 'Motivo',        render: (_, r) => (
                <span style={{ display: 'block', maxWidth: 320, whiteSpace: 'normal' }}>{r.motivo || ''}</span>
              )},
              { key: 'estado',   label: 'Estado', render: (_, r) => (
                <Badge color={r.estado === 'pendiente' ? 'amber' : r.estado === 'aprobada' ? 'green' : 'red'}>
                  {r.estado}
                </Badge>
              )},
              { key: 'acciones', label: '', render: (_, r) => r.estado === 'pendiente' ? (
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  {canRechazar && (
                    <Btn size="sm" variant="ghost" onClick={() => handleRechazar(r)}>
                      <X size={13} /> Rechazar
                    </Btn>
                  )}
                  {canAprobar && (
                    <Btn size="sm" onClick={() => handleAprobar(r)}>
                      <Check size={13} /> Aprobar
                    </Btn>
                  )}
                </div>
              ) : (
                <span style={{ color: 'var(--text-3)', fontSize: 11 }}>
                  {r.comentario_resolucion || '—'}
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


function fmt(iso) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) }
  catch { return iso }
}

function pillStyle(active) {
  return {
    padding: '6px 14px', borderRadius: 999, fontSize: 13,
    background: active ? 'var(--green-bg)' : 'var(--bg-2)',
    color: active ? 'var(--green)' : 'var(--text-2)',
    border: active ? '1px solid var(--green)' : '1px solid var(--line)',
    cursor: 'pointer', fontWeight: active ? 600 : 500,
  }
}
