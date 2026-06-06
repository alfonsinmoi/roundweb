import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { Eye, EyeOff, Loader2, Building2, ChevronRight } from 'lucide-react'

const MAX_PASSWORD_LENGTH = 128

export default function Login() {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')   // mensaje neutro (must_change_password)
  const [loading, setLoading] = useState(false)
  // Si el usuario tiene acceso a varios centros, mostramos selector.
  const [trainerChoice, setTrainerChoice] = useState(null)  // { trainers, message } | null

  // Reintento del login con el centro elegido. Sólo se llama desde el selector.
  const elegirCentro = async (idTrainer) => {
    setError(''); setLoading(true)
    const result = await login(email.trim(), password, String(idTrainer))
    setLoading(false)
    if (result.ok) { setTrainerChoice(null); return }
    if (result.multiTrainer) {
      // No debería volver a pasar (ya pasamos id_trainer) — refrescar lista
      setTrainerChoice({ trainers: result.trainers, message: result.message })
      return
    }
    setError(result.error || 'No se pudo acceder al centro elegido')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(''); setInfo('')
    if (!email.trim() || !password.trim()) { setError('Introduce email y contraseña'); return }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError('Introduce un email válido'); return }
    if (password.length > MAX_PASSWORD_LENGTH) { setError(`La contraseña no puede tener más de ${MAX_PASSWORD_LENGTH} caracteres`); return }
    setLoading(true)
    const result = await login(email.trim(), password)
    setLoading(false)
    if (result.ok) return
    if (result.mustChangePassword) {
      setInfo(result.message || 'Te hemos enviado un email para que actualices tu contraseña.')
      return
    }
    if (result.multiTrainer) {
      // El usuario tiene acceso a varios centros — mostrar selector
      setTrainerChoice({ trainers: result.trainers || [], message: result.message })
      return
    }
    setError(result.error ?? 'Credenciales incorrectas')
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg-0)',
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
            background: 'var(--gradient-primary)',
            marginBottom: 32,
          }}>
            <svg width="30" height="30" viewBox="0 0 24 24" fill="#fff" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </div>

          <h1 style={{
            fontFamily: 'Outfit, sans-serif',
            fontSize: 44,
            fontWeight: 700,
            color: 'var(--text-0)',
            letterSpacing: '-0.02em',
            marginBottom: 12,
          }}>
            Round
          </h1>

          <p style={{
            fontSize: 16,
            color: 'var(--text-2)',
            lineHeight: 1.6,
          }}>
            Gestión integral para tu centro fitness
          </p>
        </div>

        {/* Selector de centro — si el usuario tiene acceso a varios trainers */}
        {trainerChoice ? (
          <div style={{
            background: 'var(--bg-1)', border: '1px solid var(--line)',
            borderRadius: 24, padding: '40px 36px',
          }}>
            <h2 style={{
              fontFamily: 'Outfit, sans-serif', fontSize: 22, fontWeight: 700,
              color: 'var(--text-0)', margin: 0, display: 'flex',
              alignItems: 'center', gap: 10,
            }}>
              <Building2 size={22} aria-hidden="true" /> Elige el centro
            </h2>
            <p style={{ fontSize: 14, color: 'var(--text-2)', marginTop: 12, marginBottom: 28, lineHeight: 1.5 }}>
              {trainerChoice.message || 'Tienes acceso a varios centros. Elige con cuál quieres trabajar en esta sesión.'}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {(trainerChoice.trainers || []).map(t => (
                <button key={t.id_trainer}
                        onClick={() => elegirCentro(t.id_trainer)}
                        disabled={loading}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: '16px 20px', borderRadius: 16, fontSize: 15,
                          background: 'var(--bg-2)', border: '1px solid var(--line)',
                          color: 'var(--text-0)', cursor: loading ? 'wait' : 'pointer',
                          textAlign: 'left', width: '100%', fontFamily: 'inherit',
                          transition: 'border-color 0.2s, background 0.2s',
                        }}
                        onMouseEnter={e => { if (!loading) e.currentTarget.style.borderColor = 'var(--green)' }}
                        onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--line)'}>
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      {/* Prioridad: nombre del centro (centro_contacto) →
                          email del trainer (sin @dominio) → fallback id. */}
                      {t.nombre_centro
                        || (t.email_trainer ? t.email_trainer.replace(/@.*$/, '') : `Centro ${t.id_trainer}`)}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
                      ID NoofitPro: {t.id_trainer}
                      {t.email_trainer ? ` · ${t.email_trainer}` : ''}
                    </div>
                  </div>
                  <ChevronRight size={18} aria-hidden="true" style={{ color: 'var(--text-3)' }} />
                </button>
              ))}
            </div>
            {error && (
              <div role="alert" style={{
                marginTop: 24, padding: '14px 18px', borderRadius: 14, fontSize: 13,
                color: 'var(--red)', background: 'rgba(248,113,133,0.06)',
                border: '1px solid rgba(248,113,133,0.12)',
              }}>{error}</div>
            )}
            <button onClick={() => { setTrainerChoice(null); setPassword(''); setError('') }}
                    disabled={loading}
                    style={{
                      marginTop: 20, background: 'transparent', border: 'none',
                      color: 'var(--text-3)', fontSize: 13, cursor: 'pointer',
                      textDecoration: 'underline',
                    }}>
              ← Volver al login
            </button>
          </div>
        ) : (
        /* Form card normal */
        <div style={{
          background: 'var(--bg-1)',
          border: '1px solid var(--line)',
          borderRadius: 24,
          padding: '48px 40px',
        }}>

          <form onSubmit={handleSubmit}>

            {/* Email */}
            <div style={{ marginBottom: 28 }}>
              <label htmlFor="login-email" style={{
                display: 'block',
                fontSize: 14,
                fontWeight: 500,
                color: 'var(--text-2)',
                marginBottom: 12,
              }}>
                Email
              </label>
              <input id="login-email" type="email" autoComplete="email" value={email}
                     onChange={e => setEmail(e.target.value)}
                     placeholder="tu@email.com"
                     maxLength={254}
                     className="form-input"
                     style={{
                       width: '100%',
                       padding: '16px 20px',
                       borderRadius: 16,
                       fontSize: 16,
                       background: 'var(--bg-2)',
                       border: '1px solid var(--line)',
                       color: 'var(--text-0)',
                       transition: 'border-color 0.2s',
                     }} />
            </div>

            {/* Password */}
            <div style={{ marginBottom: 36 }}>
              <label htmlFor="login-password" style={{
                display: 'block',
                fontSize: 14,
                fontWeight: 500,
                color: 'var(--text-2)',
                marginBottom: 12,
              }}>
                Contraseña
              </label>
              <div style={{ position: 'relative' }}>
                <input id="login-password" type={showPass ? 'text' : 'password'} autoComplete="current-password"
                       value={password} onChange={e => setPassword(e.target.value)}
                       placeholder="Tu contraseña"
                       maxLength={MAX_PASSWORD_LENGTH}
                       className="form-input"
                       style={{
                         width: '100%',
                         padding: '16px 56px 16px 20px',
                         borderRadius: 16,
                         fontSize: 16,
                         background: 'var(--bg-2)',
                         border: '1px solid var(--line)',
                         color: 'var(--text-0)',
                         transition: 'border-color 0.2s',
                       }} />
                <button type="button" onClick={() => setShowPass(v => !v)}
                        aria-label={showPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                        style={{
                          position: 'absolute',
                          right: 20,
                          top: '50%',
                          transform: 'translateY(-50%)',
                          cursor: 'pointer',
                          color: 'var(--text-3)',
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
              <div role="alert" style={{
                marginBottom: 28,
                padding: '16px 20px',
                borderRadius: 16,
                fontSize: 14,
                color: 'var(--red)',
                background: 'rgba(248,113,133,0.06)',
                border: '1px solid rgba(248,113,133,0.12)',
              }}>
                {error}
              </div>
            )}

            {/* Info (must_change_password) */}
            {info && (
              <div role="status" style={{
                marginBottom: 28, padding: '16px 20px', borderRadius: 16, fontSize: 14,
                color: 'var(--green)', background: 'rgba(45,212,168,0.08)',
                border: '1px solid rgba(45,212,168,0.2)',
              }}>
                {info}
              </div>
            )}

            {/* Submit */}
            <button type="submit" disabled={loading}
                    className="btn"
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
                      background: 'var(--gradient-primary)',
                      color: '#fff',
                      border: 'none',
                      opacity: loading ? 0.6 : 1,
                      transition: 'opacity 0.2s, transform 0.2s',
                    }}>
              {loading ? <><Loader2 size={20} className="animate-spin" aria-hidden="true" /> Accediendo...</> : 'Iniciar sesión'}
            </button>

          </form>
        </div>
        )}

        <p style={{
          textAlign: 'center',
          fontSize: 13,
          color: 'var(--text-3)',
          marginTop: 40,
        }}>
          Usa tus credenciales de WiemsPro
        </p>

      </div>
    </div>
  )
}
