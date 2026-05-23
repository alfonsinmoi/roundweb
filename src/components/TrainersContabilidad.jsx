/**
 * Sub-componente de ContabilidadActivacion (Fase 4).
 * Lista los trainers del manager y permite alternar "heredar contabilidad"
 * o "contabilidad propia" (analytic account independiente en Odoo).
 *
 * Solo aparece si el manager tiene Odoo desplegado con analytic configurado
 * (`manager_analytic_default_id != null`).
 */
import { useEffect, useState } from 'react'
import { Loader2, GitBranch, Layers } from 'lucide-react'
import { Card } from './UI'
import { useToast } from './Toast'
import {
  managerTrainersContabilidad, managerSetTrainerContabilidad,
} from '../utils/configApi'

export default function TrainersContabilidad({ identity }) {
  const toast = useToast()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState(null)

  const reload = () => {
    setLoading(true)
    managerTrainersContabilidad(identity)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }
  useEffect(reload, [identity?.managerId])

  if (loading) return (
    <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-3)' }}>
      <Loader2 size={12} className="animate-spin" style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6 }} />
      Cargando configuración por trainer…
    </div>
  )
  if (!data?.trainers?.length) return null
  // Solo mostrar si el manager YA tiene analytic configurado (Fase 4
  // completada en su despliegue). Si no, la UI no tiene sentido aún.
  if (!data.manager_analytic_default_id) return null

  async function toggleHeredar(t) {
    const newHeredar = !t.heredar_contabilidad
    setSavingId(t.id_trainer)
    try {
      const nombre = t.noofit_email || `Trainer ${t.id_trainer}`
      await managerSetTrainerContabilidad(identity, t.id_trainer, newHeredar, nombre)
      toast.success(newHeredar
        ? `${nombre} ahora hereda contabilidad del manager`
        : `${nombre} ahora tiene contabilidad propia`)
      reload()
    } catch (e) {
      toast.error('Error: ' + (e?.body?.detalle || e.message))
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid rgba(45,212,168,0.20)' }}>
      <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-1)',
                  textTransform: 'uppercase', letterSpacing: 0.4,
                  marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Layers size={12} /> Contabilidad por trainer
      </p>
      <p style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 12, lineHeight: 1.5 }}>
        Por defecto todos los trainers heredan la contabilidad del manager (sus
        movimientos van al analytic <strong>GENERAL #{data.manager_analytic_default_id}</strong>).
        Activa contabilidad propia para un trainer si quieres separar sus
        ingresos/gastos en informes.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {data.trainers.map(t => (
          <div key={t.id_trainer} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 12px',
            background: 'var(--bg-1)', border: '1px solid var(--line)',
            borderRadius: 8, fontSize: 13,
          }}>
            <GitBranch size={13} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ color: 'var(--text-0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.noofit_email || `Trainer #${t.id_trainer}`}
              </p>
              <p style={{ fontSize: 11, color: 'var(--text-3)' }}>
                {t.heredar_contabilidad
                  ? `Hereda del manager (analytic #${data.manager_analytic_default_id})`
                  : `Analytic propio #${t.analytic_account_id ?? '?'}`}
              </p>
            </div>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="checkbox"
                     checked={!t.heredar_contabilidad}
                     disabled={savingId === t.id_trainer}
                     onChange={() => toggleHeredar(t)} />
              <span style={{ fontSize: 11, color: 'var(--text-2)' }}>Propia</span>
              {savingId === t.id_trainer && <Loader2 size={11} className="animate-spin" />}
            </label>
          </div>
        ))}
      </div>
    </div>
  )
}
