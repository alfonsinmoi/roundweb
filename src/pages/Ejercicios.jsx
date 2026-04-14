import { useState, useEffect } from 'react'
import { Search, Loader2 } from 'lucide-react'
import { Card, Badge, Table } from '../components/UI'
import { getEjercicios } from '../utils/api'

// tipoEj values from the API (numeric codes)
const tipoLabel = { 0: 'Fuerza', 1: 'Cardio', 2: 'Funcional', 3: 'Resistencia', 4: 'HIIT', 5: 'Flexibilidad' }
const tipoColor = { 0: 'blue', 1: 'red', 2: 'yellow', 3: 'green', 4: 'red', 5: 'green' }

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
      .catch(err => setError(err.message))
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
    <div className="flex items-center justify-center py-24">
      <Loader2 size={24} className="animate-spin" style={{ color: 'var(--green)' }} />
    </div>
  )

  if (error) return (
    <div className="py-16 text-center text-sm" style={{ color: 'var(--red)' }}>
      Error cargando ejercicios: {error}
    </div>
  )

  return (
    <div className="max-w-6xl space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search size={14} style={{ position: "absolute", left: 18, top: "50%", transform: "translateY(-50%)", color: "var(--text-3)" }} className="top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
          <input type="search" placeholder="Buscar ejercicio..." value={search} onChange={e => setSearch(e.target.value)}
                 style={{ width: "100%", padding: "14px 18px 14px 48px", borderRadius: 14, fontSize: 15, background: "var(--bg-2)", border: "1px solid var(--line)", color: "var(--text-0)", outline: "none", transition: "border-color 0.15s" }}
                 style={{ background: 'var(--bg-2)', borderColor: 'var(--line)', color: 'var(--text-1)', outline: 'none' }}
                 onFocus={e => e.target.style.borderColor = 'var(--green)'}
                 onBlur={e => e.target.style.borderColor = 'var(--line)'} />
        </div>

        <select value={tipo} onChange={e => setTipo(e.target.value)}
                style={{ padding: "14px 18px", borderRadius: 14, fontSize: 14, cursor: "pointer", background: "var(--bg-2)", border: "1px solid var(--line)", color: "var(--text-2)", outline: "none" }}
                style={{ background: 'var(--bg-2)', borderColor: 'var(--line)', color: 'var(--text-2)', outline: 'none' }}>
          <option value="">Todos los tipos</option>
          {tipos.map(t => (
            <option key={t} value={String(t)}>
              {tipoLabel[t] ?? `Tipo ${t}`}
            </option>
          ))}
        </select>

        <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: 'var(--line)' }}>
          {[['cards','Cards'],['tabla','Tabla']].map(([v,l]) => (
            <button key={v} onClick={() => setVista(v)}
                    style={{ padding: "12px 20px", fontSize: 13, fontWeight: 500, cursor: "pointer", border: "none" }}
                    style={{ background: vista === v ? 'var(--green)' : 'var(--bg-2)', color: vista === v ? '#fff' : 'var(--text-2)' }}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs" style={{ color: 'var(--text-3)' }}>{filtered.length} ejercicios</p>

      {vista === 'cards' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(ej => (
            <Card key={ej.id} className="p-4 cursor-pointer"
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-3)'; e.currentTarget.style.borderColor = 'rgba(45,212,168,0.2)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-2)'; e.currentTarget.style.borderColor = 'var(--line)' }}>
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
