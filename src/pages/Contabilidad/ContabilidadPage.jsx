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
  contabFaltanteIgnorar, contabFaltanteRestaurar, contabResultadosDisponibles,
  contabDocAsiento, contabDocABorrador,
} from '../../utils/configApi'
import AsientoModal from './AsientoModal'

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
    // Rango por defecto: desde 1-enero del año anterior. Cubre 12 a 24 meses
    // según el mes en que estemos. Así no se "pierden" docs cuando el LLM
    // extrae mal el año (problema típico con nóminas).
    const desde = new Date(hoy.getFullYear() - 1, 0, 1)
    return { desde: fmt(desde), hasta: fmt(hoy), estado: '', categoria_id: '', q: '' }
  })
  const [showUpload, setShowUpload] = useState(false)
  const [listadosVis, setListadosVis] = useState({})
  const [asientoDoc, setAsientoDoc] = useState(null)  // doc cuyo asiento se muestra
  const [verRechazados, setVerRechazados] = useState(false)  // toggle "ver rechazados"
  const [tab, setTab] = useState('docs')   // docs | totales | faltantes | resultados
  // Filtro grid de períodos para Documentos (alternativo a desde/hasta)
  const [docsModo, setDocsModo] = useState('mes')
  const [docsPeriodos, setDocsPeriodos] = useState([])
  const [docsDisp, setDocsDisp] = useState({ meses: [], trimestres: [] })
  const [docsShowGrid, setDocsShowGrid] = useState(false)
  useEffect(() => {
    contabResultadosDisponibles(identity)
      .then(d => setDocsDisp({ meses: d.meses || [], trimestres: d.trimestres || [] }))
      .catch(() => {})
  // eslint-disable-next-line
  }, [identity?.managerId])

  // Si hay períodos seleccionados, computamos rango envolvente para el query
  const filtrosEfectivos = useMemo(() => {
    if (docsPeriodos.length === 0) return filtros
    const rangos = docsPeriodos.map(periodoARango).filter(Boolean)
    if (rangos.length === 0) return filtros
    const desde = rangos.map(r => r.desde).sort()[0]
    const hasta = rangos.map(r => r.hasta).sort().slice(-1)[0]
    return { ...filtros, desde, hasta }
  }, [filtros, docsPeriodos])

  async function reload() {
    setLoading(true)
    try {
      const [c, d] = await Promise.all([
        contabCatsList(identity).catch(() => ({ categorias: [] })),
        contabDocsList(identity, filtrosEfectivos).catch(() => []),
      ])
      setCats(c.categorias || [])
      // Si hay periodos múltiples, filtrar local los docs cuya fecha esté
      // dentro de algún rango específico (evita docs de meses intermedios).
      // OJO: el backend devuelve fechas como string RFC ("Fri, 15 May 2026...")
      // o ISO según endpoint — normalizamos a YYYY-MM-DD antes de comparar.
      let docs = d || []
      const toIsoDate = (v) => {
        if (!v) return ''
        const s = String(v)
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
        try {
          const dt = new Date(s)
          if (isNaN(dt)) return ''
          const y = dt.getFullYear(), m = String(dt.getMonth()+1).padStart(2,'0'), d2 = String(dt.getDate()).padStart(2,'0')
          return `${y}-${m}-${d2}`
        } catch { return '' }
      }
      if (docsPeriodos.length > 1) {
        const rangos = docsPeriodos.map(periodoARango).filter(Boolean)
        docs = docs.filter(doc => {
          const f = toIsoDate(doc.fecha_documento)
          if (!f) return false
          return rangos.some(r => f >= r.desde && f <= r.hasta)
        })
      }
      setDocs(docs)
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setLoading(false)
  }
  useEffect(() => { reload() /* eslint-disable-next-line */ }, [
    identity.managerId, filtrosEfectivos.desde, filtrosEfectivos.hasta,
    filtros.estado, filtros.categoria_id, filtros.q, docsPeriodos,
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

      {/* Botón toggle filtro grid de períodos */}
      <div style={{ marginBottom: 14 }}>
        <button onClick={() => setDocsShowGrid(s => !s)}
                style={{
                  background: 'none', border: '1px solid var(--line)', borderRadius: 8,
                  padding: '6px 12px', cursor: 'pointer', color: 'var(--text-2)',
                  fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6,
                }}>
          {docsShowGrid ? '▾' : '▸'} Filtrar por períodos (mes/trimestre)
          {docsPeriodos.length > 0 && (
            <Badge color="green">{docsPeriodos.length}</Badge>
          )}
        </button>
      </div>
      {docsShowGrid && (
        <Card style={{ padding: 14, marginBottom: 14 }}>
          <PeriodoGridMultiSelect
            seleccionados={docsPeriodos}
            setSeleccionados={setDocsPeriodos}
            modo={docsModo}
            setModo={setDocsModo}
            disponibles={docsDisp} />
        </Card>
      )}

      {showUpload && (
        <UploadModal cats={cats} identity={identity}
                     onClose={() => setShowUpload(false)}
                     onUploaded={() => { setShowUpload(false); reload() }} />
      )}

      {/* Toggle ver rechazados */}
      {!loading && stats.rechazado > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 4,
                      padding: '8px 12px', borderRadius: 8, background: 'var(--bg-3)',
                      border: '1px solid var(--line)', fontSize: 12, color: 'var(--text-2)' }}>
          <span>
            Hay <strong style={{ color: 'var(--red)' }}>{stats.rechazado}</strong> documento{stats.rechazado !== 1 ? 's' : ''} rechazado{stats.rechazado !== 1 ? 's' : ''} ocultos.
          </span>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginLeft: 'auto' }}>
            <input type="checkbox" checked={verRechazados}
                   onChange={e => setVerRechazados(e.target.checked)} />
            Ver rechazados
          </label>
        </div>
      )}

      {(() => {
        // Filtrar localmente los rechazados a menos que el toggle esté activo
        // o el usuario haya elegido específicamente el filtro 'rechazado'.
        const docsVisibles = (verRechazados || filtros.estado === 'rechazado')
          ? docs
          : docs.filter(d => d.estado !== 'rechazado')
        if (loading) return <Spinner />
        if (docsVisibles.length === 0) return (
          <EmptyState title="Sin documentos"
                      description={docs.length > 0
                        ? 'Todos los documentos del rango están rechazados. Activa "Ver rechazados" para mostrarlos.'
                        : 'Sube tu primera factura, nómina o extracto.'} />
        )
        return (
        <DocsTable docs={docsVisibles} identity={identity}
                   onAction={async (action, doc, extra) => {
                     try {
                       if (action === 'validar') { await contabDocValidar(identity, doc.id); toast.success('Validado') }
                       else if (action === 'rechazar') { await contabDocRechazar(identity, doc.id, extra?.motivo); toast.success('Rechazado') }
                       else if (action === 'borrar') { await contabDocDelete(identity, doc.id); toast.success('Borrado') }
                       else if (action === 'ver_asiento') { setAsientoDoc(doc); return }
                       else if (action === 'a_borrador') {
                         const r = await contabDocABorrador(identity, doc.id, extra?.motivo)
                         if (r?.warning) toast.error('Pasado a borrador con aviso: ' + r.warning)
                         else if (r?.odoo_action === 'draft') toast.success('Pasado a borrador. Asiento Odoo → draft.')
                         else if (r?.odoo_action === 'cancelled') toast.success('Pasado a borrador. Asiento Odoo cancelado.')
                         else toast.success('Pasado a borrador')
                       }
                       reload()
                     } catch (e) { toast.error(`Error: ${e.message}`) }
                   }} />
        )
      })()}
      </>)}

      {/* Modal asiento contable */}
      {asientoDoc && (
        <AsientoModal doc={asientoDoc} identity={identity}
                      onClose={() => setAsientoDoc(null)} />
      )}

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
  const [filtros, setFiltros] = useState({ estado: 'sin_cuadrar', q: '', banco: '' })

  async function reload() {
    setLoading(true)
    try {
      const list = await contabBancoMovs(identity, filtros)
      setMovs(list)
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setLoading(false)
  }
  useEffect(() => { reload() /* eslint-disable-next-line */ }, [identity?.managerId, filtros.estado, filtros.q, filtros.banco])

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

  // Bancos distintos en los movimientos cargados (para popular el filtro)
  const bancosDisp = useMemo(() => {
    const set = new Set()
    for (const m of movs) if (m.banco) set.add(m.banco)
    return [...set].sort()
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
          <Lbl text="Banco">
            <select value={filtros.banco} onChange={e => setFiltros(f => ({ ...f, banco: e.target.value }))} style={inp}>
              <option value="">Todos los bancos</option>
              {bancosDisp.map(b => <option key={b} value={b}>{b}</option>)}
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
          <div style={{ display: 'grid', gridTemplateColumns: '0.6fr 0.9fr 1.8fr 0.9fr 0.9fr 1fr 1.2fr 100px',
                         padding: '10px 16px', background: 'var(--bg-3)', fontSize: 11,
                         color: 'var(--text-3)', textTransform: 'uppercase' }}>
            <span>Fecha</span><span>Banco</span><span>Concepto</span><span>Importe</span><span>Saldo</span>
            <span>Estado</span><span>Factura</span><span></span>
          </div>
          {movs.map((m, i) => (
            <div key={m.id} style={{
              display: 'grid', gridTemplateColumns: '0.6fr 0.9fr 1.8fr 0.9fr 0.9fr 1fr 1.2fr 100px',
              padding: '10px 16px', alignItems: 'center', fontSize: 12,
              borderTop: i > 0 ? '1px solid var(--line)' : 'none',
            }}>
              <span style={{ fontFamily: 'monospace' }}>{fmtDate(m.fecha)}</span>
              <span style={{ fontSize: 11, color: 'var(--text-2)' }}>
                {m.banco || '—'}
              </span>
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
  // Estado para expandir filas y ver los documentos del grupo
  const [expanded, setExpanded] = useState(null)        // string id del grupo expandido
  const [docsCache, setDocsCache] = useState({})        // { grupo: [docs] | 'loading' | 'error' }

  useEffect(() => {
    setLoading(true)
    setExpanded(null); setDocsCache({})    // reset al cambiar filtros
    contabTotales(identity, { ...filtros, group_by: groupBy, estado })
      .then(d => setData(d || { filas: [] }))
      .catch(e => toast.error(`Error: ${e.message}`))
      .finally(() => setLoading(false))
  // eslint-disable-next-line
  }, [identity?.managerId, groupBy, estado, filtros.desde, filtros.hasta])

  // Carga perezosa de los documentos al expandir una fila.
  const cargarDocsDelGrupo = async (fila) => {
    const key = fila.grupo
    if (docsCache[key] && docsCache[key] !== 'error') return
    setDocsCache(prev => ({ ...prev, [key]: 'loading' }))
    try {
      const filtrosDocs = { estado: estado || undefined }
      if (groupBy === 'mes') {
        // grupo='YYYY-MM' → rango del mes (recortado por filtros globales)
        const [yy, mm] = key.split('-')
        const desdeMes = `${yy}-${mm}-01`
        const lastDay = new Date(parseInt(yy), parseInt(mm), 0).getDate()
        const hastaMes = `${yy}-${mm}-${String(lastDay).padStart(2,'0')}`
        filtrosDocs.desde = filtros.desde > desdeMes ? filtros.desde : desdeMes
        filtrosDocs.hasta = filtros.hasta < hastaMes ? filtros.hasta : hastaMes
      } else {
        // Para categoria/proveedor/trainer/tipo: filtros globales + filtro de grupo si se puede
        filtrosDocs.desde = filtros.desde
        filtrosDocs.hasta = filtros.hasta
        if (groupBy === 'tipo')      filtrosDocs.doc_type   = fila.grupo_id || fila.grupo
        if (groupBy === 'proveedor') filtrosDocs.proveedor  = fila.grupo
        if (groupBy === 'trainer')   filtrosDocs.id_trainer = fila.grupo_id || ''
        if (groupBy === 'categoria') filtrosDocs.categoria_id = fila.grupo_id || ''
      }
      const docs = await contabDocsList(identity, filtrosDocs)
      setDocsCache(prev => ({ ...prev, [key]: docs }))
    } catch (e) {
      toast.error(`Error cargando docs: ${e.message}`)
      setDocsCache(prev => ({ ...prev, [key]: 'error' }))
    }
  }

  const toggleExpand = (fila) => {
    if (expanded === fila.grupo) {
      setExpanded(null)
    } else {
      setExpanded(fila.grupo)
      cargarDocsDelGrupo(fila)
    }
  }

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
          <div style={{ display: 'grid', gridTemplateColumns: '24px 2fr 1fr 1fr 1fr 1fr',
                         padding: '10px 16px', background: 'var(--bg-3)',
                         fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', gap: 8 }}>
            <span></span>
            <span>{groupBy}</span><span>Base</span><span>IVA</span><span>Total</span><span>Docs</span>
          </div>
          {data.filas.map((r, i) => {
            const isOpen = expanded === r.grupo
            return (
            <div key={i} style={{ borderTop: i > 0 ? '1px solid var(--line)' : 'none' }}>
              <div
                role="button"
                tabIndex={0}
                aria-expanded={isOpen}
                onClick={() => toggleExpand(r)}
                onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), toggleExpand(r))}
                style={{
                  display: 'grid', gridTemplateColumns: '24px 2fr 1fr 1fr 1fr 1fr',
                  padding: '10px 16px', alignItems: 'center', fontSize: 13, gap: 8,
                  cursor: 'pointer',
                  background: isOpen ? 'var(--bg-2)' : 'transparent',
                  transition: 'background 0.1s',
                }}>
                <span style={{ color: 'var(--text-3)', display: 'flex', alignItems: 'center',
                               transition: 'transform 0.15s',
                               transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
                      aria-hidden="true">▶</span>
                <span style={{ fontWeight: 500 }}>{r.grupo}</span>
                <span style={{ fontFamily: 'monospace' }}>{parseFloat(r.importe_base).toFixed(2)} €</span>
                <span style={{ fontFamily: 'monospace' }}>{parseFloat(r.importe_iva).toFixed(2)} €</span>
                <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{parseFloat(r.importe_total).toFixed(2)} €</span>
                <span>{r.n_docs}</span>
              </div>
              {isOpen && (
                <div style={{ padding: '6px 16px 12px 48px', background: 'var(--bg-2)' }}>
                  {docsCache[r.grupo] === 'loading' ? (
                    <p style={{ fontSize: 12, color: 'var(--text-3)' }}>Cargando documentos…</p>
                  ) : docsCache[r.grupo] === 'error' ? (
                    <p style={{ fontSize: 12, color: 'var(--red)' }}>Error al cargar documentos</p>
                  ) : !Array.isArray(docsCache[r.grupo]) || docsCache[r.grupo].length === 0 ? (
                    <p style={{ fontSize: 12, color: 'var(--text-3)' }}>Sin documentos en este grupo</p>
                  ) : (
                    <div>
                      <div style={{
                        display: 'grid', gridTemplateColumns: '110px 1fr 1.4fr 100px 100px 110px 100px',
                        padding: '8px 10px', fontSize: 10.5, color: 'var(--text-3)',
                        textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600,
                        borderBottom: '1px solid var(--line)', gap: 8,
                      }}>
                        <span>Fecha</span>
                        <span>Tipo / Nº</span>
                        <span>Proveedor / Concepto</span>
                        <span style={{ textAlign: 'right' }}>Base</span>
                        <span style={{ textAlign: 'right' }}>IVA</span>
                        <span style={{ textAlign: 'right' }}>Total</span>
                        <span style={{ textAlign: 'right' }}>Estado</span>
                      </div>
                      {docsCache[r.grupo].map((d, di) => (
                        <div key={d.id || di} style={{
                          display: 'grid', gridTemplateColumns: '110px 1fr 1.4fr 100px 100px 110px 100px',
                          padding: '8px 10px', alignItems: 'center', fontSize: 12, gap: 8,
                          borderBottom: di < docsCache[r.grupo].length - 1 ? '1px solid var(--line)' : 'none',
                        }}>
                          <span style={{ color: 'var(--text-2)', fontFamily: 'monospace' }}>
                            {d.fecha || d.fecha_doc || '—'}
                          </span>
                          <span style={{ color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {d.doc_type || d.tipo || '—'}{d.numero ? ` · ${d.numero}` : ''}
                          </span>
                          <span style={{ color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {d.proveedor || d.concepto || d.descripcion || '—'}
                          </span>
                          <span style={{ fontFamily: 'monospace', textAlign: 'right', color: 'var(--text-2)' }}>
                            {parseFloat(d.importe_base || 0).toFixed(2)} €
                          </span>
                          <span style={{ fontFamily: 'monospace', textAlign: 'right', color: 'var(--text-2)' }}>
                            {parseFloat(d.importe_iva || 0).toFixed(2)} €
                          </span>
                          <span style={{ fontFamily: 'monospace', textAlign: 'right', fontWeight: 600, color: 'var(--text-0)' }}>
                            {parseFloat(d.importe_total || 0).toFixed(2)} €
                          </span>
                          <span style={{ textAlign: 'right', fontSize: 10.5,
                                         color: d.estado === 'validado' ? 'var(--green)'
                                                : d.estado === 'borrador' ? 'var(--amber)'
                                                : 'var(--text-3)' }}>
                            {d.estado || '—'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            )
          })}
          <div style={{
            display: 'grid', gridTemplateColumns: '24px 2fr 1fr 1fr 1fr 1fr',
            padding: '12px 16px', borderTop: '2px solid var(--line)',
            background: 'var(--bg-3)', fontSize: 13, fontWeight: 700, gap: 8,
          }}>
            <span></span>
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
  const [tipoDet, setTipoDet] = useState('detectado')   // detectado|estimado|all
  const [incluirIgnorados, setIncluirIgnorados] = useState(false)
  const [data, setData] = useState({ faltantes: [], stats: {} })
  const [loading, setLoading] = useState(true)

  const reload = () => {
    setLoading(true)
    contabFaltantes(identity, { meses, tipo_deteccion: tipoDet, incluir_ignorados: incluirIgnorados })
      .then(d => setData(d || { faltantes: [], stats: {} }))
      .catch(e => toast.error(`Error: ${e.message}`))
      .finally(() => setLoading(false))
  }
  useEffect(reload, /* eslint-disable-next-line */ [identity?.managerId, meses, tipoDet, incluirIgnorados])

  const archivar = async (f) => {
    const motivo = prompt(`Archivar faltante "${f.nombre} · ${f.periodo_faltante}"?\nMotivo (opcional):`)
    if (motivo === null) return
    try { await contabFaltanteIgnorar(identity, f.categoria_id, f.periodo_faltante, motivo); toast.success('Archivado'); reload() }
    catch (e) { toast.error(`Error: ${e.message}`) }
  }
  const restaurar = async (f) => {
    try { await contabFaltanteRestaurar(identity, f.categoria_id, f.periodo_faltante); toast.success('Restaurado'); reload() }
    catch (e) { toast.error(`Error: ${e.message}`) }
  }

  const items = data.faltantes || []
  const stats = data.stats || {}

  return (
    <div>
      <Card style={{ padding: 14, marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Lbl text="Ventana (meses atrás)">
            <input type="number" min={1} max={24} value={meses}
                   onChange={e => setMeses(parseInt(e.target.value) || 6)}
                   style={{ ...inp, width: 90 }} />
          </Lbl>
          <Lbl text="Tipo">
            <select value={tipoDet} onChange={e => setTipoDet(e.target.value)} style={inp}>
              <option value="detectado">Detectados (con historial)</option>
              <option value="estimado">Estimados (sin historial)</option>
              <option value="all">Todos</option>
            </select>
          </Lbl>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-2)', cursor: 'pointer', marginBottom: 5 }}>
            <input type="checkbox" checked={incluirIgnorados}
                   onChange={e => setIncluirIgnorados(e.target.checked)} />
            Incluir archivados
          </label>
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 5 }}>
            <strong style={{ color: 'var(--green)' }}>{stats.detectados || 0}</strong> detectados ·
            {' '}<strong style={{ color: 'var(--amber)' }}>{stats.estimados || 0}</strong> estimados
            {incluirIgnorados && <> · <strong style={{ color: 'var(--text-3)' }}>{stats.ignorados || 0}</strong> archivados</>}
          </div>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 10 }}>
          <strong>Detectado</strong>: la categoría ya tiene historial — el faltante es real.
          <strong style={{ marginLeft: 12 }}>Estimado</strong>: la categoría nunca tuvo doc — quizá no aplique a tu negocio.
        </p>
      </Card>
      {loading ? <Spinner /> : items.length === 0 ? (
        <Card style={{ padding: 30, textAlign: 'center' }}>
          <CheckCircle2 size={28} style={{ color: 'var(--green)', margin: '0 auto 8px' }} />
          <p style={{ fontSize: 14, color: 'var(--text-1)' }}>¡Al día!</p>
          <p style={{ fontSize: 12, color: 'var(--text-3)' }}>
            No hay faltantes con los filtros seleccionados.
          </p>
        </Card>
      ) : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 0.8fr 0.8fr 0.8fr 100px',
                         padding: '10px 16px', background: 'var(--bg-3)',
                         fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase' }}>
            <span>Periodo</span><span>Categoría</span><span>Tipo</span><span>Periodicidad</span><span>Detección</span><span></span>
          </div>
          {items.map((f, i) => (
            <div key={`${f.categoria_id}-${f.periodo_faltante}`} style={{
              display: 'grid', gridTemplateColumns: '1fr 2fr 0.8fr 0.8fr 0.8fr 100px',
              padding: '10px 16px', alignItems: 'center', fontSize: 13,
              borderTop: i > 0 ? '1px solid var(--line)' : 'none',
              opacity: f.ignorado ? 0.55 : 1,
            }}>
              <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{f.periodo_faltante}</span>
              <span>
                <Badge color={f.color || 'gray'}>{f.nombre}</Badge>
                {f.ignorado && (
                  <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--text-3)' }}
                        title={f.ignored_motivo || ''}>· archivado</span>
                )}
              </span>
              <span style={{ color: 'var(--text-3)', fontSize: 11 }}>{f.tipo}</span>
              <span style={{ color: 'var(--text-3)', fontSize: 11 }}>{f.periodicidad}</span>
              <Badge color={f.tipo_deteccion === 'detectado' ? 'green' : 'amber'}>
                {f.tipo_deteccion === 'detectado' ? 'Detectado' : 'Estimado'}
              </Badge>
              <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                {f.ignorado ? (
                  <button onClick={() => restaurar(f)} title="Restaurar" style={iconBtn}>↩</button>
                ) : (
                  <button onClick={() => archivar(f)} title="Archivar — no me interesa estudiar este"
                          style={{ ...iconBtn, color: 'var(--amber)' }}>
                    <Trash2 size={12} />
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


// ── Componente reutilizable: grid multi-select de meses/trimestres últimos 5 años ──
function PeriodoGridMultiSelect({ seleccionados, setSeleccionados, modo, setModo, disponibles }) {
  const ANIOS = useMemo(() => {
    const y = new Date().getFullYear()
    return [y, y-1, y-2, y-3, y-4]
  }, [])
  const dispSet = useMemo(
    () => new Set(modo === 'mes' ? (disponibles?.meses || []) : (disponibles?.trimestres || [])),
    [modo, disponibles]
  )
  const toggle = (p) => setSeleccionados(arr => arr.includes(p) ? arr.filter(x => x !== p) : [...arr, p])

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Vista:</span>
        <div role="group" style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--line)' }}>
          {['mes', 'trimestre'].map(m => (
            <button key={m} onClick={() => { setModo(m); setSeleccionados([]) }}
                    style={{
                      padding: '6px 14px', fontSize: 12, fontWeight: 500, cursor: 'pointer', border: 'none',
                      background: modo === m ? 'var(--green-bg)' : 'var(--bg-2)',
                      color: modo === m ? 'var(--green)' : 'var(--text-2)',
                    }}>
              {m === 'mes' ? 'Meses' : 'Trimestres'}
            </button>
          ))}
        </div>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-3)' }}>
          {seleccionados.length} {modo === 'mes' ? 'mes' + (seleccionados.length === 1 ? '' : 'es') : 'trimestre' + (seleccionados.length === 1 ? '' : 's')} seleccionados
          {seleccionados.length > 0 && (
            <button onClick={() => setSeleccionados([])}
                    style={{ marginLeft: 8, background: 'none', border: 'none', cursor: 'pointer',
                             color: 'var(--text-3)', fontSize: 11, textDecoration: 'underline' }}>
              limpiar
            </button>
          )}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {ANIOS.map(y => {
          const items = modo === 'mes'
            ? Array.from({ length: 12 }, (_, i) => ({
                id: `${y}-${String(i+1).padStart(2,'0')}`,
                label: ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'][i],
              }))
            : Array.from({ length: 4 }, (_, i) => ({ id: `${y}-T${i+1}`, label: `T${i+1}` }))
          return (
            <div key={y} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 50, fontSize: 12, fontWeight: 600, color: 'var(--text-1)', fontFamily: 'monospace' }}>{y}</span>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${items.length}, 1fr)`, gap: 4, flex: 1 }}>
                {items.map(it => {
                  const sel = seleccionados.includes(it.id)
                  const disp = dispSet.has(it.id)
                  const futuro = (modo === 'mes' ? it.id > new Date().toISOString().slice(0,7) : false)
                  return (
                    <button key={it.id} onClick={() => toggle(it.id)}
                            disabled={futuro}
                            title={futuro ? 'Futuro' : disp ? 'Con datos' : 'Sin datos'}
                            style={{
                              padding: '6px 4px', fontSize: 11, cursor: futuro ? 'not-allowed' : 'pointer',
                              border: sel ? '1px solid var(--green)' : '1px solid var(--line)',
                              background: sel ? 'var(--green-bg)' : disp ? 'var(--bg-2)' : 'transparent',
                              color: sel ? 'var(--green)' : disp ? 'var(--text-1)' : 'var(--text-3)',
                              fontWeight: sel ? 700 : disp ? 500 : 400,
                              opacity: futuro ? 0.3 : 1,
                              borderRadius: 6, position: 'relative',
                            }}>
                      {it.label}
                      {disp && !sel && (
                        <span style={{ position: 'absolute', top: 2, right: 3, width: 4, height: 4,
                                        borderRadius: '50%', background: 'var(--green)' }} />
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
      <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8 }}>
        • Verde = seleccionado · Punto verde = períodos con datos · Click para añadir/quitar
      </p>
    </div>
  )
}


// Convierte 'YYYY-MM' o 'YYYY-Tn' a {desde, hasta} ISO
function periodoARango(p) {
  if (/^\d{4}-T[1-4]$/.test(p)) {
    const [y, t] = p.split('-T')
    const yy = parseInt(y), tt = parseInt(t)
    const m_ini = (tt - 1) * 3 + 1
    const m_fin = tt * 3
    const lastDay = [31,28,31,30,31,30,31,31,30,31,30,31][m_fin-1]
    return { desde: `${yy}-${String(m_ini).padStart(2,'0')}-01`,
             hasta: `${yy}-${String(m_fin).padStart(2,'0')}-${lastDay}` }
  }
  if (/^\d{4}-\d{2}$/.test(p)) {
    const [y, m] = p.split('-')
    const yy = parseInt(y), mm = parseInt(m)
    const lastDay = mm === 2
      ? (yy % 4 === 0 ? 29 : 28)
      : [31,28,31,30,31,30,31,31,30,31,30,31][mm-1]
    return { desde: `${y}-${m}-01`, hasta: `${y}-${m}-${lastDay}` }
  }
  return null
}


function ResultadosPanel({ identity }) {
  const toast = useToast()
  const [modo, setModo] = useState('mes')
  const [seleccionados, setSeleccionados] = useState([])
  const [disponibles, setDisponibles] = useState({ meses: [], trimestres: [] })
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  // Modo de cálculo de ingresos: 'reales' (recibos cobrados, default) o
  // 'facturados' (facturas Odoo posteadas — incluye no cobradas).
  const [modoIngresos, setModoIngresos] = useState('reales')
  // Incluir movimientos bancarios sin cuadrar como ingresos
  const [incluirNoContab, setIncluirNoContab] = useState(false)

  useEffect(() => {
    contabResultadosDisponibles(identity)
      .then(d => setDisponibles({ meses: d.meses || [], trimestres: d.trimestres || [] }))
      .catch(() => {})
  // eslint-disable-next-line
  }, [identity?.managerId])

  useEffect(() => {
    if (seleccionados.length > 0) return
    const hoy = new Date()
    const y = hoy.getFullYear()
    const m = String(hoy.getMonth() + 1).padStart(2, '0')
    const t = Math.floor(hoy.getMonth() / 3) + 1
    setSeleccionados(modo === 'mes' ? [`${y}-${m}`] : [`${y}-T${t}`])
  // eslint-disable-next-line
  }, [modo])

  useEffect(() => {
    if (seleccionados.length === 0) { setData(null); return }
    setLoading(true)
    contabResultados(identity, {
      periodos: seleccionados,
      ingresos: modoIngresos,
      incluir_no_contabilizados: incluirNoContab,
    })
      .then(setData)
      .catch(e => toast.error(`Error: ${e.message}`))
      .finally(() => setLoading(false))
  // eslint-disable-next-line
  }, [identity?.managerId, seleccionados, modoIngresos, incluirNoContab])

  return (
    <div>
      <Card style={{ padding: 14, marginBottom: 14 }}>
        <PeriodoGridMultiSelect
          seleccionados={seleccionados}
          setSeleccionados={setSeleccionados}
          modo={modo}
          setModo={setModo}
          disponibles={disponibles} />
      </Card>

      {/* Selector ingresos reales vs facturados */}
      <Card style={{ padding: 12, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 600,
                          textTransform: 'uppercase', letterSpacing: 0.4 }}>
            Ingresos
          </span>
          <div style={{ display: 'flex', borderRadius: 10, overflow: 'hidden',
                         border: '1.5px solid var(--line)', background: 'var(--bg-2)' }}>
            {[
              { id: 'reales',     label: 'Reales (cobrados)' },
              { id: 'facturados', label: 'Facturados' },
            ].map(({ id, label }) => (
              <button key={id}
                      onClick={() => setModoIngresos(id)}
                      aria-pressed={modoIngresos === id}
                      style={{
                        padding: '8px 14px', fontSize: 12.5, fontWeight: 700,
                        background: modoIngresos === id ? 'var(--green)' : 'transparent',
                        color: modoIngresos === id ? '#fff' : 'var(--text-1)',
                        border: 'none', cursor: 'pointer',
                      }}>
                {label}
              </button>
            ))}
          </div>
          <span style={{ fontSize: 11.5, color: 'var(--text-3)', flex: 1, minWidth: 200 }}>
            {modoIngresos === 'reales'
              ? 'Suma de recibos cobrados en el período (estado=pagado, por fecha de pago).'
              : 'Suma de facturas emitidas en Odoo en el período, cobradas o no.'}
          </span>
        </div>
        {/* Toggle: incluir ingresos no contabilizados */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10,
                       paddingTop: 10, borderTop: '1px dashed var(--line)' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8,
                           cursor: 'pointer', fontSize: 12.5, color: 'var(--text-1)' }}>
            <input type="checkbox" checked={incluirNoContab}
                   onChange={e => setIncluirNoContab(e.target.checked)} />
            <strong>Añadir ingresos no contabilizados</strong>
          </label>
          <span style={{ fontSize: 11.5, color: 'var(--text-3)', flex: 1, minWidth: 200 }}>
            Movimientos bancarios entrantes en el período aún sin vincular a recibo o factura
            (estado <code style={{ fontSize: 11 }}>sin_cuadrar</code> y <code style={{ fontSize: 11 }}>importe &gt; 0</code> en banco_movimiento).
          </span>
          {data?.total?.no_contabilizado > 0 && incluirNoContab && (
            <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--amber)',
                           padding: '3px 8px', borderRadius: 6,
                           background: 'rgba(251,191,36,0.12)',
                           border: '1px solid rgba(251,191,36,0.3)' }}>
              + {data.total.no_contabilizado.toFixed(2)} €
            </span>
          )}
        </div>
      </Card>

      {loading ? <Spinner /> : !data ? <EmptyState title="Selecciona al menos un período" /> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 14 }}>
            <StatBox label={
                       (modoIngresos === 'reales' ? 'Ingresos (cobrados)' : 'Ingresos (facturados)')
                       + (incluirNoContab && data.total.no_contabilizado > 0 ? ' + banco s/cuadrar' : '')
                     }
                     value={`${data.total.ingresos.toFixed(2)} €`} color="var(--green)" />
            <StatBox label="Gastos" value={`${data.total.gastos.toFixed(2)} €`} color="var(--red)" />
            <StatBox label="Beneficio" value={`${data.total.beneficio.toFixed(2)} €`}
                     color={data.total.beneficio >= 0 ? 'var(--green)' : 'var(--red)'} />
          </div>
          {(!data.filas || data.filas.length === 0) ? (
            <EmptyState title="Sin movimientos en los períodos" />
          ) : (
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr',
                             padding: '10px 16px', background: 'var(--bg-3)',
                             fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase' }}>
                <span>Período</span><span>Ingresos</span><span>Gastos</span><span>Beneficio</span>
              </div>
              {data.filas.map((r, i) => (
                <div key={r.periodo || r.mes} style={{
                  display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr',
                  padding: '10px 16px', alignItems: 'center', fontSize: 13,
                  borderTop: i > 0 ? '1px solid var(--line)' : 'none',
                }}>
                  <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{r.periodo || r.mes}</span>
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
              <button onClick={() => onAction('ver_asiento', d)}
                      title={d.odoo_move_id ? 'Ver asiento contable (Odoo)' : 'Ver asiento contable propuesto'}
                      style={{...iconBtn, color: d.odoo_move_id ? 'var(--blue)' : 'var(--text-2)'}}>
                <Calculator size={12} />
              </button>
              {d.estado === 'borrador' && (
                <>
                  <button onClick={() => {
                    const ok = window.confirm(
                      `¿Validar definitivo?\n\n` +
                      `Proveedor: ${d.proveedor || '—'}\n` +
                      `Importe: ${d.importe_total || '—'} €\n` +
                      `Periodo: ${d.periodo || '—'}\n\n` +
                      `Esto marcará el documento como validado y creará el ` +
                      `asiento contable en Odoo (account.move).`
                    )
                    if (ok) onAction('validar', d)
                  }} title="Validar definitivo" style={{...iconBtn, color: 'var(--green)'}}>
                    <Check size={12} />
                  </button>
                  <button onClick={() => {
                    const m = window.prompt(
                      `¿Anulamos este documento?\n\n` +
                      `Proveedor: ${d.proveedor || '—'}\n` +
                      `Importe: ${d.importe_total || '—'} €\n\n` +
                      `Quedará marcado como rechazado. Motivo (opcional):`
                    )
                    if (m === null) return  // canceló
                    onAction('rechazar', d, { motivo: m })
                  }} title="Anular / rechazar" style={{...iconBtn, color: 'var(--amber)'}}>
                    <X size={12} />
                  </button>
                </>
              )}
              {d.estado === 'validado' && (
                <button onClick={() => {
                  const m = window.prompt(
                    `¿Devolver este documento a BORRADOR?\n\n` +
                    `Proveedor: ${d.proveedor || '—'}\n` +
                    `Importe: ${d.importe_total || '—'} €\n` +
                    `Asiento Odoo: ${d.odoo_move_id || 'ninguno'}\n\n` +
                    `El documento volverá a estado borrador y se podrá editar de nuevo.\n` +
                    (d.odoo_move_id
                      ? `Se intentará pasar el asiento Odoo a draft (o cancelarlo).\n\n`
                      : '\n') +
                    `Motivo (opcional):`
                  )
                  if (m === null) return  // canceló
                  onAction('a_borrador', d, { motivo: m })
                }} title="Volver a borrador" style={{...iconBtn, color: 'var(--blue)'}}>
                  <RefreshCw size={12} />
                </button>
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
    console.log('[contab] subirYEscanear click', { archivo: archivo?.name, size: archivo?.size })
    if (!archivo) {
      toast.error('Selecciona primero un archivo (input "Archivo *")')
      return
    }
    setFase('scanning')
    toast.success(`Subiendo ${archivo.name}…`)
    try {
      // 1. Upload (mínimo, sin metadata aún)
      const fd = new FormData()
      fd.append('file', archivo)
      let doc, isExisting = false
      try {
        // El backend devuelve {documento, existing: true} si ya estaba subido.
        // _contabRequest no expone toda la respuesta, así que llamamos directo.
        const fdRes = await fetch('/api/contab/documentos', {
          method: 'POST',
          headers: {
            'X-Round-Token': import.meta.env.VITE_CONFIG_API_TOKEN || '',
            'X-Round-Manager-Id': identity?.managerId || '',
            ...(identity?.trainerId ? { 'X-Round-Trainer-Id': identity.trainerId } : {}),
          },
          body: fd,
        })
        const txt = await fdRes.text()
        let resData; try { resData = JSON.parse(txt) } catch { resData = { error: txt } }
        if (!fdRes.ok || resData?.ok === false) {
          throw new Error(resData?.error || `HTTP ${fdRes.status}`)
        }
        doc = resData.documento
        isExisting = !!resData.existing
        console.log('[contab] upload OK', { doc, isExisting })
      } catch (upErr) {
        console.error('[contab] upload FAIL', upErr)
        toast.error(`Subida falló: ${upErr.message}`)
        setFase('pick')
        return
      }
      setDocId(doc.id)
      if (isExisting) {
        toast.success(`Ya existía (id=${doc.id}). Abriendo original…`)
      } else {
        toast.success('Subida OK. Analizando con IA (puede tardar 1-3 min)…')
      }
      // 2. Si el doc YA tenía datos del LLM, no re-escaneamos: cargamos directo.
      //    Solo escaneamos si es nuevo o el escaneo anterior falló.
      const yaEscaneado = isExisting && doc.extraido_por_llm
      try {
        const r = yaEscaneado
          ? { documento: doc, extraction: { confidence: doc.confianza_llm } }
          : await contabDocEscanear(identity, doc.id)
        console.log('[contab] escanear OK', r, { yaEscaneado })
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
              <Btn variant="primary" onClick={subirYEscanear}>
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
