import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { Eye, EyeOff, Loader2 } from 'lucide-react'

export default function Login() {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!email.trim() || !password.trim()) { setError('Introduce email y contraseña'); return }
    setLoading(true)
    const result = await login(email.trim(), password)
    setLoading(false)
    if (!result.ok) setError(result.error ?? 'Credenciales incorrectas')
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#060608',
      padding: '40px 24px',
    }}>

      <div style={{ width: '100%', maxWidth: 460 }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 60 }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 72,
            height: 72,
            borderRadius: 20,
            background: 'linear-gradient(135deg, #2DD4A8, #1A9A7A)',
            marginBottom: 32,
          }}>
            <svg width="30" height="30" viewBox="0 0 24 24" fill="#fff" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </div>

          <h1 style={{
            fontFamily: 'Outfit, sans-serif',
            fontSize: 44,
            fontWeight: 700,
            color: '#F4F4F6',
            letterSpacing: '-0.02em',
            marginBottom: 12,
          }}>
            Round
          </h1>

          <p style={{
            fontSize: 16,
            color: '#6B6B78',
            lineHeight: 1.6,
          }}>
            Gestión integral para tu centro fitness
          </p>
        </div>

        {/* Form card */}
        <div style={{
          background: '#0E0F13',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 24,
          padding: '48px 40px',
        }}>

          <form onSubmit={handleSubmit}>

            {/* Email */}
            <div style={{ marginBottom: 28 }}>
              <label style={{
                display: 'block',
                fontSize: 14,
                fontWeight: 500,
                color: '#9090A0',
                marginBottom: 12,
              }}>
                Email
              </label>
              <input type="email" autoComplete="email" value={email}
                     onChange={e => setEmail(e.target.value)}
                     placeholder="tu@email.com"
                     style={{
                       width: '100%',
                       padding: '16px 20px',
                       borderRadius: 16,
                       fontSize: 16,
                       background: '#16171C',
                       border: '1px solid rgba(255,255,255,0.08)',
                       color: '#F4F4F6',
                       outline: 'none',
                       transition: 'border-color 0.2s',
                     }}
                     onFocus={e => e.target.style.borderColor = '#2DD4A8'}
                     onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.08)'} />
            </div>

            {/* Password */}
            <div style={{ marginBottom: 36 }}>
              <label style={{
                display: 'block',
                fontSize: 14,
                fontWeight: 500,
                color: '#9090A0',
                marginBottom: 12,
              }}>
                Contraseña
              </label>
              <div style={{ position: 'relative' }}>
                <input type={showPass ? 'text' : 'password'} autoComplete="current-password"
                       value={password} onChange={e => setPassword(e.target.value)}
                       placeholder="Tu contraseña"
                       style={{
                         width: '100%',
                         padding: '16px 56px 16px 20px',
                         borderRadius: 16,
                         fontSize: 16,
                         background: '#16171C',
                         border: '1px solid rgba(255,255,255,0.08)',
                         color: '#F4F4F6',
                         outline: 'none',
                         transition: 'border-color 0.2s',
                       }}
                       onFocus={e => e.target.style.borderColor = '#2DD4A8'}
                       onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.08)'} />
                <button type="button" onClick={() => setShowPass(v => !v)}
                        style={{
                          position: 'absolute',
                          right: 20,
                          top: '50%',
                          transform: 'translateY(-50%)',
                          cursor: 'pointer',
                          color: '#555',
                          background: 'none',
                          border: 'none',
                          padding: 4,
                        }}>
                  {showPass ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div style={{
                marginBottom: 28,
                padding: '16px 20px',
                borderRadius: 16,
                fontSize: 14,
                color: '#F87171',
                background: 'rgba(248,113,133,0.06)',
                border: '1px solid rgba(248,113,133,0.12)',
              }}>
                {error}
              </div>
            )}

            {/* Submit */}
            <button type="submit" disabled={loading}
                    style={{
                      width: '100%',
                      padding: '18px 24px',
                      borderRadius: 16,
                      fontSize: 16,
                      fontWeight: 600,
                      fontFamily: 'Outfit, sans-serif',
                      cursor: loading ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 10,
                      background: 'linear-gradient(135deg, #2DD4A8, #1A9A7A)',
                      color: '#fff',
                      border: 'none',
                      opacity: loading ? 0.6 : 1,
                      transition: 'opacity 0.2s, transform 0.2s',
                    }}
                    onMouseEnter={e => { if (!loading) e.currentTarget.style.transform = 'translateY(-2px)' }}
                    onMouseLeave={e => e.currentTarget.style.transform = 'none'}>
              {loading ? <><Loader2 size={20} className="animate-spin" /> Accediendo...</> : 'Iniciar sesión'}
            </button>

          </form>
        </div>

        <p style={{
          textAlign: 'center',
          fontSize: 13,
          color: '#3E3E48',
          marginTop: 40,
        }}>
          Usa tus credenciales de WiemsPro
        </p>

      </div>
    </div>
  )
}
