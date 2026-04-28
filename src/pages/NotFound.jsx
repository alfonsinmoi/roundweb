import { useNavigate } from 'react-router-dom'
import { Home } from 'lucide-react'
import { Btn } from '../components/UI'

export default function NotFound() {
  const navigate = useNavigate()

  return (
    <div role="main" style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', padding: 40, background: 'var(--bg-0)', textAlign: 'center',
    }}>
      <p style={{ fontFamily: 'Outfit', fontSize: 80, fontWeight: 700, color: 'var(--text-3)', lineHeight: 1 }}>404</p>
      <h1 style={{ fontFamily: 'Outfit', fontSize: 24, fontWeight: 600, color: 'var(--text-0)', marginTop: 16, marginBottom: 12 }}>
        Página no encontrada
      </h1>
      <p style={{ fontSize: 14, color: 'var(--text-3)', maxWidth: 360, marginBottom: 32 }}>
        La página que buscas no existe o ha sido movida.
      </p>
      <Btn onClick={() => navigate('/clientes')}>
        <Home size={16} /> Ir a Clientes
      </Btn>
    </div>
  )
}
