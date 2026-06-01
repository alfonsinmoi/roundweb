// Badge fijo top-right que muestra el centro en el que el usuario está
// trabajando. NO permite cambiar — para cambiar de centro hay que hacer
// logout y volver a entrar. Esto evita errores como editar datos del
// centro equivocado por accidente.
//
// Datos:
//   - Trainer id de la sesión actual (de getRoundIdentity).
//   - nombre_centro desde centro_contacto (refresco cada 60s).
//   - Si el usuario es manager sin impersonar trainer → "Todos los centros".
import { useEffect, useMemo, useState } from 'react'
import { Building2 } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { getRoundIdentity, centrosList } from '../utils/configApi'

const POLL_MS = 60_000

export default function CentroBadge() {
  const { user } = useAuth()
  const identity = useMemo(() => getRoundIdentity(user), [user])
  const [centros, setCentros] = useState([])

  useEffect(() => {
    if (!identity?.managerId) return
    const load = () => centrosList(identity).then(setCentros).catch(() => {})
    load()
    const t = setInterval(() => { if (!document.hidden) load() }, POLL_MS)
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus) }
  }, [identity?.managerId])

  if (!identity?.managerId) return null

  const tid = identity.trainerId ? String(identity.trainerId) : null
  let nombre = 'Todos los centros'
  if (tid) {
    const c = centros.find(x => String(x.id_trainer) === tid)
    nombre = c?.nombre_centro
      || (identity.trainerName && identity.trainerName !== `Centro ${tid}` ? identity.trainerName : null)
      || `Centro ${tid}`
  }

  return (
    <div role="status"
         aria-label={`Centro activo: ${nombre}`}
         title="Para cambiar de centro, cierra sesión y vuelve a entrar."
         style={{
           display: 'inline-flex', alignItems: 'center', gap: 10,
           padding: '8px 16px', borderRadius: 14,
           background: tid ? 'var(--green-bg)' : 'var(--bg-2)',
           border: `1.5px solid ${tid ? 'var(--green)' : 'var(--line)'}`,
           color: tid ? 'var(--green)' : 'var(--text-2)',
           fontFamily: 'Outfit, var(--font-display), sans-serif',
           fontWeight: 700, fontSize: 16, lineHeight: 1.1,
           letterSpacing: '0.01em',
           userSelect: 'none', cursor: 'default',
         }}>
      <Building2 size={18} aria-hidden="true" />
      <span style={{ maxWidth: 260, overflow: 'hidden',
                     textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {nombre}
      </span>
    </div>
  )
}
