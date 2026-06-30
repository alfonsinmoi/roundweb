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

  const isBd = r._source === 'bd'
  const tieneMoveOdoo = !!(r.account_move_id || r.account_move_ref)
  // Auditoría #25 — un recibo NO cobrado se edita siempre (solo la cuota BD).
  // Regla: un recibo no pagado no debe tener factura en Odoo hasta que se
  // cobre; la modificación afecta solo a la tabla de cuotas (no toca Odoo),
  // así que es editable AUNQUE tenga una factura Odoo legacy enlazada (import
  // GestPlus). Solo `pagado`/`facturado` quedan inmovilizados (espejo backend).
  const editableFull = ['borrador_remesa', 'pendiente', 'emitido', 'impagado', 'devuelto']
    .includes(r.estado_bd || r.estado)
  // Aviso informativo (no bloquea) si el no-cobrado arrastra factura Odoo legacy.
  const avisoLegacyOdoo = editableFull && tieneMoveOdoo

  // Límites de la FECHA FIN (fecha_hasta) — regla del propietario:
  //   mínimo = fecha_inicio + 1 mes
  //   máximo = fin natural de la periodicidad de la cuota + 31 días
  // La fecha fin define cuándo vuelve a tocar emitir (cobertura). Mismo límite
  // que valida el backend (recibos.update_recibo).
  const fdesdeISO = (f.fecha_desde || '').slice(0, 10)
  const perMeses = PERIOD_MESES[(f.periodicidad || 'mensual').toLowerCase()] || 1
  const minHasta = fdesdeISO ? addMonthsISO(fdesdeISO, 1) : undefined
  const maxHasta = fdesdeISO ? addDaysISO(addMonthsISO(fdesdeISO, perMeses), 31) : undefined

  if (!canModificar) return null
  if (!isBd) return null

  const openModal = () => {
    setF(initialForm(r))
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
    // Validar rango de la fecha fin antes de enviar (espejo del backend).
    if (editableFull && f.fecha_hasta) {
      const fh = f.fecha_hasta.slice(0, 10)
      if (minHasta && fh < minHasta) {
        toast.error(`La fecha fin no puede ser anterior a ${minHasta} (mínimo 1 mes desde el inicio).`)
        return
      }
      if (maxHasta && fh > maxHasta) {
        toast.error(`La fecha fin no puede superar ${maxHasta} (periodicidad + 31 días).`)
        return
      }
    }
    setSaving(true)
    try {
      const payload = {
        cliente_nombre: f.cliente_nombre,
        cuota_codigo: f.cuota_codigo,
        cuota_descripcion: f.cuota_descripcion,
        notas: f.notas,
      }
      if (editableFull) {
        Object.assign(payload, {
          fecha_desde: f.fecha_desde || null,
          fecha_hasta: f.fecha_hasta || null,
          periodicidad: f.periodicidad || null,
          importe_base: numOrSkip(f.importe_base),
          importe_iva: numOrSkip(f.importe_iva),
          importe_total: numOrSkip(f.importe_total),
          iva_pct: numOrSkip(f.iva_pct),
          metodo_pago: f.metodo_pago,
          periodo: f.periodo,
          fecha_emision: f.fecha_emision,
        })
        // Eliminar las claves undefined para que el backend ignore esos campos
        Object.keys(payload).forEach(k => {
          if (payload[k] === undefined) delete payload[k]
        })
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
    <div role="dialog" aria-modal="true" onClick={() => !saving && setOpen(false)}
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
          {!editableFull && (
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
              ⚠ Solo descripciones/notas editables — el recibo está cobrado/facturado y los
              importes ya están en contabilidad.
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
              <input value={f.periodo || ''} disabled={!editableFull}
                     onChange={e => set('periodo', e.target.value)}
                     placeholder="2026-06"
                     style={{ ...inp, fontFamily: 'var(--font-mono)' }} />
            </Fld>
            <Fld label="Fecha emisión">
              <input type="date" value={(f.fecha_emision || '').slice(0, 10)}
                     disabled={!editableFull}
                     onChange={e => set('fecha_emision', e.target.value)}
                     style={inp} />
            </Fld>
            <Fld label="Periodo desde">
              <input type="date" value={(f.fecha_desde || '').slice(0, 10)}
                     disabled={!editableFull}
                     onChange={e => set('fecha_desde', e.target.value)}
                     style={inp} />
            </Fld>
            <Fld label="Periodo hasta (fecha fin)">
              <input type="date" value={(f.fecha_hasta || '').slice(0, 10)}
                     disabled={!editableFull}
                     min={minHasta} max={maxHasta}
                     onChange={e => set('fecha_hasta', e.target.value)}
                     style={inp} />
              {editableFull && (minHasta || maxHasta) && (
                <span style={{ display: 'block', fontSize: 10, color: 'var(--text-3)', marginTop: 3 }}>
                  Entre {minHasta || '—'} y {maxHasta || '—'} ({f.periodicidad || 'mensual'} + 31 días)
                </span>
              )}
            </Fld>
          </div>

          {/* Método + periodicidad */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <Fld label="Método de pago">
              <select value={f.metodo_pago || ''} disabled={!editableFull}
                      onChange={e => set('metodo_pago', e.target.value)}
                      style={inp}>
                {METODOS.map(m =>
                  <option key={m.id} value={m.id}>{m.label}</option>
                )}
              </select>
            </Fld>
            <Fld label="Periodicidad">
              <select value={f.periodicidad || ''} disabled={!editableFull}
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
                     disabled={!editableFull}
                     onChange={e => recalcular(setF, 'importe_base', e.target.value)}
                     style={{ ...inp, fontFamily: 'var(--font-mono)', textAlign: 'right' }} />
            </Fld>
            <Fld label="IVA %">
              <select value={f.iva_pct ?? 21} disabled={!editableFull}
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
                     disabled={!editableFull}
                     onChange={e => set('importe_iva', e.target.value)}
                     style={{ ...inp, fontFamily: 'var(--font-mono)', textAlign: 'right' }} />
            </Fld>
            <Fld label="Total (€) *">
              <input type="number" step="0.01" value={f.importe_total ?? ''}
                     disabled={!editableFull}
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
