import { Link, useLocation } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { navItems } from '../config/routes'
import { useBreadcrumbsExtra } from '../contexts/BreadcrumbsContext'

const detailRoutes = {
  '/clientes/nuevo': 'Nuevo cliente',
}

function resolveLabel(segment, fullPath) {
  if (detailRoutes[fullPath]) return detailRoutes[fullPath]
  const nav = navItems.find(n => n.to === `/${segment}`)
  if (nav) return nav.label
  if (/^\d+$/.test(segment)) return 'Detalle'
  return segment.charAt(0).toUpperCase() + segment.slice(1)
}

export default function Breadcrumbs() {
  const { pathname } = useLocation()
  const extra = useBreadcrumbsExtra()
  const segments = pathname.split('/').filter(Boolean)

  // No mostrar en páginas de primer nivel (dashboard, clientes, …).
  if (segments.length <= 1) return null

  // Crumbs de la RUTA (navegables por <Link>) + crumbs EXTRA que publica la
  // página (p.ej. su pestaña activa) con un onClick.
  const routeCrumbs = segments.map((seg, i) => {
    const to = '/' + segments.slice(0, i + 1).join('/')
    return { key: 'r:' + to, to, label: resolveLabel(seg, to) }
  })
  const extraCrumbs = (extra || []).map((c, i) => ({
    key: 'e:' + i + ':' + c.label, onClick: c.onClick, label: c.label,
  }))
  const all = [...routeCrumbs, ...extraCrumbs]

  const base = {
    padding: '6px 4px', minHeight: 44, display: 'inline-flex', alignItems: 'center',
    background: 'none', border: 'none', cursor: 'pointer', font: 'inherit', fontSize: 13,
    textDecoration: 'none',
  }
  const linkStyle = { ...base, color: 'var(--text-3)' }
  const currentStyle = { ...base, color: 'var(--text-1)', fontWeight: 600 }

  return (
    <nav aria-label="Breadcrumbs" style={{ marginBottom: 20 }}>
      <ol style={{ display: 'flex', alignItems: 'center', gap: 6, listStyle: 'none',
                   padding: 0, margin: 0, flexWrap: 'wrap' }}>
        {all.map((c, i) => {
          const isLast = i === all.length - 1
          const style = isLast ? currentStyle : linkStyle
          return (
            <li key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {c.to ? (
                <Link to={c.to} className="nav-link" style={style}
                      aria-current={isLast ? 'page' : undefined}>{c.label}</Link>
              ) : (
                <button type="button" className="nav-link" onClick={c.onClick} style={style}
                        aria-current={isLast ? 'page' : undefined}>{c.label}</button>
              )}
              {!isLast && <ChevronRight size={12} style={{ color: 'var(--text-3)', flexShrink: 0 }} aria-hidden="true" />}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
