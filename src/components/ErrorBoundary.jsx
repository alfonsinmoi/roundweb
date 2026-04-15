import { Component } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Btn } from './UI'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div role="alert" style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', padding: 40, background: 'var(--bg-0)', textAlign: 'center',
      }}>
        <AlertTriangle size={48} style={{ color: 'var(--amber)', marginBottom: 24 }} aria-hidden="true" />
        <h1 style={{ fontFamily: 'Outfit', fontSize: 24, fontWeight: 700, color: 'var(--text-0)', marginBottom: 12 }}>
          Algo salió mal
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text-3)', maxWidth: 400, marginBottom: 32 }}>
          Ha ocurrido un error inesperado. Puedes intentar recargar la página.
        </p>
        <Btn onClick={() => window.location.reload()}>Recargar página</Btn>
      </div>
    )
  }
}
