import { useState, useEffect } from 'react'
import { Search, Loader2 } from 'lucide-react'
import { Card, Badge, Table } from '../components/UI'
import { getEjercicios } from '../utils/api'
import { tipoLabel, tipoColor } from '../utils/colors'

export default function Ejercicios() {
  const [ejercicios, setEjercicios] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [tipo, setTipo] = useState('')
  const [vista, setVista] = useState('cards')

  useEffect(() => {
    getEjercicios()
      .then(data => setEjercicios(data.filter(e => e.enabled)))
      .catch(() => setError('Error cargando ejercicios'))
      .finally(() => setLoading(false))
  }, [])

  const tipos = [...new Set(ejercicios.map(e => e.tipoEj))].sort()

  const filtered = ejercicios.filter(e => {
    const q = search.toLowerCase()
    const matchQ = (e.nombre ?? '').toLowerCase().includes(q) || (e.descripcion ?? '').toLowerCase().includes(q)
    const matchT = tipo === '' || String(e.tipoEj) === tipo
    return matchQ && matchT
  })

  if (loading) return (
    <div className="flex items-center justify-center py-24" role="status" aria-label="Cargando ejercicios">
      <Loader2 size={24} className="animate-spin" style={{ color: 'var(--green)' }} aria-hidden="true" />
    </div>
  )

  if (error) return (
    <div className="py-16 text-center text-sm" role="alert" style={{ color: 'var(--red)' }}>
      {error}
    </div>
  )

  return (
    <div className="max-w-6xl space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-[18px] top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} aria-hidden="true" />
          <input type="search" placeholder="Buscar ejercicio..." value={search} onChange={e => setSearch(e.target.value)}
                 aria-label="Buscar ejercicio"
                 className="form-input"
                 style={{ width: '100%', padding: '14px 18px 14px 48px', borderRadius: 14, fontSize: 15, background: 'var(--bg-2)', border: '1px solid var(--line)', color: 'var(--text-0)', transition: 'border-color 0.15s' }} />
        </div>

        <select value={tipo} onChange={e => setTipo(e.target.value)}
                aria-label="Filtrar por tipo de ejercicio"
                className="form-input"
                style={{ padding: '14px 18px', borderRadius: 14, fontSize: 14, cursor: 'pointer', background: 'var(--bg-2)', border: '1px solid var(--line)', color: 'var(--text-2)', transition: 'border-color 0.15s' }}>
          <option value="">Todos los tipos</option>
          {tipos.map(t => (
            <option key={t} value={String(t)}>
              {tipoLabel[t] ?? `Tipo ${t}`}
            </option>
          ))}
        </select>

        <div className="flex rounded-lg overflow-hidden border" role="group" aria-label="Cambiar vista" style={{ borderColor: 'var(--line)' }}>
          {[['cards','Cards'],['tabla','Tabla']].map(([v,l]) => (
            <button key={v} onClick={() => setVista(v)} aria-pressed={vista === v}
                    style={{
                      padding: '12px 20px', fontSize: 13, fontWeight: 500, cursor: 'pointer', border: 'none',
                      background: vista === v ? 'var(--green)' : 'var(--bg-2)',
                      color: vista === v ? '#fff' : 'var(--text-2)',
                    }}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs" style={{ color: 'var(--text-3)' }} aria-live="polite">{filtered.length} ejercicios</p>

      {vista === 'cards' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(ej => (
            <Card key={ej.id} className="p-4 interactive-row">
              <div className="flex items-start justify-between gap-2 mb-2">
                <h3 className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>{ej.nombre}</h3>
                <Badge color={tipoColor[ej.tipoEj] ?? 'gray'}>
                  {tipoLabel[ej.tipoEj] ?? `Tipo ${ej.tipoEj}`}
                </Badge>
              </div>
              {ej.descripcion && (
                <p className="text-xs mb-3 line-clamp-2" style={{ color: 'var(--text-2)' }}>{ej.descripcion}</p>
              )}
              <div className="flex flex-wrap gap-1.5">
                {ej.idZonaCorporal != null && <Badge color="gray">Zona #{ej.idZonaCorporal}</Badge>}
                {ej.idTipoMaterial != null && <Badge color="gray">Mat. #{ej.idTipoMaterial}</Badge>}
                {ej.favorito && <Badge color="yellow">Favorito</Badge>}
              </div>
            </Card>
          ))}
          {filtered.length === 0 && (
            <div className="col-span-3 py-16 text-center" style={{ color: 'var(--text-3)' }}>
              No se encontraron ejercicios
            </div>
          )}
        </div>
      ) : (
        <Table
          ariaLabel="Tabla de ejercicios"
          columns={[
            { key: 'nombre', label: 'Ejercicio' },
            { key: 'tipoEj', label: 'Tipo', render: v => <Badge color={tipoColor[v] ?? 'gray'}>{tipoLabel[v] ?? `Tipo ${v}`}</Badge> },
            { key: 'idZonaCorporal', label: 'Zona', render: v => v != null ? `#${v}` : '—' },
            { key: 'idTipoMaterial', label: 'Material', render: v => v != null ? `#${v}` : '—' },
            { key: 'favorito', label: 'Fav.', render: v => v ? <Badge color="yellow">★</Badge> : '—' },
          ]}
          data={filtered}
        />
      )}
    </div>
  )
}
