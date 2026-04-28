import { useState, useEffect, useRef } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import {
  Zap, LogOut, Settings, ChevronDown, ChevronRight,
  PanelLeftClose, PanelLeftOpen, QrCode, ChevronUp,
  ArrowLeftRight, Loader2, Eye, EyeOff, X,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { navItems, managerItems, configItems } from '../config/routes'
import { useClaseEnCurso } from '../hooks/useClaseEnCurso'
import { formatHora } from '../utils/formatters'
import { Avatar } from './UI'
import { getEntrenadores } from '../utils/api'

export default function Sidebar({ onNavigate, collapsed, onToggleCollapse }) {
  const { logout, user, loginAsTrainer, switchBackToManager, isImpersonating } = useAuth()
  const { pathname } = useLocation()
  const navigate     = useNavigate()
  const [configOpen, setConfigOpen] = useState(true)
  const claseEnCurso = useClaseEnCurso()

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

  const NavItem = ({ to, icon: Icon, label }) => {
    const active = pathname === to || (to !== '/dashboard' && pathname.startsWith(to))
    return (
      <NavLink
        to={to}
        onClick={e => { if (active) e.preventDefault(); else onNavigate() }}
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
        {navItems.map(item => <NavItem key={item.to} {...item} />)}

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
            {managerItems.map(item => <NavItem key={item.to} {...item} />)}
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
      <div style={{ padding: '0 10px', marginTop: 8, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
        {user && !collapsed && (
          <div style={{ padding: '0 10px', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <Avatar nombre={`${user.nombre || ''} ${user.apellidos || ''}`} size={26} imgUrl={user.imgUrl} />
              {isImpersonating && (
                <div style={{
                  position: 'absolute', bottom: -2, right: -2,
                  width: 9, height: 9, borderRadius: '50%',
                  background: '#f59e0b',
                  border: '1.5px solid var(--bg-1)',
                }} title="Sesión de trainer activa" />
              )}
            </div>
            <div style={{ minWidth: 0 }}>
              <p style={{
                fontSize: 11, fontWeight: 500,
                color: isImpersonating ? '#f59e0b' : 'var(--text-1)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }} title={`${user.nombre} ${user.apellidos}`}>
                {user.nombre} {user.apellidos}
              </p>
              <p style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                 title={user.email}>
                {user.email}
              </p>
            </div>
          </div>
        )}
        <button onClick={logout} aria-label="Cerrar sesión" title={collapsed ? 'Cerrar sesión' : undefined}
          className="nav-link"
          style={{
            display: 'flex', alignItems: 'center', gap: collapsed ? 0 : 10,
            justifyContent: collapsed ? 'center' : 'flex-start',
            width: '100%', padding: collapsed ? '8px 0' : '7px 10px', borderRadius: 10,
            fontSize: 12, fontWeight: 500, cursor: 'pointer',
            color: 'var(--text-3)', background: 'transparent', border: 'none', transition: 'all 0.1s',
          }}>
          <LogOut size={15} strokeWidth={1.6} aria-hidden="true" />
          {!collapsed && 'Cerrar sesión'}
        </button>
      </div>
    </aside>
  )
}
