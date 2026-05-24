import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Clock, User, Calendar, Trophy, Award, LogOut } from 'lucide-react'
import { usePortalAuth } from '../../contexts/PortalAuthContext'


export default function PortalLayout() {
  const { isAuthed, cliente, logout } = usePortalAuth()
  const { pathname } = useLocation()
  const navigate = useNavigate()

  if (!isAuthed) return <Navigate to="/portal/login" replace />

  const esTrabajador = !!cliente?.es_trabajador

  // Tabs: Fichar va PRIMERO si es trabajador. Si no, se omite.
  const tabs = [
    esTrabajador && { to: '/portal/fichar',   icon: Clock,    label: 'Fichar' },
                    { to: '/portal/perfil',   icon: User,     label: 'Perfil' },
                    { to: '/portal/reservas', icon: Calendar, label: 'Reservas' },
                    { to: '/portal/retos',    icon: Trophy,   label: 'Retos' },
                    { to: '/portal/logros',   icon: Award,    label: 'Logros' },
  ].filter(Boolean)

  return (
    <div style={{
      minHeight: '100vh', minHeight: '100dvh',
      display: 'flex', flexDirection: 'column',
      background: 'var(--bg-0, #0c0c0e)',
      color: 'var(--text-0)',
    }}>
      {/* ── Header ─────────────────────────────────────────────── */}
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px',
        background: 'var(--bg-1)',
        borderBottom: '1px solid var(--line)',
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <div style={{ minWidth: 0 }}>
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
            maxWidth: 240,
          }}>
            {cliente?.nombre_completo || cliente?.email}
          </p>
        </div>
        <button onClick={() => { logout(); navigate('/portal/login', { replace: true }) }}
                aria-label="Cerrar sesión"
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '8px 12px', borderRadius: 10,
                  background: 'var(--bg-3)', border: '1px solid var(--line)',
                  color: 'var(--text-2)', cursor: 'pointer', fontSize: 12,
                }}>
          <LogOut size={14} />
          <span className="hide-mobile" style={{ fontWeight: 500 }}>Salir</span>
        </button>
      </header>

      {/* ── Tabs desktop (≥640px) ──────────────────────────────── */}
      <nav role="tablist" className="portal-tabs-desktop" aria-label="Secciones">
        {tabs.map(t => {
          const active = pathname === t.to || (pathname === '/portal' && t === tabs[0])
          const Icon = t.icon
          return (
            <button key={t.to}
                    role="tab"
                    aria-selected={active}
                    onClick={() => navigate(t.to)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '12px 18px',
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: active ? 'var(--green)' : 'var(--text-2)',
                      fontWeight: active ? 600 : 500, fontSize: 14,
                      borderBottom: active ? '2px solid var(--green)' : '2px solid transparent',
                    }}>
              <Icon size={16} />
              {t.label}
            </button>
          )
        })}
      </nav>

      {/* ── Contenido ───────────────────────────────────────────── */}
      <main style={{
        flex: 1,
        padding: '12px 12px 88px',     // padding bottom para no chocar con bottom nav
        maxWidth: 760, width: '100%', margin: '0 auto',
        boxSizing: 'border-box',
      }}>
        <Outlet />
      </main>

      {/* ── Bottom tab bar (móvil) ─────────────────────────────── */}
      <nav role="tablist" className="portal-tabs-mobile" aria-label="Secciones">
        {tabs.map(t => {
          const active = pathname === t.to || (pathname === '/portal' && t === tabs[0])
          const Icon = t.icon
          return (
            <button key={t.to}
                    role="tab"
                    aria-selected={active}
                    onClick={() => navigate(t.to)}
                    style={{
                      flex: 1, display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center', gap: 3,
                      padding: '8px 4px',
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: active ? 'var(--green)' : 'var(--text-3)',
                    }}>
              <Icon size={20} strokeWidth={active ? 2.2 : 1.8} />
              <span style={{ fontSize: 10, fontWeight: active ? 700 : 500 }}>
                {t.label}
              </span>
            </button>
          )
        })}
      </nav>

      {/* CSS responsive (en lugar de hooks) */}
      <style>{`
        .portal-tabs-desktop {
          display: none;
        }
        .portal-tabs-mobile {
          display: flex;
          position: fixed; bottom: 0; left: 0; right: 0;
          background: var(--bg-1);
          border-top: 1px solid var(--line);
          z-index: 20;
          padding-bottom: env(safe-area-inset-bottom);
        }
        @media (min-width: 640px) {
          .portal-tabs-desktop {
            display: flex;
            justify-content: center;
            border-bottom: 1px solid var(--line);
            background: var(--bg-1);
            overflow-x: auto;
            position: sticky; top: 58px; z-index: 9;
          }
          .portal-tabs-mobile { display: none; }
          main { padding-bottom: 24px !important; }
        }
        .hide-mobile { display: none; }
        @media (min-width: 640px) {
          .hide-mobile { display: inline; }
        }
      `}</style>
    </div>
  )
}
