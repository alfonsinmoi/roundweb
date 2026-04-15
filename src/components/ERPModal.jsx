import { useState, useEffect } from 'react'
import { Loader2, CheckCircle2 } from 'lucide-react'
import { Btn } from './UI'
import Modal from './Modal'
import { useToast } from './Toast'
import { getERPDatosCliente, postERPDatosCliente } from '../utils/api'
import { validarIBAN, validarDNI, validarEmail, validarTelefono } from '../utils/validators'

export default function ERPModal({ cliente, erpConfig, onClose }) {
  const toast = useToast()
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const campos = erpConfig?.campos ?? []

  useEffect(() => {
    if (!cliente || campos.length === 0) return
    setLoading(true)
    setError('')

    getERPDatosCliente(cliente.id).catch(() => null).then(datos => {
      const f = {}
      for (const campo of [...campos].sort((a, b) => a.orden - b.orden)) {
        const existing = datos?.campos?.[campo.nombreCampo]
        if (campo.nombreCampo.startsWith('datetime')) {
          let val = ''
          if (existing != null) {
            if (typeof existing === 'number') val = new Date(existing).toISOString().slice(0, campo.formato === 'date' ? 10 : 16)
            else val = String(existing)
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
        else if (campo.nombreCampo.startsWith('datetime')) { if (val) data[campo.nombreCampo] = val }
        else if (campo.nombreCampo.startsWith('double')) { if (val !== '' && val != null) data[campo.nombreCampo] = Number(String(val).replace(',', '.')) }
        else if (campo.nombreCampo.startsWith('int')) { if (val !== '' && val != null) data[campo.nombreCampo] = parseInt(val) }
        else { if (val !== '' && val != null) data[campo.nombreCampo] = String(val).trim() }
      }
      await postERPDatosCliente(cliente.id, data)
      toast.success('Datos ERP guardados correctamente')
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
      {/* Form */}
      <div style={{ padding: '28px 32px' }}>
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
                           type={campo.formato === 'time' ? 'time' : campo.formato === 'date' ? 'date' : 'datetime-local'}
                           value={form[key] ?? ''} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                           aria-invalid={error && error.includes(campo.nombreAMostrar) ? 'true' : undefined}
                           className="form-input"
                           style={inputStyle} />
                  ) : (
                    <input id={`erp-${key}`}
                           type={isNum ? 'text' : campo.formato === 'email' ? 'email' : campo.formato === 'phone' ? 'tel' : 'text'}
                           inputMode={isNum ? 'decimal' : undefined}
                           value={form[key] ?? ''} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                           placeholder={campo.formato === 'IBAN' ? 'ES00 0000 0000 00...' : campo.formato === 'dni' ? '12345678Z' : ''}
                           aria-invalid={error && error.includes(campo.nombreAMostrar) ? 'true' : undefined}
                           className="form-input"
                           style={inputStyle} />
                  )}
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
