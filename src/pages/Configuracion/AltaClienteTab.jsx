// Tab "Alta de cliente" — configura por trainer cómo se da de alta un
// cliente nuevo en mynoofit y se vincula al centro.
//
// Tres modos disponibles (radio):
//   1. QR del CENTRO (recomendado para captación abierta)
//   2. QR de la FICHA del cliente (recomendado si controlas el alta)
//   3. AMBOS (máxima flexibilidad)
//
// El cambio se aplica al instante: los QR del menú clientes y de la ficha
// aparecen/desaparecen automáticamente según el modo elegido.
import { useState, useEffect, useMemo } from 'react'
import { QrCode, Check, RefreshCw, Loader2, IdCard, Users } from 'lucide-react'
import { Card, Btn, Badge } from '../../components/UI'
import { useToast } from '../../components/Toast'
import { centrosList, altaModoSet } from '../../utils/configApi'


const MODOS = [
  {
    id: 'centro',
    icon: Users,
    title: 'QR del centro',
    subtitle: 'Captación abierta — sin alta previa',
    detail:
      'El QR del centro aparece arriba a la derecha en el menú Clientes. Cuando ' +
      'un cliente nuevo lo escanea con mynoofit, se da de alta automáticamente y ' +
      'queda vinculado a este trainer. No hace falta crearle ficha antes.',
    usar:
      '✓ Capta clientes nuevos in situ: lo enseñas en recepción y se inscriben solos.',
    pro: 'Más cómodo para captación rápida; el cliente se da de alta él mismo.',
    con: 'No controlas el alta. Cualquiera con acceso al QR puede vincularse.',
  },
  {
    id: 'individual',
    icon: IdCard,
    title: 'QR en la ficha del cliente',
    subtitle: 'Alta controlada — la ficha ya existe',
    detail:
      'El QR del centro NO aparece. Primero el gestor crea la ficha del cliente; ' +
      'esa ficha muestra un QR personal que el cliente escanea con mynoofit para ' +
      'vincular su cuenta a su ficha concreta.',
    usar:
      '✓ Tienes un alta previa (con datos, IBAN, cuota…) y el cliente solo enlaza ' +
      'su mynoofit a la ficha que ya existe.',
    pro: 'Control total del alta. El cliente se vincula a SU ficha — sin errores.',
    con: 'Requiere crear la ficha antes de que el cliente pueda usar mynoofit.',
  },
  {
    id: 'ambos',
    icon: QrCode,
    title: 'Ambos a la vez',
    subtitle: 'Máxima flexibilidad',
    detail:
      'Tanto el QR del centro (menú clientes) como el QR de cada ficha están ' +
      'disponibles. Puedes captar nuevos con el QR del centro y, a la vez, ' +
      'vincular fichas existentes con el QR personal.',
    usar: '✓ Quieres tener las dos vías abiertas simultáneamente.',
    pro: 'Cubre captación y altas manuales con una sola configuración.',
    con: 'Más opciones = más riesgo de elegir la incorrecta. Asegúrate de explicarlo a tu equipo.',
  },
]


