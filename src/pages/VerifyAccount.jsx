// Página /verificar?token=XXX y /reset?token=XXX (ambos compartido)
import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Loader2, Eye, EyeOff, CheckCircle2, AlertCircle } from 'lucide-react'
import { verifyEmailWithToken, changePasswordWithToken } from '../utils/authUsuarioApi'

const MIN_LEN = 8

export default function VerifyAccount({ mode = 'verify' }) {
  // mode = 'verify' (alta de cuenta) o 'reset' (cambio de password ya verificada)
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token') || ''
  const [pwd, setPwd] = useState('')
  const [pwd2, setPwd2] = useState('')
  const [show, setShow] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => { if (!token) setError('Enlace inválido o expirado') }, [token])

  const validate = () => {
    if (!token) return 'Enlace inválido o expirado'
    if (pwd.length < MIN_LEN) return `La contraseña debe tener al menos ${MIN_LEN} caracteres`
    if (pwd !== pwd2) return 'Las contraseñas no coinciden'
    return null
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const err = validate()
    if (err) { setError(err); return }
    setSubmitting(true); setError('')
    try {
      if (mode === 'verify') {
        await verifyEmailWithToken(token, pwd)
      } else {
        await changePasswordWithToken(token, pwd)
      }
      setDone(true)
      setTimeout(() => navigate('/login'), 2500)
    } catch (e) {
      const detail = e.body?.error
      setError(
        detail === 'token_expired' ? 'El enlace ha expirado. Pide uno nuevo desde la pantalla de login.'
        : detail === 'invalid_token' ? 'Enlace inválido. Comprueba que copiaste el link completo.'
        : detail === 'password_too_short' ? `La contraseña debe tener al menos ${MIN_LEN} caracteres`
        : 'No se pudo completar. Intenta de nuevo o pide otro enlace.'
      )
    } finally { setSubmitting(false) }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-0)', padding: '40px 24px',
    }}>
      <div style={{ width: '100%', maxWidth: 460 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <h1 style={{ fontFamily: 'Outfit', fontSize: 32, fontWeight: 700, color: 'var(--text-0)', marginBottom: 12 }}>
            {mode === 'verify' ? 'Verifica tu cuenta' : 'Nueva contraseña'}
          </h1>
          <p style={{ fontSize: 14, color: 'var(--text-2)' }}>
            {mode === 'verify'
              ? 'Crea una contraseña personal para acceder a Round.'
              : 'Establece tu nueva contraseña.'}
          </p>
        </div>

        <div style={{ background: 'var(--bg-1)', border: '1px solid var(--line)', borderRadius: 20, padding: 32 }}>
          {done ? (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <CheckCircle2 size={48} style={{ color: 'var(--green)', marginBottom: 16 }} aria-hidden="true" />
              <h2 style={{ fontSize: 20, color: 'var(--text-0)', marginBottom: 8 }}>¡Listo!</h2>
              <p style={{ color: 'var(--text-2)', fontSize: 14 }}>Te llevamos al login…</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-3)', marginBottom: 8 }}>
                Nueva contraseña
              </label>
              <div style={{ position: 'relative', marginBottom: 16 }}>
                <input type={show ? 'text' : 'password'} value={pwd}
                  onChange={e => { setPwd(e.target.value); setError('') }}
                  autoComplete="new-password" disabled={submitting || !token}
                  style={{ width: '100%', padding: '14px 48px 14px 18px', borderRadius: 14, fontSize: 14,
                    background: 'var(--bg-2)', border: `1px solid ${error ? 'var(--red)' : 'var(--line)'}`,
                    color: 'var(--text-0)', outline: 'none' }} />
                <button type="button" onClick={() => setShow(s => !s)} tabIndex={-1}
                  aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: 6 }}>
                  {show ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>

              <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-3)', marginBottom: 8 }}>
                Repite la contraseña
              </label>
              <input type={show ? 'text' : 'password'} value={pwd2}
                onChange={e => { setPwd2(e.target.value); setError('') }}
                autoComplete="new-password" disabled={submitting || !token}
                style={{ width: '100%', padding: '14px 18px', borderRadius: 14, fontSize: 14,
                  background: 'var(--bg-2)', border: `1px solid ${error ? 'var(--red)' : 'var(--line)'}`,
                  color: 'var(--text-0)', outline: 'none', marginBottom: 16 }} />

              {error && (
                <div role="alert" style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(248,113,113,0.08)',
                  border: '1px solid rgba(248,113,113,0.2)', color: 'var(--red)', fontSize: 13,
                  marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <AlertCircle size={14} aria-hidden="true" /> {error}
                </div>
              )}

              <button type="submit" disabled={submitting || !token}
                style={{ width: '100%', padding: '14px', borderRadius: 14, fontSize: 14, fontWeight: 600,
                  border: 'none', cursor: 'pointer', background: 'var(--gradient-primary)', color: '#fff',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                {submitting && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
                {mode === 'verify' ? 'Verificar y crear contraseña' : 'Cambiar contraseña'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
