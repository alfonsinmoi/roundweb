// Pantalla principal Contabilidad — fase 1.
// Subir factura/nómina/extracto/impuesto, listar documentos, validar/rechazar.
// Listados avanzados (totales, banco sin cuadrar, faltantes, P&L) → fase 2.

import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  Calculator, Upload, RefreshCw, Loader2, Filter, Eye, Check, X,
  CheckCircle2, XCircle, Clock, FileText, Trash2, Send, Download,
} from 'lucide-react'
import { Card, Btn, Badge, SectionTitle, EmptyState } from '../../components/UI'
import { useToast } from '../../components/Toast'
import { useAuth } from '../../contexts/AuthContext'
import {
  getRoundIdentity,
  contabCatsList, contabDocsList, contabDocUpload, contabDocValidar,
  contabDocRechazar, contabDocDelete, contabDocFileUrl, contabListadosGet,
  contabDocEscanear, contabTotales, contabFaltantes, contabResultados,
  contabBancoImportar, contabBancoMovs, contabBancoLink, contabBancoMatching,
} from '../../utils/configApi'

export default function ContabilidadPage() {
  const { user, isImpersonating } = useAuth()
  const identity = useMemo(() => getRoundIdentity(user), [user])
  const toast = useToast()
  const [cats, setCats] = useState([])
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [filtros, setFiltros] = useState(() => {
    const pad = n => String(n).padStart(2, '0')
    const fmt = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
    const hoy = new Date()
    const desde = new Date(hoy.getFullYear(), 0, 1)  // 1 de enero del año actual
    return { desde: fmt(desde), hasta: fmt(hoy), estado: '', categoria_id: '', q: '' }
  })
  const [showUpload, setShowUpload] = useState(false)
  const [listadosVis, setListadosVis] = useState({})
  const [tab, setTab] = useState('docs')   // docs | totales | faltantes | resultados

  async function reload() {
    setLoading(true)
    try {
      const [c, d] = await Promise.all([
        contabCatsList(identity).catch(() => ({ categorias: [] })),
        contabDocsList(identity, filtros).catch(() => []),
      ])
      setCats(c.categorias || [])
      setDocs(d || [])
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setLoading(false)
  }
  useEffect(() => { reload() /* eslint-disable-next-line */ }, [
    identity.managerId, filtros.desde, filtros.hasta, filtros.estado,
    filtros.categoria_id, filtros.q,
  ])

  // Listados visibles para el trainer impersonando (manager ve todos)
  useEffect(() => {
    if (!identity?.trainerId) return
    contabListadosGet(identity).then(d => {
      setListadosVis(d.por_trainer?.[String(identity.trainerId)] || {})
    }).catch(() => {})
  }, [identity?.managerId, identity?.trainerId])

  const stats = useMemo(() => {
    const total = docs.length
    const borrador = docs.filter(d => d.estado === 'borrador').length
    const validado = docs.filter(d => d.estado === 'validado').length
    const rechazado = docs.filter(d => d.estado === 'rechazado').length
    const totalImporte = docs.reduce((a, d) => a + (parseFloat(d.importe_total) || 0), 0)
    return { total, borrador, validado, rechazado, totalImporte }
  }, [docs])

  return (
    <div style={{ maxWidth: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <Calculator size={22} style={{ color: 'var(--green)' }} />
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, color: 'var(--text-0)', margin: 0 }}>
          Contabilidad
        </h1>
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 20 }}>
        Sube y gestiona facturas, nóminas, extractos bancarios e impuestos.
        {isImpersonating ? ' Solo ves los documentos asignados a ti.' : ' Vista completa del manager.'}
      </p>

      {/* Sub-tabs */}
      <div role="tablist" style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--line)', marginBottom: 18 }}>
        {[
          ['docs',       '📄 Documentos'],
          ['banco',      '🏦 Banco'],
          ['totales',    '📊 Totales'],
          ['faltantes',  '⚠️ Faltantes'],
          ['resultados', '💰 Cuenta de resultados'],
        ]
        .filter(([id]) => !identity?.trainerId || (listadosVis[id === 'totales' ? 'totales_periodo' : id === 'resultados' ? 'resultados' : id] !== false))
        .map(([id, label]) => {
          const active = tab === id
          return (
            <button key={id} role="tab" aria-selected={active}
                    onClick={() => setTab(id)}
                    style={{
                      padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer',
                      fontSize: 13, fontWeight: active ? 700 : 500,
                      color: active ? 'var(--text-0)' : 'var(--text-2)',
                      borderBottom: active ? '2px solid var(--green)' : '2px solid transparent',
                      marginBottom: -1,
                    }}>
              {label}
            </button>
          )
        })}
      </div>

      {tab === 'docs' && (<>
      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 20 }}>
        <StatBox label="Documentos" value={stats.total} color="var(--text-1)" />
        <StatBox label="Borrador" value={stats.borrador} color="var(--amber)" />
        <StatBox label="Validados" value={stats.validado} color="var(--green)" />
        <StatBox label="Rechazados" value={stats.rechazado} color="var(--red)" />
        <StatBox label="Importe total" value={`${stats.totalImporte.toFixed(2)} €`} color="var(--blue)" />
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 14 }}>
        <Lbl text="Desde">
          <input type="date" value={filtros.desde}
                 onChange={e => setFiltros(f => ({ ...f, desde: e.target.value }))} style={inp} />
        </Lbl>
        <Lbl text="Hasta">
          <input type="date" value={filtros.hasta}
                 onChange={e => setFiltros(f => ({ ...f, hasta: e.target.value }))} style={inp} />
        </Lbl>
        <Lbl text="Estado">
          <select value={filtros.estado}
                  onChange={e => setFiltros(f => ({ ...f, estado: e.target.value }))} style={inp}>
            <option value="">Todos</option>
            <option value="borrador">Borrador</option>
            <option value="validado">Validado</option>
            <option value="rechazado">Rechazado</option>
          </select>
        </Lbl>
        <Lbl text="Categoría">
          <select value={filtros.categoria_id}
                  onChange={e => setFiltros(f => ({ ...f, categoria_id: e.target.value }))} style={inp}>
            <option value="">Todas</option>
            {cats.filter(c => c.activa).map(c => (
              <option key={c.id} value={c.id}>{c.nombre}</option>
            ))}
          </select>
        </Lbl>
        <Lbl text="Buscar">
          <input type="search" value={filtros.q}
                 onChange={e => setFiltros(f => ({ ...f, q: e.target.value }))}
                 placeholder="Proveedor, num. factura, concepto…" style={{ ...inp, minWidth: 220 }} />
        </Lbl>
        <button onClick={reload} title="Recargar" style={{ ...iconBtn, marginBottom: 1 }}>
          <RefreshCw size={14} />
        </button>
        <div style={{ flex: 1 }} />
        <Btn variant="primary" onClick={() => setShowUpload(true)}>
          <Upload size={14} /> Subir documento
        </Btn>
      </div>

      {showUpload && (
        <UploadModal cats={cats} identity={identity}
                     onClose={() => setShowUpload(false)}
                     onUploaded={() => { setShowUpload(false); reload() }} />
      )}

      {loading ? (
        <Spinner />
      ) : docs.length === 0 ? (
        <EmptyState title="Sin documentos"
                    description="Sube tu primera factura, nómina o extracto." />
      ) : (
        <DocsTable docs={docs} identity={identity}
                   onAction={async (action, doc, extra) => {
                     try {
                       if (action === 'validar') { await contabDocValidar(identity, doc.id); toast.success('Validado') }
                       else if (action === 'rechazar') { await contabDocRechazar(identity, doc.id, extra?.motivo); toast.success('Rechazado') }
                       else if (action === 'borrar') { await contabDocDelete(identity, doc.id); toast.success('Borrado') }
                       reload()
                     } catch (e) { toast.error(`Error: ${e.message}`) }
                   }} />
      )}
      </>)}

      {tab === 'banco'      && <BancoPanel identity={identity} />}
      {tab === 'totales'    && <TotalesPanel identity={identity} />}
      {tab === 'faltantes'  && <FaltantesPanel identity={identity} />}
      {tab === 'resultados' && <ResultadosPanel identity={identity} />}
    </div>
  )
}


