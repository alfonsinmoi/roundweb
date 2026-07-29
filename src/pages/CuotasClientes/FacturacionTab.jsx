// Pestaña "Facturación" — resumen agrupado por año → trimestre → mes con una
// COLUMNA por cada forma de cobro (método), en pares Cobrado / Impagado, y
// sumatorios por agrupación en cada nivel + total general.
// Fuente: GET /api/recibos/facturacion-resumen (filas planas; el pivote y los
// subtotales se calculan aquí).
import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, ChevronDown, RefreshCw, Loader2, TrendingUp, Store, Download } from 'lucide-react'
import { Card, Btn, SectionTitle } from '../../components/UI'
import { useToast } from '../../components/Toast'
import { facturacionResumen } from '../../utils/configApi'
import { FORMA_PAGO_LABELS } from '../../utils/cuotasApi'
import IvaNota from '../../components/IvaNota'

// Etiquetas idénticas al filtro del Listado (FORMA_PAGO_LABELS) para que
// CAJA/efectivo y TPV queden diferenciados en columnas distintas.
const METODO_LABEL = { ...FORMA_PAGO_LABELS, tpv: 'TPV virtual', '(sin metodo)': 'Sin método' }
const metodoLabel = (m) => METODO_LABEL[m] || m || 'Sin método'

// Sinónimos legacy → código canónico (espejo de _METODO_PAGO_NORM en el
// backend). Colapsa un mismo método en UNA sola columna aunque en histórico
// aparezca con otro código (efectivo≡caja_efectivo, tpv≡caja_tpv_virtual…).
const METODO_NORM = {
  efectivo: 'caja_efectivo',
  tpv: 'caja_tpv_virtual', tpv_virtual: 'caja_tpv_virtual', tpv_fisico: 'caja_tpv_fisico',
  tarjeta_token: 'tarjeta_tok', tokenizacion: 'tarjeta_tok',
}
const normMetodo = (m) => METODO_NORM[m] || m || '(sin metodo)'
const TRIM_LABEL = { 1: 'T1 (ene-mar)', 2: 'T2 (abr-jun)', 3: 'T3 (jul-sep)', 4: 'T4 (oct-dic)' }
const MES_LABEL = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
                   'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

const eur = (v) => !v ? '—' : v.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'

// Nodo: acumula por método {metodo: {c, i}} + totales de fila (tc, ti).
function nodo() { return { porMetodo: {}, tc: 0, ti: 0 } }
function add(n, met, r) {
  n.porMetodo[met] ||= { c: 0, i: 0 }
  n.porMetodo[met].c += r.cobrado_imp || 0
  n.porMetodo[met].i += r.impagado_imp || 0
  n.tc += r.cobrado_imp || 0
  n.ti += r.impagado_imp || 0
}