export default function AltaClienteTab({ identity }) {
  const toast = useToast()
  const [centros, setCentros] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState({})  // id_trainer → bool

  async function reload() {
    setLoading(true)
    try {
      const rows = await centrosList(identity) || []
      setCentros(rows)
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setLoading(false)
  }
  useEffect(() => { reload() }, [identity.managerId])

  async function cambiarModo(trainer, modo) {
    setSaving(s => ({ ...s, [trainer.id_trainer]: true }))
    try {
      await altaModoSet(identity, trainer.id_trainer, modo)
      setCentros(cs => cs.map(c =>
        c.id_trainer === trainer.id_trainer
          ? { ...c, alta_cliente_modo: modo } : c))
      toast.success(`Modo actualizado a "${MODOS.find(m => m.id === modo).title}"`)
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setSaving(s => ({ ...s, [trainer.id_trainer]: false }))
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <p style={{ fontSize: 13, color: 'var(--text-2)', margin: 0, lineHeight: 1.6 }}>
          Configura cómo se dan de alta los clientes nuevos en mynoofit y cómo se
          vinculan al centro. El cambio aplica <strong>al instante</strong> — el
          QR del centro (menú Clientes) y el QR de cada ficha aparecen o se ocultan
          automáticamente según el modo que elijas para cada trainer.
        </p>
      </div>

      {/* Explicación de los 3 modos */}
      <Card style={{ padding: 16, marginBottom: 16,
                     background: 'var(--bg-2)', border: '1px solid var(--line)' }}>
        <p style={{ fontSize: 11, color: 'var(--text-3)',
                    textTransform: 'uppercase', letterSpacing: '0.05em',
                    margin: '0 0 12px', fontWeight: 700 }}>
          Cómo funciona cada modo
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
          {MODOS.map(m => (
            <div key={m.id} style={{ padding: 12, borderRadius: 10,
                                      background: 'var(--bg-1)',
                                      border: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <m.icon size={18} style={{ color: 'var(--green)' }} />
                <strong style={{ fontSize: 13, color: 'var(--text-0)' }}>{m.title}</strong>
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-3)', margin: '0 0 8px',
                          fontStyle: 'italic' }}>{m.subtitle}</p>
              <p style={{ fontSize: 12, color: 'var(--text-1)', margin: '0 0 8px', lineHeight: 1.5 }}>
                {m.detail}
              </p>
              <p style={{ fontSize: 11, color: 'var(--text-2)', margin: '4px 0' }}>{m.usar}</p>
              <p style={{ fontSize: 11, color: 'var(--green)', margin: '4px 0' }}>
                <strong>Ventaja:</strong> {m.pro}
              </p>
              <p style={{ fontSize: 11, color: 'var(--amber)', margin: '4px 0' }}>
                <strong>Cuidado:</strong> {m.con}
              </p>
            </div>
          ))}
        </div>
      </Card>

      {/* Configuración por trainer */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    marginBottom: 12 }}>
        <strong style={{ fontSize: 13, color: 'var(--text-2)' }}>
          Configuración por centro
        </strong>
        <Btn variant="secondary" size="sm" onClick={reload}>
          <RefreshCw size={13} /> Refrescar
        </Btn>
      </div>

      {loading ? (
        <Card style={{ padding: 32, textAlign: 'center' }}>
          <Loader2 size={20} className="animate-spin" />
        </Card>
      ) : centros.length === 0 ? (
        <Card style={{ padding: 24, textAlign: 'center' }}>
          <p style={{ fontSize: 13, color: 'var(--text-3)' }}>
            No hay centros configurados. Crea primero los centros en la pestaña «Centros».
          </p>
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {centros.map(c => (
            <TrainerRow key={c.id_trainer} trainer={c}
                         saving={!!saving[c.id_trainer]}
                         onChange={modo => cambiarModo(c, modo)} />
          ))}
        </div>
      )}
    </div>
  )
}


function TrainerRow({ trainer, saving, onChange }) {
  const modoActual = trainer.alta_cliente_modo || 'centro'
  return (
    <Card style={{ padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <strong style={{ fontSize: 14, color: 'var(--text-0)' }}>
            {trainer.nombre_centro || `Trainer ${trainer.id_trainer}`}
          </strong>
          {trainer.slug && (
            <span style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 8,
                           fontFamily: 'var(--font-mono)' }}>
              /{trainer.slug}
            </span>
          )}
          <span style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 8,
                         fontFamily: 'var(--font-mono)' }}>
            id {trainer.id_trainer}
          </span>
        </div>
        {saving && <Loader2 size={14} className="animate-spin" />}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
        {MODOS.map(m => {
          const sel = modoActual === m.id
          return (
            <button key={m.id} type="button" disabled={saving}
                    onClick={() => !sel && onChange(m.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px',
                      borderRadius: 10, cursor: sel ? 'default' : 'pointer',
                      background: sel ? 'var(--green-bg)' : 'var(--bg-2)',
                      border: `2px solid ${sel ? 'var(--green)' : 'var(--line)'}`,
                      textAlign: 'left', fontFamily: 'inherit',
                      transition: 'all 0.15s',
                      opacity: saving ? 0.6 : 1,
                    }}>
              <m.icon size={18} style={{ flexShrink: 0,
                color: sel ? 'var(--green)' : 'var(--text-3)' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: sel ? 700 : 500,
                              color: sel ? 'var(--green)' : 'var(--text-0)' }}>
                  {m.title}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--text-3)',
                              marginTop: 1 }}>{m.subtitle}</div>
              </div>
              {sel && <Check size={14} style={{ color: 'var(--green)' }} />}
            </button>
          )
        })}
      </div>
    </Card>
  )
}
