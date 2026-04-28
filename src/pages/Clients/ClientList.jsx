import { useState, useEffect, useMemo, useDeferredValue } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, Archive, Loader2, Send, X, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { Badge, Avatar, Btn, EmptyState } from '../../components/UI'
import ERPModal from '../../components/ERPModal'
import { getClientes, peekCache, peekPersistedCache, getERPConfiguraciones } from '../../utils/api'
import { useAuth } from '../../contexts/AuthContext'

const PAGE_SIZE = 15

/**
 * Devuelve los números de página a mostrar, con elipsis (…) para saltos.
 * Siempre muestra la primera y la última, más un rango cercano al actual.
 * Ejemplos:
 *   totalPages=5, current=1  → [1, 2, 3, 4, 5]
 *   totalPages=20, current=1 → [1, 2, 3, …, 20]
 *   totalPages=20, current=10 → [1, …, 9, 10, 11, …, 20]
 *   totalPages=20, current=20 → [1, …, 18, 19, 20]
 */
function buildPageList(totalPages, current) {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
  const pages = new Set([1, totalPages, current, current - 1, current + 1])
  // Acompañamos los extremos con una página cercana para evitar elipsis de un único número
  if (current <= 3) { pages.add(2); pages.add(3); pages.add(4) }
  if (current >= totalPages - 2) { pages.add(totalPages - 1); pages.add(totalPages - 2); pages.add(totalPages - 3) }
  const ordered = [...pages].filter(n => n >= 1 && n <= totalPages).sort((a, b) => a - b)
  const result = []
  ordered.forEach((n, i) => {
    if (i > 0 && n - ordered[i - 1] > 1) result.push('…')
    result.push(n)
  })
  return result
}

