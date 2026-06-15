// Pestaña "Pagadores" (docs/PLAN_PAGADOR.md — F2).
// Un pagador cede su instrumento (IBAN si SEPA / token si tarjeta) para que se
// carguen en su cuenta los recibos de uno o varios clientes de UN trainer.
// Aquí: alta de pagador, selección de clientes que paga (alta/baja) y
// modificación del mandato/instrumento. La factura sigue siendo del cliente.
import { useState, useEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Plus, Pencil, Trash2, X, UserPlus, UserMinus, Search, CreditCard, Landmark } from 'lucide-react'
import { Card, Btn, SectionTitle, Badge } from '../../components/UI'
import { useToast } from '../../components/Toast'
import { useCan } from '../../hooks/useCan'
import {
  pagadoresList, pagadorCreate, pagadorUpdate, pagadorDelete,
  pagadorClientes, pagadorAddClientes, pagadorBajaCliente, centrosList,
} from '../../utils/configApi'
import { getClientes } from '../../utils/api'

const inp = {
  width: '100%', padding: 8, borderRadius: 8, fontSize: 13,
  background: 'var(--bg-2)', border: '1px solid var(--line)', color: 'var(--text-0)',
}
const mask = (s) => s ? ('••••' + String(s).slice(-4)) : '—'


export default function PagadoresTab({ identity }) {
  const toast = useToast()
  const canEditar = useCan('cuotas_clientes.pagadores.editar')
  const [pagadores, setPagadores] = useState([])
  const [loading, setLoading] = useState(true)
  const [centros, setCentros] = useState([])
  const [showNuevo, setShowNuevo] = useState(false)
  const [detalle, setDetalle] = useState(null)   // pagador en detalle

  const load = useCallback(() => {
    setLoading(true)
    pagadoresList(identity)
      .then(setPagadores)
      .catch(e => toast.error(`Error: ${e.message}`))
      .finally(() => setLoading(false))
  }, [identity])

  useEffect(() => { load() }, [load])
  useEffect(() => { centrosList(identity).then(setCentros).catch(() => setCentros([])) }, [identity])

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <SectionTitle>Pagadores</SectionTitle>
        {canEditar && (
          <Btn variant="primary" size="sm" onClick={() => setShowNuevo(true)}>
            <Plus size={13} /> Nuevo pagador
          </Btn>
        )}
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: -6, marginBottom: 16 }}>
        Un pagador cede su IBAN (SEPA) o tarjeta (tokenizada) para cargar en su cuenta los recibos
        de los clientes que paga. La factura sigue siendo de cada cliente.
      </p>

      {loading ? (
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-3)' }}>
          <Loader2 size={18} className="animate-spin" /> Cargando…
        </div>
      ) : pagadores.length === 0 ? (
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-3)' }}>
          No hay pagadores. {canEditar && 'Crea uno con "Nuevo pagador".'}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {pagadores.map(p => (
            <div key={p.id} onClick={() => setDetalle(p)}
                 style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                          background: 'var(--bg-2)', border: '1px solid var(--line)',
                          borderRadius: 10, cursor: 'pointer' }}>
              {p.forma_pago === 'sepa'
                ? <Landmark size={16} style={{ color: 'var(--green)' }} />
                : <CreditCard size={16} style={{ color: 'var(--green)' }} />}
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, color: 'var(--text-0)' }}>
                  {p.nombre} {p.nif && <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>· {p.nif}</span>}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                  {p.forma_pago === 'sepa' ? `IBAN ${p.iban || '—'}` : `tarjeta ${p.card_last4 ? '••••' + p.card_last4 : ''}`}
                  {' · trainer '}{p.id_trainer}
                </div>
              </div>
              <Badge>{p.n_clientes ?? 0} cliente(s)</Badge>
              {p.estado !== 'activo' && <Badge variant="muted">{p.estado}</Badge>}
            </div>
          ))}
        </div>
      )}

      {showNuevo && (
        <NuevoPagadorModal
          identity={identity} centros={centros}
          onClose={() => setShowNuevo(false)}
          onCreated={() => { setShowNuevo(false); load() }}
        />
      )}
      {detalle && (
        <DetallePagadorModal
          identity={identity} pagador={detalle} canEditar={canEditar}
          onClose={() => setDetalle(null)}
          onChanged={load}
        />
      )}
    </Card>
  )
}


