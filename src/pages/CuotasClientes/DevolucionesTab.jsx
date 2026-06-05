import { useState, useRef, useEffect, useMemo } from 'react'
import { Loader2, Upload, AlertTriangle, CheckCircle2, X, Trash2, Send, FileSpreadsheet, Search, User, Plus } from 'lucide-react'
import * as XLSX from 'xlsx'
import { Card, Btn, SectionTitle, Badge, Avatar } from '../../components/UI'
import { useToast } from '../../components/Toast'
import { procesarDevoluciones, cuotasList } from '../../utils/cuotasApi'

// Columnas del fichero de devoluciones SEPA del banco. La devolución se casa
// con la EMISIÓN (mes/año) + el CLIENTE (DNI), NO con la referencia Odoo:
//  - DNI: del "Concepto" (ej. "MES:6,26241980S C:2203/RT MJ 1915").
//  - periodo: de "Fecha de cobro original" (ej. "01-06-2026" → 2026-06).
const CONCEPTO_KEYS = ['concepto']
const FECHA_KEYS = ['fecha de cobro original','fecha cobro original','fecha de cargo','fecha cargo','fecha cobro','fecha original','fecha']
const IMPORTE_KEYS = ['importe','amount','total']
const MOTIVODEV_KEYS = ['motivo devolución','motivo devolucion','motivo','reason','razón','razon']
const CODIGO_KEYS = ['código devolución','codigo devolucion','código','codigo','code']
const LIBRADO_KEYS = ['librado','deudor','cliente','nombre','titular']
const REF_KEYS = ['referencia','reference','recibo','invoice_ref','numero','número']
const DNI_KEYS = ['dni','nif','documento','nie']

function findKey(row, candidates) {
  const keys = Object.keys(row).map(k => k.toLowerCase().trim())
  for (const c of candidates) {
    const i = keys.indexOf(c)
    if (i !== -1) return Object.keys(row)[i]
  }
  return null
}

const DOC_RE = /[XYZ]?\d{7,8}[A-Z]/i
function extractDni(concepto, dniCol) {
  const m1 = String(dniCol || '').match(DOC_RE)
  if (m1) return m1[0].toUpperCase()
  const m2 = String(concepto || '').match(DOC_RE)
  return m2 ? m2[0].toUpperCase() : ''
}

