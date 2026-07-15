// Pestaña "Facturación" — resumen agrupado por año → trimestre → mes → tipo de
// cobro, con importes COBRADOS / IMPAGADOS / PENDIENTES y subtotales por nivel.
// Fuente: GET /api/recibos/facturacion-resumen (filas planas; el árbol y los
// subtotales se calculan aquí).
import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, ChevronDown, RefreshCw, Loader2, TrendingUp } from 'lucide-react'
import { Card, Btn, SectionTitle } from '../../components/UI'
import { useToast } from '../../components/Toast'
import { facturacionResumen } from '../../utils/configApi'

const METODO_LABEL = {
  sepa: 'SEPA',
  tarjeta_tok: 'Tarjeta tokenizada',
  tarjeta_token: 'Tarjeta tokenizada',
  tokenizacion: 'Tarjeta tokenizada',
  caja_efectivo: 'Efectivo / caja',
  efectivo: 'Efectivo',
  caja_tpv_fisico: 'TPV físico',
  tpv: 'TPV virtual',
  caja_tpv_virtual: 'TPV virtual',
  enlace_pago: 'Enlace de pago',
  '(sin metodo)': 'Sin método',
}
const metodoLabel = (m) => METODO_LABEL[m] || m || 'Sin método'
const TRIM_LABEL = { 1: 'T1 (ene-mar)', 2: 'T2 (abr-jun)', 3: 'T3 (jul-sep)', 4: 'T4 (oct-dic)' }
const MES_LABEL = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
                   'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

