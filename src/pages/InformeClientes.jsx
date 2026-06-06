// Informe agregado de clientes: tabla con nombre, teléfono, forma de pago,
// estado (alta/baja), categoría, con/sin curso, descuentos y modificaciones.
//
// Pensado para que el operador pueda echar un vistazo rápido a TODOS los
// clientes y filtrar/exportar a Excel. Backend: /api/informes/clientes.

import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ClipboardList, Search, Download, Loader2, CheckCircle2, XCircle, AlertCircle,
  ArrowUp, ArrowDown, ArrowUpDown,
} from 'lucide-react'
import { Card, Btn, Badge, SectionTitle } from '../components/UI'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../components/Toast'
import { getRoundIdentity, centrosList } from '../utils/configApi'
import { coincideTexto, igualTexto } from '../utils/texto'

const CONFIG_API_TOKEN = import.meta.env.VITE_CONFIG_API_TOKEN || ''

/**
 * Construye los headers de autenticación. Hay 2 vías:
 *   - usuario_web: usa Authorization Bearer con el JWT propio (user.jwt).
 *   - manager NoofitPro: usa X-Round-Token + X-Round-Manager-Id.
 *
 * `getRoundIdentity(user)` NO devuelve `jwt`, así que lo leemos del `user`
 * crudo. Sin esto, el endpoint informe_clientes recibía headers de manager
 * en sesiones usuario_web → devolvía HTML 401 (login redirect) que el
 * frontend intentaba parsear como JSON → "Unexpected token '<'".
 */
function buildHeaders(user, identity) {
  if (user?.kind === 'usuario_web' && user?.jwt) {
    return { 'Authorization': `Bearer ${user.jwt}` }
  }
  return {
    'X-Round-Token': CONFIG_API_TOKEN,
    'X-Round-Manager-Id': identity?.managerId || '',
    ...(identity?.trainerId ? { 'X-Round-Trainer-Id': String(identity.trainerId) } : {}),
  }
}


