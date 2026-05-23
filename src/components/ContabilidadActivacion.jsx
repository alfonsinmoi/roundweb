/**
 * Tarjeta superior de Configuración → Contabilidad.
 *
 * - Si el manager YA tiene Odoo desplegado (incluye el manager default
 *   Round id=17675): muestra un badge verde con company_id y fecha.
 * - Si NO lo tiene desplegado:
 *     • Permite introducir su `wcommerce_cliente_id`.
 *     • Al pulsar "Comprobar y desplegar", consulta wcommerce on-demand.
 *     • Si tipoPago='S' → modal "Aceptar" para iniciar el wizard (Fase 2).
 *     • Si tipoPago≠'S' → mensaje "Contacta con Wiemspro".
 *     • Si no se encuentra el cliente / wcommerce caído → mensaje claro.
 *
 * En Fase 1 el botón "Aceptar" del modal aún no dispara el provisioning
 * (eso es Fase 2). Solo marca la intención y la mensaje al usuario.
 */
import { useState, useEffect } from 'react'
import { ShieldCheck, CheckCircle2, AlertCircle, Loader2, Send, X, Clock } from 'lucide-react'
import { Card, Btn } from './UI'
import { useToast } from './Toast'
import { useOdooStatus } from '../hooks/useOdooStatus'
import { managerWcCheck, managerSetWcommerceId, managerGetSolicitudDespliegue } from '../utils/configApi'
import WizardDespliegueOdoo from './WizardDespliegueOdoo'
import TrainersContabilidad from './TrainersContabilidad'

