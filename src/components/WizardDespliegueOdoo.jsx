/**
 * Wizard de despliegue de contabilidad/CRM (Fase 2A).
 *
 * Multi-paso: datos fiscales → plan contable → bancos → numeración → revisar.
 * Al enviar, llama a POST /api/manager/solicitud-despliegue; tras 24h el
 * admin Wiemspro procesa la solicitud y activa Odoo.
 *
 * El estado del wizard se persiste en sessionStorage por si el usuario
 * cierra el navegador a media solicitud — al reabrirlo retoma donde estaba.
 */
import { useState, useEffect } from 'react'
import { X, ChevronLeft, ChevronRight, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react'
import { Card, Btn } from './UI'
import { useToast } from './Toast'
import { managerSolicitudDespliegue } from '../utils/configApi'

const STORAGE_KEY = (mgr) => `round.wizard_despliegue_odoo:${mgr}`

const STEPS = [
  { id: 'fiscal',  label: 'Datos fiscales' },
  { id: 'plan',    label: 'Plan contable' },
  { id: 'bancos',  label: 'Cuenta bancaria' },
  { id: 'numer',   label: 'Numeración' },
  { id: 'revisar', label: 'Revisar y enviar' },
]

const PLANES = [
  { id: 'es_pymes', label: 'PGC PYMES (recomendado para gimnasios pequeños y medianos)' },
  { id: 'es_full',  label: 'PGC Completo (entidades grandes con auditoría)' },
  { id: 'es_assoc', label: 'PGC Asociaciones (sin ánimo de lucro)' },
]

const EMPTY = {
  razon_social: '', cif: '',
  direccion: '', poblacion: '', cp: '', provincia: '', pais: 'España',
  telefono: '', email_facturacion: '',
  plan_contable: 'es_pymes',
  factura_secuencia_prefijo: '', factura_ultimo_numero: 0,
  iban_principal: '', banco_nombre: '',
  notas_manager: '',
}


export default function WizardDespliegueOdoo({ identity, prefillCliente, onClose, onSubmitted }) {
  const toast = useToast()
  const mgrKey = identity?.managerId || 'none'
  // Restaurar borrador si existe
  const [data, setData] = useState(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY(mgrKey))
      if (raw) return { ...EMPTY, ...JSON.parse(raw) }
    } catch { /* noop */ }
    // Prefill con datos del wcommerce check (razón social, CIF, email)
    return {
      ...EMPTY,
      razon_social: prefillCliente?.personaJuridica || prefillCliente?.nombre || '',
      cif: prefillCliente?.cif || '',
      email_facturacion: prefillCliente?.email || '',
      pais: prefillCliente?.pais || 'España',
    }
  })
  const [step, setStep] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  // Persistir cada cambio
  useEffect(() => {
    try { sessionStorage.setItem(STORAGE_KEY(mgrKey), JSON.stringify(data)) } catch { /* quota */ }
  }, [data, mgrKey])

  const set = (patch) => setData(d => ({ ...d, ...patch }))

  // Validación per-paso
  function validateStep(idx) {
    if (idx === 0) {
      if (!data.razon_social.trim()) return 'La razón social es obligatoria.'
      if (!data.cif.trim()) return 'El CIF/NIF es obligatorio.'
      if (data.cif.trim().length < 8) return 'El CIF parece demasiado corto.'
    }
    if (idx === 2) {
      // IBAN es opcional, pero si lo introducen debe parecer válido
      const iban = data.iban_principal.replace(/\s/g, '')
      if (iban && (iban.length < 20 || !/^[A-Z]{2}\d+/i.test(iban))) {
        return 'El IBAN parece inválido. Usa formato ES00 0000 0000 0000 0000 0000.'
      }
    }
    if (idx === 3) {
      const n = Number(data.factura_ultimo_numero)
      if (Number.isNaN(n) || n < 0) return 'El último número de factura debe ser ≥ 0.'
    }
    return null
  }

  const handleNext = () => {
    const err = validateStep(step)
    if (err) { toast.error(err); return }
    setStep(s => Math.min(STEPS.length - 1, s + 1))
  }
  const handleBack = () => setStep(s => Math.max(0, s - 1))

  async function handleSubmit() {
    // Validar todos los pasos
    for (let i = 0; i < STEPS.length - 1; i++) {
      const err = validateStep(i)
      if (err) { setStep(i); toast.error(err); return }
    }
    setSubmitting(true); setError(null)
    try {
      // El backend ejecuta el provisioner SÍNCRONO (~15-30s). El timeout
      // de fetch del navegador es generoso (>60s), así que esperamos
      // bloqueando con spinner.
      const res = await managerSolicitudDespliegue(identity, data)
      sessionStorage.removeItem(STORAGE_KEY(mgrKey))
      toast.success(res?.mensaje || '¡Contabilidad activada!')
      onSubmitted?.(res)
    } catch (e) {
      // Provisioner falló (HTTP 502/500) — mostramos el motivo y el paso
      const body = e?.body || {}
      const motivo = body.motivo || body.detalle || e.message || 'Error desconocido'
      const step = body.step ? ` (paso: ${body.step})` : ''
      setError(motivo + step)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }}>
      <Card onClick={(e) => e.stopPropagation()}
            style={{ padding: 0, maxWidth: 720, width: '100%', maxHeight: '92vh',
                     display: 'flex', flexDirection: 'column' }}>
        {/* Header con stepper */}
        <div style={{ padding: 18, borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <div>
              <h3 style={{ margin: 0, fontFamily: 'Outfit', fontSize: 17, fontWeight: 700 }}>
                Wizard de despliegue de contabilidad
              </h3>
              <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
                Paso {step + 1} de {STEPS.length}: {STEPS[step].label}
              </p>
            </div>
            <button onClick={onClose} aria-label="Cerrar"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)' }}>
              <X size={16} />
            </button>
          </div>
          <Stepper step={step} />
        </div>

        {/* Contenido del paso */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 22 }}>
          {step === 0 && <StepFiscal  data={data} set={set} />}
          {step === 1 && <StepPlan    data={data} set={set} />}
          {step === 2 && <StepBancos  data={data} set={set} />}
          {step === 3 && <StepNumer   data={data} set={set} />}
          {step === 4 && <StepRevisar data={data} />}
          {error && (
            <div style={{
              marginTop: 14, padding: 12, borderRadius: 8,
              background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.30)',
              fontSize: 13, color: 'var(--text-0)',
            }}>
              <AlertTriangle size={14} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle', color: 'var(--red)' }} />
              {error}
            </div>
          )}
        </div>

        {/* Footer con navegación */}
        <div style={{ padding: 14, borderTop: '1px solid var(--line)',
                      display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <Btn variant="ghost" onClick={handleBack} disabled={step === 0 || submitting}>
            <ChevronLeft size={14} /> Atrás
          </Btn>
          {step < STEPS.length - 1 ? (
            <Btn variant="primary" onClick={handleNext} disabled={submitting}>
              Siguiente <ChevronRight size={14} />
            </Btn>
          ) : (
            <Btn variant="primary" onClick={handleSubmit} disabled={submitting}>
              {submitting
                ? <><Loader2 size={14} className="animate-spin" /> Desplegando contabilidad… (~15-30s)</>
                : <><CheckCircle2 size={14} /> Desplegar contabilidad</>}
            </Btn>
          )}
        </div>
      </Card>
    </div>
  )
}


