// Modal "Nueva nota" — permite enviar una nota a uno o varios
// receptores (trabajadores activos en Control Horario y/o clientes del centro).
//
// Backend: POST /api/notas/enviar. Por cada receptor crea una `cliente_nota`.
// Si fecha_entrega es futura, queda como recordatorio hasta esa fecha.
// fecha_vencimiento es opcional y se muestra como deadline en la nota.

import { useState, useEffect, useMemo } from 'react'
import { Send, Loader2, Check, X, Search } from 'lucide-react'
import Modal from '../Modal'
import { Btn, Badge } from '../UI'
import { useToast } from '../Toast'
import { getRoundIdentity } from '../../utils/configApi'
import { trabajadoresList } from '../../utils/horarioApi'
import { getClientes } from '../../utils/api'
import { enviarNota } from '../../utils/notasApi'
import { usuariosWebList } from '../../utils/authUsuarioApi'
import { coincideTexto } from '../../utils/texto'

const inputStyle = {
  width: '100%', padding: 10, borderRadius: 10, fontSize: 13,
  background: 'var(--bg-2)', border: '1px solid var(--line)', color: 'var(--text-0)',
}

function Field({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 12, color: 'var(--text-3)', marginBottom: 4 }}>{label}</label>
      {children}
      {hint && <p style={{ fontSize: 11, color: 'var(--text-3)', margin: '4px 0 0 0', lineHeight: 1.4 }}>{hint}</p>}
    </div>
  )
}


