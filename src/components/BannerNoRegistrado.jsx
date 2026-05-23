/**
 * Banner que avisa cuando el manager logueado existe en NoofitPro pero
 * NO tiene fila en `manager_config` de Round. Sin ese registro:
 *  - Las llamadas directas a Round vía proxy backend funcionan
 *  - Pero el manager NO tiene Odoo desplegado ni catálogos
 *  - Las menús se ocultan correctamente (vía useOdooStatus)
 *
 * El usuario suele caer aquí porque:
 *  - Es un manager nuevo dado de alta en NoofitPro pero aún no en Round
 *  - O es un manager de prueba que comparte ecosistema sin estar registrado
 *
 * Mostramos un banner persistente arriba para que entienda por qué tantos
 * sitios no funcionan ("cliente no encontrado", etc.).
 */
import { AlertTriangle } from 'lucide-react'
import { useOdooStatus } from '../hooks/useOdooStatus'

export default function BannerNoRegistrado() {
  const { notRegistered } = useOdooStatus()
  if (!notRegistered) return null
  return (
    <div role="region" aria-label="Manager no registrado"
         style={{
           padding: '10px 16px',
           background: 'rgba(251,191,36,0.10)',
           borderBottom: '1px solid rgba(251,191,36,0.35)',
           display: 'flex', alignItems: 'center', gap: 12,
         }}>
      <AlertTriangle size={16} style={{ color: 'var(--amber)', flexShrink: 0 }} aria-hidden="true" />
      <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--text-1)', lineHeight: 1.5 }}>
        <strong>Tu manager aún no está registrado en Round.</strong>{' '}
        Algunas funcionalidades pueden no funcionar (p.ej. el listado de
        clientes puede estar vacío). Contacta con Wiemspro para completar
        el alta de tu manager.
      </div>
    </div>
  )
}
