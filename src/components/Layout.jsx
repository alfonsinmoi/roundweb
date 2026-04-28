import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import Header from './Header'
import Breadcrumbs from './Breadcrumbs'
import ErrorBoundary from './ErrorBoundary'

export default function Layout() {
  const { pathname } = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--bg-0)' }}>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(0,0,0,0.6)' }}
             onClick={() => setSidebarOpen(false)} aria-hidden="true" />
      )}

      {/* Sidebar */}
      <div className="sidebar-container" data-open={sidebarOpen || undefined}>
        <Sidebar
          onNavigate={() => setSidebarOpen(false)}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(c => !c)}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, overflow: 'hidden' }}>
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <main style={{
          flex: 1, overflowY: 'auto',
          // No top padding on the scroll container — content pages add their
          // own top spacing. This way, `position: sticky; top: 0` inside a
          // page actually reaches the TOP of the scroll viewport, so content
          // scrolling underneath is fully hidden behind it.
          padding: '0 clamp(20px, 4vw, 48px) clamp(20px, 4vw, 48px)',
        }} key={pathname}>
          <div className="anim-enter" style={{ maxWidth: 1200, paddingTop: 'clamp(20px, 4vw, 48px)' }}>
            <Breadcrumbs />
            <ErrorBoundary key={pathname}>
              <Outlet />
            </ErrorBoundary>
          </div>
        </main>
      </div>
    </div>
  )
}