export default function EnviarNotaModal({ user, onClose, onSaved }) {
  const toast = useToast()
  const identity = useMemo(() => getRoundIdentity(user), [user])

  // Receptor: 'usuario_web' | 'trabajador' | 'cliente'
  const [tipo, setTipo] = useState('usuario_web')
  // Selección (lista de {tipo, id, nombre} para mostrar chips)
  const [seleccion, setSeleccion] = useState([])
  // Búsqueda en lista de candidatos
  const [busqueda, setBusqueda] = useState('')

  // Datos
  const [usuariosWeb, setUsuariosWeb] = useState([])
  const [trabajadores, setTrabajadores] = useState([])
  const [clientes, setClientes] = useState([])
  const [loadingU, setLoadingU] = useState(true)
  const [loadingT, setLoadingT] = useState(true)
  const [loadingC, setLoadingC] = useState(true)

  // Formulario
  const ahoraISO = new Date().toISOString().slice(0, 16) // YYYY-MM-DDTHH:MM
  const [contenido, setContenido] = useState('')
  const [fechaEntrega, setFechaEntrega] = useState(ahoraISO)
  const [fechaVencimiento, setFechaVencimiento] = useState('')
  const [saving, setSaving] = useState(false)

  // Cargar usuarios_web + trabajadores activos + clientes
  useEffect(() => {
    usuariosWebList(identity)
      .then(d => {
        const arr = (d.usuarios || d || []).filter(u => u.activo !== false)
        setUsuariosWeb(arr)
      })
      .catch(() => setUsuariosWeb([]))
      .finally(() => setLoadingU(false))
    trabajadoresList(identity, { estado: 'activo' })
      .then(arr => setTrabajadores(arr || []))
      .catch(() => setTrabajadores([]))
      .finally(() => setLoadingT(false))
    getClientes()
      .then(arr => setClientes((arr || []).filter(c => c.enabled !== false)))
      .catch(() => setClientes([]))
      .finally(() => setLoadingC(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Lista filtrada según tipo + búsqueda
  const candidatos = useMemo(() => {
    if (tipo === 'usuario_web') {
      // Set de emails de trabajadores activos → para marcar badge "Trabajador"
      const emailsTrabajadores = new Set(
        trabajadores.map(t => (t.email || '').toLowerCase()).filter(Boolean)
      )
      const lista = usuariosWeb.map(u => {
        const email = (u.email || '').toLowerCase()
        const nombreCompleto = `${u.nombre || ''} ${u.apellidos || ''}`.trim()
          || u.email || `Usuario ${u.id}`
        const esTrabajador = emailsTrabajadores.has(email)
        return {
          tipo: 'usuario_web', id: u.id,
          nombre: nombreCompleto,
          sub: (u.email || '') + (esTrabajador ? ' · Trabajador' : ''),
          es_trabajador: esTrabajador,
        }
      })
      if (!busqueda.trim()) return lista
      return lista.filter(x => coincideTexto(`${x.nombre} ${x.sub}`, busqueda))
    }
    if (tipo === 'trabajador') {
      const lista = trabajadores.map(t => ({
        tipo: 'trabajador', id: t.id,
        nombre: t.nombre_completo || `Trabajador ${t.id}`,
        sub: t.email || t.nif || '',
      }))
      if (!busqueda.trim()) return lista
      return lista.filter(x => coincideTexto(`${x.nombre} ${x.sub}`, busqueda))
    }
    const lista = clientes.map(c => ({
      tipo: 'cliente', id: c.id,
      nombre: `${c.name || ''} ${c.surname || ''}`.trim() || `Cliente ${c.id}`,
      sub: c.email || c.cellPhone || '',
    }))
    if (!busqueda.trim()) return lista.slice(0, 200) // capar para no congelar UI
    return lista.filter(x => coincideTexto(`${x.nombre} ${x.sub}`, busqueda)).slice(0, 100)
  }, [tipo, usuariosWeb, trabajadores, clientes, busqueda])

  const toggle = (cand) => {
    const key = `${cand.tipo}:${cand.id}`
    setSeleccion(prev =>
      prev.some(s => `${s.tipo}:${s.id}` === key)
        ? prev.filter(s => `${s.tipo}:${s.id}` !== key)
        : [...prev, cand]
    )
  }

  const handleSubmit = async () => {
    if (!contenido.trim()) { toast.error('Escribe el contenido de la nota'); return }
    if (seleccion.length === 0) { toast.error('Selecciona al menos un receptor'); return }
    setSaving(true)
    try {
      const r = await enviarNota(user, {
        contenido: contenido.trim(),
        destinatarios: seleccion.map(s => ({ tipo: s.tipo, id: s.id })),
        fecha_entrega: fechaEntrega || undefined,
        fecha_vencimiento: fechaVencimiento || undefined,
      })
      if ((r.errores || []).length > 0) {
        toast.error(`Nota enviada a ${r.creadas.length} receptor(es). ${r.errores.length} error(es)`)
      } else {
        toast.success(`Nota enviada a ${r.creadas.length} receptor(es)`)
      }
      onSaved && onSaved(r)
    } catch (e) {
      toast.error('Error: ' + (e.message || 'no se pudo enviar'))
    } finally { setSaving(false) }
  }

  return (
    <Modal open={true} onClose={onClose} maxWidth={620}
           title={<><Send size={16} style={{ marginRight: 6 }} /> Nueva nota</>}>
      <div style={{ padding: 24, flex: 1, overflowY: 'auto', minHeight: 0 }}>

        {/* 1) Receptores */}
        <Field label={`Receptor(es) — ${seleccion.length} seleccionado${seleccion.length === 1 ? '' : 's'}`}
               hint="Usuarios web del centro (gestores), trabajadores en alta laboral o clientes. Puedes mezclar tipos.">
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <Btn size="sm" variant={tipo === 'usuario_web' ? 'primary' : 'secondary'}
                 onClick={() => setTipo('usuario_web')}>
              Usuarios web
            </Btn>
            <Btn size="sm" variant={tipo === 'trabajador' ? 'primary' : 'secondary'}
                 onClick={() => setTipo('trabajador')}>
              Trabajadores
            </Btn>
            <Btn size="sm" variant={tipo === 'cliente' ? 'primary' : 'secondary'}
                 onClick={() => setTipo('cliente')}>
              Clientes
            </Btn>
          </div>
          <div style={{ position: 'relative', marginBottom: 8 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%',
                                        transform: 'translateY(-50%)', color: 'var(--text-3)' }} />
            <input value={busqueda} onChange={e => setBusqueda(e.target.value)}
                   placeholder={tipo === 'trabajador' ? 'Buscar trabajador…' : 'Buscar cliente por nombre/email/teléfono…'}
                   style={{ ...inputStyle, paddingLeft: 32 }} />
          </div>
          <div style={{
            border: '1px solid var(--line)', borderRadius: 10,
            background: 'var(--bg-2)', maxHeight: 220, overflowY: 'auto',
          }}>
            {(tipo === 'usuario_web' ? loadingU : tipo === 'trabajador' ? loadingT : loadingC) ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-3)' }}>
                <Loader2 size={16} className="animate-spin" />
              </div>
            ) : candidatos.length === 0 ? (
              <p style={{ padding: 12, fontSize: 12, color: 'var(--text-3)', margin: 0 }}>
                {tipo === 'usuario_web'
                  ? 'No hay usuarios web activos. Crea uno en Configuración → Usuarios web.'
                  : tipo === 'trabajador'
                  ? 'No hay trabajadores activos. Da de alta en Control horario → Trabajadores.'
                  : (busqueda ? 'Sin resultados.' : 'Escribe en el buscador para filtrar la lista.')}
              </p>
            ) : (
              candidatos.map(cand => {
                const key = `${cand.tipo}:${cand.id}`
                const checked = seleccion.some(s => `${s.tipo}:${s.id}` === key)
                return (
                  <label key={key}
                         style={{
                           display: 'flex', alignItems: 'center', gap: 10,
                           padding: '8px 12px', cursor: 'pointer', fontSize: 13,
                           borderBottom: '1px solid var(--line)',
                         }}>
                    <input type="checkbox" checked={checked} onChange={() => toggle(cand)} />
                    <span style={{ flex: 1 }}>
                      <strong>{cand.nombre}</strong>
                      {cand.sub && <span style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 6 }}>{cand.sub}</span>}
                    </span>
                  </label>
                )
              })
            )}
          </div>
          {seleccion.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {seleccion.map(s => {
                const colors = {
                  usuario_web: { bg: 'rgba(168,85,247,0.15)', fg: 'var(--purple, #a855f7)', emoji: '🧑‍💼' },
                  trabajador:  { bg: 'rgba(91,156,246,0.15)', fg: 'var(--blue, #5b9cf6)',   emoji: '👷' },
                  cliente:     { bg: 'rgba(45,212,168,0.15)', fg: 'var(--green)',           emoji: '👤' },
                }[s.tipo] || { bg: 'var(--bg-2)', fg: 'var(--text-1)', emoji: '•' }
                return (
                <span key={`${s.tipo}:${s.id}`} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '3px 8px', borderRadius: 12, fontSize: 11,
                  background: colors.bg, color: colors.fg,
                }}>
                  {colors.emoji} {s.nombre}
                  <button onClick={() => toggle(s)}
                          style={{ background: 'none', border: 'none', padding: 0,
                                   cursor: 'pointer', color: 'currentColor' }}>
                    <X size={11} />
                  </button>
                </span>
                )
              })}
            </div>
          )}
        </Field>

        {/* 2) Contenido */}
        <Field label="Mensaje *">
          <textarea value={contenido} onChange={e => setContenido(e.target.value)}
                    rows={5} placeholder="Escribe la nota…"
                    style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
        </Field>

        {/* 3) Fechas */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Fecha de entrega"
                 hint="Por defecto ahora. Si pones una fecha futura, la nota se silencia hasta esa fecha.">
            <input type="datetime-local" value={fechaEntrega}
                   onChange={e => setFechaEntrega(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="Fecha de vencimiento (opcional)"
                 hint="Deadline visible en la nota. No silencia ni borra.">
            <input type="date" value={fechaVencimiento}
                   onChange={e => setFechaVencimiento(e.target.value)} style={inputStyle} />
          </Field>
        </div>

      </div>

      <div style={{ padding: '16px 24px', borderTop: '1px solid var(--line)',
                    display: 'flex', gap: 10, justifyContent: 'flex-end',
                    flexShrink: 0, background: 'var(--bg-2)' }}>
        <Btn variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Btn>
        <Btn variant="primary" onClick={handleSubmit} disabled={saving || seleccion.length === 0}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          {' Enviar nota'}
        </Btn>
      </div>
    </Modal>
  )
}
