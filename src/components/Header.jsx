import { useLocation } from 'react-router-dom'

const titles = {
  '/dashboard': 'Dashboard', '/clientes': 'Clientes', '/clases': 'Clases',
  '/actividades': 'Actividades', '/monitores': 'Monitores', '/entrenamientos': 'Entrenamientos',
  '/ejercicios': 'Ejercicios', '/dispositivos': 'Dispositivos', '/listados': 'Listados',
}

export default function Header() {
  const { pathname } = useLocation()
  const title = Object.entries(titles).find(([k]) => pathname.startsWith(k))?.[1] ?? 'Round'

  return (
    <header style={{
      display: 'flex', alignItems: 'center', height: 64,
      padding: '0 48px', flexShrink: 0,
      borderBottom: '1px solid var(--line)',
    }}>
      <h1 style={{ fontFamily: 'Outfit', fontSize: 20, fontWeight: 600, color: 'var(--text-0)' }}>
        {title}
      </h1>
    </header>
  )
}
