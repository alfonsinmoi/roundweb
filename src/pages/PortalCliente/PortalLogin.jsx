import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { LogIn, Eye, EyeOff } from 'lucide-react'
import { usePortalAuth } from '../../contexts/PortalAuthContext'


export default function PortalLogin() {
  const { isAuthed, login, loading } = usePortalAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [error, setError] = useState('')
  const [managers, setManagers] = useState(null)
  const [selectedManager, setSelectedManager] = useState('')

  if (isAuthed) return <Navigate to="/portal" replace />

  async function handle(e) {
    e.preventDefault()
    setError('')
    const r = await login(email.trim().toLowerCase(), password, selectedManager || null)
    if (r.ok) {
      navigate('/portal', { replace: true })
    } else if (r.status === 409 && r.managers?.length) {
      setManagers(r.managers)
      setError('Tienes cuenta en varios centros — elige uno.')
    } else {
      setError(traduce(r.error))
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-0, #0c0c0e)',
      padding: '16px',
    }}>
      <div style={{
        width: '100%', maxWidth: 380,
        background: 'var(--bg-1, #131316)',
        border: '1px solid var(--line, #2a2a30)',
        borderRadius: 16, padding: '28px 20px',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 18, margin: '0 auto 12px',
            background: 'var(--gradient-primary, linear-gradient(135deg,#10b981,#059669))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <LogIn size={26} color="#fff" />
          </div>
          <h1 style={{
            margin: 0, fontFamily: 'var(--font-display, Outfit)',
            fontSize: 22, fontWeight: 700, color: 'var(--text-0)',
          }}>
            Tu portal Round
          </h1>
          <p style={{
            margin: '4px 0 0', fontSize: 13, color: 'var(--text-3)',
          }}>
            Entra con tu cuenta de mynoofit
          </p>
        </div>

        <form onSubmit={handle} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={lbl}>
            Email
            <input type="email" required autoComplete="email"
                   value={email} onChange={e => setEmail(e.target.value)}
                   style={input} placeholder="tu@email.com" />
          </label>
          <label style={lbl}>
            Contraseña
            <div style={{ position: 'relative' }}>
              <input type={showPass ? 'text' : 'password'} required autoComplete="current-password"
                     value={password} onChange={e => setPassword(e.target.value)}
                     style={{ ...input, paddingRight: 38 }} />
              <button type="button" onClick={() => setShowPass(s => !s)}
                      aria-label={showPass ? 'Ocultar' : 'Mostrar'}
                      style={eyeBtn}>
                {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </label>

          {managers && (
            <label style={lbl}>
              Centro / manager
              <select value={selectedManager}
                      onChange={e => setSelectedManager(e.target.value)}
                      style={input}>
                <option value="">— elige —</option>
                {managers.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
          )}

          {error && (
            <div role="alert" style={{
              padding: '10px 12px', borderRadius: 10,
              background: 'rgba(248,113,133,0.10)',
              color: 'var(--red, #f87171)', fontSize: 13,
            }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={loading}
                  style={{
                    marginTop: 4, padding: '14px',
                    borderRadius: 12, border: 'none',
                    background: 'var(--gradient-primary, linear-gradient(135deg,#10b981,#059669))',
                    color: '#fff', fontWeight: 600, fontSize: 15,
                    cursor: loading ? 'wait' : 'pointer',
                    opacity: loading ? 0.6 : 1,
                  }}>
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
        </form>

        <p style={{
          marginTop: 18, textAlign: 'center', fontSize: 12, color: 'var(--text-3)',
        }}>
          ¿Eres un gestor / entrenador? Entra en{' '}
          <a href="/login" style={{ color: 'var(--green, #10b981)' }}>el portal de gestión</a>.
        </p>
      </div>
    </div>
  )
}


function traduce(err) {
  const map = {
    credenciales_invalidas: 'Email o contraseña incorrectos.',
    cliente_no_encontrado:  'No encontramos tu cuenta. ¿Estás registrado en NoofitPro?',
    email_y_password_requeridos: 'Introduce email y contraseña.',
    noofit_unreachable: 'No podemos conectar con NoofitPro. Reintenta en unos minutos.',
  }
  return map[err] || err || 'Error desconocido'
}


const lbl = {
  display: 'flex', flexDirection: 'column', gap: 6,
  fontSize: 12, color: 'var(--text-3)', fontWeight: 500,
}
const input = {
  width: '100%', padding: '12px 14px', borderRadius: 10,
  border: '1px solid var(--line)', background: 'var(--bg-0)',
  color: 'var(--text-0)', fontSize: 14, outline: 'none',
  boxSizing: 'border-box',
}
const eyeBtn = {
  position: 'absolute', right: 10, top: '50%',
  transform: 'translateY(-50%)',
  background: 'none', border: 'none', cursor: 'pointer',
  color: 'var(--text-3)', padding: 4,
}
