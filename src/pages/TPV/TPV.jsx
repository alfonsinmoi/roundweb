// TPV — Terminal de Caja operativo (Fase 2, mayo 2026).
//
// Pantalla táctil de ventas en recepción del centro:
//   ┌──── header (centro · búsqueda · ver ventas) ────────┐
//   │ ┌── chips categorías ──┐                            │
//   │ ┌──────── grid productos ────────┐  ┌── CARRITO ──┐│
//   │ │ tarjeta táctil · click = +1   │  │ líneas      ││
//   │ │ ...                            │  │ totales     ││
//   │ └────────────────────────────────┘  │ cliente     ││
//   │                                     │ [COBRAR]   ││
//   │                                     └────────────┘│
//   └─────────────────────────────────────────────────────┘
//
// Click en una tarjeta = añade 1 al carrito (o +1 si ya está).
// Cobrar → modal con métodos de pago (efectivo / tarjeta / cargo recibo
// mensual / transferencia / link pago / bizum) → POST /api/pos/ventas.
//
// El backend descuenta stock automáticamente y devuelve el número de tiquet.

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Loader2, Search, X, Plus, Minus, Trash2, ShoppingCart,
  CreditCard, Banknote, FileText, ArrowLeftRight, Link2, Smartphone,
  User, History, Check, AlertCircle, Package, Tag, RefreshCw,
  Calculator, Lock,
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../components/Toast'
import { useOdooStatus } from '../../hooks/useOdooStatus'
import { useCan } from '../../hooks/useCan'
import { getRoundIdentity, centrosList } from '../../utils/configApi'
import { getClientes } from '../../utils/api'
import { useOverlayClose } from '../../hooks/useOverlayClose'
import {
  posCategoriasList, posProductosList, posVentaCreate, posVentasList,
  posDescuentosList, posVentaSyncOdoo, posVentaAnular,
  posCajaResumen, posCajaCerrar,
} from '../../utils/posApi'


const METODOS = [
  { id: 'efectivo',        label: 'Efectivo',         icon: Banknote },
  { id: 'tarjeta',         label: 'Tarjeta',          icon: CreditCard },
  { id: 'bizum',           label: 'Bizum',            icon: Smartphone },
  { id: 'recibo_mensual',  label: 'Cargo a recibo',   icon: FileText,
    requiereCliente: true },
  { id: 'transferencia',   label: 'Transferencia',    icon: ArrowLeftRight },
  { id: 'link_pago',       label: 'Link de pago',     icon: Link2 },
]


