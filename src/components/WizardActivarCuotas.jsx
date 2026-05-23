/**
 * Wizard de activación del módulo Cuotas (Fase 6).
 *
 * Activa el módulo de suscripciones/recibos/cobros. Pasos:
 *
 *   1. Datos fiscales (si la company no existe aún): razón social, CIF.
 *   2. Plan contable (es_pymes recomendado).
 *   3. IBAN principal + banco.
 *   4. Numeración: prefijo + último número de factura.
 *   5. Sistemas de cobro: checkboxes SEPA / TPV virtual / link / efectivo /
 *      transferencia manual / tokenización tarjeta.
 *   6. Revisar y confirmar.
 *
 * Backend: POST /api/manager/provision/cuotas.
 */
import { useState, useEffect } from 'react'
import { ChevronLeft, ChevronRight, Loader2, ReceiptText, AlertCircle,
         CheckCircle2 } from 'lucide-react'
import { Btn } from './UI'
import { useToast } from './Toast'
import { managerProvisionModulo } from '../utils/configApi'
import { ModalShell, Label, Input } from './WizardActivarCRM'

const STORAGE_KEY = (mgr) => `round.wizard_activar_cuotas:${mgr}`

const PLANES = [
  { id: 'es_pymes', label: 'PGC PYMES (recomendado para gimnasios)' },
  { id: 'es_full',  label: 'PGC Completo (entidades grandes con auditoría)' },
  { id: 'es_assoc', label: 'PGC Asociaciones (sin ánimo de lucro)' },
]

const SISTEMAS_COBRO = [
  { id: 'sepa',                 label: 'SEPA (domiciliación bancaria)',
    desc: 'Recibos mensuales con remesa SEPA XML SDD.' },
  { id: 'tpv_virtual',          label: 'TPV virtual',
    desc: 'Cobro online recurrente con tarjeta vía PayComet.' },
  { id: 'link_pago',            label: 'Enlace de pago',
    desc: 'URL única enviada al cliente para que pague manualmente.' },
  { id: 'efectivo',             label: 'Efectivo',
    desc: 'Registro manual de cobros en caja.' },
  { id: 'transferencia_manual', label: 'Transferencia manual',
    desc: 'El cliente transfiere a tu IBAN y conciliáis a mano.' },
  { id: 'tokenizacion_tarjeta', label: 'Tokenización tarjeta',
    desc: 'Guarda token PCI-compliant para cobros recurrentes sin re-pedir tarjeta.' },
]

const STEPS = [
  { id: 'fiscal',   label: 'Datos fiscales' },
  { id: 'plan',     label: 'Plan contable' },
  { id: 'iban',     label: 'IBAN' },
  { id: 'numer',    label: 'Numeración' },
  { id: 'sistemas', label: 'Sistemas de cobro' },
  { id: 'revisar',  label: 'Revisar' },
]

const EMPTY = {
  razon_social: '', cif: '',
  plan_contable: 'es_pymes',
  iban_principal: '', banco_nombre: '',
  factura_secuencia_prefijo: '', factura_ultimo_numero: 0,
  sistemas_cobro: [],
}