function BancoPanel({ identity }) {
  const toast = useToast()
  const [movs, setMovs] = useState([])
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [matching, setMatching] = useState(false)
  const [matchResult, setMatchResult] = useState(null)
  const [filtros, setFiltros] = useState({ estado: 'sin_cuadrar', q: '' })

  async function reload() {
    setLoading(true)
    try {
      const list = await contabBancoMovs(identity, filtros)
      setMovs(list)
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setLoading(false)
  }
  useEffect(() => { reload() /* eslint-disable-next-line */ }, [identity?.managerId, filtros.estado, filtros.q])

  const onImport = async (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    setImporting(true)
    try {
      const fd = new FormData()
      fd.append('file', f)
      const r = await contabBancoImportar(identity, fd)
      toast.success(`${r.insertadas} movimientos importados (${r.duplicadas} duplicados)`)
      reload()
    } catch (e) {
      toast.error(`Error: ${e.message}`)
    }
    setImporting(false)
    e.target.value = ''  // permitir re-subir el mismo archivo
  }

  const runMatching = async (autoApply = false) => {
    setMatching(true)
    try {
      const r = await contabBancoMatching(identity, autoApply)
      setMatchResult(r)
      const auto = r.auto_aplicados || 0
      const sug = (r.matches || []).filter(m => m.accion === 'sugerencia').length
      toast.success(`${auto} auto-aplicados · ${sug} sugerencias humanas`)
      reload()
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setMatching(false)
  }

  const onLink = async (mov, factura_id) => {
    try {
      await contabBancoLink(identity, mov.id, { factura_id })
      toast.success(factura_id ? 'Vinculado' : 'Desvinculado')
      reload()
    } catch (e) { toast.error(`Error: ${e.message}`) }
  }

  const stats = useMemo(() => {
    const sc = movs.filter(m => m.estado === 'sin_cuadrar').length
    const cd = movs.filter(m => m.estado === 'cuadrado').length
    const ig = movs.filter(m => m.estado === 'ignorado').length
    return { sc, cd, ig }
  }, [movs])

  const fmtDate = d => d ? new Date(d).toLocaleDateString('es-ES', { day:'2-digit', month:'2-digit' }) : '—'

  return (
    <div>
      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 14 }}>
        <StatBox label="Sin cuadrar" value={stats.sc} color="var(--amber)" />
        <StatBox label="Cuadrados"   value={stats.cd} color="var(--green)" />
        <StatBox label="Ignorados"   value={stats.ig} color="var(--text-3)" />
      </div>

      {/* Toolbar */}
      <Card style={{ padding: 14, marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Lbl text="Estado">
            <select value={filtros.estado} onChange={e => setFiltros(f => ({ ...f, estado: e.target.value }))} style={inp}>
              <option value="">Todos</option>
              <option value="sin_cuadrar">Sin cuadrar</option>
              <option value="cuadrado">Cuadrados</option>
              <option value="ignorado">Ignorados</option>
            </select>
          </Lbl>
          <Lbl text="Buscar">
            <input type="search" value={filtros.q} onChange={e => setFiltros(f => ({ ...f, q: e.target.value }))}
                   placeholder="Concepto…" style={{ ...inp, minWidth: 180 }} />
          </Lbl>
          <div style={{ flex: 1 }} />
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                            padding: '8px 14px', borderRadius: 10,
                            background: 'var(--bg-2)', border: '1px solid var(--line)',
                            fontSize: 13 }}>
            <Upload size={13} /> {importing ? 'Importando…' : 'Importar extracto'}
            <input type="file" accept=".csv,.txt,.xlsx" onChange={onImport}
                   disabled={importing} style={{ display: 'none' }} />
          </label>
          <Btn variant="primary" onClick={() => runMatching(true)} disabled={matching}>
            {matching ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Cuadrar automático
          </Btn>
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8 }}>
          Sube un CSV o XLSX con tus movimientos. El sistema detecta columnas
          (fecha / concepto / importe / saldo) automáticamente y cuadra contra
          tus facturas validadas (importe + fecha + concepto similar).
        </p>
      </Card>

      {/* Resultados último matching */}
      {matchResult && (
        <Card style={{ padding: 12, marginBottom: 14, background: 'var(--bg-1)' }}>
          <p style={{ fontSize: 12, color: 'var(--text-2)' }}>
            <strong>Último matching:</strong> {matchResult.movimientos_sin_cuadrar} sin cuadrar
            · {matchResult.facturas_disponibles} facturas disponibles
            · {matchResult.matches_propuestos} propuestos
            · <strong style={{ color: 'var(--green)' }}>{matchResult.auto_aplicados}</strong> auto-aplicados (score ≥ {matchResult.umbral_auto})
          </p>
        </Card>
      )}

      {/* Tabla movimientos */}
      {loading ? <Spinner /> : movs.length === 0 ? (
        <EmptyState title="Sin movimientos"
                    description="Importa un extracto bancario CSV o XLSX para empezar." />
      ) : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '0.6fr 2fr 0.9fr 0.9fr 1fr 1.4fr 100px',
                         padding: '10px 16px', background: 'var(--bg-3)', fontSize: 11,
                         color: 'var(--text-3)', textTransform: 'uppercase' }}>
            <span>Fecha</span><span>Concepto</span><span>Importe</span><span>Saldo</span>
            <span>Estado</span><span>Factura</span><span></span>
          </div>
          {movs.map((m, i) => (
            <div key={m.id} style={{
              display: 'grid', gridTemplateColumns: '0.6fr 2fr 0.9fr 0.9fr 1fr 1.4fr 100px',
              padding: '10px 16px', alignItems: 'center', fontSize: 12,
              borderTop: i > 0 ? '1px solid var(--line)' : 'none',
            }}>
              <span style={{ fontFamily: 'monospace' }}>{fmtDate(m.fecha)}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.concepto}>
                {m.concepto}
              </span>
              <span style={{ fontFamily: 'monospace', fontWeight: 600,
                             color: parseFloat(m.importe) < 0 ? 'var(--red)' : 'var(--green)' }}>
                {parseFloat(m.importe).toFixed(2)} €
              </span>
              <span style={{ fontFamily: 'monospace', color: 'var(--text-3)' }}>
                {m.saldo != null ? parseFloat(m.saldo).toFixed(2) + ' €' : '—'}
              </span>
              <Badge color={
                m.estado === 'cuadrado' ? 'green'
                : m.estado === 'sin_cuadrar' ? 'amber'
                : m.estado === 'ignorado' ? 'gray' : 'blue'
              }>{m.estado}</Badge>
              <span style={{ fontSize: 11, color: 'var(--text-2)', overflow: 'hidden',
                             textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    title={m.factura_proveedor && `${m.factura_proveedor} · ${m.factura_num} · ${m.factura_importe}€`}>
                {m.factura_relacionada_id ? (
                  `#${m.factura_relacionada_id} ${m.factura_proveedor || ''}`
                ) : '—'}
              </span>
              <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                {m.factura_relacionada_id ? (
                  <button onClick={() => onLink(m, null)} title="Desvincular"
                          style={{...iconBtn, color: 'var(--red)'}}>
                    <X size={11} />
                  </button>
                ) : (
                  <button onClick={() => contabBancoLink(identity, m.id, { estado: 'ignorado' }).then(reload)}
                          title="Ignorar" style={iconBtn}>
                    <X size={11} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}


function TotalesPanel({ identity }) {
  const toast = useToast()
  const [groupBy, setGroupBy] = useState('mes')
  const [estado, setEstado] = useState('validado')
  const [filtros, setFiltros] = useState(() => {
    const pad = n => String(n).padStart(2, '0')
    const fmt = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
    const hoy = new Date()
    const desde = new Date(hoy.getFullYear(), 0, 1)
    return { desde: fmt(desde), hasta: fmt(hoy) }
  })
  const [data, setData] = useState({ filas: [] })
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    setLoading(true)
    contabTotales(identity, { ...filtros, group_by: groupBy, estado })
      .then(d => setData(d || { filas: [] }))
      .catch(e => toast.error(`Error: ${e.message}`))
      .finally(() => setLoading(false))
  // eslint-disable-next-line
  }, [identity?.managerId, groupBy, estado, filtros.desde, filtros.hasta])

  const total = data.filas.reduce((a, r) => a + parseFloat(r.importe_total || 0), 0)
  return (
    <div>
      <Card style={{ padding: 14, marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Lbl text="Agrupar por">
            <select value={groupBy} onChange={e => setGroupBy(e.target.value)} style={inp}>
              <option value="mes">Mes</option>
              <option value="categoria">Categoría</option>
              <option value="proveedor">Proveedor</option>
              <option value="trainer">Trainer</option>
              <option value="tipo">Tipo</option>
            </select>
          </Lbl>
          <Lbl text="Estado">
            <select value={estado} onChange={e => setEstado(e.target.value)} style={inp}>
              <option value="validado">Validados</option>
              <option value="">Todos</option>
              <option value="borrador">Borrador</option>
            </select>
          </Lbl>
          <Lbl text="Desde"><input type="date" value={filtros.desde} onChange={e => setFiltros(f => ({ ...f, desde: e.target.value }))} style={inp} /></Lbl>
          <Lbl text="Hasta"><input type="date" value={filtros.hasta} onChange={e => setFiltros(f => ({ ...f, hasta: e.target.value }))} style={inp} /></Lbl>
        </div>
      </Card>
      {loading ? <Spinner /> : data.filas.length === 0 ? (
        <EmptyState title="Sin datos en el rango" />
      ) : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr',
                         padding: '10px 16px', background: 'var(--bg-3)',
                         fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase' }}>
            <span>{groupBy}</span><span>Base</span><span>IVA</span><span>Total</span><span>Docs</span>
          </div>
          {data.filas.map((r, i) => (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr',
              padding: '10px 16px', alignItems: 'center', fontSize: 13,
              borderTop: i > 0 ? '1px solid var(--line)' : 'none',
            }}>
              <span style={{ fontWeight: 500 }}>{r.grupo}</span>
              <span style={{ fontFamily: 'monospace' }}>{parseFloat(r.importe_base).toFixed(2)} €</span>
              <span style={{ fontFamily: 'monospace' }}>{parseFloat(r.importe_iva).toFixed(2)} €</span>
              <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{parseFloat(r.importe_total).toFixed(2)} €</span>
              <span>{r.n_docs}</span>
            </div>
          ))}
          <div style={{
            display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr',
            padding: '12px 16px', borderTop: '2px solid var(--line)',
            background: 'var(--bg-3)', fontSize: 13, fontWeight: 700,
          }}>
            <span>TOTAL</span>
            <span></span><span></span>
            <span style={{ fontFamily: 'monospace' }}>{total.toFixed(2)} €</span>
            <span>{data.filas.reduce((a, r) => a + r.n_docs, 0)}</span>
          </div>
        </Card>
      )}
    </div>
  )
}


function FaltantesPanel({ identity }) {
  const toast = useToast()
  const [meses, setMeses] = useState(6)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    setLoading(true)
    contabFaltantes(identity, meses)
      .then(setItems)
      .catch(e => toast.error(`Error: ${e.message}`))
      .finally(() => setLoading(false))
  // eslint-disable-next-line
  }, [identity?.managerId, meses])

  return (
    <div>
      <Card style={{ padding: 14, marginBottom: 14 }}>
        <Lbl text="Ventana (meses atrás)">
          <input type="number" min={1} max={24} value={meses}
                 onChange={e => setMeses(parseInt(e.target.value) || 6)}
                 style={{ ...inp, width: 100 }} />
        </Lbl>
        <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8 }}>
          Categorías con periodicidad cuyo período no tiene ningún documento.
          Solo aparecen las que tienen periodicidad mensual / trimestral / anual.
        </p>
      </Card>
      {loading ? <Spinner /> : items.length === 0 ? (
        <Card style={{ padding: 30, textAlign: 'center' }}>
          <CheckCircle2 size={28} style={{ color: 'var(--green)', margin: '0 auto 8px' }} />
          <p style={{ fontSize: 14, color: 'var(--text-1)' }}>¡Al día!</p>
          <p style={{ fontSize: 12, color: 'var(--text-3)' }}>No faltan documentos en la ventana seleccionada.</p>
        </Card>
      ) : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {items.map((f, i) => (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: '1fr 2fr 1fr 1fr',
              padding: '10px 16px', alignItems: 'center', fontSize: 13,
              borderTop: i > 0 ? '1px solid var(--line)' : 'none',
            }}>
              <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{f.periodo_faltante}</span>
              <span><Badge color={f.color || 'gray'}>{f.nombre}</Badge></span>
              <span style={{ color: 'var(--text-3)' }}>{f.tipo}</span>
              <span style={{ color: 'var(--text-3)', fontSize: 11 }}>{f.periodicidad}</span>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}


function ResultadosPanel({ identity }) {
  const toast = useToast()
  const [filtros, setFiltros] = useState(() => {
    const pad = n => String(n).padStart(2, '0')
    const fmt = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
    const hoy = new Date()
    const desde = new Date(hoy.getFullYear(), 0, 1)
    return { desde: fmt(desde), hasta: fmt(hoy) }
  })
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    setLoading(true)
    contabResultados(identity, filtros.desde, filtros.hasta)
      .then(setData)
      .catch(e => toast.error(`Error: ${e.message}`))
      .finally(() => setLoading(false))
  // eslint-disable-next-line
  }, [identity?.managerId, filtros.desde, filtros.hasta])

  return (
    <div>
      <Card style={{ padding: 14, marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <Lbl text="Desde"><input type="date" value={filtros.desde} onChange={e => setFiltros(f => ({ ...f, desde: e.target.value }))} style={inp} /></Lbl>
          <Lbl text="Hasta"><input type="date" value={filtros.hasta} onChange={e => setFiltros(f => ({ ...f, hasta: e.target.value }))} style={inp} /></Lbl>
        </div>
      </Card>
      {loading ? <Spinner /> : !data ? <EmptyState title="Sin datos" /> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 14 }}>
            <StatBox label="Ingresos (Odoo)" value={`${data.total.ingresos.toFixed(2)} €`} color="var(--green)" />
            <StatBox label="Gastos" value={`${data.total.gastos.toFixed(2)} €`} color="var(--red)" />
            <StatBox label="Beneficio" value={`${data.total.beneficio.toFixed(2)} €`}
                     color={data.total.beneficio >= 0 ? 'var(--green)' : 'var(--red)'} />
          </div>
          {data.filas.length === 0 ? (
            <EmptyState title="Sin movimientos en el rango" />
          ) : (
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr',
                             padding: '10px 16px', background: 'var(--bg-3)',
                             fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase' }}>
                <span>Mes</span><span>Ingresos</span><span>Gastos</span><span>Beneficio</span>
              </div>
              {data.filas.map((r, i) => (
                <div key={r.mes} style={{
                  display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr',
                  padding: '10px 16px', alignItems: 'center', fontSize: 13,
                  borderTop: i > 0 ? '1px solid var(--line)' : 'none',
                }}>
                  <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{r.mes}</span>
                  <span style={{ fontFamily: 'monospace', color: 'var(--green)' }}>{r.ingresos.toFixed(2)} €</span>
                  <span style={{ fontFamily: 'monospace', color: 'var(--red)' }}>{r.gastos.toFixed(2)} €</span>
                  <span style={{ fontFamily: 'monospace', fontWeight: 700,
                                 color: r.beneficio >= 0 ? 'var(--green)' : 'var(--red)' }}>
                    {r.beneficio.toFixed(2)} €
                  </span>
                </div>
              ))}
            </Card>
          )}
        </>
      )}
    </div>
  )
}