export default function TPV() {
  const { user } = useAuth()
  const toast = useToast()
  const identity = useMemo(() => getRoundIdentity(user), [user])
  const managerBare = !identity?.trainerId
  // Feature flags del manager — necesario para deshabilitar 'recibo_mensual'
  // si el manager no tiene Odoo Cuotas activado (sin él, la venta quedaría
  // 'skipped' silenciosamente y el cliente nunca se factura).
  const { features } = useOdooStatus()
  const cuotasEnabled = features?.cuotas !== false  // default true if loading
  // Permisos finos (Fase 10): el backend además los valida con @require_permission.
  const canCobrar     = useCan('tpv.ventas.cobrar')
  const canVerVentas  = useCan('tpv.ventas.ver')
  const canAnularVenta= useCan('tpv.ventas.anular')
  const canSyncOdoo   = useCan('tpv.ventas.sync_odoo')
  const canCerrarCaja = useCan('tpv.caja.cerrar')
  const canVerCaja    = useCan('tpv.caja.ver')
  const canAplicarDto = useCan('tpv.descuentos.aplicar')

  // ─── Data
  const [productos, setProductos] = useState([])
  const [categorias, setCategorias] = useState([])
  const [descuentos, setDescuentos] = useState([])  // catálogo descuentos
  const [centros, setCentros] = useState([])
  const [centroSel, setCentroSel] = useState(identity?.trainerId || '')
  // Audit Sprint 2d: si `identity` se hidrata DESPUÉS del primer render
  // (cambio impersonación, recarga lazy del AuthContext), el centroSel
  // queda vacío para siempre. Re-sincronizamos cuando identity.trainerId
  // llega tarde.
  useEffect(() => {
    if (identity?.trainerId && centroSel !== identity.trainerId) {
      setCentroSel(identity.trainerId)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity?.trainerId])
  const [loading, setLoading] = useState(true)

  // ─── UI state
  // catSel especial: '__dto' = pestaña de descuentos
  const [catSel, setCatSel] = useState('')
  const [q, setQ] = useState('')                    // product search
  const [carrito, setCarrito] = useState([])        // [{producto, cantidad}]
  const [carritoDtos, setCarritoDtos] = useState([])  // [{descuento, importe(neg)}]
  const [clienteSel, setClienteSel] = useState(null)
  const [pagoOpen, setPagoOpen] = useState(false)
  const [historialOpen, setHistorialOpen] = useState(false)
  const [cierreOpen, setCierreOpen] = useState(false)

  // ─── Carga inicial (centros primero para auto-elegir el primero si manager bare)
  useEffect(() => {
    if (!managerBare) return
    centrosList(identity).then(cn => {
      // Ordenamos por nombre para que el "por defecto = primero" sea estable
      const sorted = [...cn].sort((a, b) =>
        (a.nombre || '').localeCompare(b.nombre || ''))
      setCentros(sorted)
      if (!centroSel && sorted.length > 0) {
        setCentroSel(String(sorted[0].id_trainer))
      }
    }).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [managerBare])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const trainerFilter = managerBare ? centroSel : undefined
      const [ps, cs, ds] = await Promise.all([
        posProductosList(identity, { id_trainer: trainerFilter }),
        posCategoriasList(identity),
        posDescuentosList(identity, { id_trainer: trainerFilter }),
      ])
      setProductos(ps); setCategorias(cs); setDescuentos(ds)
    } catch (e) { toast.error(`Error cargando catálogo: ${e.message}`) }
    setLoading(false)
  }, [identity, managerBare, centroSel, toast])
  useEffect(() => { reload() }, [reload])

  // ─── Filtros
  // Si catSel='__dto' mostramos descuentos en lugar de productos
  const productosFiltrados = useMemo(() => {
    if (catSel === '__dto') return []
    const qLow = q.trim().toLowerCase()
    return productos.filter(p => {
      if (catSel && String(p.categoria_id) !== String(catSel)) return false
      if (qLow && !`${p.codigo} ${p.nombre} ${p.descripcion || ''}`
          .toLowerCase().includes(qLow)) return false
      return true
    })
  }, [productos, catSel, q])
  const descuentosFiltrados = useMemo(() => {
    if (catSel !== '__dto') return []
    const qLow = q.trim().toLowerCase()
    return descuentos.filter(d => !qLow
      || `${d.codigo || ''} ${d.nombre}`.toLowerCase().includes(qLow))
  }, [descuentos, catSel, q])

  // ─── Carrito
  const addToCarrito = (p) => {
    setCarrito(c => {
      const idx = c.findIndex(l => l.producto.id === p.id)
      if (idx >= 0) {
        const next = [...c]
        next[idx] = { ...next[idx], cantidad: next[idx].cantidad + 1 }
        return next
      }
      return [...c, { producto: p, cantidad: 1 }]
    })
  }
  // Sprint 5 #2 (refactor de Sprint 3a) — Descuento fantasma reactivo:
  // los descuentos `ambito='producto'` vinculados a un producto que ya
  // no está en el carrito se purgan automáticamente. Los `general` se
  // purgan si el carrito queda vacío. Implementado como useEffect que
  // observa `carrito` para no violar la pureza del updater de setCarrito
  // (anti-pattern señalado en el audit Sprint 1-3).
  const updCant = (id, delta) => {
    setCarrito(c => c
      .map(l => l.producto.id === id ? { ...l, cantidad: l.cantidad + delta } : l)
      .filter(l => l.cantidad > 0))
  }
  const setCant = (id, val) => {
    const n = Number(val)
    if (Number.isNaN(n) || n < 0) return
    setCarrito(c => n === 0
      ? c.filter(l => l.producto.id !== id)
      : c.map(l => l.producto.id === id ? { ...l, cantidad: n } : l))
  }
  const removeLinea = (id) =>
    setCarrito(c => c.filter(l => l.producto.id !== id))
  const removeDto = (idx) =>
    setCarritoDtos(ds => ds.filter((_, i) => i !== idx))
  const limpiarCarrito = () => {
    setCarrito([]); setCarritoDtos([]); setClienteSel(null)
  }
  // Purgado reactivo de descuentos huérfanos cuando cambia el carrito.
  useEffect(() => {
    setCarritoDtos(ds => {
      if (ds.length === 0) return ds
      const idsEnCarrito = new Set(carrito.map(l => l.producto.id))
      const next = ds.filter(dto => {
        if (dto.descuento?.ambito === 'producto') {
          return idsEnCarrito.has(dto.descuento.producto_id)
        }
        return carrito.length > 0   // general: requiere al menos 1 producto
      })
      return next.length === ds.length ? ds : next  // evitar setState innecesario
    })
  }, [carrito])

  // ─── Aplicar descuento (snapshot del importe en el momento de aplicar)
  //
  // Audit Sprint 3a — IVA descuento mixto:
  //   Un descuento general sobre un ticket con productos a diferentes %IVA
  //   no puede heredar un IVA fijo (21% antes) porque distorsiona el desglose.
  //   Calculamos el reparto proporcional: el descuento se divide en N "splits"
  //   por cada %IVA presente en el carrito, ponderado por su peso en el
  //   subtotal. Al emitir la venta se enviarán N líneas de descuento
  //   (una por IVA) en lugar de 1 sola, y el IVA repercutido (cuenta 477)
  //   se reduce proporcionalmente.
  //
  //   Descuento sobre producto concreto: 1 solo split con el IVA del producto.
  const aplicarDescuento = (d) => {
    if (!canAplicarDto) {
      toast.error('No tienes permiso para aplicar descuentos'); return
    }
    // Calcula sobre el estado actual del carrito (importes con IVA)
    let baseTarget = 0
    let splits = []   // [{iva_pct, importe_neg}]
    if (d.ambito === 'producto') {
      const linea = carrito.find(l => l.producto.id === d.producto_id)
      if (!linea) {
        toast.error(`Añade primero "${d.producto_nombre}" al ticket`)
        return
      }
      baseTarget = Number(linea.producto.precio_venta) * linea.cantidad
      const ivaPct = Number(linea.producto.iva_pct || 21)
      const importe = d.tipo === 'porcentaje'
        ? -(baseTarget * d.valor / 100)
        : -d.valor
      splits = [{ iva_pct: ivaPct, importe: Math.round(importe * 100) / 100 }]
    } else {
      // GENERAL: reparto proporcional por tramo de IVA
      const porIva = new Map()   // iva_pct → suma de importes con IVA
      for (const l of carrito) {
        const tot = Number(l.producto.precio_venta) * l.cantidad
        const k = Number(l.producto.iva_pct || 21)
        porIva.set(k, (porIva.get(k) || 0) + tot)
      }
      baseTarget = [...porIva.values()].reduce((s, x) => s + x, 0)
      if (baseTarget <= 0) {
        toast.error('Carrito vacío'); return
      }
      const totalDescuento = d.tipo === 'porcentaje'
        ? -(baseTarget * d.valor / 100)
        : -d.valor
      // Reparte el descuento total entre tramos según peso. Para evitar
      // pérdida de céntimos por redondeo, los acumulamos en el último tramo.
      const entries = [...porIva.entries()]
      let restante = totalDescuento
      for (let i = 0; i < entries.length; i++) {
        const [ivaPct, tramoBase] = entries[i]
        const esUltimo = (i === entries.length - 1)
        const importe = esUltimo
          ? Math.round(restante * 100) / 100
          : Math.round((totalDescuento * tramoBase / baseTarget) * 100) / 100
        splits.push({ iva_pct: ivaPct, importe })
        restante -= importe
      }
    }
    // Validar: si el total ya está en 0 o el descuento es nulo
    const sumaDescuento = splits.reduce((s, sp) => s + sp.importe, 0)
    if (sumaDescuento >= 0) {
      toast.error('El descuento no aplica (importe 0).'); return
    }
    // Capear: si los descuentos acumulados dejarían el ticket negativo,
    // recortar el último split (no permitimos splits positivos).
    const dtosActuales = carritoDtos.reduce(
      (s, x) => s + (x.splits ? x.splits.reduce((a, p) => a + p.importe, 0) : x.importe),
      0)
    const totalCarritoConIva = carrito.reduce(
      (s, l) => s + Number(l.producto.precio_venta) * l.cantidad, 0)
    const totalSiAplico = totalCarritoConIva + dtosActuales + sumaDescuento
    if (totalSiAplico < 0) {
      const ajuste = -totalSiAplico   // positivo: cuánto sobra restar
      // Sumamos el ajuste al último split (lo hacemos menos negativo)
      splits[splits.length - 1].importe += ajuste
      splits[splits.length - 1].importe =
        Math.round(splits[splits.length - 1].importe * 100) / 100
    }
    setCarritoDtos(ds => [...ds, {
      descuento: d,
      splits,                                  // [{iva_pct, importe(neg)}]
      nombre: d.tipo === 'porcentaje'
        ? `${d.nombre} (-${d.valor}%)`
        : `${d.nombre} (-${d.valor}€)`,
    }])
    const totalSplit = splits.reduce((s, sp) => s + sp.importe, 0)
    toast.success(`Descuento aplicado: ${totalSplit.toFixed(2)}€`)
  }

  // ─── Totales (productos + descuentos multi-IVA, Sprint 3a)
  const totales = useMemo(() => {
    let sub = 0, iva = 0, total = 0
    for (const l of carrito) {
      const t = Number(l.producto.precio_venta || 0) * l.cantidad
      const ivaPct = Number(l.producto.iva_pct || 0)
      const base = t / (1 + ivaPct / 100)
      sub   += base; iva += (t - base); total += t
    }
    for (const d of carritoDtos) {
      // Compat: si llega un descuento legacy con `importe`+`iva_pct` planos
      // lo tratamos como split único. Los nuevos llevan `splits[]`.
      const splits = d.splits || [{ iva_pct: d.iva_pct || 21, importe: d.importe }]
      for (const sp of splits) {
        const t = sp.importe
        const ivaPct = Number(sp.iva_pct || 21)
        const base = t / (1 + ivaPct / 100)
        sub   += base; iva += (t - base); total += t
      }
    }
    return { sub, iva, total: Math.max(0, total) }
  }, [carrito, carritoDtos])

  // ─── Cobrar
  // Audit Sprint 2d: SIEMPRE devolvemos una promise (rejected en validaciones)
  // para que el PagoModal pueda distinguir éxito vs error y no se cierre
  // silenciosamente mostrando solo un toast rojo.
  const onPagar = (metodo, notas) => {
    if (!canCobrar) {
      toast.error('No tienes permiso para cobrar')
      return Promise.reject(new Error('permission_denied'))
    }
    if (carrito.length === 0) {
      toast.error('Carrito vacío')
      return Promise.reject(new Error('carrito_vacio'))
    }
    const targetTrainer = identity?.trainerId || centroSel
    if (!targetTrainer) {
      toast.error('Selecciona un centro')
      return Promise.reject(new Error('centro_required'))
    }
    if (METODOS.find(m => m.id === metodo)?.requiereCliente && !clienteSel) {
      toast.error('Necesitas seleccionar un cliente para cargar a su recibo')
      return Promise.reject(new Error('cliente_required'))
    }
    const body = {
      id_trainer: managerBare ? centroSel : undefined,
      cliente_id: clienteSel?.idCliente || clienteSel?.id || null,
      cliente_nombre: clienteSel
        ? `${clienteSel.nombre || ''} ${clienteSel.apellidos || ''}`.trim()
        : null,
      cliente_email: clienteSel?.email || null,
      metodo_pago: metodo,
      notas: notas || null,
      lineas: [
        ...carrito.map(l => ({
          producto_id: l.producto.id,
          codigo: l.producto.codigo,
          nombre: l.producto.nombre,
          cantidad: l.cantidad,
          precio_unit: Number(l.producto.precio_venta),
          iva_pct: Number(l.producto.iva_pct),
          cuenta_contable: l.producto.cuenta_contable,
          tipo: l.producto.tipo,
        })),
        // Cada descuento puede generar N líneas (Sprint 3a multi-IVA).
        // Tickets sin mezcla de IVA solo tendrán 1 split → 1 línea.
        ...carritoDtos.flatMap(d => {
          const splits = d.splits || [{ iva_pct: d.iva_pct || 21, importe: d.importe }]
          return splits.map(sp => ({
            producto_id: null,
            codigo: d.descuento.codigo || `DTO${d.descuento.id}`,
            nombre: splits.length > 1
              ? `${d.nombre} (${sp.iva_pct}%)`
              : d.nombre,
            cantidad: 1,
            precio_unit: sp.importe,         // negativo
            iva_pct: Number(sp.iva_pct || 21),
            cuenta_contable: '708',          // PGC: Rappels/dtos sobre ventas
            tipo: 'descuento',
          }))
        }),
      ],
    }
    return posVentaCreate(identity, body)
      .then(res => {
        toast.success(`Venta ${res.numero} · ${res.total.toFixed(2)}€`)
        setPagoOpen(false)
        limpiarCarrito()
        // Refrescar stock
        reload()
      })
      .catch(e => { toast.error(`Error al cobrar: ${e.message}`); throw e })
  }

  // ─── Render
  return (
    <div style={{ height: 'calc(100vh - 60px)', display: 'flex',
                   flexDirection: 'column', background: 'var(--bg-0)' }}>
      {/* Header */}
      <Header centros={centros} centroSel={centroSel} setCentroSel={setCentroSel}
              managerBare={managerBare} q={q} setQ={setQ}
              onHist={canVerVentas ? () => setHistorialOpen(true) : null}
              onCierre={canVerCaja ? () => setCierreOpen(true) : null} />

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Catálogo */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column',
                       padding: 12, minWidth: 0 }}>
          <CategoriaChips categorias={categorias}
                          hayDescuentos={descuentos.length > 0 && canAplicarDto}
                          sel={catSel} setSel={setCatSel} />
          {loading ? (
            <div style={{ flex: 1, display: 'grid', placeItems: 'center' }}>
              <Loader2 size={32} className="animate-spin"
                       style={{ color: 'var(--green)' }} />
            </div>
          ) : catSel === '__dto' ? (
            descuentosFiltrados.length === 0 ? (
              <div style={{ flex: 1, display: 'grid', placeItems: 'center',
                             color: 'var(--text-3)' }}>
                <div style={{ textAlign: 'center' }}>
                  <Tag size={40} style={{ opacity: 0.4 }} />
                  <p style={{ marginTop: 8 }}>
                    No hay descuentos configurados.
                    Crea uno en <strong>Configuración → Terminal de Caja → Descuentos</strong>.
                  </p>
                </div>
              </div>
            ) : (
              <div style={{ flex: 1, overflowY: 'auto', paddingRight: 4 }}>
                <div style={{ display: 'grid',
                               gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                               gap: 10 }}>
                  {descuentosFiltrados.map(d =>
                    <DescuentoTile key={d.id} d={d}
                                   onClick={() => aplicarDescuento(d)} />
                  )}
                </div>
              </div>
            )
          ) : productosFiltrados.length === 0 ? (
            <div style={{ flex: 1, display: 'grid', placeItems: 'center',
                           color: 'var(--text-3)' }}>
              <div style={{ textAlign: 'center' }}>
                <Package size={40} style={{ opacity: 0.4 }} />
                <p style={{ marginTop: 8 }}>
                  {q || catSel ? 'Sin resultados con esos filtros.'
                              : 'No hay productos en este centro.'}
                </p>
              </div>
            </div>
          ) : (
            <div style={{ flex: 1, overflowY: 'auto', paddingRight: 4 }}>
              <div style={{ display: 'grid',
                             gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                             gap: 10 }}>
                {productosFiltrados.map(p =>
                  <ProductoTile key={p.id} p={p} onClick={() => addToCarrito(p)} />
                )}
              </div>
            </div>
          )}
        </div>

        {/* Carrito */}
        <Carrito carrito={carrito} carritoDtos={carritoDtos} totales={totales}
                 clienteSel={clienteSel} setClienteSel={setClienteSel}
                 onUpdCant={updCant} onSetCant={setCant} onRemove={removeLinea}
                 onRemoveDto={removeDto}
                 onLimpiar={limpiarCarrito}
                 canCobrar={canCobrar}
                 onCobrar={() => canCobrar && setPagoOpen(true)} />
      </div>

      {pagoOpen && (
        <PagoModal totales={totales} cliente={clienteSel}
                   cuotasEnabled={cuotasEnabled}
                   onClose={() => setPagoOpen(false)} onConfirm={onPagar} />
      )}
      {historialOpen && (
        <HistorialModal identity={identity}
                        idTrainer={managerBare ? centroSel : identity?.trainerId}
                        canAnular={canAnularVenta}
                        canSyncOdoo={canSyncOdoo}
                        onClose={() => setHistorialOpen(false)} />
      )}
      {cierreOpen && (
        <CierreCajaModal identity={identity}
                          idTrainer={managerBare ? centroSel : identity?.trainerId}
                          canCerrar={canCerrarCaja}
                          onClose={() => setCierreOpen(false)} />
      )}
    </div>
  )
}