export default function WizardActivarCuotas({ identity, status, onClose, onSubmitted }) {
  const toast = useToast()
  const mgrKey = identity?.managerId || 'none'
  const companyExists = !!status?.odoo_company_id

  // Estado restaurado desde sessionStorage (borrador)
  const [data, setData] = useState(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY(mgrKey))
      if (raw) return { ...EMPTY, ...JSON.parse(raw) }
    } catch { /* noop */ }
    // Prefill sistemas_cobro existentes en BD si los hubiera
    return {
      ...EMPTY,
      sistemas_cobro: Array.isArray(status?.sistemas_cobro) ? status.sistemas_cobro : [],
    }
  })

  // El primer paso "fiscal" solo se muestra si la company no existe.
  // En ese caso, todos los steps van desde 0; si ya existe, saltamos.
  const visibleSteps = companyExists ? STEPS.filter(s => s.id !== 'fiscal') : STEPS
  const [stepIdx, setStepIdx] = useState(0)
  const step = visibleSteps[stepIdx]

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  // Persistir borrador
  useEffect(() => {
    try { sessionStorage.setItem(STORAGE_KEY(mgrKey), JSON.stringify(data)) }
    catch { /* quota */ }
  }, [data, mgrKey])

  const set = (patch) => setData(d => ({ ...d, ...patch }))

  function validateStep(s) {
    if (s.id === 'fiscal') {
      if (!data.razon_social.trim()) return 'La razón social es obligatoria.'
      if (!data.cif.trim() || data.cif.trim().length < 8)
        return 'CIF/NIF inválido (mínimo 8 caracteres).'
    }
    if (s.id === 'iban') {
      const iban = data.iban_principal.replace(/\s/g, '')
      if (iban && (iban.length < 20 || !/^[A-Z]{2}\d+/i.test(iban))) {
        return 'IBAN inválido (formato ES00 0000 0000 0000 0000 0000).'
      }
    }
    if (s.id === 'numer') {
      const n = Number(data.factura_ultimo_numero)
      if (Number.isNaN(n) || n < 0) return 'El último número debe ser ≥ 0.'
    }
    if (s.id === 'sistemas') {
      if (!data.sistemas_cobro || data.sistemas_cobro.length === 0) {
        return 'Selecciona al menos un sistema de cobro.'
      }
    }
    return null
  }

  const handleNext = () => {
    const err = validateStep(step)
    if (err) { setError(err); return }
    setError(null)
    setStepIdx(s => Math.min(visibleSteps.length - 1, s + 1))
  }
  const handleBack = () => {
    setError(null)
    setStepIdx(s => Math.max(0, s - 1))
  }

  async function handleSubmit() {
    setSubmitting(true); setError(null)
    try {
      const payload = {
        plan_contable: data.plan_contable,
        iban_principal: data.iban_principal.replace(/\s/g, ''),
        banco_nombre: data.banco_nombre,
        factura_secuencia_prefijo: data.factura_secuencia_prefijo,
        factura_ultimo_numero: Number(data.factura_ultimo_numero) || 0,
        sistemas_cobro: data.sistemas_cobro,
      }
      if (!companyExists) {
        payload.razon_social = data.razon_social.trim()
        payload.cif = data.cif.trim().toUpperCase()
      }
      const res = await managerProvisionModulo(identity, 'cuotas', payload)
      if (res?.ok) {
        try { sessionStorage.removeItem(STORAGE_KEY(mgrKey)) } catch {}
        onSubmitted?.(res)
      } else {
        setError(res?.motivo || res?.detalle || res?.error || 'Error al activar Cuotas.')
      }
    } catch (e) {
      setError(e.message || 'Error de red.')
    }
    setSubmitting(false)
  }

  return (
    <ModalShell title="Activar Cuotas" icon={ReceiptText} onClose={onClose}>
      <ProgressBar steps={visibleSteps} currentIdx={stepIdx} />

      <div style={{ padding: '6px 20px 20px', minHeight: 240 }}>
        {step.id === 'fiscal' && (
          <FormFiscal data={data} set={set} />
        )}
        {step.id === 'plan' && (
          <FormPlan data={data} set={set} />
        )}
        {step.id === 'iban' && (
          <FormIban data={data} set={set} />
        )}
        {step.id === 'numer' && (
          <FormNumer data={data} set={set} />
        )}
        {step.id === 'sistemas' && (
          <FormSistemas data={data} set={set} />
        )}
        {step.id === 'revisar' && (
          <FormRevisar data={data} companyExists={companyExists} status={status} />
        )}

        {error && (
          <div style={{
            marginTop: 14, padding: '10px 12px', borderRadius: 6,
            background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.28)',
            fontSize: 12, color: 'var(--text-0)',
          }}>
            <AlertCircle size={13} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle', color: 'var(--red)' }} />
            {error}
          </div>
        )}
      </div>

      <div style={{
        padding: 14, borderTop: '1px solid var(--line)',
        display: 'flex', justifyContent: 'space-between', gap: 8,
      }}>
        <Btn variant="ghost" onClick={handleBack} disabled={stepIdx === 0 || submitting}>
          <ChevronLeft size={13} />
          Atrás
        </Btn>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn variant="ghost" onClick={onClose} disabled={submitting}>Cancelar</Btn>
          {stepIdx < visibleSteps.length - 1 ? (
            <Btn variant="primary" onClick={handleNext} disabled={submitting}>
              Siguiente
              <ChevronRight size={13} />
            </Btn>
          ) : (
            <Btn variant="primary" onClick={handleSubmit} disabled={submitting}>
              {submitting && <Loader2 size={13} className="animate-spin" />}
              {submitting ? 'Activando…' : 'Activar Cuotas'}
            </Btn>
          )}
        </div>
      </div>
    </ModalShell>
  )
}


