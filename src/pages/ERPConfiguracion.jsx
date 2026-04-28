import { useState, useEffect, useRef } from 'react'
import { Database, Plus, Pencil, Trash2, RefreshCw, Check, X, AlertCircle, Save, Lock, Unlock, Eye, EyeOff } from 'lucide-react'
import { postERPConfiguracion, postERPConfiguracionCampos, apiGetRaw } from '../utils/api'
import { useAuth } from '../contexts/AuthContext'

const ERP_PASSWORD = 'Cambiamos!2026'

// ─── Constantes ───────────────────────────────────────────────────────────────
const TIPOS = [
  { value: 'string',   label: 'Texto (string)' },
  { value: 'bool',     label: 'Sí / No (bool)' },
  { value: 'datetime', label: 'Fecha (datetime)' },
  { value: 'number',   label: 'Número entero (number)' },
  { value: 'decimal',  label: 'Decimal (decimal)' },
]

const FORMATOS = [
  { value: '',           label: '— Sin formato —',  tipo: 'string'   },
  { value: 'dni',        label: 'DNI',              tipo: 'string'   },
  { value: 'nif',        label: 'NIF',              tipo: 'string'   },
  { value: 'nie',        label: 'NIE',              tipo: 'string'   },
  { value: 'cif',        label: 'CIF',              tipo: 'string'   },
  { value: 'email',      label: 'Email',            tipo: 'string'   },
  { value: 'telefono',   label: 'Teléfono',         tipo: 'string'   },
  { value: 'iban',       label: 'IBAN',             tipo: 'string'   },
  { value: 'url',        label: 'URL',              tipo: 'string'   },
  { value: 'cp',         label: 'Código postal',    tipo: 'string'   },
  { value: 'texto',      label: 'Texto libre',      tipo: 'string'   },
  { value: 'sino',       label: 'Sí / No',          tipo: 'bool'     },
  { value: 'fecha',      label: 'Fecha',            tipo: 'datetime' },
  { value: 'fechahora',  label: 'Fecha y hora',     tipo: 'datetime' },
  { value: 'porcentaje', label: 'Porcentaje',       tipo: 'decimal'  },
  { value: 'moneda',     label: 'Moneda (€)',       tipo: 'decimal'  },
  { value: 'decimal',    label: 'Decimal',          tipo: 'decimal'  },
  { value: 'numero',     label: 'Número entero',    tipo: 'number'   },
]

const TIPO_COLOR = {
  string:   { bg: 'rgba(156,163,175,0.15)', color: '#9ca3af' },
  bool:     { bg: 'rgba(34,197,94,0.12)',   color: '#22c55e' },
  datetime: { bg: 'rgba(59,130,246,0.12)',  color: '#3b82f6' },
  number:   { bg: 'rgba(168,85,247,0.12)',  color: '#a855f7' },
  decimal:  { bg: 'rgba(251,146,60,0.12)',  color: '#fb923c' },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function cfgId(cfg)     { return String(cfg?.id ?? cfg?.idConfiguracion ?? cfg?.Id ?? '') }
function campoKey(c)    { return c?.nombreCampo ?? c?.nombre ?? String(c?.id ?? '') }
function campoLabel(c)  { return c?.nombreAMostrar ?? c?.label ?? campoKey(c) }
function tipoFromCampo(c) {
  const k = campoKey(c)
  for (const t of ['datetime', 'decimal', 'number', 'string', 'bool']) {
    if (k.startsWith(t)) return t
  }
  return 'string'
}

function extractConfigs(raw) {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  if ((raw.id !== undefined || raw.idConfiguracion !== undefined) && raw.campos !== undefined) return [raw]
  for (const k of Object.keys(raw)) if (Array.isArray(raw[k])) return raw[k]
  return []
}

// Genera el nombreCampo para un nuevo campo de ese tipo dado los existentes
function nextNombreCampo(tipo, camposExistentes) {
  const prefix = tipo
  const nums = camposExistentes
    .map(c => campoKey(c))
    .filter(k => k.startsWith(prefix))
    .map(k => parseInt(k.replace(prefix, ''), 10))
    .filter(n => !isNaN(n))
  const max = nums.length > 0 ? Math.max(...nums) : 0
  return `${prefix}${max + 1}`
}

// ─── Campo row ────────────────────────────────────────────────────────────────
function CampoRow({ campo, onEdit, onDelete, unlocked }) {
  const tipo = tipoFromCampo(campo)
  const { bg, color } = TIPO_COLOR[tipo] ?? TIPO_COLOR.string
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '12px 22px', borderBottom: '1px solid var(--line)',
    }}>
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', flexShrink: 0 }} />

      {/* Nombre a mostrar + nombreCampo */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-0)' }}>
          {campoLabel(campo)}
          {campo.obligatorio && <span style={{ color: 'var(--red)', marginLeft: 4 }}>*</span>}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
          {campoKey(campo)}
          {campo.formato ? ` · ${campo.formato}` : ''}
          {campo.valorPorDefecto != null && campo.valorPorDefecto !== '' ? ` · defecto: ${campo.valorPorDefecto}` : ''}
        </div>
      </div>

      {/* Tipo */}
      <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: bg, color, flexShrink: 0 }}>
        {TIPOS.find(t => t.value === tipo)?.label.split(' (')[0] ?? tipo}
      </span>

      {/* Orden */}
      <span style={{ fontSize: 11, color: 'var(--text-3)', width: 24, textAlign: 'center', flexShrink: 0 }}>
        #{campo.orden ?? '—'}
      </span>

      {/* Acciones — solo visibles cuando desbloqueado */}
      {unlocked && (
        <>
          <button onClick={() => onEdit(campo)} title="Editar" style={iconBtn()}>
            <Pencil size={13} />
          </button>
          <button onClick={() => onDelete(campo)} title="Eliminar" style={iconBtn('var(--red)', 'rgba(239,68,68,0.08)')}>
            <Trash2 size={13} />
          </button>
        </>
      )}
    </div>
  )
}