// ═══════════════════════════════════════════════════════════════════════
//                              HEADER
// ═══════════════════════════════════════════════════════════════════════

function Header({ centros, centroSel, setCentroSel, managerBare, q, setQ, onHist, onCierre }) {
  return (
    <div style={{ background: 'var(--bg-1)', borderBottom: '1px solid var(--line)',
                   padding: '10px 14px', display: 'flex', alignItems: 'center',
                   gap: 12, flexWrap: 'wrap' }}>
      <ShoppingCart size={20} style={{ color: 'var(--green)' }} />
      <strong style={{ fontSize: 15 }}>TPV</strong>
      {/*
        Centro: solo visible cuando el operador es el MANAGER (sin impersonar).
        El manager elige qué centro está atendiendo. Si impersona un trainer,
        no se muestra nada — el centro queda implícito en su login.
        Por defecto se elige el primer centro por nombre (lo hace el efecto
        de carga). Muestra el NOMBRE, nunca el id.
      */}
      {managerBare && centros.length > 0 && (
        <select value={centroSel} onChange={e => setCentroSel(e.target.value)}
                title="Centro donde está operando"
                style={{ ...inputStyle, width: 220, fontSize: 13 }}>
          {centros.map(c =>
            <option key={c.id_trainer} value={c.id_trainer}>
              {c.nombre || c.slug || `Centro ${c.id_trainer}`}
            </option>
          )}
        </select>
      )}
      <div style={{ position: 'relative', flex: 1, maxWidth: 360 }}>
        <Search size={14} style={{ position: 'absolute', left: 8, top: '50%',
                                    transform: 'translateY(-50%)',
                                    color: 'var(--text-3)' }} />
        <input value={q} onChange={e => setQ(e.target.value)}
               placeholder="Buscar producto (código, nombre)…"
               style={{ ...inputStyle, paddingLeft: 28 }} />
      </div>
      {onHist && (
        <button onClick={onHist}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
                         padding: '8px 12px', borderRadius: 8, fontSize: 13,
                         background: 'var(--bg-2)', color: 'var(--text-1)',
                         border: 'none', cursor: 'pointer' }}>
          <History size={14} /> Ventas
        </button>
      )}
      {onCierre && (
        <button onClick={onCierre}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
                         padding: '8px 12px', borderRadius: 8, fontSize: 13,
                         background: 'var(--bg-2)', color: 'var(--text-1)',
                         border: 'none', cursor: 'pointer' }}>
          <Calculator size={14} /> Cuadre
        </button>
      )}
    </div>
  )
}


