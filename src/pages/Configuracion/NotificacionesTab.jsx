// Configuración de notificaciones automáticas + plantillas custom
// per (manager, trainer).

import { useState, useEffect } from 'react'
import { Bell, Save, Loader2, Calendar, AlertCircle } from 'lucide-react'
import { Card, Btn, SectionTitle } from '../../components/UI'
import { useToast } from '../../components/Toast'
import { notifConfigGet, notifConfigPut } from '../../utils/configApi'
import { NOTIF_TIPOS } from '../../utils/notifCatalog'

export default function NotificacionesTab({ identity }) {
  const toast = useToast()
  const [cfg, setCfg] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    notifConfigGet(identity)
      .then(c => setCfg({
        dia_envio_impago_efectivo: c?.dia_envio_impago_efectivo ?? 5,
        auto_impago_efectivo: c?.auto_impago_efectivo ?? true,
        auto_devolucion: c?.auto_devolucion ?? true,
        auto_enlace_pago: c?.auto_enlace_pago ?? true,
        auto_pago_alta: c?.auto_pago_alta ?? true,
        plantillas: c?.plantillas || {},
      }))
      .catch(e => toast.error(`Error: ${e.message}`))
      .finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity?.managerId, identity?.trainerId])

  const save = async () => {
    setSaving(true)
    try {
      await notifConfigPut(identity, cfg)
      toast.success('Configuración guardada')
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setSaving(false)
  }

  const setPlantilla = (tipoId, campo, valor) => {
    setCfg(c => ({
      ...c,
      plantillas: {
        ...c.plantillas,
        [tipoId]: { ...(c.plantillas?.[tipoId] || {}), [campo]: valor },
      },
    }))
  }

  if (loading || !cfg) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
      <Loader2 size={20} className="animate-spin" style={{ color: 'var(--green)' }} />
    </div>
  )

  const tiposAuto = NOTIF_TIPOS.filter(t => t.auto)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card style={{ padding: 20 }}>
        <SectionTitle>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Calendar size={16} aria-hidden="true" /> Cuándo enviar avisos automáticos
          </span>
        </SectionTitle>
        <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 14 }}>
          Día del mes en que el sistema busca recibos en efectivo emitidos de la
          mensualidad y todavía sin cobrar para enviar el aviso al cliente.
          (0 = desactivado.)
        </p>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={lblStyle}>Día del mes (1-31)</span>
            <input type="number" min={0} max={31} value={cfg.dia_envio_impago_efectivo}
                   onChange={e => setCfg(c => ({ ...c, dia_envio_impago_efectivo: parseInt(e.target.value, 10) || 0 }))}
                   style={{ ...inputStyle, width: 100 }} />
          </label>
        </div>
      </Card>

      <Card style={{ padding: 20 }}>
        <SectionTitle>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Bell size={16} aria-hidden="true" /> Notificaciones automáticas activas
          </span>
        </SectionTitle>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            ['auto_impago_efectivo', 'Recibos impagados (efectivo)', 'Cron diario el día configurado arriba'],
            ['auto_devolucion',      'Devoluciones SEPA',            'Webhook desde Odoo cuando llegue una devolución'],
            ['auto_enlace_pago',     'Enlace de pago enviado',       'Cuando el manager genera un link PayComet'],
            ['auto_pago_alta',       'Pago confirmado (alta)',       'Disparado por callback PayComet tras pago OK'],
          ].map(([key, label, desc]) => (
            <label key={key} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 14px', borderRadius: 10, background: 'var(--bg-1)', cursor: 'pointer' }}>
              <input type="checkbox" checked={!!cfg[key]}
                     onChange={e => setCfg(c => ({ ...c, [key]: e.target.checked }))}
                     style={{ marginTop: 4 }} />
              <div>
                <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-0)' }}>{label}</p>
                <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{desc}</p>
              </div>
            </label>
          ))}
        </div>
      </Card>

      <Card style={{ padding: 20 }}>
        <SectionTitle>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertCircle size={16} aria-hidden="true" /> Plantillas (opcional)
          </span>
        </SectionTitle>
        <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 14 }}>
          Personaliza el título y cuerpo por tipo de notificación. Si dejas en
          blanco se usa la plantilla por defecto del sistema. Variables soportadas:
          <code style={{ background: 'var(--bg-3)', padding: '1px 6px', marginLeft: 4, borderRadius: 4 }}>
            {'{{cliente_nombre}}'}
          </code>{', '}
          <code style={{ background: 'var(--bg-3)', padding: '1px 6px', borderRadius: 4 }}>
            {'{{importe}}'}
          </code>{', '}
          <code style={{ background: 'var(--bg-3)', padding: '1px 6px', borderRadius: 4 }}>
            {'{{fecha_emision}}'}
          </code>{', '}
          <code style={{ background: 'var(--bg-3)', padding: '1px 6px', borderRadius: 4 }}>
            {'{{centro}}'}
          </code>{', '}
          <code style={{ background: 'var(--bg-3)', padding: '1px 6px', borderRadius: 4 }}>
            {'{{url}}'}
          </code>.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {tiposAuto.map(t => {
            const p = cfg.plantillas?.[t.id] || {}
            return (
              <div key={t.id} style={{ padding: 14, borderRadius: 10, border: '1px solid var(--line)' }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-0)', marginBottom: 8 }}>
                  {t.nombre} <span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 400 }}>· {t.seccion}</span>
                </p>
                <input value={p.titulo || ''}
                       onChange={e => setPlantilla(t.id, 'titulo', e.target.value)}
                       placeholder="Título (vacío = usa default)"
                       style={{ ...inputStyle, marginBottom: 6 }} />
                <textarea value={p.cuerpo || ''}
                          onChange={e => setPlantilla(t.id, 'cuerpo', e.target.value)}
                          placeholder="Cuerpo (vacío = usa default)"
                          rows={2}
                          style={{ ...inputStyle, fontFamily: 'inherit' }} />
              </div>
            )
          })}
        </div>
      </Card>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Btn variant="primary" onClick={save} disabled={saving}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Guardar
        </Btn>
      </div>
    </div>
  )
}

const lblStyle = { fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }
const inputStyle = {
  width: '100%', padding: '8px 10px', borderRadius: 8, fontSize: 13,
  background: 'var(--bg-1)', border: '1px solid var(--line)', color: 'var(--text-0)',
}
