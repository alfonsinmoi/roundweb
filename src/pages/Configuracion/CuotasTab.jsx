import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Plus, Pencil, Trash2, Check, X, RefreshCw, Download, Loader2,
         UserCheck, AlertTriangle, CreditCard, Tag, Receipt } from 'lucide-react'
import { Card, Btn, Badge } from '../../components/UI'
import { useToast } from '../../components/Toast'
import {
  cuotasList, cuotaCreate, cuotaUpdate, cuotaDelete, cuotaAdoptar, comprobarClientes,
  FORMAS_PAGO, PERIODICIDADES, TIPOS_CUOTA,
} from '../../utils/configApi'
import { getActividades } from '../../utils/api'
import { useCan } from '../../hooks/useCan'
import { useOverlayClose } from '../../hooks/useOverlayClose'

const PRECIO_CAMPOS = [
  { id: 'precio_mensual',     label: 'Mensual' },
  { id: 'precio_bimensual',   label: 'Bimensual' },
  { id: 'precio_trimestral',  label: 'Trimestral' },
  { id: 'precio_semestral',   label: 'Semestral' },
  { id: 'precio_anual',       label: 'Anual' },
]


export default function CuotasTab({ identity }) {
  const toast = useToast()
  // Gates UI
  const canCrear = useCan('configuracion.cuotas.crear')
  const canBorrar = useCan('configuracion.cuotas.borrar')
  const canAdoptar = useCan('configuracion.cuotas.adoptar')
  const [cuotas, setCuotas] = useState([])
  const [loading, setLoading] = useState(true)
  const [actividades, setActividades] = useState([])
  const [editing, setEditing] = useState(null)  // null = ninguno; objeto = nuevo/edit
  const [comprobarOpen, setComprobarOpen] = useState(false)

  const isTrainer = !!identity.trainerId

  async function reload() {
    setLoading(true)
    try {
      const data = await cuotasList(identity)
      setCuotas(data || [])
    } catch (e) { toast.error(`Error cargando cuotas: ${e.message}`) }
    setLoading(false)
  }

  useEffect(() => {
    reload()
    getActividades().then(setActividades).catch(() => {})
  }, [identity.managerId, identity.trainerId])

  async function onAdoptar(id) {
    try {
      await cuotaAdoptar(identity, id)
      toast.success('Plantilla adoptada')
      reload()
    } catch (e) { toast.error(e.message) }
  }

  async function onDelete(c) {
    if (!confirm(`¿Eliminar cuota "${c.codigo}"?`)) return
    try {
      await cuotaDelete(identity, c.id)
      toast.success('Cuota eliminada')
      reload()
    } catch (e) { toast.error(e.message) }
  }

  // Filtrar plantillas vs trainer-cuotas para mostrar separado
  const plantillas    = cuotas.filter(c => c.scope === 'plantilla_manager')
  const trainerCuotas = cuotas.filter(c => c.scope === 'trainer')

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: 'var(--text-2)' }}>
          {loading ? 'Cargando…' : `${cuotas.length} cuota${cuotas.length !== 1 ? 's' : ''}`}
        </span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Btn variant="secondary" size="sm" onClick={() => setComprobarOpen(true)}
               title="Detecta clientes activos sin cuota, sin forma de pago o sin categoría">
            <UserCheck size={13} /> Comprobar clientes
          </Btn>
          <Btn variant="secondary" size="sm" onClick={reload}>
            <RefreshCw size={13} /> Refrescar
          </Btn>
          {canCrear && (
            <Btn variant="primary" size="sm" onClick={() => setEditing({})}>
              <Plus size={13} /> Nueva cuota
            </Btn>
          )}
        </div>
      </div>

      {/* Plantillas del manager */}
      {plantillas.length > 0 && (
        <Section titulo={isTrainer ? 'Plantillas disponibles del manager' : 'Plantillas (manager)'}>
          {plantillas.map(c => (
            <CuotaRow key={c.id} cuota={c} actividades={actividades}
                      isTrainer={isTrainer}
                      onEdit={!isTrainer ? () => setEditing(c) : null}
                      onDelete={!isTrainer && canBorrar ? () => onDelete(c) : null}
                      onAdoptar={isTrainer && canAdoptar && !cuotas.some(t => t.scope === 'trainer' && t.plantilla_origen_id === c.id) ? () => onAdoptar(c.id) : null} />
          ))}
        </Section>
      )}

      {/* Cuotas del trainer (también visibles para el manager sin impersonar:
          las cuotas son per-centro, así que el manager las ve agrupadas) */}
      {trainerCuotas.length > 0 && (
        <Section titulo={isTrainer ? 'Mis cuotas' : 'Cuotas por centro'}>
          {trainerCuotas.map(c => (
            <CuotaRow key={c.id} cuota={c} actividades={actividades}
                      isTrainer={isTrainer}
                      onEdit={() => setEditing(c)}
                      onDelete={canBorrar ? () => onDelete(c) : null} />
          ))}
        </Section>
      )}

      {/* Sin datos */}
      {!loading && cuotas.length === 0 && (
        <Card style={{ padding: 32, textAlign: 'center' }}>
          <p style={{ fontSize: 14, color: 'var(--text-3)' }}>
            {isTrainer ? 'Ninguna cuota. El manager aún no ha definido plantillas y tú no has creado ninguna.'
                       : 'Sin plantillas. Crea la primera con «Nueva cuota».'}
          </p>
        </Card>
      )}

      {/* Modal edit */}
      {editing && (
        <CuotaForm cuota={editing} actividades={actividades}
                   onClose={() => setEditing(null)}
                   onSaved={() => { setEditing(null); reload() }}
                   identity={identity} />
      )}

      {/* Modal comprobar clientes */}
      {comprobarOpen && (
        <ComprobarClientesModal identity={identity} onClose={() => setComprobarOpen(false)} />
      )}
    </div>
  )
}