// ─── Componentes auxiliares ────────────────────────────────────────────

function Stepper({ step }) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {STEPS.map((s, i) => (
        <div key={s.id} style={{
          flex: 1, height: 4, borderRadius: 2,
          background: i <= step ? 'var(--green)' : 'var(--bg-3)',
          transition: 'background 0.2s',
        }} />
      ))}
    </div>
  )
}

function Field({ label, required, children, hint }) {
  return (
    <label style={{ display: 'block', marginBottom: 14 }}>
      <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-2)',
                     textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>
        {label} {required && <span style={{ color: 'var(--red)' }}>*</span>}
      </span>
      {children}
      {hint && (
        <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4, lineHeight: 1.4 }}>
          {hint}
        </p>
      )}
    </label>
  )
}

const inputStyle = {
  width: '100%', padding: '9px 12px', fontSize: 13,
  border: '1px solid var(--line)', borderRadius: 8,
  background: 'var(--bg-1)', color: 'var(--text-0)',
  fontFamily: 'inherit',
}

function Input({ value, onChange, placeholder, type = 'text', ...rest }) {
  return <input type={type} value={value || ''}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder} style={inputStyle} {...rest} />
}

// ─── Pasos ─────────────────────────────────────────────────────────────

function StepFiscal({ data, set }) {
  return (
    <div>
      <Field label="Razón social" required hint="Nombre legal de la empresa que emitirá las facturas.">
        <Input value={data.razon_social} onChange={(v) => set({ razon_social: v })}
               placeholder="MI GIMNASIO S.L." />
      </Field>
      <Field label="CIF / NIF" required hint="Solo se acepta NIF válido en España (letra + 8 dígitos o 8 dígitos + letra).">
        <Input value={data.cif} onChange={(v) => set({ cif: v.toUpperCase() })}
               placeholder="B12345678" />
      </Field>
      <Field label="Dirección fiscal">
        <Input value={data.direccion} onChange={(v) => set({ direccion: v })}
               placeholder="Calle Mayor 1, Bajo" />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <Field label="CP">
          <Input value={data.cp} onChange={(v) => set({ cp: v })} placeholder="29001" />
        </Field>
        <Field label="Población">
          <Input value={data.poblacion} onChange={(v) => set({ poblacion: v })}
                 placeholder="Málaga" />
        </Field>
        <Field label="Provincia">
          <Input value={data.provincia} onChange={(v) => set({ provincia: v })}
                 placeholder="Málaga" />
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Teléfono">
          <Input value={data.telefono} onChange={(v) => set({ telefono: v })}
                 placeholder="+34 952 000 000" />
        </Field>
        <Field label="Email facturación" hint="A donde enviaremos los recibos automáticamente.">
          <Input type="email" value={data.email_facturacion}
                 onChange={(v) => set({ email_facturacion: v })}
                 placeholder="facturacion@migimnasio.com" />
        </Field>
      </div>
    </div>
  )
}

