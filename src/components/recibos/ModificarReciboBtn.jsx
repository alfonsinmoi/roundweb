// Botón "Modificar" para recibos pendientes/impagados/devueltos.
// Junio 2026: permite editar TODOS los campos del recibo (importes,
// método de pago, fechas, cliente, periodo, notas).
//
// Permiso requerido: `economico.cuotas_mensuales.modificar_recibo`.
// Para recibos `pagado`/`facturado` el backend bloquea cambios de
// importe — solo descripciones / notas (el frontend desactiva los
// inputs correspondientes para evitar errores).
//
// Solo aplica a recibos BD (`_source='bd'`). Recibos Odoo (account.move
// posteado) se modifican desde Odoo directamente.
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Save, Pencil } from 'lucide-react'
import { Btn } from '../UI'
import { useToast } from '../Toast'
import { useAuth } from '../../contexts/AuthContext'
import { useCan } from '../../hooks/useCan'
import { getRoundIdentity, reciboUpdate } from '../../utils/configApi'
import { useOverlayClose } from '../../hooks/useOverlayClose'

const METODOS = [
  { id: 'sepa',             label: 'SEPA' },
  { id: 'tarjeta_tok',      label: 'Tarjeta tokenizada' },
  { id: 'caja_efectivo',    label: 'Efectivo / caja' },
  { id: 'caja_tpv_fisico',  label: 'TPV físico (caja)' },
  { id: 'caja_tpv_virtual', label: 'TPV virtual' },
  { id: 'enlace_pago',      label: 'Enlace de pago' },
]