function iconBtn(color = 'var(--text-2)', bg = 'var(--bg-3)') {
  return {
    width: 28, height: 28, borderRadius: 7, border: '1px solid var(--line)',
    background: bg, color, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  }
}

// ─── Modal de añadir / editar campo ──────────────────────────────────────────
function CampoModal({ cfg, camposExistentes, campoEditar, onClose, onSaved }) {
  const isEdit = !!campoEditar

  const [tipo,           setTipo]           = useState(isEdit ? tipoFromCampo(campoEditar) : 'string')
  const [nombreAMostrar, setNombreAMostrar] = useState(isEdit ? (campoEditar.nombreAMostrar ?? '') : '')
  const [formato,        setFormato]        = useState(isEdit ? (campoEditar.formato ?? '') : '')
  const [obligatorio,    setObligatorio]    = useState(isEdit ? !!campoEditar.obligatorio : false)
  const [valorDefault,   setValorDefault]   = useState(isEdit ? (campoEditar.valorPorDefecto ?? '') : '')
  const [saving,         setSaving]         = useState(false)
  const [error,          setError]          = useState('')

  // Al cambiar formato → actualizar tipo automáticamente (solo en alta)
  function handleFormato(val) {
    setFormato(val)
    if (!isEdit) {
      const tipoInferido = FORMATOS.find(f => f.value === val)?.tipo
      if (tipoInferido) setTipo(tipoInferido)
    }
  }

  // nombreCampo: en edición es fijo; en alta se auto-genera según tipo
  const nombreCampo = isEdit
    ? campoKey(campoEditar)
    : nextNombreCampo(tipo, camposExistentes)

  // orden: en edición es fijo; en alta es el siguiente
  const orden = isEdit
    ? (campoEditar.orden ?? camposExistentes.length + 1)
    : camposExistentes.length + 1

  const idConfiguracionERP = cfgId(cfg)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!nombreAMostrar.trim()) { setError('El nombre a mostrar es obligatorio'); return }
    setSaving(true)
    setError('')
    try {
      const body = {
        idConfiguracion:  idConfiguracionERP,
        nombreCampo,
        nombreAMostrar:   nombreAMostrar.trim(),
        formato:          formato || null,
        obligatorio,
        orden,
        valorPorDefecto:  valorDefault || null,
      }
      await postERPConfiguracionCampos(body)
      onSaved()
    } catch (err) {
      setError(err.message ?? 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 500,
      background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{
        background: 'var(--bg-1)', borderRadius: 20, width: '100%', maxWidth: 520,
        boxShadow: '0 24px 80px rgba(0,0,0,0.4)', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '20px 24px', borderBottom: '1px solid var(--line)',
        }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-0)', margin: 0 }}>
            {isEdit ? 'Editar campo' : 'Nuevo campo'}
          </h2>
          <button onClick={onClose} style={iconBtn()}>
            <X size={14} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Nombre a mostrar — primero para flujo natural */}
          <Field label="Nombre a mostrar *">
            <input
              value={nombreAMostrar}
              onChange={e => setNombreAMostrar(e.target.value)}
              placeholder="Ej: NIF / CIF cliente"
              style={inputStyle()}
              autoFocus
            />
          </Field>

          {/* Formato — al elegirlo se infiere el tipo y el nombreCampo */}
          <Field label="Formato" hint={!isEdit ? 'Determina el tipo y nombre interno' : ''}>
            <select value={formato} onChange={e => handleFormato(e.target.value)} style={selectStyle()}>
              {FORMATOS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </Field>

          {/* nombreCampo, tipo inferido y orden — todos readonly */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 80px', gap: 12 }}>
            <Field label="Nombre interno" hint="(auto)">
              <div style={{ position: 'relative' }}>
                <input value={nombreCampo} readOnly style={{ ...inputStyle(), background: 'var(--bg-3)', color: 'var(--text-2)', cursor: 'default', fontFamily: 'monospace' }} />
              </div>
            </Field>
            <Field label="Tipo" hint="(inferido)">
              <input
                value={TIPOS.find(t => t.value === tipo)?.label ?? tipo}
                readOnly
                style={{ ...inputStyle(), background: 'var(--bg-3)', color: 'var(--text-2)', cursor: 'default' }}
              />
            </Field>
            <Field label="Orden" hint="(auto)">
              <input value={orden} readOnly style={{ ...inputStyle(), background: 'var(--bg-3)', color: 'var(--text-2)', cursor: 'default', textAlign: 'center' }} />
            </Field>
          </div>

          {/* Obligatorio */}
          <Field label="¿Obligatorio?">
            <div style={{ display: 'flex', gap: 8 }}>
              {[true, false].map(v => (
                <button
                  key={String(v)}
                  type="button"
                  onClick={() => setObligatorio(v)}
                  style={{
                    flex: 1, padding: '9px 0', borderRadius: 10, fontSize: 13, fontWeight: 500,
                    border: `1.5px solid ${obligatorio === v ? 'var(--green)' : 'var(--line)'}`,
                    background: obligatorio === v ? 'var(--green-bg)' : 'var(--bg-2)',
                    color: obligatorio === v ? 'var(--green)' : 'var(--text-2)',
                    cursor: 'pointer', transition: 'all 0.15s',
                  }}
                >
                  {v ? 'Sí' : 'No'}
                </button>
              ))}
            </div>
          </Field>

          {/* Valor por defecto */}
          <Field label="Valor por defecto" hint="Opcional">
            <input
              value={valorDefault}
              onChange={e => setValorDefault(e.target.value)}
              placeholder="Dejar vacío si no aplica"
              style={inputStyle()}
            />
          </Field>

          {/* idConfiguracionERP — readonly */}
          <Field label="ID configuración ERP">
            <input value={idConfiguracionERP} readOnly style={{ ...inputStyle(), background: 'var(--bg-3)', color: 'var(--text-3)', cursor: 'default' }} />
          </Field>

          {/* Error */}
          {error && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'rgba(239,68,68,0.08)', borderRadius: 10 }}>
              <AlertCircle size={14} style={{ color: 'var(--red)', flexShrink: 0 }} />
              <span style={{ fontSize: 13, color: 'var(--red)' }}>{error}</span>
            </div>
          )}

          {/* Footer */}
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <button type="button" onClick={onClose} style={{
              flex: 1, padding: '10px 0', borderRadius: 10, fontSize: 13, fontWeight: 500,
              background: 'var(--bg-3)', border: '1px solid var(--line)', color: 'var(--text-2)', cursor: 'pointer',
            }}>
              Cancelar
            </button>
            <button type="submit" disabled={saving} style={{
              flex: 2, padding: '10px 0', borderRadius: 10, fontSize: 13, fontWeight: 600,
              background: 'var(--green)', color: '#fff', border: 'none',
              cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.7 : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
            }}>
              {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
              {saving ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Añadir campo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Modal de contraseña ──────────────────────────────────────────────────────
function PasswordGate({ onUnlocked, onClose }) {
  const [pwd,     setPwd]     = useState('')
  const [show,    setShow]    = useState(false)
  const [error,   setError]   = useState('')
  const inputRef              = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  function handleSubmit(e) {
    e.preventDefault()
    if (pwd === ERP_PASSWORD) {
      sessionStorage.setItem('erp_unlocked', '1')
      onUnlocked()
    } else {
      setError('Contraseña incorrecta')
      setPwd('')
      inputRef.current?.focus()
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 600,
      background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{
        background: 'var(--bg-1)', borderRadius: 20, width: '100%', maxWidth: 400,
        boxShadow: '0 24px 80px rgba(0,0,0,0.45)', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '20px 24px', borderBottom: '1px solid var(--line)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Lock size={16} style={{ color: '#3b82f6' }} />
            <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-0)', margin: 0 }}>
              Desbloquear edición
            </h2>
          </div>
          <button onClick={onClose} style={iconBtn()}>
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5 }}>
            Introduce la contraseña de administración para poder añadir, editar o eliminar campos ERP.
          </p>

          <div style={{ position: 'relative' }}>
            <input
              ref={inputRef}
              type={show ? 'text' : 'password'}
              value={pwd}
              onChange={e => { setPwd(e.target.value); setError('') }}
              placeholder="Contraseña"
              style={{ ...inputStyle(), paddingRight: 42 }}
              autoComplete="current-password"
            />
            <button
              type="button"
              onClick={() => setShow(s => !s)}
              style={{
                position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)',
                display: 'flex', alignItems: 'center', padding: 4,
              }}
            >
              {show ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>

          {error && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'rgba(239,68,68,0.08)', borderRadius: 10 }}>
              <AlertCircle size={14} style={{ color: 'var(--red)', flexShrink: 0 }} />
              <span style={{ fontSize: 13, color: 'var(--red)' }}>{error}</span>
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <button type="button" onClick={onClose} style={{
              flex: 1, padding: '10px 0', borderRadius: 10, fontSize: 13, fontWeight: 500,
              background: 'var(--bg-3)', border: '1px solid var(--line)', color: 'var(--text-2)', cursor: 'pointer',
            }}>
              Cancelar
            </button>
            <button type="submit" style={{
              flex: 2, padding: '10px 0', borderRadius: 10, fontSize: 13, fontWeight: 600,
              background: '#3b82f6', color: '#fff', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
            }}>
              <Unlock size={14} /> Desbloquear
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function Field({ label, hint, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>
        {label}
        {hint && <span style={{ fontWeight: 400, color: 'var(--text-3)', marginLeft: 6 }}>{hint}</span>}
      </label>
      {children}
    </div>
  )
}

function inputStyle() {
  return {
    padding: '9px 12px', borderRadius: 10, fontSize: 13,
    background: 'var(--bg-2)', border: '1px solid var(--line)',
    color: 'var(--text-0)', outline: 'none', width: '100%',
    boxSizing: 'border-box',
  }
}
function selectStyle() {
  return {
    ...inputStyle(),
    appearance: 'auto', cursor: 'pointer',
  }
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function ERPConfiguracion() {
  const { user } = useAuth()
  const managerId = user?.manager ?? user?.id ?? 'default'

  const [configs,    setConfigs]    = useState([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState('')
  const [modal,      setModal]      = useState(null)      // { cfg, campoEditar? }
  const [unlocked,   setUnlocked]   = useState(() => sessionStorage.getItem('erp_unlocked') === '1')
  const [pwdGate,    setPwdGate]    = useState(null)      // callback to run after unlock

  function lock() {
    sessionStorage.removeItem('erp_unlocked')
    setUnlocked(false)
  }

  // Ejecuta una acción; si está bloqueado, primero pide contraseña
  function withAuth(action) {
    if (unlocked) { action(); return }
    setPwdGate(() => action)
  }

  function onUnlocked() {
    setUnlocked(true)
    setPwdGate(cb => {
      if (typeof cb === 'function') cb()
      return null
    })
  }

  function load() {
    setLoading(true)
    apiGetRaw('api/erp/configuracion')
      .then(raw => setConfigs(extractConfigs(raw)))
      .catch(err => setError(err.message ?? 'Error cargando configuraciones ERP'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  function openAdd(cfg)        { withAuth(() => setModal({ cfg, campoEditar: null })) }
  function openEdit(cfg, c)    { withAuth(() => setModal({ cfg, campoEditar: c })) }
  function closeModal()        { setModal(null) }
  function onSaved()           { closeModal(); load() }

  async function handleDelete(cfg, campo) {
    withAuth(async () => {
      if (!confirm(`¿Eliminar el campo "${campoLabel(campo)}"?`)) return
      try {
        const restantes = (cfg.campos ?? []).filter(c => campoKey(c) !== campoKey(campo))
        await postERPConfiguracionCampos({ idConfiguracion: cfgId(cfg), campos: restantes })
        load()
      } catch { /* silencioso */ }
    })
  }

  return (
    <div style={{ padding: '28px 32px', maxWidth: 860 }}>

      {/* Cabecera */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 42, height: 42, borderRadius: 13, flexShrink: 0,
            background: 'linear-gradient(135deg,rgba(59,130,246,0.18),rgba(59,130,246,0.08))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Database size={20} style={{ color: '#3b82f6' }} />
          </div>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-0)', margin: 0 }}>Configuración ERP</h1>
            <p style={{ fontSize: 13, color: 'var(--text-3)', margin: 0, marginTop: 2 }}>
              Campos que se muestran en la pestaña ERP de cada cliente
            </p>
          </div>
        </div>

        {/* Botón de bloqueo / desbloqueo */}
        {unlocked ? (
          <button
            onClick={lock}
            title="Bloquear edición"
            style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '8px 16px', borderRadius: 10,
              background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)',
              color: '#22c55e', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <Unlock size={14} /> Edición activa
          </button>
        ) : (
          <button
            onClick={() => withAuth(() => {})}
            title="Desbloquear edición"
            style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '8px 16px', borderRadius: 10,
              background: 'var(--bg-3)', border: '1px solid var(--line)',
              color: 'var(--text-2)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <Lock size={14} /> Desbloquear edición
          </button>
        )}
      </div>

      {/* Estados */}
      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
          <RefreshCw size={20} className="animate-spin" style={{ color: 'var(--green)' }} />
        </div>
      )}
      {!loading && error && (
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 12, padding: 24, textAlign: 'center' }}>
          <p style={{ fontSize: 14, color: 'var(--red)', margin: 0 }}>{error}</p>
        </div>
      )}
      {!loading && !error && configs.length === 0 && (
        <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 16, padding: '64px 32px', textAlign: 'center' }}>
          <Database size={32} style={{ color: 'var(--text-3)', margin: '0 auto 12px' }} />
          <p style={{ fontSize: 14, color: 'var(--text-3)', margin: 0 }}>No hay configuraciones ERP disponibles</p>
        </div>
      )}

      {/* Tarjetas de configuración */}
      {!loading && !error && configs.map(cfg => {
        const id     = cfgId(cfg)
        const nombre = cfg.nombre ?? cfg.name ?? `Configuración ${id}`
        const campos = Array.isArray(cfg.campos) ? [...cfg.campos].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0)) : []

        return (
          <div key={id} style={{
            background: 'var(--bg-1)', border: '1px solid var(--line)',
            borderRadius: 16, marginBottom: 16, overflow: 'hidden',
          }}>
            {/* Cabecera tarjeta */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '18px 22px', borderBottom: '1px solid var(--line)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-0)' }}>{nombre}</span>
                <span style={{
                  fontSize: 12, fontWeight: 600, padding: '2px 9px', borderRadius: 20,
                  background: campos.length > 0 ? 'rgba(34,197,94,0.12)' : 'var(--bg-3)',
                  color: campos.length > 0 ? '#22c55e' : 'var(--text-3)',
                }}>
                  {campos.length} campo{campos.length !== 1 ? 's' : ''}
                </span>
              </div>
              {unlocked && (
                <button
                  onClick={() => openAdd(cfg)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '8px 16px', borderRadius: 10,
                    background: 'var(--green)', color: '#fff',
                    border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  <Plus size={14} /> Añadir campo
                </button>
              )}
            </div>

            {/* Columnas */}
            {campos.length > 0 && (
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto auto auto auto',
                padding: '6px 22px',
                background: 'var(--bg-2)',
                borderBottom: '1px solid var(--line)',
              }}>
                {['Campo', 'Tipo', 'Orden', '', ''].map((h, i) => (
                  <span key={i} style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</span>
                ))}
              </div>
            )}

            {/* Lista de campos */}
            {campos.length === 0 && (
              <p style={{ padding: '24px 22px', margin: 0, fontSize: 13, color: 'var(--text-3)' }}>
                No hay campos — haz clic en <strong>Añadir campo</strong> para crear el primero
              </p>
            )}
            {campos.map(c => (
              <CampoRow
                key={campoKey(c)}
                campo={c}
                onEdit={c => openEdit(cfg, c)}
                onDelete={c => handleDelete(cfg, c)}
                unlocked={unlocked}
              />
            ))}
          </div>
        )
      })}

      {/* Modal añadir / editar */}
      {modal && (
        <CampoModal
          cfg={modal.cfg}
          camposExistentes={Array.isArray(modal.cfg.campos) ? modal.cfg.campos : []}
          campoEditar={modal.campoEditar}
          onClose={closeModal}
          onSaved={onSaved}
        />
      )}

      {/* Modal de contraseña */}
      {pwdGate && (
        <PasswordGate
          onUnlocked={onUnlocked}
          onClose={() => setPwdGate(null)}
        />
      )}
    </div>
  )
}