export default function ClientList() {
  const navigate = useNavigate()
  const { user }  = useAuth()
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [filtro, setFiltro] = useState('activos')
  const [clientes, setClientes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [erpCliente, setErpCliente] = useState(null)
  const [page, setPage] = useState(1)
  const [fotoPreview, setFotoPreview] = useState(null) // { imgUrl, nombre }

  useEffect(() => {
    let active = true
    setError('')

    // 1. Pintado instantáneo: memoria o sessionStorage (sobrevive a F5)
    const cachedClientes = peekPersistedCache('clientes')
    if (cachedClientes) {
      setClientes(cachedClientes)
      setLoading(false)
    }

    // 2. Refresco en segundo plano
    getClientes()
      .then(cli => { if (active) setClientes(cli) })
      .catch(err => { if (active && !cachedClientes) setError(err.message) })
      .finally(() => { if (active) setLoading(false) })

    return () => { active = false }
  }, [])

  // ERP activo si existe alguna configuración con al menos un campo definido
  const [tieneERP, setTieneERP] = useState(false)
  useEffect(() => {
    let active = true
    getERPConfiguraciones()
      .then(raw => {
        if (!active) return
        const configs = Array.isArray(raw) ? raw : (raw ? [raw] : [])
        const has = configs.some(c => Array.isArray(c?.campos) && c.campos.length > 0)
        setTieneERP(has)
      })
      .catch(() => { if (active) setTieneERP(false) })
    return () => { active = false }
  }, [])

  const clientFullName = c => `${c.nombre || c.name || ''} ${c.apellidos || c.surname || ''}`.trim()

  const filtered = useMemo(() => clientes.filter(c => {
    const q = deferredSearch.toLowerCase()
    const match = `${clientFullName(c)} ${c.email}`.toLowerCase().includes(q)
    if (!match) return false
    if (filtro === 'activos') return c.enabled !== false
    if (filtro === 'archivados') return c.enabled === false
    return true
  }), [clientes, deferredSearch, filtro])

  // Paginación: calcular total y ajustar la página actual si el filtro la deja
  // fuera de rango (p.ej. estábamos en pág. 5 y el nuevo filtro sólo tiene 3).
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

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

  const startIdx = (page - 1) * PAGE_SIZE
  const visible = filtered.slice(startIdx, startIdx + PAGE_SIZE)
  const cols = tieneERP ? '2fr 2fr 120px 1fr 1fr auto' : '2fr 2fr 120px 1fr 1fr'
  const pageList = buildPageList(totalPages, page)
  const goPage = p => setPage(Math.min(totalPages, Math.max(1, p)))

  return (
    <div>
      {/* ── Toolbar + contador (sticky, compacto) ── */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 50,
        isolation: 'isolate',
        background: 'var(--bg-0)',
        // Extiende horizontalmente para cubrir toda la anchura visible del scroll
        // y evitar que las filas que hay debajo se vean al pasar por detrás.
        marginLeft: 'calc(-1 * clamp(20px, 4vw, 48px))',
        marginRight: 'calc(-1 * clamp(20px, 4vw, 48px))',
        paddingLeft: 'clamp(20px, 4vw, 48px)',
        paddingRight: 'clamp(20px, 4vw, 48px)',
        paddingTop: 12,
        paddingBottom: 10,
        marginBottom: 12,
        borderBottom: '1px solid var(--line)',
        boxShadow: '0 4px 10px -6px rgba(0,0,0,0.25)',
      }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
            <Search size={15} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }} aria-hidden="true" />
            <input type="search" placeholder="Buscar cliente..."
                   value={search}
                   onChange={e => { setSearch(e.target.value); setPage(1) }}
                   aria-label="Buscar cliente"
                   style={{
                     width: '100%', padding: '10px 14px 10px 40px', borderRadius: 12, fontSize: 13,
                     background: 'var(--bg-2)', border: '1px solid var(--line)', color: 'var(--text-0)',
                     outline: 'none',
                   }} />
          </div>

          <div role="group" aria-label="Filtrar clientes" style={{ display: 'flex', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--line)' }}>
            {[['activos','Activos'],['archivados','Archivados'],['todos','Todos']].map(([v, l]) => (
              <button key={v} onClick={() => { setFiltro(v); setPage(1) }}
                      aria-pressed={filtro === v}
                      style={{
                        padding: '8px 14px', fontSize: 12, fontWeight: 500, cursor: 'pointer', border: 'none',
                        background: filtro === v ? 'var(--green-bg)' : 'var(--bg-2)',
                        color: filtro === v ? 'var(--green)' : 'var(--text-2)',
                        transition: 'all 0.1s',
                      }}>
                {l}
              </button>
            ))}
          </div>

          <Btn size="md" onClick={() => navigate('/clientes/nuevo')}>
            <Plus size={15} aria-hidden="true" /> Nuevo cliente
          </Btn>
        </div>

        {(() => {
          const sinFoto = filtered.filter(c => !c.imgUrl || typeof c.imgUrl !== 'string' || !c.imgUrl.trim()).length
          return (
            <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8 }} aria-live="polite">
              {filtered.length} cliente{filtered.length !== 1 ? 's' : ''}
              {filtered.length > 0 && (
                <span style={{ marginLeft: 10 }}>
                  · <strong style={{ color: sinFoto > 0 ? 'var(--amber)' : 'var(--text-2)' }}>{sinFoto}</strong> sin foto
                </span>
              )}
            </p>
          )
        })()}
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No se encontraron clientes"
                    description={deferredSearch ? 'Prueba con otros términos de búsqueda' : undefined} />
      ) : (
        <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 20, overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 0, padding: '8px 20px', background: 'var(--bg-3)', borderBottom: '1px solid var(--line)' }}>
            {['Cliente', 'Email', 'Estado', 'Teléfono', 'DNI', ...(tieneERP ? [''] : [])].map((h, i) => (
              <span key={i} style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-3)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>{h}</span>
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
                   padding: '8px 20px', cursor: 'pointer',
                   borderBottom: i < visible.length - 1 ? '1px solid var(--line)' : 'none',
                   transition: 'background 0.1s',
                 }}>

              {/* Cliente */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingRight: 12, minWidth: 0 }}>
                <button onClick={e => {
                          e.stopPropagation()
                          const r = e.currentTarget.getBoundingClientRect()
                          // 10cm ≈ 378px @ 96dpi — clampamos al viewport con un margen de 12px
                          const SIZE = 378
                          const M = 12
                          let x = r.right + 8 // al lado derecho del avatar
                          let y = r.top
                          if (x + SIZE + M > window.innerWidth) x = Math.max(M, r.left - SIZE - 8)
                          if (x + SIZE + M > window.innerWidth) x = window.innerWidth - SIZE - M
                          if (y + SIZE + 80 > window.innerHeight) y = window.innerHeight - SIZE - 80 - M
                          if (y < M) y = M
                          setFotoPreview({ imgUrl: c.imgUrl, nombre: clientFullName(c), x, y })
                        }}
                        onKeyDown={e => e.stopPropagation()}
                        aria-label={`Ampliar foto de ${clientFullName(c)}`}
                        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0, borderRadius: 12 }}>
                  <Avatar nombre={clientFullName(c)} size={30} imgUrl={c.imgUrl} />
                </button>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontFamily: 'Outfit', fontSize: 13, fontWeight: 600, color: 'var(--text-0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.2 }}>
                    {clientFullName(c)}
                  </p>
                  {c.idEspejo != null && (
                    <p style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'monospace' }}>#{c.idEspejo}</p>
                  )}
                </div>
              </div>

              {/* Email */}
              <p style={{ fontSize: 12, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 12 }} title={c.email}>
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
              <p style={{ fontSize: 12, color: 'var(--text-2)' }}>{c.cellPhone || '—'}</p>

              {/* DNI */}
              <p style={{ fontSize: 12, color: 'var(--text-2)' }}>{c.dni || '—'}</p>

              {/* ERP */}
              {tieneERP && (
                <button onClick={e => { e.stopPropagation(); setErpCliente(c) }}
                        aria-label={`Enviar ERP para ${c.name} ${c.surname}`}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 5,
                          padding: '5px 10px', borderRadius: 8, fontSize: 11, fontWeight: 500,
                          cursor: 'pointer', border: '1px solid var(--blue-border)',
                          background: 'var(--blue-bg)', color: 'var(--blue)', transition: 'all 0.1s',
                        }}>
                  <Send size={11} aria-hidden="true" /> ERP
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Paginación ── */}
      {filtered.length > PAGE_SIZE && (
        <nav aria-label="Paginación de clientes"
             style={{
               marginTop: 16, display: 'flex', flexWrap: 'wrap',
               alignItems: 'center', justifyContent: 'center', gap: 4,
             }}>
          <PagerBtn onClick={() => goPage(1)} disabled={page === 1} title="Primera página">
            <ChevronsLeft size={14} aria-hidden="true" />
          </PagerBtn>
          <PagerBtn onClick={() => goPage(page - 1)} disabled={page === 1} title="Página anterior">
            <ChevronLeft size={14} aria-hidden="true" />
          </PagerBtn>

          {pageList.map((p, i) =>
            p === '…' ? (
              <span key={`e${i}`} style={{ padding: '0 6px', fontSize: 13, color: 'var(--text-3)' }}>…</span>
            ) : (
              <PagerBtn key={p} onClick={() => goPage(p)} active={p === page}
                        title={`Página ${p}`} aria-current={p === page ? 'page' : undefined}>
                {p}
              </PagerBtn>
            )
          )}

          <PagerBtn onClick={() => goPage(page + 1)} disabled={page === totalPages} title="Página siguiente">
            <ChevronRight size={14} aria-hidden="true" />
          </PagerBtn>
          <PagerBtn onClick={() => goPage(totalPages)} disabled={page === totalPages} title="Última página">
            <ChevronsRight size={14} aria-hidden="true" />
          </PagerBtn>

          <span style={{ marginLeft: 12, fontSize: 12, color: 'var(--text-3)' }} aria-live="polite">
            {startIdx + 1}–{Math.min(startIdx + PAGE_SIZE, filtered.length)} de {filtered.length}
          </span>
        </nav>
      )}

      {erpCliente && (
        <ERPModal cliente={erpCliente} erpConfig={erpConfig} onClose={() => setErpCliente(null)} />
      )}

      {/* Preview de foto ampliada 10x10 cm, anclada a la posición del click */}
      {fotoPreview && (
        <>
          {/* Capa transparente para cerrar al hacer click fuera */}
          <div onClick={() => setFotoPreview(null)}
               style={{ position: 'fixed', inset: 0, zIndex: 99, background: 'transparent' }} />
          {/* Popup en la posición del click */}
          <div role="dialog" aria-label={`Foto de ${fotoPreview.nombre}`}
               onClick={e => e.stopPropagation()}
               style={{
                 position: 'fixed', top: fotoPreview.y, left: fotoPreview.x, zIndex: 100,
                 background: 'var(--bg-2)', borderRadius: 16, padding: 10,
                 border: '1px solid var(--line)',
                 boxShadow: '0 18px 48px rgba(0,0,0,0.45)',
                 display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
               }}>
            <button onClick={() => setFotoPreview(null)}
                    aria-label="Cerrar"
                    style={{
                      position: 'absolute', top: 6, right: 6,
                      width: 28, height: 28, borderRadius: 8,
                      background: 'rgba(0,0,0,0.55)', color: '#fff',
                      border: 'none', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
              <X size={14} aria-hidden="true" />
            </button>
            <div style={{
              width: '10cm', height: '10cm',
              borderRadius: 12, overflow: 'hidden',
              background: 'var(--bg-3)', border: '1px solid var(--line)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {fotoPreview.imgUrl ? (
                <img src={fotoPreview.imgUrl} alt={fotoPreview.nombre}
                     style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <span style={{ fontSize: 14, color: 'var(--text-3)' }}>Sin foto</span>
              )}
            </div>
            <p style={{ fontFamily: 'Outfit', fontSize: 13, fontWeight: 600, color: 'var(--text-0)', textAlign: 'center', maxWidth: '10cm', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {fotoPreview.nombre}
            </p>
          </div>
        </>
      )}
    </div>
  )
}

// ── Botón de paginación ──────────────────────────────────────────────────────
function PagerBtn({ children, onClick, disabled, active, title, ...rest }) {
  return (
    <button onClick={onClick} disabled={disabled} title={title} {...rest}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              minWidth: 30, height: 30, padding: '0 9px',
              borderRadius: 8, fontSize: 13, fontWeight: active ? 600 : 500,
              cursor: disabled ? 'not-allowed' : 'pointer',
              border: '1px solid ' + (active ? 'var(--green)' : 'var(--line)'),
              background: active ? 'var(--green-bg)' : 'var(--bg-2)',
              color: active ? 'var(--green)' : disabled ? 'var(--text-3)' : 'var(--text-2)',
              opacity: disabled ? 0.45 : 1,
              transition: 'all 0.1s',
              fontFamily: 'inherit',
            }}>
      {children}
    </button>
  )
}