export default function ModificarReciboBtn({ r, onReload, size = 'sm' }) {
  const { user } = useAuth()
  const toast = useToast()
  const canModificar = useCan('economico.cuotas_mensuales.modificar_recibo')
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  // Estados editables — formulario controlado
  const [f, setF] = useState(() => initialForm(r))
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  // Admin = manager NoofitPro (sin perfil) o usuario_web con is_admin (espejo
  // del backend). El admin puede fijar a mano la fecha fin y la fecha de cobro
  // aunque el recibo esté cobrado.
  const esAdmin = !user?.perfil || !!user?.perfil?.is_admin
  // Override manual de la fecha fin: null = automática (deriva de periodicidad).
  const [fechaFinManual, setFechaFinManual] = useState(null)
  const overlayClose = useOverlayClose(() => setOpen(false), !saving)

  const isBd = r._source === 'bd'
  const tieneMoveOdoo = !!(r.account_move_id || r.account_move_ref)
  // Auditoría #25 — un recibo NO cobrado se edita siempre (solo la cuota BD).
  // Regla: un recibo no pagado no debe tener factura en Odoo hasta que se
  // cobre; la modificación afecta solo a la tabla de cuotas (no toca Odoo),
  // así que es editable AUNQUE tenga una factura Odoo legacy enlazada (import
  // GestPlus). Solo `pagado`/`facturado` quedan inmovilizados (espejo backend).
  const editableFull = ['borrador_remesa', 'pendiente', 'emitido', 'impagado', 'devuelto']
    .includes(r.estado_bd || r.estado)
  // La FECHA FIN (próximo cobro) sí se puede ajustar incluso en cobrados/
  // facturados: no es un cambio contable (no toca importe ni Odoo). Espejo del
  // backend (recibos.update_recibo permite fecha_hasta en pagado/facturado).
  const esCobrado = ['pagado', 'facturado'].includes((r.estado_bd || r.estado || '').toLowerCase())
  const editableFechaHasta = editableFull || esCobrado
  // EDICIÓN COMPLETA (importe + todas las fechas + método): recibos no cobrados
  // (cualquiera con permiso) o recibos cobrados SOLO si es admin. Espejo del
  // backend (rama pagado/facturado con es_admin en recibos.update_recibo).
  const fullEdit = editableFull || (esAdmin && esCobrado)
  // Aviso informativo (no bloquea) si el no-cobrado arrastra factura Odoo legacy.
  const avisoLegacyOdoo = editableFull && tieneMoveOdoo

  // FECHA FIN AUTOMÁTICA — se deriva de la periodicidad elegida y el PERIODO
  // DESDE (inicio de la cobertura): último día cubierto = fecha_desde +
  // periodicidad − 1 día. NO se basa en la fecha de emisión (que puede ser
  // distinta, p.ej. recibos reemitidos/reconstruidos). Mismo cálculo que
  // recalcula el backend (recibos.update_recibo).
  const baseDesdeISO = (f.fecha_desde || f.fecha_emision || '').slice(0, 10)
  const perMeses = PERIOD_MESES[(f.periodicidad || 'mensual').toLowerCase()] || 1
  const fechaHastaCalc = baseDesdeISO
    ? addDaysISO(addMonthsISO(baseDesdeISO, perMeses), -1) : ''

  if (!canModificar) return null
  if (!isBd) return null

  const openModal = () => {
    setF(initialForm(r))
    setFechaFinManual(null)
    setOpen(true)
  }

  // Sprint 7 audit #M8 — `Number('') = 0` pisaría importes válidos
  // con 0 si el usuario borra el input. Helper que omite el campo del
  // payload si el valor está vacío → backend no actualiza esa columna.
  const numOrSkip = (v) => {
    if (v === '' || v === null || v === undefined) return undefined
    const n = Number(v)
    return isNaN(n) ? undefined : n
  }

  const submit = async () => {
    setSaving(true)
    try {
      const payload = {
        cliente_nombre: f.cliente_nombre,
        cuota_codigo: f.cuota_codigo,
        cuota_descripcion: f.cuota_descripcion,
        notas: f.notas,
      }
      // Fecha fin manual del admin (si tocó el campo). Si no, se deriva.
      const fechaFinEsManual = esAdmin && fechaFinManual != null
      const periodicidadCambiada = (f.periodicidad || '') !== (r.periodicidad || '')
      if (fullEdit) {
        // Edición completa: importe + fechas + método. En cobrados esto solo
        // llega aquí si es admin (el backend re-valida).
        Object.assign(payload, {
          fecha_desde: f.fecha_desde || null,
          periodicidad: f.periodicidad || null,
          importe_base: numOrSkip(f.importe_base),
          importe_iva: numOrSkip(f.importe_iva),
          importe_total: numOrSkip(f.importe_total),
          iva_pct: numOrSkip(f.iva_pct),
          metodo_pago: f.metodo_pago,
          periodo: f.periodo,
          fecha_emision: f.fecha_emision,
        })
        if (fechaFinEsManual) {
          payload.fecha_hasta = fechaFinManual || null
          payload.fecha_hasta_manual = true
        } else {
          payload.fecha_hasta = fechaHastaCalc || null   // derivada (emisión + periodicidad)
        }
        // Fecha de cobro: solo tiene sentido en recibos cobrados (admin).
        if (esAdmin && esCobrado && f.fecha_pago) payload.fecha_pago = f.fecha_pago
        // Eliminar las claves undefined para que el backend ignore esos campos
        Object.keys(payload).forEach(k => {
          if (payload[k] === undefined) delete payload[k]
        })
      } else if (esCobrado) {
        // Recibo cobrado, usuario NO admin: solo periodicidad (recalcula la
        // fecha fin en backend). El importe queda inmovilizado.
        if (periodicidadCambiada && f.periodicidad) payload.periodicidad = f.periodicidad
      }
      await reciboUpdate(getRoundIdentity(user), r.id_bd, payload)
      toast.success('Recibo modificado')
      setOpen(false)
      onReload?.()
    } catch (e) {
      toast.error(`Error: ${e.message}`)
    }
    setSaving(false)
  }

  const modal = open && (
    <div role="dialog" aria-modal="true" {...overlayClose}
         style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  zIndex: 10000 }}>
      <div onClick={e => e.stopPropagation()}
           style={{ background: 'var(--bg-1)', borderRadius: 12,
                    maxWidth: 640, width: '94%', maxHeight: '92vh',
                    display: 'flex', flexDirection: 'column',
                    border: '1px solid var(--line)',
                    boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
                    color: 'var(--text-0)' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line)' }}>
          <strong style={{ fontSize: 15 }}>
            Modificar recibo #{r.id_bd} ({r.estado_bd || r.estado})
          </strong>
          {!editableFull && esAdmin && (
            <div style={{ fontSize: 11, color: 'var(--amber)', marginTop: 4, lineHeight: 1.5 }}>
              ⚠ Recibo cobrado/facturado. Como <strong>administrador</strong> puedes editar{' '}
              <strong>todo</strong>: importe, fechas de <strong>inicio/fin/cobro</strong>, método y
              periodicidad. Ojo: el cambio afecta <strong>solo a Round</strong>, NO se propaga a Odoo
              (la factura/pago de Odoo conservan el importe anterior → la reconciliación lo marcará).
            </div>
          )}
          {!editableFull && !esAdmin && (
            <div style={{ fontSize: 11, color: 'var(--amber)', marginTop: 4, lineHeight: 1.5 }}>
              ⚠ Recibo cobrado/facturado: solo puedes ajustar la <strong>periodicidad</strong> y la{' '}
              <strong>fecha fin</strong> (próximo cobro), además de descripciones/notas. El{' '}
              <strong>importe y las fechas de un recibo cobrado solo los modifica un administrador</strong>.
            </div>
          )}
          {avisoLegacyOdoo && (
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
              ℹ Recibo aún no cobrado. La modificación afecta solo a la cuota (no toca Odoo);
              la factura se generará con el importe correcto cuando se cobre.
            </div>
          )}
        </div>

        <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>
          {/* Cliente */}
          <Fld label="Cliente (nombre snapshot)">
            <input value={f.cliente_nombre || ''}
                   onChange={e => set('cliente_nombre', e.target.value)}
                   style={inp} />
          </Fld>

          {/* Cuota */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <Fld label="Código cuota">
              <input value={f.cuota_codigo || ''}
                     onChange={e => set('cuota_codigo', e.target.value)}
                     style={{ ...inp, fontFamily: 'var(--font-mono)' }} />
            </Fld>
            <Fld label="Descripción cuota">
              <input value={f.cuota_descripcion || ''}
                     onChange={e => set('cuota_descripcion', e.target.value)}
                     style={inp} />
            </Fld>
          </div>

          {/* Periodo / fechas — solo si editable_full */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12 }}>
            <Fld label="Periodo (AAAA-MM)">
              <input value={f.periodo || ''} disabled={!fullEdit}
                     onChange={e => set('periodo', e.target.value)}
                     placeholder="2026-06"
                     style={{ ...inp, fontFamily: 'var(--font-mono)' }} />
            </Fld>
            <Fld label="Fecha emisión">
              <input type="date" value={(f.fecha_emision || '').slice(0, 10)}
                     disabled={!fullEdit}
                     onChange={e => set('fecha_emision', e.target.value)}
                     style={inp} />
            </Fld>
            <Fld label="Periodo desde">
              <input type="date" value={(f.fecha_desde || '').slice(0, 10)}
                     disabled={!fullEdit}
                     onChange={e => set('fecha_desde', e.target.value)}
                     style={inp} />
            </Fld>
            <Fld label={`Periodo hasta (fecha fin${esAdmin ? '' : ' · automática'})`}>
              <input type="date"
                     value={fechaFinManual ?? fechaHastaCalc}
                     disabled={!esAdmin}
                     readOnly={!esAdmin}
                     onChange={e => setFechaFinManual(e.target.value || null)}
                     style={{ ...inp, opacity: esAdmin ? 1 : 0.75 }} />
              <span style={{ display: 'block', fontSize: 10, color: 'var(--text-3)', marginTop: 3 }}>
                {fechaFinManual != null ? (
                  <>Manual ·{' '}
                    <button type="button" onClick={() => setFechaFinManual(null)}
                            style={{ background: 'none', border: 'none', padding: 0,
                                     color: 'var(--green)', cursor: 'pointer', font: 'inherit',
                                     textDecoration: 'underline' }}>
                      usar automática
                    </button>{' '}(periodo desde + {f.periodicidad || 'mensual'})</>
                ) : (
                  <>Automática = periodo desde + {f.periodicidad || 'mensual'}
                    {esAdmin ? ' · editable' : ''}
                    {esCobrado && !editableFull ? ' · define el próximo cobro' : ''}</>
                )}
              </span>
            </Fld>
          </div>

          {/* Fecha de cobro (solo recibos cobrados; editable solo admin) */}
          {esCobrado && (
            <Fld label="Fecha de cobro (fecha real del pago)">
              <input type="date" value={(f.fecha_pago || '').slice(0, 10)}
                     disabled={!esAdmin}
                     onChange={e => set('fecha_pago', e.target.value)}
                     style={{ ...inp, maxWidth: 240, opacity: esAdmin ? 1 : 0.75 }} />
              <span style={{ display: 'block', fontSize: 10, color: 'var(--text-3)', marginTop: 3 }}>
                {esAdmin
                  ? 'Solo admin. Corrige la fecha registrada del cobro; no cambia el importe ni Odoo.'
                  : 'Solo el administrador puede cambiar la fecha de cobro.'}
              </span>
            </Fld>
          )}

          {/* Método + periodicidad */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <Fld label="Método de pago">
              <select value={f.metodo_pago || ''} disabled={!fullEdit}
                      onChange={e => set('metodo_pago', e.target.value)}
                      style={inp}>
                {METODOS.map(m =>
                  <option key={m.id} value={m.id}>{m.label}</option>
                )}
              </select>
            </Fld>
            <Fld label="Periodicidad">
              <select value={f.periodicidad || ''} disabled={!editableFechaHasta}
                      onChange={e => set('periodicidad', e.target.value)}
                      style={inp}>
                <option value="">—</option>
                <option value="mensual">Mensual</option>
                <option value="bimestral">Bimestral</option>
                <option value="trimestral">Trimestral</option>
                <option value="semestral">Semestral</option>
                <option value="anual">Anual</option>
                <option value="unico">Único</option>
              </select>
            </Fld>
          </div>

          {/* Importes */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12 }}>
            <Fld label="Base imponible (€)">
              <input type="number" step="0.01" value={f.importe_base ?? ''}
                     disabled={!fullEdit}
                     onChange={e => recalcular(setF, 'importe_base', e.target.value)}
                     style={{ ...inp, fontFamily: 'var(--font-mono)', textAlign: 'right' }} />
            </Fld>
            <Fld label="IVA %">
              <select value={f.iva_pct ?? 21} disabled={!fullEdit}
                      onChange={e => recalcular(setF, 'iva_pct', e.target.value)}
                      style={inp}>
                <option value="0">0%</option>
                <option value="4">4%</option>
                <option value="10">10%</option>
                <option value="21">21%</option>
              </select>
            </Fld>
            <Fld label="IVA importe (€)">
              <input type="number" step="0.01" value={f.importe_iva ?? ''}
                     disabled={!fullEdit}
                     onChange={e => set('importe_iva', e.target.value)}
                     style={{ ...inp, fontFamily: 'var(--font-mono)', textAlign: 'right' }} />
            </Fld>
            <Fld label="Total (€) *">
              <input type="number" step="0.01" value={f.importe_total ?? ''}
                     disabled={!fullEdit}
                     onChange={e => set('importe_total', e.target.value)}
                     style={{ ...inp, fontFamily: 'var(--font-mono)', textAlign: 'right',
                              fontWeight: 700, fontSize: 16 }} />
            </Fld>
          </div>

          <Fld label="Notas internas">
            <textarea value={f.notas || ''}
                      onChange={e => set('notas', e.target.value)}
                      rows={3} style={{ ...inp, resize: 'vertical' }} />
          </Fld>
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--line)',
                       display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Btn variant="secondary" onClick={() => setOpen(false)} disabled={saving}>
            Cancelar
          </Btn>
          <Btn variant="primary" onClick={submit} disabled={saving}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            {' '}Guardar cambios
          </Btn>
        </div>
      </div>
    </div>
  )

  return (
    <>
      <Btn variant="ghost" size={size} onClick={openModal} title="Modificar recibo">
        <Pencil size={11} /> Modificar
      </Btn>
      {modal && createPortal(modal, document.body)}
    </>
  )
}


