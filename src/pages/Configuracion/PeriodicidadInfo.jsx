import { Calendar } from 'lucide-react'
import { Card } from '../../components/UI'
import { PERIODICIDADES } from '../../utils/configApi'

const DESCRIPCIONES = {
  mensual:     'Recibo cada mes natural. La forma más común.',
  bimensual:   'Recibo cada 2 meses.',
  trimestral:  'Recibo cada 3 meses.',
  semestral:   'Recibo cada 6 meses.',
  anual:       'Un único recibo al año (o renovación anual).',
}

export default function PeriodicidadInfo() {
  return (
    <div>
      <Card style={{ padding: 16, marginBottom: 14, background: 'rgba(91,156,246,0.06)',
                     border: '1px solid rgba(91,156,246,0.18)' }}>
        <p style={{ fontSize: 13, color: 'var(--text-1)', lineHeight: 1.6, margin: 0 }}>
          Las <strong>periodicidades de pago</strong> son una lista cerrada del sistema.
          Cada cuota indica qué periodicidades ofrece, y cada cliente elige la suya al alta.
        </p>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        {PERIODICIDADES.map(p => (
          <Card key={p.id} style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--blue-bg)',
                            border: '1px solid var(--blue-border)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Calendar size={15} style={{ color: 'var(--blue)' }} />
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700,
                            color: 'var(--text-0)', margin: 0 }}>{p.label}</p>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)', margin: 0 }}>
                  {p.meses} {p.meses === 1 ? 'mes' : 'meses'}
                </p>
              </div>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5, margin: 0 }}>
              {DESCRIPCIONES[p.id]}
            </p>
          </Card>
        ))}
      </div>
    </div>
  )
}
