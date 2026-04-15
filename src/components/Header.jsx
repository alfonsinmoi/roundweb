import { useLocation } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { navItems } from '../config/routes'

export default function Header({ onMenuClick }) {
  const { pathname } = useLocation()
  const title = navItems.find(({ to }) => pathname.startsWith(to))?.label ?? 'Round'

  return (
    <header style={{
      display: 'flex', alignItems: 'center', height: 64,
      padding: '0 clamp(20px, 4vw, 48px)', flexShrink: 0,
      borderBottom: '1px solid var(--line)', gap: 16,
    }}>
      <button onClick={onMenuClick}
              aria-label="Abrir menú de navegación"
              className="mobile-menu-btn"
              style={{
                display: 'none', padding: 8, borderRadius: 10, cursor: 'pointer',
                background: 'var(--bg-2)', border: '1px solid var(--line)', color: 'var(--text-2)',
              }}>
        <Menu size={20} aria-hidden="true" />
      </button>
      <h1 style={{ fontFamily: 'Outfit', fontSize: 20, fontWeight: 600, color: 'var(--text-0)' }}>
        {title}
      </h1>
    </header>
  )
}