const eur = (v) => (v || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'

function emptyAgg() {
  return { c: 0, cn: 0, i: 0, iN: 0, p: 0, pn: 0 }
}
function addAgg(a, r) {
  a.c += r.cobrado_imp || 0;  a.cn += r.cobrado_n || 0
  a.i += r.impagado_imp || 0; a.iN += r.impagado_n || 0
  a.p += r.pendiente_imp || 0; a.pn += r.pendiente_n || 0
}

export default function FacturacionTab({ identity }) {
  const toast = useToast()
  const [filas, setFilas] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(() => new Set())

  const cargar = async () => {
    setLoading(true)
    try {
      const r = await facturacionResumen(identity, {})
      setFilas(r.filas || [])
    } catch (e) { toast.error('Error cargando facturación: ' + e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { if (identity?.managerId) cargar() }, [identity?.managerId])

  // ── Árbol año → trimestre → mes → método + subtotales ──────────────────────
  const { anios, total } = useMemo(() => {
    const anios = {}
    const total = emptyAgg()
    for (const r of filas) {
      const a = r.anio, t = String(r.trimestre), m = r.periodo, met = r.metodo
      anios[a] ||= { agg: emptyAgg(), trims: {} }
      anios[a].trims[t] ||= { agg: emptyAgg(), meses: {} }
      anios[a].trims[t].meses[m] ||= { agg: emptyAgg(), mes: r.mes, metodos: {} }
      anios[a].trims[t].meses[m].metodos[met] ||= { agg: emptyAgg() }
      addAgg(anios[a].agg, r)
      addAgg(anios[a].trims[t].agg, r)
      addAgg(anios[a].trims[t].meses[m].agg, r)
      addAgg(anios[a].trims[t].meses[m].metodos[met].agg, r)
      addAgg(total, r)
    }
    return { anios, total }
  }, [filas])

  const toggle = (k) => setExpanded(prev => {
    const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n
  })

  // Filas visibles (según expandido) con nivel para indentar
  const visibles = useMemo(() => {
    const out = []
    for (const a of Object.keys(anios).sort().reverse()) {
      const kA = `a:${a}`
      out.push({ key: kA, level: 0, label: a, agg: anios[a].agg, expandable: true, open: expanded.has(kA) })
      if (!expanded.has(kA)) continue
      const trims = anios[a].trims
      for (const t of Object.keys(trims).sort().reverse()) {
        const kT = `${kA}/t:${t}`
        out.push({ key: kT, level: 1, label: TRIM_LABEL[t] || `T${t}`, agg: trims[t].agg, expandable: true, open: expanded.has(kT) })
        if (!expanded.has(kT)) continue
        const meses = trims[t].meses
        for (const m of Object.keys(meses).sort().reverse()) {
          const kM = `${kT}/m:${m}`
          const mesNum = parseInt(meses[m].mes, 10)
          out.push({ key: kM, level: 2, label: `${MES_LABEL[mesNum] || m} ${a}`, agg: meses[m].agg, expandable: true, open: expanded.has(kM) })
          if (!expanded.has(kM)) continue
          const metodos = meses[m].metodos
          for (const met of Object.keys(metodos).sort()) {
            out.push({ key: `${kM}/x:${met}`, level: 3, label: metodoLabel(met), agg: metodos[met].agg, expandable: false })
          }
        }
      }
    }
    return out
  }, [anios, expanded])

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
      <Loader2 size={20} className="animate-spin" style={{ color: 'var(--green)' }} /></div>
  }

  const th = { textAlign: 'right', padding: '8px 12px', fontSize: 11, fontWeight: 600,
               color: 'var(--text-3)', whiteSpace: 'nowrap' }
  const td = { textAlign: 'right', padding: '7px 12px', fontSize: 13, whiteSpace: 'nowrap',
               fontVariantNumeric: 'tabular-nums' }
  const indent = (lvl) => 12 + lvl * 22

  return (
    <Card style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <SectionTitle><TrendingUp size={15} style={{ marginRight: 6 }} /> Facturación</SectionTitle>
          <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '2px 0 0' }}>
            Recibos agrupados por año · trimestre · mes y tipo de cobro. Cobrado = pagado/facturado ·
            Impagado = impagado/devuelto · Pendiente = emitido/pendiente.
          </p>
        </div>
        <Btn variant="secondary" size="sm" onClick={cargar}><RefreshCw size={13} /> Actualizar</Btn>
      </div>

      {filas.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-3)', textAlign: 'center', padding: 32 }}>
          Sin recibos que resumir todavía.
        </p>
      ) : (
        <div className="table-scroll" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--line)' }}>
                <th style={{ ...th, textAlign: 'left', paddingLeft: 12 }}>Periodo / tipo de cobro</th>
                <th style={{ ...th, color: 'var(--green)' }}>Cobrado</th>
                <th style={{ ...th, color: 'var(--red)' }}>Impagado</th>
                <th style={{ ...th, color: 'var(--amber)' }}>Pendiente</th>
                <th style={th}>Total</th>
              </tr>
            </thead>
            <tbody>
              {/* TOTAL general */}
              <tr style={{ background: 'var(--bg-3)', borderBottom: '1px solid var(--line)', fontWeight: 700 }}>
                <td style={{ ...td, textAlign: 'left', paddingLeft: 12 }}>TOTAL general</td>
                <td style={{ ...td, color: 'var(--green)', fontWeight: 700 }}>{eur(total.c)}</td>
                <td style={{ ...td, color: 'var(--red)', fontWeight: 700 }}>{eur(total.i)}</td>
                <td style={{ ...td, color: 'var(--amber)', fontWeight: 700 }}>{eur(total.p)}</td>
                <td style={{ ...td, fontWeight: 700 }}>{eur(total.c + total.i + total.p)}</td>
              </tr>
              {visibles.map(row => {
                const isMetodo = row.level === 3
                const bg = row.level === 0 ? 'var(--bg-2)' : row.level === 1 ? 'rgba(255,255,255,0.02)' : 'transparent'
                const weight = row.level === 0 ? 700 : row.level <= 2 ? 600 : 400
                return (
                  <tr key={row.key}
                      className={row.expandable ? 'interactive-row' : undefined}
                      onClick={row.expandable ? () => toggle(row.key) : undefined}
                      style={{ borderBottom: '1px solid var(--line-decorative)', background: bg,
                               cursor: row.expandable ? 'pointer' : 'default' }}>
                    <td style={{ ...td, textAlign: 'left', paddingLeft: indent(row.level),
                                 fontWeight: weight, color: isMetodo ? 'var(--text-2)' : 'var(--text-0)' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        {row.expandable
                          ? (row.open ? <ChevronDown size={13} /> : <ChevronRight size={13} />)
                          : <span style={{ width: 13, display: 'inline-block' }} />}
                        {row.label}
                        {!isMetodo && (
                          <span style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 400 }}>
                            ({(row.agg.cn + row.agg.iN + row.agg.pn)} recibos)
                          </span>
                        )}
                      </span>
                    </td>
                    <td style={{ ...td, color: 'var(--green)', fontWeight: weight }}>
                      {eur(row.agg.c)}{row.agg.cn ? <sub style={{ color: 'var(--text-3)', fontSize: 9 }}> {row.agg.cn}</sub> : null}
                    </td>
                    <td style={{ ...td, color: row.agg.i ? 'var(--red)' : 'var(--text-3)', fontWeight: weight }}>
                      {eur(row.agg.i)}{row.agg.iN ? <sub style={{ color: 'var(--text-3)', fontSize: 9 }}> {row.agg.iN}</sub> : null}
                    </td>
                    <td style={{ ...td, color: row.agg.p ? 'var(--amber)' : 'var(--text-3)', fontWeight: weight }}>
                      {eur(row.agg.p)}{row.agg.pn ? <sub style={{ color: 'var(--text-3)', fontSize: 9 }}> {row.agg.pn}</sub> : null}
                    </td>
                    <td style={{ ...td, fontWeight: weight, color: 'var(--text-0)' }}>
                      {eur(row.agg.c + row.agg.i + row.agg.p)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
