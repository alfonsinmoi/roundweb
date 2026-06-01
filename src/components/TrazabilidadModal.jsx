// Modal de trazabilidad de un cliente: timeline cronológica con todos los
// eventos relevantes (altas, bajas, baja programada, cambios manuales de
// cuotas/descuentos/modificaciones/etc.).
//
// Fuentes:
//   - cliente_estado_log (cron diario)
//   - cliente_baja_programada (planificada + ejecutada)
//   - audit_log (modificaciones manuales)
//
// Se ordena DESCENDENTE (más reciente primero), color por tipo.

import { useState, useEffect, useMemo } from 'react'
import { History, Loader2, ArrowDown, ArrowUp, UserCheck, Archive, Clock, Edit2 } from 'lucide-react'
import Modal from './Modal'
import { Btn } from './UI'
import { useAuth } from '../contexts/AuthContext'
import { clienteTrazabilidad, getRoundIdentity } from '../utils/configApi'

function fmtFecha(s) {
  if (!s) return '—'
  try {
    const d = new Date(s)
    return d.toLocaleString('es-ES', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch { return s }
}

function iconoTipo(t) {
  if (t === 'estado') return UserCheck
  if (t === 'baja_programada' || t === 'baja_programada_ejecutada') return Clock
  if (String(t).startsWith('manual:')) return Edit2
  return History
}

function colorTipo(t, evento) {
  if (t === 'estado' && evento?.estado === 'activo') return 'var(--green, #2DD4A8)'
  if (t === 'estado' && evento?.estado === 'archivado') return 'var(--red, #f87185)'
  if (t === 'baja_programada' || t === 'baja_programada_ejecutada') return 'var(--amber, #fbbf24)'
  return 'var(--text-3, #888)'
}


export default function TrazabilidadModal({ cliente, onClose }) {
  const { user } = useAuth()
  const identity = useMemo(() => getRoundIdentity(user), [user])
  const [eventos, setEventos] = useState([])
  const [loading, setLoading] = useState(true)
  const [order, setOrder] = useState('desc')   // 'desc' (recientes arriba) | 'asc'

  useEffect(() => {
    let cancel = false
    setLoading(true)
    clienteTrazabilidad(identity, cliente.id)
      .then(evs => { if (!cancel) setEventos(evs) })
      .catch(() => { if (!cancel) setEventos([]) })
      .finally(() => { if (!cancel) setLoading(false) })
    return () => { cancel = true }
  }, [cliente?.id, identity])

  const ordenados = useMemo(() => {
    const arr = [...eventos]
    arr.sort((a, b) => order === 'desc'
      ? new Date(b.ts) - new Date(a.ts)
      : new Date(a.ts) - new Date(b.ts))
    return arr
  }, [eventos, order])

  return (
    <Modal open={true} onClose={onClose} maxWidth={680}
           title={<><History size={16} style={{ marginRight: 6 }} /> Trazabilidad de {cliente?.name} {cliente?.surname}</>}>
      <div style={{ padding: 24, flex: 1, overflowY: 'auto', minHeight: 0 }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      marginBottom: 16, fontSize: 12, color: 'var(--text-3)' }}>
          <span>{eventos.length} evento{eventos.length !== 1 ? 's' : ''} registrado{eventos.length !== 1 ? 's' : ''}</span>
          <Btn size="sm" variant="secondary"
               onClick={() => setOrder(o => o === 'desc' ? 'asc' : 'desc')}>
            {order === 'desc' ? <><ArrowDown size={12} /> Recientes arriba</>
                              : <><ArrowUp size={12} /> Antiguos arriba</>}
          </Btn>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)' }}>
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : ordenados.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-3)',
                        border: '1px dashed var(--line)', borderRadius: 10 }}>
            Sin eventos registrados todavía.<br/>
            <span style={{ fontSize: 12 }}>
              El cron `round_cliente_log` registra altas/bajas cada 24 h.
              Las modificaciones manuales (cuotas, descuentos…) aparecen al instante.
            </span>
          </div>
        ) : (
          <ol style={{ listStyle: 'none', padding: 0, margin: 0,
                       borderLeft: '2px solid var(--line)', marginLeft: 12 }}>
            {ordenados.map((ev, i) => {
              const Ic = iconoTipo(ev.tipo)
              const c = colorTipo(ev.tipo, ev)
              return (
                <li key={i} style={{ position: 'relative', paddingLeft: 24, paddingBottom: 16 }}>
                  <span style={{
                    position: 'absolute', left: -10, top: 2,
                    width: 18, height: 18, borderRadius: '50%',
                    background: 'var(--bg-1)', border: `2px solid ${c}`,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    color: c,
                  }}>
                    <Ic size={10} aria-hidden="true" />
                  </span>
                  <div style={{ fontSize: 13, color: 'var(--text-0)', fontWeight: 600 }}>
                    {ev.descripcion}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                    {fmtFecha(ev.ts)} · {ev.por}
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </div>

      <div style={{ padding: '12px 24px', borderTop: '1px solid var(--line)',
                    display: 'flex', justifyContent: 'flex-end',
                    background: 'var(--bg-2)' }}>
        <Btn variant="secondary" onClick={onClose}>Cerrar</Btn>
      </div>
    </Modal>
  )
}
