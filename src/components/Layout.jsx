import { useState, useRef, useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import Header from './Header'
import Breadcrumbs from './Breadcrumbs'
import ErrorBoundary from './ErrorBoundary'
import BannerNuevosClientes from './BannerNuevosClientes'
import BannerNoRegistrado from './BannerNoRegistrado'
import NotasBanner from './notas/NotasBanner'
import BannerTrimestre from './BannerTrimestre'
import { prefetchPopularRoutes } from '../utils/prefetch'
import { useTrainerFilter } from '../contexts/TrainerFilterContext'
import { invalidateCache } from '../utils/api'

export default function Layout() {
  const { pathname } = useLocation()
  const { selectedTrainerId } = useTrainerFilter()
  // Prefetch en idle de chunks + datos de las rutas más visitadas
  // (clientes, crm, clases, cuotas) → el primer click al menú es instantáneo.
  useEffect(() => { prefetchPopularRoutes() }, [])
  // Invalidar caches al cambiar el filtro para que los datos se recarguen
  useEffect(() => {
    invalidateCache()    // sin argumento = clear all
  }, [selectedTrainerId])
  const [sidebarOpen, setSidebarOpen] = useState(false)
  // pinned: usuario forzó expandir/colapsar manualmente; sobreescribe hover.
  const [pinned, setPinned] = useState(false)
  const [hovering, setHovering] = useState(false)
  const hideTimeoutRef = useRef(null)

  // Sidebar visualmente expandida si: pinned o hovering.
  const expanded = pinned || hovering
  const collapsed = !expanded

  const handleEnter = () => {
    if (hideTimeoutRef.current) { clearTimeout(hideTimeoutRef.current); hideTimeoutRef.current = null }
    setHovering(true)
  }
  const handleLeave = () => {
    // pequeño delay para evitar parpadeos al salir un instante
    hideTimeoutRef.current = setTimeout(() => setHovering(false), 100)
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--bg-0)' }}>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(0,0,0,0.6)' }}
             onClick={() => setSidebarOpen(false)} aria-hidden="true" />
      )}

      {/* Sidebar */}
      <div className="sidebar-container" data-open={sidebarOpen || undefined}
           onMouseEnter={handleEnter}
           onMouseLeave={handleLeave}>
        <Sidebar
          onNavigate={() => {
            setSidebarOpen(false)
            setHovering(false)   // colapsa al hacer click en un item
            setPinned(false)
          }}
          collapsed={collapsed}
          onToggleCollapse={() => setPinned(p => !p)}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, overflow: 'hidden' }}>
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <BannerNoRegistrado />
        <BannerTrimestre />
        <NotasBanner />
        <BannerNuevosClientes />
        <main style={{
          flex: 1, overflowY: 'auto',
          // No top padding on the scroll container — content pages add their
          // own top spacing. This way, `position: sticky; top: 0` inside a
          // page actually reaches the TOP of the scroll viewport, so content
          // scrolling underneath is fully hidden behind it.
          padding: '0 clamp(20px, 4vw, 48px) clamp(20px, 4vw, 48px)',
        }} key={pathname + ':' + (selectedTrainerId || 'all')}>
          <div className="anim-enter" style={{ maxWidth: 1500, paddingTop: 'clamp(20px, 4vw, 48px)' }}>
            <Breadcrumbs />
            <ErrorBoundary key={pathname + ':' + (selectedTrainerId || 'all')}>
              <Outlet />
            </ErrorBoundary>
          </div>
        </main>
      </div>
    </div>
  )
}
