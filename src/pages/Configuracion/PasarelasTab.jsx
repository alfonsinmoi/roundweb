import { useState, useEffect, useMemo } from 'react'
import { CreditCard, Save, Trash2, Eye, EyeOff, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react'
import { Card, Btn, SectionTitle, Avatar } from '../../components/UI'
import { useToast } from '../../components/Toast'
import { useAuth } from '../../contexts/AuthContext'
import { pasarelasList, pasarelaUpsert, pasarelaDelete, getRoundIdentity } from '../../utils/configApi'
import { getEntrenadores } from '../../utils/api'

export default function PasarelasTab({ identity: identityProp }) {
  const { user, isImpersonating } = useAuth()
  const identity = useMemo(() => identityProp || getRoundIdentity(user), [identityProp, user])
  const toast = useToast()
  const [trainers, setTrainers] = useState([])
  const [creds, setCreds] = useState([])  // rows del backend
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null) // {trainerId, ...}

  async function load() {
    setLoading(true)
    try {
      const [t, c] = await Promise.all([
        getEntrenadores().catch(() => []),
        pasarelasList(identity).catch(() => []),
      ])
      setTrainers(t || [])
      setCreds(c || [])
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setLoading(false)
  }

  useEffect(() => { load() }, [identity.managerId])

  // Si está impersonando un trainer → no mostrar nada
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

  const credByTrainer = useMemo(() => {
    const m = {}
    for (const c of creds) {
      const k = `${c.id_trainer}|${c.proveedor}`
      m[k] = c
    }
    return m
  }, [creds])

  return (
    <div>
      <Card style={{ padding: 20, marginBottom: 16 }}>
        <SectionTitle>
          <CreditCard size={16} style={{ marginRight: 8 }} /> Pasarelas de pago por trainer
        </SectionTitle>
        <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8, lineHeight: 1.6 }}>
          Cada trainer puede tener su propia cuenta de PayComet (o compartirla con otros).
          Los trainers <strong>no ven estos datos</strong>; solo se usan al generar enlaces
          de pago en su nombre. <br />
          La <strong>URL de notificación</strong> que tienes que configurar en el panel
          PayComet de cada cuenta es:
          <code style={{ background: 'var(--bg-3)', padding: '2px 8px', borderRadius: 6,
                         fontSize: 11, marginLeft: 6, fontFamily: 'var(--font-mono)' }}>
            https://noofit.wiemspro.com/api/cuotas/paycomet-callback
          </code>
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
            const cred = credByTrainer[`${t.id}|paycomet`]
            const isEditing = editing?.trainerId === t.id
            return (
              <Card key={t.id} style={{ padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Avatar nombre={`${t.nombre || t.name || ''} ${t.apellidos || t.surname || ''}`}
                          size={40} imgUrl={t.imgUrl} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontFamily: 'Outfit', fontSize: 15, fontWeight: 600,
                                color: 'var(--text-0)', overflow: 'hidden',
                                textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.nombre || t.name} {t.apellidos || t.surname}
                    </p>
                    <p style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                      {t.email} · ID {t.id}
                    </p>
                  </div>
                  {cred ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4,
                                  fontSize: 11, color: cred.active ? 'var(--green)' : 'var(--text-3)',
                                  background: cred.active ? 'rgba(45,212,168,0.12)' : 'var(--bg-3)',
                                  padding: '4px 10px', borderRadius: 999 }}>
                      <CheckCircle2 size={11} /> Configurado
                      {cred.sandbox && <span style={{ marginLeft: 6, color: 'var(--amber)' }}>· sandbox</span>}
                    </div>
                  ) : (
                    <span style={{ fontSize: 11, color: 'var(--text-3)' }}>— sin configurar —</span>
                  )}
                  <Btn size="sm" variant="secondary"
                       onClick={() => setEditing(isEditing ? null : {
                         trainerId: t.id,
                         proveedor: 'paycomet',
                         api_token: '',
                         terminal: cred?.terminal || '',
                         url_ok: cred?.url_ok || '',
                         url_ko: cred?.url_ko || '',
                         url_notif: cred?.url_notif || '',
                         sandbox: cred?.sandbox || false,
                         active: cred?.active ?? true,
                         notas: cred?.notas || '',
                         _has_token: cred?.has_token,
                         _token_preview: cred?.token_preview,
                       })}>
                    {isEditing ? 'Cancelar' : (cred ? 'Editar' : 'Configurar')}
                  </Btn>
                </div>

                {isEditing && (
                  <CredForm
                    value={editing}
                    onChange={setEditing}
                    onSave={async () => {
                      try {
                        // Si el usuario dejó el placeholder (texto sugerido) en
                        // un campo URL, lo tratamos como vacío para usar los
                        // defaults de PayComet en backend.
                        const isPlaceholderOrEmpty = (v, ph) => {
                          const s = String(v ?? '').trim()
                          return !s || s === ph
                        }
                        const dft = 'https://noofit.wiemspro.com/cuotas-clientes'
                        const url_ok = isPlaceholderOrEmpty(editing.url_ok, dft) ? null : editing.url_ok
                        const url_ko = isPlaceholderOrEmpty(editing.url_ko, dft) ? null : editing.url_ko
                        await pasarelaUpsert(identity, t.id, {
                          proveedor: editing.proveedor,
                          api_token: editing.api_token, // vacío = mantener
                          terminal: editing.terminal,
                          url_ok,
                          url_ko,
                          url_notif: editing.url_notif || null,
                          sandbox: !!editing.sandbox,
                          active: !!editing.active,
                          notas: editing.notas || null,
                        })
                        toast.success('Credenciales guardadas')
                        setEditing(null)
                        load()
                      } catch (e) { toast.error(`Error: ${e.message}`) }
                    }}
                    onDelete={cred ? async () => {
                      if (!confirm('¿Eliminar credenciales de PayComet de este trainer?')) return
                      try {
                        await pasarelaDelete(identity, t.id, 'paycomet')
                        toast.success('Credenciales eliminadas')
                        setEditing(null)
                        load()
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

function CredForm({ value, onChange, onSave, onDelete }) {
  const [showToken, setShowToken] = useState(false)
  const set = patch => onChange(v => ({ ...v, ...patch }))
  return (
    <div style={{
      marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line)',
      display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12,
    }}>
      <Field label="API Token (PayComet)" required={!value._has_token}>
        <div style={{ position: 'relative' }}>
          <input type={showToken ? 'text' : 'password'}
                 value={value.api_token}
                 onChange={e => set({ api_token: e.target.value })}
                 placeholder={value._has_token ? `actual: ${value._token_preview} (deja vacío para conservar)` : 'pega aquí el API token'}
                 style={inputStyle} />
          <button onClick={() => setShowToken(s => !s)} type="button"
                  style={{ position: 'absolute', right: 6, top: '50%',
                           transform: 'translateY(-50%)',
                           background: 'none', border: 'none', cursor: 'pointer',
                           color: 'var(--text-3)', padding: 4 }}>
            {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      </Field>
      <Field label="Terminal (FUC)" required>
        <input value={value.terminal} onChange={e => set({ terminal: e.target.value })}
               placeholder="ej. 1234" style={inputStyle} />
      </Field>
      <Field label="URL OK (redirección éxito)">
        <input value={value.url_ok} onChange={e => set({ url_ok: e.target.value })}
               placeholder="https://noofit.wiemspro.com/cuotas-clientes" style={inputStyle} />
      </Field>
      <Field label="URL KO (redirección fallo)">
        <input value={value.url_ko} onChange={e => set({ url_ko: e.target.value })}
               placeholder="https://noofit.wiemspro.com/cuotas-clientes" style={inputStyle} />
      </Field>
      <Field label="Notas internas">
        <input value={value.notas} onChange={e => set({ notas: e.target.value })}
               placeholder="opcional" style={inputStyle} />
      </Field>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-2)' }}>
          <input type="checkbox" checked={!!value.sandbox}
                 onChange={e => set({ sandbox: e.target.checked })} />
          Modo sandbox (pruebas)
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-2)' }}>
          <input type="checkbox" checked={!!value.active}
                 onChange={e => set({ active: e.target.checked })} />
          Activa
        </label>
      </div>
      <div style={{ display: 'flex', gap: 8, gridColumn: '1 / -1', justifyContent: 'flex-end' }}>
        {onDelete && (
          <Btn variant="secondary" onClick={onDelete}>
            <Trash2 size={14} /> Eliminar
          </Btn>
        )}
        <Btn variant="primary" onClick={onSave}>
          <Save size={14} /> Guardar
        </Btn>
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
