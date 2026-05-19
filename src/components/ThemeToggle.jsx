import { useEffect, useState } from 'react'
import { Sun, Moon } from 'lucide-react'

const STORAGE_KEY = 'round.theme'

function readInitialTheme() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch { /* ignore */ }
  // Default: el tema histórico de Round es OSCURO. Solo respetamos preferencia
  // del SO si nunca ha guardado nada.
  if (typeof window !== 'undefined' && window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light'
  }
  return 'dark'
}

function applyTheme(theme) {
  if (typeof document === 'undefined') return
  // dark = sin atributo (los estilos por defecto). light = data-theme="light".
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light')
  } else {
    document.documentElement.removeAttribute('data-theme')
  }
}

// Aplicar el tema lo antes posible — al importar este módulo.
if (typeof document !== 'undefined') {
  applyTheme(readInitialTheme())
}

export default function ThemeToggle({ size = 'md', label = false }) {
  const [theme, setTheme] = useState(() => readInitialTheme())

  useEffect(() => {
    applyTheme(theme)
    try { localStorage.setItem(STORAGE_KEY, theme) } catch { /* ignore */ }
  }, [theme])

  const toggle = () => setTheme(t => (t === 'dark' ? 'light' : 'dark'))

  const dim = size === 'sm' ? 14 : size === 'lg' ? 20 : 16
  const pad = size === 'sm' ? 6 : size === 'lg' ? 10 : 8

  const isLight = theme === 'light'
  const ariaLabel = isLight ? 'Cambiar a tema oscuro' : 'Cambiar a tema claro'

  return (
    <button type="button"
            onClick={toggle}
            aria-label={ariaLabel}
            title={ariaLabel}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: pad, borderRadius: 10, cursor: 'pointer',
              background: 'var(--bg-2)', border: '1px solid var(--line)',
              color: 'var(--text-1)', transition: 'background 0.15s',
            }}>
      {isLight ? <Moon size={dim} aria-hidden="true" /> : <Sun size={dim} aria-hidden="true" />}
      {label && (
        <span style={{ fontSize: 13, fontWeight: 500 }}>
          {isLight ? 'Oscuro' : 'Claro'}
        </span>
      )}
    </button>
  )
}