// ── Comprobación de clientes (sin cuota / sin forma de pago / sin categoría) ──
function ComprobarClientesModal({ identity, onClose }) {
  const toast = useToast()
  const overlay = useOverlayClose(onClose)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    comprobarClientes(identity)
      .then(d => { if (alive) setData(d) })
      .catch(e => { toast.error('Error al comprobar: ' + e.message); onClose() })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  const GRUPOS = data ? [
    { key: 'sin_cuota', label: 'Sin cuota (sin suscripción activa)', icon: Receipt,
      color: 'var(--red)', items: data.sin_cuota || [],
      aviso: data.odoo_ok === false ? 'No se pudo comprobar (Odoo no disponible).' : null },
    { key: 'sin_forma_pago', label: 'Sin forma de pago', icon: CreditCard,
      color: 'var(--amber)', items: data.sin_forma_pago || [] },
    { key: 'sin_categoria', label: 'Sin categoría asignada', icon: Tag,
      color: 'var(--blue)', items: data.sin_categoria || [] },
  ] : []

  async function exportar() {
    if (!data) return
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    // Hoja resumen
    const resumen = [
      { Incidencia: 'Clientes activos', 'Nº': data.total_activos },
      { Incidencia: 'Sin cuota', 'Nº': (data.sin_cuota || []).length },
      { Incidencia: 'Sin forma de pago', 'Nº': (data.sin_forma_pago || []).length },
      { Incidencia: 'Sin categoría', 'Nº': (data.sin_categoria || []).length },
    ]
    const wsR = XLSX.utils.json_to_sheet(resumen, { header: ['Incidencia', 'Nº'] })
    wsR['!cols'] = [{ wch: 26 }, { wch: 8 }]
    XLSX.utils.book_append_sheet(wb, wsR, 'Resumen')
    const hojas = [
      ['Sin cuota', data.sin_cuota || []],
      ['Sin forma de pago', data.sin_forma_pago || []],
      ['Sin categoría', data.sin_categoria || []],
    ]
    for (const [nombre, items] of hojas) {
      const rows = items.map(c => ({
        'ID NoofitPro': c.id, 'Cliente': c.nombre, 'Email': c.email,
        'Centro': c.centro, 'Categoría': c.categoria,
      }))
      const ws = XLSX.utils.json_to_sheet(rows,
        { header: ['ID NoofitPro', 'Cliente', 'Email', 'Centro', 'Categoría'] })
      ws['!cols'] = [{ wch: 12 }, { wch: 28 }, { wch: 30 }, { wch: 22 }, { wch: 16 }]
      XLSX.utils.book_append_sheet(wb, ws, nombre.slice(0, 31))
    }
    const hoy = new Date().toISOString().slice(0, 10)
    XLSX.writeFile(wb, `comprobacion_clientes_${hoy}.xlsx`)
  }

  return createPortal((
    <div role="dialog" aria-modal="true" {...overlay}
         style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.6)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: 'var(--bg-1)', borderRadius: 14, width: '100%', maxWidth: 760,
                    maxHeight: '90vh', display: 'flex', flexDirection: 'column',
                    border: '1px solid var(--line)', boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
                    color: 'var(--text-0)' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line)',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <strong style={{ fontSize: 16 }}>Comprobación de clientes</strong>
            {data && (
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
                {data.total_activos} clientes activos revisados
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {data && (
              <Btn variant="secondary" size="sm" onClick={exportar}
                   disabled={(data.sin_cuota?.length || 0) + (data.sin_forma_pago?.length || 0) + (data.sin_categoria?.length || 0) === 0}>
                <Download size={13} /> Exportar Excel
              </Btn>
            )}
            <button onClick={onClose} aria-label="Cerrar"
                    style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid var(--line)',
                             background: 'var(--bg-3)', color: 'var(--text-2)', cursor: 'pointer' }}>
              <X size={14} />
            </button>
          </div>
        </div>

        <div style={{ padding: 16, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center' }}>
              <Loader2 size={22} className="animate-spin" style={{ color: 'var(--green)' }} />
              <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8 }}>Comprobando clientes…</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {GRUPOS.map(g => <GrupoIncidencia key={g.key} {...g} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  ), document.body)
}