export default function InformeClientes() {
  const { user } = useAuth()
  const identity = useMemo(() => getRoundIdentity(user), [user])
  const navigate = useNavigate()
  const toast = useToast()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [solo, setSolo] = useState('activos')   // activos | todos | bajas
  const [q, setQ] = useState('')
  const [filtroForma, setFiltroForma] = useState('')
  const [filtroCategoria, setFiltroCategoria] = useState('')
  const [filtroCurso, setFiltroCurso] = useState('')  // 'con' | 'sin' | ''
  const [filtroPeriodicidad, setFiltroPeriodicidad] = useState('')
  const [proximoDesde, setProximoDesde] = useState('')
  const [proximoHasta, setProximoHasta] = useState('')
  // Ordenación clickable por columna. sortKey = '' significa orden por
  // defecto del backend (apellido/nombre). sortDir alterna asc/desc.
  const [sortKey, setSortKey] = useState('')
  const [sortDir, setSortDir] = useState('asc')
  // Centros (trainers) — los clientes son del trainer, no del manager.
  // Si el usuario está impersonando un trainer concreto (identity.trainerId),
  // arrancamos pre-filtrados a ese centro. Si es admin del manager (sin
  // trainer), inicialmente '' = ver todos y filtra a mano.
  const [centros, setCentros] = useState([])
  const [filtroCentro, setFiltroCentro] = useState(
    identity?.trainerId ? String(identity.trainerId) : '')
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    if (!identity?.managerId) return
    centrosList(identity).then(setCentros).catch(() => setCentros([]))
  }, [identity?.managerId])

  useEffect(() => {
    if (!identity?.managerId) return
    setLoading(true)
    const params = new URLSearchParams()
    if (solo === 'activos') params.set('solo_activos', '1')
    if (filtroCentro) params.set('trainer', filtroCentro)
    const qs = params.toString() ? `?${params}` : ''
    fetch(`/api/informes/clientes${qs}`, { headers: buildHeaders(user, identity) })
      .then(r => r.json())
      .then(d => setRows(d.rows || []))
      .catch(e => toast.error('Error cargando informe: ' + e.message))
      .finally(() => setLoading(false))
  }, [identity?.managerId, solo, filtroCentro])

  const filtered = useMemo(() => {
    let f = rows
    if (solo === 'bajas') f = f.filter(r => !r.enabled)
    if (q.trim()) {
      // Búsqueda case+accent-insensitive (centralizada en utils/texto.js).
      // "Jimenez" matchea "Jiménez", "MARIA" matchea "María", etc.
      f = f.filter(r =>
        coincideTexto(`${r.nombre || ''} ${r.apellidos || ''}`, q) ||
        coincideTexto(r.email, q) ||
        // Teléfono: comparar dígitos sin acentos (norm igual)
        coincideTexto(r.telefono, q) ||
        coincideTexto(r.dni, q))
    }
    // Forma_pago y curso son enums internos (sepa/efectivo/...) — exact OK.
    if (filtroForma) f = f.filter(r => r.forma_pago === filtroForma)
    // Categoría también acent-insensitive para tolerar futuras variaciones
    // de tipeo en el nombre de categoría.
    if (filtroCategoria) f = f.filter(r => igualTexto(r.categoria, filtroCategoria))
    if (filtroCurso === 'con') f = f.filter(r => r.con_curso)
    if (filtroCurso === 'sin') f = f.filter(r => !r.con_curso)
    if (filtroPeriodicidad) f = f.filter(r => (r.periodicidad || '').split(', ').includes(filtroPeriodicidad))
    if (proximoDesde) f = f.filter(r => r.fecha_proximo_pago && r.fecha_proximo_pago >= proximoDesde)
    if (proximoHasta) f = f.filter(r => r.fecha_proximo_pago && r.fecha_proximo_pago <= proximoHasta)
    // Ordenación clickable por cualquier columna. `sortKey` se actualiza al
    // pulsar cualquier <Th sortable>. `sortDir` alterna asc/desc al re-clickar
    // la misma columna. Default: por apellidos/nombre asc (mantenemos el
    // orden que devuelve el backend).
    if (sortKey) {
      const cmp = (a, b) => {
        let va = a[sortKey]
        let vb = b[sortKey]
        // Para nombre, combinamos nombre + apellidos para un orden natural.
        if (sortKey === 'nombre_completo') {
          va = `${a.apellidos || ''} ${a.nombre || ''}`
          vb = `${b.apellidos || ''} ${b.nombre || ''}`
        }
        // Booleans → comparar como 0/1
        if (typeof va === 'boolean' || typeof vb === 'boolean') {
          return (Number(!!va) - Number(!!vb))
        }
        // Strings (case-insensitive) — null/undefined al final
        const sa = (va == null || va === '') ? '￿' : String(va).toLowerCase()
        const sb = (vb == null || vb === '') ? '￿' : String(vb).toLowerCase()
        return sa.localeCompare(sb, 'es', { numeric: true })
      }
      f = [...f].sort((a, b) => sortDir === 'asc' ? cmp(a, b) : cmp(b, a))
    }
    return f
  }, [rows, q, filtroForma, filtroCategoria, filtroCurso, filtroPeriodicidad, proximoDesde, proximoHasta, solo, sortKey, sortDir])

  const categorias = useMemo(
    () => [...new Set(rows.map(r => r.categoria).filter(Boolean))].sort(),
    [rows]
  )
  // Mapa id_trainer → nombre centro (para mostrar en la columna Centro)
  const centroPorId = useMemo(
    () => Object.fromEntries(centros.map(c => [String(c.id_trainer), c.nombre_centro || `Centro ${c.id_trainer}`])),
    [centros]
  )

  const downloadExcel = async () => {
    setDownloading(true)
    try {
      const params = new URLSearchParams()
      if (solo === 'activos') params.set('solo_activos', '1')
      if (filtroCentro) params.set('trainer', filtroCentro)
      const qs = params.toString() ? `?${params}` : ''
      const r = await fetch(`/api/informes/clientes/excel${qs}`, { headers: buildHeaders(user, identity) })
      if (!r.ok) throw new Error('HTTP ' + r.status)
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `informe_clientes_${new Date().toISOString().slice(0,10)}.xlsx`
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) { toast.error('Error descargando Excel: ' + e.message) }
    finally { setDownloading(false) }
  }

  // Click en cabecera: primera vez ordena ascendente; segunda vez la MISMA
  // columna invierte a descendente; tercera vez quita el sort (vuelve al
  // orden por defecto del backend).
  const onSort = (k) => {
    if (sortKey !== k) {
      setSortKey(k); setSortDir('asc'); return
    }
    if (sortDir === 'asc') { setSortDir('desc'); return }
    setSortKey(''); setSortDir('asc')
  }

  const fmtForma = (f) => {
    if (!f) return '—'
    return ({ sepa: 'SEPA', tarjeta_token: 'Tarjeta', efectivo: 'Efectivo', enlace_pago: 'Enlace' })[f] || f
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <ClipboardList size={22} aria-hidden="true" />
        <h1 style={{ fontFamily: 'Outfit', fontSize: 26, fontWeight: 700, color: 'var(--text-0)', margin: 0 }}>
          Informe de clientes
        </h1>
      </div>

      <Card style={{ padding: 18, marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, alignItems: 'end' }}>
          <Field label="Buscar">
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%',
                                          transform: 'translateY(-50%)', color: 'var(--text-3)' }} />
              <input value={q} onChange={e => setQ(e.target.value)}
                     placeholder="Nombre, email, teléfono, DNI"
                     style={{ ...inputStyle, paddingLeft: 32 }} />
            </div>
          </Field>
          <Field label="Centro (trainer)">
            <select value={filtroCentro} onChange={e => setFiltroCentro(e.target.value)} style={inputStyle}>
              <option value="">— Todos los centros —</option>
              {centros.map(c => (
                <option key={c.id_trainer} value={c.id_trainer}>
                  {c.nombre_centro || `Centro ${c.id_trainer}`}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Estado">
            <select value={solo} onChange={e => setSolo(e.target.value)} style={inputStyle}>
              <option value="activos">Solo activos</option>
              <option value="todos">Todos (incluye bajas)</option>
              <option value="bajas">Solo bajas</option>
            </select>
          </Field>
          <Field label="Forma de pago">
            <select value={filtroForma} onChange={e => setFiltroForma(e.target.value)} style={inputStyle}>
              <option value="">— Cualquiera —</option>
              <option value="sepa">SEPA</option>
              <option value="efectivo">Efectivo</option>
              <option value="tarjeta_token">Tarjeta tokenizada</option>
              <option value="enlace_pago">Enlace de pago</option>
            </select>
          </Field>
          <Field label="Categoría">
            <select value={filtroCategoria} onChange={e => setFiltroCategoria(e.target.value)} style={inputStyle}>
              <option value="">— Cualquiera —</option>
              {categorias.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Curso">
            <select value={filtroCurso} onChange={e => setFiltroCurso(e.target.value)} style={inputStyle}>
              <option value="">— Cualquiera —</option>
              <option value="con">Con curso (sub activa)</option>
              <option value="sin">Sin curso</option>
            </select>
          </Field>
          <Field label="Periodicidad">
            <select value={filtroPeriodicidad} onChange={e => setFiltroPeriodicidad(e.target.value)} style={inputStyle}>
              <option value="">— Cualquiera —</option>
              <option value="mensual">Mensual</option>
              <option value="trimestral">Trimestral</option>
              <option value="semestral">Semestral</option>
              <option value="anual">Anual</option>
            </select>
          </Field>
          <Field label="Próximo pago desde">
            <input type="date" value={proximoDesde}
                   onChange={e => setProximoDesde(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="Próximo pago hasta">
            <input type="date" value={proximoHasta}
                   onChange={e => setProximoHasta(e.target.value)} style={inputStyle} />
          </Field>
          <Btn variant="primary" size="md" onClick={downloadExcel} disabled={downloading}>
            {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            {' Excel'}
          </Btn>
        </div>
      </Card>

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <strong style={{ fontSize: 13, color: 'var(--text-2)' }}>
            {filtered.length} cliente{filtered.length !== 1 ? 's' : ''}
            {filtered.length !== rows.length && ` (de ${rows.length} totales)`}
          </strong>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)' }}>
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)' }}>
            Sin resultados con estos filtros.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'var(--bg-2)', textAlign: 'left' }}>
                  <Th sortKey="nombre"          current={sortKey} dir={sortDir} onSort={onSort}>Nombre</Th>
                  <Th sortKey="apellidos"       current={sortKey} dir={sortDir} onSort={onSort}>Apellidos</Th>
                  <Th sortKey="id_trainer"      current={sortKey} dir={sortDir} onSort={onSort}>Centro</Th>
                  <Th sortKey="telefono"        current={sortKey} dir={sortDir} onSort={onSort}>Teléfono</Th>
                  <Th sortKey="estado"          current={sortKey} dir={sortDir} onSort={onSort}>Estado</Th>
                  <Th sortKey="categoria"       current={sortKey} dir={sortDir} onSort={onSort}>Categoría</Th>
                  <Th sortKey="forma_pago"      current={sortKey} dir={sortDir} onSort={onSort}>Forma pago</Th>
                  <Th sortKey="periodicidad"    current={sortKey} dir={sortDir} onSort={onSort}>Periodicidad</Th>
                  <Th sortKey="fecha_proximo_pago" current={sortKey} dir={sortDir} onSort={onSort}>Próximo pago</Th>
                  <Th sortKey="con_curso"       current={sortKey} dir={sortDir} onSort={onSort}>Curso</Th>
                  <Th sortKey="descuentos"      current={sortKey} dir={sortDir} onSort={onSort}>Descuentos</Th>
                  <Th sortKey="tiene_modificacion" current={sortKey} dir={sortDir} onSort={onSort}>Modificación</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id}
                      onClick={() => navigate(`/clientes/${r.id}`)}
                      style={{ borderTop: '1px solid var(--line)', cursor: 'pointer',
                               transition: 'background 0.1s' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-2)'}
                      onMouseLeave={e => e.currentTarget.style.background = ''}>
                    <Td>
                      <div style={{ fontWeight: 600 }}>{r.nombre || <span style={{ color: 'var(--text-3)' }}>—</span>}</div>
                      {r.email && <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{r.email}</div>}
                    </Td>
                    <Td>
                      <div style={{ fontWeight: 600 }}>{r.apellidos || <span style={{ color: 'var(--text-3)' }}>—</span>}</div>
                    </Td>
                    <Td>
                      {r.id_trainer
                        ? <span style={{ fontSize: 12 }}>
                            {centroPorId[String(r.id_trainer)] || `Centro ${r.id_trainer}`}
                          </span>
                        : <span style={{ color: 'var(--text-3)' }}>—</span>}
                    </Td>
                    <Td mono>{r.telefono || '—'}</Td>
                    <Td>
                      {r.enabled
                        ? <Badge color="green"><CheckCircle2 size={9} /> Activo</Badge>
                        : <Badge color="gray"><XCircle size={9} /> Baja</Badge>}
                    </Td>
                    <Td>{r.categoria || <span style={{ color: 'var(--text-3)' }}>—</span>}</Td>
                    <Td>
                      {r.forma_pago
                        ? <Badge color={r.forma_pago === 'sepa' ? 'blue' : 'gray'}>{fmtForma(r.forma_pago)}</Badge>
                        : <span style={{ color: 'var(--text-3)' }}>—</span>}
                    </Td>
                    <Td>{r.periodicidad
                          ? <span style={{ fontSize: 11 }}>{r.periodicidad}</span>
                          : <span style={{ color: 'var(--text-3)' }}>—</span>}</Td>
                    <Td mono>{r.fecha_proximo_pago || <span style={{ color: 'var(--text-3)', fontFamily: 'var(--font-sans)' }}>—</span>}</Td>
                    <Td>
                      {r.con_curso
                        ? <Badge color="green">Sí</Badge>
                        : <span style={{ color: 'var(--text-3)' }}>No</span>}
                    </Td>
                    <Td title={r.descuentos}>
                      {r.descuentos
                        ? <span style={{ fontSize: 11 }}>{r.descuentos.length > 40
                            ? r.descuentos.slice(0, 40) + '…' : r.descuentos}</span>
                        : <span style={{ color: 'var(--text-3)' }}>—</span>}
                    </Td>
                    <Td>
                      {r.tiene_modificacion
                        ? <Badge color="amber"><AlertCircle size={9} /> {r.modificaciones_tipos}</Badge>
                        : <span style={{ color: 'var(--text-3)' }}>—</span>}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

const inputStyle = {
  width: '100%', padding: '8px 10px', borderRadius: 10, fontSize: 13,
  background: 'var(--bg-2)', border: '1px solid var(--line)', color: 'var(--text-0)',
}

function Field({ label, children }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, color: 'var(--text-3)',
                      textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
        {label}
      </label>
      {children}
    </div>
  )
}

function Th({ children, sortKey, current, dir, onSort }) {
  // Si tiene sortKey + onSort → clickable. Muestra flecha del estado actual:
  //   - sin orden:  ↕ (doble flecha sutil)
  //   - asc activo: ↑
  //   - desc activo: ↓
  const sortable = !!(sortKey && onSort)
  const isActive = current === sortKey
  const Icon = !sortable ? null
    : isActive
      ? (dir === 'asc' ? ArrowUp : ArrowDown)
      : ArrowUpDown
  return (
    <th style={{ padding: '10px 12px', fontSize: 11, fontWeight: 600,
                  color: isActive ? 'var(--green)' : 'var(--text-3)',
                  textTransform: 'uppercase', letterSpacing: '0.04em',
                  cursor: sortable ? 'pointer' : 'default',
                  userSelect: 'none', whiteSpace: 'nowrap' }}
        onClick={sortable ? () => onSort(sortKey) : undefined}
        title={sortable ? 'Pulsa para ordenar' : undefined}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {children}
        {Icon && <Icon size={11} style={{ opacity: isActive ? 1 : 0.4 }} aria-hidden="true" />}
      </span>
    </th>
  )
}

function Td({ children, mono = false, title }) {
  return (
    <td title={title} style={{
      padding: '10px 12px',
      fontFamily: mono ? 'var(--font-mono, monospace)' : 'inherit',
      fontSize: 12, color: 'var(--text-1)',
    }}>{children}</td>
  )
}