function toPeriodo(v) {
  if (v == null || v === '') return ''
  const s = String(v).trim()
  let m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/)   // dd-mm-yyyy
  if (m) return `${m[3]}-${String(m[2]).padStart(2, '0')}`
  m = s.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/)        // yyyy-mm-dd
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}`
  const d = new Date(s)
  if (!isNaN(d.getTime())) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  return ''
}

function normalizarFilas(raw) {
  if (!raw || raw.length === 0) return []
  // Fichero del banco = filas como objetos con cabecera.
  if (Array.isArray(raw[0])) return []
  const sample = raw[0]
  const conceptoKey = findKey(sample, CONCEPTO_KEYS)
  const fechaKey = findKey(sample, FECHA_KEYS)
  const importeKey = findKey(sample, IMPORTE_KEYS)
  const motivoKey = findKey(sample, MOTIVODEV_KEYS)
  const codigoKey = findKey(sample, CODIGO_KEYS)
  const libradoKey = findKey(sample, LIBRADO_KEYS)
  const refKey = findKey(sample, REF_KEYS)
  const dniKey = findKey(sample, DNI_KEYS)
  return raw.map(r => {
    const concepto = conceptoKey ? String(r[conceptoKey] || '') : ''
    const motivoDev = motivoKey ? String(r[motivoKey] || '').trim() : ''
    const codigo = codigoKey ? String(r[codigoKey] || '').trim() : ''
    return {
      dni: extractDni(concepto, dniKey ? r[dniKey] : ''),
      periodo: toPeriodo(fechaKey ? r[fechaKey] : ''),
      importe: importeKey ? r[importeKey] : null,
      motivo: [motivoDev, codigo ? `(${codigo})` : ''].filter(Boolean).join(' ') || concepto,
      librado: libradoKey ? String(r[libradoKey] || '').trim() : '',
      referencia: refKey ? String(r[refKey] || '').trim() : '',
    }
  }).filter(f => f.dni || f.referencia)
}

export default function DevolucionesTab({ identity }) {
  const toast = useToast()
  const fileInputRef = useRef(null)
  const [filas, setFilas] = useState([])      // [{invoice_ref, motivo, importe}]
  const [filename, setFilename] = useState('')
  const [processing, setProcessing] = useState(false)
  const [resultado, setResultado] = useState(null)
  // Búsqueda por mes → cliente (por defecto mes actual)
  const [mesBusca, setMesBusca] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const [recibosMes, setRecibosMes] = useState([])    // todos los recibos del mes
  const [loadingRec, setLoadingRec] = useState(false)
  const [clienteQuery, setClienteQuery] = useState('')
  const [clienteSelId, setClienteSelId] = useState(null)
  const [busMotivo, setBusMotivo] = useState('')

  // Cargar recibos del mes al cambiar
  useEffect(() => {
    if (!mesBusca) { setRecibosMes([]); setClienteSelId(null); setClienteQuery(''); return }
    setLoadingRec(true)
    cuotasList(identity, { mes: mesBusca })
      .then(data => setRecibosMes(data || []))
      .catch(e => toast.error(`Error: ${e.message}`))
      .finally(() => setLoadingRec(false))
  }, [mesBusca])

  // Clientes con recibos emitidos (posted) y cobrados (paid) en el mes
  const clientesConRecibos = useMemo(() => {
    const map = new Map()
    for (const r of recibosMes) {
      if (r.state !== 'posted') continue
      // El usuario quiere "emitidos y cobrados" — incluyo paid + in_payment + reversed
      // (un reversed sigue siendo un recibo cobrado-y-luego-devuelto que merece reentrar)
      if (!['paid','in_payment','reversed','partial','not_paid'].includes(r.payment_state)) continue
      const pid = r.partner_id?.id
      if (!pid) continue
      if (!map.has(pid)) {
        map.set(pid, {
          id: pid,
          name: r.partner_id?.name || `#${pid}`,
          recibos: [],
          totalImporte: 0,
          paidCount: 0,
        })
      }
      const c = map.get(pid)
      c.recibos.push(r)
      c.totalImporte += r.amount_total || 0
      if (r.payment_state === 'paid') c.paidCount++
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [recibosMes])

  // Filtro por texto
  const sugerencias = useMemo(() => {
    const q = clienteQuery.trim().toLowerCase()
    if (!q) return clientesConRecibos
    return clientesConRecibos.filter(c => c.name.toLowerCase().includes(q))
  }, [clientesConRecibos, clienteQuery])

  const clienteSel = clientesConRecibos.find(c => c.id === clienteSelId) || null

  function clearCliente() {
    setClienteSelId(null); setClienteQuery('')
  }
  function addReciboFromBusqueda(r) {
    setFilas(prev => [...prev, {
      cliente_idnoofit: String(r.partner_idnoofit || r.cliente_idnoofit || ''),
      periodo: r.periodo || r.mes || mesBusca,
      importe: r.amount_total ?? r.importe_total,
      motivo: busMotivo.trim() || 'Devolución manual',
      librado: r.partner_id?.name || r.cliente_nombre || (clienteSel?.name) || '',
      referencia: r.name || r.account_move_ref || '',
    }])
    toast.success(`${r.name || 'recibo'} añadido`)
  }

  function handleFile(file) {
    if (!file) return
    setFilename(file.name)
    setResultado(null)
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result)
        const wb = XLSX.read(data, { type: 'array' })
        const sheet = wb.Sheets[wb.SheetNames[0]]
        // Intentar parsear con cabeceras
        const json = XLSX.utils.sheet_to_json(sheet, { defval: '' })
        let rows = normalizarFilas(json)
        if (rows.length === 0) {
          // Reintentar sin cabeceras
          const arr = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
          rows = normalizarFilas(arr)
        }
        if (rows.length === 0) {
          toast.error('No se encontraron filas válidas en el archivo')
          return
        }
        setFilas(rows)
        toast.success(`${rows.length} fila${rows.length !== 1 ? 's' : ''} parseada${rows.length !== 1 ? 's' : ''}`)
      } catch (err) {
        toast.error(`Error parseando archivo: ${err.message}`)
      }
    }
    reader.readAsArrayBuffer(file)
  }

  function removeFila(i) {
    setFilas(prev => prev.filter((_, idx) => idx !== i))
  }
  function clearTodo() {
    setFilas([]); setFilename(''); setResultado(null)
  }

  async function procesar() {
    if (filas.length === 0) return
    if (!confirm(`¿Marcar ${filas.length} recibo${filas.length !== 1 ? 's' : ''} como devuelto${filas.length !== 1 ? 's' : ''}?\n\nSe anulará el pago automático y los recibos quedarán pendientes para iniciar el proceso de recobro.`)) return
    setProcessing(true)
    try {
      const r = await procesarDevoluciones(identity, filas)
      setResultado(r)
      const nOk = (r.procesadas || []).length
      const nErr = (r.errores || []).length
      if (nErr === 0) toast.success(`${nOk} devolución${nOk !== 1 ? 'es' : ''} procesada${nOk !== 1 ? 's' : ''}`)
      else toast.warning(`${nOk} OK, ${nErr} error${nErr !== 1 ? 'es' : ''}`)
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setProcessing(false)
  }

  return (
    <div>
      {/* Card upload */}
      <Card style={{ padding: 20, marginBottom: 16 }}>
        <SectionTitle action={
          filas.length > 0 && <Btn variant="secondary" size="sm" onClick={clearTodo}><Trash2 size={12} /> Limpiar</Btn>
        }>
          <Upload size={16} style={{ marginRight: 8 }} /> Cargar devoluciones
        </SectionTitle>

        <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 12 }}>
          Sube un fichero <strong>CSV o Excel</strong> con las devoluciones del banco. Detecta automáticamente columnas:
          <code style={codeStyle}>recibo / referencia / number / EndToEndID</code> y opcionalmente
          <code style={codeStyle}>motivo / razón</code>. Si no hay cabecera, usa la primera columna como referencia.
        </p>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="file" accept=".csv,.xlsx,.xls,.tsv,.ods"
                 ref={fileInputRef}
                 onChange={e => handleFile(e.target.files?.[0])}
                 style={{ display: 'none' }} />
          <Btn variant="primary" onClick={() => fileInputRef.current?.click()}>
            <FileSpreadsheet size={14} /> Elegir fichero
          </Btn>
          {filename && (
            <span style={{ fontSize: 12, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>
              📄 {filename}
            </span>
          )}
        </div>

        {/* Búsqueda por mes → cliente */}
        <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
          <p style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
            o seleccionar por mes y cliente
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: '0 0 160px' }}>
              <label style={labelStyle}>Mes y año del recibo</label>
              <input type="month" value={mesBusca}
                     onChange={e => setMesBusca(e.target.value)}
                     style={inputStyle} />
            </div>
            <div style={{ flex: '2 1 200px' }}>
              <label style={labelStyle}>Motivo a aplicar</label>
              <input value={busMotivo} onChange={e => setBusMotivo(e.target.value)}
                     placeholder="Saldo insuficiente"
                     style={inputStyle} />
            </div>
          </div>

          {/* Selección de cliente */}
          {mesBusca && (
            <div style={{ marginTop: 12 }}>
              {loadingRec ? (
                <div style={{ textAlign: 'center', padding: 20 }}>
                  <Loader2 size={18} className="animate-spin" style={{ color: 'var(--green)' }} />
                </div>
              ) : clientesConRecibos.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--text-3)', textAlign: 'center', padding: 16, margin: 0 }}>
                  No hay clientes con recibos emitidos en {mesBusca}.
                </p>
              ) : !clienteSel ? (
                <>
                  <div style={{ position: 'relative', marginBottom: 8 }}>
                    <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }} />
                    <input value={clienteQuery}
                           onChange={e => setClienteQuery(e.target.value)}
                           placeholder={`Buscar entre ${clientesConRecibos.length} cliente${clientesConRecibos.length !== 1 ? 's' : ''} con recibos en ${mesBusca}…`}
                           style={{ ...inputStyle, paddingLeft: 30 }} />
                  </div>
                  <div style={{
                    border: '1px solid var(--line)', borderRadius: 8, background: 'var(--bg-2)',
                    maxHeight: 280, overflowY: 'auto',
                  }}>
                    {sugerencias.length === 0 ? (
                      <p style={{ fontSize: 12, color: 'var(--text-3)', padding: 16, textAlign: 'center', margin: 0 }}>
                        Ningún cliente coincide con "{clienteQuery}"
                      </p>
                    ) : sugerencias.map(c => (
                      <button key={c.id} onClick={() => setClienteSelId(c.id)} style={{
                        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                        padding: '10px 12px', background: 'none', border: 'none',
                        borderBottom: '1px solid var(--line)', cursor: 'pointer', textAlign: 'left',
                      }}>
                        <User size={16} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>
                            {c.name}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                            {c.recibos.length} recibo{c.recibos.length !== 1 ? 's' : ''} · {c.totalImporte.toFixed(2)} €
                            {c.paidCount > 0 && <> · <span style={{ color: 'var(--green)' }}>{c.paidCount} cobrado{c.paidCount !== 1 ? 's' : ''}</span></>}
                          </div>
                        </div>
                        <Plus size={14} style={{ color: 'var(--green)', flexShrink: 0 }} />
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                /* Cliente seleccionado: mostrar recibos */
                <div style={{ padding: 10, background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <User size={18} style={{ color: 'var(--green)' }} />
                      <strong style={{ color: 'var(--text-0)', fontSize: 14 }}>{clienteSel.name}</strong>
                      <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                        {clienteSel.recibos.length} recibo{clienteSel.recibos.length !== 1 ? 's' : ''} en {mesBusca}
                      </span>
                    </div>
                    <Btn size="sm" variant="secondary" onClick={clearCliente}>
                      <X size={12} /> Cambiar cliente
                    </Btn>
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--line)', textAlign: 'left' }}>
                        <Th>Recibo</Th>
                        <Th>Cuota</Th>
                        <Th>Importe</Th>
                        <Th>Forma pago</Th>
                        <Th>Estado</Th>
                        <Th></Th>
                      </tr>
                    </thead>
                    <tbody>
                      {clienteSel.recibos.map(r => {
                        const yaAñadido = filas.some(f => f.referencia === r.name)
                        const isPaid = r.payment_state === 'paid'
                        const stateColor = isPaid ? 'green'
                          : r.payment_state === 'reversed' ? 'red'
                          : r.payment_state === 'in_payment' ? 'blue' : 'yellow'
                        const stateLabel = isPaid ? 'Cobrado'
                          : r.payment_state === 'reversed' ? 'Devuelto'
                          : r.payment_state === 'in_payment' ? 'En cobro' : 'Pendiente'
                        return (
                          <tr key={r.id}>
                            <Td mono style={{ fontWeight: 600 }}>{r.name}</Td>
                            <Td>{r.cuota_codigo || '—'}</Td>
                            <Td mono>{r.amount_total?.toFixed(2)} €</Td>
                            <Td>{r.forma_pago || '—'}</Td>
                            <Td><Badge color={stateColor}>{stateLabel}</Badge></Td>
                            <Td>
                              <Btn size="sm" variant={yaAñadido ? 'ghost' : 'secondary'}
                                   onClick={() => !yaAñadido && addReciboFromBusqueda(r)}>
                                {yaAñadido ? <><CheckCircle2 size={11} /> Añadido</> : <><Plus size={11} /> Añadir</>}
                              </Btn>
                            </Td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </Card>

      {/* Filas a procesar */}
      {filas.length > 0 && (
        <Card style={{ padding: 20, marginBottom: 16 }}>
          <SectionTitle action={
            <Btn variant="primary" onClick={procesar} disabled={processing}>
              {processing ? <><Loader2 size={14} className="animate-spin" /> Procesando…</> : <><Send size={14} /> Procesar {filas.length} devolución{filas.length !== 1 ? 'es' : ''}</>}
            </Btn>
          }>
            Filas a procesar ({filas.length})
          </SectionTitle>
          <div style={{ width: '100%', marginTop: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line)', textAlign: 'left' }}>
                  <Th>#</Th>
                  <Th>Cliente</Th>
                  <Th>DNI</Th>
                  <Th>Periodo</Th>
                  <Th>Importe</Th>
                  <Th>Motivo</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f, i) => (
                  <tr key={i}>
                    <Td style={{ color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>{i + 1}</Td>
                    <Td title={f.referencia}>{f.librado || '—'}</Td>
                    <Td mono>{f.dni || '—'}</Td>
                    <Td mono style={{ color: f.periodo ? 'inherit' : 'var(--red)' }}>{f.periodo || '⚠ sin fecha'}</Td>
                    <Td mono>{f.importe ? `${parseFloat(f.importe).toFixed(2)} €` : '—'}</Td>
                    <Td title={f.motivo}>{f.motivo || '—'}</Td>
                    <Td>
                      <Btn size="sm" variant="secondary" onClick={() => removeFila(i)}>
                        <X size={12} />
                      </Btn>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Resultado */}
      {resultado && (
        <Card style={{ padding: 20 }}>
          <SectionTitle>Resultado</SectionTitle>
          <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
            <Badge color="green">
              <CheckCircle2 size={12} /> {(resultado.procesadas || []).length} procesadas
            </Badge>
            {(resultado.errores || []).length > 0 && (
              <Badge color="red">
                <AlertTriangle size={12} /> {resultado.errores.length} errores
              </Badge>
            )}
          </div>

          {(resultado.procesadas || []).length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <h4 style={{ fontSize: 12, color: 'var(--green)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Procesadas</h4>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--line)', textAlign: 'left' }}>
                    <Th>Referencia</Th>
                    <Th>Cliente</Th>
                    <Th>Importe</Th>
                    <Th>Motivo</Th>
                    <Th>Pagos anulados</Th>
                  </tr>
                </thead>
                <tbody>
                  {resultado.procesadas.map((p, i) => (
                    <tr key={i}>
                      <Td mono>{p.referencia || '—'}</Td>
                      <Td title={p.partner}>{p.partner || '—'}{p.ya_devuelto ? ' (ya devuelto)' : ''}</Td>
                      <Td mono>{p.importe ? `${p.importe.toFixed(2)} €` : '—'}</Td>
                      <Td title={p.motivo}>{p.motivo || '—'}</Td>
                      <Td mono>{p.pagos_anulados ?? '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {(resultado.errores || []).length > 0 && (
            <div>
              <h4 style={{ fontSize: 12, color: 'var(--red)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Errores</h4>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--line)', textAlign: 'left' }}>
                    <Th>Cliente / Ref</Th>
                    <Th>Error</Th>
                  </tr>
                </thead>
                <tbody>
                  {resultado.errores.map((e, i) => (
                    <tr key={i}>
                      <Td title={e.referencia}>{e.librado || e.referencia || '—'}</Td>
                      <Td wrap title={e.error}>{e.error}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}

const codeStyle = {
  background: 'var(--bg-3)', padding: '1px 6px', borderRadius: 4,
  fontFamily: 'var(--font-mono)', fontSize: 11, marginLeft: 4,
}
const inputStyle = {
  padding: '8px 10px', borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--line)', background: 'var(--bg-1)',
  color: 'var(--text-0)', fontSize: 13, width: '100%',
}
const labelStyle = {
  fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase',
  letterSpacing: '0.05em', display: 'block', marginBottom: 4,
}

function Th({ children }) {
  return <th style={{
    padding: '8px 8px', fontSize: 10, fontWeight: 600, color: 'var(--text-3)',
    textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap',
  }}>{children}</th>
}
function Td({ children, mono, style, wrap, title }) {
  const tip = title ?? (typeof children === 'string' ? children : undefined)
  return <td title={tip} style={{
    padding: '8px 8px', borderBottom: '1px solid var(--line)',
    fontFamily: mono ? 'var(--font-mono)' : 'inherit',
    color: 'var(--text-1)',
    whiteSpace: wrap ? 'normal' : 'nowrap',
    overflow: wrap ? 'visible' : 'hidden',
    textOverflow: wrap ? 'clip' : 'ellipsis',
    wordBreak: wrap ? 'break-word' : 'normal',
    verticalAlign: 'top',
    ...(style || {}),
  }}>{children}</td>
}
