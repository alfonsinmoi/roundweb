import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, Archive, Loader2, Send, X, CheckCircle2 } from 'lucide-react'
import { Badge, Avatar, Btn } from '../../components/UI'
import { getClientes, getERPConfiguracion, getERPDatosCliente, postERPDatosCliente } from '../../utils/api'

// ── IBAN / DNI validators (same as NooFitPro) ────────────────────────────────

function validarIBAN(input) {
  const iban = input.replace(/[\s-]/g, '').toUpperCase()
  if (iban.length < 15 || iban.length > 34 || !/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) return false
  const reord = iban.slice(4) + iban.slice(0, 4)
  let num = ''
  for (const c of reord) num += /[A-Z]/.test(c) ? (c.charCodeAt(0) - 55).toString() : c
  let rem = 0
  for (const c of num) rem = (rem * 10 + Number(c)) % 97
  return rem === 1
}

function validarDNI(input) {
  const dni = input.trim().toUpperCase().replace(/[-. ]/g, '')
  if (dni.length < 8) return false
  const letras = 'TRWAGMYFPDXBNJZSQVHLCKE'
  if (/^\d{8}[A-Z]$/.test(dni)) return dni[8] === letras[parseInt(dni.slice(0, 8)) % 23]
  if (/^[XYZ]\d{7}[A-Z]$/.test(dni)) {
    const n = ({ X: '0', Y: '1', Z: '2' }[dni[0]] ?? '') + dni.slice(1, 8)
    return dni[8] === letras[parseInt(n) % 23]
  }
  if (/^[ABCDEFGHJKLMNPQRSUVW]\d{8}$/.test(dni)) return true
  return false
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function ClientList() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [filtro, setFiltro] = useState('activos')
  const [clientes, setClientes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // ERP
  const [erpConfig, setErpConfig] = useState(null) // null = not loaded, false = no ERP
  const [erpCliente, setErpCliente] = useState(null) // client being edited
  const [erpForm, setErpForm] = useState({})
  const [erpSaving, setErpSaving] = useState(false)
  const [erpLoading, setErpLoading] = useState(false)
  const [erpError, setErpError] = useState('')
  const [visibleCount, setVisibleCount] = useState(50)

  useEffect(() => {
    Promise.all([
      getClientes(),
      getERPConfiguracion().then(erp => {
        console.log('[ERP] configuracion response:', erp)
        return erp
      }).catch(err => { console.warn('[ERP] configuracion error:', err.message); return null }),
    ]).then(([cli, erp]) => {
      setClientes(cli)
      // Support both { campos: [...] } and { nombre: ..., campos: [...] }
      const campos = erp?.campos ?? []
      setErpConfig(campos.length > 0 ? { ...erp, campos } : false)
    }).catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const tieneERP = erpConfig && erpConfig.campos?.length > 0

  const filtered = clientes.filter(c => {
    const q = search.toLowerCase()
    const match = `${c.name} ${c.surname} ${c.email}`.toLowerCase().includes(q)
    if (!match) return false
    if (filtro === 'activos') return c.enabled !== false
    if (filtro === 'archivados') return c.enabled === false
    return true
  })

  // ── ERP Modal ──────────────────────────────────────────────────────────────

  const openERP = async (cliente, e) => {
    e.stopPropagation()
    setErpCliente(cliente)
    setErpError('')
    setErpLoading(true)

    try {
      const datos = await getERPDatosCliente(cliente.id).catch(() => null)
      const form = {}
      for (const campo of erpConfig.campos.sort((a, b) => a.orden - b.orden)) {
        const existing = datos?.campos?.[campo.nombreCampo]
        if (campo.nombreCampo.startsWith('datetime')) {
          let val = ''
          if (existing != null) {
            if (typeof existing === 'number') val = new Date(existing).toISOString().slice(0, campo.formato === 'date' ? 10 : 16)
            else val = String(existing)
          }
          form[campo.nombreCampo] = val
        } else if (campo.nombreCampo.startsWith('bool')) {
          form[campo.nombreCampo] = existing === true || existing === 1 || String(existing).toLowerCase() === 'true'
        } else {
          form[campo.nombreCampo] = existing != null ? String(existing) : (campo.valorPorDefecto ?? '')
        }
      }
      setErpForm(form)
    } catch {
      setErpError('Error cargando datos ERP')
    }
    setErpLoading(false)
  }

  const validateERP = () => {
    for (const campo of erpConfig.campos) {
      const val = erpForm[campo.nombreCampo]
      const isEmpty = val === '' || val == null

      if (campo.obligatorio && !campo.nombreCampo.startsWith('bool') && !campo.nombreCampo.startsWith('datetime') && isEmpty)
        return `${campo.nombreAMostrar} es obligatorio`

      if (isEmpty) continue

      if (campo.nombreCampo.startsWith('int') && !/^-?\d+$/.test(String(val).trim()))
        return `${campo.nombreAMostrar} debe ser un número entero`

      if (campo.nombreCampo.startsWith('double') && isNaN(Number(String(val).replace(',', '.'))))
        return `${campo.nombreAMostrar} debe ser un número válido`

      if (campo.formato === 'IBAN' && !validarIBAN(String(val)))
        return `${campo.nombreAMostrar} no es un IBAN válido`

      if (campo.formato === 'dni' && !validarDNI(String(val)))
        return `${campo.nombreAMostrar} no es un DNI/NIF válido`

      if (campo.formato === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(val).trim()))
        return `${campo.nombreAMostrar} no es un email válido`

      if (campo.formato === 'phone' && !/^\+?\d{6,15}$/.test(String(val).trim().replace(/[\s-]/g, '')))
        return `${campo.nombreAMostrar} no es un teléfono válido`
    }
    return null
  }

  const saveERP = async () => {
    const err = validateERP()
    if (err) { setErpError(err); return }

    setErpSaving(true)
    setErpError('')
    try {
      const campos = {}
      for (const campo of erpConfig.campos) {
        const val = erpForm[campo.nombreCampo]
        if (campo.nombreCampo.startsWith('bool')) {
          campos[campo.nombreCampo] = !!val
        } else if (campo.nombreCampo.startsWith('datetime')) {
          if (val) campos[campo.nombreCampo] = val
        } else if (campo.nombreCampo.startsWith('double')) {
          if (val !== '' && val != null) campos[campo.nombreCampo] = Number(String(val).replace(',', '.'))
        } else if (campo.nombreCampo.startsWith('int')) {
          if (val !== '' && val != null) campos[campo.nombreCampo] = parseInt(val)
        } else {
          if (val !== '' && val != null) campos[campo.nombreCampo] = String(val).trim()
        }
      }

      await postERPDatosCliente(erpCliente.id, campos)
      alert('Datos ERP guardados correctamente')
      setErpCliente(null)
    } catch (err) {
      setErpError('Error al guardar: ' + err.message)
    }
    setErpSaving(false)
  }

  // ── Render ─────────────────────────────────────────────────────────────────

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
        <div style={{ position: 'relative', flex: 1, minWidth: 280 }}>
          <Search size={18} style={{ position: 'absolute', left: 18, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }} />
          <input type="search" placeholder="Buscar cliente..." value={search}
                 onChange={e => setSearch(e.target.value)}
                 style={{ width: '100%', padding: '16px 20px 16px 50px', borderRadius: 16, fontSize: 15, background: 'var(--bg-2)', border: '1px solid var(--line)', color: 'var(--text-0)', outline: 'none', transition: 'border-color 0.15s' }}
                 onFocus={e => e.target.style.borderColor = 'var(--green)'}
                 onBlur={e => e.target.style.borderColor = 'var(--line)'} />
        </div>

        <div style={{ display: 'flex', borderRadius: 14, overflow: 'hidden', border: '1px solid var(--line)' }}>
          {[['activos','Activos'],['archivados','Archivados'],['todos','Todos']].map(([v, l]) => (
            <button key={v} onClick={() => setFiltro(v)}
                    style={{ padding: '14px 22px', fontSize: 14, fontWeight: 500, cursor: 'pointer', border: 'none', background: filtro === v ? 'var(--green-bg)' : 'var(--bg-2)', color: filtro === v ? 'var(--green)' : 'var(--text-2)', transition: 'all 0.1s' }}>
              {l}
            </button>
          ))}
        </div>

        <Btn size="lg" onClick={() => navigate('/clientes/nuevo')}>
          <Plus size={18} /> Nuevo cliente
        </Btn>
      </div>

      <p style={{ fontSize: 14, color: 'var(--text-3)', marginBottom: 24 }}>
        {filtered.length} cliente{filtered.length !== 1 ? 's' : ''}
      </p>

      {/* Client grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 16 }}>
        {filtered.slice(0, visibleCount).map(c => (
          <div key={c.id}
               onClick={() => navigate(`/clientes/${c.id}`)}
               style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 20, padding: 28, cursor: 'pointer', transition: 'background 0.12s' }}
               onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-3)'}
               onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-2)'}>

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

            <div style={{ borderTop: '1px solid var(--line)', paddingTop: 16 }}>
              {c.objective && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16, marginBottom: 10 }}>
                  <span style={{ fontSize: 13, color: 'var(--text-3)', flexShrink: 0 }}>Objetivo</span>
                  <span style={{ fontSize: 13, color: 'var(--text-1)', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.objective}</span>
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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ fontSize: 13, color: 'var(--text-3)' }}>ID Espejo</span>
                  <span style={{ fontSize: 13, color: 'var(--text-2)', fontFamily: 'monospace' }}>{c.idEspejo}</span>
                </div>
              )}
              {!c.objective && !c.cellPhone && !c.dni && c.idEspejo == null && (
                <p style={{ fontSize: 13, color: 'var(--text-3)' }}>Sin datos adicionales</p>
              )}
            </div>

            {/* ERP button */}
            {tieneERP && (
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
                <button onClick={(e) => openERP(c, e)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                          padding: '12px 18px', borderRadius: 12, fontSize: 13, fontWeight: 500,
                          cursor: 'pointer', border: '1px solid var(--blue-border)',
                          background: 'var(--blue-bg)', color: 'var(--blue)', transition: 'all 0.1s',
                          justifyContent: 'center',
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(91,156,246,0.12)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'var(--blue-bg)'}>
                  <Send size={14} /> Enviar ERP
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {visibleCount < filtered.length && (
        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <button onClick={() => setVisibleCount(v => v + 50)}
                  style={{ padding: '14px 32px', borderRadius: 14, fontSize: 14, fontWeight: 500, cursor: 'pointer', background: 'var(--bg-2)', border: '1px solid var(--line)', color: 'var(--text-2)', transition: 'all 0.1s' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-3)'; e.currentTarget.style.color = 'var(--text-0)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-2)'; e.currentTarget.style.color = 'var(--text-2)' }}>
            Cargar más ({filtered.length - visibleCount} restantes)
          </button>
        </div>
      )}

      {filtered.length === 0 && (
        <div style={{ padding: '80px 0', textAlign: 'center', fontSize: 15, color: 'var(--text-3)' }}>
          No se encontraron clientes
        </div>
      )}

      {/* ── ERP Modal ─────────────────────────────────────────────────────── */}
      {erpCliente && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', overflowY: 'auto', padding: '40px 20px' }}
             onClick={e => { if (e.target === e.currentTarget && !erpSaving) setErpCliente(null) }}>
          <div style={{ width: '100%', maxWidth: 720, background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 24, display: 'flex', flexDirection: 'column' }}>

            {/* Header — fixed */}
            <div style={{ padding: '24px 32px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <div>
                <h3 style={{ fontFamily: 'Outfit', fontSize: 20, fontWeight: 600, color: 'var(--text-0)' }}>
                  Enviar ERP
                </h3>
                <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>
                  {erpCliente.name} {erpCliente.surname}
                </p>
              </div>
              <button onClick={() => { if (!erpSaving) setErpCliente(null) }}
                      style={{ padding: 10, borderRadius: 12, cursor: 'pointer', background: 'var(--bg-3)', border: '1px solid var(--line)', color: 'var(--text-3)', transition: 'color 0.1s' }}
                      onMouseEnter={e => e.currentTarget.style.color = 'var(--text-0)'}
                      onMouseLeave={e => e.currentTarget.style.color = 'var(--text-3)'}>
                <X size={18} />
              </button>
            </div>

            {/* Form — 2 columns */}
            <div style={{ padding: '28px 32px' }}>
              {erpLoading ? (
                <div style={{ padding: 40, textAlign: 'center' }}>
                  <Loader2 size={20} className="animate-spin" style={{ color: 'var(--green)' }} />
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px 24px' }}>
                  {erpConfig.campos.sort((a, b) => a.orden - b.orden).map(campo => {
                    const key = campo.nombreCampo
                    const isDate = key.startsWith('datetime')
                    const isBool = key.startsWith('bool')
                    const isNum = key.startsWith('double') || key.startsWith('int')
                    const inputStyle = { width: '100%', padding: '12px 16px', borderRadius: 12, fontSize: 14, background: 'var(--bg-1)', border: '1px solid var(--line)', color: 'var(--text-0)', outline: 'none', transition: 'border-color 0.15s' }

                    return (
                      <div key={key}>
                        <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-2)', marginBottom: 6 }}>
                          {campo.nombreAMostrar}
                          {campo.obligatorio && <span style={{ color: 'var(--red)', marginLeft: 3 }}>*</span>}
                          {campo.formato && campo.formato !== campo.nombreAMostrar && (
                            <span style={{ color: 'var(--text-3)', fontWeight: 400, marginLeft: 4, fontSize: 11 }}>({campo.formato})</span>
                          )}
                        </label>

                        {isBool ? (
                          <button onClick={() => setErpForm(f => ({ ...f, [key]: !f[key] }))}
                                  style={{
                                    padding: '10px 20px', borderRadius: 12, fontSize: 13, fontWeight: 500, cursor: 'pointer',
                                    background: erpForm[key] ? 'rgba(45,212,168,0.1)' : 'var(--bg-3)',
                                    color: erpForm[key] ? 'var(--green)' : 'var(--text-3)',
                                    border: `1px solid ${erpForm[key] ? 'rgba(45,212,168,0.3)' : 'var(--line)'}`,
                                  }}>
                            {erpForm[key] ? 'Sí' : 'No'}
                          </button>
                        ) : isDate ? (
                          <input type={campo.formato === 'time' ? 'time' : campo.formato === 'date' ? 'date' : 'datetime-local'}
                                 value={erpForm[key] ?? ''}
                                 onChange={e => setErpForm(f => ({ ...f, [key]: e.target.value }))}
                                 style={inputStyle}
                                 onFocus={e => e.target.style.borderColor = 'var(--green)'}
                                 onBlur={e => e.target.style.borderColor = 'var(--line)'} />
                        ) : (
                          <input type={isNum ? 'text' : campo.formato === 'email' ? 'email' : campo.formato === 'phone' ? 'tel' : 'text'}
                                 inputMode={isNum ? 'decimal' : undefined}
                                 value={erpForm[key] ?? ''}
                                 onChange={e => setErpForm(f => ({ ...f, [key]: e.target.value }))}
                                 placeholder={campo.formato === 'IBAN' ? 'ES00 0000 0000 00...' : campo.formato === 'dni' ? '12345678Z' : ''}
                                 style={inputStyle}
                                 onFocus={e => e.target.style.borderColor = 'var(--green)'}
                                 onBlur={e => e.target.style.borderColor = 'var(--line)'} />
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Footer — fixed */}
            <div style={{ padding: '20px 32px', borderTop: '1px solid var(--line)', flexShrink: 0 }}>
              {erpError && (
                <div style={{ padding: '12px 16px', borderRadius: 12, marginBottom: 16, fontSize: 13, color: 'var(--red)', background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.12)' }}>
                  {erpError}
                </div>
              )}
              <div style={{ display: 'flex', gap: 10 }}>
                <Btn variant="primary" size="md" onClick={saveERP} disabled={erpSaving} style={{ flex: 1, justifyContent: 'center' }}>
                  {erpSaving ? <><Loader2 size={15} className="animate-spin" /> Guardando...</> : <><CheckCircle2 size={15} /> Guardar ERP</>}
                </Btn>
                <Btn variant="secondary" size="md" onClick={() => { if (!erpSaving) setErpCliente(null) }}>
                  Cancelar
                </Btn>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