// ═══════════════════════════════════════════════════════════════════════
//                          CATEGORÍAS (chips)
// ═══════════════════════════════════════════════════════════════════════

function CategoriaChips({ categorias, sel, setSel, hayDescuentos }) {
  return (
    <div style={{ display: 'flex', gap: 6, overflowX: 'auto',
                   marginBottom: 10, paddingBottom: 4 }}>
      <Chip active={!sel} onClick={() => setSel('')}>Todas</Chip>
      {categorias.map(c =>
        <Chip key={c.id} active={String(sel) === String(c.id)}
              onClick={() => setSel(c.id)} color={c.color}>
          <span style={{ marginRight: 4 }}>{c.icono}</span>{c.nombre}
        </Chip>
      )}
      {hayDescuentos && (
        <Chip active={sel === '__dto'} onClick={() => setSel('__dto')}
              color="#ef4444">
          <Tag size={11} style={{ marginRight: 4, verticalAlign: -1 }} />
          Descuentos
        </Chip>
      )}
    </div>
  )
}

function Chip({ active, color, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600,
      background: active ? (color || 'var(--green)') : 'var(--bg-2)',
      color: active ? '#fff' : 'var(--text-1)',
      border: '1px solid ' + (active ? 'transparent' : 'var(--line)'),
      cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
    }}>{children}</button>
  )
}


// ═══════════════════════════════════════════════════════════════════════
//                       TARJETA DE PRODUCTO (táctil)
// ═══════════════════════════════════════════════════════════════════════

function ProductoTile({ p, onClick }) {
  const inv = p.inventariable
  const sinStock = inv && Number(p.stock_actual) <= 0
  const stockBajo = inv && Number(p.stock_actual) <= Number(p.stock_minimo || 0)
                       && !sinStock
  const previewUrl = p.imagen_url && p.imagen_url.startsWith('/')
    ? `${window.location.origin}${p.imagen_url}` : p.imagen_url
  return (
    <button onClick={sinStock ? undefined : onClick}
            disabled={sinStock}
            style={{
              padding: 8, borderRadius: 12, textAlign: 'left',
              background: sinStock ? 'var(--bg-2)' : 'var(--bg-1)',
              border: `1px solid ${stockBajo ? '#fbbf24' : 'var(--line-2)'}`,
              cursor: sinStock ? 'not-allowed' : 'pointer',
              opacity: sinStock ? 0.55 : 1,
              display: 'flex', flexDirection: 'column', gap: 4,
              transition: 'transform .08s ease',
              minHeight: 130,
            }}
            onMouseDown={e => sinStock || (e.currentTarget.style.transform = 'scale(0.97)')}
            onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
            onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}>
      {/* Imagen */}
      <div style={{ aspectRatio: '1', borderRadius: 8, overflow: 'hidden',
                     background: p.categoria_color || 'var(--bg-3)',
                     display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {previewUrl ? (
          <img src={previewUrl} alt="" style={{ width: '100%', height: '100%',
                                                  objectFit: 'cover' }} />
        ) : (
          <span style={{ fontSize: 28 }}>
            {p.categoria_icono || (p.tipo === 'servicio' ? '⚙️' : '📦')}
          </span>
        )}
      </div>
      {/* Nombre + precio */}
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-0)',
                       lineHeight: 1.2, marginTop: 2,
                       display: '-webkit-box', WebkitLineClamp: 2,
                       WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {p.nombre}
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--green)',
                       marginTop: 2 }}>
          {Number(p.precio_venta).toFixed(2)} €
        </div>
        {inv && (
          <div style={{ fontSize: 10, color: sinStock ? 'var(--red)'
                                              : stockBajo ? '#d97706'
                                              : 'var(--text-3)' }}>
            {sinStock ? 'Sin stock'
                      : stockBajo ? `⚠ ${p.stock_actual} ud.`
                      : `${p.stock_actual} ud.`}
          </div>
        )}
      </div>
    </button>
  )
}


// ═══════════════════════════════════════════════════════════════════════
//                          TARJETA DE DESCUENTO
// ═══════════════════════════════════════════════════════════════════════

function DescuentoTile({ d, onClick }) {
  const esPct = d.tipo === 'porcentaje'
  const esGeneral = d.ambito === 'general'
  return (
    <button onClick={onClick} style={{
      padding: 10, borderRadius: 12, textAlign: 'left',
      background: 'var(--bg-1)',
      border: `2px dashed ${d.color || '#ef4444'}`,
      cursor: 'pointer',
      display: 'flex', flexDirection: 'column', gap: 4, minHeight: 120,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 36, height: 36, borderRadius: 8,
                       background: d.color || '#ef4444', color: '#fff',
                       display: 'flex', alignItems: 'center',
                       justifyContent: 'center', fontSize: 20 }}>
          {d.icono || '🎁'}
        </div>
        <div style={{ fontSize: 18, fontWeight: 800, color: d.color || '#ef4444',
                       fontFamily: 'var(--font-mono)' }}>
          -{d.valor}{esPct ? '%' : '€'}
        </div>
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-0)',
                     lineHeight: 1.2 }}>{d.nombre}</div>
      <div style={{ fontSize: 10, color: 'var(--text-3)' }}>
        {esGeneral
          ? 'Sobre el total del ticket'
          : `Sobre ${d.producto_nombre || 'producto'}`}
      </div>
    </button>
  )
}


// ═══════════════════════════════════════════════════════════════════════
//                              CARRITO
// ═══════════════════════════════════════════════════════════════════════

