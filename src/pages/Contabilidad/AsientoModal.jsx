// Modal que muestra el asiento contable de un documento.
// - PROPUESTO si el documento aún está en borrador (no validado en Odoo).
// - DEFINITIVO si ya tiene odoo_move_id (lee las account.move.line reales).

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Calculator, Loader2, X } from 'lucide-react'
import { Card, Btn, Badge } from '../../components/UI'
import { useToast } from '../../components/Toast'
import { contabDocAsiento } from '../../utils/configApi'

export default function AsientoModal({ doc, identity, onClose }) {
  const toast = useToast()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    contabDocAsiento(identity, doc.id)
      .then(d => { if (active) setData(d) })
      .catch(e => toast.error(`Error: ${e.message}`))
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  // eslint-disable-next-line
  }, [doc.id])

  return createPortal(
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }}
         style={{ position: 'fixed', inset: 0, zIndex: 1000,
                   background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)',
                   display: 'flex', alignItems: 'flex-start',
                   justifyContent: 'center', padding: '40px 20px',
                   overflowY: 'auto' }}>
      <div style={{ width: '100%', maxWidth: 940, background: 'var(--bg-1)',
                     border: '1px solid var(--line)', borderRadius: 16,
                     boxShadow: '0 16px 36px -8px rgba(0,0,0,0.45)' }}>
        <header style={{ padding: '16px 22px', borderBottom: '1px solid var(--line)',
                          display: 'flex', justifyContent: 'space-between',
                          alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <Calculator size={18} style={{ color: 'var(--green)', flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-0)', margin: 0 }}>
                Asiento contable
              </p>
              <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {doc.proveedor || doc.filename_original || `Doc #${doc.id}`}
                {doc.num_factura && ` · ${doc.num_factura}`}
              </p>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'var(--bg-3)', border: '1px solid var(--line)',
                  borderRadius: 8, padding: 8, cursor: 'pointer', color: 'var(--text-2)' }}>
            <X size={14} />
          </button>
        </header>

        <div style={{ padding: 22 }}>
          {loading ? (
            <div style={{ padding: 24, textAlign: 'center' }}>
              <Loader2 size={22} className="animate-spin" style={{ color: 'var(--green)' }} />
            </div>
          ) : !data ? (
            <p style={{ fontSize: 13, color: 'var(--text-3)' }}>No se pudo cargar el asiento.</p>
          ) : (
            <>
              {/* Cabecera tipo */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14,
                              padding: '10px 14px', borderRadius: 10,
                              background: data.tipo === 'definitivo' ? 'var(--green-bg)' : 'rgba(251,191,36,0.08)',
                              border: `1px solid ${data.tipo === 'definitivo' ? 'var(--green-border)' : 'rgba(251,191,36,0.3)'}` }}>
                <Badge color={data.tipo === 'definitivo' ? 'green' : 'amber'}>
                  {data.tipo === 'definitivo' ? 'DEFINITIVO (Odoo)' : 'PROPUESTO'}
                </Badge>
                {data.asiento_tipo === 'nomina' && <Badge color="blue">NÓMINA</Badge>}
                <span style={{ fontSize: 12, color: 'var(--text-1)' }}>
                  {data.tipo === 'definitivo'
                    ? <>Asiento real en Odoo. <strong>{data.move_name}</strong> · estado <strong>{data.state}</strong> · {data.fecha}</>
                    : data.asiento_tipo === 'nomina'
                      ? <>Asiento de nómina (PGC: 640/642/4751/476/465). Se creará al validar.</>
                      : <>Asiento que se creará al validar este documento. Aún no posteado en Odoo.</>}
                </span>
              </div>

              {/* Avisos del asiento propuesto */}
              {data.avisos && data.avisos.length > 0 && (
                <div style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 10,
                                background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.3)' }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--red)', marginBottom: 4 }}>
                    Atención antes de validar:
                  </p>
                  <ul style={{ fontSize: 12, color: 'var(--text-1)', margin: 0, paddingLeft: 18 }}>
                    {data.avisos.map((a, i) => <li key={i}>{a}</li>)}
                  </ul>
                </div>
              )}

              {/* Tabla de líneas (debe / haber) */}
              <Card style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 110px 110px',
                                padding: '10px 14px', background: 'var(--bg-3)',
                                fontSize: 10.5, color: 'var(--text-3)',
                                textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 700, gap: 10 }}>
                  <span>Cuenta</span>
                  <span>Concepto</span>
                  <span style={{ textAlign: 'right' }}>Debe</span>
                  <span style={{ textAlign: 'right' }}>Haber</span>
                </div>
                {data.lineas.map((ln, i) => (
                  <div key={i} style={{
                    display: 'grid', gridTemplateColumns: '80px 1fr 110px 110px',
                    padding: '8px 14px', alignItems: 'center', fontSize: 12.5, gap: 10,
                    borderTop: i > 0 ? '1px solid var(--line)' : 'none',
                  }}>
                    <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--text-0)' }}>
                      {String(ln.cuenta).split(/[^0-9]/)[0] || ln.cuenta}
                    </span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          title={ln.concepto}>
                      {ln.concepto}
                      {ln.partner && <span style={{ fontSize: 11, color: 'var(--text-3)' }}> · {ln.partner}</span>}
                    </span>
                    <span style={{ fontFamily: 'monospace', textAlign: 'right',
                                    color: ln.debe > 0 ? 'var(--text-0)' : 'var(--text-3)',
                                    fontWeight: ln.debe > 0 ? 700 : 400 }}>
                      {ln.debe > 0 ? `${ln.debe.toFixed(2)} €` : '—'}
                    </span>
                    <span style={{ fontFamily: 'monospace', textAlign: 'right',
                                    color: ln.haber > 0 ? 'var(--text-0)' : 'var(--text-3)',
                                    fontWeight: ln.haber > 0 ? 700 : 400 }}>
                      {ln.haber > 0 ? `${ln.haber.toFixed(2)} €` : '—'}
                    </span>
                  </div>
                ))}
                {/* Totales */}
                {(() => {
                  const sumD = data.lineas.reduce((s, l) => s + (l.debe || 0), 0)
                  const sumH = data.lineas.reduce((s, l) => s + (l.haber || 0), 0)
                  const cuadra = Math.abs(sumD - sumH) < 0.05
                  const isNomina = data.asiento_tipo === 'nomina'
                  return (
                    <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 110px 110px',
                                    padding: '10px 14px', borderTop: '2px solid var(--line)',
                                    background: cuadra ? 'var(--bg-2)' : 'rgba(248,113,113,0.08)',
                                    fontSize: 12.5, fontWeight: 700, gap: 10 }}>
                      <span></span>
                      <span style={{ textTransform: 'uppercase', letterSpacing: 0.4, fontSize: 11 }}>
                        {isNomina
                          ? `TOTAL NÓMINA · bruto ${data.totales.bruto?.toFixed(2)} € · SS emp ${data.totales.ss_empresa?.toFixed(2)} € · líquido ${data.totales.liquido?.toFixed(2)} €`
                          : `TOTAL · base ${data.totales.base.toFixed(2)} € · IVA ${data.totales.iva.toFixed(2)} €`}
                        {!cuadra && <span style={{ color: 'var(--red)', marginLeft: 8 }}> · ¡NO CUADRA!</span>}
                      </span>
                      <span style={{ fontFamily: 'monospace', textAlign: 'right' }}>
                        {sumD.toFixed(2)} €
                      </span>
                      <span style={{ fontFamily: 'monospace', textAlign: 'right' }}>
                        {sumH.toFixed(2)} €
                      </span>
                    </div>
                  )
                })()}
              </Card>

              <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 12, lineHeight: 1.5 }}>
                {data.tipo === 'definitivo'
                  ? `Este asiento ya está creado en Odoo (move_id ${data.move_id}). Para modificarlo edítalo desde el panel de Odoo.`
                  : 'Al pulsar "Validar definitivo" en el documento se creará exactamente este asiento como account.move en Odoo. Confianza LLM, categoría y proveedor afectan a las cuentas usadas — ajusta antes de validar si algo no es correcto.'}
              </p>
            </>
          )}
        </div>

        <div style={{ padding: '12px 22px', borderTop: '1px solid var(--line)',
                        display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <Btn variant="secondary" onClick={onClose}>Cerrar</Btn>
        </div>
      </div>
    </div>,
    document.body)
}
