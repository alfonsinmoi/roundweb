// Checklist post-activación.
// Muestra, por módulo (crm/cuotas/contabilidad), el estado de cada item
// que el manager necesita configurar para que el módulo funcione end-to-end.
// Cada item tiene un botón "Ir a configurar →" que abre la pestaña destino
// mediante deep-link (#hash).

import { useState, useEffect, useCallback } from 'react'
import { CheckCircle2, AlertTriangle, AlertOctagon, ArrowRight, RefreshCw, Loader2 } from 'lucide-react'
import { Card, Btn } from '../../components/UI'
import { useToast } from '../../components/Toast'
import { managerChecklist } from '../../utils/configApi'

const MODULO_LABEL = {
  crm: 'CRM',
  cuotas: 'Cuotas',
  contabilidad: 'Contabilidad',
}

const STATUS_ICON = {
  ok:      <CheckCircle2 size={18} style={{ color: '#2DD4A8' }} />,
  warn:    <AlertTriangle size={18} style={{ color: '#FBBF24' }} />,
  missing: <AlertOctagon  size={18} style={{ color: '#F87171' }} />,
}

const STATUS_TINT = {
  ok:      'rgba(45,212,168,0.08)',
  warn:    'rgba(251,191,36,0.10)',
  missing: 'rgba(248,113,113,0.12)',
}

export default function ChecklistTab({ identity, modulo }) {
  const toast = useToast()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const r = await managerChecklist(identity, modulo || null)
      setData(r.modulos || {})
    } catch (e) {
      toast.error('Error cargando checklist: ' + e.message)
    } finally { setLoading(false) }
  }, [identity?.managerId, modulo, toast])

  useEffect(() => { reload() }, [reload])

  if (loading) {
    return (
      <Card>
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-3)' }}>
          <Loader2 size={20} className="spin" /> Calculando checklist…
        </div>
      </Card>
    )
  }

  const modulos = modulo ? { [modulo]: data?.[modulo] } : data
  if (!modulos || Object.keys(modulos).length === 0) {
    return (
      <Card>
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-3)' }}>
          No hay módulos activos.
        </div>
      </Card>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-2)' }}>
          Items que necesitas configurar para que el módulo funcione. Los marcados con 🔴 son críticos.
        </p>
        <Btn variant="ghost" onClick={reload} title="Recalcular">
          <RefreshCw size={14} /> Recalcular
        </Btn>
      </div>

      {Object.entries(modulos).map(([modKey, m]) => m ? (
        <ModuloCard key={modKey} modulo={modKey} m={m} />
      ) : null)}
    </div>
  )
}


function ModuloCard({ modulo, m }) {
  const crit = m.critical_missing
  const warn = m.warn
  const okCount = m.ok_count
  const tint = crit > 0 ? STATUS_TINT.missing
             : warn > 0 ? STATUS_TINT.warn
             : STATUS_TINT.ok

  return (
    <Card style={{ background: tint, border: `1px solid ${crit > 0 ? '#F87171' : warn > 0 ? '#FBBF24' : '#2DD4A8'}` }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 12,
      }}>
        <h3 style={{ margin: 0, fontSize: 16, fontFamily: 'var(--font-display)' }}>
          Módulo {MODULO_LABEL[modulo] || modulo}
        </h3>
        <div style={{ display: 'flex', gap: 10, fontSize: 12 }}>
          <span style={{ color: '#2DD4A8' }}>✅ {okCount}</span>
          {warn > 0 && <span style={{ color: '#FBBF24' }}>⚠️ {warn}</span>}
          {crit > 0 && <span style={{ color: '#F87171' }}>🔴 {crit}</span>}
          <span style={{ color: 'var(--text-3)' }}>· total {m.total}</span>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {m.items.map(it => <ItemRow key={it.id} item={it} />)}
      </div>
    </Card>
  )
}


function ItemRow({ item }) {
  const goto = () => {
    // Deep-link al tab destino. Si ya estamos en /configuracion, solo
    // cambiamos el hash → hashchange listener en Configuracion.jsx hace el switch.
    const newHash = `#${item.deeplink_tab}`
    if (window.location.pathname.endsWith('/configuracion')) {
      window.location.hash = newHash
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } else {
      window.location.href = `/configuracion${newHash}`
    }
  }
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 12px', borderRadius: 6,
      background: 'var(--bg-2)', border: '1px solid var(--line)',
    }}>
      <div style={{ flexShrink: 0 }}>{STATUS_ICON[item.status] || STATUS_ICON.warn}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>
          {item.label}
          {item.severity === 'critical' && item.status === 'missing' && (
            <span style={{ marginLeft: 8, fontSize: 10, color: '#F87171',
                           background: 'rgba(248,113,113,0.18)', padding: '2px 6px', borderRadius: 4 }}>
              CRÍTICO
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
          {item.detail || '—'}
        </div>
      </div>
      {item.status !== 'ok' && (
        <Btn variant="ghost" onClick={goto} title="Abrir pestaña de configuración">
          Ir a configurar <ArrowRight size={14} />
        </Btn>
      )}
    </div>
  )
}
