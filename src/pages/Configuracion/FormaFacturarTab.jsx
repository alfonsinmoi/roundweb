// Pestaña Forma de facturar — el manager elige uno de los 3 modos.
import { useEffect, useMemo, useState } from 'react'
import { Receipt, FileText, FileCheck2, Save, Check, Loader2 } from 'lucide-react'
import { Card, Btn, SectionTitle, Badge } from '../../components/UI'
import { useToast } from '../../components/Toast'
import { useAuth } from '../../contexts/AuthContext'
import { getRoundIdentity } from '../../utils/configApi'

const TOKEN = import.meta.env.VITE_CONFIG_API_TOKEN || ''

const MODOS = [
  {
    id: 'recibo_trimestre',
    icon: Receipt,
    color: 'green',
    titulo: 'Opción 1 · Recibos mensuales + facturación trimestral',
    subtitulo: 'Recomendado · Lo más limpio fiscalmente',
    flujo: [
      'Cada mes: el sistema emite recibos (en BD interna). Los SEPA y tarjeta se marcan pagados al instante; los de caja quedan como impagados hasta que el cliente paga.',
      'En Odoo se crea solo el cobro (account.payment). NO se crean facturas todavía.',
      'Al cerrar el trimestre, el sistema avisa al manager. Aparece un Excel con los recibos cobrados pendientes de facturación.',
      'El manager marca cuáles facturar → se generan facturas reales en Odoo (out_invoice) con número correlativo definitivo.',
      'Los recibos no marcados quedan en una tabla aparte para revisión posterior.',
    ],
    pros: [
      'El manager controla qué se factura formalmente.',
      'Útil cuando algunos clientes piden factura agrupada (3 meses juntos) y otros no.',
      'Tabla clara de recibos pendientes de facturación.',
    ],
    contras: [
      'El número correlativo de factura se asigna al cierre del trimestre, no en el mes.',
      'Hay que recordar revisar cada trimestre.',
    ],
  },
  {
    id: 'factura_draft',
    icon: FileText,
    color: 'blue',
    titulo: 'Opción 2 · Facturas borrador mensuales + posteo trimestral',
    subtitulo: 'Mixto',
    flujo: [
      'Cada mes: el sistema crea facturas borrador (draft) en Odoo + cobros (account.payment). Sin número correlativo aún.',
      'Las facturas borrador permiten previsualizar el resumen.',
      'Al cerrar el trimestre, el manager revisa los borradores y los postea en bloque → quedan facturas definitivas con número correlativo.',
      'Los borradores no posteados se quedan en revisión.',
    ],
    pros: [
      'Trazabilidad inmediata en Odoo (el manager ve borradores en cuanto se generan).',
      'El manager hace una revisión final antes de "convertir" en facturas.',
    ],
    contras: [
      'Los borradores ocupan espacio en Odoo aunque luego no se posteen.',
      'Más complejidad operativa.',
    ],
  },
  {
    id: 'factura_directa',
    icon: FileCheck2,
    color: 'amber',
    titulo: 'Opción 3 · Facturación directa mensual',
    subtitulo: 'El más rápido pero menos flexible',
    flujo: [
      'Cada mes: el sistema crea facturas reales (out_invoice posteadas) en Odoo + cobros (account.payment). Con número correlativo definitivo.',
      'Al cerrar el trimestre solo hay un informe de control (resumen de lo emitido).',
      'No hay paso intermedio de revisión.',
    ],
    pros: [
      'Cada cobro tiene su factura inmediata.',
      'Operativa más simple — no requiere acción trimestral.',
    ],
    contras: [
      'Si surge un error en el mes, hay que rectificar con factura rectificativa (más papel).',
      'No permite agrupar facturas por trimestre para clientes que lo piden así.',
    ],
  },
]