function GrupoIncidencia({ label, icon: Icon, color, items, aviso }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
      <button onClick={() => setOpen(o => !o)}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px',
                       background: 'var(--bg-2)', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
        <Icon size={16} style={{ color, flexShrink: 0 }} aria-hidden="true" />
        <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: 'var(--text-0)' }}>{label}</span>
        <Badge color={items.length ? 'red' : 'green'}>{items.length}</Badge>
      </button>
      {aviso && (
        <div style={{ padding: '8px 14px', fontSize: 12, color: 'var(--amber)',
                      display: 'flex', alignItems: 'center', gap: 6 }}>
          <AlertTriangle size={13} aria-hidden="true" /> {aviso}
        </div>
      )}
      {open && items.length > 0 && (
        <div style={{ maxHeight: 280, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-3)', background: 'var(--bg-1)' }}>
                <th style={thC}>Cliente</th><th style={thC}>Email</th>
                <th style={thC}>Centro</th><th style={thC}>Categoría</th>
              </tr>
            </thead>
            <tbody>
              {items.map(c => (
                <tr key={c.id} style={{ borderTop: '1px solid var(--line-decorative)' }}>
                  <td style={tdC}>{c.nombre}</td>
                  <td style={{ ...tdC, color: 'var(--text-2)' }}>{c.email || '—'}</td>
                  <td style={{ ...tdC, color: 'var(--text-3)' }}>{c.centro || '—'}</td>
                  <td style={{ ...tdC, color: 'var(--text-3)' }}>{c.categoria || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && items.length === 0 && (
        <p style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-3)', margin: 0 }}>
          Sin incidencias en este grupo. 👍
        </p>
      )}
    </div>
  )
}
const thC = { padding: '6px 10px', fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase',
              letterSpacing: '0.04em', whiteSpace: 'nowrap' }
const tdC = { padding: '6px 10px', color: 'var(--text-1)', verticalAlign: 'top' }


function Section({ titulo, children }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700,
                   color: 'var(--text-3)', textTransform: 'uppercase',
                   letterSpacing: '0.05em', marginBottom: 8 }}>
        {titulo}
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {children}
      </div>
    </div>
  )
}


