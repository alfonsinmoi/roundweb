import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { Zap, LogOut, Settings, ChevronDown, ChevronRight, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { navItems, configItems } from '../config/routes'

export default function Sidebar({ onNavigate, collapsed, onToggleCollapse }) {
  const { logout, user } = useAuth()
  const { pathname } = useLocation()
  const [configOpen, setConfigOpen] = useState(true)

  const configActive = configItems.some(i => pathname === i.to || pathname.startsWith(i.to))

  const NavItem = ({ to, icon: Icon, label }) => {
    const active = pathname === to || (to !== '/dashboard' && pathname.startsWith(to))
    return (
      <NavLink
        to={to}
        onClick={onNavigate}
        aria-current={active ? 'page' : undefined}
        title={collapsed ? label : undefined}
        className="nav-link"
        style={{
          display: 'flex', alignItems: 'center', gap: collapsed ? 0 : 14,
          padding: collapsed ? '12px 0' : '12px 16px',
          justifyContent: collapsed ? 'center' : 'flex-start',
          borderRadius: 14, fontSize: 14, fontWeight: 500, textDecoration: 'none',
          color: active ? 'var(--green)' : 'var(--text-2)',
          background: active ? 'var(--green-bg)' : 'transparent',
          transition: 'all 0.1s ease',
        }}
      >
        <Icon size={19} strokeWidth={active ? 2 : 1.6} aria-hidden="true" />
        {!collapsed && label}
      </NavLink>
    )
  }

  return (
    <aside
      aria-label="Navegación principal"
      style={{
        display: 'flex', flexDirection: 'column', height: '100%',
        width: collapsed ? 64 : 240,
        flexShrink: 0,
        background: 'var(--bg-1)', borderRight: '1px solid var(--line)',
        padding: '28px 0',
        transition: 'width 0.2s ease',
        overflow: 'hidden',
      }}
    >
      {/* Brand + toggle */}
      <div style={{
        display: 'flex', alignItems: 'center',
        justifyContent: collapsed ? 'center' : 'space-between',
        padding: collapsed ? '0 12px' : '0 16px 0 28px',
        marginBottom: 40, gap: 8,
      }}>
        {!collapsed && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 12, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--gradient-primary)',
            }}>
              <Zap size={18} color="#fff" fill="#fff" aria-hidden="true" />
            </div>
            <span style={{ fontFamily: 'Outfit', fontSize: 20, fontWeight: 700, color: 'var(--text-0)', whiteSpace: 'nowrap' }}>Round</span>
          </div>
        )}
        {collapsed && (
          <div style={{
            width: 40, height: 40, borderRadius: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--gradient-primary)',
          }}>
            <Zap size={18} color="#fff" fill="#fff" aria-hidden="true" />
          </div>
        )}
        <button
          onClick={onToggleCollapse}
          title={collapsed ? 'Expandir menú' : 'Colapsar menú'}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 32, height: 32, borderRadius: 9, flexShrink: 0,
            background: 'var(--bg-3)', border: '1px solid var(--line)',
            cursor: 'pointer', color: 'var(--text-3)',
            ...(collapsed && { marginTop: 8, width: 40, height: 32 }),
          }}
        >
          {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
        </button>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '0 10px', display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto', overflowX: 'hidden' }}>
        {navItems.map(item => <NavItem key={item.to} {...item} />)}

        {/* Configuración group */}
        <div style={{ marginTop: 8 }}>
          {collapsed ? (
            // Collapsed: show Settings icon, active highlight if any config route is active
            <div title="Configuración" style={{
              display: 'flex', justifyContent: 'center', padding: '12px 0',
              borderRadius: 14,
              color: configActive ? 'var(--green)' : 'var(--text-3)',
              background: configActive ? 'var(--green-bg)' : 'transparent',
            }}>
              <Settings size={19} strokeWidth={1.6} aria-hidden="true" />
            </div>
          ) : (
            <>
              <button
                onClick={() => setConfigOpen(o => !o)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 14,
                  width: '100%', padding: '10px 16px', borderRadius: 14,
                  fontSize: 13, fontWeight: 600, textTransform: 'uppercase',
                  letterSpacing: '0.05em', cursor: 'pointer',
                  background: 'none', border: 'none',
                  color: configActive ? 'var(--green)' : 'var(--text-3)',
                  transition: 'color 0.1s',
                }}
              >
                <Settings size={15} aria-hidden="true" />
                <span style={{ flex: 1, textAlign: 'left' }}>Configuración</span>
                {configOpen
                  ? <ChevronDown size={13} />
                  : <ChevronRight size={13} />}
              </button>
              {configOpen && (
                <div style={{ paddingLeft: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {configItems.map(item => <NavItem key={item.to} {...item} />)}
                </div>
              )}
            </>
          )}
        </div>
      </nav>

      {/* Footer */}
      <div style={{ padding: '0 10px', marginTop: 16, paddingTop: 20, borderTop: '1px solid var(--line)' }}>
        {user && !collapsed && (
          <div style={{ padding: '0 16px', marginBottom: 12 }}>
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
        <button
          onClick={logout}
          aria-label="Cerrar sesión"
          title={collapsed ? 'Cerrar sesión' : undefined}
          className="nav-link"
          style={{
            display: 'flex', alignItems: 'center', gap: collapsed ? 0 : 14,
            justifyContent: collapsed ? 'center' : 'flex-start',
            width: '100%', padding: collapsed ? '12px 0' : '12px 16px', borderRadius: 14,
            fontSize: 14, fontWeight: 500, cursor: 'pointer',
            color: 'var(--text-3)', background: 'transparent', border: 'none',
            transition: 'all 0.1s',
          }}
        >
          <LogOut size={19} strokeWidth={1.6} aria-hidden="true" />
          {!collapsed && 'Cerrar sesión'}
        </button>
      </div>
    </aside>
  )
}
