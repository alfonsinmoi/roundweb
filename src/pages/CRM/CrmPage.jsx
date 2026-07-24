import { useState, useEffect, useMemo } from 'react'
import {
  Users, Loader2, RefreshCw, Mail, Phone, Building2, Filter, AlertTriangle, X, BarChart3, Plus,
} from 'lucide-react'
import { Card, Btn, SectionTitle } from '../../components/UI'
import { useToast } from '../../components/Toast'
import { useAuth } from '../../contexts/AuthContext'
import {
  getRoundIdentity, leadsList, leadUpdate, crmStages, centrosList,
  crmLostReasons, crmFunnel, leadManualCreate,
} from '../../utils/configApi'
import Modal from '../../components/Modal'
import { useCan } from '../../hooks/useCan'
import { useOverlayClose } from '../../hooks/useOverlayClose'

const SCORE_COLOR = {
  green: { bg: 'var(--green-bg)',  fg: 'var(--green)',  border: 'var(--green-border)'  },
  amber: { bg: 'var(--amber-bg)',  fg: 'var(--amber)',  border: 'var(--amber-border)'  },
  red:   { bg: 'var(--red-bg)',    fg: 'var(--red)',    border: 'var(--red-border)'    },
  gray:  { bg: 'var(--bg-3)',      fg: 'var(--text-3)', border: 'var(--line)'           },
}

