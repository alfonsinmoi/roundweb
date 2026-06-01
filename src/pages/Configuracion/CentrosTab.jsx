import { useState, useEffect, useMemo } from 'react'
import { Building2, Save, Trash2, Loader2, AlertCircle, Mail, MapPin, KeyRound, Eye, EyeOff, CheckCircle2, XCircle } from 'lucide-react'
import { Card, Btn, SectionTitle, Avatar, Badge } from '../../components/UI'
import { useToast } from '../../components/Toast'
import { useAuth } from '../../contexts/AuthContext'
import {
  centrosList, centroUpsert, centroDelete, getRoundIdentity,
  trainerCredsList, trainerCredsUpsert, trainerCredsDelete, trainerCredsTest,
} from '../../utils/configApi'
import { getEntrenadores } from '../../utils/api'

export default function CentrosTab({ identity: identityProp }) {
  const { user, isImpersonating } = useAuth()
  const identity = useMemo(() => identityProp || getRoundIdentity(user), [identityProp, user])
  const toast = useToast()
  const [trainers, setTrainers] = useState([])
  const [centros, setCentros] = useState([])
  const [creds, setCreds] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [editingCreds, setEditingCreds] = useState(null)  // {trainerId, email, password}

  async function load() {
    setLoading(true)
    try {
      const [t, c, cr] = await Promise.all([
        getEntrenadores().catch(() => []),
        centrosList(identity).catch(() => []),
        trainerCredsList(identity).catch(() => []),
      ])
      setTrainers(t || [])
      setCentros(c || [])
      setCreds(cr || [])
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

  const credsByTrainer = useMemo(() => {
    const m = {}
    for (const c of creds) m[String(c.id_trainer)] = c
    return m
  }, [creds])

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
                         iban_cobro: c?.iban_cobro || '',
                         bic: c?.bic || '',
                         sepa_creditor_id: c?.sepa_creditor_id || '',
                         activo: c?.activo ?? true,
                         recibe_round_robin: c?.recibe_round_robin ?? true,
                         notas: c?.notas || '',
                         dias_permitidos: Array.isArray(c?.dias_permitidos) ? c.dias_permitidos : [],
                         actividades_permitidas: Array.isArray(c?.actividades_permitidas) ? c.actividades_permitidas : [],
                       })}>
                    {isEditing ? 'Cancelar' : (c ? 'Editar' : 'Configurar')}
                  </Btn>
                </div>

                {isEditing && (
                  <CentroForm value={editing} onChange={setEditing}
                    identity={identity}
                    trainerId={t.id}
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

                {/* ── Credenciales NoofitPro del trainer (para usuarios web) ── */}
                <CredsSection
                  identity={identity}
                  trainer={t}
                  cred={credsByTrainer[String(t.id)]}
                  editing={editingCreds?.trainerId === t.id ? editingCreds : null}
                  onStartEdit={(cur) => setEditingCreds({
                    trainerId: t.id,
                    noofit_email: cur?.noofit_email || t.email || '',
                    noofit_password: '',
                  })}
                  onCancel={() => setEditingCreds(null)}
                  onChange={setEditingCreds}
                  onSaved={() => { setEditingCreds(null); load() }}
                />
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

const DIAS_SEMANA = [
  { id: 0, label: 'L', nombre: 'Lunes' },
  { id: 1, label: 'M', nombre: 'Martes' },
  { id: 2, label: 'X', nombre: 'Miércoles' },
  { id: 3, label: 'J', nombre: 'Jueves' },
  { id: 4, label: 'V', nombre: 'Viernes' },
  { id: 5, label: 'S', nombre: 'Sábado' },
  { id: 6, label: 'D', nombre: 'Domingo' },
]

function CentroForm({ value, onChange, identity, trainerId, onSave, onDelete }) {
  const set = patch => onChange(v => ({ ...v, ...patch }))

  // Cargar actividades disponibles del trainer (para el selector)
  const [actividades, setActividades] = useState([])
  const [loadingAct, setLoadingAct] = useState(false)
  useEffect(() => {
    if (!trainerId || !identity?.managerId) return
    setLoadingAct(true)
    const TOKEN = import.meta.env.VITE_CONFIG_API_TOKEN || ''
    fetch(`/centros/${trainerId}/actividades`, {
      headers: { 'X-Round-Token': TOKEN, 'X-Round-Manager-Id': String(identity.managerId) },
    })
      .then(r => r.json())
      .then(d => { if (d.ok) setActividades(d.actividades || []) })
      .catch(() => {})
      .finally(() => setLoadingAct(false))
  }, [trainerId, identity?.managerId])

  const dias = Array.isArray(value.dias_permitidos) ? value.dias_permitidos : []
  const actsSel = Array.isArray(value.actividades_permitidas) ? value.actividades_permitidas : []
  const toggleDia = (id) => {
    const has = dias.includes(id)
    set({ dias_permitidos: has ? dias.filter(d => d !== id) : [...dias, id].sort() })
  }
  const toggleAct = (actId) => {
    const idn = Number(actId)
    const has = actsSel.includes(idn)
    set({ actividades_permitidas: has ? actsSel.filter(a => a !== idn) : [...actsSel, idn].sort() })
  }
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

      {/* ── Datos SEPA empresa: necesarios para generar el fichero pain.008
            que se sube al banco (cobros domiciliados). Se rellenan UNA vez
            por centro y se reutilizan cada mes en la remesa SEPA. ── */}
      <div style={{
        gridColumn: '1 / -1',
        marginTop: 8, padding: 14, borderRadius: 12,
        background: 'rgba(91,156,246,0.05)',
        border: '1px solid rgba(91,156,246,0.18)',
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--blue)',
                       marginBottom: 4 }}>
          🏦 Datos SEPA (cobros domiciliados)
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 12 }}>
          Datos del centro como <strong>acreedor SEPA</strong>. Necesarios
          para generar el fichero pain.008 mensual. Se piden una vez y se
          reutilizan cada remesa.
        </div>
        <div style={{ display: 'grid',
                       gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                       gap: 12 }}>
          <Field label="IBAN de cobro (cuenta del centro)">
            <input value={value.iban_cobro || ''}
                   onChange={e => set({ iban_cobro: e.target.value.toUpperCase().replace(/\s/g, '') })}
                   placeholder="ES00 0000 0000 0000 0000 0000"
                   style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }} />
          </Field>
          <Field label="BIC (opcional)">
            <input value={value.bic || ''}
                   onChange={e => set({ bic: e.target.value.toUpperCase().replace(/\s/g, '') })}
                   placeholder="CAIXESBBXXX"
                   style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }} />
          </Field>
          <Field label="Creditor SEPA ID (AEAT)">
            <input value={value.sepa_creditor_id || ''}
                   onChange={e => set({ sepa_creditor_id: e.target.value.toUpperCase().replace(/\s/g, '') })}
                   placeholder="ES50ZZZB12345678"
                   style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }} />
          </Field>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 8,
                       lineHeight: 1.6 }}>
          El <strong>Creditor SEPA ID</strong> es el código único que la AEAT
          asignó a este CIF para hacer adeudos directos. Formato típico
          español: <code>ES</code> + 2 dígitos de control + <code>ZZZ</code> +
          el CIF (ej. <code>ES50ZZZB12345678</code>). Si no lo tienes, pídelo
          a tu banco o a la AEAT.
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', gridColumn: '1 / -1' }}>
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

      {/* ── Configuración de slots públicos (formulario web) ── */}
      <div style={{
        gridColumn: '1 / -1',
        marginTop: 8, padding: 14, borderRadius: 12,
        background: 'var(--bg-1)', border: '1px solid var(--line)',
      }}>
        <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-0)', margin: '0 0 4px',
                    display: 'flex', alignItems: 'center', gap: 6 }}>
          🌐 Slots disponibles en formulario público
        </p>
        <p style={{ fontSize: 11, color: 'var(--text-3)', margin: '0 0 12px', lineHeight: 1.5 }}>
          Filtros que se aplican al endpoint <code style={{ background: 'var(--bg-3)', padding: '1px 6px', borderRadius: 4 }}>/api/crm/slots-disponibles?centro={value.slug || '...'}</code> que
          consume la web pública (roundtrainingcenter.com). Si no marcas nada se usan los días por defecto del sistema (Mié, Jue) y todas las actividades.
        </p>

        {/* Días permitidos */}
        <div style={{ marginBottom: 14 }}>
          <p style={{ fontSize: 11, color: 'var(--text-2)', textTransform: 'uppercase',
                      letterSpacing: '0.04em', marginBottom: 6 }}>
            Días que se muestran al público
          </p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {DIAS_SEMANA.map(d => {
              const sel = dias.includes(d.id)
              return (
                <button key={d.id} type="button" onClick={() => toggleDia(d.id)}
                        title={d.nombre}
                        style={{
                          width: 38, height: 38, borderRadius: 10, fontSize: 13,
                          fontWeight: 600, cursor: 'pointer',
                          background: sel ? 'var(--green-bg)' : 'var(--bg-2)',
                          color: sel ? 'var(--green)' : 'var(--text-2)',
                          border: `1px solid ${sel ? 'var(--green)' : 'var(--line)'}`,
                        }}>
                  {d.label}
                </button>
              )
            })}
          </div>
          {dias.length === 0 && (
            <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6, fontStyle: 'italic' }}>
              Sin selección → se usan los días por defecto del sistema (actualmente Mié, Jue).
            </p>
          )}
        </div>

        {/* Actividades permitidas */}
        <div>
          <p style={{ fontSize: 11, color: 'var(--text-2)', textTransform: 'uppercase',
                      letterSpacing: '0.04em', marginBottom: 6 }}>
            Actividades que se muestran al público
          </p>
          {loadingAct ? (
            <p style={{ fontSize: 12, color: 'var(--text-3)' }}>Cargando…</p>
          ) : actividades.length === 0 ? (
            <p style={{ fontSize: 11, color: 'var(--text-3)' }}>
              No hay actividades en la programación próxima de este trainer.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {actividades.map(a => {
                const sel = actsSel.includes(Number(a.id))
                return (
                  <label key={a.id}
                         style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
                                  padding: '6px 10px', borderRadius: 8,
                                  background: sel ? 'var(--green-bg)' : 'var(--bg-2)',
                                  border: `1px solid ${sel ? 'var(--green)' : 'var(--line)'}`,
                                  cursor: 'pointer' }}>
                    <input type="checkbox" checked={sel}
                           onChange={() => toggleAct(a.id)} />
                    <span style={{ flex: 1, color: sel ? 'var(--green)' : 'var(--text-1)',
                                    fontWeight: sel ? 600 : 400 }}>
                      {a.nombre}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                      id={a.id} · {a.n_clases} clases
                    </span>
                  </label>
                )
              })}
            </div>
          )}
          {actsSel.length === 0 && actividades.length > 0 && (
            <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6, fontStyle: 'italic' }}>
              Sin selección → se muestran TODAS las actividades del trainer.
            </p>
          )}
        </div>
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