function Carrito({ carrito, carritoDtos = [], totales, clienteSel, setClienteSel,
                   onUpdCant, onSetCant, onRemove, onRemoveDto, onLimpiar,
                   canCobrar = true, onCobrar }) {
  const vacio = carrito.length === 0 && carritoDtos.length === 0
  const disabled = vacio || !canCobrar
  return (
    <div style={{ width: 340, flexShrink: 0,
                   background: 'var(--bg-1)', borderLeft: '1px solid var(--line)',
                   display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)',
                     display: 'flex', alignItems: 'center', gap: 8 }}>
        <ShoppingCart size={16} style={{ color: 'var(--green)' }} />
        <strong style={{ fontSize: 14 }}>Ticket actual</strong>
        <span style={{ flex: 1 }} />
        {!vacio && (
          <button onClick={onLimpiar} title="Vaciar"
                  style={{ background: 'none', border: 'none', cursor: 'pointer',
                           color: 'var(--text-3)', padding: 4 }}>
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {/* Líneas */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
        {vacio ? (
          <div style={{ color: 'var(--text-3)', textAlign: 'center',
                         padding: 30, fontSize: 12 }}>
            Click en productos del catálogo para añadirlos
          </div>
        ) : (
          <>
            {carrito.map(l => (
              <LineaCarrito key={l.producto.id} linea={l}
                            onUpd={onUpdCant} onSet={onSetCant} onRemove={onRemove} />
            ))}
            {carritoDtos.map((d, idx) => (
              <LineaDescuento key={`dto-${idx}`} d={d} idx={idx}
                              onRemove={onRemoveDto} />
            ))}
          </>
        )}
      </div>

      {/* Cliente */}
      <div style={{ borderTop: '1px solid var(--line)', padding: 10 }}>
        <ClienteSelector value={clienteSel} onChange={setClienteSel} />
      </div>

      {/* Totales + Cobrar */}
      <div style={{ borderTop: '1px solid var(--line)', padding: 12 }}>
        <Row label="Subtotal" v={totales.sub} />
        <Row label="IVA"      v={totales.iva} />
        <Row label="TOTAL"    v={totales.total} big />
        <button onClick={onCobrar} disabled={disabled}
                title={!canCobrar ? 'Sin permiso para cobrar' : ''}
                style={{
                  marginTop: 10, width: '100%', padding: '14px',
                  borderRadius: 10, fontSize: 16, fontWeight: 700,
                  background: !disabled ? 'var(--green)' : 'var(--bg-3)',
                  color: '#fff', border: 'none',
                  cursor: !disabled ? 'pointer' : 'not-allowed',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  gap: 8,
                }}>
          <Check size={18} /> COBRAR · {totales.total.toFixed(2)} €
        </button>
      </div>
    </div>
  )
}

function Row({ label, v, big }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between',
                   alignItems: 'baseline',
                   fontSize: big ? 16 : 12,
                   fontWeight: big ? 700 : 500,
                   color: big ? 'var(--text-0)' : 'var(--text-2)',
                   padding: '3px 0' }}>
      <span>{label}</span>
      <span style={{ fontFamily: 'var(--font-mono)' }}>
        {Number(v || 0).toFixed(2)} €
      </span>
    </div>
  )
}

function LineaCarrito({ linea, onUpd, onSet, onRemove }) {
  const { producto: p, cantidad } = linea
  const total = Number(p.precio_venta) * cantidad
  return (
    <div style={{ padding: 8, borderRadius: 8, marginBottom: 4,
                   background: 'var(--bg-2)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between',
                     gap: 6, marginBottom: 4 }}>
        <div style={{ flex: 1, fontSize: 12, fontWeight: 600,
                       color: 'var(--text-0)', minWidth: 0,
                       overflow: 'hidden', textOverflow: 'ellipsis',
                       whiteSpace: 'nowrap' }}>{p.nombre}</div>
        <button onClick={() => onRemove(p.id)} title="Quitar"
                style={{ background: 'none', border: 'none', cursor: 'pointer',
                         color: 'var(--text-3)', padding: 0 }}>
          <X size={12} />
        </button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button onClick={() => onUpd(p.id, -1)}
                style={miniBtn}><Minus size={11} /></button>
        <input type="number" value={cantidad} min="0"
               onChange={e => onSet(p.id, e.target.value)}
               style={{ width: 44, textAlign: 'center', padding: 4,
                        borderRadius: 6, background: 'var(--bg-1)',
                        border: '1px solid var(--line)', fontSize: 12,
                        color: 'var(--text-0)' }} />
        <button onClick={() => onUpd(p.id, +1)}
                style={miniBtn}><Plus size={11} /></button>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
          {Number(p.precio_venta).toFixed(2)}€
        </span>
        <strong style={{ fontSize: 13, color: 'var(--green)',
                          minWidth: 60, textAlign: 'right' }}>
          {total.toFixed(2)}€
        </strong>
      </div>
    </div>
  )
}


function LineaDescuento({ d, idx, onRemove }) {
  return (
    <div style={{ padding: 8, borderRadius: 8, marginBottom: 4,
                   background: 'rgba(239, 68, 68, 0.08)',
                   border: '1px dashed rgba(239, 68, 68, 0.4)',
                   display: 'flex', alignItems: 'center', gap: 6 }}>
      <Tag size={12} style={{ color: '#ef4444', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#ef4444',
                       overflow: 'hidden', textOverflow: 'ellipsis',
                       whiteSpace: 'nowrap' }}>{d.nombre}</div>
        <div style={{ fontSize: 10, color: 'var(--text-3)' }}>
          {d.descuento.ambito === 'general' ? 'Sobre total' : 'Sobre producto'}
        </div>
      </div>
      <strong style={{ fontSize: 13, color: '#ef4444', fontFamily: 'var(--font-mono)' }}>
        {Number(
          d.splits
            ? d.splits.reduce((s, sp) => s + sp.importe, 0)
            : d.importe
        ).toFixed(2)}€
      </strong>
      <button onClick={() => onRemove(idx)} title="Quitar"
              style={{ background: 'none', border: 'none', cursor: 'pointer',
                       color: 'var(--text-3)', padding: 2 }}>
        <X size={12} />
      </button>
    </div>
  )
}


// ═══════════════════════════════════════════════════════════════════════
//                          CLIENTE SELECTOR
// ═══════════════════════════════════════════════════════════════════════

function ClienteSelector({ value, onChange }) {
  const [clientes, setClientes] = useState([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)

  // Carga lazy primer click
  const load = async () => {
    if (clientes.length > 0 || loading) return
    setLoading(true)
    try { setClientes(await getClientes()) }
    catch { /* sin clientes */ }
    setLoading(false)
  }

  const matches = useMemo(() => {
    if (!q.trim()) return []
    const qLow = q.toLowerCase()
    return clientes.filter(c => {
      const txt = `${c.nombre || ''} ${c.apellidos || ''} ${c.email || ''} ${c.dni || ''}`.toLowerCase()
      return txt.includes(qLow)
    }).slice(0, 8)
  }, [clientes, q])

  if (value) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8,
                     padding: 8, borderRadius: 8, background: 'var(--bg-2)' }}>
        <User size={14} style={{ color: 'var(--green)' }} />
        <div style={{ flex: 1, fontSize: 12, color: 'var(--text-0)',
                       overflow: 'hidden', textOverflow: 'ellipsis',
                       whiteSpace: 'nowrap' }}>
          <strong>{value.nombre} {value.apellidos}</strong>
          {value.email && <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{value.email}</div>}
        </div>
        <button onClick={() => onChange(null)} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--text-3)', padding: 2 }}>
          <X size={14} />
        </button>
      </div>
    )
  }
  return (
    <div>
      <div style={{ position: 'relative' }}>
        <User size={12} style={{ position: 'absolute', left: 8, top: '50%',
                                  transform: 'translateY(-50%)',
                                  color: 'var(--text-3)' }} />
        <input value={q} onChange={e => { setQ(e.target.value); setOpen(true); load() }}
               onFocus={() => { setOpen(true); load() }}
               placeholder="Cliente (opcional)…"
               style={{ ...inputStyle, paddingLeft: 26, fontSize: 12 }} />
      </div>
      {open && matches.length > 0 && (
        <div style={{ marginTop: 4, background: 'var(--bg-2)', borderRadius: 8,
                       border: '1px solid var(--line)', maxHeight: 200,
                       overflowY: 'auto' }}>
          {matches.map(c =>
            <button key={c.idCliente || c.id}
                    onClick={() => { onChange(c); setQ(''); setOpen(false) }}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '6px 10px', background: 'none', border: 'none',
                      borderBottom: '1px solid var(--line)', cursor: 'pointer',
                      color: 'var(--text-0)', fontSize: 12,
                    }}>
              <strong>{c.nombre} {c.apellidos}</strong>
              <span style={{ display: 'block', color: 'var(--text-3)', fontSize: 10 }}>
                {c.email || c.dni || '—'}
              </span>
            </button>
          )}
        </div>
      )}
      {loading && (
        <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>
          Cargando clientes…
        </div>
      )}
    </div>
  )
}


// ═══════════════════════════════════════════════════════════════════════
//                          MODAL DE PAGO
// ═══════════════════════════════════════════════════════════════════════

