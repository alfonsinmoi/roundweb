import { useState, useEffect, useMemo, useDeferredValue } from 'react'
import { useNavigate, Link } from 'react-router-dom'
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

  // ERP
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

  const filtered = useMemo(() => clientes.filter(c => {
    const q = deferredSearch.toLowerCase()
    const match = `${c.name} ${c.surname} ${c.email}`.toLowerCase().includes(q)
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

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, marginBottom: 32 }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={18} style={{ position: 'absolute', left: 18, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }} aria-hidden="true" />
          <input type="search" placeholder="Buscar cliente..."
                 value={search} onChange={e => setSearch(e.target.value)}
                 aria-label="Buscar cliente"
                 style={{
                   width: '100%', padding: '16px 20px 16px 50px', borderRadius: 16, fontSize: 15,
                   background: 'var(--bg-2)', border: '1px solid var(--line)', color: 'var(--text-0)',
                   outline: 'none', transition: 'border-color 0.15s',
                 }} />
        </div>

        <div role="group" aria-label="Filtrar clientes" style={{ display: 'flex', borderRadius: 14, overflow: 'hidden', border: '1px solid var(--line)' }}>
          {[['activos','Activos'],['archivados','Archivados'],['todos','Todos']].map(([v, l]) => (
            <button key={v} onClick={() => setFiltro(v)}
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

      <p style={{ fontSize: 14, color: 'var(--text-3)', marginBottom: 24 }} aria-live="polite">
        {filtered.length} cliente{filtered.length !== 1 ? 's' : ''}
      </p>

      {/* Client grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(360px, 100%), 1fr))', gap: 16 }}>
        {filtered.slice(0, visibleCount).map(c => (
          <Link key={c.id} to={`/clientes/${c.id}`}
               aria-label={`${c.name} ${c.surname}`}
               className="interactive-row"
               style={{
                 display: 'block', textDecoration: 'none', color: 'inherit',
                 background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 20,
                 padding: 28, cursor: 'pointer', transition: 'background 0.12s',
               }}>

            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
              <Avatar nombre={`${c.name} ${c.surname}`} size={52} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontFamily: 'Outfit', fontSize: 16, fontWeight: 600, color: 'var(--text-0)', marginBottom: 4 }}>
                  {c.name} {c.surname}
                </p>
                <p style={{ fontSize: 13, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                   title={c.email}>
                  {c.email}
                </p>
              </div>
              {c.enabled === false
                ? <Badge color="gray"><Archive size={11} aria-hidden="true" /> Archivado</Badge>
                : <Badge color="green">Activo</Badge>
              }
            </div>

            <div style={{ borderTop: '1px solid var(--line)', paddingTop: 16 }}>
              {c.objective && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16, marginBottom: 10 }}>
                  <span style={{ fontSize: 13, color: 'var(--text-3)', flexShrink: 0 }}>Objetivo</span>
                  <span style={{ fontSize: 13, color: 'var(--text-1)', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={c.objective}>{c.objective}</span>
                </div>
              )}
              {c.cellPhone && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ fontSize: 13, color: 'var(--text-3)' }}>Teléfono</span>
                  <span style={{ fontSize: 13, color: 'var(--text-1)' }}>{c.cellPhone}</span>
                </div>
              )}
              {c.dni && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ fontSize: 13, color: 'var(--text-3)' }}>DNI</span>
                  <span style={{ fontSize: 13, color: 'var(--text-1)' }}>{c.dni}</span>
                </div>
              )}
              {c.idEspejo != null && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ fontSize: 13, color: 'var(--text-3)' }}>ID Espejo</span>
                  <span style={{ fontSize: 13, color: 'var(--text-2)', fontFamily: 'monospace' }}>{c.idEspejo}</span>
                </div>
              )}
              {!c.objective && !c.cellPhone && !c.dni && c.idEspejo == null && (
                <p style={{ fontSize: 13, color: 'var(--text-3)' }}>Sin datos adicionales</p>
              )}
            </div>

            {/* ERP button */}
            {tieneERP && (
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
                <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setErpCliente(c) }}
                        aria-label={`Enviar ERP para ${c.name} ${c.surname}`}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                          padding: '12px 18px', borderRadius: 12, fontSize: 13, fontWeight: 500,
                          cursor: 'pointer', border: '1px solid var(--blue-border)',
                          background: 'var(--blue-bg)', color: 'var(--blue)', transition: 'all 0.1s',
                          justifyContent: 'center',
                        }}>
                  <Send size={14} aria-hidden="true" /> Enviar ERP
                </button>
              </div>
            )}
          </Link>
        ))}
      </div>

      {visibleCount < filtered.length && (
        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <Btn variant="secondary" size="md" onClick={() => setVisibleCount(v => v + PAGE_SIZE)}>
            Cargar más ({filtered.length - visibleCount} restantes)
          </Btn>
        </div>
      )}

      {filtered.length === 0 && (
        <EmptyState title="No se encontraron clientes"
                    description={deferredSearch ? 'Prueba con otros términos de búsqueda' : undefined} />
      )}

      {/* ERP Modal — extracted component */}
      {erpCliente && (
        <ERPModal cliente={erpCliente} erpConfig={erpConfig} onClose={() => setErpCliente(null)} />
      )}
    </div>
  )
}
