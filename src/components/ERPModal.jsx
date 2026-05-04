import { useState, useEffect, useMemo } from 'react'
import { Loader2, CheckCircle2 } from 'lucide-react'
import { Btn } from './UI'
import Modal from './Modal'
import { useToast } from './Toast'
import { useAuth } from '../contexts/AuthContext'
import { getERPDatosCliente, postERPDatosCliente } from '../utils/api'
import { validarIBAN, validarDNI, validarEmail, validarTelefono } from '../utils/validators'
import { getRoundIdentity, cuotasList as cfgCuotasList, descuentosList } from '../utils/configApi'
import { altaCliente } from '../utils/cuotasApi'

// Selectores fijos para los nuevos campos Odoo
const PERIODICIDAD_OPTS = [
  { value: 'mensual',    label: 'Mensual' },
  { value: 'bimensual',  label: 'Bimensual' },
  { value: 'trimestral', label: 'Trimestral' },
  { value: 'semestral',  label: 'Semestral' },
  { value: 'anual',      label: 'Anual' },
]
const FORMA_PAGO_RECURRENTE_OPTS = [
  { value: 'sepa',          label: 'SEPA (domiciliación)' },
  { value: 'tarjeta_token', label: 'Tarjeta tokenizada' },
  { value: 'enlace_pago',   label: 'Enlace de pago / efectivo' },
  { value: 'efectivo',      label: 'Efectivo' },
]
const FORMA_PAGO_ALTA_OPTS = [
  { value: 'efectivo',    label: 'Efectivo (caja)' },
  { value: 'tpv_fisico',  label: 'TPV físico' },
  { value: 'enlace_pago', label: 'Enlace de pago (PayComet)' },
  { value: 'aplazar',     label: 'Aplazar (modificación próximo recibo)' },
]

// Devuelve un array de opciones (o null si no es un campo dropdown) según el label.
// Acepta variantes habituales del manager: "Tipo de pago", "Forma de la primera cuota",
// "Periodo de pago", etc.
function dropdownOptionsFor(nombreAMostrar, cuotas, descuentos) {
  const n = (nombreAMostrar || '').toLowerCase()

  // Forma de pago del ALTA (primera cuota / pago inicial / matrícula)
  if (/forma\s*(de\s*)?(pago\s*)?alta/.test(n))                          return FORMA_PAGO_ALTA_OPTS
  if (/(primera\s*cuota|forma.*primera|pago\s*inicial|forma\s*alta)/.test(n)) return FORMA_PAGO_ALTA_OPTS

  // Forma de pago RECURRENTE (cuotas mensuales/sucesivas)
  if (/forma\s*(de\s*)?pago\s*recurrente/.test(n))                       return FORMA_PAGO_RECURRENTE_OPTS
  if (/tipo\s*de\s*pago|forma\s*recurrente|forma\s*sucesiva/.test(n))    return FORMA_PAGO_RECURRENTE_OPTS

  // Periodicidad / periodo de pago / frecuencia
  if (/periodicidad|periodo\s*(de\s*)?pago|frecuencia/.test(n))          return PERIODICIDAD_OPTS

  // Descuento (lista del catálogo)
  if (/descuento/.test(n))                                               return descuentos

  // Cuota (catálogo de cuotas) — solo si NO incluye "forma" o "primera" o "tipo de pago"
  if (/cuota/.test(n) && !/forma|primera|tipo\s*de\s*pago/.test(n))      return cuotas

  return null
}

