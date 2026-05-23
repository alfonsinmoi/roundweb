/**
 * Wizard de activación del módulo CRM (Fase 6).
 *
 * El módulo CRM no necesita datos contables (chart, journals, IBAN, sequence)
 * — solo precisa que la company Odoo del manager exista. Por tanto el
 * wizard se reduce a:
 *
 *   - Si la company YA existe (CRM/Cuotas/Contabilidad ya activos): solo
 *     pide confirmación y llama a /provision/crm (idempotente).
 *   - Si la company NO existe: pide razón social + CIF (mínimo para crear
 *     res.company).
 *
 * Backend: POST /api/manager/provision/crm.
 */
import { useState } from 'react'
import { X, Loader2, Sparkles, AlertCircle } from 'lucide-react'
import { Card, Btn } from './UI'
import { useToast } from './Toast'
import { managerProvisionModulo } from '../utils/configApi'


export default function WizardActivarCRM({ identity, status, onClose, onSubmitted }) {
  const toast = useToast()
  const companyExists = !!status?.odoo_company_id
  const [razon, setRazon] = useState('')
  const [cif, setCif] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  async function handleActivar() {
    setError(null)
    // Si la company no existe, validar razon_social/cif
    if (!companyExists) {
      if (!razon.trim()) { setError('La razón social es obligatoria.'); return }
      if (!cif.trim() || cif.trim().length < 8) {
        setError('Introduce un CIF/NIF válido (mínimo 8 caracteres).'); return
      }
    }
    setSubmitting(true)
    try {
      const datos = companyExists ? {} : {
        razon_social: razon.trim(),
        cif: cif.trim().toUpperCase(),
      }
      const res = await managerProvisionModulo(identity, 'crm', datos)
      if (res?.ok) {
        onSubmitted?.(res)
      } else {
        setError(res?.motivo || res?.detalle || res?.error || 'Error al activar CRM.')
      }
    } catch (e) {
      setError(e.message || 'Error de red.')
    }
    setSubmitting(false)
  }

  return (
    <ModalShell title="Activar CRM" icon={Sparkles} onClose={onClose}>
      <div style={{ padding: 20, fontSize: 13, color: 'var(--text-1)', lineHeight: 1.6 }}>
        <p>
          El módulo CRM no requiere configuración contable. Vamos a:
        </p>
        <ul style={{ paddingLeft: 18, marginTop: 8 }}>
          {!companyExists && <li>Crear tu compañía Odoo (res.company).</li>}
          <li>Activar el pipeline de leads (formulario web + Meta Lead Ads).</li>
          <li>Habilitar el kanban Round con etapas + score + razones de pérdida.</li>
          <li>Marcar <code>odoo_crm_enabled=true</code> en tu manager.</li>
        </ul>

        {!companyExists && (
          <>
            <div style={{
              marginTop: 16, padding: '10px 12px',
              background: 'rgba(91,156,246,0.06)', border: '1px solid rgba(91,156,246,0.20)',
              borderRadius: 6, fontSize: 12, color: 'var(--text-2)',
            }}>
              No tienes Odoo desplegado todavía. Necesitamos tu razón social y CIF
              para crear la compañía.
            </div>

            <div style={{ marginTop: 14 }}>
              <Label>Razón social *</Label>
              <Input value={razon} onChange={e => setRazon(e.target.value)}
                     placeholder="p.ej. Round Málaga Centro SL" />
            </div>
            <div style={{ marginTop: 12 }}>
              <Label>CIF / NIF *</Label>
              <Input value={cif} onChange={e => setCif(e.target.value)}
                     placeholder="B12345678" />
            </div>
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
        display: 'flex', justifyContent: 'flex-end', gap: 8,
      }}>
        <Btn variant="ghost" onClick={onClose} disabled={submitting}>Cancelar</Btn>
        <Btn variant="primary" onClick={handleActivar} disabled={submitting}>
          {submitting && <Loader2 size={13} className="animate-spin" />}
          {submitting ? 'Activando…' : 'Activar CRM'}
        </Btn>
      </div>
    </ModalShell>
  )
}


// ── Componentes auxiliares (compartidos por los 3 wizards) ───────────────

export function ModalShell({ title, icon: Icon, onClose, children }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }}>
      <Card onClick={(e) => e.stopPropagation()}
            style={{ padding: 0, maxWidth: 560, width: '100%',
                     maxHeight: 'calc(100vh - 40px)', overflowY: 'auto' }}>
        <div style={{
          padding: 18, borderBottom: '1px solid var(--line)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {Icon && <Icon size={20} style={{ color: 'var(--green)' }} />}
            <h3 style={{ margin: 0, fontFamily: 'Outfit', fontSize: 17, fontWeight: 700 }}>
              {title}
            </h3>
          </div>
          <button onClick={onClose} aria-label="Cerrar"
                  style={{ background: 'none', border: 'none', cursor: 'pointer',
                           color: 'var(--text-3)' }}>
            <X size={16} />
          </button>
        </div>
        {children}
      </Card>
    </div>
  )
}

export function Label({ children }) {
  return (
    <label style={{
      display: 'block', fontSize: 12, fontWeight: 600,
      color: 'var(--text-2)', marginBottom: 5,
    }}>
      {children}
    </label>
  )
}

export function Input(props) {
  return (
    <input {...props}
           style={{
             width: '100%', padding: '8px 11px', fontSize: 13,
             border: '1px solid var(--line)', borderRadius: 6,
             background: 'var(--bg-1)', color: 'var(--text-0)',
             fontFamily: props.type === 'number' || /iban|cif/i.test(props.name || '')
               ? 'monospace' : 'inherit',
             ...props.style,
           }} />
  )
}
