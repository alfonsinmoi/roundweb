import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, Users, CalendarDays, Activity, UserCheck,
  Dumbbell, Zap, Cpu, BarChart3, LogOut
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

const items = [
  { to: '/dashboard',      icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/clientes',       icon: Users,            label: 'Clientes' },
  { to: '/clases',         icon: CalendarDays,     label: 'Clases' },
  { to: '/actividades',    icon: Activity,         label: 'Actividades' },
  { to: '/monitores',      icon: UserCheck,        label: 'Monitores' },
  { to: '/entrenamientos', icon: Dumbbell,         label: 'Entrenamientos' },
  { to: '/ejercicios',     icon: Zap,              label: 'Ejercicios' },
  { to: '/dispositivos',   icon: Cpu,              label: 'Dispositivos' },
  { to: '/listados',       icon: BarChart3,        label: 'Listados' },
]

export default function Sidebar() {
  const { logout, user } = useAuth()
  const { pathname } = useLocation()

  return (
    <aside style={{
      display: 'flex', flexDirection: 'column', height: '100%', width: 240, flexShrink: 0,
      background: 'var(--bg-1)', borderRight: '1px solid var(--line)', padding: '28px 0',
    }}>

      {/* Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '0 28px', marginBottom: 40 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 12,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'linear-gradient(135deg, #2DD4A8, #1A9A7A)',
        }}>
          <Zap size={18} color="#fff" fill="#fff" />
        </div>
        <span style={{ fontFamily: 'Outfit', fontSize: 20, fontWeight: 700, color: 'var(--text-0)' }}>Round</span>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {items.map(({ to, icon: Icon, label }) => {
          const active = pathname === to || (to !== '/dashboard' && pathname.startsWith(to))
          return (
            <NavLink key={to} to={to}
                     style={{
                       display: 'flex', alignItems: 'center', gap: 14,
                       padding: '12px 16px', borderRadius: 14,
                       fontSize: 14, fontWeight: 500, textDecoration: 'none',
                       color: active ? 'var(--green)' : 'var(--text-2)',
                       background: active ? 'var(--green-bg)' : 'transparent',
                       transition: 'all 0.1s ease',
                     }}
                     onMouseEnter={e => { if (!active) { e.currentTarget.style.background = 'var(--bg-3)'; e.currentTarget.style.color = 'var(--text-0)' } }}
                     onMouseLeave={e => { if (!active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-2)' } }}>
              <Icon size={19} strokeWidth={active ? 2 : 1.6} />
              {label}
            </NavLink>
          )
        })}
      </nav>

      {/* Footer */}
      <div style={{ padding: '0 16px', marginTop: 16, paddingTop: 20, borderTop: '1px solid var(--line)' }}>
        {user && (
          <div style={{ padding: '0 16px', marginBottom: 16 }}>
            <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user.nombre} {user.apellidos}
            </p>
            <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user.email}
            </p>
          </div>
        )}
        <button onClick={logout}
                style={{
                  display: 'flex', alignItems: 'center', gap: 14, width: '100%',
                  padding: '12px 16px', borderRadius: 14,
                  fontSize: 14, fontWeight: 500, cursor: 'pointer',
                  color: 'var(--text-3)', background: 'transparent', border: 'none',
                  transition: 'all 0.1s',
                }}
                onMouseEnter={e => { e.currentTarget.style.color = 'var(--red)'; e.currentTarget.style.background = 'rgba(248,113,133,0.05)' }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-3)'; e.currentTarget.style.background = 'transparent' }}>
          <LogOut size={19} strokeWidth={1.6} />
          Cerrar sesión
        </button>
      </div>
    </aside>
  )
}
