/**
 * Wizard de activación del módulo Contabilidad (Fase 6).
 *
 * Activa la gestión de gastos (subida PDFs, OCR, asientos, listados,
 * conciliación). Pasos:
 *
 *   1. Datos fiscales (si la company no existe aún): razón social, CIF.
 *   2. Plan contable (es_pymes recomendado; se aplica una sola vez —
 *      si Cuotas ya lo aplicó, el provisioner lo reutiliza).
 *   3. Revisar y confirmar.
 *
 * Backend: POST /api/manager/provision/contabilidad.
 */
import { useState } from 'react'
import { Loader2, Calculator, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react'
import { Btn, DatosTabla } from './UI'
import { managerProvisionModulo } from '../utils/configApi'
import { ModalShell, Label, Input } from './WizardActivarCRM'


const PLANES = [
  { id: 'es_pymes', label: 'PGC PYMES (recomendado para gimnasios)' },
  { id: 'es_full',  label: 'PGC Completo (entidades grandes con auditoría)' },
  { id: 'es_assoc', label: 'PGC Asociaciones (sin ánimo de lucro)' },
]


export default function WizardActivarContabilidad({ identity, status, onClose, onSubmitted }) {
  const companyExists = !!status?.odoo_company_id

  const STEPS = companyExists
    ? [{ id: 'plan' }, { id: 'revisar' }]
    : [{ id: 'fiscal' }, { id: 'plan' }, { id: 'revisar' }]

  const [stepIdx, setStepIdx] = useState(0)
  const [data, setData] = useState({
    razon_social: '', cif: '',
    plan_contable: 'es_pymes',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  const step = STEPS[stepIdx]
  const set = (patch) => setData(d => ({ ...d, ...patch }))

  function validate() {
    if (step.id === 'fiscal') {
      if (!data.razon_social.trim()) return 'La razón social es obligatoria.'
      if (!data.cif.trim() || data.cif.trim().length < 8)
        return 'CIF/NIF inválido (mínimo 8 caracteres).'
    }
    return null
  }

  const handleNext = () => {
    const err = validate()
    if (err) { setError(err); return }
    setError(null)
    setStepIdx(i => Math.min(STEPS.length - 1, i + 1))
  }
  const handleBack = () => {
    setError(null)
    setStepIdx(i => Math.max(0, i - 1))
  }

  async function handleSubmit() {
    setSubmitting(true); setError(null)
    try {
      const payload = { plan_contable: data.plan_contable }
      if (!companyExists) {
        payload.razon_social = data.razon_social.trim()
        payload.cif = data.cif.trim().toUpperCase()
      }
      const res = await managerProvisionModulo(identity, 'contabilidad', payload)
      if (res?.ok) {
        onSubmitted?.(res)
      } else {
        setError(res?.motivo || res?.detalle || res?.error || 'Error al activar Contabilidad.')
      }
    } catch (e) {
      setError(e.message || 'Error de red.')
    }
    setSubmitting(false)
  }

  const planLabel = PLANES.find(p => p.id === data.plan_contable)?.label || data.plan_contable

  return (
    <ModalShell title="Activar Contabilidad" icon={Calculator} onClose={onClose}>
      <div style={{ padding: 20, fontSize: 13, color: 'var(--text-1)', lineHeight: 1.6 }}>
        {step.id === 'fiscal' && (
          <>
            <p style={{ marginBottom: 14 }}>
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
          </>
        )}

        {step.id === 'plan' && (
          <>
            <p style={{ marginBottom: 14 }}>
              Plan contable que se aplicará para tus asientos. Si ya activaste
              Cuotas, el plan ya existe y solo lo reutilizaremos.
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
          </>
        )}

        {step.id === 'revisar' && (
          <>
            <p style={{ marginBottom: 14 }}>
              Confirma los datos. Al pulsar <strong>Activar Contabilidad</strong>
              se aplicará el plan contable (si no estaba) y se creará el journal
              de Caja para registrar gastos.
            </p>
            <DatosTabla rows={[
              ...(!companyExists ? [
                ['Razón social', data.razon_social || '—'],
                ['CIF', data.cif || '—'],
              ] : [
                ['Compañía Odoo', `#${status?.odoo_company_id} (existente)`],
              ]),
              ['Plan contable', planLabel],
              ['Habilita', 'Subida PDFs, OCR, asientos, conciliación, listados.'],
            ]} />
          </>
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
          {stepIdx < STEPS.length - 1 ? (
            <Btn variant="primary" onClick={handleNext} disabled={submitting}>
              Siguiente
              <ChevronRight size={13} />
            </Btn>
          ) : (
            <Btn variant="primary" onClick={handleSubmit} disabled={submitting}>
              {submitting && <Loader2 size={13} className="animate-spin" />}
              {submitting ? 'Activando…' : 'Activar Contabilidad'}
            </Btn>
          )}
        </div>
      </div>
    </ModalShell>
  )
}