function DocsTable({ docs, identity, onAction }) {
  const fmt = d => d ? new Date(d).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: '2-digit' }) : '—'
  const num = v => v != null ? parseFloat(v).toFixed(2) : '—'
  const estadoStyle = {
    borrador: { color: 'amber', icon: Clock },
    validado: { color: 'green', icon: CheckCircle2 },
    rechazado: { color: 'red', icon: XCircle },
    duplicado: { color: 'gray', icon: X },
  }

  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr 1fr 0.7fr 0.9fr 1fr 1.2fr',
                     padding: '10px 16px', background: 'var(--bg-3)', fontSize: 11,
                     color: 'var(--text-3)', textTransform: 'uppercase' }}>
        <span>Fecha</span><span>Proveedor / num.</span><span>Categoría</span>
        <span>Periodo</span><span>Total</span><span>Estado</span><span></span>
      </div>
      {docs.map((d, i) => {
        const s = estadoStyle[d.estado] || { color: 'gray', icon: Clock }
        const Icon = s.icon
        return (
          <div key={d.id} style={{
            display: 'grid', gridTemplateColumns: '1fr 1.5fr 1fr 0.7fr 0.9fr 1fr 1.2fr',
            padding: '10px 16px', alignItems: 'center', fontSize: 13,
            borderTop: i > 0 ? '1px solid var(--line)' : 'none',
          }}>
            <span style={{ color: 'var(--text-2)' }}>{fmt(d.fecha_documento)}</span>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontWeight: 600, color: 'var(--text-0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {d.proveedor || '—'}
              </p>
              <p style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'monospace' }}>
                {d.num_factura || '—'}
              </p>
            </div>
            <span>{d.categoria_nombre || '—'}</span>
            <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{d.periodo || '—'}</span>
            <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{num(d.importe_total)} €</span>
            <span><Badge color={s.color}><Icon size={10} /> {d.estado}</Badge></span>
            <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
              <a href={contabDocFileUrl(d.id, identity)} target="_blank" rel="noreferrer" style={iconBtn} title="Ver archivo">
                <Eye size={12} />
              </a>
              {d.estado === 'borrador' && (
                <>
                  <button onClick={() => onAction('validar', d)} title="Validar" style={{...iconBtn, color: 'var(--green)'}}>
                    <Check size={12} />
                  </button>
                  <button onClick={() => {
                    const m = prompt('Motivo del rechazo (opcional):') || ''
                    onAction('rechazar', d, { motivo: m })
                  }} title="Rechazar" style={{...iconBtn, color: 'var(--amber)'}}>
                    <X size={12} />
                  </button>
                </>
              )}
              {d.estado !== 'validado' && !d.odoo_move_id && !identity.trainerId && (
                <button onClick={() => confirm(`Borrar documento ${d.proveedor || ''} ${d.num_factura || ''}?`) && onAction('borrar', d)}
                        title="Borrar" style={{...iconBtn, color: 'var(--red)'}}>
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          </div>
        )
      })}
    </Card>
  )
}