function ProgressBar({ steps, currentIdx }) {
  return (
    <div style={{
      padding: '14px 20px 0', display: 'flex', alignItems: 'center', gap: 6,
      borderBottom: '1px solid var(--line)', paddingBottom: 14,
    }}>
      {steps.map((s, i) => {
        const done = i < currentIdx
        const active = i === currentIdx
        return (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
            <div style={{
              width: 22, height: 22, borderRadius: 999,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 700,
              background: done ? 'var(--green)'
                       : active ? 'var(--blue-bg)'
                       : 'var(--bg-3)',
              color: done ? '#fff'
                    : active ? 'var(--blue)'
                    : 'var(--text-3)',
              border: active ? '1px solid var(--blue)' : 'none',
              flexShrink: 0,
            }}>
              {done ? <CheckCircle2 size={12} /> : i + 1}
            </div>
            <div style={{ marginLeft: 6, fontSize: 11,
                          color: active ? 'var(--text-0)' : 'var(--text-3)',
                          fontWeight: active ? 600 : 400, whiteSpace: 'nowrap',
                          overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {s.label}
            </div>
            {i < steps.length - 1 && (
              <div style={{ flex: 1, height: 1, background: 'var(--line)', marginLeft: 6, marginRight: 4 }} />
            )}
          </div>
        )
      })}
    </div>
  )
}


function FormFiscal({ data, set }) {
  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 14 }}>
        Datos para crear tu compañía en Odoo. Los necesitamos una sola vez.
      </p>
      <div style={{ marginBottom: 12 }}>
        <Label>Razón social *</Label>
        <Input value={data.razon_social}
               onChange={e => set({ razon_social: e.target.value })}
               placeholder="Round Málaga Centro SL" />
      </div>
      <div>
        <Label>CIF / NIF *</Label>
        <Input value={data.cif} name="cif"
               onChange={e => set({ cif: e.target.value })}
               placeholder="B12345678" />
      </div>
    </div>
  )
}


function FormPlan({ data, set }) {
  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 14 }}>
        Elige el plan contable que se aplicará a tu compañía. Si no estás
        seguro, deja PYMES (estándar para gimnasios).
      </p>
      {PLANES.map(p => (
        <label key={p.id} style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 12px', marginBottom: 6,
          border: `1px solid ${data.plan_contable === p.id ? 'var(--green)' : 'var(--line)'}`,
          borderRadius: 8, cursor: 'pointer',
          background: data.plan_contable === p.id ? 'var(--green-bg)' : 'transparent',
        }}>
          <input type="radio" name="plan" value={p.id}
                 checked={data.plan_contable === p.id}
                 onChange={() => set({ plan_contable: p.id })} />
          <span style={{ fontSize: 13, color: 'var(--text-1)' }}>{p.label}</span>
        </label>
      ))}
    </div>
  )
}


function FormIban({ data, set }) {
  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 14 }}>
        IBAN principal de tu cuenta bancaria. Es opcional, pero lo
        necesitarás para emitir remesas SEPA.
      </p>
      <div style={{ marginBottom: 12 }}>
        <Label>IBAN</Label>
        <Input value={data.iban_principal} name="iban"
               onChange={e => set({ iban_principal: e.target.value.toUpperCase() })}
               placeholder="ES00 0000 0000 0000 0000 0000" />
      </div>
      <div>
        <Label>Nombre del banco (opcional)</Label>
        <Input value={data.banco_nombre}
               onChange={e => set({ banco_nombre: e.target.value })}
               placeholder="CaixaBank, BBVA, Sabadell…" />
      </div>
    </div>
  )
}