export default function FacturacionTab({ identity }) {
  const toast = useToast()
  const [filas, setFilas] = useState([])
  const [trainersMap, setTrainersMap] = useState({})
  const [esManager, setEsManager] = useState(false)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(() => new Set())

  const cargar = async () => {
    setLoading(true)
    try {
      const r = await facturacionResumen(identity, {})
      setFilas(r.filas || [])
      setTrainersMap(r.trainers || {})
      setEsManager(!!r.es_manager)
    } catch (e) { toast.error('Error cargando facturación: ' + e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { if (identity?.managerId) cargar() }, [identity?.managerId])

  // Etiqueta legible de un trainer/centro
  const trLabel = (tr) => trainersMap[tr]
    || (tr === '(sin trainer)' ? 'Sin centro asignado' : `Centro ${tr}`)

  // ── Métodos (columnas) + árbol año→trimestre→mes[→trainer] por método ──
  // En vista manager cada mes se desglosa además por trainer (nivel hoja).
  const { metodos, anios, total } = useMemo(() => {
    const metset = new Set()
    const anios = {}
    const total = nodo()
    for (const r of filas) {
      const met = normMetodo(r.metodo)
      metset.add(met)
      const a = r.anio, t = String(r.trimestre), m = r.periodo
      anios[a] ||= { n: nodo(), trims: {} }
      anios[a].trims[t] ||= { n: nodo(), meses: {} }
      anios[a].trims[t].meses[m] ||= { n: nodo(), mes: r.mes, trainers: {} }
      add(anios[a].n, met, r)
      add(anios[a].trims[t].n, met, r)
      add(anios[a].trims[t].meses[m].n, met, r)
      add(total, met, r)
      if (esManager) {
        const tr = r.id_trainer || '(sin trainer)'
        const mNode = anios[a].trims[t].meses[m].trainers
        mNode[tr] ||= nodo()
        add(mNode[tr], met, r)
      }
    }
    const metodos = [...metset].sort((x, y) => metodoLabel(x).localeCompare(metodoLabel(y)))
    return { metodos, anios, total }
  }, [filas, esManager])

  const toggle = (k) => setExpanded(prev => {
    const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n
  })

  // Exporta a Excel la tabla de facturación (una fila por periodo × [centro] ×
  // forma de cobro). En vista manager incluye la columna Centro. xlsx bajo demanda.
  const exportarExcel = async () => {
    if (!filas.length) return
    const XLSX = await import('xlsx')
    const rows = filas.map(f => {
      const mesNum = parseInt(f.mes, 10)
      const row = {
        'Año':       f.anio,
        'Trimestre': TRIM_LABEL[String(f.trimestre)] || `T${f.trimestre}`,
        'Mes':       MES_LABEL[mesNum] || f.periodo,
      }
      if (esManager) row['Centro'] = trLabel(f.id_trainer)
      row['Forma de cobro'] = metodoLabel(normMetodo(f.metodo))
      row['Cobrado (€)']    = Number(f.cobrado_imp || 0)
      row['Impagado (€)']   = Number(f.impagado_imp || 0)
      row['Pendiente (€)']  = Number(f.pendiente_imp || 0)
      return row
    })
    const header = ['Año', 'Trimestre', 'Mes', ...(esManager ? ['Centro'] : []),
                    'Forma de cobro', 'Cobrado (€)', 'Impagado (€)', 'Pendiente (€)']
    const ws = XLSX.utils.json_to_sheet(rows, { header })
    ws['!cols'] = header.map(h =>
      ({ wch: h === 'Centro' ? 22 : h === 'Forma de cobro' ? 16 : h === 'Mes' ? 12 : 11 }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Facturación')
    const hoy = new Date().toISOString().slice(0, 10)
    XLSX.writeFile(wb, `facturacion_${hoy}.xlsx`)
  }

  const visibles = useMemo(() => {
    const out = []
    for (const a of Object.keys(anios).sort().reverse()) {
      const kA = `a:${a}`
      out.push({ key: kA, level: 0, label: a, n: anios[a].n, open: expanded.has(kA) })
      if (!expanded.has(kA)) continue
      const trims = anios[a].trims
      for (const t of Object.keys(trims).sort().reverse()) {
        const kT = `${kA}/t:${t}`
        out.push({ key: kT, level: 1, label: TRIM_LABEL[t] || `T${t}`, n: trims[t].n, open: expanded.has(kT) })
        if (!expanded.has(kT)) continue
        const meses = trims[t].meses
        for (const m of Object.keys(meses).sort().reverse()) {
          const kM = `${kT}/m:${m}`
          const mesNum = parseInt(meses[m].mes, 10)
          const trObj = meses[m].trainers || {}
          const trKeys = Object.keys(trObj)
          const mesExpandable = esManager && trKeys.length > 0
          out.push({ key: kM, level: 2, label: `${MES_LABEL[mesNum] || m} ${a}`,
                     n: meses[m].n, open: mesExpandable ? expanded.has(kM) : null })
          if (mesExpandable && expanded.has(kM)) {
            for (const tr of trKeys.sort((x, y) => trLabel(x).localeCompare(trLabel(y)))) {
              out.push({ key: `${kM}/tr:${tr}`, level: 3, label: trLabel(tr),
                         n: trObj[tr], open: null, trainer: true })
            }
          }
        }
      }
    }
    return out
  }, [anios, expanded, esManager, trainersMap])

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
      <Loader2 size={20} className="animate-spin" style={{ color: 'var(--green)' }} /></div>
  }

  const thG = { padding: '6px 10px', fontSize: 11, fontWeight: 700, textAlign: 'center',
                borderLeft: '1px solid var(--line)', whiteSpace: 'nowrap' }
  const thS = { padding: '4px 10px', fontSize: 10, fontWeight: 600, textAlign: 'right',
                color: 'var(--text-3)', whiteSpace: 'nowrap' }
  const td = { textAlign: 'right', padding: '6px 10px', fontSize: 12.5, whiteSpace: 'nowrap',
               fontVariantNumeric: 'tabular-nums' }
  const indent = (lvl) => 12 + lvl * 20

  const cols = [...metodos, '__TOTAL__']
  const cellC = (n, met) => met === '__TOTAL__' ? n.tc : (n.porMetodo[met]?.c || 0)
  const cellI = (n, met) => met === '__TOTAL__' ? n.ti : (n.porMetodo[met]?.i || 0)

  const fila = (row) => {
    const weight = row.level === 0 ? 700 : row.level === 1 ? 600 : 500
    const bg = row.level === 0 ? 'var(--bg-2)' : row.level === 1 ? 'rgba(255,255,255,0.02)' : 'transparent'
    const expandable = row.open !== null
    return (
      <tr key={row.key}
          className={expandable ? 'interactive-row' : undefined}
          onClick={expandable ? () => toggle(row.key) : undefined}
          style={{ borderBottom: '1px solid var(--line-decorative)', background: bg,
                   cursor: expandable ? 'pointer' : 'default' }}>
        <td style={{ ...td, textAlign: 'left', paddingLeft: indent(row.level), fontWeight: weight,
                     color: row.trainer ? 'var(--text-2)' : 'var(--text-0)',
                     position: 'sticky', left: 0, background: bg, zIndex: 1 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {expandable ? (row.open ? <ChevronDown size={13} /> : <ChevronRight size={13} />)
                        : <span style={{ width: 13, display: 'inline-block' }} />}
            {row.trainer && <Store size={12} style={{ color: 'var(--text-3)', flexShrink: 0 }} aria-hidden="true" />}
            {row.label}
          </span>
        </td>
        {cols.map(met => [
          <td key={met + ':c'} style={{ ...td, fontWeight: weight, borderLeft: '1px solid var(--line)',
               color: cellC(row.n, met) ? 'var(--green)' : 'var(--text-3)' }}>{eur(cellC(row.n, met))}</td>,
          <td key={met + ':i'} style={{ ...td, fontWeight: weight,
               color: cellI(row.n, met) ? 'var(--red)' : 'var(--text-3)' }}>{eur(cellI(row.n, met))}</td>,
        ])}
      </tr>
    )
  }

  return (
    <Card style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <SectionTitle><TrendingUp size={15} style={{ marginRight: 6 }} /> Facturación</SectionTitle>
            <IvaNota />
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '2px 0 0' }}>
            Recibos por año · trimestre · mes, con columnas por forma de cobro
            (<span style={{ color: 'var(--green)' }}>Cobrado</span> = pagado/facturado ·
            <span style={{ color: 'var(--red)' }}> Impagado</span> = impagado/devuelto).
            Clic en un año/trimestre{esManager ? '/mes' : ''} para desplegar
            {esManager ? '; cada mes se desglosa por centro.' : '.'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Btn variant="secondary" size="sm" onClick={exportarExcel} disabled={filas.length === 0}
               title={filas.length === 0 ? 'Sin datos que exportar' : 'Exportar la tabla de facturación a Excel'}>
            <Download size={13} /> Exportar Excel
          </Btn>
          <Btn variant="secondary" size="sm" onClick={cargar}><RefreshCw size={13} /> Actualizar</Btn>
        </div>
      </div>

      {filas.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-3)', textAlign: 'center', padding: 32 }}>
          Sin recibos que resumir todavía.
        </p>
      ) : (
        <div className="table-scroll" style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', minWidth: 640 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--line)' }}>
                <th rowSpan={2} style={{ ...thG, textAlign: 'left', borderLeft: 'none',
                     position: 'sticky', left: 0, background: 'var(--bg-1)', zIndex: 2 }}>
                  Periodo
                </th>
                {cols.map(met => (
                  <th key={met} colSpan={2} style={{ ...thG,
                       color: met === '__TOTAL__' ? 'var(--text-0)' : 'var(--text-1)' }}>
                    {met === '__TOTAL__' ? 'TOTAL' : metodoLabel(met)}
                  </th>
                ))}
              </tr>
              <tr style={{ borderBottom: '1px solid var(--line)' }}>
                {cols.map(met => [
                  <th key={met + ':c'} style={{ ...thS, borderLeft: '1px solid var(--line)', color: 'var(--green)' }}>Cobrado</th>,
                  <th key={met + ':i'} style={{ ...thS, color: 'var(--red)' }}>Impagado</th>,
                ])}
              </tr>
            </thead>
            <tbody>
              <tr style={{ background: 'var(--bg-3)', borderBottom: '2px solid var(--line)', fontWeight: 700 }}>
                <td style={{ ...td, textAlign: 'left', paddingLeft: 12, fontWeight: 700, color: 'var(--text-0)',
                     position: 'sticky', left: 0, background: 'var(--bg-3)', zIndex: 1 }}>TOTAL general</td>
                {cols.map(met => [
                  <td key={met + ':c'} style={{ ...td, fontWeight: 700, borderLeft: '1px solid var(--line)',
                       color: cellC(total, met) ? 'var(--green)' : 'var(--text-3)' }}>{eur(cellC(total, met))}</td>,
                  <td key={met + ':i'} style={{ ...td, fontWeight: 700,
                       color: cellI(total, met) ? 'var(--red)' : 'var(--text-3)' }}>{eur(cellI(total, met))}</td>,
                ])}
              </tr>
              {visibles.map(fila)}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
