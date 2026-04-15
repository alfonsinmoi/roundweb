import { Link, useLocation } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { navItems } from '../config/routes'

const detailRoutes = {
  '/clientes/nuevo': 'Nuevo cliente',
}

function resolveLabel(segment, fullPath) {
  // Check static detail routes
  if (detailRoutes[fullPath]) return detailRoutes[fullPath]

  // Check nav items
  const nav = navItems.find(n => n.to === `/${segment}`)
  if (nav) return nav.label

  // Dynamic ID segments — show as "Detalle"
  if (/^\d+$/.test(segment)) return 'Detalle'

  return segment.charAt(0).toUpperCase() + segment.slice(1)
}

export default function Breadcrumbs() {
  const { pathname } = useLocation()
  const segments = pathname.split('/').filter(Boolean)

  // Don't show breadcrumbs on top-level pages (dashboard, clientes, etc.)
  if (segments.length <= 1) return null

  const crumbs = segments.map((seg, i) => {
    const path = '/' + segments.slice(0, i + 1).join('/')
    const label = resolveLabel(seg, path)
    const isLast = i === segments.length - 1
    return { path, label, isLast }
  })

  return (
    <nav aria-label="Breadcrumbs" style={{ marginBottom: 20 }}>
      <ol style={{ display: 'flex', alignItems: 'center', gap: 6, listStyle: 'none', padding: 0, margin: 0, fontSize: 13 }}>
        {crumbs.map(({ path, label, isLast }) => (
          <li key={path} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {!isLast ? (
              <>
                <Link to={path} className="nav-link" style={{ color: 'var(--text-3)', textDecoration: 'none', padding: '6px 4px', minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>
                  {label}
                </Link>
                <ChevronRight size={12} style={{ color: 'var(--text-3)' }} aria-hidden="true" />
              </>
            ) : (
              <span aria-current="page" style={{ color: 'var(--text-1)', fontWeight: 500 }}>{label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}