export default function ContabilidadActivacion({ identity }) {
  const toast = useToast()
  const { status, loading, refresh, odooEnabled, isDefaultManager } = useOdooStatus()
  const [wcId, setWcId] = useState('')
  const [checking, setChecking] = useState(false)
  const [check, setCheck] = useState(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [solicitud, setSolicitud] = useState(null)
  const [solicitudLoaded, setSolicitudLoaded] = useState(false)

  // Cargar la solicitud SIEMPRE (también cuando ya está odoo activo: necesitamos
  // saber si el sync inicial de partners sigue corriendo en background).
  useEffect(() => {
    if (loading) { setSolicitudLoaded(true); return }
    let active = true
    managerGetSolicitudDespliegue(identity)
      .then(s => { if (active) setSolicitud(s) })
      .catch(() => { /* no hay → null */ })
      .finally(() => { if (active) setSolicitudLoaded(true) })
    return () => { active = false }
  }, [loading, identity])

  // Si el sync de partners está en curso (started pero no finished),
  // polling cada 3s para refrescar el progreso.
  const syncInProgress = solicitud
    && solicitud.estado === 'completada'
    && solicitud.partners_sync_started_at
    && !solicitud.partners_sync_finished_at
  useEffect(() => {
    if (!syncInProgress) return
    const itv = setInterval(() => {
      managerGetSolicitudDespliegue(identity)
        .then(s => setSolicitud(s))
        .catch(() => {})
    }, 3000)
    return () => clearInterval(itv)
  }, [syncInProgress, identity])

  if (loading || !solicitudLoaded) return (
    <Card style={{ padding: 18, marginBottom: 16 }}>
      <Loader2 size={16} className="animate-spin" style={{ marginRight: 8, verticalAlign: 'middle' }} />
      <span style={{ fontSize: 13, color: 'var(--text-2)' }}>Cargando estado de contabilidad…</span>
    </Card>
  )

  // Solicitud con error (provisioner falló) → mostrar el motivo
  // El estado 'pendiente' AHORA significa "falló el provisioner, se quedó
  // a medias", NO "esperando intervención humana en 24h" como antes.
  if (solicitud && solicitud.estado === 'pendiente' && solicitud.motivo_rechazo) {
    return (
      <Card style={{
        padding: 18, marginBottom: 16,
        background: 'rgba(248,113,113,0.07)',
        border: '1px solid rgba(248,113,113,0.30)',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <AlertCircle size={22} style={{ color: 'var(--red)', flexShrink: 0, marginTop: 2 }} />
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-0)' }}>
              El despliegue falló a medio camino
            </p>
            <p style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4, lineHeight: 1.5 }}>
              <strong>Solicitud #{solicitud.id} ({solicitud.razon_social}):</strong> {solicitud.motivo_rechazo}
            </p>
            <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8, lineHeight: 1.5 }}>
              Nuestro equipo ya está avisado. Si han pasado más de unas horas
              sin que se resuelva, contacta con Wiemspro indicando este número
              de solicitud.
            </p>
          </div>
        </div>
      </Card>
    )
  }
  // Caso raro: en_proceso (no debería verse con provisioner síncrono — sería
  // un manager que se quedó colgado a mitad del request).
  if (solicitud && solicitud.estado === 'en_proceso') {
    return (
      <Card style={{
        padding: 18, marginBottom: 16,
        background: 'rgba(91,156,246,0.06)',
        border: '1px solid rgba(91,156,246,0.22)',
      }}>
        <Loader2 size={16} className="animate-spin" style={{ marginRight: 8, verticalAlign: 'middle', color: 'var(--blue)' }} />
        <span style={{ fontSize: 13, color: 'var(--text-1)' }}>
          Despliegue en curso… Recarga la página en unos segundos.
        </span>
      </Card>
    )
  }

  // ── Caso A: Odoo ya desplegado ──────────────────────────────────────────
  if (odooEnabled) {
    const activadoTxt = status?.odoo_activated_at
      ? new Date(status.odoo_activated_at).toLocaleDateString('es-ES', {
          day: '2-digit', month: 'short', year: 'numeric',
        })
      : null
    const showSync = syncInProgress && (solicitud.partners_total > 0)
    const pct = showSync
      ? Math.min(100, Math.round((solicitud.partners_synced || 0) * 100 / Math.max(1, solicitud.partners_total)))
      : 100
    return (
      <Card style={{
        padding: 18, marginBottom: 16,
        background: 'rgba(45,212,168,0.08)',
        border: '1px solid rgba(45,212,168,0.30)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <CheckCircle2 size={20} style={{ color: 'var(--green)', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-0)' }}>
              Contabilidad, remesas y CRM activos
            </p>
            <p style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>
              Odoo company #{status?.odoo_company_id ?? '—'}
              {activadoTxt && ` · desplegado el ${activadoTxt}`}
              {isDefaultManager && ' · manager por defecto (Round)'}
            </p>
            {showSync && (
              <div style={{ marginTop: 10 }}>
                <p style={{ fontSize: 12, color: 'var(--text-2)' }}>
                  <Loader2 size={12} className="animate-spin" style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6 }} />
                  Importando clientes a Odoo: <strong>{solicitud.partners_synced}/{solicitud.partners_total}</strong> ({pct}%)
                </p>
                <div style={{ marginTop: 6, height: 6, background: 'var(--bg-3)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: 'var(--green)', transition: 'width 1s' }} />
                </div>
              </div>
            )}
            {!showSync && solicitud?.partners_total > 0 && solicitud?.partners_sync_finished_at && (
              <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6 }}>
                {solicitud.partners_synced} de {solicitud.partners_total} clientes importados a Odoo
                {Array.isArray(solicitud.partners_errors) && solicitud.partners_errors.length > 0
                  && ` (${solicitud.partners_errors.length} con error)`}
              </p>
            )}
            {/* Fase 4: config analytic per trainer (solo aparece si el
                manager tiene analytic configurado). */}
            <TrainersContabilidad identity={identity} />
          </div>
        </div>
      </Card>
    )
  }

  // ── Caso B: Odoo no desplegado ──────────────────────────────────────────
  const wcIdGuardado = status?.wcommerce_cliente_id || ''

  async function handleComprobar() {
    setChecking(true); setCheck(null)
    try {
      // Si introdujeron un id distinto al guardado, lo persistimos primero
      const idToUse = (wcId || '').trim() || wcIdGuardado
      if (wcId && wcId !== wcIdGuardado) {
        await managerSetWcommerceId(identity, idToUse)
      }
      const res = await managerWcCheck(identity, idToUse || null)
      setCheck(res)
      // Refrescamos el status (para coger el tipo_pago_wc actualizado)
      refresh()
    } catch (e) {
      setCheck({ ok: false, error: 'unreachable', motivo: e.message || 'Error de red' })
    }
    setChecking(false)
  }

  function handleAceptar() {
    // Cierra el modal de confirmación y abre el wizard multi-paso
    setConfirmOpen(false)
    setWizardOpen(true)
  }

  function handleWizardSubmitted(res) {
    setWizardOpen(false)
    // Tras el provisioner: refrescar status (ahora odoo_enabled=true) y
    // limpiar la solicitud local. El próximo render mostrará el badge
    // verde de "contabilidad activa".
    setSolicitud(null)
    refresh()
    // Invalidar cache sessionStorage del useOdooStatus para que el menú
    // recargue las nuevas features (CRM/Cuotas/Contabilidad).
    try { sessionStorage.removeItem(`round.odoo_status:${identity?.managerId || 'none'}`) } catch {}
    toast.success(res?.mensaje || '¡Contabilidad activada!')
  }

  return (
    <Card style={{
      padding: 18, marginBottom: 16,
      background: 'rgba(91,156,246,0.06)',
      border: '1px solid rgba(91,156,246,0.22)',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <ShieldCheck size={22} style={{ color: 'var(--blue)', flexShrink: 0, marginTop: 2 }} />
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-0)' }}>
            Desplegar Contabilidad, Remesas y CRM
          </p>
          <p style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4, lineHeight: 1.5 }}>
            Activa el módulo Odoo de tu centro: facturas, recibos SEPA, plan
            contable propio, gastos y CRM con pipeline. Requiere una
            suscripción tipo&nbsp;<strong>S</strong> en wcommerce. Una vez activado,
            los datos contables se separan de otros managers.
          </p>

          <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <label htmlFor="wc-id" style={{ fontSize: 12, color: 'var(--text-2)' }}>
              ID cliente wcommerce:
            </label>
            <input id="wc-id" type="text" value={wcId}
                   onChange={e => setWcId(e.target.value)}
                   placeholder={wcIdGuardado || 'p.ej. 00004645'}
                   style={{
                     padding: '6px 10px', fontSize: 13, fontFamily: 'monospace',
                     border: '1px solid var(--line)', borderRadius: 6,
                     background: 'var(--bg-1)', color: 'var(--text-0)',
                     minWidth: 160,
                   }} />
            <Btn variant="primary" size="sm" onClick={handleComprobar} disabled={checking || (!wcId && !wcIdGuardado)}>
              {checking ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              Comprobar y desplegar
            </Btn>
          </div>

          {/* ── Respuesta de la comprobación ─────────────────────────── */}
          {check && (
            <CheckResultBanner check={check}
                               onAceptar={() => setConfirmOpen(true)} />
          )}
        </div>
      </div>

      {confirmOpen && (
        <ConfirmModal check={check}
                      onCancel={() => setConfirmOpen(false)}
                      onAceptar={handleAceptar} />
      )}

      {wizardOpen && (
        <WizardDespliegueOdoo identity={identity}
                              prefillCliente={check?.cliente}
                              onClose={() => setWizardOpen(false)}
                              onSubmitted={handleWizardSubmitted} />
      )}
    </Card>
  )
}


