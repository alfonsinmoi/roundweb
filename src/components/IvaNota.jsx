import { Percent } from 'lucide-react'

/**
 * Chip informativo para las pantallas de Económico: aclara que las cifras
 * mostradas son el IMPORTE TOTAL (IVA incluido), no la base imponible. Evita
 * descuidos al leer totales de facturación/recibos.
 */
export default function IvaNota({ texto = 'Importes con IVA incluido (total)', style }) {
  return (
    <span
      title="Todas las cifras económicas se muestran como importe TOTAL, con el IVA ya incluido (no es la base imponible)."
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '3px 10px', borderRadius: 999,
        background: 'rgba(45,212,168,0.10)', border: '1px solid rgba(45,212,168,0.30)',
        fontSize: 11.5, fontWeight: 600, color: 'var(--green)', whiteSpace: 'nowrap',
        ...style,
      }}>
      <Percent size={12} aria-hidden="true" /> {texto}
    </span>
  )
}