function UploadModal({ cats, identity, onClose, onUploaded }) {
  const toast = useToast()
  // Fases del flujo: 'pick' (selecciona archivo) → 'scanning' (subiendo+escaneando)
  // → 'review' (form rellenado por LLM, user revisa y valida)
  const [fase, setFase] = useState('pick')
  const [archivo, setArchivo] = useState(null)
  const [docId, setDocId] = useState(null)
  const [extraction, setExtraction] = useState(null)  // { confidence, notes, subtipo, ... }
  const [warning, setWarning] = useState(null)         // {tipo, mensaje, severity, ...}
  const [dobleAuth, setDobleAuth] = useState(false)    // checkbox confirmación
  const [form, setForm] = useState({
    categoria_id: '',
    proveedor: '', proveedor_vat: '', num_factura: '',
    fecha_documento: new Date().toISOString().slice(0, 10),
    periodo: '',
    importe_base: '', importe_iva: '', importe_total: '', iva_pct: '21.00',
    concepto: '', notas: '',
  })
  const [saving, setSaving] = useState(false)

  // Auto-rellenar IVA cuando cambia categoría (solo si no viene del LLM)
  useEffect(() => {
    if (!form.categoria_id || extraction) return
    const c = cats.find(x => String(x.id) === String(form.categoria_id))
    if (c?.iva_default != null) setForm(f => ({ ...f, iva_pct: String(c.iva_default), proveedor: f.proveedor || c.proveedor_default || '' }))
  // eslint-disable-next-line
  }, [form.categoria_id])

  // Auto-calcular total si tienes base + iva% (solo en review manual sin LLM)
  useEffect(() => {
    if (extraction) return  // si vino del LLM no recalculamos
    const base = parseFloat(form.importe_base)
    const iva  = parseFloat(form.iva_pct)
    if (!isNaN(base) && !isNaN(iva)) {
      const ivaImp = +(base * iva / 100).toFixed(2)
      const total  = +(base + ivaImp).toFixed(2)
      setForm(f => ({ ...f, importe_iva: String(ivaImp), importe_total: String(total) }))
    }
  // eslint-disable-next-line
  }, [form.importe_base, form.iva_pct])

  // Auto-detectar período YYYY-MM desde fecha
  useEffect(() => {
    if (form.fecha_documento && !form.periodo) {
      setForm(f => ({ ...f, periodo: form.fecha_documento.slice(0, 7) }))
    }
  // eslint-disable-next-line
  }, [form.fecha_documento])

  // ── Fase 1: subir archivo + lanzar escaneo LLM ──
  const subirYEscanear = async () => {
    if (!archivo) { toast.error('Selecciona un archivo'); return }
    setFase('scanning')
    try {
      // 1. Upload (mínimo, sin metadata aún)
      const fd = new FormData()
      fd.append('file', archivo)
      const doc = await contabDocUpload(identity, fd)
      setDocId(doc.id)
      // 2. Llamar a escanear → LLM rellena la fila
      try {
        const r = await contabDocEscanear(identity, doc.id)
        setExtraction(r.extraction)
        setWarning(r.warning || null)
        // Cargar los datos al form. Convertir fecha (puede venir RFC o ISO).
        const toIsoDate = (v) => {
          if (!v) return ''
          // Si ya viene "YYYY-MM-DD" la dejamos tal cual
          if (/^\d{4}-\d{2}-\d{2}/.test(String(v))) return String(v).slice(0, 10)
          // Si es RFC ("Fri, 15 May 2026 00:00:00 GMT") la parseamos
          try {
            const dt = new Date(v)
            if (isNaN(dt)) return ''
            const y = dt.getFullYear(), m = String(dt.getMonth()+1).padStart(2,'0'), d = String(dt.getDate()).padStart(2,'0')
            return `${y}-${m}-${d}`
          } catch { return '' }
        }
        const d = r.documento || {}
        setForm({
          categoria_id: d.categoria_id ? String(d.categoria_id) : '',
          proveedor: d.proveedor || '',
          proveedor_vat: d.proveedor_vat || '',
          num_factura: d.num_factura || '',
          fecha_documento: toIsoDate(d.fecha_documento),
          periodo: d.periodo || '',
          importe_base: d.importe_base != null ? String(d.importe_base) : '',
          importe_iva: d.importe_iva != null ? String(d.importe_iva) : '',
          importe_total: d.importe_total != null ? String(d.importe_total) : '',
          iva_pct: d.iva_pct != null ? String(d.iva_pct) : '21.00',
          concepto: d.concepto || '',
          notas: d.notas || '',
        })
        toast.success(`Escaneado · confianza ${Math.round((r.extraction?.confidence ?? 0) * 100)}%`)
      } catch (escanErr) {
        // Si LLM falla, dejamos el doc creado y permitimos rellenar a mano
        toast.error(`Escaneo no disponible: ${escanErr.message}. Rellena los datos manualmente.`)
        setExtraction({ extraction_failed: true, error: escanErr.message })
      }
      setFase('review')
    } catch (e) {
      toast.error(`Error: ${e.message}`)
      setFase('pick')
    }
  }

  // ── Fase 2: actualizar metadatos editados + validar ──
  const guardarYValidar = async () => {
    if (!docId) return
    setSaving(true)
    try {
      // 1. PATCH con cualquier cambio que el user haya hecho al form
      const patch = {
        categoria_id: form.categoria_id ? parseInt(form.categoria_id) : null,
        proveedor: form.proveedor || null,
        proveedor_vat: form.proveedor_vat || null,
        num_factura: form.num_factura || null,
        fecha_documento: form.fecha_documento || null,
        periodo: form.periodo || null,
        importe_base: form.importe_base ? parseFloat(form.importe_base) : null,
        importe_iva: form.importe_iva ? parseFloat(form.importe_iva) : null,
        importe_total: form.importe_total ? parseFloat(form.importe_total) : null,
        iva_pct: form.iva_pct ? parseFloat(form.iva_pct) : null,
        concepto: form.concepto || null,
        notas: form.notas || null,
      }
      await fetch(`/api/contab/documentos/${docId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Round-Token': import.meta.env.VITE_CONFIG_API_TOKEN || '',
          'X-Round-Manager-Id': identity.managerId || '',
          ...(identity.trainerId ? { 'X-Round-Trainer-Id': identity.trainerId } : {}),
        },
        body: JSON.stringify(patch),
      })
      // 2. Validar (con doble auth si requiere_autorizacion)
      await contabDocValidar(identity, docId, { doble_auth: dobleAuth })
      toast.success('Documento validado')
      onUploaded()
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setSaving(false)
  }

  const guardarBorrador = async () => {
    if (!docId) { onClose(); return }
    setSaving(true)
    try {
      const patch = {
        categoria_id: form.categoria_id ? parseInt(form.categoria_id) : null,
        proveedor: form.proveedor || null, proveedor_vat: form.proveedor_vat || null,
        num_factura: form.num_factura || null, fecha_documento: form.fecha_documento || null,
        periodo: form.periodo || null,
        importe_base: form.importe_base ? parseFloat(form.importe_base) : null,
        importe_iva: form.importe_iva ? parseFloat(form.importe_iva) : null,
        importe_total: form.importe_total ? parseFloat(form.importe_total) : null,
        iva_pct: form.iva_pct ? parseFloat(form.iva_pct) : null,
        concepto: form.concepto || null, notas: form.notas || null,
      }
      await fetch(`/api/contab/documentos/${docId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Round-Token': import.meta.env.VITE_CONFIG_API_TOKEN || '',
          'X-Round-Manager-Id': identity.managerId || '',
          ...(identity.trainerId ? { 'X-Round-Trainer-Id': identity.trainerId } : {}),
        },
        body: JSON.stringify(patch),
      })
      toast.success('Guardado como borrador')
      onUploaded()
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setSaving(false)
  }

  const conf = extraction?.confidence
  const confColor = conf == null ? 'var(--text-3)'
    : conf >= 0.85 ? 'var(--green)' : conf >= 0.6 ? 'var(--amber)' : 'var(--red)'

  return createPortal((
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 20,
    }} onClick={fase !== 'scanning' ? onClose : undefined}>
      <Card style={{ padding: 0, maxWidth: 720, width: '100%', maxHeight: '92vh',
                     overflowY: 'auto', display: 'flex', flexDirection: 'column' }}
            onClick={e => e.stopPropagation()}>
        <div style={{ padding: 20, borderBottom: '1px solid var(--line)',
                       display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: 0, fontFamily: 'Outfit', fontSize: 18, fontWeight: 700 }}>
              {fase === 'pick'     && 'Subir documento'}
              {fase === 'scanning' && 'Escaneando con IA…'}
              {fase === 'review'   && 'Revisar y validar'}
            </h2>
            <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
              {fase === 'pick'     && 'Selecciona el archivo. La IA lo escaneará y rellenará el formulario.'}
              {fase === 'scanning' && 'Subiendo + analizando proveedor, importes, IVA y categoría…'}
              {fase === 'review'   && (extraction?.extraction_failed
                ? 'IA no disponible — rellena los datos manualmente.'
                : `Confianza IA: ${Math.round((conf || 0) * 100)}% · Revisa los datos y pulsa Validar.`)}
            </p>
          </div>
          {fase !== 'scanning' && (
            <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-3)' }}>
              <X size={14} />
            </button>
          )}
        </div>

        {/* ── Fase 1: pick file ── */}
        {fase === 'pick' && (
          <>
            <div style={{ padding: 24 }}>
              <Lbl text="Archivo *">
                <input type="file" accept=".pdf,.jpg,.jpeg,.png,.csv,.xls,.xlsx,.xml,.txt"
                       onChange={e => setArchivo(e.target.files?.[0] || null)}
                       style={{ ...inp, padding: 8 }} />
                {archivo && (
                  <p style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 6 }}>
                    📎 {archivo.name} · {(archivo.size / 1024).toFixed(1)} KB
                  </p>
                )}
              </Lbl>
              <div style={{ marginTop: 16, padding: 12, borderRadius: 10,
                             background: 'var(--bg-1)', border: '1px solid var(--line)',
                             fontSize: 12, color: 'var(--text-2)' }}>
                💡 La IA detectará automáticamente: proveedor · CIF · número de factura ·
                fecha · base + IVA + total · categoría sugerida. Tras escanear podrás
                revisar y corregir antes de validar.
              </div>
            </div>
            <div style={{ padding: 14, borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Btn variant="secondary" onClick={onClose}>Cancelar</Btn>
              <Btn variant="primary" onClick={subirYEscanear} disabled={!archivo}>
                <Upload size={14} /> Subir y escanear
              </Btn>
            </div>
          </>
        )}

        {/* ── Fase 2: scanning ── */}
        {fase === 'scanning' && (
          <div style={{ padding: 60, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
            <Loader2 size={36} className="animate-spin" style={{ color: 'var(--green)' }} />
            <p style={{ fontSize: 14, color: 'var(--text-2)', textAlign: 'center', maxWidth: 380 }}>
              Subiendo {archivo?.name} y extrayendo datos con IA. Esto puede tardar 15-60 segundos
              dependiendo del documento.
            </p>
          </div>
        )}

        {/* ── Fase 3: review form ── */}
        {fase === 'review' && (
          <>
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {extraction && !extraction.extraction_failed && (
                <div style={{
                  padding: '8px 12px', borderRadius: 8, fontSize: 12,
                  background: `color-mix(in srgb, ${confColor} 12%, transparent)`,
                  border: `1px solid ${confColor}`,
                  color: confColor,
                  display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                }}>
                  <Send size={12} />
                  <span>
                    <strong>Datos extraídos por IA · {Math.round((conf || 0) * 100)}% confianza.</strong>
                    {' '}
                    {extraction.subtipo === 'ticket'
                      ? <>Detectado como <Badge color="blue">TICKET</Badge> sin receptor.</>
                      : extraction.subtipo === 'factura'
                        ? <>Detectado como <Badge color="purple">FACTURA</Badge>.</>
                        : 'Revisa y corrige si hace falta.'}
                  </span>
                  {extraction.notes && (
                    <span style={{ marginLeft: 'auto', fontStyle: 'italic', fontSize: 11 }}>
                      {extraction.notes.slice(0, 80)}{extraction.notes.length > 80 ? '…' : ''}
                    </span>
                  )}
                </div>
              )}

              {/* Banner ticket → gastos generales (informativo) */}
              {warning?.tipo === 'ticket_sin_receptor' && (
                <div style={{
                  padding: '10px 14px', borderRadius: 8, fontSize: 12,
                  background: 'var(--blue-bg)', border: '1px solid var(--blue-border)',
                  color: 'var(--blue)',
                }}>
                  ℹ️ <strong>Ticket sin receptor identificado.</strong> Se asignará a
                  <strong> gastos generales</strong> (sin trainer específico).
                </div>
              )}

              {/* Banner factura con CIF mismatch + checkbox doble auth */}
              {warning?.tipo === 'factura_cif_no_coincide' && (
                <div style={{
                  padding: 14, borderRadius: 10, fontSize: 13,
                  background: 'rgba(248,113,113,0.08)',
                  border: '1px solid rgba(248,113,113,0.3)',
                  color: 'var(--text-0)',
                }}>
                  <p style={{ fontWeight: 700, color: 'var(--red)', marginBottom: 6 }}>
                    ⚠️ Atención — CIF receptor no coincide
                  </p>
                  <p style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 10 }}>
                    La factura está emitida a:
                    <br />• <strong>{warning.recipiente_nombre || 'sin nombre'}</strong>
                    {' '}<span style={{ fontFamily: 'monospace', color: 'var(--text-3)' }}>(CIF {warning.recipiente_vat || '—'})</span>
                  </p>
                  <p style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 10 }}>
                    Ningún centro del manager tiene ese CIF. Centros configurados:
                  </p>
                  <ul style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 16, marginBottom: 12 }}>
                    {(warning.centros_disponibles || []).map(c => (
                      <li key={c.id_trainer}>
                        {c.nombre_centro} · CIF {c.cif || <em>(no configurado)</em>}
                      </li>
                    ))}
                  </ul>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 10,
                                   background: 'var(--bg-1)', borderRadius: 8, cursor: 'pointer',
                                   border: dobleAuth ? '1px solid var(--green)' : '1px solid var(--line)' }}>
                    <input type="checkbox" checked={dobleAuth}
                           onChange={e => setDobleAuth(e.target.checked)} />
                    <span style={{ fontSize: 12 }}>
                      <strong>Confirmo bajo mi responsabilidad</strong> que este documento debe
                      registrarse aunque el CIF receptor no coincida con ningún centro.
                    </span>
                  </label>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Lbl text="Categoría">
                  <select value={form.categoria_id} onChange={e => setForm(f => ({ ...f, categoria_id: e.target.value }))} style={inp}>
                    <option value="">— sin categoría —</option>
                    {cats.filter(c => c.activa).map(c => (
                      <option key={c.id} value={c.id}>{c.nombre}</option>
                    ))}
                  </select>
                </Lbl>
                <Lbl text="Período">
                  <input value={form.periodo} onChange={e => setForm(f => ({ ...f, periodo: e.target.value }))}
                         placeholder="2026-05 ó 2026-T2" style={inp} />
                </Lbl>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10 }}>
                <Lbl text="Proveedor">
                  <input value={form.proveedor} onChange={e => setForm(f => ({ ...f, proveedor: e.target.value }))} style={inp} />
                </Lbl>
                <Lbl text="CIF/NIF">
                  <input value={form.proveedor_vat} onChange={e => setForm(f => ({ ...f, proveedor_vat: e.target.value }))} style={inp} />
                </Lbl>
                <Lbl text="Núm. factura">
                  <input value={form.num_factura} onChange={e => setForm(f => ({ ...f, num_factura: e.target.value }))} style={inp} />
                </Lbl>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10 }}>
                <Lbl text="Fecha">
                  <input type="date" value={form.fecha_documento}
                         onChange={e => setForm(f => ({ ...f, fecha_documento: e.target.value }))} style={inp} />
                </Lbl>
                <Lbl text="Base €">
                  <input type="number" step="0.01" value={form.importe_base}
                         onChange={e => setForm(f => ({ ...f, importe_base: e.target.value }))} style={inp} />
                </Lbl>
                <Lbl text="IVA %">
                  <input type="number" step="0.01" value={form.iva_pct}
                         onChange={e => setForm(f => ({ ...f, iva_pct: e.target.value }))} style={inp} />
                </Lbl>
                <Lbl text="Total €">
                  <input type="number" step="0.01" value={form.importe_total}
                         onChange={e => setForm(f => ({ ...f, importe_total: e.target.value }))} style={inp} />
                </Lbl>
              </div>

              <Lbl text="Concepto">
                <textarea rows={2} value={form.concepto}
                          onChange={e => setForm(f => ({ ...f, concepto: e.target.value }))}
                          style={{ ...inp, fontFamily: 'inherit' }} />
              </Lbl>

              {docId && (
                <a href={contabDocFileUrl(docId, identity)} target="_blank" rel="noreferrer"
                   style={{ fontSize: 12, color: 'var(--blue)', display: 'inline-flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}>
                  <Eye size={12} /> Ver archivo subido
                </a>
              )}
            </div>

            <div style={{ padding: 14, borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <Btn variant="secondary" onClick={guardarBorrador} disabled={saving}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                Guardar como borrador
              </Btn>
              <Btn variant="primary" onClick={guardarYValidar}
                   disabled={saving || (warning?.tipo === 'factura_cif_no_coincide' && !dobleAuth)}
                   title={warning?.tipo === 'factura_cif_no_coincide' && !dobleAuth
                          ? 'Marca la casilla de doble autorización para continuar' : undefined}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                Validar
              </Btn>
            </div>
          </>
        )}
      </Card>
    </div>
  ), document.body)
}


function StatBox({ label, value, color }) {
  return (
    <Card style={{ padding: 14 }}>
      <p style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</p>
      <p style={{ fontFamily: 'Outfit', fontSize: 22, fontWeight: 700, color, marginTop: 4 }}>{value}</p>
    </Card>
  )
}
function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
      <Loader2 size={20} className="animate-spin" style={{ color: 'var(--green)' }} />
    </div>
  )
}
function Lbl({ text, children }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 4 }}>
        {text}
      </span>
      {children}
    </label>
  )
}
const inp = {
  width: '100%', padding: '8px 10px', borderRadius: 8, fontSize: 13,
  background: 'var(--bg-1)', border: '1px solid var(--line)', color: 'var(--text-0)',
}
const iconBtn = {
  background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 6,
  padding: '5px 8px', cursor: 'pointer', color: 'var(--text-2)',
  display: 'inline-flex', alignItems: 'center', textDecoration: 'none',
}
