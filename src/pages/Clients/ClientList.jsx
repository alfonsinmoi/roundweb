import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, Archive, Loader2 } from 'lucide-react'
import { Badge, Avatar, Btn } from '../../components/UI'
import { getClientes } from '../../utils/api'

export default function ClientList() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [filtro, setFiltro] = useState('activos')
  const [clientes, setClientes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    getClientes()
      .then(data => setClientes(data))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const filtered = clientes.filter(c => {
    const q = search.toLowerCase()
    const match = `${c.name} ${c.surname} ${c.email}`.toLowerCase().includes(q)
    if (!match) return false
    if (filtro === 'activos') return c.enabled !== false
    if (filtro === 'archivados') return c.enabled === false
    return true
  })

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '120px 0' }}>
      <Loader2 size={22} className="animate-spin" style={{ color: 'var(--green)' }} />
    </div>
  )

  if (error) return (
    <div style={{ padding: '80px 0', textAlign: 'center', fontSize: 15, color: 'var(--red)' }}>
      Error cargando clientes: {error}
    </div>
  )

  return (
    <div>

      {/* Toolbar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, marginBottom: 32 }}>

        {/* Search */}
        <div style={{ position: 'relative', flex: 1, minWidth: 280 }}>
          <Search size={18} style={{ position: 'absolute', left: 18, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }} />
          <input
            type="search"
            placeholder="Buscar cliente..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%',
              padding: '16px 20px 16px 50px',
              borderRadius: 16,
              fontSize: 15,
              background: 'var(--bg-2)',
              border: '1px solid var(--line)',
              color: 'var(--text-0)',
              outline: 'none',
              transition: 'border-color 0.15s',
            }}
            onFocus={e => e.target.style.borderColor = 'var(--green)'}
            onBlur={e => e.target.style.borderColor = 'var(--line)'}
          />
        </div>

        {/* Filtros */}
        <div style={{ display: 'flex', borderRadius: 14, overflow: 'hidden', border: '1px solid var(--line)' }}>
          {[['activos','Activos'],['archivados','Archivados'],['todos','Todos']].map(([v, l]) => (
            <button key={v} onClick={() => setFiltro(v)}
                    style={{
                      padding: '14px 22px',
                      fontSize: 14,
                      fontWeight: 500,
                      cursor: 'pointer',
                      border: 'none',
                      background: filtro === v ? 'var(--green-bg)' : 'var(--bg-2)',
                      color: filtro === v ? 'var(--green)' : 'var(--text-2)',
                      transition: 'all 0.1s',
                    }}>
              {l}
            </button>
          ))}
        </div>

        <Btn size="lg" onClick={() => navigate('/clientes/nuevo')}>
          <Plus size={18} /> Nuevo cliente
        </Btn>
      </div>

      {/* Count */}
      <p style={{ fontSize: 14, color: 'var(--text-3)', marginBottom: 24 }}>
        {filtered.length} cliente{filtered.length !== 1 ? 's' : ''}
      </p>

      {/* Client grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 16 }}>
        {filtered.map(c => (
          <div key={c.id}
               onClick={() => navigate(`/clientes/${c.id}`)}
               style={{
                 background: 'var(--bg-2)',
                 border: '1px solid var(--line)',
                 borderRadius: 20,
                 padding: 28,
                 cursor: 'pointer',
                 transition: 'background 0.12s',
               }}
               onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-3)'}
               onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-2)'}>

            {/* Header row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
              <Avatar nombre={`${c.name} ${c.surname}`} size={52} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontFamily: 'Outfit', fontSize: 16, fontWeight: 600, color: 'var(--text-0)', marginBottom: 4 }}>
                  {c.name} {c.surname}
                </p>
                <p style={{ fontSize: 13, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.email}
                </p>
              </div>
              {c.enabled === false
                ? <Badge color="gray"><Archive size={11} /> Archivado</Badge>
                : <Badge color="green">Activo</Badge>
              }
            </div>

            {/* Details */}
            <div style={{ borderTop: '1px solid var(--line)', paddingTop: 16 }}>
              {c.objective && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16, marginBottom: 10 }}>
                  <span style={{ fontSize: 13, color: 'var(--text-3)', flexShrink: 0 }}>Objetivo</span>
                  <span style={{ fontSize: 13, color: 'var(--text-1)', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.objective}
                  </span>
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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13, color: 'var(--text-3)' }}>ID Espejo</span>
                  <span style={{ fontSize: 13, color: 'var(--text-2)', fontFamily: 'monospace' }}>{c.idEspejo}</span>
                </div>
              )}
              {!c.objective && !c.cellPhone && !c.dni && c.idEspejo == null && (
                <p style={{ fontSize: 13, color: 'var(--text-3)' }}>Sin datos adicionales</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <div style={{ padding: '80px 0', textAlign: 'center', fontSize: 15, color: 'var(--text-3)' }}>
          No se encontraron clientes
        </div>
      )}
    </div>
  )
}