function StepPlan({ data, set }) {
  return (
    <div>
      <Field label="Plan contable">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {PLANES.map(p => (
            <label key={p.id} style={{
              display: 'flex', alignItems: 'flex-start', gap: 10,
              padding: 12, border: '1px solid var(--line)', borderRadius: 8,
              background: data.plan_contable === p.id ? 'rgba(45,212,168,0.05)' : 'transparent',
              borderColor: data.plan_contable === p.id ? 'var(--green)' : 'var(--line)',
              cursor: 'pointer',
            }}>
              <input type="radio" name="plan" checked={data.plan_contable === p.id}
                     onChange={() => set({ plan_contable: p.id })}
                     style={{ marginTop: 3 }} />
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-0)' }}>
                  {p.id.toUpperCase().replace('ES_', '')}
                </p>
                <p style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>
                  {p.label}
                </p>
              </div>
            </label>
          ))}
        </div>
      </Field>
      <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8, lineHeight: 1.5 }}>
        Si no estás seguro, deja PYMES — es la opción correcta para 95% de los centros.
        Después se puede ampliar pero NO cambiar.
      </p>
    </div>
  )
}

function StepBancos({ data, set }) {
  return (
    <div>
      <p style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 16, lineHeight: 1.5 }}>
        Cuenta bancaria principal donde se cobrarán los recibos SEPA. Puedes
        añadir más después desde Odoo.
      </p>
      <Field label="IBAN principal" hint="Solo formato español (24 dígitos comenzando por ES).">
        <Input value={data.iban_principal} onChange={(v) => set({ iban_principal: v })}
               placeholder="ES00 0000 0000 0000 0000 0000" />
      </Field>
      <Field label="Banco / entidad">
        <Input value={data.banco_nombre} onChange={(v) => set({ banco_nombre: v })}
               placeholder="Banco Santander, S.A." />
      </Field>
    </div>
  )
}

