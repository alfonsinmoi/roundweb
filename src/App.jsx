import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ToastProvider } from './components/Toast'
import ErrorBoundary from './components/ErrorBoundary'
import Layout from './components/Layout'
import { Loader2 } from 'lucide-react'

// Lazy-loaded pages for code splitting
const Login = lazy(() => import('./pages/Login'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const ClientList = lazy(() => import('./pages/Clients/ClientList'))
const ClientProfile = lazy(() => import('./pages/Clients/ClientProfile'))
const NewClient = lazy(() => import('./pages/Clients/NewClient'))
const Clases = lazy(() => import('./pages/Clases'))
const ClaseDetalle = lazy(() => import('./pages/ClaseDetalle'))
const Actividades = lazy(() => import('./pages/Actividades'))
const Monitores = lazy(() => import('./pages/Monitores'))
const Entrenamientos = lazy(() => import('./pages/Entrenamientos'))
const Ejercicios = lazy(() => import('./pages/Ejercicios'))
const Dispositivos = lazy(() => import('./pages/Dispositivos'))
const Listados = lazy(() => import('./pages/Listados'))
const InformeAsistencia = lazy(() => import('./pages/InformeAsistencia'))
const ClasesModificacion = lazy(() => import('./pages/ClasesModificacion'))
const NotFound = lazy(() => import('./pages/NotFound'))

function PageLoader() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '120px 0' }} role="status" aria-label="Cargando página">
      <Loader2 size={22} className="animate-spin" style={{ color: 'var(--green)' }} aria-hidden="true" />
    </div>
  )
}

function RequireAuth({ children }) {
  const { user, loading } = useAuth()
  if (loading) return (
    <div className="h-screen flex items-center justify-center" style={{ background: 'var(--bg-primary)' }} role="status" aria-label="Cargando sesión">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 rounded-xl animate-pulse"
             style={{ background: 'linear-gradient(135deg, var(--green), var(--green-soft))' }} />
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
    <Suspense fallback={<PageLoader />}>
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
          <Route path="/informe-asistencia"   element={<InformeAsistencia />} />
          <Route path="/clases-modificacion" element={<ClasesModificacion />} />
        </Route>

        <Route path="*" element={<RequireAuth><NotFound /></RequireAuth>} />
      </Routes>
    </Suspense>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <AppRoutes />
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