export default function ERPModal({ cliente, erpConfig, onClose, onSaved, recaptacion = false }) {
  const toast = useToast()
  const { user } = useAuth()
  const identity = useMemo(() => getRoundIdentity(user), [user])
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // Catálogos cargados del VPS para dropdowns
  const [cuotas, setCuotas] = useState([])
  const [descuentos, setDescuentos] = useState([])

  const campos = erpConfig?.campos ?? []

  // Cargar cuotas + descuentos del manager para dropdowns
  useEffect(() => {
    if (!identity?.managerId) return
    cfgCuotasList(identity).then(arr => setCuotas(
      (arr || []).map(c => ({ value: c.codigo, label: `${c.codigo} — ${c.descripcion || ''}`.trim() }))
    )).catch(() => setCuotas([]))
    descuentosList(identity).then(arr => setDescuentos(
      (arr || []).map(d => ({ value: d.codigo, label: `${d.codigo} — ${d.descripcion || ''}`.trim() }))
    )).catch(() => setDescuentos([]))
  }, [identity?.managerId, identity?.trainerId])

  useEffect(() => {
    if (!cliente || campos.length === 0) return
    setLoading(true)
    setError('')

    getERPDatosCliente(cliente.id).catch(() => null).then(datos => {
      const f = {}
      for (const campo of [...campos].sort((a, b) => a.orden - b.orden)) {
        const existing = datos?.campos?.[campo.nombreCampo]
        if (campo.nombreCampo.startsWith('datetime')) {
          const isOnlyDate = campo.formato === 'date' || campo.formato === 'fecha'
          let val = ''
          if (existing != null) {
            if (typeof existing === 'number') val = new Date(existing).toISOString().slice(0, isOnlyDate ? 10 : 16)
            else val = String(existing).slice(0, isOnlyDate ? 10 : 16)
          }
          f[campo.nombreCampo] = val
        } else if (campo.nombreCampo.startsWith('bool')) {
          f[campo.nombreCampo] = existing === true || existing === 1 || String(existing).toLowerCase() === 'true'
        } else {
          f[campo.nombreCampo] = existing != null ? String(existing) : (campo.valorPorDefecto ?? '')
        }
      }
      setForm(f)
      setLoading(false)
    })
  }, [cliente, erpConfig])

  const validate = () => {
    for (const campo of campos) {
      const val = form[campo.nombreCampo]
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
      if (campo.formato === 'email' && !validarEmail(String(val)))
        return `${campo.nombreAMostrar} no es un email válido`
      if (campo.formato === 'phone' && !validarTelefono(String(val)))
        return `${campo.nombreAMostrar} no es un teléfono válido`
    }
    return null
  }

  const handleSave = async () => {
    const err = validate()
    if (err) { setError(err); return }

    setSaving(true)
    setError('')
    try {
      const data = {}
      for (const campo of campos) {
        const val = form[campo.nombreCampo]
        if (campo.nombreCampo.startsWith('bool')) data[campo.nombreCampo] = !!val
        else if (campo.nombreCampo.startsWith('datetime')) {
          if (val !== '' && val != null) {
            // Wiems espera string ISO, no timestamp en ms.
            let v = val
            if (typeof v === 'number') v = new Date(v).toISOString().slice(0, campo.formato === 'date' ? 10 : 16)
            data[campo.nombreCampo] = String(v)
          }
        }
        else if (campo.nombreCampo.startsWith('double')) { if (val !== '' && val != null) data[campo.nombreCampo] = Number(String(val).replace(',', '.')) }
        else if (campo.nombreCampo.startsWith('int')) { if (val !== '' && val != null) data[campo.nombreCampo] = parseInt(val) }
        else { if (val !== '' && val != null) data[campo.nombreCampo] = String(val).trim() }
      }
      // 1) Guardar en Wiems (legacy ERP, mantener para compatibilidad)
      try {
        await postERPDatosCliente(cliente.id, data)
      } catch (e) {
        console.warn('save legacy ERP wiems:', e?.message)
      }

      // 2) Mapear los campos a la estructura Odoo y crear alta-cliente
      // Búsqueda flexible: matchea cualquier campo cuya nombreAMostrar contenga
      // alguno de los keywords proporcionados (case-insensitive).
      const findByLabel = (...keywords) => {
        const c = campos.find(c => {
          const n = (c.nombreAMostrar || '').toLowerCase()
          return keywords.some(k => n.includes(k.toLowerCase()))
        })
        return c ? data[c.nombreCampo] : undefined
      }
      // Versión más estricta: matchea solo si TODAS las palabras clave aparecen
      const findAll = (...keywords) => {
        const c = campos.find(c => {
          const n = (c.nombreAMostrar || '').toLowerCase()
          return keywords.every(k => n.includes(k.toLowerCase()))
        })
        return c ? data[c.nombreCampo] : undefined
      }
      // Cuota recurrente (catálogo): la cuota mensual, sin "forma" ni "primera" ni "tipo de pago"
      const cuotaCodigo = (() => {
        const c = campos.find(c => {
          const n = (c.nombreAMostrar || '').toLowerCase()
          return /cuota/.test(n) && !/forma|primera|tipo\s*de\s*pago/.test(n)
        })
        return c ? data[c.nombreCampo] : undefined
      })()
      const altaPayload = {
        cliente: {
          idnoofit: String(cliente.id),
          nombre: cliente.nombre || cliente.name || '',
          apellidos: cliente.apellidos || cliente.surname || '',
          email: cliente.email || '',
          movil: findByLabel('móvil', 'movil', 'teléfono', 'telefono') || cliente.cellPhone || '',
          dni: findByLabel('dni', 'nif', 'documento') || cliente.dni || '',
          direccion: findByLabel('dirección', 'direccion') || '',
          localidad: findByLabel('localidad', 'ciudad', 'población') || '',
          cp: findByLabel('postal', 'cp ', 'código postal') || '',
          fecha_nacimiento: cliente.birthdate || '',
          iban: findByLabel('iban', 'cuenta bancaria') || '',
        },
        suscripcion: {
          cuota_codigo: cuotaCodigo,
          periodicidad: findByLabel('periodicidad', 'periodo de pago', 'frecuencia'),
          forma_pago_recurrente: findByLabel('forma de pago recurrente', 'tipo de pago', 'forma recurrente'),
          fecha_alta: findByLabel('fecha de alta', 'fecha alta'),
          descuento_codigo: findByLabel('descuento', 'tipo de descuento') || null,
        },
        alta: {
          forma_pago_alta: findByLabel('forma de pago alta', 'forma de la primera cuota', 'pago inicial'),
          importe_alta: parseFloat(
            findByLabel('importe alta', 'importe inicial',
                        'precio del curso', 'precio mensual', 'precio')
            || 0
          ),
          matricula: parseFloat(findByLabel('matrícula', 'matricula') || 0),
          recaptacion: !!recaptacion,
        },
      }
      try {
        const r = await altaCliente(identity, altaPayload)
        if (r?.ok) {
          let msg = `Alta creada en Odoo (recibo #${r.invoice_id}, importe ${altaPayload.alta.importe_alta} €).`
          if (r.pago?.paid)                  msg += ' Pago registrado.'
          if (r.pago?.modificacion_proximo_mes) msg += ' Cargo aplazado al próximo recibo.'
          if (r.pago?.warning)               msg += ' ⚠ ' + r.pago.warning
          if (r.pago?.error_pago)            msg += ' ⚠ Error pago: ' + r.pago.error_pago
          if (r.cliente_reactivado_noofit)   msg += ' Cliente reactivado en NoofitPro.'
          toast.success(msg)
          // Avisar al padre para que refresque la lista (estado cliente, etc.)
          if (typeof onSaved === 'function') {
            try { await onSaved() } catch {}
          }
        } else {
          toast.warning('ERP guardado, alta Odoo: ' + (r?.error || 'desconocido'))
        }
      } catch (e) {
        toast.error('Alta Odoo falló: ' + e.message)
        setError('Datos ERP guardados, pero alta en Odoo falló: ' + e.message)
        setSaving(false)
        return
      }

      onClose()
    } catch (err) {
      setError('Error al guardar los datos ERP')
      toast.error('Error al guardar los datos ERP')
    }
    setSaving(false)
  }

  return (
    <Modal open={!!cliente} onClose={onClose} disabled={saving}
           title="Enviar ERP" subtitle={cliente ? `${cliente.name} ${cliente.surname}` : ''}>
      {/* Form — scrollea internamente si es largo */}
      <div style={{ padding: '28px 32px', flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center' }} role="status" aria-label="Cargando datos ERP">
            <Loader2 size={20} className="animate-spin" style={{ color: 'var(--green)' }} aria-hidden="true" />
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px 24px' }}>
            {campos.sort((a, b) => a.orden - b.orden).map(campo => {
              const key = campo.nombreCampo
              const isDate = key.startsWith('datetime')
              const isBool = key.startsWith('bool')
              const isNum = key.startsWith('double') || key.startsWith('int')
              const inputStyle = {
                width: '100%', padding: '12px 16px', borderRadius: 12, fontSize: 14,
                background: 'var(--bg-1)', border: '1px solid var(--line)',
                color: 'var(--text-0)', outline: 'none', transition: 'border-color 0.15s',
              }

              return (
                <div key={key}>
                  <label htmlFor={`erp-${key}`} style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-2)', marginBottom: 6 }}>
                    {campo.nombreAMostrar}
                    {campo.obligatorio && <span style={{ color: 'var(--red)', marginLeft: 3 }} aria-label="obligatorio">*</span>}
                    {campo.formato && campo.formato !== campo.nombreAMostrar && (
                      <span style={{ color: 'var(--text-3)', fontWeight: 400, marginLeft: 4, fontSize: 11 }}>({campo.formato})</span>
                    )}
                  </label>

                  {isBool ? (
                    <button id={`erp-${key}`} type="button" aria-invalid={error && error.includes(campo.nombreAMostrar) ? 'true' : undefined}
                            onClick={() => setForm(f => ({ ...f, [key]: !f[key] }))}
                            aria-pressed={!!form[key]}
                            style={{
                              padding: '10px 20px', borderRadius: 12, fontSize: 13, fontWeight: 500, cursor: 'pointer',
                              background: form[key] ? 'rgba(45,212,168,0.1)' : 'var(--bg-3)',
                              color: form[key] ? 'var(--green)' : 'var(--text-3)',
                              border: `1px solid ${form[key] ? 'rgba(45,212,168,0.3)' : 'var(--line)'}`,
                            }}>
                      {form[key] ? 'Sí' : 'No'}
                    </button>
                  ) : isDate ? (
                    <input id={`erp-${key}`}
                           type={campo.formato === 'time' ? 'time' : (campo.formato === 'date' || campo.formato === 'fecha') ? 'date' : 'datetime-local'}
                           value={form[key] ?? ''} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                           aria-invalid={error && error.includes(campo.nombreAMostrar) ? 'true' : undefined}
                           className="form-input"
                           style={inputStyle} />
                  ) : (() => {
                    const opts = dropdownOptionsFor(campo.nombreAMostrar, cuotas, descuentos)
                    if (opts) {
                      return (
                        <select id={`erp-${key}`}
                                value={form[key] ?? ''}
                                onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                                aria-invalid={error && error.includes(campo.nombreAMostrar) ? 'true' : undefined}
                                style={inputStyle}>
                          <option value="">— selecciona —</option>
                          {opts.map(o => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      )
                    }
                    return (
                      <input id={`erp-${key}`}
                             type={isNum ? 'text' : campo.formato === 'email' ? 'email' : campo.formato === 'phone' ? 'tel' : 'text'}
                             inputMode={isNum ? 'decimal' : undefined}
                             value={form[key] ?? ''} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                             placeholder={campo.formato === 'IBAN' ? 'ES00 0000 0000 00...' : campo.formato === 'dni' ? '12345678Z' : ''}
                             aria-invalid={error && error.includes(campo.nombreAMostrar) ? 'true' : undefined}
                             className="form-input"
                             style={inputStyle} />
                    )
                  })()}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: '20px 32px', borderTop: '1px solid var(--line)', flexShrink: 0 }}>
        {error && (
          <div role="alert" style={{
            padding: '12px 16px', borderRadius: 12, marginBottom: 16, fontSize: 13,
            color: 'var(--red)', background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.12)',
          }}>
            {error}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10 }}>
          <Btn variant="primary" size="md" onClick={handleSave} disabled={saving || loading}>
            {saving ? <><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Guardando...</> : <><CheckCircle2 size={15} aria-hidden="true" /> Guardar ERP</>}
          </Btn>
          <Btn variant="secondary" size="md" onClick={() => { if (!saving) onClose() }}>
            Cancelar
          </Btn>
        </div>
      </div>
    </Modal>
  )
}
