import { NavLink, useLocation } from 'react-router-dom'
import { Zap, LogOut } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { navItems } from '../config/routes'

export default function Sidebar({ onNavigate }) {
  const { logout, user } = useAuth()
  const { pathname } = useLocation()

  return (
    <aside aria-label="Navegación principal" style={{
      display: 'flex', flexDirection: 'column', height: '100%', width: 240, flexShrink: 0,
      background: 'var(--bg-1)', borderRight: '1px solid var(--line)', padding: '28px 0',
    }}>
      {/* Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '0 28px', marginBottom: 40 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 12,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--gradient-primary)',
        }}>
          <Zap size={18} color="#fff" fill="#fff" aria-hidden="true" />
        </div>
        <span style={{ fontFamily: 'Outfit', fontSize: 20, fontWeight: 700, color: 'var(--text-0)' }}>Round</span>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {navItems.map(({ to, icon: Icon, label }) => {
          const active = pathname === to || (to !== '/dashboard' && pathname.startsWith(to))
          return (
            <NavLink key={to} to={to}
                     onClick={onNavigate}
                     aria-current={active ? 'page' : undefined}
                     className="nav-link"
                     style={{
                       display: 'flex', alignItems: 'center', gap: 14,
                       padding: '12px 16px', borderRadius: 14,
                       fontSize: 14, fontWeight: 500, textDecoration: 'none',
                       color: active ? 'var(--green)' : 'var(--text-2)',
                       background: active ? 'var(--green-bg)' : 'transparent',
                       transition: 'all 0.1s ease',
                     }}>
              <Icon size={19} strokeWidth={active ? 2 : 1.6} aria-hidden="true" />
              {label}
            </NavLink>
          )
        })}
      </nav>

      {/* Footer */}
      <div style={{ padding: '0 16px', marginTop: 16, paddingTop: 20, borderTop: '1px solid var(--line)' }}>
        {user && (
          <div style={{ padding: '0 16px', marginBottom: 16 }}>
            <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
               title={`${user.nombre} ${user.apellidos}`}>
              {user.nombre} {user.apellidos}
            </p>
            <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
               title={user.email}>
              {user.email}
            </p>
          </div>
        )}
        <button onClick={logout}
                aria-label="Cerrar sesión"
                className="nav-link"
                style={{
                  display: 'flex', alignItems: 'center', gap: 14, width: '100%',
                  padding: '12px 16px', borderRadius: 14,
                  fontSize: 14, fontWeight: 500, cursor: 'pointer',
                  color: 'var(--text-3)', background: 'transparent', border: 'none',
                  transition: 'all 0.1s',
                }}>
          <LogOut size={19} strokeWidth={1.6} aria-hidden="true" />
          Cerrar sesión
        </button>
      </div>
    </aside>
  )
}
