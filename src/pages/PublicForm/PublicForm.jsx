// Formulario público embebible — se sirve en /f/<public_id> y los managers
// lo incrustan en su web vía <iframe>. Documento autónomo: sin auth, sin
// Layout, estilos propios (claros) para verse bien dentro de cualquier web.
//
// Flujo:
//   GET  /api/crm/form/<id>          → definición (campos, config, centro)
//   GET  /api/crm/form/<id>/slots    → slots de prueba (solo tipo='prueba')
//   POST /api/crm/form/<id>          → submit (lead o reserva)
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'

const API = ''  // mismo origen (noofit.wiemspro.com)

function useQueryParams() {
  return useMemo(() => {
    const p = new URLSearchParams(window.location.search)
    const out = {}
    for (const [k, v] of p.entries()) out[k] = v
    return out
  }, [])
}

export default function PublicForm() {
  const { publicId } = useParams()
  const qs = useQueryParams()
  const [form, setForm] = useState(null)
  const [loadErr, setLoadErr] = useState(null)
  const [values, setValues] = useState({})
  const [consent, setConsent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState(null)

  // Slots (solo tipo='prueba')
  const [slotsData, setSlotsData] = useState(null)
  const [slotSel, setSlotSel] = useState(null)   // {id, label}

  const accent = (form?.config?.color) || '#2DD4A8'

  useEffect(() => {
    fetch(`${API}/api/crm/form/${encodeURIComponent(publicId)}`)
      .then(r => r.json())
      .then(j => {
        if (!j.ok) { setLoadErr(j.error || 'No disponible'); return }
        setForm(j.form)
        // Prefill campos ocultos desde la query (utm_*, centro, etc.)
        const init = {}
        ;(j.form.campos || []).forEach(c => {
          if (c.type === 'oculto' && qs[c.key]) init[c.key] = qs[c.key]
        })
        // utm_* siempre desde la query
        ;['utm_source', 'utm_medium', 'utm_campaign'].forEach(u => {
          if (qs[u]) init[u] = qs[u]
        })
        setValues(init)
      })
      .catch(() => setLoadErr('Error de conexión'))
  }, [publicId])  // eslint-disable-line

  // Cargar slots si es tipo prueba
  useEffect(() => {
    if (form?.tipo !== 'prueba') return
    fetch(`${API}/api/crm/form/${encodeURIComponent(publicId)}/slots`)
      .then(r => r.json())
      .then(j => { if (j.ok) setSlotsData(j) })
      .catch(() => {})
  }, [form?.tipo, publicId])

  const setV = (k, v) => setValues(prev => ({ ...prev, [k]: v }))

  const campos = (form?.campos || []).filter(c => c.type !== 'oculto' && c.type !== 'consentimiento')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    if (form.config?.consent_required && !consent) {
      setError('Debes aceptar la política de privacidad.'); return
    }
    if (form.tipo === 'prueba' && !slotSel) {
      setError('Elige un horario para tu clase de prueba.'); return
    }
    setSubmitting(true)
    try {
      const payload = { ...values, consentimiento: consent }
      if (form.tipo === 'prueba' && slotSel) payload.id_sala = slotSel.id
      const r = await fetch(`${API}/api/crm/form/${encodeURIComponent(publicId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const j = await r.json()
      if (!r.ok || j.ok === false) {
        setError(j.detalle || j.error || 'No se pudo enviar. Revisa los datos.')
        setSubmitting(false)
        return
      }
      if (form.config?.redirect_url) {
        window.top.location.href = form.config.redirect_url
        return
      }
      setDone(true)
    } catch {
      setError('Error de conexión. Inténtalo de nuevo.')
    }
    setSubmitting(false)
  }

  // ── Estados de carga / error ──
  if (loadErr) return <Shell accent="#ef4444"><p style={{ color: '#b91c1c' }}>{loadErr}</p></Shell>
  if (!form) return <Shell accent="#2DD4A8"><p style={{ color: '#6b7280' }}>Cargando…</p></Shell>

  if (done) {
    return (
      <Shell accent={accent}>
        <div style={{ textAlign: 'center', padding: '24px 8px' }}>
          <div style={{ fontSize: 44, marginBottom: 8 }}>✅</div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: '0 0 8px' }}>
            {form.tipo === 'prueba' ? '¡Reserva recibida!' : '¡Gracias!'}
          </h2>
          <p style={{ color: '#4b5563', fontSize: 15, lineHeight: 1.5 }}>
            {form.config?.gracias_msg ||
              (form.tipo === 'prueba'
                ? 'Te enviaremos un email para confirmar tu clase de prueba.'
                : 'Hemos recibido tus datos. Te contactaremos muy pronto.')}
          </p>
        </div>
      </Shell>
    )
  }

  return (
    <Shell accent={accent}>
      {form.config?.titulo && (
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#111827', margin: '0 0 4px' }}>
          {form.config.titulo}
        </h1>
      )}
      {form.config?.subtitulo && (
        <p style={{ color: '#6b7280', fontSize: 14, margin: '0 0 16px' }}>{form.config.subtitulo}</p>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {campos.map(c => (
          <Field key={c.key} campo={c} value={values[c.key] || ''} onChange={v => setV(c.key, v)} accent={accent} />
        ))}

        {/* Selector de horario para prueba */}
        {form.tipo === 'prueba' && (
          <SlotPicker data={slotsData} sel={slotSel} onSel={setSlotSel} accent={accent} />
        )}

        {/* Consentimiento RGPD */}
        {form.config?.consent_required && (
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: '#4b5563' }}>
            <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}
                   style={{ marginTop: 2 }} />
            <span>{form.config.consent_text || 'Acepto la política de privacidad y el tratamiento de mis datos.'}</span>
          </label>
        )}

        {error && (
          <div style={{ background: '#fef2f2', color: '#b91c1c', borderRadius: 8,
                        padding: '10px 12px', fontSize: 13 }}>{error}</div>
        )}

        <button type="submit" disabled={submitting}
                style={{ background: accent, color: '#fff', border: 'none', borderRadius: 10,
                         padding: '13px 20px', fontSize: 16, fontWeight: 700, cursor: 'pointer',
                         opacity: submitting ? 0.6 : 1 }}>
          {submitting ? 'Enviando…' : (form.config?.boton_texto || (form.tipo === 'prueba' ? 'Reservar mi clase' : 'Enviar'))}
        </button>
      </form>

      <p style={{ textAlign: 'center', fontSize: 11, color: '#9ca3af', marginTop: 16 }}>
        Powered by Round
      </p>
    </Shell>
  )
}


function Shell({ children, accent }) {
  return (
    <div style={{ minHeight: '100vh', background: '#f3f4f6', display: 'flex',
                  alignItems: 'flex-start', justifyContent: 'center', padding: '24px 12px',
                  fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' }}>
      <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
                    maxWidth: 460, width: '100%', padding: 28,
                    borderTop: `4px solid ${accent}` }}>
        {children}
      </div>
    </div>
  )
}


function Field({ campo, value, onChange, accent }) {
  const base = {
    width: '100%', padding: '12px 14px', borderRadius: 10, fontSize: 15,
    border: '1px solid #d1d5db', background: '#fff', color: '#111827',
    boxSizing: 'border-box', outline: 'none',
  }
  const label = (
    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
      {campo.label}{campo.required && <span style={{ color: '#ef4444' }}> *</span>}
    </label>
  )
  const tipo = campo.type
  if (tipo === 'textarea') {
    return <div>{label}<textarea value={value} required={campo.required}
              placeholder={campo.placeholder || ''} rows={3}
              onChange={e => onChange(e.target.value)} style={{ ...base, resize: 'vertical' }} /></div>
  }
  if (tipo === 'select') {
    return <div>{label}
      <select value={value} required={campo.required} onChange={e => onChange(e.target.value)} style={base}>
        <option value="">Selecciona…</option>
        {(campo.options || []).map((o, i) => {
          const val = typeof o === 'string' ? o : (o.value ?? o.text)
          const txt = typeof o === 'string' ? o : (o.text ?? o.value)
          return <option key={i} value={val}>{txt}</option>
        })}
      </select></div>
  }
  const htmlType = tipo === 'email' ? 'email' : tipo === 'telefono' ? 'tel' : 'text'
  return <div>{label}<input type={htmlType} value={value} required={campo.required}
            placeholder={campo.placeholder || ''} onChange={e => onChange(e.target.value)}
            style={base} /></div>
}


function SlotPicker({ data, sel, onSel, accent }) {
  if (!data) return <p style={{ fontSize: 13, color: '#6b7280' }}>Cargando horarios disponibles…</p>
  if (!data.por_dia || !data.por_dia.length) {
    return <p style={{ fontSize: 13, color: '#b45309', background: '#fffbeb', padding: 10, borderRadius: 8 }}>
      No hay horarios disponibles ahora mismo. Envía tus datos y te contactamos.
    </p>
  }
  return (
    <div>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
        Elige tu clase de prueba <span style={{ color: '#ef4444' }}>*</span>
      </label>
      <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {data.por_dia.map(dia => (
          <div key={dia.fecha}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', margin: '4px 0' }}>
              {formatFecha(dia.fecha)}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {dia.slots.map(s => {
                const id = s.id_sala ?? s.id
                const activo = sel?.id === id
                return (
                  <button type="button" key={id}
                          onClick={() => onSel({ id, label: `${dia.fecha} ${s.hora || ''}` })}
                          style={{
                            padding: '7px 11px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
                            border: `1.5px solid ${activo ? accent : '#d1d5db'}`,
                            background: activo ? accent : '#fff',
                            color: activo ? '#fff' : '#374151', fontWeight: 600,
                          }}>
                    {s.hora || ''}{s.actividad ? ` · ${s.actividad}` : ''}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function formatFecha(iso) {
  try {
    const d = new Date(iso + 'T00:00:00')
    return d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })
  } catch { return iso }
}