function CuotaRow({ cuota, actividades, isTrainer, onEdit, onDelete, onAdoptar }) {
  const nActs = (cuota.actividades_idnoofit || []).length
  return (
    <Card style={{ padding: '12px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, color: 'var(--text-0)' }}>
              {cuota.codigo}
            </span>
            {cuota.tipo_cuota === 'entrada_puntual' && <Badge color="amber">Entrada puntual</Badge>}
            {!cuota.active && <Badge color="gray">Inactiva</Badge>}
            {cuota.plantilla_origen_id && <Badge color="blue">Adoptada</Badge>}
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>{cuota.descripcion}</p>
          <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 11, color: 'var(--text-3)', flexWrap: 'wrap' }}>
            {cuota.tipo_cuota === 'entrada_puntual' && cuota.precio_entrada > 0 && <span>Por entrada <strong style={{ color: 'var(--text-1)' }}>{cuota.precio_entrada}€</strong></span>}
            {cuota.precio_mensual    > 0 && <span>Mensual <strong style={{ color: 'var(--text-1)' }}>{cuota.precio_mensual}€</strong></span>}
            {cuota.precio_trimestral > 0 && <span>Trim <strong style={{ color: 'var(--text-1)' }}>{cuota.precio_trimestral}€</strong></span>}
            {cuota.precio_anual      > 0 && <span>Anual <strong style={{ color: 'var(--text-1)' }}>{cuota.precio_anual}€</strong></span>}
            {cuota.matricula > 0 && <span>Matr <strong style={{ color: 'var(--text-1)' }}>{cuota.matricula}€</strong></span>}
            <span>· {nActs} actividad{nActs !== 1 ? 'es' : ''}</span>
            <span>· {(cuota.formas_pago || []).length} forma{(cuota.formas_pago || []).length !== 1 ? 's' : ''} de pago</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {onAdoptar && <Btn variant="secondary" size="sm" onClick={onAdoptar}><Download size={12} /> Adoptar</Btn>}
          {onEdit && <Btn variant="secondary" size="sm" onClick={onEdit}><Pencil size={12} /> Editar</Btn>}
          {onDelete && <Btn variant="danger" size="sm" onClick={onDelete}><Trash2 size={12} /></Btn>}
        </div>
      </div>
    </Card>
  )
}