function PagoModal({ totales, cliente, cuotasEnabled = true, onClose, onConfirm }) {
  const [metodo, setMetodo] = useState('efectivo')
  const [notas, setNotas] = useState('')
  const [recibido, setRecibido] = useState('')   // efectivo: cuánto te dan
  const [saving, setSaving] = useState(false)

  const meta = METODOS.find(m => m.id === metodo)
  const requiereCliente = meta?.requiereCliente
  const cambio = metodo === 'efectivo' && recibido
    ? Math.max(0, Number(recibido) - totales.total) : 0

  const confirm = async () => {
    setSaving(true)
    try { await onConfirm(metodo, notas) }
    catch { /* el padre muestra toast */ }
    setSaving(false)
  }

  return (
    <Modal title="Cobrar venta" onClose={saving ? undefined : onClose} maxWidth={480}>
      <div style={{ padding: 20 }}>
        {/* Resumen total */}
        <div style={{ padding: 16, borderRadius: 10, background: 'var(--green)',
                       color: '#fff', textAlign: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 12, opacity: 0.9 }}>TOTAL A COBRAR</div>
          <div style={{ fontSize: 32, fontWeight: 800, fontFamily: 'var(--font-mono)' }}>
            {totales.total.toFixed(2)} €
          </div>
        </div>

        {/* Método */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
                       gap: 6, marginBottom: 12 }}>
          {METODOS.map(m => {
            const Icon = m.icon
            const sel = metodo === m.id
            // 'recibo_mensual' requiere cliente + Odoo Cuotas activado en el
            // manager. Sin Cuotas la venta quedaría 'skipped' (no se factura
            // nunca) — bloqueamos el botón aquí + el backend también valida.
            const needsCliente = m.requiereCliente && !cliente
            const needsCuotas = m.id === 'recibo_mensual' && !cuotasEnabled
            const disabled = needsCliente || needsCuotas
            const disabledMsg = needsCuotas
              ? 'Requiere activar Cuotas en Configuración → Suscripciones'
              : needsCliente ? 'Selecciona cliente primero' : ''
            return (
              <button key={m.id} onClick={() => !disabled && setMetodo(m.id)}
                      disabled={disabled}
                      title={disabledMsg}
                      style={{
                        padding: '12px 4px', borderRadius: 10, fontSize: 11,
                        background: sel ? 'var(--green)' : 'var(--bg-2)',
                        color: sel ? '#fff' : disabled ? 'var(--text-3)' : 'var(--text-1)',
                        border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
                        opacity: disabled ? 0.5 : 1,
                        display: 'flex', flexDirection: 'column', alignItems: 'center',
                        gap: 4, fontWeight: 600,
                      }}>
                <Icon size={20} /> {m.label}
              </button>
            )
          })}
        </div>

        {requiereCliente && cliente && (
          <div style={{ padding: 10, borderRadius: 8, background: 'var(--bg-2)',
                         fontSize: 12, marginBottom: 12 }}>
            <AlertCircle size={12} style={{ display: 'inline', verticalAlign: -2,
                                              marginRight: 4, color: '#f59e0b' }} />
            Se añadirá al recibo mensual de
            <strong> {cliente.nombre} {cliente.apellidos}</strong>.
          </div>
        )}

        {metodo === 'efectivo' && (
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 11, color: 'var(--text-3)' }}>
              Recibido (opcional, calcula cambio):
            </label>
            <input type="number" step="0.01" value={recibido}
                   onChange={e => setRecibido(e.target.value)}
                   placeholder={totales.total.toFixed(2)}
                   style={{ ...inputStyle, fontSize: 16, textAlign: 'right',
                            fontFamily: 'var(--font-mono)' }} />
            {cambio > 0 && (
              <div style={{ marginTop: 6, padding: 8, borderRadius: 6,
                             background: '#fef3c7', color: '#92400e',
                             fontSize: 13, fontWeight: 700, textAlign: 'center' }}>
                Cambio: {cambio.toFixed(2)} €
              </div>
            )}
          </div>
        )}

        <label style={{ fontSize: 11, color: 'var(--text-3)' }}>
          Notas (opcional):
        </label>
        <textarea value={notas} onChange={e => setNotas(e.target.value)}
                  rows={2} placeholder="Observaciones para el ticket…"
                  style={{ ...inputStyle, resize: 'vertical' }} />
      </div>

      <div style={{ padding: '12px 20px', borderTop: '1px solid var(--line)',
                     display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onClose} disabled={saving} style={btnSec}>Cancelar</button>
        <button onClick={confirm} disabled={saving}
                style={{ ...btnPri, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {saving
            ? <Loader2 size={14} className="animate-spin" />
            : <Check size={14} />}
          Confirmar cobro
        </button>
      </div>
    </Modal>
  )
}


// ═══════════════════════════════════════════════════════════════════════
//                          MODAL HISTORIAL
// ═══════════════════════════════════════════════════════════════════════

function HistorialModal({ identity, idTrainer, canAnular = false,
                          canSyncOdoo = false, onClose }) {
  const toast = useToast()
  const [ventas, setVentas] = useState([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(null)   // venta id currently retrying
  const [anulando, setAnulando] = useState(null) // venta id anulándose
  const hoy = new Date().toISOString().slice(0, 10)
  const reload = useCallback(() => {
    setLoading(true)
    posVentasList(identity, { id_trainer: idTrainer, desde: hoy })
      .then(setVentas)
      .catch(() => setVentas([]))
      .finally(() => setLoading(false))
  }, [identity, idTrainer, hoy])
  useEffect(() => { reload() }, [reload])

  const retrySync = async (v) => {
    setSyncing(v.id)
    try {
      const r = await posVentaSyncOdoo(identity, v.id)
      if (r.ok) toast.success(r.skipped ? 'No sincronizable (sin Odoo)'
                              : r.deferred ? 'Pendiente recibo mensual'
                              : r.busy ? 'Otro proceso está sincronizando…'
                              : r.already_synced ? 'Ya sincronizada'
                              : r.already_reverted ? 'Ya revertida'
                              : r.aplicado ? `Aplicada a recibo #${r.recibo_id}`
                              : r.move_id ? `Sincronizado · move ${r.move_id}`
                              : 'OK')
      else toast.error(`Error sync: ${r.error}`)
      reload()
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setSyncing(null)
  }

  const anularVenta = async (v) => {
    const motivo = prompt(`Motivo de anulación de ${v.numero}:`)
    if (motivo === null) return
    if (!motivo.trim()) { toast.error('Indica un motivo'); return }
    setAnulando(v.id)
    try {
      await posVentaAnular(identity, v.id, motivo.trim())
      toast.success(`${v.numero} anulada · revert Odoo en curso`)
      reload()
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setAnulando(null)
  }

  const totalDia = ventas
    .filter(v => v.estado !== 'anulada')
    .reduce((s, v) => s + Number(v.total || 0), 0)

  return (
    <Modal title="Ventas de hoy" onClose={onClose} maxWidth={720}>
      <div style={{ padding: 14 }}>
        <div style={{ padding: 12, borderRadius: 8, background: 'var(--bg-2)',
                       display: 'flex', justifyContent: 'space-between',
                       fontSize: 13, marginBottom: 12 }}>
          <span><strong>{ventas.length}</strong> ventas hoy</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700,
                          color: 'var(--green)' }}>
            {totalDia.toFixed(2)} €
          </span>
        </div>
        {loading ? <Loader2 size={20} className="animate-spin" /> :
         ventas.length === 0 ? <div style={{ color: 'var(--text-3)', textAlign: 'center', padding: 30 }}>
           Aún no hay ventas hoy.
         </div> : (
          <div style={{ maxHeight: 420, overflowY: 'auto' }}>
            <table style={{ width: '100%', fontSize: 12 }}>
              <thead><tr style={{ color: 'var(--text-3)' }}>
                <th align="left">Tiquet</th>
                <th align="left">Hora</th>
                <th align="left">Cliente</th>
                <th align="left">Método</th>
                <th align="right">Total</th>
                <th align="left">Estado</th>
                <th align="left">Odoo</th>
                {canAnular && <th align="left">Acciones</th>}
              </tr></thead>
              <tbody>
                {ventas.map(v => (
                  <tr key={v.id} style={{ borderTop: '1px solid var(--line)' }}>
                    <td style={{ padding: '6px 4px', fontFamily: 'var(--font-mono)' }}>
                      {v.numero}
                    </td>
                    <td style={{ padding: '6px 4px' }}>
                      {new Date(v.fecha).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td style={{ padding: '6px 4px' }}>{v.cliente_nombre || '—'}</td>
                    <td style={{ padding: '6px 4px' }}>{v.metodo_pago}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right',
                                  fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                      {Number(v.total).toFixed(2)} €
                    </td>
                    <td style={{ padding: '6px 4px' }}>
                      {v.estado === 'anulada'
                        ? <span style={{ color: 'var(--red)' }}>anulada</span>
                        : <span style={{ color: 'var(--green)' }}>✓</span>}
                    </td>
                    <td style={{ padding: '6px 4px' }}>
                      <SyncBadge v={v} syncing={syncing === v.id}
                                 onRetry={canSyncOdoo ? () => retrySync(v) : null} />
                    </td>
                    {canAnular && (
                      <td style={{ padding: '6px 4px' }}>
                        {v.estado !== 'anulada' && (
                          <button onClick={() => anularVenta(v)}
                                  disabled={anulando === v.id}
                                  title="Anular venta (revierte stock + Odoo)"
                                  style={{ background: 'none', border: 'none',
                                           cursor: anulando === v.id ? 'wait' : 'pointer',
                                           color: 'var(--red)', fontSize: 11,
                                           padding: '2px 6px', borderRadius: 4 }}>
                            {anulando === v.id
                              ? <Loader2 size={11} className="animate-spin" />
                              : <Trash2 size={11} />} Anular
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div style={{ padding: '10px 14px', borderTop: '1px solid var(--line)',
                     display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={onClose} style={btnSec}>Cerrar</button>
      </div>
    </Modal>
  )
}


// ═══════════════════════════════════════════════════════════════════════
//                       MODAL CIERRE DE CAJA (Fase 8)
// ═══════════════════════════════════════════════════════════════════════

function CierreCajaModal({ identity, idTrainer, canCerrar = true, onClose }) {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [resumen, setResumen] = useState(null)
  const [cierreExistente, setCierreExistente] = useState(null)
  const [contado, setContado] = useState('')
  const [fondo, setFondo] = useState('0')
  const [notas, setNotas] = useState('')
  const hoy = new Date().toISOString().slice(0, 10)

  useEffect(() => {
    if (!idTrainer) { setLoading(false); return }
    posCajaResumen(identity, { fecha: hoy, id_trainer: idTrainer })
      .then(r => {
        setResumen(r.resumen)
        setCierreExistente(r.cierre_existente)
      })
      .catch(e => toast.error(`Error: ${e.message}`))
      .finally(() => setLoading(false))
  }, [identity, idTrainer, hoy, toast])

  const esperado = resumen
    ? Number(resumen.total_efectivo) + Number(fondo || 0) : 0
  const diferencia = (Number(contado || 0) - esperado)
  const diffAbs = Math.abs(diferencia)
  const requiereNotas = diffAbs > 5 && contado !== ''

  const confirmar = async () => {
    if (contado === '') { toast.error('Indica el efectivo contado'); return }
    if (requiereNotas && !notas.trim()) {
      toast.error('La diferencia >5€ requiere notas'); return
    }
    setSaving(true)
    try {
      const r = await posCajaCerrar(identity, {
        fecha: hoy,
        id_trainer: idTrainer,
        importe_contado_efectivo: Number(contado),
        fondo_caja: Number(fondo || 0),
        notas: notas.trim() || undefined,
      })
      toast.success(`Cierre registrado · diferencia ${r.cierre.diferencia.toFixed(2)}€`)
      setCierreExistente(r.cierre)
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setSaving(false)
  }

  return (
    <Modal title={`Cuadre de caja · ${hoy}`} onClose={saving ? undefined : onClose}
           maxWidth={620}>
      {!idTrainer ? (
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-3)' }}>
          Selecciona un centro antes de hacer cuadre.
        </div>
      ) : loading ? (
        <div style={{ padding: 30, textAlign: 'center' }}>
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : (
        <div style={{ padding: 18 }}>
          {/* Resumen del día */}
          <div style={{ background: 'var(--bg-2)', borderRadius: 10, padding: 12,
                         marginBottom: 14 }}>
            <strong style={{ fontSize: 13 }}>Resumen del día</strong>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr',
                           gap: 6, marginTop: 8, fontSize: 12 }}>
              <FilaMetodo lbl="💵 Efectivo" v={resumen.total_efectivo} highlight />
              <FilaMetodo lbl="💳 Tarjeta" v={resumen.total_tarjeta} />
              <FilaMetodo lbl="📱 Bizum" v={resumen.total_bizum} />
              <FilaMetodo lbl="🏦 Transferencia" v={resumen.total_transferencia} />
              <FilaMetodo lbl="🔗 Link pago" v={resumen.total_link_pago} />
              <FilaMetodo lbl="📋 Cargo recibo" v={resumen.total_recibo_mensual} />
            </div>
            <div style={{ marginTop: 10, paddingTop: 8,
                           borderTop: '1px solid var(--line)',
                           display: 'flex', justifyContent: 'space-between',
                           fontSize: 13, fontWeight: 700 }}>
              <span>Total día ({resumen.num_ventas} ventas)</span>
              <span style={{ color: 'var(--green)', fontFamily: 'var(--font-mono)' }}>
                {Number(resumen.total_dia).toFixed(2)} €
              </span>
            </div>
            {resumen.num_anuladas > 0 && (
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
                ↩ {resumen.num_anuladas} anulada(s) · {Number(resumen.total_anulado).toFixed(2)}€
              </div>
            )}
          </div>

          {cierreExistente ? (
            <CierreReadOnly cierre={cierreExistente} />
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={lblStyle}>Fondo inicial caja (€)</label>
                  <input type="number" step="0.01" value={fondo}
                         onChange={e => setFondo(e.target.value)}
                         style={{ ...inputStyle, fontFamily: 'var(--font-mono)',
                                  textAlign: 'right' }} />
                </div>
                <div>
                  <label style={lblStyle}>Efectivo contado (€) *</label>
                  <input type="number" step="0.01" value={contado}
                         autoFocus
                         onChange={e => setContado(e.target.value)}
                         placeholder={esperado.toFixed(2)}
                         style={{ ...inputStyle, fontFamily: 'var(--font-mono)',
                                  textAlign: 'right', fontSize: 18,
                                  fontWeight: 700 }} />
                </div>
              </div>

              <div style={{ marginTop: 12, padding: 12, borderRadius: 10,
                             background: diffAbs > 5 ? '#fef3c7'
                                       : diffAbs > 0 ? 'var(--bg-2)'
                                       : 'rgba(16,185,129,0.12)',
                             display: 'flex', justifyContent: 'space-between',
                             fontSize: 14 }}>
                <span>
                  <strong>Esperado:</strong> {esperado.toFixed(2)}€<br/>
                  <strong>Diferencia:</strong>
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800,
                                fontSize: 22,
                                color: diffAbs > 5 ? '#d97706'
                                     : diffAbs > 0 ? 'var(--text-1)'
                                     : 'var(--green)' }}>
                  {diferencia >= 0 ? '+' : ''}{diferencia.toFixed(2)} €
                </span>
              </div>

              <div style={{ marginTop: 12 }}>
                <label style={lblStyle}>
                  Notas {requiereNotas && <span style={{ color: 'var(--red)' }}>*</span>}
                </label>
                <textarea value={notas} onChange={e => setNotas(e.target.value)}
                          rows={2}
                          placeholder={requiereNotas
                            ? 'La diferencia >5€ requiere explicación…'
                            : 'Opcional…'}
                          style={{ ...inputStyle, resize: 'vertical' }} />
              </div>
            </>
          )}
        </div>
      )}
      <div style={{ padding: '12px 20px', borderTop: '1px solid var(--line)',
                     display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onClose} disabled={saving} style={btnSec}>
          {cierreExistente ? 'Cerrar' : 'Cancelar'}
        </button>
        {!cierreExistente && idTrainer && canCerrar && (
          <button onClick={confirmar} disabled={saving || contado === ''}
                  style={{ ...btnPri,
                           display: 'inline-flex', alignItems: 'center', gap: 6,
                           opacity: (saving || contado === '') ? 0.6 : 1 }}>
            {saving ? <Loader2 size={14} className="animate-spin" />
                    : <Lock size={14} />}
            Cerrar caja
          </button>
        )}
        {!cierreExistente && idTrainer && !canCerrar && (
          <span style={{ fontSize: 11, color: 'var(--text-3)', alignSelf: 'center' }}>
            Sin permiso para cerrar caja
          </span>
        )}
      </div>
    </Modal>
  )
}

function FilaMetodo({ lbl, v, highlight }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between',
                   padding: '3px 0',
                   fontWeight: highlight ? 700 : 400,
                   color: highlight ? 'var(--text-0)' : 'var(--text-1)' }}>
      <span>{lbl}</span>
      <span style={{ fontFamily: 'var(--font-mono)' }}>
        {Number(v || 0).toFixed(2)} €
      </span>
    </div>
  )
}

function CierreReadOnly({ cierre }) {
  return (
    <div style={{ padding: 14, background: 'rgba(45,212,168,0.08)',
                   border: '1px solid rgba(45,212,168,0.3)', borderRadius: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8,
                     marginBottom: 8, color: 'var(--green)', fontWeight: 600 }}>
        <Lock size={14} /> Caja ya cerrada hoy
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8,
                     fontSize: 12 }}>
        <div><strong>Efectivo contado:</strong> {Number(cierre.importe_contado_efectivo).toFixed(2)} €</div>
        <div><strong>Diferencia:</strong>{' '}
          <span style={{ color: Math.abs(cierre.diferencia) > 5 ? '#d97706'
                                  : 'var(--text-1)',
                         fontWeight: 700 }}>
            {cierre.diferencia >= 0 ? '+' : ''}{Number(cierre.diferencia).toFixed(2)} €
          </span>
        </div>
        <div><strong>Operario:</strong> {cierre.created_by || '—'}</div>
        <div><strong>Hora:</strong>{' '}
          {cierre.created_at
            ? new Date(cierre.created_at).toLocaleTimeString('es-ES',
                { hour:'2-digit', minute:'2-digit' })
            : '—'}
        </div>
      </div>
      {cierre.notas && (
        <div style={{ marginTop: 8, padding: 8, background: 'var(--bg-1)',
                       borderRadius: 6, fontSize: 12 }}>
          📝 {cierre.notas}
        </div>
      )}
    </div>
  )
}

const lblStyle = {
  display: 'block', fontSize: 11, color: 'var(--text-3)', marginBottom: 4,
}


function SyncBadge({ v, syncing, onRetry }) {
  // Estados posibles: pending|syncing|synced|error|skipped|deferred|applied_to_recibo|reverted
  const s = v.sync_status || 'pending'
  const moveTxt = v.odoo_move_id ? `#${v.odoo_move_id}` : ''
  if (syncing) {
    return <Loader2 size={12} className="animate-spin" style={{ color: 'var(--text-3)' }} />
  }
  if (s === 'synced') {
    return <span title={`Odoo move ${moveTxt}`} style={{ color: 'var(--green)', fontSize: 11 }}>
      ✓ {moveTxt}
    </span>
  }
  if (s === 'applied_to_recibo') {
    return <span title={`Cargado al recibo mensual draft #${v.recibo_id}`}
                 style={{ color: '#3b82f6', fontSize: 11 }}>
      📋 recibo #{v.recibo_id}
    </span>
  }
  if (s === 'reverted') {
    return <span title="Anulada y revertida en Odoo"
                 style={{ color: 'var(--text-3)', fontSize: 11 }}>
      ↩ revertida
    </span>
  }
  if (s === 'skipped') {
    return <span title="Manager sin Odoo" style={{ color: 'var(--text-3)', fontSize: 10 }}>—</span>
  }
  if (s === 'deferred') {
    return (
      <button onClick={onRetry} title="Aplicar al recibo mensual del cliente"
              style={{ background: 'none', border: 'none', cursor: 'pointer',
                       color: '#f59e0b', fontSize: 11, padding: 0,
                       display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        <RefreshCw size={11} /> aplicar a recibo
      </button>
    )
  }
  if (s === 'syncing') {
    return <Loader2 size={12} className="animate-spin" style={{ color: 'var(--text-3)' }} />
  }
  if (s === 'error') {
    return (
      <button onClick={onRetry} title={v.sync_error || 'Reintentar'}
              style={{ background: 'none', border: 'none', cursor: 'pointer',
                       color: 'var(--red)', fontSize: 11, padding: 0,
                       display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        <RefreshCw size={11} /> Reintentar
      </button>
    )
  }
  // pending — aún no probado
  return (
    <button onClick={onRetry} title="Sincronizar con Odoo"
            style={{ background: 'none', border: 'none', cursor: 'pointer',
                     color: 'var(--text-3)', fontSize: 11, padding: 0,
                     display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      <RefreshCw size={11} /> pendiente
    </button>
  )
}


// ═══════════════════════════════════════════════════════════════════════
//                              HELPERS UI
// ═══════════════════════════════════════════════════════════════════════

function Modal({ title, onClose, children, maxWidth = 480 }) {
  const overlayClose = useOverlayClose(onClose)
  return (
    <div role="dialog" aria-modal="true" {...overlayClose}
         style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  zIndex: 10000 }}>
      <div onClick={e => e.stopPropagation()}
           style={{ background: 'var(--bg-1)', borderRadius: 14, maxWidth,
                    width: '94%', maxHeight: '92vh',
                    display: 'flex', flexDirection: 'column',
                    border: '1px solid var(--line)',
                    boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
                    color: 'var(--text-0)' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)',
                       display: 'flex', alignItems: 'center', gap: 8 }}>
          <strong style={{ fontSize: 15 }}>{title}</strong>
          <span style={{ flex: 1 }} />
          {onClose && (
            <button onClick={onClose} style={{ background: 'none', border: 'none',
                                                cursor: 'pointer',
                                                color: 'var(--text-2)', padding: 4 }}>
              <X size={18} />
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  )
}

const inputStyle = {
  width: '100%', padding: 8, borderRadius: 8, fontSize: 13,
  background: 'var(--bg-2)', border: '1px solid var(--line)',
  color: 'var(--text-0)',
}
const miniBtn = {
  width: 24, height: 24, borderRadius: 6, border: '1px solid var(--line)',
  background: 'var(--bg-1)', color: 'var(--text-1)', cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
}
const btnSec = {
  padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
  background: 'var(--bg-2)', color: 'var(--text-1)', border: 'none',
  cursor: 'pointer',
}
const btnPri = {
  padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700,
  background: 'var(--green)', color: '#fff', border: 'none', cursor: 'pointer',
}
