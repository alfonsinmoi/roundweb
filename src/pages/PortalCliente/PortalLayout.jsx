import { useState, useEffect } from 'react'
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Clock, User, Calendar, Trophy, Award, Dumbbell, BarChart3,
  LogOut, Menu, X, PanelLeftClose, PanelLeftOpen, Zap,
} from 'lucide-react'
import { usePortalAuth } from '../../contexts/PortalAuthContext'
import ThemeToggle from '../../components/ThemeToggle'


// Layout del portal cliente. Estructura inspirada en la web NoofitPro admin:
//  - Desktop (>=900px): sidebar fijo a la izquierda, colapsable (64px ↔ 240px).
//  - Móvil   (<900px) : sidebar oculto. Hamburger en header lo abre como
//                       drawer fullscreen-height con backdrop.
export default function PortalLayout() {
  const { isAuthed, cliente, logout } = usePortalAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  // Estado del sidebar (persistido en localStorage para no resetear al refrescar)
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('round.portal.sb_collapsed') === '1' } catch { return false }
  })
  useEffect(() => {
    try { localStorage.setItem('round.portal.sb_collapsed', collapsed ? '1' : '0') } catch { /* */ }
  }, [collapsed])

  // Drawer móvil
  const [drawerOpen, setDrawerOpen] = useState(false)
  // Cerrar drawer al cambiar de ruta
  useEffect(() => { setDrawerOpen(false) }, [pathname])

  // Título de la pestaña distinto del admin (Round — Gestión Fitness)
  useEffect(() => {
    const prev = document.title
    document.title = 'Mi portal · Round'
    return () => { document.title = prev }
  }, [])

  if (!isAuthed) return <Navigate to="/portal/login" replace />

  const esTrabajador = !!cliente?.es_trabajador

  // Tabs (Fichar PRIMERO si trabajador, después Mis jornadas, Ausencias, …)
  const tabs = [
    esTrabajador && { to: '/portal/fichar',         icon: Clock,     label: 'Fichar' },
    esTrabajador && { to: '/portal/mis-jornadas',   icon: BarChart3, label: 'Mis jornadas' },
    esTrabajador && { to: '/portal/ausencias',      icon: Calendar,  label: 'Ausencias' },
                    { to: '/portal/entrenamientos', icon: Dumbbell,  label: 'Entrenamientos' },
                    { to: '/portal/reservas',       icon: Calendar,  label: 'Reservas' },
                    { to: '/portal/retos',          icon: Trophy,    label: 'Retos' },
                    { to: '/portal/logros',         icon: Award,     label: 'Logros' },
                    { to: '/portal/perfil',         icon: User,      label: 'Perfil' },
  ].filter(Boolean)

  function doLogout() {
    logout()
    navigate('/portal/login', { replace: true })
  }

  return (
    <div style={{
      // body global lleva overflow:hidden → el scroll vive dentro del <main>.
      // Por eso aquí usamos height fijo + overflow:hidden (NO minHeight).
      height: '100vh', height: '100dvh',
      overflow: 'hidden',
      display: 'flex',
      background: 'var(--bg-0)',
      color: 'var(--text-0)',
    }}>
      {/* ── Sidebar desktop ─────────────────────────────────────────────── */}
      <PortalSidebar
        className="portal-sb-desktop"
        tabs={tabs}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed(c => !c)}
        cliente={cliente}
        onLogout={doLogout}
        showCollapseBtn
      />

      {/* ── Drawer móvil ────────────────────────────────────────────────── */}
      {drawerOpen && (
        <>
          <div onClick={() => setDrawerOpen(false)}
               style={{
                 position: 'fixed', inset: 0, zIndex: 30,
                 background: 'rgba(0,0,0,0.55)',
               }} />
          <PortalSidebar
            className="portal-sb-mobile"
            tabs={tabs}
            collapsed={false}
            cliente={cliente}
            onLogout={doLogout}
            onClose={() => setDrawerOpen(false)}
          />
        </>
      )}

      {/* ── Columna derecha (header sin scroll + main con scroll) ──────── */}
      <div style={{
        display: 'flex', flexDirection: 'column',
        flex: 1, minWidth: 0,
        overflow: 'hidden',
      }}>
        <header className="portal-header" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px',
          background: 'var(--bg-1)',
          borderBottom: '1px solid var(--line)',
          flexShrink: 0,
        }}>
          {/* Hamburger sólo en móvil */}
          <button onClick={() => setDrawerOpen(true)}
                  aria-label="Abrir menú"
                  className="portal-hamburger"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 36, height: 36, borderRadius: 10,
                    background: 'var(--bg-2)', border: '1px solid var(--line)',
                    color: 'var(--text-1)', cursor: 'pointer',
                  }}>
            <Menu size={18} />
          </button>

          <div className="portal-header-title" style={{ minWidth: 0, flex: 1 }}>
            <p style={{
              margin: 0, fontSize: 11, color: 'var(--text-3)',
              textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600,
            }}>
              Round · tu portal
            </p>
            <p style={{
              margin: '2px 0 0', fontSize: 14, fontWeight: 600,
              color: 'var(--text-0)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              maxWidth: 320,
            }}>
              {cliente?.nombre_completo || cliente?.email}
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ThemeToggle size="sm" />
          </div>
        </header>

        <main style={{
          flex: 1,
          overflowY: 'auto',          // ← área scrolleable única
          overflowX: 'hidden',
          padding: '12px 12px 24px',
          boxSizing: 'border-box',
        }}>
          <div style={{ maxWidth: 960, width: '100%', margin: '0 auto' }}>
            <Outlet />
          </div>
        </main>
      </div>

      {/* ── CSS responsive ─────────────────────────────────────────────── */}
      <style>{`
        .portal-sb-desktop { display: none; }
        .portal-sb-mobile {
          display: flex !important;
          position: fixed; top: 0; bottom: 0; left: 0;
          width: 80vw; max-width: 320px;
          z-index: 40;
          box-shadow: 0 0 32px rgba(0,0,0,0.4);
        }
        .portal-hamburger { display: flex; }
        @media (min-width: 900px) {
          .portal-sb-desktop { display: flex; }
          .portal-hamburger  { display: none; }
          .portal-header-title { padding-left: 4px; }
        }
      `}</style>
    </div>
  )
}