function CuotaForm({ cuota, actividades, onClose, onSaved, identity }) {
  const isNew = !cuota.id
  const toast = useToast()
  const [saving, setSaving] = useState(false)
  const [data, setData] = useState({
    codigo: cuota.codigo || '',
    descripcion: cuota.descripcion || '',
    precio_mensual: cuota.precio_mensual ?? 0,
    precio_bimensual: cuota.precio_bimensual ?? 0,
    precio_trimestral: cuota.precio_trimestral ?? 0,
    precio_semestral: cuota.precio_semestral ?? 0,
    precio_anual: cuota.precio_anual ?? 0,
    matricula: cuota.matricula ?? 0,
    formas_pago: cuota.formas_pago || [],
    periodicidades: cuota.periodicidades || [],
    actividades_idnoofit: cuota.actividades_idnoofit || [],
    tipo_cuota: cuota.tipo_cuota || 'recurrente',
    precio_entrada: cuota.precio_entrada ?? 0,
    active: cuota.active ?? true,
  })
  const overlayClose = useOverlayClose(onClose)
  const esEntradaPuntual = data.tipo_cuota === 'entrada_puntual'

  const set = (k, v) => setData(d => ({ ...d, [k]: v }))
  const toggleArray = (k, v) => set(k, data[k].includes(v) ? data[k].filter(x => x !== v) : [...data[k], v])

  async function onSubmit(e) {
    e.preventDefault()
    if (!data.codigo.trim()) { toast.error('Código obligatorio'); return }
    setSaving(true)
    try {
      if (isNew) await cuotaCreate(identity, data)
      else       await cuotaUpdate(identity, cuota.id, data)
      toast.success('Cuota guardada')
      onSaved()
    } catch (e) { toast.error(e.message) }
    setSaving(false)
  }

  return (
    <div {...overlayClose}
         style={{ position: 'fixed', inset: 0, zIndex: 600, background: 'rgba(0,0,0,0.6)',
                  backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', padding: 20 }}>
      <div style={{ background: 'var(--bg-1)', borderRadius: 'var(--radius-lg)', width: '100%',
                    maxWidth: 720, maxHeight: '90vh', overflow: 'auto',
                    boxShadow: 'var(--shadow-lg)' }}>
        <header style={{ padding: '18px 22px', borderBottom: '1px solid var(--line)',
                         display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, margin: 0,
                       color: 'var(--text-0)' }}>
            {isNew ? 'Nueva cuota' : `Editar ${cuota.codigo}`}
          </h2>
          <button onClick={onClose} aria-label="Cerrar"
                  style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid var(--line)',
                           background: 'var(--bg-3)', color: 'var(--text-2)', cursor: 'pointer',
                           display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <X size={14} />
          </button>
        </header>

        <form onSubmit={onSubmit} style={{ padding: 22 }}>
          {/* Código + descripción */}
          <Field label="Código *">
            <Input value={data.codigo} onChange={v => set('codigo', v)} placeholder="RT 1D" />
          </Field>
          <Field label="Descripción">
            <Input value={data.descripcion} onChange={v => set('descripcion', v)} placeholder="RT 1 día/semana" />
          </Field>

          {/* Tipo de cuota */}
          <Field label="Tipo de cuota">
            <select value={data.tipo_cuota} onChange={e => set('tipo_cuota', e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--radius-sm)',
                             background: 'var(--bg-2)', border: '1px solid var(--line)',
                             color: 'var(--text-0)', fontSize: 13, outline: 'none' }}>
              {TIPOS_CUOTA.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            {esEntradaPuntual && (
              <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 6, lineHeight: 1.5 }}>
                Se cobra por cada <strong>reserva confirmada</strong> de las actividades
                marcadas abajo. Al dar de alta a un cliente se elige cómo se cobra:
                <strong> por cada entrada</strong> (efectivo/TPV/tarjeta en recepción) o
                <strong> por mes</strong> (SEPA/tarjeta, recibo agregado al cierre).
              </p>
            )}
          </Field>

          {esEntradaPuntual ? (
            /* Precio por entrada */
            <FieldGroup titulo="Precio por entrada">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
                <Field label="Precio / entrada" small>
                  <Input type="number" step="0.01" value={data.precio_entrada}
                         onChange={v => set('precio_entrada', parseFloat(v) || 0)} suffix="€" />
                </Field>
                <Field label="Matrícula" small>
                  <Input type="number" step="0.01" value={data.matricula}
                         onChange={v => set('matricula', parseFloat(v) || 0)} suffix="€" />
                </Field>
              </div>
            </FieldGroup>
          ) : (
            <>
              {/* Precios */}
              <FieldGroup titulo="Precios por periodicidad">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
                  {PRECIO_CAMPOS.map(p => (
                    <Field key={p.id} label={p.label} small>
                      <Input type="number" step="0.01" value={data[p.id]} onChange={v => set(p.id, parseFloat(v) || 0)} suffix="€" />
                    </Field>
                  ))}
                  <Field label="Matrícula" small>
                    <Input type="number" step="0.01" value={data.matricula} onChange={v => set('matricula', parseFloat(v) || 0)} suffix="€" />
                  </Field>
                </div>
              </FieldGroup>

              {/* Periodicidades disponibles */}
              <FieldGroup titulo="Periodicidades disponibles para esta cuota">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {PERIODICIDADES.map(p => (
                    <Chip key={p.id} active={data.periodicidades.includes(p.id)}
                          onClick={() => toggleArray('periodicidades', p.id)}>
                      {p.label}
                    </Chip>
                  ))}
                </div>
              </FieldGroup>
            </>
          )}

          {/* Formas de pago aceptadas */}
          <FieldGroup titulo="Formas de pago aceptadas">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {FORMAS_PAGO.map(f => (
                <Chip key={f.id} active={data.formas_pago.includes(f.id)}
                      onClick={() => toggleArray('formas_pago', f.id)}>
                  {f.label}
                </Chip>
              ))}
            </div>
          </FieldGroup>

          {/* Actividades NoofitPro — solo las ACTIVAS (enabled !== false).
              Las desactivadas en Actividades no deben poder asignarse a una
              cuota. Para quitar una actividad de prueba del selector,
              desactívala en Configuración → Actividades. */}
          {(() => {
            const actsVisibles = actividades.filter(a => a.enabled !== false)
            return (
              <FieldGroup titulo={`Actividades incluidas (${data.actividades_idnoofit.length} de ${actsVisibles.length})`}>
                {actividades.length === 0 ? (
                  <p style={{ fontSize: 12, color: 'var(--text-3)' }}>Cargando actividades de NoofitPro…</p>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 220, overflow: 'auto', padding: 6,
                                border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-2)' }}>
                    {actsVisibles.map(a => {
                      const id = Number(a.id)
                      return (
                        <Chip key={id} active={data.actividades_idnoofit.includes(id)}
                              onClick={() => toggleArray('actividades_idnoofit', id)}>
                          {a.nombre || a.Nombre || `#${id}`}
                        </Chip>
                      )
                    })}
                  </div>
                )}
              </FieldGroup>
            )
          })()}

          {/* Active */}
          <FieldGroup titulo="Estado">
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={data.active} onChange={e => set('active', e.target.checked)} />
              <span style={{ fontSize: 13, color: 'var(--text-1)' }}>Cuota activa</span>
            </label>
          </FieldGroup>

          {/* Buttons */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16, paddingTop: 16,
                        borderTop: '1px solid var(--line)' }}>
            <Btn variant="secondary" type="button" onClick={onClose}>Cancelar</Btn>
            <Btn variant="primary" type="submit" disabled={saving}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {saving ? ' Guardando…' : ' Guardar'}
            </Btn>
          </div>
        </form>
      </div>
    </div>
  )
}


