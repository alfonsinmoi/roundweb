import { useState, useEffect, useMemo } from 'react'
import { Building2, Save, Trash2, Loader2, AlertCircle, Mail, MapPin } from 'lucide-react'
import { Card, Btn, SectionTitle, Avatar } from '../../components/UI'
import { useToast } from '../../components/Toast'
import { useAuth } from '../../contexts/AuthContext'
import { centrosList, centroUpsert, centroDelete, getRoundIdentity } from '../../utils/configApi'
import { getEntrenadores } from '../../utils/api'

export default function CentrosTab({ identity: identityProp }) {
  const { user, isImpersonating } = useAuth()
  const identity = useMemo(() => identityProp || getRoundIdentity(user), [identityProp, user])
  const toast = useToast()
  const [trainers, setTrainers] = useState([])
  const [centros, setCentros] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)

  async function load() {
    setLoading(true)
    try {
      const [t, c] = await Promise.all([
        getEntrenadores().catch(() => []),
        centrosList(identity).catch(() => []),
      ])
      setTrainers(t || [])
      setCentros(c || [])
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setLoading(false)
  }
  useEffect(() => { load() }, [identity.managerId])

  if (isImpersonating) {
    return (
      <Card style={{ padding: 32, textAlign: 'center' }}>
        <AlertCircle size={32} style={{ color: 'var(--text-3)', margin: '0 auto 12px' }} />
        <p style={{ color: 'var(--text-2)', fontSize: 13 }}>
          Esta sección solo está disponible para el manager (no en modo trainer).
        </p>
      </Card>
    )
  }

  const centroByTrainer = useMemo(() => {
    const m = {}
    for (const c of centros) m[c.id_trainer] = c
    return m
  }, [centros])

  return (
    <div>
      <Card style={{ padding: 20, marginBottom: 16 }}>
        <SectionTitle>
          <Building2 size={16} style={{ marginRight: 8 }} /> Centros / contactos
        </SectionTitle>
        <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8, lineHeight: 1.6 }}>
          Cada trainer de NoofitPro = un centro físico (Round Málaga Centro, Málaga Este, etc.).
          Configura aquí el email donde recibirá los leads de la web y de las campañas de Meta.
          El campo <strong>slug</strong> permite redirigir leads concretos al centro vía URL
          (ej. <code style={{background:'var(--bg-3)',padding:'1px 6px',borderRadius:4}}>/prueba-gratuita?centro=malagacentro</code>).
        </p>
      </Card>

      {loading ? (
        <Card style={{ padding: 40, textAlign: 'center' }}>
          <Loader2 size={20} className="animate-spin" style={{ color: 'var(--green)' }} />
        </Card>
      ) : trainers.length === 0 ? (
        <Card style={{ padding: 32, textAlign: 'center' }}>
          <p style={{ color: 'var(--text-3)' }}>No hay trainers en este manager.</p>
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {trainers.map(t => {
            const c = centroByTrainer[t.id]
            const isEditing = editing?.trainerId === t.id
            return (
              <Card key={t.id} style={{ padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <Avatar nombre={`${t.nombre || t.name || ''} ${t.apellidos || t.surname || ''}`}
                          size={40} imgUrl={t.imgUrl} />
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <p style={{ fontFamily: 'Outfit', fontSize: 15, fontWeight: 600, color: 'var(--text-0)' }}>
                      {t.nombre || t.name} {t.apellidos || t.surname}
                    </p>
                    <p style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                      {t.email} · ID {t.id}
                    </p>
                  </div>
                  {c ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', fontSize: 11 }}>
                      <span style={{ color: 'var(--text-1)', fontWeight: 600 }}>{c.nombre_centro}</span>
                      <span style={{ color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Mail size={10} /> {c.email}
                      </span>
                      {c.ciudad && <span style={{ color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <MapPin size={10} /> {c.ciudad}
                      </span>}
                    </div>
                  ) : (
                    <span style={{ fontSize: 11, color: 'var(--text-3)' }}>— sin configurar —</span>
                  )}
                  <Btn size="sm" variant="secondary"
                       onClick={() => setEditing(isEditing ? null : {
                         trainerId: t.id,
                         nombre_centro: c?.nombre_centro || `${t.nombre || ''} ${t.apellidos || ''}`.trim(),
                         slug: c?.slug || '',
                         email: c?.email || t.email || '',
                         email_cc: c?.email_cc || '',
                         telefono: c?.telefono || '',
                         ciudad: c?.ciudad || '',
                         direccion: c?.direccion || '',
                         cif: c?.cif || '',
                         razon_social: c?.razon_social || '',
                         activo: c?.activo ?? true,
                         recibe_round_robin: c?.recibe_round_robin ?? true,
                         notas: c?.notas || '',
                       })}>
                    {isEditing ? 'Cancelar' : (c ? 'Editar' : 'Configurar')}
                  </Btn>
                </div>

                {isEditing && (
                  <CentroForm value={editing} onChange={setEditing}
                    onSave={async () => {
                      try {
                        await centroUpsert(identity, t.id, editing)
                        toast.success('Centro guardado')
                        setEditing(null); load()
                      } catch (e) { toast.error(`Error: ${e.message}`) }
                    }}
                    onDelete={c ? async () => {
                      if (!confirm('¿Eliminar la configuración de este centro?')) return
                      try {
                        await centroDelete(identity, t.id)
                        toast.success('Centro eliminado')
                        setEditing(null); load()
                      } catch (e) { toast.error(`Error: ${e.message}`) }
                    } : null}
                  />
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

function CentroForm({ value, onChange, onSave, onDelete }) {
  const set = patch => onChange(v => ({ ...v, ...patch }))
  return (
    <div style={{
      marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line)',
      display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12,
    }}>
      <Field label="Nombre del centro" required>
        <input value={value.nombre_centro} onChange={e => set({ nombre_centro: e.target.value })}
               placeholder="Round Málaga Centro" style={inputStyle} />
      </Field>
      <Field label="Slug (URL ?centro=)">
        <input value={value.slug} onChange={e => set({ slug: e.target.value.toLowerCase() })}
               placeholder="malagacentro" style={inputStyle} />
      </Field>
      <Field label="Email principal" required>
        <input type="email" value={value.email} onChange={e => set({ email: e.target.value })}
               placeholder="centro@ejemplo.com" style={inputStyle} />
      </Field>
      <Field label="Emails CC (separados por coma)">
        <input value={value.email_cc} onChange={e => set({ email_cc: e.target.value })}
               placeholder="manager@ejemplo.com, otro@ejemplo.com" style={inputStyle} />
      </Field>
      <Field label="Teléfono">
        <input value={value.telefono} onChange={e => set({ telefono: e.target.value })}
               placeholder="+34 600 000 000" style={inputStyle} />
      </Field>
      <Field label="Ciudad">
        <input value={value.ciudad} onChange={e => set({ ciudad: e.target.value })}
               placeholder="Málaga" style={inputStyle} />
      </Field>
      <Field label="Dirección">
        <input value={value.direccion} onChange={e => set({ direccion: e.target.value })}
               placeholder="Calle…" style={inputStyle} />
      </Field>
      <Field label="Razón social (empresa)">
        <input value={value.razon_social} onChange={e => set({ razon_social: e.target.value })}
               placeholder="Round Training Center S.L." style={inputStyle} />
      </Field>
      <Field label="CIF / NIF">
        <input value={value.cif} onChange={e => set({ cif: e.target.value })}
               placeholder="B12345678" style={inputStyle} />
      </Field>
      <Field label="Notas internas">
        <input value={value.notas} onChange={e => set({ notas: e.target.value })}
               style={inputStyle} />
      </Field>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-2)' }}>
          <input type="checkbox" checked={!!value.activo}
                 onChange={e => set({ activo: e.target.checked })} />
          Activo
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-2)' }}>
          <input type="checkbox" checked={!!value.recibe_round_robin}
                 onChange={e => set({ recibe_round_robin: e.target.checked })} />
          Recibe leads sin centro asignado (round-robin)
        </label>
      </div>
      <div style={{ display: 'flex', gap: 8, gridColumn: '1 / -1', justifyContent: 'flex-end' }}>
        {onDelete && <Btn variant="secondary" onClick={onDelete}><Trash2 size={14} /> Eliminar</Btn>}
        <Btn variant="primary" onClick={onSave}><Save size={14} /> Guardar</Btn>
      </div>
    </div>
  )
}

function Field({ label, required, children }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase',
                     letterSpacing: '0.04em', display: 'block', marginBottom: 4 }}>
        {label} {required && <span style={{ color: 'var(--red)' }}>*</span>}
      </span>
      {children}
    </label>
  )
}

const inputStyle = {
  padding: '8px 10px', borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--line)', background: 'var(--bg-1)',
  color: 'var(--text-0)', fontSize: 13, width: '100%',
}
