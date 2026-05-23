/**
 * Configuración → Suscripciones (Fase 6 — activación granular por módulo).
 *
 * Reemplaza al "Despliegue total" del antiguo `ContabilidadActivacion`:
 * en lugar de un único wizard que activaba CRM + Cuotas + Contabilidad
 * a la vez, ofrece 3 sub-pestañas independientes que pueden activarse en
 * cualquier orden y combinación.
 *
 * Estructura:
 *   ┌── Cabecera: estado wcommerce (id + tipo) + "Comprobar"
 *   │     · Si no tipoPago='S' → invitación a contactar con Wiemspro
 *   │     · Si tipoPago='S' (o es el manager default) → habilita las 3 cards
 *   │
 *   ├── Sub-tabs: CRM · Cuotas · Contabilidad
 *   │
 *   └── Cada sub-tab muestra:
 *         · Descripción del módulo
 *         · Badge "activo" / "inactivo"
 *         · Botón "Activar" o "Reconfigurar" → abre wizard específico
 *         · Lista de endpoints/funciones que habilita (para que el
 *           manager entienda exactamente qué cambia)
 *
 * Backend: cada subtab llama a POST /api/manager/provision/<modulo>.
 * Compatible retro: el wizard antiguo (Despliegue total) sigue disponible
 * en la pestaña Contabilidad mientras todavía se usa.
 */
import { useState, useEffect } from 'react'
import { Layers, CheckCircle2, AlertCircle, Loader2, Send, ShieldCheck,
         Sparkles, ReceiptText, Calculator, ChevronRight } from 'lucide-react'
import { Card, Btn, Badge } from '../../components/UI'
import { useToast } from '../../components/Toast'
import { useOdooStatus } from '../../hooks/useOdooStatus'
import { managerWcCheck, managerSetWcommerceId } from '../../utils/configApi'
import WizardActivarCRM          from '../../components/WizardActivarCRM'
import WizardActivarCuotas       from '../../components/WizardActivarCuotas'
import WizardActivarContabilidad from '../../components/WizardActivarContabilidad'

const MODULOS = [
  {
    id: 'crm',
    label: 'CRM',
    icon: Sparkles,
    color: 'var(--blue)',
    descripcion: ('Pipeline de leads (formulario web + Meta Lead Ads), '
                  + 'kanban Round, score y razón de pérdida, embudo de conversión.'),
    habilita: [
      'Formulario web pública /prueba-gratuita',
      'Kanban leads con etapas (Nuevo → Contactado → Visita → Prueba → Alta)',
      'Score 0-100 + razones de pérdida',
      'Analítica de embudo (`/api/crm/funnel`)',
    ],
    flagKey: 'crm',
  },
  {
    id: 'cuotas',
    label: 'Cuotas',
    icon: ReceiptText,
    color: 'var(--green)',
    descripcion: ('Suscripciones mensuales/anuales, recibos SEPA, TPV virtual, '
                  + 'enlace de pago, tokenización. Numeración de facturas, '
                  + 'plan contable PYMES e IBAN principal.'),
    habilita: [
      'Catálogo cuotas, descuentos y modificaciones',
      'Alta cliente con cuota + descuento auto',
      'Recibos mensuales con remesa SEPA XML',
      'Cobro vía TPV virtual / link de pago / tokenización',
      'Facturación trimestral (preview + Excel + Odoo)',
    ],
    flagKey: 'cuotas',
  },
  {
    id: 'contabilidad',
    label: 'Contabilidad',
    icon: Calculator,
    color: 'var(--amber)',
    descripcion: ('Sobre todo gastos (subida de PDFs, OCR, asientos), pero '
                  + 'también facturas de ingreso manuales que no vienen de '
                  + 'cuotas. Categorías + listados visibles per trainer.'),
    habilita: [
      'Subida documentos (facturas, nóminas, IRPF, SS)',
      'OCR + propuesta de asiento contable',
      'Categorías de gasto (semilla automática)',
      'Listados: totales por categoría, faltantes, resultados',
      'Conciliación bancaria (importar movimientos + matching)',
    ],
    flagKey: 'contabilidad',
  },
]