function initialForm(r) {
  // r puede venir con campos del listado unificado (amount_total, etc.) o
  // con los nombres BD originales. Intentamos cubrir ambos.
  return {
    cliente_nombre:    r.partner_id?.name || r.cliente_nombre || '',
    cuota_codigo:      r.cuota_codigo || '',
    cuota_descripcion: r.cuota_descripcion || '',
    periodo:           r.periodo || r.mes_ref || '',
    fecha_emision:     r.invoice_date || r.fecha_emision || '',
    fecha_desde:       r.fecha_desde || '',
    fecha_hasta:       r.fecha_hasta || '',
    periodicidad:      r.periodicidad || '',
    fecha_pago:        (r.fecha_pago || '').slice(0, 10),
    metodo_pago:       r.forma_pago || r.metodo_pago || 'caja_efectivo',
    importe_base:      (r.importe_base ?? r.amount_untaxed ?? 0).toString(),
    importe_iva:       (r.importe_iva ?? r.amount_tax ?? 0).toString(),
    importe_total:     (r.importe_total ?? r.amount_total ?? 0).toString(),
    iva_pct:           (r.iva_pct ?? 21).toString(),
    notas:             r.narration || r.notas || '',
  }
}


// Sprint 7 audit — recalcular IVA usando setF funcional (lee el estado
// tras aplicar el cambio del campo), evitando el stale `f` del closure.
// Fórmula: IVA = round(base * ivaP/100, 2). Funciona también con tipos
// de IVA decimales (4.5, 7.5...) — la anterior `Math.round(base*ivaP)/100`
// solo funcionaba por casualidad con ivaP entero.
function recalcular(setF, campo, valor) {
  setF(prev => {
    const next = { ...prev, [campo]: valor }
    const base = Number(next.importe_base)
    const ivaP = Number(next.iva_pct)
    if (isNaN(base) || isNaN(ivaP)) return next
    const iva = Math.round(base * ivaP) / 100   // = base * (ivaP/100), redondeado
    const tot = Math.round((base + iva) * 100) / 100
    return { ...next, importe_iva: iva.toFixed(2), importe_total: tot.toFixed(2) }
  })
}


