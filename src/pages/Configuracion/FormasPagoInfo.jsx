import { CreditCard, Banknote, Wallet, Coins } from 'lucide-react'
import { Card } from '../../components/UI'
import { FORMAS_PAGO } from '../../utils/configApi'

const ICONS = {
  sepa:         Banknote,
  tpv:          CreditCard,
  efectivo:     Wallet,
  tokenizacion: Coins,
}
const DESCRIPCIONES = {
  sepa:         'Cobro recurrente vía remesa SEPA. Requiere mandato firmado.',
  tpv:          'Cobro puntual vía TPV virtual (Redsys / Paycomet) — enlace de pago.',
  efectivo:     'Cobro en caja del centro al recibir al cliente.',
  tokenizacion: 'Cobro recurrente con tarjeta tokenizada (no se almacena el PAN).',
}

export default function FormasPagoInfo() {
  return (
    <div>
      <Card style={{ padding: 16, marginBottom: 14, background: 'rgba(91,156,246,0.06)',
                     border: '1px solid rgba(91,156,246,0.18)' }}>
        <p style={{ fontSize: 13, color: 'var(--text-1)', lineHeight: 1.6, margin: 0 }}>
          Las <strong>formas de pago disponibles</strong> son una lista cerrada del sistema,
          no se editan desde aquí. Cada cuota selecciona qué formas acepta en su pestaña
          de configuración.
        </p>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
        {FORMAS_PAGO.map(f => {
          const Icon = ICONS[f.id] || CreditCard
          return (
            <Card key={f.id} style={{ padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--green-bg)',
                              border: '1px solid var(--green-border)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon size={16} style={{ color: 'var(--green)' }} />
                </div>
                <div>
                  <p style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700,
                              color: 'var(--text-0)', margin: 0 }}>{f.label}</p>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)', margin: 0 }}>{f.id}</p>
                </div>
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5, margin: 0 }}>
                {DESCRIPCIONES[f.id]}
              </p>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
