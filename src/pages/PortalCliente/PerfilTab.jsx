import { User, Mail, Briefcase, Tag } from 'lucide-react'
import { usePortalAuth } from '../../contexts/PortalAuthContext'


export default function PerfilTab() {
  const { cliente } = usePortalAuth()
  if (!cliente) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 8 }}>
      <div style={{
        padding: '20px 18px', borderRadius: 16,
        background: 'var(--bg-1)', border: '1px solid var(--line)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: 'var(--gradient-primary, linear-gradient(135deg,#10b981,#059669))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <User size={24} color="#fff" />
          </div>
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--text-0)' }}>
              {cliente.nombre_completo || '—'}
            </p>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-3)' }}>
              ID NoofitPro · {cliente.cliente_idnoofit}
            </p>
          </div>
        </div>

        <Row icon={Mail} label="Email" value={cliente.email || '—'} />
        {cliente.es_trabajador && cliente.trabajador?.id_trainer_empleador && (
          <Row icon={Briefcase} label="Centro empleador" value={cliente.trabajador.id_trainer_empleador} />
        )}
        {cliente.categorias?.length > 0 && (
          <Row icon={Tag} label="Categorías" value={
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {cliente.categorias.map(c => (
                <span key={c} style={{
                  padding: '2px 10px', borderRadius: 999,
                  background: 'var(--green-bg, rgba(16,185,129,0.10))',
                  color: 'var(--green, #10b981)',
                  fontSize: 11, fontWeight: 600,
                }}>{c}</span>
              ))}
            </div>
          } />
        )}
      </div>
    </div>
  )
}


function Row({ icon: Icon, label, value }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 12,
      padding: '10px 0', borderTop: '1px solid var(--line)',
    }}>
      <Icon size={16} style={{ color: 'var(--text-3)', flexShrink: 0, marginTop: 2 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {label}
        </p>
        <div style={{ marginTop: 4, fontSize: 14, color: 'var(--text-0)' }}>
          {value}
        </div>
      </div>
    </div>
  )
}