// ── Helpers de fecha para acotar la fecha fin (fecha_hasta) ──────────────────
// Periodicidad → meses de cobertura natural (espejo del backend _PERIOD_MESES).
const PERIOD_MESES = { mensual: 1, bimestral: 2, bimensual: 2, trimestral: 3,
                       semestral: 6, anual: 12, unico: 1 }

// Formatea componentes locales a 'YYYY-MM-DD' (sin pasar por toISOString, que
// usaría UTC y podría desplazar el día en zonas horarias != UTC).
function fmtISO(d) {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${dd}`
}
// Suma n meses recortando al último día válido del mes destino (31-ene+1m=28-feb).
function addMonthsISO(iso, n) {
  const [y, m, dd] = iso.slice(0, 10).split('-').map(Number)
  if (!y || !m || !dd) return iso
  const base = new Date(y, m - 1, 1)
  base.setMonth(base.getMonth() + n)
  const last = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate()
  base.setDate(Math.min(dd, last))
  return fmtISO(base)
}
function addDaysISO(iso, n) {
  const [y, m, dd] = iso.slice(0, 10).split('-').map(Number)
  if (!y || !m || !dd) return iso
  const d = new Date(y, m - 1, dd)
  d.setDate(d.getDate() + n)
  return fmtISO(d)
}


function Fld({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 11, color: 'var(--text-3)',
                       marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  )
}

const inp = {
  width: '100%', padding: 8, borderRadius: 8, fontSize: 13,
  background: 'var(--bg-2)', border: '1px solid var(--line)',
  color: 'var(--text-0)',
}