export default function CrmPage() {
  const { user, isImpersonating } = useAuth()
  const identity = useMemo(() => getRoundIdentity(user), [user])
  const toast = useToast()
  // Gates UI: mover lead entre etapas (drag&drop) y crear lead manual.
  const canMoverLead = useCan('crm.leads.mover_etapa')
  const canCrearLeadManual = useCan('crm.lead_manual.crear_manual')
  const [leads, setLeads] = useState([])
  const [stages, setStages] = useState([])
  const [centros, setCentros] = useState([])
  const [lostReasons, setLostReasons] = useState([])
  const [funnel, setFunnel] = useState(null)
  const [loading, setLoading] = useState(true)
  const [filtroTrainer, setFiltroTrainer] = useState('')
  const [filtroScore, setFiltroScore] = useState('')   // '', 'green', 'amber', 'red'
  const [draggingId, setDraggingId] = useState(null)
  const [hoverStageId, setHoverStageId] = useState(null)
  const [showFunnel, setShowFunnel] = useState(false)
  const [lostModal, setLostModal] = useState(null)     // { lead, stageId }
  const [crearLeadOpen, setCrearLeadOpen] = useState(false)

  async function reload() {
    setLoading(true)
    try {
      const [l, s, c, lr, fn] = await Promise.all([
        leadsList(identity).catch(() => []),
        crmStages(identity).catch(() => []),
        isImpersonating ? Promise.resolve([]) : centrosList(identity).catch(() => []),
        crmLostReasons(identity).catch(() => []),
        crmFunnel(identity).catch(() => null),
      ])
      setLeads(l || []); setStages(s || []); setCentros(c || [])
      setLostReasons(lr || []); setFunnel(fn || null)
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setLoading(false)
  }
  useEffect(() => { reload() }, [identity.managerId, identity.trainerId])

  const stagesView = stages.length > 0 ? stages : [{ id: 'placeholder', name: 'Nuevos', sequence: 1 }]

  const leadsFiltered = useMemo(() => {
    let arr = leads
    if (filtroTrainer) arr = arr.filter(l => String(l.id_trainer) === String(filtroTrainer))
    if (filtroScore)   arr = arr.filter(l => l.score_color === filtroScore)
    return arr
  }, [leads, filtroTrainer, filtroScore])

  const byStage = useMemo(() => {
    const m = {}
    for (const s of stagesView) m[s.id] = []
    m._sin_etapa = []
    for (const l of leadsFiltered) {
      const sid = l.lead?.stage_id?.[0]
      if (sid && m[sid]) m[sid].push(l)
      else m._sin_etapa.push(l)
    }
    // ordenar por score desc dentro de cada columna
    for (const k of Object.keys(m)) m[k].sort((a, b) => (b.score || 0) - (a.score || 0))
    return m
  }, [leadsFiltered, stagesView])

  function fullName(l) {
    return l.lead?.contact_name || l.lead?.name || `Lead #${l.odoo_lead_id}`
  }
  function formatDate(s) {
    if (!s) return ''
    try { return new Date(s).toLocaleDateString('es-ES', { day:'numeric', month:'short' }) }
    catch { return String(s).slice(0, 10) }
  }
  function trainerName(idTrainer) {
    const c = centros.find(c => String(c.id_trainer) === String(idTrainer))
    return c?.nombre_centro || `Trainer ${idTrainer}`
  }

  async function moveTo(lead, stageId, lostReason = null) {
    setDraggingId(null); setHoverStageId(null)
    if (!canMoverLead) return
    if (!lead.lead?.id || stageId === lead.lead?.stage_id?.[0]) return
    if (stageId === '_sin_etapa' || stageId === 'placeholder') return
    const stageIdInt = parseInt(stageId, 10)
    if (Number.isNaN(stageIdInt)) return
    const targetStage = stagesView.find(s => s.id === stageId)
    const isLost = (targetStage?.name || '').toLowerCase() === 'perdido' || targetStage?.fold

    // Si va a Perdido y no nos dieron motivo, abrir modal
    if (isLost && !lostReason) {
      setLostModal({ lead, stageId })
      return
    }

    try {
      const payload = { stage_id: stageIdInt }
      if (isLost && lostReason) payload.lost_reason = lostReason
      const updated = await leadUpdate(identity, lead.lead.id, payload)
      setLeads(arr => arr.map(l => l.odoo_lead_id === lead.odoo_lead_id
        ? { ...l, lead: { ...l.lead, ...updated }, lost_reason: lostReason || l.lost_reason }
        : l))
      toast.success(isLost ? `Marcado como perdido (${lostReason || '—'})` : 'Etapa actualizada')
      // recargar para refrescar score y funnel
      reload()
    } catch (e) { toast.error(`Error: ${e.message}`) }
  }

  return (
    <div style={{ maxWidth: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <Users size={22} style={{ color: 'var(--green)' }} aria-hidden="true" />
        <h1 style={{ fontFamily: 'Outfit', fontSize: 28, fontWeight: 700, color: 'var(--text-0)', margin: 0 }}>
          CRM · Leads
        </h1>
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 20 }}>
        Pipeline de leads desde el formulario web, Instagram y altas manuales.
        {!isImpersonating && <> Vista de manager — ves los leads de todos los centros.</>}
        {isImpersonating && <> Operando como trainer · solo ves los tuyos.</>}
      </p>

      {/* Filtros + acciones */}
      <Card style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {!isImpersonating && centros.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Filter size={14} style={{ color: 'var(--text-3)' }} />
              <select value={filtroTrainer} onChange={e => setFiltroTrainer(e.target.value)}
                      style={selectStyle}>
                <option value="">Todos los centros</option>
                {centros.map(c => (
                  <option key={c.id_trainer} value={c.id_trainer}>{c.nombre_centro}</option>
                ))}
              </select>
            </div>
          )}
          <select value={filtroScore} onChange={e => setFiltroScore(e.target.value)}
                  style={selectStyle}>
            <option value="">Todos los scores</option>
            <option value="green">🟢 Alto (≥70)</option>
            <option value="amber">🟡 Medio (40-69)</option>
            <option value="red">🔴 Bajo (&lt;40)</option>
          </select>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
            {leadsFiltered.length} lead{leadsFiltered.length !== 1 ? 's' : ''}
          </span>
          {canCrearLeadManual && (
            <Btn size="sm" variant="primary" onClick={() => setCrearLeadOpen(true)}
                 title="Registrar un lead presencial (alguien que ha venido al gimnasio sin pasar por la web)">
              <Plus size={13} /> Nuevo lead
            </Btn>
          )}
          <Btn size="sm" variant="secondary" onClick={() => setShowFunnel(s => !s)}>
            <BarChart3 size={13} /> {showFunnel ? 'Ocultar' : 'Ver'} embudo
          </Btn>
          <Btn size="sm" variant="secondary" onClick={reload} disabled={loading}>
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            Recargar
          </Btn>
        </div>
      </Card>

      {showFunnel && funnel && <FunnelCard funnel={funnel} />}

      {/* Kanban */}
      {loading && leads.length === 0 ? (
        <Card style={{ padding: 60, textAlign: 'center' }}>
          <Loader2 size={28} className="animate-spin" style={{ color: 'var(--green)' }} />
        </Card>
      ) : leadsFiltered.length === 0 ? (
        <Card style={{ padding: 40, textAlign: 'center' }}>
          <p style={{ color: 'var(--text-3)' }}>
            {leads.length === 0
              ? 'Sin leads todavía. Cuando alguien rellene el formulario de la web aparecerá aquí.'
              : 'Ningún lead cumple los filtros activos.'}
          </p>
        </Card>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${stagesView.length + 1}, minmax(260px, 1fr))`,
          gap: 12,
          overflowX: 'auto', paddingBottom: 12,
        }}>
          {[...stagesView, { id: '_sin_etapa', name: 'Sin etapa', sequence: 9999 }].map(stage => {
            const items = byStage[stage.id] || []
            const isFolded = stage.fold
            return (
              <div key={stage.id}
                   onDragOver={e => { e.preventDefault(); setHoverStageId(stage.id) }}
                   onDragLeave={() => setHoverStageId(prev => prev === stage.id ? null : prev)}
                   onDrop={e => {
                     e.preventDefault()
                     const id = e.dataTransfer.getData('lead-id')
                     const lead = leads.find(l => String(l.odoo_lead_id) === id)
                     if (lead) moveTo(lead, stage.id)
                   }}
                   style={{
                     background: hoverStageId === stage.id ? 'rgba(45,212,168,0.08)' :
                                 isFolded ? 'rgba(248,113,113,0.04)' : 'var(--bg-1)',
                     border: '1px solid var(--line)', borderRadius: 12, padding: 10,
                     transition: 'background 0.1s',
                     minHeight: 200,
                   }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: stage.is_won ? 'var(--green)' :
                                isFolded ? 'var(--red)' : 'var(--blue)',
                  }} />
                  <span style={{ fontFamily: 'Outfit', fontSize: 13, fontWeight: 600,
                                 color: isFolded ? 'var(--text-2)' : 'var(--text-0)', flex: 1 }}>
                    {stage.name}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                    {items.length}
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {items.map(l => <LeadCard key={l.odoo_lead_id} l={l}
                                            isImpersonating={isImpersonating}
                                            draggingId={draggingId}
                                            setDraggingId={setDraggingId}
                                            canMover={canMoverLead}
                                            fullName={fullName} formatDate={formatDate}
                                            trainerName={trainerName} />)}
                  {items.length === 0 && (
                    <p style={{ fontSize: 11, color: 'var(--text-3)', textAlign: 'center', padding: 16, fontStyle: 'italic' }}>
                      Arrastra un lead aquí
                    </p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {lostModal && (
        <LostReasonModal
          reasons={lostReasons}
          onCancel={() => setLostModal(null)}
          onConfirm={r => { const m = lostModal; setLostModal(null); moveTo(m.lead, m.stageId, r) }}
        />
      )}

      {crearLeadOpen && (
        <NuevoLeadModal
          identity={identity}
          centros={centros}
          onClose={() => setCrearLeadOpen(false)}
          onCreated={() => reload()}
        />
      )}
    </div>
  )
}


function LeadCard({ l, isImpersonating, draggingId, setDraggingId, canMover = true, fullName, formatDate, trainerName }) {
  const score = l.score ?? 0
  const color = SCORE_COLOR[l.score_color || 'gray']
  const warn = l.warning_sin_contactar
  const isLost = !!l.lost_at || (l.lead?.stage_id?.[1] || '').toLowerCase() === 'perdido'
  const qual = l.qualification || {}

  return (
    <div draggable={canMover}
         onDragStart={canMover ? (e => { setDraggingId(l.odoo_lead_id); e.dataTransfer.setData('lead-id', String(l.odoo_lead_id)) }) : undefined}
         onDragEnd={canMover ? (() => setDraggingId(null)) : undefined}
         style={{
           background: 'var(--bg-2)',
           border: warn ? '1px solid var(--red-border)' : '1px solid var(--line)',
           borderRadius: 10, padding: 12, cursor: canMover ? 'grab' : 'default',
           opacity: draggingId === l.odoo_lead_id ? 0.4 : 1,
           position: 'relative',
         }}>
      {/* Score badge */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: isLost ? 'var(--text-3)' : 'var(--text-0)',
                    textDecoration: isLost ? 'line-through' : 'none', flex: 1 }}>
          {fullName(l)}
        </p>
        <span title={`Score: ${score}/100`} style={{
          fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
          background: color.bg, color: color.fg, border: `1px solid ${color.border}`,
          fontFamily: 'var(--font-mono)',
        }}>
          {score}
        </span>
      </div>

      {warn && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6,
                      fontSize: 10, color: 'var(--red)' }}>
          <AlertTriangle size={11} /> Sin contactar &gt;24h
        </div>
      )}
      {isLost && l.lost_reason && (
        <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 6 }}>
          Perdido: {l.lost_reason}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {l.lead?.email_from && (
          <a href={`mailto:${l.lead.email_from}`} style={{
            fontSize: 11, color: 'var(--text-2)', textDecoration: 'none',
            display: 'flex', alignItems: 'center', gap: 4,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            <Mail size={10} /> {l.lead.email_from}
          </a>
        )}
        {l.lead?.phone && (
          <a href={`tel:${l.lead.phone}`} style={{
            fontSize: 11, color: 'var(--text-2)', textDecoration: 'none',
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            <Phone size={10} /> {l.lead.phone}
          </a>
        )}
        {!isImpersonating && (
          <span style={{ fontSize: 11, color: 'var(--text-3)',
                         display: 'flex', alignItems: 'center', gap: 4 }}>
            <Building2 size={10} /> {trainerName(l.id_trainer)}
          </span>
        )}
      </div>

      {/* Qualification chips */}
      {(qual.objetivo || qual.cuota_interes || qual.presupuesto) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
          {qual.objetivo      && <Chip>{qual.objetivo}</Chip>}
          {qual.cuota_interes && <Chip>{qual.cuota_interes}</Chip>}
          {qual.presupuesto   && <Chip>{qual.presupuesto}</Chip>}
        </div>
      )}

      {/* Slot reservado (clase de prueba) */}
      {l.slot_reserva && <SlotReservadoBox slot={l.slot_reserva} />}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
        <span style={{ fontSize: 10, color: 'var(--text-3)' }}>
          {l.origen === 'web_form' ? '🌐 Web' :
           l.origen === 'meta_lead_ad' ? '📷 Instagram' :
           '✋ Manual'}
        </span>
        <span style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
          {formatDate(l.created_at)}
        </span>
      </div>
    </div>
  )
}


/** Caja con la info de la clase reservada del lead. Color y badge según estado. */
function SlotReservadoBox({ slot }) {
  const ESTADOS = {
    pendiente:  { label: 'pdte. confirmar', bg: 'var(--amber-bg)',  fg: 'var(--amber)',  border: 'var(--amber-border)' },
    confirmada: { label: 'confirmada',      bg: 'var(--green-bg)',  fg: 'var(--green)',  border: 'var(--green-border)' },
    expirada:   { label: 'expirada',        bg: 'var(--red-bg)',    fg: 'var(--red)',    border: 'var(--red-border)' },
    cancelada:  { label: 'cancelada',       bg: 'var(--bg-3)',      fg: 'var(--text-3)', border: 'var(--line)' },
    asistio:    { label: 'asistió',         bg: 'var(--green-bg)',  fg: 'var(--green)',  border: 'var(--green-border)' },
    creando:    { label: 'creando…',        bg: 'var(--blue-bg)',   fg: 'var(--blue)',   border: 'var(--blue-border)' },
    error_cliente: { label: 'error', bg: 'var(--red-bg)', fg: 'var(--red)', border: 'var(--red-border)' },
    error_reserva: { label: 'error', bg: 'var(--red-bg)', fg: 'var(--red)', border: 'var(--red-border)' },
  }
  const cfg = ESTADOS[slot.estado] || ESTADOS.creando
  let fechaStr = '', horaStr = ''
  try {
    const d = new Date(slot.fecha_clase)
    if (!isNaN(d)) {
      fechaStr = d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })
      horaStr  = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
    }
  } catch {}
  return (
    <div onClick={e => e.stopPropagation()}
         style={{
           marginTop: 8, padding: '6px 8px', borderRadius: 6,
           background: cfg.bg, color: cfg.fg,
           border: `1px solid ${cfg.border}`,
           fontSize: 11, lineHeight: 1.35,
         }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <span style={{ fontWeight: 600 }}>📅 Prueba reservada</span>
        <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 999,
                       background: 'var(--bg-1)', color: cfg.fg }}>
          {cfg.label}
        </span>
      </div>
      <div style={{ marginTop: 2, color: 'var(--text-1)', display: 'flex',
                    justifyContent: 'space-between', gap: 6 }}>
        <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis',
                       whiteSpace: 'nowrap' }} title={slot.nombre_clase}>
          {slot.nombre_clase || 'Clase'}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
          {fechaStr}{horaStr ? ` · ${horaStr}` : ''}
        </span>
      </div>
      {slot.reserva_url && (
        <a href={slot.reserva_url} target="_blank" rel="noreferrer"
           onClick={e => e.stopPropagation()}
           style={{ fontSize: 10, color: cfg.fg, textDecoration: 'underline' }}>
          ver / cambiar →
        </a>
      )}
    </div>
  )
}


function Chip({ children }) {
  return <span style={{
    fontSize: 10, padding: '2px 6px', borderRadius: 4,
    background: 'var(--bg-3)', color: 'var(--text-2)',
    border: '1px solid var(--line)',
  }}>{children}</span>
}


function LostReasonModal({ reasons, onCancel, onConfirm }) {
  const [reason, setReason] = useState(reasons[0]?.value || '')
  const overlayClose = useOverlayClose(onCancel)
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }} {...overlayClose}>
      <div style={{
        width: '100%', maxWidth: 420, background: 'var(--bg-1)',
        border: '1px solid var(--line-2)', borderRadius: 'var(--radius-lg)', padding: 24,
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ fontFamily: 'Outfit', fontWeight: 700, fontSize: 16, color: 'var(--text-0)' }}>
            ¿Por qué se pierde este lead?
          </h3>
          <button onClick={onCancel} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)' }}>
            <X size={18} />
          </button>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 12 }}>
          El motivo nos ayuda a entender qué falla y mejorar la conversión.
        </p>
        <select value={reason} onChange={e => setReason(e.target.value)}
                style={{ ...selectStyle, width: '100%', marginBottom: 16 }}>
          {reasons.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn variant="ghost" onClick={onCancel}>Cancelar</Btn>
          <Btn variant="primary" onClick={() => onConfirm(reason)}>Marcar como perdido</Btn>
        </div>
      </div>
    </div>
  )
}


function FunnelCard({ funnel }) {
  const stages = funnel.by_stage || []
  const lostReasons = funnel.lost_reasons || []
  const transitions = funnel.avg_time_between_stages_hours || {}
  const total = funnel.total_leads || 0
  return (
    <Card style={{ padding: 16, marginBottom: 16 }}>
      <SectionTitle><BarChart3 size={14} style={{ marginRight: 8 }} /> Embudo · analítica</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginTop: 12 }}>
        <Metric label="Total leads" value={total} />
        <Metric label="Abiertos" value={funnel.open || 0} color="var(--blue)" />
        <Metric label="Ganados" value={funnel.won || 0} color="var(--green)" />
        <Metric label="Perdidos" value={funnel.lost || 0} color="var(--red)" />
        <Metric label="Tasa conversión" value={`${funnel.conversion_rate_pct || 0}%`} color="var(--green)" />
        <Metric label="Score medio" value={funnel.avg_score || 0} />
        <Metric label="1ᵉʳ contacto medio"
                value={funnel.avg_first_contact_hours != null ? `${funnel.avg_first_contact_hours} h` : '—'} />
      </div>

      {stages.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <p style={{ fontSize: 11, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
            Distribución por etapa (sin perdidos):
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {stages.map(s => {
              const pct = total ? (s.count / total) * 100 : 0
              return (
                <div key={s.stage} style={{ fontSize: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-2)', marginBottom: 2 }}>
                    <span>{s.stage}</span>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>{s.count} · {pct.toFixed(0)}%</span>
                  </div>
                  <div style={{ height: 6, background: 'var(--bg-3)', borderRadius: 999, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: 'var(--green)' }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {lostReasons.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <p style={{ fontSize: 11, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
            Motivos de pérdida:
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {lostReasons.map(r => (
              <span key={r.reason} style={{
                fontSize: 11, padding: '3px 8px', borderRadius: 999,
                background: 'var(--red-bg)', color: 'var(--red)',
                border: '1px solid var(--red-border)',
              }}>{r.reason} · {r.count}</span>
            ))}
          </div>
        </div>
      )}

      {Object.keys(transitions).length > 0 && (
        <div style={{ marginTop: 16 }}>
          <p style={{ fontSize: 11, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
            Tiempo medio entre etapas:
          </p>
          <div style={{ fontSize: 12, color: 'var(--text-2)', display: 'flex', flexDirection: 'column', gap: 3 }}>
            {Object.entries(transitions).map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>{k}</span>
                <span style={{ fontFamily: 'var(--font-mono)' }}>{v} h</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}


function Metric({ label, value, color }) {
  return (
    <div style={{ background: 'var(--bg-2)', borderRadius: 10, padding: 12, border: '1px solid var(--line)' }}>
      <p style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</p>
      <p style={{ fontFamily: 'Outfit', fontSize: 22, fontWeight: 700, color: color || 'var(--text-0)', marginTop: 4 }}>
        {value}
      </p>
    </div>
  )
}


const selectStyle = {
  padding: '6px 10px', borderRadius: 8, fontSize: 13,
  background: 'var(--bg-1)', border: '1px solid var(--line)',
  color: 'var(--text-0)',
}


// ──────────────────────────────────────────────────────────────────────────
// Modal "Nuevo lead manual" — para registrar personas que llegan al
// gimnasio sin haber rellenado el formulario web. Backend:
// POST /api/crm/lead-manual (con auth manager). Mismas validaciones que el
// público pero sin honeypot ni rate-limit, y con origen='manual_erp'.
// ──────────────────────────────────────────────────────────────────────────
function NuevoLeadModal({ identity, centros, onClose, onCreated }) {
  const toast = useToast()
  const [form, setForm] = useState({
    nombre: '', apellidos: '', email: '', telefono: '',
    id_trainer: '', cuota_interes: '', objetivo: '', mensaje: '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async () => {
    if (!form.nombre.trim() && !form.apellidos.trim()) {
      toast.error('Indica al menos un nombre o apellido'); return
    }
    if (!form.email.trim() && !form.telefono.trim()) {
      toast.error('Necesitas email o teléfono'); return
    }
    setSaving(true)
    try {
      const r = await leadManualCreate(identity, form)
      toast.success(`Lead creado · asignado a ${r.centro}`)
      onCreated && onCreated(r)
      onClose && onClose()
    } catch (e) {
      toast.error('Error: ' + (e.message || 'no se pudo crear el lead'))
    } finally { setSaving(false) }
  }

  return (
    <Modal open={true} onClose={onClose} maxWidth={520}
           title={<><Plus size={16} style={{ marginRight: 6 }} /> Nuevo lead presencial</>}>
      <div style={{ padding: 24, flex: 1, overflowY: 'auto', minHeight: 0 }}>
        <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 16, lineHeight: 1.5 }}>
          Registra aquí a una persona que se ha pasado por el gimnasio (sin
          rellenar el formulario web). Quedará como lead normal en el embudo,
          con origen <code style={{
            background: 'var(--bg-2)', padding: '1px 6px', borderRadius: 4,
            fontFamily: 'monospace', fontSize: 11,
          }}>manual_erp</code>.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <FieldM label="Nombre *">
            <input value={form.nombre} onChange={e => set('nombre', e.target.value)} style={inputModal} />
          </FieldM>
          <FieldM label="Apellidos">
            <input value={form.apellidos} onChange={e => set('apellidos', e.target.value)} style={inputModal} />
          </FieldM>
        </div>
        <FieldM label="Email">
          <input type="email" value={form.email} onChange={e => set('email', e.target.value)} style={inputModal} />
        </FieldM>
        <FieldM label="Teléfono">
          <input type="tel" value={form.telefono} onChange={e => set('telefono', e.target.value)} style={inputModal} />
        </FieldM>
        <FieldM label="Centro asignado"
                hint="Por defecto, round-robin. Selecciona uno para forzar la asignación.">
          <select value={form.id_trainer} onChange={e => set('id_trainer', e.target.value)} style={inputModal}>
            <option value="">— Automático (round-robin) —</option>
            {centros.map(c => (
              <option key={c.id_trainer} value={c.id_trainer}>{c.nombre_centro}</option>
            ))}
          </select>
        </FieldM>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <FieldM label="Cuota de interés">
            <input value={form.cuota_interes} onChange={e => set('cuota_interes', e.target.value)}
                   placeholder="RT 2 dias, I MYGYM…" style={inputModal} />
          </FieldM>
          <FieldM label="Objetivo">
            <input value={form.objetivo} onChange={e => set('objetivo', e.target.value)}
                   placeholder="Pérdida de peso, tonificar…" style={inputModal} />
          </FieldM>
        </div>
        <FieldM label="Notas / mensaje (opcional)">
          <textarea value={form.mensaje} onChange={e => set('mensaje', e.target.value)}
                    rows={3} style={{ ...inputModal, resize: 'vertical', fontFamily: 'inherit' }} />
        </FieldM>
      </div>
      <div style={{ padding: '16px 24px', borderTop: '1px solid var(--line)',
                    display: 'flex', gap: 10, justifyContent: 'flex-end',
                    flexShrink: 0, background: 'var(--bg-2)' }}>
        <Btn variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Btn>
        <Btn variant="primary" onClick={handleSubmit} disabled={saving}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          {' Crear lead'}
        </Btn>
      </div>
    </Modal>
  )
}

const inputModal = {
  width: '100%', padding: 10, borderRadius: 10, fontSize: 13,
  background: 'var(--bg-2)', border: '1px solid var(--line)', color: 'var(--text-0)',
}

function FieldM({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 12, color: 'var(--text-3)', marginBottom: 4 }}>{label}</label>
      {children}
      {hint && <p style={{ fontSize: 11, color: 'var(--text-3)', margin: '4px 0 0 0' }}>{hint}</p>}
    </div>
  )
}