// ── Credenciales NoofitPro por trainer ────────────────────────────────────
function CredsSection({ identity, trainer, cred, editing, onStartEdit, onCancel, onChange, onSaved }) {
  const toast = useToast()
  const [showPwd, setShowPwd] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [saving, setSaving] = useState(false)

  const tieneCreds = !!cred?.has_password

  const handleTest = async () => {
    setTesting(true); setTestResult(null)
    try {
      const r = await trainerCredsTest(identity, trainer.id)
      setTestResult({ ok: r.ok, message: r.message })
      if (r.ok) toast.success('Login NoofitPro OK')
      else toast.error('Login falló: ' + (r.message || 'sin detalle'))
    } catch (e) {
      setTestResult({ ok: false, message: e.message })
      toast.error('Error: ' + e.message)
    } finally { setTesting(false) }
  }

  const handleSave = async () => {
    if (!editing.noofit_email || !editing.noofit_email.includes('@')) {
      toast.error('Email inválido'); return
    }
    if (!tieneCreds && !editing.noofit_password) {
      toast.error('Pon una contraseña'); return
    }
    setSaving(true)
    try {
      await trainerCredsUpsert(identity, trainer.id, {
        noofit_email: editing.noofit_email.trim(),
        noofit_password: editing.noofit_password,  // vacío = no sobreescribir
        activo: true,
      })
      toast.success(tieneCreds ? 'Credenciales actualizadas' : 'Credenciales guardadas')
      onSaved()
    } catch (e) { toast.error('Error: ' + e.message) }
    finally { setSaving(false) }
  }

  const handleDelete = async () => {
    if (!confirm('¿Borrar las credenciales NoofitPro de este centro? Los usuarios web del centro no podrán cargar datos hasta que se vuelvan a configurar.')) return
    try {
      await trainerCredsDelete(identity, trainer.id)
      toast.success('Credenciales borradas')
      onSaved()
    } catch (e) { toast.error('Error: ' + e.message) }
  }

  // Header compacto cuando NO está editando
  if (!editing) {
    return (
      <div style={{ marginTop: 12, padding: 10, borderRadius: 8,
                     background: 'var(--bg-2)', border: '1px solid var(--line)',
                     display: 'flex', alignItems: 'center', gap: 10 }}>
        <KeyRound size={14} style={{ color: tieneCreds ? 'var(--green)' : 'var(--text-3)' }} aria-hidden="true" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 12, color: 'var(--text-1)', fontWeight: 500 }}>
            Credenciales NoofitPro
          </span>
          {tieneCreds ? (
            <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
              {cred.noofit_email} <span style={{ fontFamily: 'monospace' }}>· pwd {cred.password_masked}</span>
            </p>
          ) : (
            <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
              No configuradas — los usuarios web de este centro no verán los datos correctos
            </p>
          )}
        </div>
        {tieneCreds && (
          <Btn size="sm" variant="secondary" onClick={handleTest} disabled={testing}>
            {testing ? <Loader2 size={11} className="animate-spin" /> :
              testResult?.ok ? <CheckCircle2 size={11} style={{ color: 'var(--green)' }} /> :
              testResult?.ok === false ? <XCircle size={11} style={{ color: 'var(--red)' }} /> : null}
            Probar
          </Btn>
        )}
        <Btn size="sm" variant="secondary" onClick={() => onStartEdit(cred)}>
          {tieneCreds ? 'Editar' : 'Configurar'}
        </Btn>
      </div>
    )
  }

  // Modo edición
  return (
    <div style={{ marginTop: 12, padding: 14, borderRadius: 10,
                   background: 'var(--bg-2)', border: '1px solid var(--green-border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <KeyRound size={14} style={{ color: 'var(--green)' }} />
        <strong style={{ fontSize: 13, color: 'var(--text-0)' }}>Credenciales NoofitPro del centro</strong>
      </div>
      <p style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 12, lineHeight: 1.5 }}>
        Necesarias para que los usuarios web vinculados a <strong>{trainer.nombre || trainer.name} {trainer.apellidos || trainer.surname}</strong> puedan
        cargar los clientes y clases del centro. La contraseña se guarda cifrada solo en el VPS.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Email NoofitPro" required>
          <input type="email" value={editing.noofit_email}
                 onChange={e => onChange({ ...editing, noofit_email: e.target.value })}
                 style={inputStyle} placeholder="centro@noofit.com" />
        </Field>
        <Field label={tieneCreds ? 'Nueva contraseña (vacío = no cambiar)' : 'Contraseña'} required={!tieneCreds}>
          <div style={{ position: 'relative' }}>
            <input type={showPwd ? 'text' : 'password'}
                   value={editing.noofit_password}
                   onChange={e => onChange({ ...editing, noofit_password: e.target.value })}
                   style={{ ...inputStyle, paddingRight: 36 }} />
            <button type="button" onClick={() => setShowPwd(s => !s)}
                    aria-label={showPwd ? 'Ocultar' : 'Mostrar'}
                    style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                             background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: 4 }}>
              {showPwd ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </Field>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
        <Btn size="sm" variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Guardar
        </Btn>
        <Btn size="sm" variant="secondary" onClick={onCancel} disabled={saving}>Cancelar</Btn>
        {tieneCreds && (
          <Btn size="sm" variant="secondary" onClick={handleDelete} style={{ marginLeft: 'auto', color: 'var(--red)' }}>
            <Trash2 size={12} /> Borrar
          </Btn>
        )}
      </div>
    </div>
  )
}