function StepNumer({ data, set }) {
  return (
    <div>
      <p style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 16, lineHeight: 1.5 }}>
        Para mantener la continuidad legal con tu sistema anterior, indícanos
        el número de la <strong>última factura emitida</strong>. Odoo seguirá la
        numeración a partir de ahí.
      </p>
      <Field label="Prefijo de factura"
             hint='Ejemplo: "F-2026-" produce facturas F-2026-001, F-2026-002…'>
        <Input value={data.factura_secuencia_prefijo}
               onChange={(v) => set({ factura_secuencia_prefijo: v })}
               placeholder="F-2026-" />
      </Field>
      <Field label="Último número emitido"
             hint='Ejemplo: si tu última factura fue F-2026-247, escribe 247. La primera de Round será 248.'>
        <Input type="number" value={data.factura_ultimo_numero}
               onChange={(v) => set({ factura_ultimo_numero: v })}
               placeholder="0" />
      </Field>
      <Field label="Notas adicionales (opcional)"
             hint="Cualquier info que quieras añadir para el equipo de despliegue.">
        <textarea value={data.notas_manager}
                  onChange={(e) => set({ notas_manager: e.target.value })}
                  rows={3}
                  style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
      </Field>
    </div>
  )
}

function StepRevisar({ data }) {
  // Nota informativa al usuario sobre el tiempo del provisioner
  const _info = (
    <div style={{
      marginBottom: 14, padding: 12, borderRadius: 8,
      background: 'rgba(91,156,246,0.06)', border: '1px solid rgba(91,156,246,0.22)',
      fontSize: 12, color: 'var(--text-1)', lineHeight: 1.5,
    }}>
      Al pulsar <strong>"Desplegar contabilidad"</strong>, Round creará automáticamente
      tu compañía en Odoo con plan PYMES (635 cuentas), tus journals, IBAN
      y secuencia de facturas. Este proceso tarda 15-30 segundos y al
      terminar verás los menús de CRM, Cuotas y Contabilidad activos.
    </div>
  )
  // El resto del componente sigue igual
  const rows = [
    ['Razón social',      data.razon_social],
    ['CIF/NIF',           data.cif],
    ['Dirección',         [data.direccion, data.cp, data.poblacion, data.provincia, data.pais].filter(Boolean).join(', ')],
    ['Teléfono',          data.telefono],
    ['Email facturación', data.email_facturacion],
    ['Plan contable',     data.plan_contable.toUpperCase().replace('ES_', '')],
    ['IBAN',              data.iban_principal],
    ['Banco',             data.banco_nombre],
    ['Numeración',        data.factura_secuencia_prefijo
      ? `${data.factura_secuencia_prefijo}${(Number(data.factura_ultimo_numero) || 0) + 1}+`
      : `Empezar en ${(Number(data.factura_ultimo_numero) || 0) + 1}`],
    ['Notas',             data.notas_manager],
  ]
  return (
    <div>
      {_info}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6,
                    padding: 14, background: 'var(--bg-2)', borderRadius: 8 }}>
        {rows.filter(([_, v]) => v && String(v).trim()).map(([label, value]) => (
          <div key={label} style={{ display: 'flex', gap: 10, fontSize: 13 }}>
            <span style={{ minWidth: 140, color: 'var(--text-3)', flexShrink: 0 }}>{label}</span>
            <span style={{ color: 'var(--text-0)', fontWeight: 500 }}>{value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
