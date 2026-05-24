import { useState, useEffect, useRef } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import {
  Zap, LogOut, Settings, ChevronDown, ChevronRight,
  PanelLeftClose, PanelLeftOpen, QrCode, ChevronUp,
  ArrowLeftRight, Loader2, Eye, EyeOff, X, KeyRound,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { navItems, managerItems, configItems } from '../config/routes'
import { canAccessSection } from '../config/permissions'
import { useOdooStatus } from '../hooks/useOdooStatus'
import { useClaseEnCurso } from '../hooks/useClaseEnCurso'
import { formatHora } from '../utils/formatters'
import { Avatar } from './UI'
import { requestResetUsuarioWeb } from '../utils/authUsuarioApi'
import { useToast } from './Toast'
import { getEntrenadores } from '../utils/api'
import { prefetchRoute } from '../utils/prefetch'

// Filtra items del menú según los permisos del perfil del usuario web.
// Manager NoofitPro (kind != 'usuario_web') ve todo siempre.
function filterByPerms(items, user) {
  if (!user || user.kind !== 'usuario_web') return items
  const perfil = user.perfil
  return items
    .map(item => {
      if (!item.perm) return item
      if (item.children) {
        // Filtrar hijos primero
        const childrenAllowed = item.children.filter(c => !c.perm || canAccessSection(perfil, c.perm))
        if (!childrenAllowed.length) return null
        return { ...item, children: childrenAllowed }
      }
      return canAccessSection(perfil, item.perm) ? item : null
    })
    .filter(Boolean)
}

// Filtra items del menú por features del manager (Odoo desplegado o no).
// Items con `featureFlag` cuya feature esté a `false` se ocultan; los
// que no tienen `featureFlag` pasan tal cual. Si la feature no está
// definida en `features` (loading o error), se considera habilitada
// para no romper la navegación.
function filterByFeatures(items, features) {
  const isDisabled = (flag) => flag && features?.[flag] === false
  return items
    .map(item => {
      // Si el item tiene featureFlag y está disabled, lo ocultamos del
      // todo (aunque tenga hijos). Caso CRM con featureFlag='crm'.
      if (isDisabled(item.featureFlag)) return null
      if (item.children) {
        const childrenAllowed = item.children.filter(c => !isDisabled(c.featureFlag))
        if (!childrenAllowed.length) return null
        return { ...item, children: childrenAllowed }
      }
      return item
    })
    .filter(Boolean)
}

export default function Sidebar({ onNavigate, collapsed, onToggleCollapse }) {
  const { logout, user, loginAsTrainer, switchBackToManager, isImpersonating } = useAuth()
  const { pathname } = useLocation()
  const navigate     = useNavigate()
  const [configOpen, setConfigOpen] = useState(true)
  const claseEnCurso = useClaseEnCurso()
  const { features } = useOdooStatus()

  // Trainer switcher
  const [menuOpen,     setMenuOpen]     = useState(false)
  const [trainers,     setTrainers]     = useState([])
  const [loadingT,     setLoadingT]     = useState(false)
  const [errorT,       setErrorT]       = useState('')
  const menuRef = useRef(null)

  // Modal de contraseña
  const [selectedTrainer, setSelectedTrainer] = useState(null)  // trainer elegido
  const [password,        setPassword]        = useState('')
  const [showPass,        setShowPass]        = useState(false)
  const [loginError,      setLoginError]      = useState('')
  const [loginLoading,    setLoginLoading]    = useState(false)
  const passInputRef = useRef(null)

  const configActive = configItems.some(i => pathname === i.to || pathname.startsWith(i.to))

  // Cerrar al click fuera del dropdown (pero no si hay modal abierto)
  useEffect(() => {
    if (!menuOpen || selectedTrainer) return
    const handler = e => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen, selectedTrainer])

  // Cargar trainers al abrir (lazy, solo una vez)
  useEffect(() => {
    if (!menuOpen || trainers.length > 0 || loadingT) return
    setLoadingT(true)
    setErrorT('')
    getEntrenadores()
      .then(data => setTrainers(data ?? []))
      .catch(err => setErrorT(err.message ?? 'Error cargando trainers'))
      .finally(() => setLoadingT(false))
  }, [menuOpen]) // eslint-disable-line

  // Foco al input cuando se abre el modal de contraseña
  useEffect(() => {
    if (selectedTrainer) {
      setPassword('')
      setLoginError('')
      setShowPass(false)
      setTimeout(() => passInputRef.current?.focus(), 50)
    }
  }, [selectedTrainer])

  function openPasswordModal(trainer) {
    setSelectedTrainer(trainer)
  }

  function closePasswordModal() {
    setSelectedTrainer(null)
    setPassword('')
    setLoginError('')
  }

  async function handleLoginAsTrainer(e) {
    e.preventDefault()
    if (!password.trim()) { setLoginError('Introduce la contraseña'); return }
    setLoginLoading(true)
    setLoginError('')
    const result = await loginAsTrainer(selectedTrainer.email, password)
    setLoginLoading(false)
    if (!result.ok) {
      setLoginError(result.error ?? 'Credenciales incorrectas')
    } else {
      closePasswordModal()
      setMenuOpen(false)
      navigate('/dashboard')
    }
  }

  function handleSwitchBack() {
    switchBackToManager()
    setMenuOpen(false)
    navigate('/dashboard')
  }

  const NavItem = ({ to, icon: Icon, label, children }) => {
    // Si tiene children → renderizar como grupo desplegable
    if (children && children.length > 0) {
      const anyActive = children.some(c => pathname === c.to || pathname.startsWith(c.to))
      const [open, setOpen] = useState(anyActive)
      return (
        <div>
          <button
            onClick={() => setOpen(o => !o)}
            title={collapsed ? label : undefined}
            className="nav-link"
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: collapsed ? 0 : 14,
              padding: collapsed ? '12px 0' : '12px 16px',
              justifyContent: collapsed ? 'center' : 'flex-start',
              borderRadius: 14, fontSize: 14, fontWeight: 500, textDecoration: 'none',
              color: anyActive ? 'var(--green)' : 'var(--text-2)',
              background: anyActive ? 'var(--green-bg)' : 'transparent',
              border: 'none', cursor: 'pointer', textAlign: 'left',
              transition: 'all 0.1s ease',
            }}>
            <Icon size={19} strokeWidth={anyActive ? 2 : 1.6} aria-hidden="true" />
            {!collapsed && (
              <>
                <span style={{ flex: 1 }}>{label}</span>
                <span style={{ fontSize: 10, opacity: 0.7 }}>{open ? '▾' : '▸'}</span>
              </>
            )}
          </button>
          {open && !collapsed && (
            <div style={{ marginLeft: 14, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {children.map(c => {
                const cActive = pathname === c.to || (c.to !== '/dashboard' && pathname.startsWith(c.to))
                return (
                  <NavLink key={c.to} to={c.to}
                    onClick={e => { if (cActive) e.preventDefault(); else onNavigate() }}
                    onMouseEnter={() => prefetchRoute(c.to)}
                    style={{
                      padding: '8px 16px 8px 24px', borderRadius: 10, fontSize: 13,
                      textDecoration: 'none',
                      color: cActive ? 'var(--green)' : 'var(--text-2)',
                      background: cActive ? 'var(--green-bg)' : 'transparent',
                      borderLeft: cActive ? '2px solid var(--green)' : '2px solid var(--line)',
                    }}>
                    {c.label}
                  </NavLink>
                )
              })}
            </div>
          )}
        </div>
      )
    }
    // Item normal sin children
    const active = pathname === to || (to !== '/dashboard' && pathname.startsWith(to))
    return (
      <NavLink
        to={to}
        onClick={e => { if (active) e.preventDefault(); else onNavigate() }}
        onMouseEnter={() => prefetchRoute(to)}
        onFocus={() => prefetchRoute(to)}
        onTouchStart={() => prefetchRoute(to)}
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
      {/* ── Brand + toggle ──────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center',
        justifyContent: collapsed ? 'center' : 'space-between',
        padding: collapsed ? '0 12px' : '0 16px 0 28px',
        marginBottom: 40, gap: 8,
        position: 'relative',
      }} ref={menuRef}>

        {/* Logo clickable */}
        <button
          onClick={() => !collapsed && setMenuOpen(o => !o)}
          title={collapsed ? 'Round' : undefined}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: 'none', border: 'none',
            cursor: collapsed ? 'default' : 'pointer',
            padding: 0, borderRadius: 10,
          }}
        >
          <div style={{
            width: 40, height: 40, borderRadius: 12, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: isImpersonating
              ? 'linear-gradient(135deg,#f59e0b,#d97706)'
              : 'var(--gradient-primary)',
            transition: 'background 0.3s',
          }}>
            <Zap size={18} color="#fff" fill="#fff" aria-hidden="true" />
          </div>
          {!collapsed && <>
            <span style={{ fontFamily: 'Outfit', fontSize: 20, fontWeight: 700, color: 'var(--text-0)', whiteSpace: 'nowrap' }}>
              Round
            </span>
            {menuOpen
              ? <ChevronUp size={13} style={{ color: 'var(--text-3)' }} />
              : <ChevronDown size={13} style={{ color: 'var(--text-3)' }} />}
          </>}
        </button>

        {/* Colapsar */}
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

        {/* ── Dropdown de trainers ──────────────────────────────────────── */}
        {menuOpen && !collapsed && (
          <div style={{
            position: 'absolute',
            top: 'calc(100% + 8px)', left: 0, right: 0,
            background: 'var(--bg-1)',
            border: '1px solid var(--line)',
            borderRadius: 14,
            boxShadow: '0 8px 32px rgba(0,0,0,0.22)',
            zIndex: 300,
            overflow: 'hidden',
          }}>

            {/* Cabecera */}
            <div style={{ padding: '10px 14px 8px', borderBottom: '1px solid var(--line)' }}>
              <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Cambiar cuenta
              </p>
            </div>

            {/* Volver al gestor */}
            {isImpersonating && (
              <button onClick={handleSwitchBack} style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 14px',
                background: 'var(--green-bg)',
                border: 'none', borderBottom: '1px solid var(--line)',
                cursor: 'pointer', textAlign: 'left',
              }}>
                <ArrowLeftRight size={14} style={{ color: 'var(--green)', flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--green)' }}>
                    Volver al gestor
                  </p>
                  <p style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {user?.originalSession?.email}
                  </p>
                </div>
              </button>
            )}

            {/* Lista trainers o modal contraseña */}
            {selectedTrainer ? (
              /* ── Modal contraseña inline ── */
              <form onSubmit={handleLoginAsTrainer} style={{ padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Avatar
                      nombre={`${selectedTrainer.nombre ?? selectedTrainer.name ?? ''} ${selectedTrainer.apellidos ?? selectedTrainer.surname ?? ''}`}
                      size={26}
                      imgUrl={selectedTrainer.imgUrl}
                    />
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {selectedTrainer.nombre ?? selectedTrainer.name} {selectedTrainer.apellidos ?? selectedTrainer.surname}
                      </p>
                      <p style={{ fontSize: 10, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {selectedTrainer.email}
                      </p>
                    </div>
                  </div>
                  <button type="button" onClick={closePasswordModal} style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--text-3)', padding: 2, flexShrink: 0,
                  }}>
                    <X size={14} />
                  </button>
                </div>

                <div style={{ position: 'relative', marginBottom: 8 }}>
                  <input
                    ref={passInputRef}
                    type={showPass ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Contraseña del trainer"
                    style={{
                      width: '100%', padding: '8px 34px 8px 10px',
                      borderRadius: 8, border: `1px solid ${loginError ? 'var(--red)' : 'var(--line)'}`,
                      background: 'var(--bg-0)', color: 'var(--text-0)',
                      fontSize: 12, outline: 'none', boxSizing: 'border-box',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(s => !s)}
                    style={{
                      position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                      background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: 0,
                    }}
                  >
                    {showPass ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>

                {loginError && (
                  <p style={{ fontSize: 11, color: 'var(--red)', marginBottom: 8 }}>{loginError}</p>
                )}

                <button
                  type="submit"
                  disabled={loginLoading}
                  style={{
                    width: '100%', padding: '8px', borderRadius: 8,
                    background: 'var(--green)', border: 'none',
                    color: '#fff', fontSize: 12, fontWeight: 600,
                    cursor: loginLoading ? 'wait' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}
                >
                  {loginLoading
                    ? <><Loader2 size={13} className="animate-spin" /> Entrando...</>
                    : 'Iniciar sesión'}
                </button>
              </form>

            ) : (
              /* ── Lista de trainers ── */
              <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                {loadingT && (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: '20px 0' }}>
                    <Loader2 size={18} className="animate-spin" style={{ color: 'var(--green)' }} />
                  </div>
                )}
                {errorT && (
                  <p style={{ fontSize: 12, color: 'var(--red)', padding: '10px 14px' }}>{errorT}</p>
                )}
                {!loadingT && !errorT && trainers.length === 0 && (
                  <p style={{ fontSize: 12, color: 'var(--text-3)', padding: '14px', textAlign: 'center' }}>
                    Sin trainers asociados
                  </p>
                )}
                {trainers.map(t => {
                  const isActive = isImpersonating && user?.email === t.email
                  return (
                    <button
                      key={t.id}
                      onClick={() => openPasswordModal(t)}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                        padding: '10px 14px',
                        background: isActive ? 'var(--green-bg)' : 'transparent',
                        border: 'none', borderBottom: '1px solid var(--line)',
                        cursor: 'pointer', textAlign: 'left',
                        transition: 'background 0.1s',
                      }}
                    >
                      <Avatar
                        nombre={`${t.nombre ?? t.name ?? ''} ${t.apellidos ?? t.surname ?? ''}`}
                        size={28}
                        imgUrl={t.imgUrl}
                      />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <p style={{ fontSize: 12, fontWeight: 600, color: isActive ? 'var(--green)' : 'var(--text-0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {t.nombre ?? t.name} {t.apellidos ?? t.surname}
                        </p>
                        {t.email && (
                          <p style={{ fontSize: 10, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>
                            {t.email}
                          </p>
                        )}
                      </div>
                      {isActive && <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', flexShrink: 0 }} />}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <nav style={{ flex: 1, padding: '0 10px', display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto', overflowX: 'hidden' }}>
        {filterByFeatures(filterByPerms(navItems, user), features).map(item => <NavItem key={item.id || item.to} {...item} />)}

        {/* Items solo para el gestor (sin impersonar) */}
        {!isImpersonating && managerItems.length > 0 && (
          <>
            {!collapsed && (
              <div style={{
                margin: '10px 16px 4px', fontSize: 10, fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)',
              }}>
                Gestor
              </div>
            )}
            {collapsed && <div style={{ height: 10 }} />}
            {filterByFeatures(filterByPerms(managerItems, user), features).map(item => <NavItem key={item.to} {...item} />)}
          </>
        )}

        {configItems.length > 0 && <div style={{ marginTop: 8 }}>
          {collapsed ? (
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
              <button onClick={() => setConfigOpen(o => !o)} style={{
                display: 'flex', alignItems: 'center', gap: 14,
                width: '100%', padding: '10px 16px', borderRadius: 14,
                fontSize: 13, fontWeight: 600, textTransform: 'uppercase',
                letterSpacing: '0.05em', cursor: 'pointer',
                background: 'none', border: 'none',
                color: configActive ? 'var(--green)' : 'var(--text-3)',
                transition: 'color 0.1s',
              }}>
                <Settings size={15} aria-hidden="true" />
                <span style={{ flex: 1, textAlign: 'left' }}>Configuración</span>
                {configOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </button>
              {configOpen && (
                <div style={{ paddingLeft: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {configItems.map(item => <NavItem key={item.to} {...item} />)}
                </div>
              )}
            </>
          )}
        </div>}
      </nav>

      {/* ── QR clase en curso ────────────────────────────────────────────── */}
      {!collapsed && claseEnCurso && (
        <div aria-label="QR de la clase en curso" style={{
          margin: '8px 10px 0', padding: '10px 10px 8px',
          borderRadius: 14, background: 'var(--bg-3)', border: '1px solid var(--line)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, width: '100%', justifyContent: 'center' }}>
            <QrCode size={10} style={{ color: 'var(--green)', flexShrink: 0 }} aria-hidden="true" />
            <p style={{ fontFamily: 'Outfit', fontSize: 11, fontWeight: 700, color: 'var(--text-0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
               title={claseEnCurso.name || claseEnCurso.nameTraining}>
              {claseEnCurso.name || claseEnCurso.nameTraining}
            </p>
            <p style={{ fontSize: 10, color: 'var(--text-3)', flexShrink: 0 }}>
              {formatHora(claseEnCurso.dateStart)}
            </p>
          </div>
          <div style={{ background: '#fff', borderRadius: 8, padding: 5, width: '100%' }}>
            <QRCodeSVG value={String(claseEnCurso.idEspejo ?? claseEnCurso.id)} size={256} level="M"
              style={{ width: '100%', height: 'auto', display: 'block' }} />
          </div>
          <p style={{ fontSize: 10, color: 'var(--text-3)', margin: 0 }}>
            Escanea con <strong style={{ color: 'var(--text-2)' }}>mynoofit</strong>
          </p>
        </div>
      )}

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <div style={{ padding: '0 10px', marginTop: 8, paddingTop: 10, borderTop: '1px solid var(--line)', position: 'relative' }}>
        <UserCard user={user} isImpersonating={isImpersonating} collapsed={collapsed}
                  logout={logout} />
      </div>
    </aside>
  )
}


// ── Footer card del usuario logueado ────────────────────────────────────────
// Muestra el centro (línea 1) y el usuario logueado (línea 2) al mismo tamaño.
// Click → popover con: cerrar sesión + cambiar contraseña (envía email).
function UserCard({ user, isImpersonating, collapsed, logout }) {
  const [open, setOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const ref = useRef(null)
  const toast = useToast()

  // Cerrar el popover al pulsar fuera
  useEffect(() => {
    if (!open) return
    const onClickOut = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onClickOut)
    return () => document.removeEventListener('mousedown', onClickOut)
  }, [open])

  if (!user) return null

  // Línea 1 (centro / contexto activo): nombre del trainer / centro / manager
  const linea1 = `${user.nombre || ''} ${user.apellidos || ''}`.trim() || (user.email || '')

  // Línea 2 (usuario realmente logueado):
  //   - Si está impersonando → originalSession (el gestor real)
  //   - Si no → email del propio user (manager o usuario_web)
  const realUser = isImpersonating ? user.originalSession : null
  const linea2Nombre = realUser
    ? `${realUser.nombre || ''} ${realUser.apellidos || ''}`.trim() || realUser.email
    : (user.email || '')

  const handleChangePassword = async () => {
    if (sending) return
    if (user.kind === 'usuario_web' && user.email) {
      setSending(true)
      try {
        await requestResetUsuarioWeb(user.email)
        toast.success('Te hemos enviado un email para cambiar la contraseña')
      } catch (e) {
        toast.error('No se pudo enviar el email: ' + (e.body?.error || e.message))
      } finally { setSending(false); setOpen(false) }
    } else {
      toast.info?.('Cambia tu contraseña desde NoofitPro (pro.wiemspro.com)') ||
        toast.success('Cambia tu contraseña desde NoofitPro (pro.wiemspro.com)')
      setOpen(false)
    }
  }

  if (collapsed) {
    // Modo colapsado: solo avatar clickable
    return (
      <div ref={ref} style={{ position: 'relative' }}>
        <button type="button" onClick={() => setOpen(o => !o)}
                aria-label="Cuenta y sesión"
                title={`${linea1} · ${linea2Nombre}`}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: '100%', padding: '6px 0', borderRadius: 10,
                  background: 'none', border: 'none', cursor: 'pointer',
                }}>
          <div style={{ position: 'relative' }}>
            <Avatar nombre={linea1} size={26} imgUrl={user.imgUrl} />
            {isImpersonating && (
              <div style={{
                position: 'absolute', bottom: -2, right: -2,
                width: 9, height: 9, borderRadius: '50%',
                background: '#f59e0b', border: '1.5px solid var(--bg-1)',
              }} />
            )}
          </div>
        </button>
        {open && <UserMenu onClose={() => setOpen(false)} onLogout={logout}
                            onChangePassword={handleChangePassword} sending={sending}
                            collapsed />}
      </div>
    )
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" onClick={() => setOpen(o => !o)}
              aria-label="Cuenta y sesión"
              style={{
                width: '100%', padding: '6px 10px', borderRadius: 10,
                display: 'flex', alignItems: 'center', gap: 8,
                background: open ? 'var(--bg-3)' : 'transparent',
                border: '1px solid transparent',
                cursor: 'pointer', textAlign: 'left',
                transition: 'background 0.15s',
              }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <Avatar nombre={linea1} size={26} imgUrl={user.imgUrl} />
          {isImpersonating && (
            <div style={{
              position: 'absolute', bottom: -2, right: -2,
              width: 9, height: 9, borderRadius: '50%',
              background: '#f59e0b', border: '1.5px solid var(--bg-1)',
            }} title="Modo trainer activo" />
          )}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{
            fontSize: 11, fontWeight: 500,
            color: isImpersonating ? '#f59e0b' : 'var(--text-1)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }} title={linea1}>
            {linea1}
          </p>
          <p style={{
            fontSize: 11, fontWeight: 400, marginTop: 2,
            color: 'var(--text-2)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }} title={linea2Nombre}>
            {linea2Nombre}
          </p>
        </div>
        <ChevronUp size={12} style={{ color: 'var(--text-3)',
                                        transform: open ? 'rotate(0deg)' : 'rotate(180deg)',
                                        transition: 'transform 0.15s' }} aria-hidden="true" />
      </button>
      {open && <UserMenu onClose={() => setOpen(false)} onLogout={logout}
                          onChangePassword={handleChangePassword} sending={sending} />}
    </div>
  )
}


function UserMenu({ onLogout, onChangePassword, sending, collapsed }) {
  return (
    <div role="menu" style={{
      position: 'absolute',
      bottom: 'calc(100% + 6px)',
      left: collapsed ? 8 : 10,
      right: collapsed ? 'auto' : 10,
      minWidth: collapsed ? 200 : 'auto',
      background: 'var(--bg-1)', border: '1px solid var(--line)',
      borderRadius: 12, boxShadow: 'var(--shadow-lg)',
      overflow: 'hidden', zIndex: 200,
    }}>
      <button type="button" onClick={onChangePassword} disabled={sending}
              style={menuBtnStyle}
              onMouseOver={e => e.currentTarget.style.background = 'var(--bg-3)'}
              onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
        {sending ? <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                 : <KeyRound size={14} aria-hidden="true" />}
        Cambiar contraseña
      </button>
      <button type="button" onClick={onLogout}
              style={{ ...menuBtnStyle, color: 'var(--red)', borderTop: '1px solid var(--line)' }}
              onMouseOver={e => e.currentTarget.style.background = 'var(--bg-3)'}
              onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
        <LogOut size={14} aria-hidden="true" />
        Cerrar sesión
      </button>
    </div>
  )
}

const menuBtnStyle = {
  display: 'flex', alignItems: 'center', gap: 10,
  width: '100%', padding: '10px 14px',
  background: 'transparent', border: 'none', cursor: 'pointer',
  fontSize: 13, color: 'var(--text-1)', textAlign: 'left',
  transition: 'background 0.1s',
}
