// Pestaña "Menú" (solo manager): define qué pestañas de Configuración ven los
// trainers. El trainer (login directo o impersonado) lee esta config al entrar
// y solo ve lo marcado. Guarda en /api/config/menu-trainer (manager_config.trainer_tabs).
import { useEffect, useMemo, useState, useCallback } from 'react'
import { ListChecks, Save, Loader2, Eye, EyeOff } from 'lucide-react'
import { Card, Btn, SectionTitle, Badge } from '../../components/UI'
import { useToast } from '../../components/Toast'

const TOKEN = import.meta.env.VITE_CONFIG_API_TOKEN || ''
const BASE = '/api/config/menu-trainer'

export default function MenuConfigTab({ identity, catalog = [], defaults = [], user }) {
  const toast = useToast()
  const [enabled, setEnabled] = useState(null)   // Set de ids; null = cargando
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const headers = useMemo(() => {
    const h = { 'Content-Type': 'application/json', 'X-Round-Token': TOKEN,
      'X-Round-Manager-Id': String(identity?.managerId || '') }
    if (user?.jwt) h['Authorization'] = `Bearer ${user.jwt}`
    return h
  }, [identity?.managerId, user?.jwt])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(BASE, { headers })
      const d = await r.json()
      if (!d.ok) throw new Error(d.error || 'Error')
      // null = nunca configurado → aplicar defaults
      const list = Array.isArray(d.enabled) ? d.enabled : defaults
      setEnabled(new Set(list))
    } catch (e) { toast.error('No se pudo cargar el menú: ' + e.message); setEnabled(new Set(defaults)) }
    finally { setLoading(false) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headers])
  useEffect(() => { reload() }, [reload])

  const toggle = (id) => setEnabled(s => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n
  })
  const setAll = (val) => setEnabled(() => new Set(val ? catalog.map(c => c.id) : []))

  const guardar = async () => {
    setSaving(true)
    try {
      const list = catalog.map(c => c.id).filter(id => enabled.has(id))  // orden estable del catálogo
      const r = await fetch(BASE, { method: 'PUT', headers, body: JSON.stringify({ enabled: list }) })
      const d = await r.json()
      if (!d.ok) throw new Error(d.error || 'Error')
      toast.success(`Guardado: los trainers verán ${list.length} pestañas`)
    } catch (e) { toast.error(e.message) } finally { setSaving(false) }
  }

  if (loading || enabled === null) {
    return <Card style={{ padding: 40, textAlign: 'center' }}><Loader2 size={20} className="animate-spin" /></Card>
  }
  const nVisibles = catalog.filter(c => enabled.has(c.id)).length

  return (
    <Card style={{ padding: 20 }}>
      <SectionTitle><ListChecks size={16} style={{ marginRight: 8 }} /> Menú de los trainers</SectionTitle>
      <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6, marginTop: 8 }}>
        Marca qué pestañas de <b>Configuración</b> ven tus trainers al entrar. Lo que dejes en
        «No» no les aparece. Tú (manager) sigues viéndolo todo. Esta pestaña «Menú» solo la ves tú.
      </p>
      <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <Badge color="green">{nVisibles} visibles para trainers</Badge>
        <Btn variant="ghost" onClick={() => setAll(true)}><Eye size={13} /> Todas</Btn>
        <Btn variant="ghost" onClick={() => setAll(false)}><EyeOff size={13} /> Ninguna</Btn>
      </div>

      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {catalog.map(c => {
          const on = enabled.has(c.id)
          return (
            <label key={c.id} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
              background: on ? 'var(--green-bg)' : 'var(--bg-1)',
              border: `1px solid ${on ? 'var(--green)' : 'var(--line)'}`,
            }}>
              <span style={{ fontSize: 13.5, fontWeight: on ? 600 : 400 }}>{c.label}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, color: on ? 'var(--green)' : 'var(--text-3)' }}>
                  {on ? 'Sí lo ven' : 'No'}
                </span>
                <input type="checkbox" checked={on} onChange={() => toggle(c.id)} />
              </span>
            </label>
          )
        })}
      </div>

      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
        <Btn variant="primary" onClick={guardar} disabled={saving}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Guardar menú
        </Btn>
      </div>
    </Card>
  )
}