// ── Banner con el resultado de wc-check ─────────────────────────────────
function CheckResultBanner({ check, onAceptar }) {
  // Caso 1: elegible (tipoPago = S) → invitar a confirmar
  if (check.elegible && check.tipo_pago === 'S') {
    const c = check.cliente || {}
    return (
      <div style={{
        marginTop: 14, padding: '12px 14px', borderRadius: 8,
        background: 'rgba(45,212,168,0.10)', border: '1px solid rgba(45,212,168,0.32)',
      }}>
        <p style={{ fontSize: 13, color: 'var(--text-0)' }}>
          ✅ <strong>Suscripción válida (tipo S).</strong>
        </p>
        <p style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4 }}>
          {(c.personaJuridica || c.nombre || '—')}{c.cif ? ` · CIF ${c.cif}` : ''}
        </p>
        <div style={{ marginTop: 10 }}>
          <Btn variant="primary" size="sm" onClick={onAceptar}>
            Continuar al wizard de despliegue
          </Btn>
        </div>
      </div>
    )
  }
  // Caso 2: encontrado pero no elegible (otra letra)
  if (check.tipo_pago && !check.elegible) {
    return (
      <div style={{
        marginTop: 14, padding: '12px 14px', borderRadius: 8,
        background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.30)',
      }}>
        <p style={{ fontSize: 13, color: 'var(--text-0)' }}>
          <AlertCircle size={14} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle', color: 'var(--amber)' }} />
          <strong>Tu suscripción es tipo "{check.tipo_pago}"</strong> y no incluye contabilidad/CRM/remesas.
        </p>
        <p style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4 }}>
          {check.motivo || 'Contacta con Wiemspro para cambiar a suscripción tipo S.'}
        </p>
      </div>
    )
  }
  // Caso 3: error (no encontrado, wcommerce caído, etc.)
  return (
    <div style={{
      marginTop: 14, padding: '12px 14px', borderRadius: 8,
      background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.30)',
    }}>
      <p style={{ fontSize: 13, color: 'var(--text-0)' }}>
        <AlertCircle size={14} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle', color: 'var(--red)' }} />
        No pude verificar tu suscripción.
      </p>
      <p style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4 }}>
        {check.motivo || check.error || 'Intenta de nuevo más tarde.'}
      </p>
    </div>
  )
}


