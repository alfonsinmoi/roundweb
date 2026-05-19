// Configuración de notificaciones automáticas + plantillas custom
// per (manager, trainer).

import { useState, useEffect } from 'react'
import { Bell, Save, Loader2, Calendar, AlertCircle, BookOpen, Copy, Check, X, Link2, Eye } from 'lucide-react'
import { Card, Btn, SectionTitle, Badge } from '../../components/UI'
import Modal from '../../components/Modal'
import { useToast } from '../../components/Toast'
import { notifConfigGet, notifConfigPut } from '../../utils/configApi'
import { NOTIF_TIPOS, NOTIF_SECCIONES, SECCION_BY_ID, TIPO_BY_ID } from '../../utils/notifCatalog'

export default function NotificacionesTab({ identity }) {
  const toast = useToast()
  const [cfg, setCfg] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showDefaults, setShowDefaults] = useState(false)

  useEffect(() => {
    notifConfigGet(identity)
      .then(c => setCfg({
        dia_envio_impago_efectivo: c?.dia_envio_impago_efectivo ?? 5,
        auto_impago_efectivo: c?.auto_impago_efectivo ?? true,
        auto_devolucion: c?.auto_devolucion ?? true,
        auto_enlace_pago: c?.auto_enlace_pago ?? true,
        auto_pago_alta: c?.auto_pago_alta ?? true,
        auto_link_devolucion: c?.auto_link_devolucion ?? true,
        auto_link_impago_efectivo: c?.auto_link_impago_efectivo ?? true,
        auto_link_efectivo_dia: c?.auto_link_efectivo_dia ?? 0,
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

  // Copia el default del sistema al campo de override
  const usarDefault = (tipoId) => {
    const t = TIPO_BY_ID[tipoId]
    if (!t) return
    setCfg(c => ({
      ...c,
      plantillas: {
        ...c.plantillas,
        [tipoId]: { titulo: t.plantilla_titulo || '', cuerpo: t.plantilla_cuerpo || '' },
      },
    }))
    toast.success('Plantilla por defecto cargada')
  }

  if (loading || !cfg) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
      <Loader2 size={20} className="animate-spin" style={{ color: 'var(--green)' }} />
    </div>
  )

  const tiposAuto = NOTIF_TIPOS.filter(t => t.auto)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ─── Cuándo enviar avisos automáticos ─── */}
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

      {/* ─── Auto-cobro online (link de pago) ─── */}
      <Card style={{ padding: 20, border: '1px solid var(--blue-border)', background: 'var(--blue-bg)' }}>
        <SectionTitle>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Link2 size={16} aria-hidden="true" /> Auto-cobro online (link de pago)
          </span>
        </SectionTitle>
        <p style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 14, lineHeight: 1.5 }}>
          Si tienes un TPV virtual configurado en <strong>Pasarelas</strong> (PayComet u otro),
          el sistema puede generar automáticamente un link de pago y mandarlo en el
          mismo aviso al cliente. Si no hay pasarela configurada, los avisos se mandan
          igual pero sin enlace.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
          <label style={chkRowStyle}>
            <input type="checkbox" checked={!!cfg.auto_link_devolucion}
                   onChange={e => setCfg(c => ({ ...c, auto_link_devolucion: e.target.checked }))} />
            <div>
              <p style={chkLabelStyle}>Devolución SEPA → adjunta link de pago</p>
              <p style={chkDescStyle}>Cuando el banco devuelve un recibo, el aviso al cliente incluye un enlace para pagar online directamente.</p>
            </div>
          </label>
          <label style={chkRowStyle}>
            <input type="checkbox" checked={!!cfg.auto_link_impago_efectivo}
                   onChange={e => setCfg(c => ({ ...c, auto_link_impago_efectivo: e.target.checked }))} />
            <div>
              <p style={chkLabelStyle}>Aviso impagado efectivo → adjunta link de pago</p>
              <p style={chkDescStyle}>El aviso del día configurado arriba incluye también un link para pagar online.</p>
            </div>
          </label>
        </div>

        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-0)', marginBottom: 6 }}>
            Cobro masivo de clientes en efectivo
          </p>
          <p style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 10, lineHeight: 1.5 }}>
            Día del mes en que el sistema envía un link de pago a <strong>todos los clientes con forma de pago efectivo</strong> que tengan recibo del mes pendiente de cobro.
            Útil para cobrar online sin esperar a que pasen por el centro. (0 = desactivado, gestión manual.)
          </p>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={lblStyle}>Día del mes (1-31)</span>
            <input type="number" min={0} max={31} value={cfg.auto_link_efectivo_dia}
                   onChange={e => setCfg(c => ({ ...c, auto_link_efectivo_dia: parseInt(e.target.value, 10) || 0 }))}
                   style={{ ...inputStyle, width: 100 }} />
          </label>
        </div>
      </Card>

      {/* ─── Notificaciones automáticas activas ─── */}
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
            <label key={key} style={chkRowStyle}>
              <input type="checkbox" checked={!!cfg[key]}
                     onChange={e => setCfg(c => ({ ...c, [key]: e.target.checked }))} />
              <div>
                <p style={chkLabelStyle}>{label}</p>
                <p style={chkDescStyle}>{desc}</p>
              </div>
            </label>
          ))}
        </div>
      </Card>

      {/* ─── Plantillas (con botón de defaults) ─── */}
      <Card style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          <SectionTitle style={{ marginBottom: 0, flex: 1 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertCircle size={16} aria-hidden="true" /> Plantillas (opcional)
            </span>
          </SectionTitle>
          <Btn variant="secondary" size="sm" onClick={() => setShowDefaults(true)}>
            <BookOpen size={14} aria-hidden="true" /> Plantillas por defecto
          </Btn>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 14 }}>
          Personaliza el título y cuerpo por tipo de notificación. Si dejas en
          blanco se usa la plantilla por defecto del sistema. Pulsa el botón
          <strong> Plantillas por defecto</strong> para ver el catálogo o cargar una como base.
          Variables soportadas:
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
            const overriden = (p.titulo && p.titulo !== t.plantilla_titulo) ||
                              (p.cuerpo && p.cuerpo !== t.plantilla_cuerpo)
            return (
              <div key={t.id} style={{ padding: 14, borderRadius: 10, border: '1px solid var(--line)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                  <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-0)', margin: 0 }}>
                    {t.nombre} <span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 400 }}>· {t.seccion}</span>
                    {overriden && <Badge color="amber" style={{ marginLeft: 8 }}>personalizada</Badge>}
                  </p>
                  <button type="button" onClick={() => usarDefault(t.id)}
                          style={btnLinkStyle}
                          title="Carga la plantilla por defecto del sistema en estos campos">
                    <Copy size={11} aria-hidden="true" /> Usar default
                  </button>
                </div>
                <input value={p.titulo || ''}
                       onChange={e => setPlantilla(t.id, 'titulo', e.target.value)}
                       placeholder={t.plantilla_titulo ? `(default: ${t.plantilla_titulo})` : 'Título (vacío = usa default)'}
                       style={{ ...inputStyle, marginBottom: 6 }} />
                <textarea value={p.cuerpo || ''}
                          onChange={e => setPlantilla(t.id, 'cuerpo', e.target.value)}
                          placeholder={t.plantilla_cuerpo ? `(default: ${t.plantilla_cuerpo})` : 'Cuerpo (vacío = usa default)'}
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

      {showDefaults && (
        <DefaultsModal
          onClose={() => setShowDefaults(false)}
          onUsar={(tipoId) => { usarDefault(tipoId); setShowDefaults(false) }}
        />
      )}
    </div>
  )
}