export default function SuscripcionesTab({ identity }) {
  const toast = useToast()
  const { status, loading, refresh, isDefaultManager } = useOdooStatus()
  const [activeSubtab, setActiveSubtab] = useState('crm')
  const [wizardOpen, setWizardOpen] = useState(null)  // 'crm' | 'cuotas' | 'contabilidad' | null

  // Estado del check wcommerce (se hace una vez por sesión, no per módulo)
  const [wcId, setWcId] = useState('')
  const [checking, setChecking] = useState(false)
  const [check, setCheck] = useState(null)

  // Cuando carga el status, prefill el wcId con el guardado
  useEffect(() => {
    if (status?.wcommerce_cliente_id) {
      setWcId(String(status.wcommerce_cliente_id))
    }
  }, [status?.wcommerce_cliente_id])

  if (loading) {
    return (
      <Card style={{ padding: 18 }}>
        <Loader2 size={16} className="animate-spin" style={{ marginRight: 8, verticalAlign: 'middle' }} />
        <span style={{ fontSize: 13, color: 'var(--text-2)' }}>Cargando estado de suscripciones…</span>
      </Card>
    )
  }

  // ── Elegibilidad: el manager default está siempre OK; el resto necesita tipo S
  const tipoActual = (status?.tipo_pago_wc || '').toUpperCase()
  const isElegible = isDefaultManager || tipoActual === 'S'

  async function handleComprobar() {
    setChecking(true); setCheck(null)
    try {
      const idToUse = (wcId || '').trim() || status?.wcommerce_cliente_id
      if (idToUse && idToUse !== status?.wcommerce_cliente_id) {
        await managerSetWcommerceId(identity, idToUse)
      }
      const res = await managerWcCheck(identity, idToUse || null)
      setCheck(res)
      refresh()
    } catch (e) {
      setCheck({ ok: false, error: 'unreachable', motivo: e.message || 'Error de red' })
    }
    setChecking(false)
  }

  function handleWizardSubmitted(modulo, res) {
    setWizardOpen(null)
    refresh()
    // Invalidar cache para que se recarguen las features en el menú
    try { sessionStorage.removeItem(`round.odoo_status:${identity?.managerId || 'none'}`) } catch {}
    try {
      window.dispatchEvent(new CustomEvent('round.odoo-status-changed',
                                            { detail: { id_manager: identity?.managerId } }))
    } catch { /* noop */ }
    toast.success(res?.mensaje || `Módulo ${modulo} activado correctamente.`)
  }

  const moduloActive = MODULOS.find(m => m.id === activeSubtab) || MODULOS[0]

  return (
    <div>
      {/* ── Cabecera: estado wcommerce ─────────────────────────────────── */}
      <CabeceraWcommerce isElegible={isElegible}
                         isDefaultManager={isDefaultManager}
                         tipoActual={tipoActual}
                         wcId={wcId}
                         setWcId={setWcId}
                         wcIdGuardado={status?.wcommerce_cliente_id}
                         checking={checking}
                         check={check}
                         onComprobar={handleComprobar} />

      {/* ── Sub-tabs ────────────────────────────────────────────────────── */}
      <div role="tablist" style={{
        display: 'flex', gap: 4, borderBottom: '1px solid var(--line)',
        marginBottom: 20, marginTop: 20, overflowX: 'auto',
      }}>
        {MODULOS.map(m => {
          const isActive = activeSubtab === m.id
          const isOn = !!status?.[`odoo_${m.id}_enabled`]
          const Icon = m.icon
          return (
            <button key={m.id} role="tab" aria-selected={isActive}
                    onClick={() => setActiveSubtab(m.id)}
                    style={{
                      position: 'relative',
                      padding: '11px 16px',
                      background: 'none', border: 'none', cursor: 'pointer',
                      fontFamily: 'var(--font-display)',
                      fontSize: 14,
                      fontWeight: isActive ? 700 : 500,
                      color: isActive ? 'var(--text-0)' : 'var(--text-2)',
                      display: 'flex', alignItems: 'center', gap: 7,
                      flexShrink: 0,
                    }}>
              <Icon size={15} style={{ color: isOn ? m.color : 'var(--text-3)' }} />
              {m.label}
              {isOn && <span style={{
                width: 7, height: 7, borderRadius: 999,
                background: 'var(--green)', flexShrink: 0,
              }} aria-hidden="true" />}
              {isActive && <span aria-hidden="true" style={{
                position: 'absolute', bottom: -1, left: 12, right: 12, height: 2,
                background: 'var(--green)', borderRadius: 999,
              }} />}
            </button>
          )
        })}
      </div>

      {/* ── Contenido del sub-tab activo ───────────────────────────────── */}
      <CardModulo modulo={moduloActive}
                  status={status}
                  isElegible={isElegible}
                  onActivar={() => setWizardOpen(moduloActive.id)} />

      {/* ── Wizard del módulo (lazy: solo se renderiza si está abierto) ── */}
      {wizardOpen === 'crm' && (
        <WizardActivarCRM identity={identity} status={status}
                          onClose={() => setWizardOpen(null)}
                          onSubmitted={(res) => handleWizardSubmitted('CRM', res)} />
      )}
      {wizardOpen === 'cuotas' && (
        <WizardActivarCuotas identity={identity} status={status}
                             onClose={() => setWizardOpen(null)}
                             onSubmitted={(res) => handleWizardSubmitted('Cuotas', res)} />
      )}
      {wizardOpen === 'contabilidad' && (
        <WizardActivarContabilidad identity={identity} status={status}
                                    onClose={() => setWizardOpen(null)}
                                    onSubmitted={(res) => handleWizardSubmitted('Contabilidad', res)} />
      )}
    </div>
  )
}