// ── Modal de confirmación final ─────────────────────────────────────────
function ConfirmModal({ check, onCancel, onAceptar }) {
  const c = check?.cliente || {}
  return (
    <div onClick={onCancel} style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }}>
      <Card onClick={(e) => e.stopPropagation()}
            style={{ padding: 0, maxWidth: 540, width: '100%' }}>
        <div style={{ padding: 18, borderBottom: '1px solid var(--line)',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h3 style={{ margin: 0, fontFamily: 'Outfit', fontSize: 17, fontWeight: 700 }}>
              Confirmar despliegue de contabilidad
            </h3>
            <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
              Esta operación crea tu propia compañía en Odoo. No es reversible.
            </p>
          </div>
          <button onClick={onCancel} aria-label="Cerrar"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)' }}>
            <X size={16} />
          </button>
        </div>
        <div style={{ padding: 18, fontSize: 13, color: 'var(--text-1)', lineHeight: 1.55 }}>
          <p style={{ marginBottom: 12 }}>
            Vamos a desplegar contabilidad, remesas y CRM para:
          </p>
          <ul style={{ paddingLeft: 18, fontSize: 13 }}>
            <li><strong>{c.personaJuridica || c.nombre || '—'}</strong>{c.cif ? ` (CIF ${c.cif})` : ''}</li>
            <li>País: {c.pais || '—'}</li>
            <li>Email: {c.email || '—'}</li>
            <li>Tipo wcommerce: <strong>{check?.tipo_pago}</strong></li>
          </ul>
          <p style={{ marginTop: 14, fontSize: 12, color: 'var(--text-3)' }}>
            A continuación te pediremos los datos fiscales, plan contable,
            cuentas bancarias y el número de la última factura emitida para
            continuar la numeración.
          </p>
        </div>
        <div style={{ padding: 14, borderTop: '1px solid var(--line)',
                      display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Btn variant="ghost" onClick={onCancel}>Cancelar</Btn>
          <Btn variant="primary" onClick={onAceptar}>Aceptar y continuar</Btn>
        </div>
      </Card>
    </div>
  )
}