export default function FormaFacturarTab() {
  const { user } = useAuth()
  const identity = useMemo(() => getRoundIdentity(user), [user])
  const toast = useToast()
  const [modoActual, setModoActual] = useState(null)
  const [seleccion, setSeleccion] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  async function reload() {
    setLoading(true)
    try {
      const r = await fetch('/api/config/modo-facturacion', {
        headers: {
          'X-Round-Token': TOKEN,
          'X-Round-Manager-Id': String(identity?.managerId || ''),
        },
      })
      const d = await r.json()
      if (d.ok) {
        setModoActual(d.modo_facturacion)
        setSeleccion(d.modo_facturacion)
      }
    } catch (e) { toast.error('No se pudo cargar') }
    finally { setLoading(false) }
  }
  useEffect(() => { if (identity?.managerId) reload() }, [identity?.managerId])

  const handleGuardar = async () => {
    if (!seleccion || seleccion === modoActual) return
    if (!window.confirm(`¿Cambiar el modo de facturación a "${seleccion}"?\n\nAfecta a TODAS las emisiones futuras.`)) return
    setSaving(true)
    try {
      const r = await fetch('/api/config/modo-facturacion', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Round-Token': TOKEN,
          'X-Round-Manager-Id': String(identity?.managerId || ''),
        },
        body: JSON.stringify({ modo_facturacion: seleccion }),
      })
      const d = await r.json()
      if (!d.ok) throw new Error(d.error || 'Error guardando')
      toast.success('Modo de facturación actualizado')
      setModoActual(seleccion)
    } catch (e) { toast.error(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div>
      <Card style={{ padding: 20, marginBottom: 20 }}>
        <SectionTitle><Receipt size={16} style={{ marginRight: 8 }} /> Forma de facturar</SectionTitle>
        <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6, marginTop: 8 }}>
          Elige cómo quieres que el sistema gestione las facturas y los cobros mensuales.
          Esta decisión afecta a las próximas emisiones — no afecta a recibos ya emitidos.
        </p>
        {modoActual && (
          <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8 }}>
            Modo actual: <Badge color="green">{MODOS.find(m => m.id === modoActual)?.titulo || modoActual}</Badge>
          </p>
        )}
      </Card>

      {loading ? (
        <Card style={{ padding: 40, textAlign: 'center' }}>
          <Loader2 size={20} className="animate-spin" style={{ color: 'var(--green)' }} />
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {MODOS.map(m => (
            <ModoCard key={m.id}
                      modo={m}
                      seleccionado={seleccion === m.id}
                      esActual={modoActual === m.id}
                      onSelect={() => setSeleccion(m.id)} />
          ))}
        </div>
      )}

      <div style={{ marginTop: 20, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <Btn variant="primary" onClick={handleGuardar}
             disabled={saving || !seleccion || seleccion === modoActual}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {seleccion === modoActual ? 'Sin cambios' : 'Guardar modo'}
        </Btn>
      </div>
    </div>
  )
}


function ModoCard({ modo, seleccionado, esActual, onSelect }) {
  const Icon = modo.icon
  return (
    <button type="button" onClick={onSelect}
            style={{
              all: 'unset', cursor: 'pointer', display: 'block', width: '100%',
              padding: 20, borderRadius: 16,
              background: seleccionado ? `var(--${modo.color}-bg)` : 'var(--bg-1)',
              border: `2px solid ${seleccionado ? `var(--${modo.color})` : 'var(--line)'}`,
              transition: 'all 0.15s',
            }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <div style={{
          padding: 10, borderRadius: 10,
          background: `var(--${modo.color}-bg)`, color: `var(--${modo.color})`,
          flexShrink: 0,
        }}>
          <Icon size={20} aria-hidden="true" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
            <h3 style={{ fontFamily: 'Outfit', fontSize: 16, fontWeight: 600, color: 'var(--text-0)', margin: 0 }}>
              {modo.titulo}
            </h3>
            {esActual && <Badge color="green">activo</Badge>}
            {seleccionado && !esActual && <Badge color={modo.color}>seleccionado</Badge>}
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0 }}>{modo.subtitulo}</p>

          <div style={{ marginTop: 12 }}>
            <strong style={{ fontSize: 11, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Cómo funciona:
            </strong>
            <ol style={{ fontSize: 13, color: 'var(--text-1)', lineHeight: 1.6, marginTop: 6, paddingLeft: 22 }}>
              {modo.flujo.map((step, i) => <li key={i} style={{ marginBottom: 4 }}>{step}</li>)}
            </ol>
          </div>

          <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <strong style={{ fontSize: 11, color: 'var(--green)', textTransform: 'uppercase' }}>Pros</strong>
              <ul style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4, paddingLeft: 18 }}>
                {modo.pros.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            </div>
            <div>
              <strong style={{ fontSize: 11, color: 'var(--red)', textTransform: 'uppercase' }}>Contras</strong>
              <ul style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4, paddingLeft: 18 }}>
                {modo.contras.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </button>
  )
}
