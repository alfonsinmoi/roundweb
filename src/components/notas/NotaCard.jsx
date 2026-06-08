// Tarjeta de nota reutilizable (perfil cliente, banner, página /notas)
import { useState } from 'react'
import { User, Clock, Archive, Reply, BellOff, Trash2, CheckCircle2, MessageSquare } from 'lucide-react'
import { Btn, Badge } from '../UI'

function fmtDate(v) {
  if (!v) return ''
  try {
    const d = new Date(v)
    if (isNaN(d.getTime())) return v
    const today = new Date()
    if (d.toDateString() === today.toDateString()) return 'hoy ' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
    return d.toLocaleDateString('es-ES') + ' ' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  } catch { return v }
}

const ESTADO_BADGE = {
  abierta:      { label: 'Abierta',     color: 'green' },
  archivada:    { label: 'Archivada',   color: 'gray'  },
  recordatorio: { label: 'Recordatorio',color: 'amber' },
  contestada:   { label: 'Contestada',  color: 'blue'  },
}

export default function NotaCard({
  nota, compact = false,
  onArchivar, onRecordatorio, onResponder, onBorrar,
  showCliente = false,
}) {
  const [showActions, setShowActions] = useState(false)
  const estadoBadge = ESTADO_BADGE[nota.estado] || { label: nota.estado, color: 'gray' }

  return (
    <div style={{
      background: 'var(--bg-1)', border: '1px solid var(--line)', borderRadius: 12,
      padding: compact ? 10 : 14, marginBottom: 8,
    }}>
      {/* Cabecera */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <User size={12} style={{ color: 'var(--text-3)' }} aria-hidden="true" />
        <strong style={{ fontSize: 12, color: 'var(--text-1)' }}>
          {nota.created_by_label || nota.created_by_email || 'Sistema'}
        </strong>
        <Clock size={11} style={{ color: 'var(--text-3)', marginLeft: 6 }} aria-hidden="true" />
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{fmtDate(nota.created_at)}</span>
        {showCliente && nota.cliente_nombre && (
          <Badge color="blue" style={{ marginLeft: 'auto' }}>
            {nota.cliente_nombre}
          </Badge>
        )}
        {nota.asignada_a_label && (
          <Badge color="amber" style={{ marginLeft: showCliente ? 4 : 'auto' }}>
            → {nota.asignada_a_label}
          </Badge>
        )}
        <Badge color={estadoBadge.color}>{estadoBadge.label}</Badge>
        {nota.parent_id && (
          <Badge color="gray"><MessageSquare size={9} aria-hidden="true" /> respuesta</Badge>
        )}
      </div>

      {/* Contenido */}
      <p style={{
        fontSize: compact ? 12 : 13, color: 'var(--text-1)', lineHeight: 1.5,
        margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>
        {nota.contenido}
      </p>

      {/* Acuse de lectura (visible para el emisor): destinatario y/o cliente */}
      {(nota.leida_at || nota.leida_at_cliente) && (
        <div style={{ marginTop: 8, display: 'flex', gap: 12, flexWrap: 'wrap',
                      fontSize: 11, color: 'var(--green)' }}>
          {nota.leida_at && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <CheckCircle2 size={12} aria-hidden="true" />
              Leída{nota.leida_por_label ? ` por ${nota.leida_por_label}` : ''} · {fmtDate(nota.leida_at)}
            </span>
          )}
          {nota.leida_at_cliente && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <CheckCircle2 size={12} aria-hidden="true" />
              Leída por el cliente · {fmtDate(nota.leida_at_cliente)}
            </span>
          )}
        </div>
      )}

      {/* Acciones */}
      {(onArchivar || onRecordatorio || onResponder || onBorrar) && nota.estado !== 'archivada' && (
        <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {onResponder && (
            <Btn variant="secondary" size="sm" onClick={() => onResponder(nota)}>
              <Reply size={11} aria-hidden="true" /> Responder
            </Btn>
          )}
          {onArchivar && (
            <Btn variant="secondary" size="sm" onClick={() => onArchivar(nota)}>
              <Archive size={11} aria-hidden="true" /> Archivar
            </Btn>
          )}
          {onRecordatorio && (
            <RecordatorioMenu onPick={(h) => onRecordatorio(nota, h)} />
          )}
          {onBorrar && (
            <Btn variant="secondary" size="sm" onClick={() => onBorrar(nota)} title="Borrar">
              <Trash2 size={11} aria-hidden="true" />
            </Btn>
          )}
        </div>
      )}
    </div>
  )
}


function RecordatorioMenu({ onPick }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <Btn variant="secondary" size="sm" onClick={() => setOpen(o => !o)}>
        <BellOff size={11} aria-hidden="true" /> Recordar más tarde
      </Btn>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 10,
          background: 'var(--bg-1)', border: '1px solid var(--line)', borderRadius: 10,
          boxShadow: 'var(--shadow-lg)', minWidth: 160,
        }}>
          {[
            { h: 1,  l: 'En 1 hora' },
            { h: 4,  l: 'En 4 horas' },
            { h: 24, l: 'Mañana (24h)' },
            { h: 72, l: 'En 3 días' },
            { h: 168,l: 'En 1 semana' },
          ].map(opt => (
            <button key={opt.h} type="button"
                    onClick={() => { onPick(opt.h); setOpen(false) }}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '8px 14px', background: 'none', border: 'none',
                      color: 'var(--text-1)', cursor: 'pointer', fontSize: 12,
                    }}
                    onMouseOver={e => e.currentTarget.style.background = 'var(--bg-2)'}
                    onMouseOut={e => e.currentTarget.style.background = 'none'}>
              {opt.l}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