// ── Cabecera: estado wcommerce ────────────────────────────────────────────
function CabeceraWcommerce({ isElegible, isDefaultManager, tipoActual,
                              wcId, setWcId, wcIdGuardado, checking, check,
                              onComprobar }) {
  if (isDefaultManager) {
    return (
      <Card style={{
        padding: 14, marginBottom: 12,
        background: 'rgba(45,212,168,0.06)',
        border: '1px solid rgba(45,212,168,0.22)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ShieldCheck size={18} style={{ color: 'var(--green)' }} />
          <div>
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-0)' }}>
              Manager por defecto (Round)
            </p>
            <p style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>
              Exento de la comprobación wcommerce. Puedes activar/reconfigurar
              cualquiera de los 3 módulos.
            </p>
          </div>
        </div>
      </Card>
    )
  }

  if (isElegible) {
    return (
      <Card style={{
        padding: 14, marginBottom: 12,
        background: 'rgba(45,212,168,0.06)',
        border: '1px solid rgba(45,212,168,0.22)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <CheckCircle2 size={18} style={{ color: 'var(--green)' }} />
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-0)' }}>
              Suscripción válida (tipo&nbsp;S)
            </p>
            <p style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>
              ID wcommerce: <strong style={{ fontFamily: 'monospace' }}>{wcIdGuardado || '—'}</strong>.
              Puedes activar los módulos que necesites.
            </p>
          </div>
        </div>
      </Card>
    )
  }

  // No elegible → ofrecer comprobación
  return (
    <Card style={{
      padding: 16, marginBottom: 12,
      background: 'rgba(91,156,246,0.06)',
      border: '1px solid rgba(91,156,246,0.22)',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <ShieldCheck size={20} style={{ color: 'var(--blue)', flexShrink: 0, marginTop: 2 }} />
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-0)' }}>
            Comprobación de suscripción wcommerce
          </p>
          <p style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4, lineHeight: 1.5 }}>
            Para activar cualquiera de los 3 módulos necesitas una suscripción
            <strong>&nbsp;tipo S</strong> en wcommerce. Introduce tu ID de cliente
            wcommerce para verificarlo.
          </p>

          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <label htmlFor="susc-wc-id" style={{ fontSize: 12, color: 'var(--text-2)' }}>
              ID cliente wcommerce:
            </label>
            <input id="susc-wc-id" type="text" value={wcId}
                   onChange={e => setWcId(e.target.value)}
                   placeholder={wcIdGuardado || 'p.ej. 00004645'}
                   style={{
                     padding: '6px 10px', fontSize: 13, fontFamily: 'monospace',
                     border: '1px solid var(--line)', borderRadius: 6,
                     background: 'var(--bg-1)', color: 'var(--text-0)',
                     minWidth: 160,
                   }} />
            <Btn variant="primary" size="sm" onClick={onComprobar}
                 disabled={checking || (!wcId && !wcIdGuardado)}>
              {checking ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              Comprobar
            </Btn>
          </div>

          {check && <CheckBanner check={check} tipoActual={tipoActual} />}
        </div>
      </div>
    </Card>
  )
}


function CheckBanner({ check, tipoActual }) {
  if (check.elegible && check.tipo_pago === 'S') {
    return (
      <div style={{
        marginTop: 12, padding: '10px 12px', borderRadius: 6,
        background: 'rgba(45,212,168,0.10)', border: '1px solid rgba(45,212,168,0.28)',
        fontSize: 12, color: 'var(--text-0)',
      }}>
        ✅ <strong>Validado.</strong> Ahora puedes activar los módulos que quieras.
      </div>
    )
  }
  if (check.tipo_pago && !check.elegible) {
    return (
      <div style={{
        marginTop: 12, padding: '10px 12px', borderRadius: 6,
        background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.28)',
        fontSize: 12, color: 'var(--text-0)',
      }}>
        <AlertCircle size={13} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle', color: 'var(--amber)' }} />
        Tu suscripción es tipo <strong>"{check.tipo_pago}"</strong>. Solo el tipo&nbsp;S
        incluye los módulos de Round. {check.motivo}
      </div>
    )
  }
  return (
    <div style={{
      marginTop: 12, padding: '10px 12px', borderRadius: 6,
      background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.28)',
      fontSize: 12, color: 'var(--text-0)',
    }}>
      <AlertCircle size={13} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle', color: 'var(--red)' }} />
      {check.motivo || check.error || 'Error de comprobación.'}
    </div>
  )
}