function Field({ label, children, small }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: small ? 0 : 12 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)',
                     textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </span>
      {children}
    </label>
  )
}

function FieldGroup({ titulo, children }) {
  return (
    <fieldset style={{ border: 'none', padding: 0, marginBottom: 14 }}>
      <legend style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)',
                       textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
        {titulo}
      </legend>
      {children}
    </fieldset>
  )
}

function Input({ value, onChange, suffix, type = 'text', placeholder, step }) {
  // Junio 2026 — inputs numéricos: cuando el valor es 0 mostramos el campo
  // VACÍO con "0" de placeholder, para que el usuario teclee directamente sin
  // tener que borrar el 0 que había delante.
  const displayValue = (type === 'number' && (value === 0 || value === '0' || value == null))
    ? '' : value
  const ph = placeholder ?? (type === 'number' ? '0' : undefined)
  return (
    <div style={{ position: 'relative', display: 'flex' }}>
      <input type={type} value={displayValue} onChange={e => onChange(e.target.value)}
             placeholder={ph} step={step}
             style={{ flex: 1, padding: '8px 10px', borderRadius: 'var(--radius-sm)',
                      background: 'var(--bg-2)', border: '1px solid var(--line)',
                      color: 'var(--text-0)', fontSize: 13, outline: 'none',
                      paddingRight: suffix ? 28 : undefined }} />
      {suffix && <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                                fontSize: 12, color: 'var(--text-3)' }}>{suffix}</span>}
    </div>
  )
}

function Chip({ active, onClick, children }) {
  return (
    <button type="button" onClick={onClick}
            style={{ padding: '6px 11px', borderRadius: 'var(--radius-pill)',
                     background: active ? 'var(--green-bg)' : 'var(--bg-3)',
                     border: `1px solid ${active ? 'var(--green-border)' : 'var(--line)'}`,
                     color: active ? 'var(--green)' : 'var(--text-2)',
                     fontSize: 12, fontWeight: active ? 600 : 500,
                     cursor: 'pointer', transition: 'all 0.1s' }}>
      {children}
    </button>
  )
}
