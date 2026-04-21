import { useState, useEffect, useMemo, useDeferredValue } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, Archive, Loader2, Send } from 'lucide-react'
import { Badge, Avatar, Btn, EmptyState } from '../../components/UI'
import ERPModal from '../../components/ERPModal'
import { getClientes, getERPConfiguracion } from '../../utils/api'

const PAGE_SIZE = 50

export default function ClientList() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [filtro, setFiltro] = useState('activos')
  const [clientes, setClientes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [erpConfig, setErpConfig] = useState(null)
  const [erpCliente, setErpCliente] = useState(null)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  useEffect(() => {
    Promise.all([
      getClientes(),
      getERPConfiguracion().catch(() => null),
    ]).then(([cli, erp]) => {
      setClientes(cli)
      const campos = erp?.campos ?? []
      setErpConfig(campos.length > 0 ? { ...erp, campos } : false)
    }).catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const tieneERP = erpConfig && erpConfig.campos?.length > 0

  const clientFullName = c => `${c.nombre || c.name || ''} ${c.apellidos || c.surname || ''}`.trim()

  const filtered = useMemo(() => clientes.filter(c => {
    const q = deferredSearch.toLowerCase()
    const match = `${clientFullName(c)} ${c.email}`.toLowerCase().includes(q)
    if (!match) return false
    if (filtro === 'activos') return c.enabled !== false
    if (filtro === 'archivados') return c.enabled === false
    return true
  }), [clientes, deferredSearch, filtro])

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '120px 0' }} role="status" aria-label="Cargando clientes">
      <Loader2 size={22} className="animate-spin" style={{ color: 'var(--green)' }} aria-hidden="true" />
    </div>
  )

  if (error) return (
    <div role="alert" style={{ padding: '80px 0', textAlign: 'center', fontSize: 15, color: 'var(--red)' }}>
      Error cargando clientes
    </div>
  )

  const visible = filtered.slice(0, visibleCount)
  const cols = tieneERP ? '2fr 2fr 120px 1fr 1fr auto' : '2fr 2fr 120px 1fr 1fr'

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, marginBottom: 32 }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={18} style={{ position: 'absolute', left: 18, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }} aria-hidden="true" />
          <input type="search" placeholder="Buscar cliente..."
                 value={search}
                 onChange={e => { setSearch(e.target.value); setVisibleCount(PAGE_SIZE) }}
                 aria-label="Buscar cliente"
                 style={{
                   width: '100%', padding: '16px 20px 16px 50px', borderRadius: 16, fontSize: 15,
                   background: 'var(--bg-2)', border: '1px solid var(--line)', color: 'var(--text-0)',
                   outline: 'none',
                 }} />
        </div>

        <div role="group" aria-label="Filtrar clientes" style={{ display: 'flex', borderRadius: 14, overflow: 'hidden', border: '1px solid var(--line)' }}>
          {[['activos','Activos'],['archivados','Archivados'],['todos','Todos']].map(([v, l]) => (
            <button key={v} onClick={() => { setFiltro(v); setVisibleCount(PAGE_SIZE) }}
                    aria-pressed={filtro === v}
                    style={{
                      padding: '14px 22px', fontSize: 14, fontWeight: 500, cursor: 'pointer', border: 'none',
                      background: filtro === v ? 'var(--green-bg)' : 'var(--bg-2)',
                      color: filtro === v ? 'var(--green)' : 'var(--text-2)',
                      transition: 'all 0.1s',
                    }}>
              {l}
            </button>
          ))}
        </div>

        <Btn size="lg" onClick={() => navigate('/clientes/nuevo')}>
          <Plus size={18} aria-hidden="true" /> Nuevo cliente
        </Btn>
      </div>

      <p style={{ fontSize: 14, color: 'var(--text-3)', marginBottom: 20 }} aria-live="polite">
        {filtered.length} cliente{filtered.length !== 1 ? 's' : ''}
      </p>

      {filtered.length === 0 ? (
        <EmptyState title="No se encontraron clientes"
                    description={deferredSearch ? 'Prueba con otros términos de búsqueda' : undefined} />
      ) : (
        <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 20, overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 0, padding: '12px 24px', background: 'var(--bg-3)', borderBottom: '1px solid var(--line)' }}>
            {['Cliente', 'Email', 'Estado', 'Teléfono', 'DNI', ...(tieneERP ? [''] : [])].map((h, i) => (
              <span key={i} style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-3)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>{h}</span>
            ))}
          </div>

          {/* Rows */}
          {visible.map((c, i) => (
            <div key={c.id}
                 role="button"
                 tabIndex={0}
                 onClick={() => navigate(`/clientes/${c.id}`)}
                 onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && navigate(`/clientes/${c.id}`)}
                 aria-label={`Ver perfil de ${c.name} ${c.surname}`}
                 className="interactive-row"
                 style={{
                   display: 'grid', gridTemplateColumns: cols, alignItems: 'center',
                   padding: '14px 24px', cursor: 'pointer',
                   borderBottom: i < visible.length - 1 ? '1px solid var(--line)' : 'none',
                   transition: 'background 0.1s',
                 }}>

              {/* Cliente */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingRight: 16, minWidth: 0 }}>
                <Avatar nombre={clientFullName(c)} size={36} imgUrl={c.imgUrl} />
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontFamily: 'Outfit', fontSize: 14, fontWeight: 600, color: 'var(--text-0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {clientFullName(c)}
                  </p>
                  {c.idEspejo != null && (
                    <p style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'monospace' }}>#{c.idEspejo}</p>
                  )}
                </div>
              </div>

              {/* Email */}
              <p style={{ fontSize: 13, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 16 }} title={c.email}>
                {c.email || '—'}
              </p>

              {/* Estado */}
              <div>
                {c.enabled === false
                  ? <Badge color="gray"><Archive size={10} aria-hidden="true" /> Archivado</Badge>
                  : <Badge color="green">Activo</Badge>
                }
              </div>

              {/* Teléfono */}
              <p style={{ fontSize: 13, color: 'var(--text-2)' }}>{c.cellPhone || '—'}</p>

              {/* DNI */}
              <p style={{ fontSize: 13, color: 'var(--text-2)' }}>{c.dni || '—'}</p>

              {/* ERP */}
              {tieneERP && (
                <button onClick={e => { e.stopPropagation(); setErpCliente(c) }}
                        aria-label={`Enviar ERP para ${c.name} ${c.surname}`}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 6,
                          padding: '8px 14px', borderRadius: 10, fontSize: 12, fontWeight: 500,
                          cursor: 'pointer', border: '1px solid var(--blue-border)',
                          background: 'var(--blue-bg)', color: 'var(--blue)', transition: 'all 0.1s',
                        }}>
                  <Send size={12} aria-hidden="true" /> ERP
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {visibleCount < filtered.length && (
        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <Btn variant="secondary" size="md" onClick={() => setVisibleCount(v => v + PAGE_SIZE)}>
            Cargar más ({filtered.length - visibleCount} restantes)
          </Btn>
        </div>
      )}

      {erpCliente && (
        <ERPModal cliente={erpCliente} erpConfig={erpConfig} onClose={() => setErpCliente(null)} />
      )}
    </div>
  )
}