function FormNumer({ data, set }) {
  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 14 }}>
        Numeración de tus facturas de ingreso (recibos a clientes). Si
        traes histórico, indica el último número que ya emitiste — Round
        continuará desde ahí.
      </p>
      <div style={{ marginBottom: 12 }}>
        <Label>Prefijo (opcional)</Label>
        <Input value={data.factura_secuencia_prefijo}
               onChange={e => set({ factura_secuencia_prefijo: e.target.value })}
               placeholder="FAC2026/" />
        <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
          Aparece antes del número, ej. <code>FAC2026/0007</code>.
        </p>
      </div>
      <div>
        <Label>Último número emitido</Label>
        <Input type="number" min="0" value={data.factura_ultimo_numero}
               onChange={e => set({ factura_ultimo_numero: Number(e.target.value) || 0 })} />
        <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
          La próxima factura tendrá el número <strong>{(Number(data.factura_ultimo_numero) || 0) + 1}</strong>.
        </p>
      </div>
    </div>
  )
}


function FormSistemas({ data, set }) {
  const toggle = (id) => {
    const set_ = new Set(data.sistemas_cobro || [])
    if (set_.has(id)) set_.delete(id); else set_.add(id)
    set({ sistemas_cobro: [...set_] })
  }
  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 14 }}>
        Marca todos los sistemas de cobro que usarás con tus clientes.
        Podrás cambiarlos más tarde en Configuración.
      </p>
      {SISTEMAS_COBRO.map(s => {
        const checked = (data.sistemas_cobro || []).includes(s.id)
        return (
          <label key={s.id} style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            padding: '10px 12px', marginBottom: 6,
            border: `1px solid ${checked ? 'var(--green)' : 'var(--line)'}`,
            borderRadius: 8, cursor: 'pointer',
            background: checked ? 'var(--green-bg)' : 'transparent',
          }}>
            <input type="checkbox" checked={checked} onChange={() => toggle(s.id)}
                   style={{ marginTop: 3 }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-0)' }}>
                {s.label}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                {s.desc}
              </div>
            </div>
          </label>
        )
      })}
    </div>
  )
}


function FormRevisar({ data, companyExists, status }) {
  const sistemasLabels = (data.sistemas_cobro || [])
    .map(id => SISTEMAS_COBRO.find(s => s.id === id)?.label || id)
    .join(', ') || '—'
  const planLabel = PLANES.find(p => p.id === data.plan_contable)?.label || data.plan_contable
  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 14 }}>
        Confirma los datos. Al pulsar <strong>Activar Cuotas</strong> se
        crearán/actualizarán en Odoo los journals, IBAN, secuencias y plan
        contable necesarios.
      </p>
      <DatosTabla rows={[
        ...(!companyExists ? [
          ['Razón social', data.razon_social || '—'],
          ['CIF', data.cif || '—'],
        ] : [
          ['Compañía Odoo', `#${status?.odoo_company_id} (existente)`],
        ]),
        ['Plan contable', planLabel],
        ['IBAN', data.iban_principal || <em>(sin IBAN)</em>],
        ['Banco', data.banco_nombre || '—'],
        ['Numeración', `${data.factura_secuencia_prefijo || ''}${String((Number(data.factura_ultimo_numero) || 0) + 1).padStart(4, '0')} (próxima)`],
        ['Sistemas de cobro', sistemasLabels],
      ]} />
    </div>
  )
}


export function DatosTabla({ rows }) {
  return (
    <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
      <tbody>
        {rows.map(([k, v], i) => (
          <tr key={i} style={{ borderBottom: '1px solid var(--line)' }}>
            <td style={{ padding: '8px 0', color: 'var(--text-3)', width: '40%' }}>{k}</td>
            <td style={{ padding: '8px 0', color: 'var(--text-0)', fontWeight: 500 }}>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