// ── Card del módulo (CRM, Cuotas, Contabilidad) ──────────────────────────
function CardModulo({ modulo, status, isElegible, onActivar }) {
  const isOn = !!status?.[`odoo_${modulo.id}_enabled`]
  const Icon = modulo.icon
  return (
    <Card style={{ padding: 22 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 16 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 10,
          background: `${modulo.color}1a`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <Icon size={22} style={{ color: modulo.color }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, margin: 0 }}>
              {modulo.label}
            </h3>
            {isOn
              ? <Badge color="green">Activado</Badge>
              : <Badge color="gray">No activado</Badge>}
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 6, lineHeight: 1.55 }}>
            {modulo.descripcion}
          </p>
        </div>
      </div>

      {/* Lista de lo que habilita */}
      <div style={{
        background: 'var(--bg-2)', borderRadius: 8, padding: '12px 14px',
        marginBottom: 16,
      }}>
        <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)',
                    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
          Habilita
        </p>
        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {modulo.habilita.map((linea, i) => (
            <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 7,
                                 fontSize: 12.5, color: 'var(--text-1)', padding: '3px 0' }}>
              <ChevronRight size={12} style={{ color: modulo.color, flexShrink: 0, marginTop: 4 }} />
              <span>{linea}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Acción */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        {!isElegible ? (
          <p style={{ fontSize: 12, color: 'var(--text-3)', alignSelf: 'center' }}>
            Comprueba primero tu suscripción wcommerce arriba.
          </p>
        ) : isOn ? (
          <>
            <Btn variant="ghost" size="sm" onClick={onActivar}>
              Reconfigurar
            </Btn>
          </>
        ) : (
          <Btn variant="primary" size="sm" onClick={onActivar}>
            <Layers size={13} />
            Activar {modulo.label}
          </Btn>
        )}
      </div>
    </Card>
  )
}
