import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import ClientList from './pages/Clients/ClientList'
import ClientProfile from './pages/Clients/ClientProfile'
import NewClient from './pages/Clients/NewClient'
import Clases from './pages/Clases'
import ClaseDetalle from './pages/ClaseDetalle'
import Actividades from './pages/Actividades'
import Monitores from './pages/Monitores'
import Entrenamientos from './pages/Entrenamientos'
import Ejercicios from './pages/Ejercicios'
import Dispositivos from './pages/Dispositivos'
import Listados from './pages/Listados'

function RequireAuth({ children }) {
  const { user, loading } = useAuth()
  if (loading) return (
    <div className="h-screen flex items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 rounded-xl animate-pulse"
             style={{ background: 'linear-gradient(135deg, #FF6B35, #FF4500)' }} />
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Cargando...</p>
      </div>
    </div>
  )
  if (!user) return <Navigate to="/login" replace />
  return children
}

function AppRoutes() {
  const { user } = useAuth()

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <Login />} />

      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route path="/dashboard"      element={<Dashboard />} />
        <Route path="/clientes"       element={<ClientList />} />
        <Route path="/clientes/nuevo" element={<NewClient />} />
        <Route path="/clientes/:id"   element={<ClientProfile />} />
        <Route path="/clases"         element={<Clases />} />
        <Route path="/clases/:id"     element={<ClaseDetalle />} />
        <Route path="/actividades"    element={<Actividades />} />
        <Route path="/monitores"      element={<Monitores />} />
        <Route path="/entrenamientos" element={<Entrenamientos />} />
        <Route path="/ejercicios"     element={<Ejercicios />} />
        <Route path="/dispositivos"   element={<Dispositivos />} />
        <Route path="/listados"       element={<Listados />} />
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
