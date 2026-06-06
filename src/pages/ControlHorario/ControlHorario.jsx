import { useState, useEffect } from 'react'
import { Clock } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { getRoundIdentity } from '../../utils/configApi'
import { useOdooStatus } from '../../hooks/useOdooStatus'
import { activarHorario } from '../../utils/horarioApi'
import { useToast } from '../../components/Toast'
import { useCan } from '../../hooks/useCan'
import { Card, Btn } from '../../components/UI'
import TrabajadoresTab   from './TrabajadoresTab'
import FichajesTab       from './FichajesTab'
import ConfiguracionTab  from './ConfiguracionTab'
import QrCentroTab       from './QrCentroTab'
import CorreccionesTab   from './CorreccionesTab'
import AusenciasTab      from './AusenciasTab'
import PlanificacionTab  from './PlanificacionTab'


const TABS = [
  { id: 'trabajadores',  label: 'Trabajadores',  comp: TrabajadoresTab },
  { id: 'fichajes',      label: 'Fichajes',      comp: FichajesTab },
  { id: 'ausencias',     label: 'Ausencias',     comp: AusenciasTab },
  { id: 'planificacion', label: 'Planificación', comp: PlanificacionTab },
  { id: 'qr',            label: 'QR del centro', comp: QrCentroTab },
  { id: 'correcciones',  label: 'Correcciones',  comp: CorreccionesTab },
  { id: 'config',        label: 'Configuración', comp: ConfiguracionTab },
]


function _readTabFromLocation() {
  try {
    const u = new URL(window.location.href)
    return (u.searchParams.get('tab') || u.hash.replace(/^#/, '') || '').trim() || null
  } catch { return null }
}


export default function ControlHorario() {
  const { user } = useAuth()
  const identity = getRoundIdentity(user)
  const { features, loading, refresh } = useOdooStatus()
  const toast = useToast()
  const [activeTab, setActiveTab] = useState(() => _readTabFromLocation() || 'trabajadores')
  const [activating, setActivating] = useState(false)
  const canActivar = useCan('control_horario.modulo.activar')

  // Sync tab ↔ URL hash
  useEffect(() => {
    try {
      const u = new URL(window.location.href)
      if (u.hash.replace(/^#/, '') !== activeTab) {
        u.hash = activeTab
        window.history.replaceState({}, '', u.toString())
      }
    } catch { /* ignore */ }
  }, [activeTab])

  async function handleActivar() {
    if (activating) return
    setActivating(true)
    try {
      await activarHorario(identity)
      toast.success('Módulo Control horario activado')
      await refresh()
    } catch (e) {
      toast.error('No se pudo activar: ' + (e.message || 'error'))
    } finally { setActivating(false) }
  }

  if (loading && !features) {
    return (
      <div style={{ maxWidth: 1100, padding: '0 4px' }}>
        <p style={{ color: 'var(--text-3)' }}>Cargando…</p>
      </div>
    )
  }

  // Si el módulo NO está activo, mostramos un mini-onboarding con el botón
  // de activación. No bloqueamos el acceso a la página (de hecho a esta
  // página sólo se llega si el menú la enseña — pero el sidebar oculta el
  // item si feature=false, así que técnicamente esto sólo se ve si se
  // navega manualmente a /control-horario o tras un refresh).
  if (features?.control_horario === false) {
    return (
      <div style={{ maxWidth: 720, padding: '0 4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <Clock size={22} style={{ color: 'var(--green)' }} aria-hidden="true" />
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, color: 'var(--text-0)', margin: 0 }}>
            Control horario laboral
          </h1>
        </div>
        <Card style={{ padding: 24, marginTop: 16 }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, marginTop: 0 }}>
            Módulo no activado
          </h2>
          <p style={{ color: 'var(--text-2)', fontSize: 14, lineHeight: 1.6 }}>
            Fichaje multidispositivo para tus trabajadores (categoría
            "Trabajador" en NoofitPro), pausas con motivo, correcciones
            con flujo de aprobación y registro inmutable conforme al
            art. 34.9 del Estatuto de los Trabajadores (RD-Ley 8/2019).
          </p>
          <ul style={{ color: 'var(--text-2)', fontSize: 13, paddingLeft: 18 }}>
            <li>Cada trainer puede ser su propia entidad jurídica</li>
            <li>QR rotativo cada 10 minutos como prueba de presencia</li>
            <li>Hash-chain SHA-256 para integridad (4 años de retención)</li>
            <li>Sin biometría (cumple AEPD 2023)</li>
          </ul>
          <div style={{ marginTop: 16 }}>
            {canActivar ? (
              <Btn onClick={handleActivar} disabled={activating}>
                {activating ? 'Activando…' : 'Activar módulo'}
              </Btn>
            ) : (
              <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0 }}>
                No tienes permiso para activar este módulo. Contacta con el admin.
              </p>
            )}
          </div>
        </Card>
      </div>
    )
  }

  const ActiveComp = TABS.find(t => t.id === activeTab)?.comp ?? TrabajadoresTab

  return (
    <div style={{ maxWidth: 1200, padding: '0 4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <Clock size={22} style={{ color: 'var(--green)' }} aria-hidden="true" />
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, color: 'var(--text-0)', margin: 0 }}>
          Control horario laboral
        </h1>
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 20 }}>
        Fichaje de trabajadores conforme al art. 34.9 ET. Los datos se
        conservan 4 años de forma inmutable (hash SHA-256 encadenado).
      </p>

      {/* Sub-tabs */}
      <div role="tablist" style={{
        display: 'flex', borderBottom: '1px solid var(--line)', marginBottom: 18,
        overflowX: 'auto',
      }}>
        {TABS.map(t => {
          const isActive = activeTab === t.id
          return (
            <button key={t.id}
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setActiveTab(t.id)}
                    style={{
                      position: 'relative', padding: '12px 18px',
                      background: 'none', border: 'none', cursor: 'pointer',
                      fontFamily: 'var(--font-display)',
                      fontSize: 14,
                      fontWeight: isActive ? 700 : 500,
                      color: isActive ? 'var(--text-0)' : 'var(--text-2)',
                      flexShrink: 0,
                    }}>
              {t.label}
              {isActive && <span aria-hidden="true" style={{
                position: 'absolute', bottom: -1, left: 12, right: 12, height: 2,
                background: 'var(--green)', borderRadius: 999,
              }} />}
            </button>
          )
        })}
      </div>

      <ActiveComp identity={identity} />
    </div>
  )
}