function NuevoPagadorModal({ identity, centros, onClose, onCreated }) {
  const toast = useToast()
  const [saving, setSaving] = useState(false)
  const trainerFijo = identity.trainerId ? String(identity.trainerId) : null
  const [f, setF] = useState({
    nombre: '', nif: '', forma_pago: 'sepa',
    id_trainer: trainerFijo || (centros[0]?.id_trainer ? String(centros[0].id_trainer) : ''),
    iban: '', iban_titular: '', bic: '', mandate_ref: '',
    card_token: '', card_brand: '', card_last4: '',
  })
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))

  const submit = async () => {
    if (!f.nombre.trim()) return toast.error('Nombre requerido')
    if (!f.id_trainer) return toast.error('Selecciona el trainer')
    setSaving(true)
    try {
      await pagadorCreate(identity, f)
      toast.success('Pagador creado')
      onCreated()
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setSaving(false)
  }

  return <Modal title="Nuevo pagador" onClose={saving ? null : onClose}>
    <Fld label="Nombre del pagador">
      <input style={inp} value={f.nombre} onChange={e => set('nombre', e.target.value)} />
    </Fld>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <Fld label="NIF/DNI"><input style={inp} value={f.nif} onChange={e => set('nif', e.target.value)} /></Fld>
      <Fld label="Trainer">
        {trainerFijo
          ? <input style={{ ...inp, opacity: .6 }} value={trainerFijo} disabled />
          : <select style={inp} value={f.id_trainer} onChange={e => set('id_trainer', e.target.value)}>
              <option value="">—</option>
              {centros.map(c => <option key={c.id_trainer} value={c.id_trainer}>
                {c.nombre_centro || c.id_trainer} ({c.id_trainer})</option>)}
            </select>}
      </Fld>
    </div>
    <Fld label="Forma de pago">
      <select style={inp} value={f.forma_pago} onChange={e => set('forma_pago', e.target.value)}>
        <option value="sepa">SEPA (IBAN)</option>
        <option value="tarjeta_token">Tarjeta tokenizada</option>
      </select>
    </Fld>
    {f.forma_pago === 'sepa' ? (
      <>
        <Fld label="IBAN"><input style={{ ...inp, fontFamily: 'var(--font-mono)' }}
              value={f.iban} onChange={e => set('iban', e.target.value)} placeholder="ESxx ..." /></Fld>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
          <Fld label="Titular"><input style={inp} value={f.iban_titular} onChange={e => set('iban_titular', e.target.value)} /></Fld>
          <Fld label="Ref. mandato"><input style={inp} value={f.mandate_ref} onChange={e => set('mandate_ref', e.target.value)} /></Fld>
        </div>
      </>
    ) : (
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
        <Fld label="Token tarjeta"><input style={inp} value={f.card_token} onChange={e => set('card_token', e.target.value)} /></Fld>
        <Fld label="Marca"><input style={inp} value={f.card_brand} onChange={e => set('card_brand', e.target.value)} /></Fld>
        <Fld label="Últimos 4"><input style={inp} maxLength={4} value={f.card_last4} onChange={e => set('card_last4', e.target.value)} /></Fld>
      </div>
    )}
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
      <Btn variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Btn>
      <Btn variant="primary" onClick={submit} disabled={saving}>
        {saving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Crear
      </Btn>
    </div>
  </Modal>
}


function DetallePagadorModal({ identity, pagador, canEditar, onClose, onChanged }) {
  const toast = useToast()
  const [clientes, setClientes] = useState([])
  const [loading, setLoading] = useState(true)
  const [editMandato, setEditMandato] = useState(false)
  const [picker, setPicker] = useState(false)

  const loadCli = useCallback(() => {
    setLoading(true)
    pagadorClientes(identity, pagador.id)
      .then(rows => setClientes(rows.filter(c => c.estado === 'activo')))
      .catch(e => toast.error(`Error: ${e.message}`))
      .finally(() => setLoading(false))
  }, [identity, pagador.id])
  useEffect(() => { loadCli() }, [loadCli])

  const baja = async (idnoofit) => {
    try {
      const r = await pagadorBajaCliente(identity, pagador.id, idnoofit)
      toast.success(r.aviso || 'Cliente dado de baja del pagador')
      loadCli(); onChanged?.()
    } catch (e) { toast.error(`Error: ${e.message}`) }
  }

  return <Modal title={`Pagador · ${pagador.nombre}`} onClose={onClose} wide>
    <div style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', marginBottom: 12 }}>
      {pagador.forma_pago === 'sepa' ? `IBAN ${pagador.iban || '—'} · mandato ${pagador.mandate_ref || '—'}`
        : `tarjeta ${pagador.card_last4 ? '••••' + pagador.card_last4 : '—'}`}
      {' · trainer '}{pagador.id_trainer}
      {canEditar && <Btn variant="ghost" size="xs" style={{ marginLeft: 10 }} onClick={() => setEditMandato(true)}>
        <Pencil size={11} /> Modificar mandato/instrumento</Btn>}
    </div>

    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
      <strong style={{ fontSize: 13 }}>Clientes que paga ({clientes.length})</strong>
      {canEditar && <Btn variant="secondary" size="sm" onClick={() => setPicker(true)}>
        <UserPlus size={13} /> Añadir clientes</Btn>}
    </div>
    {loading ? <div style={{ padding: 16, color: 'var(--text-3)' }}><Loader2 size={14} className="animate-spin" /></div>
      : clientes.length === 0 ? <div style={{ padding: 16, color: 'var(--text-3)', fontSize: 13 }}>Sin clientes asignados.</div>
      : <div style={{ display: 'grid', gap: 6 }}>
          {clientes.map(c => (
            <div key={c.cliente_idnoofit} style={{ display: 'flex', alignItems: 'center', gap: 10,
                   padding: '8px 12px', background: 'var(--bg-2)', borderRadius: 8, fontSize: 13 }}>
              <span style={{ flex: 1, fontFamily: 'var(--font-mono)' }}>cliente {c.cliente_idnoofit}</span>
              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>desde {String(c.fecha_inicio).slice(0, 10)}</span>
              {canEditar && <Btn variant="ghost" size="xs" onClick={() => baja(c.cliente_idnoofit)} title="Baja (vuelve a auto-pago)">
                <UserMinus size={12} /> Baja</Btn>}
            </div>
          ))}
        </div>}

    {editMandato && <EditarMandatoModal identity={identity} pagador={pagador}
        onClose={() => setEditMandato(false)}
        onSaved={() => { setEditMandato(false); onChanged?.() }} />}
    {picker && <ClientePicker identity={identity} pagador={pagador} yaAsignados={clientes.map(c => c.cliente_idnoofit)}
        onClose={() => setPicker(false)}
        onAdded={() => { setPicker(false); loadCli(); onChanged?.() }} />}
  </Modal>
}


function EditarMandatoModal({ identity, pagador, onClose, onSaved }) {
  const toast = useToast()
  const [saving, setSaving] = useState(false)
  const [f, setF] = useState({
    forma_pago: pagador.forma_pago,
    iban: '', mandate_ref: pagador.mandate_ref || '', iban_titular: '', bic: '',
    card_token: '', card_brand: '', card_last4: '',
  })
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const submit = async () => {
    setSaving(true)
    try {
      // Solo enviamos los campos del instrumento (re-introducir IBAN/token completo).
      const body = { forma_pago: f.forma_pago }
      if (f.forma_pago === 'sepa') Object.assign(body, { iban: f.iban, mandate_ref: f.mandate_ref, iban_titular: f.iban_titular, bic: f.bic })
      else Object.assign(body, { card_token: f.card_token, card_brand: f.card_brand, card_last4: f.card_last4 })
      await pagadorUpdate(identity, pagador.id, body)
      toast.success('Mandato/instrumento actualizado')
      onSaved()
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setSaving(false)
  }
  return <Modal title="Modificar mandato/instrumento" onClose={saving ? null : onClose}>
    <p style={{ fontSize: 12, color: 'var(--text-3)' }}>Re-introduce el instrumento completo (no se muestra el actual por seguridad).</p>
    <Fld label="Forma de pago">
      <select style={inp} value={f.forma_pago} onChange={e => set('forma_pago', e.target.value)}>
        <option value="sepa">SEPA (IBAN)</option>
        <option value="tarjeta_token">Tarjeta tokenizada</option>
      </select>
    </Fld>
    {f.forma_pago === 'sepa' ? (
      <>
        <Fld label="IBAN nuevo"><input style={{ ...inp, fontFamily: 'var(--font-mono)' }} value={f.iban} onChange={e => set('iban', e.target.value)} /></Fld>
        <Fld label="Ref. mandato"><input style={inp} value={f.mandate_ref} onChange={e => set('mandate_ref', e.target.value)} /></Fld>
      </>
    ) : (
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
        <Fld label="Token"><input style={inp} value={f.card_token} onChange={e => set('card_token', e.target.value)} /></Fld>
        <Fld label="Marca"><input style={inp} value={f.card_brand} onChange={e => set('card_brand', e.target.value)} /></Fld>
        <Fld label="Últ. 4"><input style={inp} maxLength={4} value={f.card_last4} onChange={e => set('card_last4', e.target.value)} /></Fld>
      </div>
    )}
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
      <Btn variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Btn>
      <Btn variant="primary" onClick={submit} disabled={saving}>Guardar</Btn>
    </div>
  </Modal>
}


function ClientePicker({ identity, pagador, yaAsignados, onClose, onAdded }) {
  const toast = useToast()
  const [q, setQ] = useState('')
  const [todos, setTodos] = useState([])
  const [sel, setSel] = useState(new Set())
  const [saving, setSaving] = useState(false)
  useEffect(() => { getClientes().then(cs => setTodos(cs || [])).catch(() => setTodos([])) }, [])

  const ya = useMemo(() => new Set(yaAsignados.map(String)), [yaAsignados])
  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase()
    return todos
      .filter(c => !ya.has(String(c.id)))
      .filter(c => !t || `${c.name || ''} ${c.surname || ''} ${c.id}`.toLowerCase().includes(t))
      .slice(0, 50)
  }, [todos, q, ya])

  const toggle = (id) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const submit = async () => {
    if (sel.size === 0) return
    setSaving(true)
    try {
      const r = await pagadorAddClientes(identity, pagador.id, [...sel])
      const nErr = (r.errores || []).length
      toast.success(`Añadidos ${r.añadidos?.length || 0}` + (nErr ? ` · ${nErr} con error (ya tienen pagador u otro trainer)` : ''))
      onAdded()
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setSaving(false)
  }
  return <Modal title="Añadir clientes al pagador" onClose={saving ? null : onClose} wide>
    <div style={{ position: 'relative', marginBottom: 10 }}>
      <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-3)' }} />
      <input style={{ ...inp, paddingLeft: 32 }} placeholder="Buscar cliente por nombre o id…"
             value={q} onChange={e => setQ(e.target.value)} autoFocus />
    </div>
    <div style={{ maxHeight: '40vh', overflowY: 'auto', display: 'grid', gap: 4 }}>
      {filtrados.map(c => (
        <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px',
               background: sel.has(String(c.id)) ? 'var(--green-soft, rgba(45,212,168,.12))' : 'var(--bg-2)',
               borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
          <input type="checkbox" checked={sel.has(String(c.id))} onChange={() => toggle(String(c.id))} />
          <span style={{ flex: 1 }}>{c.name} {c.surname}</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)' }}>#{c.id}</span>
        </label>
      ))}
      {filtrados.length === 0 && <div style={{ padding: 14, color: 'var(--text-3)', fontSize: 13 }}>Sin resultados.</div>}
    </div>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
      <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{sel.size} seleccionado(s)</span>
      <div style={{ display: 'flex', gap: 8 }}>
        <Btn variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Btn>
        <Btn variant="primary" onClick={submit} disabled={saving || sel.size === 0}>
          {saving ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />} Añadir
        </Btn>
      </div>
    </div>
  </Modal>
}


function Fld({ label, children }) {
  return <div style={{ marginBottom: 12 }}>
    <label style={{ display: 'block', fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>{label}</label>
    {children}
  </div>
}

function Modal({ title, onClose, children, wide }) {
  return createPortal(
    <div role="dialog" aria-modal="true" onClick={() => onClose && onClose()}
         style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 10000,
                  display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()}
           style={{ background: 'var(--bg-1)', borderRadius: 12, maxWidth: wide ? 680 : 520, width: '94%',
                    maxHeight: '92vh', overflowY: 'auto', border: '1px solid var(--line)',
                    boxShadow: '0 12px 40px rgba(0,0,0,.35)', color: 'var(--text-0)' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line)', display: 'flex',
                      alignItems: 'center', justifyContent: 'space-between' }}>
          <strong style={{ fontSize: 15 }}>{title}</strong>
          {onClose && <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)' }}><X size={18} /></button>}
        </div>
        <div style={{ padding: 20 }}>{children}</div>
      </div>
    </div>, document.body)
}