// ═══════════════════════════════════════════════════════════════════════════
// Sidebar (compartido entre desktop fijo y móvil drawer)
// ═══════════════════════════════════════════════════════════════════════════

function PortalSidebar({
  className = '', tabs, collapsed, onToggleCollapse,
  cliente, onLogout, onClose, showCollapseBtn = false,
}) {
  return (
    <aside aria-label="Navegación del portal"
           className={className}
           style={{
             flexDirection: 'column',
             width: collapsed ? 64 : 240,
             flexShrink: 0,
             background: 'var(--bg-1)',
             borderRight: '1px solid var(--line)',
             transition: 'width 0.2s ease',
             height: '100%',         // padre tiene overflow:hidden + height
             overflow: 'hidden',
           }}>
      {/* ── Brand + collapse / close ───────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center',
        justifyContent: collapsed ? 'center' : 'space-between',
        padding: collapsed ? '20px 12px' : '20px 16px 20px 20px',
        gap: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 12, flexShrink: 0,
            background: 'var(--gradient-primary, linear-gradient(135deg,#10b981,#059669))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Zap size={18} color="#fff" fill="#fff" />
          </div>
          {!collapsed && (
            <span style={{
              fontFamily: 'var(--font-display, Outfit)',
              fontSize: 19, fontWeight: 700, color: 'var(--text-0)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              Round
            </span>
          )}
        </div>

        {showCollapseBtn && (
          <button onClick={onToggleCollapse}
                  aria-label={collapsed ? 'Expandir menú' : 'Colapsar menú'}
                  title={collapsed ? 'Expandir' : 'Colapsar'}
                  style={iconBtn}>
            {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
          </button>
        )}
        {onClose && (
          <button onClick={onClose} aria-label="Cerrar menú" style={iconBtn}>
            <X size={16} />
          </button>
        )}
      </div>

      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <nav style={{
        flex: 1,
        padding: '0 10px',
        display: 'flex', flexDirection: 'column', gap: 2,
        overflowY: 'auto',
      }}>
        {tabs.map(t => (
          <SidebarItem key={t.to} {...t} collapsed={collapsed} />
        ))}
      </nav>

      {/* ── Footer: usuario + logout ───────────────────────────────────── */}
      <div style={{
        padding: collapsed ? '12px 10px' : '12px 14px',
        borderTop: '1px solid var(--line)',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        {!collapsed && cliente && (
          <div style={{ minWidth: 0 }}>
            <p style={{
              margin: 0, fontSize: 12, fontWeight: 600, color: 'var(--text-1)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }} title={cliente.nombre_completo}>
              {cliente.nombre_completo || '—'}
            </p>
            <p style={{
              margin: '2px 0 0', fontSize: 11, color: 'var(--text-3)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }} title={cliente.email}>
              {cliente.email}
            </p>
          </div>
        )}
        <button onClick={onLogout}
                title="Cerrar sesión"
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  padding: collapsed ? '10px 0' : '10px 12px',
                  borderRadius: 10, border: '1px solid transparent',
                  background: 'transparent', cursor: 'pointer',
                  color: 'var(--red, #f87171)', fontSize: 13, fontWeight: 600,
                }}>
          <LogOut size={16} />
          {!collapsed && 'Salir'}
        </button>
      </div>
    </aside>
  )
}


function SidebarItem({ to, icon: Icon, label, collapsed }) {
  return (
    <NavLink to={to}
             title={collapsed ? label : undefined}
             style={({ isActive }) => ({
               display: 'flex', alignItems: 'center',
               gap: collapsed ? 0 : 14,
               padding: collapsed ? '12px 0' : '11px 14px',
               justifyContent: collapsed ? 'center' : 'flex-start',
               borderRadius: 12,
               fontSize: 14, fontWeight: 500,
               textDecoration: 'none',
               color: isActive ? 'var(--green, #10b981)' : 'var(--text-2)',
               background: isActive ? 'var(--green-bg, rgba(16,185,129,0.10))' : 'transparent',
               transition: 'background 0.1s, color 0.1s',
             })}>
      {({ isActive }) => (
        <>
          <Icon size={18} strokeWidth={isActive ? 2.2 : 1.7} aria-hidden="true" />
          {!collapsed && label}
        </>
      )}
    </NavLink>
  )
}


const iconBtn = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 32, height: 32, borderRadius: 9, flexShrink: 0,
  background: 'var(--bg-2)', border: '1px solid var(--line)',
  cursor: 'pointer', color: 'var(--text-2)',
}
