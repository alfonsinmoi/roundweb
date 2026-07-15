import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { PortalAuthProvider } from './contexts/PortalAuthContext'
import { TrainerFilterProvider } from './contexts/TrainerFilterContext'
import { ToastProvider } from './components/Toast'
import ErrorBoundary from './components/ErrorBoundary'
import Layout from './components/Layout'
import { Loader2 } from 'lucide-react'

// Lazy-loaded pages for code splitting
const Login = lazy(() => import('./pages/Login'))
const VerifyAccount = lazy(() => import('./pages/VerifyAccount'))
const NotasPage = lazy(() => import('./pages/Notas/NotasPage'))
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
const InformeClientes = lazy(() => import('./pages/InformeClientes'))
const InformeEjercicios = lazy(() => import('./pages/InformeEjercicios'))
const InformeCompeticiones = lazy(() => import('./pages/InformeCompeticiones'))
const InformeIntegridad = lazy(() => import('./pages/InformeIntegridad'))
const ClasesModificacion = lazy(() => import('./pages/ClasesModificacion'))
const AnalisisClusters = lazy(() => import('./pages/AnalisisClusters'))
const ERPConfiguracion = lazy(() => import('./pages/ERPConfiguracion'))
const Configuracion = lazy(() => import('./pages/Configuracion/Configuracion'))
const CuotasClientes = lazy(() => import('./pages/CuotasClientes/CuotasClientes'))
const EntradasPuntuales = lazy(() => import('./pages/EntradasPuntuales/EntradasPuntuales'))
const ControlHorario = lazy(() => import('./pages/ControlHorario/ControlHorario'))
const TPV = lazy(() => import('./pages/TPV/TPV'))
const DashboardTPV = lazy(() => import('./pages/TPV/DashboardTPV'))
const ProveedoresTPV = lazy(() => import('./pages/TPV/ProveedoresTPV'))

// ── Portal del cliente NoofitPro ───────────────────────────────────────────
const PortalLogin   = lazy(() => import('./pages/PortalCliente/PortalLogin'))
const PortalLayout  = lazy(() => import('./pages/PortalCliente/PortalLayout'))
const PortalHome    = lazy(() => import('./pages/PortalCliente/PortalHome'))
const FicharTab     = lazy(() => import('./pages/PortalCliente/FicharTab'))
const MisJornadasTab = lazy(() => import('./pages/PortalCliente/MisJornadasTab'))
const AusenciasTabPortal = lazy(() => import('./pages/PortalCliente/AusenciasTab'))
const PerfilTab     = lazy(() => import('./pages/PortalCliente/PerfilTab'))
const BuzonTab      = lazy(() => import('./pages/PortalCliente/BuzonTab'))
const ReservasTab   = lazy(() => import('./pages/PortalCliente/ReservasTab'))
const RetosTab      = lazy(() => import('./pages/PortalCliente/RetosTab'))
const EntrenamientosTab    = lazy(() => import('./pages/PortalCliente/EntrenamientosTab'))
const EntrenamientoDetalle = lazy(() => import('./pages/PortalCliente/EntrenamientoDetalle'))
const LogrosTab     = lazy(() => import('./pages/PortalCliente/PlaceholderTab').then(m => ({ default: m.LogrosTab })))
const CrmPage = lazy(() => import('./pages/CRM/CrmPage'))
const SocialAgenda = lazy(() => import('./pages/SocialAgenda'))
const NotificacionesPage = lazy(() => import('./pages/Notificaciones/NotificacionesPage'))
const ContabilidadPage = lazy(() => import('./pages/Contabilidad/ContabilidadPage'))
const Incidencias = lazy(() => import('./pages/Incidencias/Incidencias'))
const PublicForm = lazy(() => import('./pages/PublicForm/PublicForm'))
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
        <Route path="/login" element={user ? <Navigate to="/clientes" replace /> : <Login />} />
        <Route path="/verificar" element={<VerifyAccount mode="verify" />} />
        <Route path="/reset"     element={<VerifyAccount mode="reset" />} />

        {/* Formulario público embebible (iframe en webs de los managers).
            Sin auth, sin Layout — documento autónomo. */}
        <Route path="/f/:publicId" element={<PublicForm />} />

        {/* Portal del cliente NoofitPro (auth aislada del admin) */}
        <Route path="/portal/login" element={<PortalLogin />} />
        <Route path="/portal" element={<PortalLayout />}>
          <Route index             element={<PortalHome />} />
          <Route path="fichar"     element={<FicharTab />} />
          <Route path="mis-jornadas"       element={<MisJornadasTab />} />
          <Route path="ausencias"          element={<AusenciasTabPortal />} />
          <Route path="buzon"              element={<BuzonTab />} />
          <Route path="entrenamientos"     element={<EntrenamientosTab />} />
          <Route path="entrenamientos/:id" element={<EntrenamientoDetalle />} />
          <Route path="perfil"     element={<PerfilTab />} />
          <Route path="reservas"   element={<ReservasTab />} />
          <Route path="retos"      element={<RetosTab />} />
          <Route path="logros"     element={<LogrosTab />} />
        </Route>

        <Route element={<RequireAuth><Layout /></RequireAuth>}>
          <Route index                  element={<Navigate to="/clientes" replace />} />
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
          <Route path="/informe-asistencia"          element={<InformeAsistencia />} />
          <Route path="/informe-asistencia/:tab"     element={<InformeAsistencia />} />
          <Route path="/informe-clientes"            element={<InformeClientes />} />
          <Route path="/informe-ejercicios"          element={<InformeEjercicios />} />
          <Route path="/informe-competiciones"       element={<InformeCompeticiones />} />
          <Route path="/informe-integridad"          element={<InformeIntegridad />} />
          <Route path="/analisis-clusters"    element={<AnalisisClusters />} />
          <Route path="/erp-configuracion"   element={<ERPConfiguracion />} />
          <Route path="/configuracion"       element={<Configuracion />} />
          <Route path="/cuotas-clientes"     element={<CuotasClientes />} />
          <Route path="/entradas-puntuales"  element={<EntradasPuntuales />} />
          <Route path="/control-horario"     element={<ControlHorario />} />
          <Route path="/tpv"                 element={<TPV />} />
          <Route path="/tpv/dashboard"       element={<DashboardTPV />} />
          <Route path="/tpv/proveedores"     element={<ProveedoresTPV />} />
          <Route path="/crm"                 element={<CrmPage />} />
          <Route path="/agenda-social"       element={<SocialAgenda />} />
          <Route path="/notificaciones"      element={<NotificacionesPage />} />
          <Route path="/contabilidad"        element={<ContabilidadPage />} />
          <Route path="/clases-modificacion" element={<ClasesModificacion />} />
          <Route path="/notas" element={<NotasPage />} />
          <Route path="/incidencias" element={<Incidencias />} />
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
          <PortalAuthProvider>
            <TrainerFilterProvider>
              <ToastProvider>
                <AppRoutes />
              </ToastProvider>
            </TrainerFilterProvider>
          </PortalAuthProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