// ── Modal con catálogo completo de plantillas por defecto ────────────────────
function DefaultsModal({ onClose, onUsar }) {
  return (
    <Modal open={true} onClose={onClose} maxWidth={760}
           title="Plantillas por defecto del sistema">
      <div style={{ padding: 24, flex: 1, overflowY: 'auto', minHeight: 0 }}>
        <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 16, lineHeight: 1.5 }}>
          Estas son las plantillas que el sistema usa cuando dejas los campos vacíos en
          tu configuración. Pulsa <strong>Usar como base</strong> sobre cualquiera para
          copiarla a tu formulario y poder personalizarla.
        </p>

        {NOTIF_SECCIONES.map(sec => {
          const tiposSec = NOTIF_TIPOS.filter(t => t.seccion === sec.id)
          return (
            <div key={sec.id} style={{ marginBottom: 22 }}>
              <h3 style={{ fontSize: 14, color: `var(--${sec.color})`,
                            margin: '0 0 8px', fontFamily: 'Outfit', fontWeight: 600 }}>
                {sec.nombre}
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {tiposSec.map(t => {
                  const sinDefault = !t.plantilla_titulo && !t.plantilla_cuerpo
                  return (
                    <div key={t.id} style={{
                      padding: 12, borderRadius: 10,
                      background: sinDefault ? 'var(--bg-1)' : 'var(--bg-2)',
                      border: '1px solid var(--line)',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: sinDefault ? 0 : 6 }}>
                        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-0)', margin: 0 }}>
                          {t.nombre}
                          {t.auto && <Badge color="green" style={{ marginLeft: 8 }}>auto</Badge>}
                          {sinDefault && <Badge color="gray" style={{ marginLeft: 8 }}>libre</Badge>}
                        </p>
                        {!sinDefault && (
                          <Btn variant="secondary" size="sm" onClick={() => onUsar(t.id)}>
                            <Copy size={11} aria-hidden="true" /> Usar como base
                          </Btn>
                        )}
                      </div>
                      {!sinDefault && (
                        <>
                          <p style={{ fontSize: 11, color: 'var(--text-3)', margin: '6px 0 2px' }}>Título</p>
                          <p style={defValStyle}>{t.plantilla_titulo}</p>
                          <p style={{ fontSize: 11, color: 'var(--text-3)', margin: '8px 0 2px' }}>Cuerpo</p>
                          <p style={defValStyle}>{t.plantilla_cuerpo}</p>
                        </>
                      )}
                      {sinDefault && (
                        <p style={{ fontSize: 11, color: 'var(--text-3)', margin: '4px 0 0' }}>
                          Sin plantilla por defecto — al enviar este tipo el manager escribe el contenido cada vez.
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
      <div style={{ padding: '16px 24px', borderTop: '1px solid var(--line)',
                     display: 'flex', justifyContent: 'flex-end',
                     flexShrink: 0, background: 'var(--bg-2)' }}>
        <Btn variant="secondary" onClick={onClose}>Cerrar</Btn>
      </div>
    </Modal>
  )
}


const lblStyle = { fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }
const inputStyle = {
  width: '100%', padding: '8px 10px', borderRadius: 8, fontSize: 13,
  background: 'var(--bg-1)', border: '1px solid var(--line)', color: 'var(--text-0)',
}
const chkRowStyle = {
  display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 14px',
  borderRadius: 10, background: 'var(--bg-1)', cursor: 'pointer',
}
const chkLabelStyle = { fontSize: 13, fontWeight: 500, color: 'var(--text-0)' }
const chkDescStyle  = { fontSize: 11, color: 'var(--text-3)', marginTop: 2 }
const btnLinkStyle  = {
  fontSize: 11, color: 'var(--blue)', background: 'none',
  border: 'none', cursor: 'pointer', display: 'inline-flex',
  alignItems: 'center', gap: 4,
}
const defValStyle = {
  fontSize: 12, color: 'var(--text-1)', margin: 0,
  fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap',
  padding: '6px 10px', borderRadius: 6, background: 'var(--bg-1)',
  border: '1px solid var(--line)',
}
