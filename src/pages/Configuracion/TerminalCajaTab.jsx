// Configuración → Terminal de Caja
// Sub-tabs:
//   - Productos: grid + modal CRUD (+ archivar/restaurar, ajuste stock manual)
//   - Categorías: lista plantilla + per-manager (renombrar / icono / orden)
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  Loader2, Plus, Pencil, Archive, RotateCcw, Search, Tag, Package,
  Layers, X, Image as ImageIcon, Film, TrendingUp, Upload, Trash2,
  Percent,
} from 'lucide-react'
import { Card, Btn, SectionTitle, Badge } from '../../components/UI'
import { useToast } from '../../components/Toast'
import { useAuth } from '../../contexts/AuthContext'
import { useCan } from '../../hooks/useCan'
import { getRoundIdentity, centrosList } from '../../utils/configApi'
import {
  posCategoriasList, posCategoriaCreate, posCategoriaUpdate, posCategoriaArchive,
  posProductosList, posProductoCreate, posProductoUpdate,
  posProductoArchive, posProductoRestore,
  posStockAjuste, posUploadMedia,
  posDescuentosList, posDescuentoCreate, posDescuentoUpdate, posDescuentoArchive,
} from '../../utils/posApi'


export default function TerminalCajaTab() {
  const { user } = useAuth()
  const identity = useMemo(() => getRoundIdentity(user), [user])
  const [subtab, setSubtab] = useState('productos')

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12,
                     marginBottom: 16, flexWrap: 'wrap' }}>
        <SectionTitle>
          <Package size={20} style={{ marginRight: 8, color: 'var(--green)' }} />
          Terminal de Caja
        </SectionTitle>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 12,
                       background: 'var(--bg-2)' }}>
          <SubBtn active={subtab === 'productos'} onClick={() => setSubtab('productos')}>
            <Package size={13} /> Productos
          </SubBtn>
          <SubBtn active={subtab === 'categorias'} onClick={() => setSubtab('categorias')}>
            <Layers size={13} /> Categorías
          </SubBtn>
          <SubBtn active={subtab === 'descuentos'} onClick={() => setSubtab('descuentos')}>
            <Percent size={13} /> Descuentos
          </SubBtn>
        </div>
      </div>

      {subtab === 'productos'  && <ProductosPanel  identity={identity} />}
      {subtab === 'categorias' && <CategoriasPanel identity={identity} />}
      {subtab === 'descuentos' && <DescuentosPanel identity={identity} />}
    </div>
  )
}


function SubBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '6px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
      background: active ? 'var(--bg-1)' : 'transparent',
      color: active ? 'var(--green)' : 'var(--text-2)',
      border: 'none', cursor: 'pointer',
      boxShadow: active ? '0 1px 3px rgba(0,0,0,0.15)' : 'none',
    }}>{children}</button>
  )
}


// ═══════════════════════════════════════════════════════════════════════
//                         PRODUCTOS
// ═══════════════════════════════════════════════════════════════════════

function ProductosPanel({ identity }) {
  const toast = useToast()
  // Permisos finos (Fase 10) — el backend valida también con @require_permission
  const canEditar    = useCan('configuracion.pos.productos_editar')
  const canArchivar  = useCan('configuracion.pos.productos_archivar')
  const canStockAjuste = useCan('configuracion.pos.stock_ajuste')
  const [productos, setProductos] = useState([])
  const [categorias, setCategorias] = useState([])
  const [centros, setCentros] = useState([])      // [{id_trainer, nombre, ...}]
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)        // null = closed, {} = new, {...} = edit
  const [stockOpen, setStockOpen] = useState(null)    // producto for stock ajuste
  // Manager bare ⇒ ve TODOS los centros con columna "Centro" + filtro opcional.
  // Trainer impersonado ⇒ filtra automáticamente en backend a su centro.
  const managerBare = !identity?.trainerId
  const [filters, setFilters] = useState({
    q: '', cat: '', tipo: '', archivados: false,
    id_trainer: '',                                   // solo aplica si managerBare
  })

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [ps, cs, cn] = await Promise.all([
        posProductosList(identity, {
          q: filters.q, cat: filters.cat, tipo: filters.tipo,
          archivados: filters.archivados,
          id_trainer: managerBare ? filters.id_trainer : undefined,
        }),
        posCategoriasList(identity),
        // Cargar centros solo si manager bare (para selector + badges)
        managerBare ? centrosList(identity).catch(() => []) : Promise.resolve([]),
      ])
      setProductos(ps); setCategorias(cs); setCentros(cn)
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setLoading(false)
  }, [identity, filters, toast, managerBare])
  useEffect(() => { reload() }, [reload])

  // Mapa id_trainer → nombre para mostrar badges en cards
  const centroByTrainer = useMemo(() => {
    const m = {}
    for (const c of centros) m[String(c.id_trainer)] = c.nombre || c.slug || c.id_trainer
    return m
  }, [centros])

  const onArchive = async (p) => {
    if (!confirm(`¿Archivar el producto "${p.nombre}"? Dejará de aparecer en el TPV.`)) return
    try {
      await posProductoArchive(identity, p.id)
      toast.success('Archivado'); reload()
    } catch (e) { toast.error(`Error: ${e.message}`) }
  }

  const onRestore = async (p) => {
    try {
      await posProductoRestore(identity, p.id)
      toast.success('Restaurado'); reload()
    } catch (e) { toast.error(`Error: ${e.message}`) }
  }

  return (
    <>
      {/* ── Filtros ─────────────────────────────────────────────────── */}
      <Card style={{ padding: 14, marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap',
                       alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: '1 1 220px' }}>
            <Search size={13} style={{ position: 'absolute', left: 8, top: '50%',
                                        transform: 'translateY(-50%)',
                                        color: 'var(--text-3)' }} />
            <input value={filters.q}
                   onChange={e => setFilters(f => ({ ...f, q: e.target.value }))}
                   placeholder="Buscar por código, nombre, descripción…"
                   style={{ ...inputStyle, paddingLeft: 28 }} />
          </div>
          <select value={filters.cat}
                  onChange={e => setFilters(f => ({ ...f, cat: e.target.value }))}
                  style={{ ...inputStyle, width: 180 }}>
            <option value="">Todas las categorías</option>
            {categorias.map(c =>
              <option key={c.id} value={c.id}>{c.icono} {c.nombre}</option>
            )}
          </select>
          <select value={filters.tipo}
                  onChange={e => setFilters(f => ({ ...f, tipo: e.target.value }))}
                  style={{ ...inputStyle, width: 140 }}>
            <option value="">Producto + Servicio</option>
            <option value="producto">Producto</option>
            <option value="servicio">Servicio</option>
          </select>
          {managerBare && centros.length > 0 && (
            <select value={filters.id_trainer}
                    onChange={e => setFilters(f => ({ ...f, id_trainer: e.target.value }))}
                    style={{ ...inputStyle, width: 180 }}
                    title="Filtrar por centro">
              <option value="">Todos los centros</option>
              {centros.map(c =>
                <option key={c.id_trainer} value={c.id_trainer}>
                  🏢 {c.nombre || c.slug || c.id_trainer}
                </option>
              )}
            </select>
          )}
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
                          fontSize: 12, color: 'var(--text-2)', cursor: 'pointer' }}>
            <input type="checkbox" checked={filters.archivados}
                   onChange={e => setFilters(f => ({ ...f, archivados: e.target.checked }))} />
            Ver archivados
          </label>
          <div style={{ flex: 1 }} />
          {canEditar && (
            <Btn variant="primary" size="sm" onClick={() => setEditing({})}>
              <Plus size={14} /> Nuevo
            </Btn>
          )}
        </div>
      </Card>

      {/* ── Grid de productos ──────────────────────────────────────── */}
      <Card style={{ padding: 0 }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <Loader2 size={20} className="animate-spin" style={{ color: 'var(--green)' }} />
          </div>
        ) : productos.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)' }}>
            <Package size={32} style={{ opacity: 0.4 }} />
            <p style={{ marginTop: 8 }}>
              {filters.archivados ? 'No hay productos archivados.' : 'No hay productos. Crea el primero.'}
            </p>
          </div>
        ) : (
          <div style={{ display: 'grid',
                         gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                         gap: 12, padding: 16 }}>
            {productos.map(p =>
              <ProductoCard key={p.id} p={p}
                            centroNombre={managerBare ? centroByTrainer[String(p.id_trainer)] : null}
                            onEdit={canEditar ? () => setEditing(p) : null}
                            onArchive={canArchivar ? () => onArchive(p) : null}
                            onRestore={canArchivar ? () => onRestore(p) : null}
                            onStock={canStockAjuste ? () => setStockOpen(p) : null} />
            )}
          </div>
        )}
      </Card>

      {editing !== null && (
        <ProductoModal identity={identity} initial={editing}
                       categorias={categorias}
                       centros={centros}
                       managerBare={managerBare}
                       defaultTrainer={managerBare ? filters.id_trainer : null}
                       onClose={() => setEditing(null)}
                       onSaved={() => { setEditing(null); reload() }} />
      )}
      {stockOpen && (
        <StockModal identity={identity} producto={stockOpen}
                    onClose={() => setStockOpen(null)}
                    onSaved={() => { setStockOpen(null); reload() }} />
      )}
    </>
  )
}


function ProductoCard({ p, centroNombre, onEdit, onArchive, onRestore, onStock }) {
  const archivado = !!p.archived_at
  const stockBajo = p.inventariable && p.stock_actual <= (p.stock_minimo || 0)
  return (
    <div style={{
      padding: 14, borderRadius: 12,
      background: archivado ? 'var(--bg-2)' : 'var(--bg-1)',
      border: `1px solid ${archivado ? 'var(--line)' : 'var(--line-2)'}`,
      opacity: archivado ? 0.7 : 1,
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      {/* Imagen + categoría */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        {p.imagen_url ? (
          <img src={p.imagen_url} alt={p.nombre}
               style={{ width: 56, height: 56, borderRadius: 10, objectFit: 'cover',
                        background: 'var(--bg-2)' }} />
        ) : (
          <div style={{ width: 56, height: 56, borderRadius: 10,
                         background: p.categoria_color || 'var(--bg-3)',
                         color: '#fff',
                         display: 'flex', alignItems: 'center', justifyContent: 'center',
                         fontSize: 24 }}>
            {p.categoria_icono || (p.tipo === 'servicio' ? '⚙️' : '📦')}
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            <strong style={{ fontSize: 14, color: 'var(--text-0)',
                              overflow: 'hidden', textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap' }}>{p.nombre}</strong>
            {p.tipo === 'servicio' && <Badge color="blue" small>Servicio</Badge>}
            {archivado && <Badge color="gray" small>Archivado</Badge>}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-3)',
                         fontFamily: 'var(--font-mono)' }}>
            {p.codigo}
            {p.categoria_nombre && <> · {p.categoria_nombre}</>}
          </div>
          {centroNombre && (
            <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>
              🏢 {centroNombre}
            </div>
          )}
        </div>
      </div>

      {/* Precio + stock */}
      <div style={{ display: 'flex', alignItems: 'flex-end',
                     justifyContent: 'space-between', gap: 8 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--green)' }}>
            {Number(p.precio_venta).toFixed(2)} €
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-3)' }}>
            IVA {p.iva_pct}% · cuenta {p.cuenta_contable || '—'}
          </div>
        </div>
        {p.inventariable && (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 12, fontWeight: 600,
                           color: stockBajo ? 'var(--red)' : 'var(--text-2)' }}>
              {Number(p.stock_actual).toFixed(0)} ud.
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-3)' }}>
              {stockBajo ? `⚠ mín. ${p.stock_minimo}` : `stock`}
            </div>
          </div>
        )}
      </div>

      {/* Acciones — solo botones si el operador tiene el permiso correspondiente.
         null en el handler oculta el botón completamente (Sprint 2). */}
      <div style={{ display: 'flex', gap: 6, marginTop: 4,
                     borderTop: '1px solid var(--line)', paddingTop: 8 }}>
        {!archivado && (
          <>
            {onEdit && (
              <Btn variant="ghost" size="sm" onClick={onEdit}>
                <Pencil size={11} /> Editar
              </Btn>
            )}
            {p.inventariable && onStock && (
              <Btn variant="ghost" size="sm" onClick={onStock}>
                <TrendingUp size={11} /> Stock
              </Btn>
            )}
            <div style={{ flex: 1 }} />
            {onArchive && (
              <Btn variant="ghost" size="sm" onClick={onArchive}
                   style={{ color: 'var(--red)' }}>
                <Archive size={11} /> Archivar
              </Btn>
            )}
          </>
        )}
        {archivado && onRestore && (
          <Btn variant="ghost" size="sm" onClick={onRestore}>
            <RotateCcw size={11} /> Restaurar
          </Btn>
        )}
      </div>
    </div>
  )
}


// ═══════════════════════════════════════════════════════════════════════
//                       MODAL: PRODUCTO (CRUD)
// ═══════════════════════════════════════════════════════════════════════

function ProductoModal({ identity, initial, categorias,
                          centros = [], managerBare = false, defaultTrainer = null,
                          onClose, onSaved }) {
  const toast = useToast()
  const isEdit = !!initial?.id
  const [f, setF] = useState({
    codigo:         initial?.codigo || '',
    nombre:         initial?.nombre || '',
    descripcion:    initial?.descripcion || '',
    categoria_id:   initial?.categoria_id || '',
    tipo:           initial?.tipo || 'producto',
    precio_venta:   initial?.precio_venta ?? '',
    iva_pct:        initial?.iva_pct ?? 21,
    coste:          initial?.coste ?? '',
    cuenta_contable: initial?.cuenta_contable || '',
    inventariable:  !!initial?.inventariable,
    stock_actual:   initial?.stock_actual ?? 0,
    stock_minimo:   initial?.stock_minimo ?? 0,
    imagen_url:     initial?.imagen_url || '',
    video_url:      initial?.video_url || '',
    notas:          initial?.notas || '',
    // Centro: prioridad → producto existente / filtro activo / único centro
    id_trainer:
      initial?.id_trainer
      || defaultTrainer
      || (centros.length === 1 ? String(centros[0].id_trainer) : ''),
  })
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }))
  const [saving, setSaving] = useState(false)

  // Cuenta default según tipo
  useEffect(() => {
    if (!f.cuenta_contable && !isEdit) {
      set('cuenta_contable', f.tipo === 'servicio' ? '705' : '700')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.tipo])

  const submit = async () => {
    if (!f.codigo.trim()) { toast.error('Código obligatorio'); return }
    if (!f.nombre.trim()) { toast.error('Nombre obligatorio'); return }
    if (Number(f.precio_venta) < 0) { toast.error('Precio inválido'); return }
    // Centro obligatorio si manager bare crea un producto nuevo.
    // (Si está impersonando, el backend toma id_trainer del JWT — no es necesario en el body.)
    if (!isEdit && managerBare && !f.id_trainer) {
      toast.error('Selecciona el centro al que pertenece este producto.')
      return
    }
    setSaving(true)
    const payload = { ...f,
      categoria_id: f.categoria_id ? Number(f.categoria_id) : null,
      precio_venta: Number(f.precio_venta),
      iva_pct: Number(f.iva_pct),
      coste: f.coste === '' ? null : Number(f.coste),
      stock_actual: f.inventariable ? Number(f.stock_actual) : 0,
      stock_minimo: f.inventariable ? Number(f.stock_minimo) : 0,
      id_trainer: f.id_trainer || undefined,
    }
    try {
      if (isEdit) {
        await posProductoUpdate(identity, initial.id, payload)
        toast.success('Actualizado')
      } else {
        await posProductoCreate(identity, payload)
        toast.success('Creado')
      }
      onSaved && onSaved()
    } catch (e) {
      if (e.codigo === 'codigo_duplicado' || e.message.includes('codigo_duplicado')) {
        toast.error('Ya existe un producto con ese código')
      } else {
        toast.error(`Error: ${e.message}`)
      }
    }
    setSaving(false)
  }

  return (
    <ModalShell title={isEdit ? `Editar ${initial.nombre}` : 'Nuevo producto/servicio'}
                onClose={onClose} maxWidth={780}>
      <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>
        {/* Centro (solo si manager bare; trainer impersonado lo asume del JWT) */}
        {managerBare && (
          <Field label="Centro * (donde se venderá este producto)">
            {centros.length === 0 ? (
              <div style={{ padding: 10, borderRadius: 8, background: 'var(--bg-2)',
                             fontSize: 12, color: 'var(--text-3)' }}>
                No hay centros configurados. Crea uno en
                <strong> Configuración → Centros</strong>.
              </div>
            ) : (
              <select value={f.id_trainer}
                      onChange={e => set('id_trainer', e.target.value)}
                      disabled={isEdit}
                      title={isEdit ? 'El centro no se cambia desde aquí' : ''}
                      style={inputStyle}>
                <option value="">— Selecciona centro —</option>
                {centros.map(c =>
                  <option key={c.id_trainer} value={c.id_trainer}>
                    🏢 {c.nombre || c.slug || c.id_trainer}
                  </option>
                )}
              </select>
            )}
          </Field>
        )}

        {/* Tipo */}
        <Field label="Tipo">
          <div style={{ display: 'flex', gap: 8 }}>
            {[['producto', 'Producto físico'], ['servicio', 'Servicio']].map(([id, lbl]) =>
              <button key={id} onClick={() => set('tipo', id)} style={{
                padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                background: f.tipo === id ? 'var(--green)' : 'var(--bg-2)',
                color: f.tipo === id ? '#fff' : 'var(--text-1)',
                border: 'none', cursor: 'pointer',
              }}>{lbl}</button>
            )}
          </div>
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
          <Field label="Código *">
            <input value={f.codigo}
                   onChange={e => set('codigo', e.target.value.toUpperCase())}
                   placeholder="SKU-001" style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }} />
          </Field>
          <Field label="Nombre *">
            <input value={f.nombre} onChange={e => set('nombre', e.target.value)}
                   placeholder="Camiseta Round talla M" style={inputStyle} />
          </Field>
        </div>

        <Field label="Descripción">
          <textarea value={f.descripcion} onChange={e => set('descripcion', e.target.value)}
                    rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Categoría">
            <select value={f.categoria_id || ''}
                    onChange={e => set('categoria_id', e.target.value)}
                    style={inputStyle}>
              <option value="">— Sin categoría —</option>
              {categorias.map(c =>
                <option key={c.id} value={c.id}>{c.icono} {c.nombre}</option>
              )}
            </select>
          </Field>
          <Field label="Cuenta contable PGC (3 dígitos)"
                 hint="Ej. 700 (ventas), 705 (servicios), 754 (otros ingresos)">
            <input value={f.cuenta_contable}
                   onChange={e => {
                     // Solo dígitos, máximo 3
                     const v = e.target.value.replace(/\D/g, '').slice(0, 3)
                     set('cuenta_contable', v)
                   }}
                   inputMode="numeric"
                   maxLength={3}
                   placeholder={f.tipo === 'servicio' ? '705' : '700'}
                   style={{ ...inputStyle, fontFamily: 'var(--font-mono)',
                            letterSpacing: 2, textAlign: 'center' }} />
          </Field>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
          <Field label="Precio venta (€, IVA incl.) *">
            <input type="number" min="0" step="0.01"
                   value={f.precio_venta} onChange={e => set('precio_venta', e.target.value)}
                   style={inputStyle} />
          </Field>
          <Field label="IVA %">
            <select value={f.iva_pct} onChange={e => set('iva_pct', e.target.value)}
                    style={inputStyle}>
              <option value="0">0% (exento)</option>
              <option value="4">4% superreducido</option>
              <option value="10">10% reducido</option>
              <option value="21">21% general</option>
            </select>
          </Field>
          <Field label="Coste (€)" hint="Opcional, para margen">
            <input type="number" min="0" step="0.01"
                   value={f.coste} onChange={e => set('coste', e.target.value)}
                   style={inputStyle} />
          </Field>
        </div>

        {/* Stock */}
        <div style={{ padding: 12, borderRadius: 10,
                       background: 'var(--bg-2)', marginBottom: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8,
                          fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={f.inventariable}
                   onChange={e => set('inventariable', e.target.checked)}
                   disabled={f.tipo === 'servicio'} />
            <strong>Inventariable</strong>
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
              ({f.tipo === 'servicio' ? 'Solo productos físicos' : 'Lleva control de stock'})
            </span>
          </label>
          {f.inventariable && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12,
                           marginTop: 10 }}>
              <Field label="Stock actual">
                <input type="number" min="0" step="1"
                       value={f.stock_actual}
                       onChange={e => set('stock_actual', e.target.value)}
                       style={inputStyle} disabled={isEdit}
                       title={isEdit ? 'Usa "Ajuste stock" para modificar' : ''} />
              </Field>
              <Field label="Stock mínimo (alerta)">
                <input type="number" min="0" step="1"
                       value={f.stock_minimo}
                       onChange={e => set('stock_minimo', e.target.value)}
                       style={inputStyle} />
              </Field>
            </div>
          )}
        </div>

        {/* Multimedia: URL externa o subida directa al servidor */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <MediaField identity={identity}
                      kind="image"
                      label={<><ImageIcon size={11} /> Imagen</>}
                      value={f.imagen_url}
                      onChange={(v) => set('imagen_url', v)} />
          <MediaField identity={identity}
                      kind="video"
                      label={<><Film size={11} /> Vídeo (opcional)</>}
                      value={f.video_url}
                      onChange={(v) => set('video_url', v)} />
        </div>

        <Field label="Notas internas (no visibles al cliente)">
          <textarea value={f.notas} onChange={e => set('notas', e.target.value)}
                    rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
        </Field>
      </div>

      <div style={{ padding: '12px 20px', borderTop: '1px solid var(--line)',
                     display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Btn variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Btn>
        <Btn variant="primary" onClick={submit} disabled={saving}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : null}
          {' '}{isEdit ? 'Guardar cambios' : 'Crear producto'}
        </Btn>
      </div>
    </ModalShell>
  )
}


// ═══════════════════════════════════════════════════════════════════════
//                       MODAL: AJUSTE STOCK
// ═══════════════════════════════════════════════════════════════════════

function StockModal({ identity, producto, onClose, onSaved }) {
  const toast = useToast()
  const [tipo, setTipo] = useState('reposicion')
  const [cantidad, setCantidad] = useState('')
  const [motivo, setMotivo] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    const n = Number(cantidad)
    if (!n) { toast.error('Cantidad ≠ 0'); return }
    const cant = tipo === 'reposicion' ? Math.abs(n) :
                 tipo === 'baja'       ? -Math.abs(n) :
                 n   // ajuste libre
    setSaving(true)
    try {
      const res = await posStockAjuste(identity, producto.id,
                                        { cantidad: cant, tipo, motivo })
      toast.success(`Stock: ${res.stock_antes} → ${res.stock_despues}`)
      onSaved && onSaved()
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setSaving(false)
  }

  return (
    <ModalShell title={`Ajuste de stock · ${producto.nombre}`}
                onClose={onClose} maxWidth={420}>
      <div style={{ padding: 20 }}>
        <div style={{ padding: 12, background: 'var(--bg-2)', borderRadius: 8,
                       fontSize: 13, marginBottom: 14 }}>
          <strong>Stock actual: {Number(producto.stock_actual).toFixed(0)} ud.</strong>
        </div>
        <Field label="Tipo de movimiento">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 6 }}>
            {[['reposicion','+ Reposición'],['baja','− Baja'],['ajuste','Ajuste libre']].map(([id, lbl]) =>
              <button key={id} onClick={() => setTipo(id)} style={{
                padding: '8px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                background: tipo === id ? 'var(--green)' : 'var(--bg-2)',
                color: tipo === id ? '#fff' : 'var(--text-1)',
                border: 'none', cursor: 'pointer',
              }}>{lbl}</button>
            )}
          </div>
        </Field>
        <Field label={tipo === 'ajuste' ? 'Cantidad (±)' : 'Cantidad'}>
          <input type="number" step="1" value={cantidad}
                 onChange={e => setCantidad(e.target.value)}
                 placeholder={tipo === 'ajuste' ? 'ej. -3 o 5' : 'unidades'}
                 style={inputStyle} />
        </Field>
        <Field label="Motivo (opcional)">
          <input value={motivo} onChange={e => setMotivo(e.target.value)}
                 placeholder="ej. recepción pedido, merma, regalo…"
                 style={inputStyle} />
        </Field>
      </div>
      <div style={{ padding: '12px 20px', borderTop: '1px solid var(--line)',
                     display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Btn variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Btn>
        <Btn variant="primary" onClick={submit} disabled={saving || !cantidad}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : null}
          {' '}Confirmar
        </Btn>
      </div>
    </ModalShell>
  )
}


// ═══════════════════════════════════════════════════════════════════════
//                         CATEGORÍAS
// ═══════════════════════════════════════════════════════════════════════

function CategoriasPanel({ identity }) {
  const toast = useToast()
  const canEditar = useCan('configuracion.pos.categorias_editar')
  const [cats, setCats] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const arr = await posCategoriasList(identity, { incluir_inactivas: true })
      setCats(arr)
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setLoading(false)
  }, [identity, toast])
  useEffect(() => { reload() }, [reload])

  const onArchive = async (c) => {
    if (!confirm(`¿Archivar categoría "${c.nombre}"?`)) return
    try {
      await posCategoriaArchive(identity, c.id)
      toast.success('Archivada'); reload()
    } catch (e) { toast.error(`Error: ${e.message}`) }
  }

  return (
    <>
      <Card style={{ padding: 14, marginBottom: 12,
                       display: 'flex', alignItems: 'center', gap: 10 }}>
        <Layers size={16} style={{ color: 'var(--green)' }} />
        <div style={{ fontSize: 13, color: 'var(--text-2)', flex: 1 }}>
          Categorías para agrupar productos en el TPV. Las marcadas como
          <strong> plantilla </strong> son globales (todos los managers). Tu
          manager puede crear las suyas propias.
        </div>
        {canEditar && (
          <Btn variant="primary" size="sm" onClick={() => setEditing({})}>
            <Plus size={14} /> Nueva categoría
          </Btn>
        )}
      </Card>

      <Card style={{ padding: 0 }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <Loader2 size={20} className="animate-spin" style={{ color: 'var(--green)' }} />
          </div>
        ) : (
          <div style={{ display: 'grid',
                         gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                         gap: 10, padding: 16 }}>
            {cats.map(c =>
              <div key={c.id} style={{
                padding: 12, borderRadius: 10,
                background: c.active ? 'var(--bg-1)' : 'var(--bg-2)',
                border: `1px solid ${c.active ? 'var(--line)' : 'var(--line)'}`,
                display: 'flex', alignItems: 'center', gap: 10,
                opacity: c.active ? 1 : 0.5,
              }}>
                <div style={{ width: 40, height: 40, borderRadius: 8,
                               background: c.color || 'var(--bg-3)',
                               display: 'flex', alignItems: 'center', justifyContent: 'center',
                               fontSize: 20 }}>{c.icono || '📦'}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-0)' }}>
                    {c.nombre}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-3)' }}>
                    {c.es_plantilla ? '🌐 plantilla' : '👤 tu manager'}
                    {!c.active && ' · archivada'}
                  </div>
                </div>
                {!c.es_plantilla && c.active && canEditar && (
                  <>
                    <button onClick={() => setEditing(c)}
                            style={iconBtnStyle} title="Editar">
                      <Pencil size={12} />
                    </button>
                    <button onClick={() => onArchive(c)}
                            style={{ ...iconBtnStyle, color: 'var(--red)' }}
                            title="Archivar">
                      <Archive size={12} />
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </Card>

      {editing !== null && (
        <CategoriaModal identity={identity} initial={editing}
                        onClose={() => setEditing(null)}
                        onSaved={() => { setEditing(null); reload() }} />
      )}
    </>
  )
}


function CategoriaModal({ identity, initial, onClose, onSaved }) {
  const toast = useToast()
  const isEdit = !!initial?.id
  const [f, setF] = useState({
    nombre: initial?.nombre || '',
    icono:  initial?.icono || '📦',
    color:  initial?.color || '#10b981',
    orden:  initial?.orden ?? 50,
  })
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }))
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!f.nombre.trim()) { toast.error('Nombre obligatorio'); return }
    setSaving(true)
    try {
      if (isEdit) await posCategoriaUpdate(identity, initial.id, f)
      else        await posCategoriaCreate(identity, f)
      toast.success(isEdit ? 'Actualizada' : 'Creada')
      onSaved && onSaved()
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setSaving(false)
  }

  return (
    <ModalShell title={isEdit ? `Editar categoría` : 'Nueva categoría'}
                onClose={onClose} maxWidth={460}>
      <div style={{ padding: 20 }}>
        <Field label="Nombre *">
          <input value={f.nombre} onChange={e => set('nombre', e.target.value)}
                 placeholder="ej. Pre-entreno" style={inputStyle} />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
          <Field label="Icono (emoji)">
            <input value={f.icono} onChange={e => set('icono', e.target.value)}
                   maxLength={3} style={{ ...inputStyle, textAlign: 'center', fontSize: 18 }} />
          </Field>
          <Field label="Color">
            <input type="color" value={f.color} onChange={e => set('color', e.target.value)}
                   style={{ ...inputStyle, padding: 4, height: 38 }} />
          </Field>
          <Field label="Orden">
            <input type="number" min="0" max="999" value={f.orden}
                   onChange={e => set('orden', Number(e.target.value))}
                   style={inputStyle} />
          </Field>
        </div>
      </div>
      <div style={{ padding: '12px 20px', borderTop: '1px solid var(--line)',
                     display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Btn variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Btn>
        <Btn variant="primary" onClick={submit} disabled={saving}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : null}
          {' '}{isEdit ? 'Guardar' : 'Crear'}
        </Btn>
      </div>
    </ModalShell>
  )
}


// ═══════════════════════════════════════════════════════════════════════
//                         DESCUENTOS
// ═══════════════════════════════════════════════════════════════════════

function DescuentosPanel({ identity }) {
  const toast = useToast()
  const canEditar = useCan('configuracion.pos.descuentos_editar')
  const managerBare = !identity?.trainerId
  const [items, setItems] = useState([])
  const [productos, setProductos] = useState([])
  const [centros, setCentros] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  // Manager bare → centro selector (default primer centro por nombre)
  const [centroSel, setCentroSel] = useState('')

  // Carga centros una vez (para manager bare)
  useEffect(() => {
    if (!managerBare) return
    import('../../utils/configApi').then(({ centrosList }) =>
      centrosList(identity).then(cs => {
        const sorted = [...cs].sort((a, b) =>
          (a.nombre || '').localeCompare(b.nombre || ''))
        setCentros(sorted)
        if (!centroSel && sorted.length > 0)
          setCentroSel(String(sorted[0].id_trainer))
      })
    )
  // eslint-disable-next-line
  }, [managerBare])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const trainerFilter = managerBare ? centroSel : undefined
      const [ds, ps] = await Promise.all([
        posDescuentosList(identity, { id_trainer: trainerFilter, activos: 0 }),
        posProductosList(identity, { id_trainer: trainerFilter }),
      ])
      setItems(ds); setProductos(ps)
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setLoading(false)
  }, [identity, managerBare, centroSel, toast])
  useEffect(() => { reload() }, [reload])

  const onArchive = async (d) => {
    if (!confirm(`¿Archivar el descuento "${d.nombre}"?`)) return
    try { await posDescuentoArchive(identity, d.id); toast.success('Archivado'); reload() }
    catch (e) { toast.error(`Error: ${e.message}`) }
  }

  return (
    <>
      <Card style={{ padding: 14, marginBottom: 12,
                       display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Percent size={16} style={{ color: 'var(--green)' }} />
        <div style={{ fontSize: 13, color: 'var(--text-2)', flex: 1, minWidth: 240 }}>
          Descuentos aplicables en el TPV: porcentaje o importe fijo, sobre un
          producto concreto o sobre el total del ticket.
        </div>
        {managerBare && centros.length > 0 && (
          <select value={centroSel} onChange={e => setCentroSel(e.target.value)}
                  style={{ ...inputStyle, width: 180 }}>
            {centros.map(c =>
              <option key={c.id_trainer} value={c.id_trainer}>
                🏢 {c.nombre || `Centro ${c.id_trainer}`}
              </option>
            )}
          </select>
        )}
        {canEditar && (
          <Btn variant="primary" size="sm" onClick={() => setEditing({})}>
            <Plus size={14} /> Nuevo descuento
          </Btn>
        )}
      </Card>

      <Card style={{ padding: 0 }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <Loader2 size={20} className="animate-spin" style={{ color: 'var(--green)' }} />
          </div>
        ) : items.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)' }}>
            <Percent size={32} style={{ opacity: 0.4 }} />
            <p style={{ marginTop: 8 }}>
              No hay descuentos. Crea el primero — aparecerán como chip
              <strong> 🏷️ Descuentos </strong> en el TPV.
            </p>
          </div>
        ) : (
          <div style={{ display: 'grid',
                         gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                         gap: 12, padding: 16 }}>
            {items.map(d =>
              <DescuentoCard key={d.id} d={d}
                              onEdit={canEditar ? () => setEditing(d) : null}
                              onArchive={canEditar ? () => onArchive(d) : null} />
            )}
          </div>
        )}
      </Card>

      {editing !== null && (
        <DescuentoModal identity={identity} initial={editing}
                         productos={productos}
                         centros={centros}
                         managerBare={managerBare}
                         defaultTrainer={managerBare ? centroSel : null}
                         onClose={() => setEditing(null)}
                         onSaved={() => { setEditing(null); reload() }} />
      )}
    </>
  )
}


function DescuentoCard({ d, onEdit, onArchive }) {
  const esPct = d.tipo === 'porcentaje'
  return (
    <div style={{
      padding: 14, borderRadius: 12,
      background: d.active ? 'var(--bg-1)' : 'var(--bg-2)',
      border: `2px dashed ${d.color || '#ef4444'}`,
      opacity: d.active ? 1 : 0.6,
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <div style={{ width: 48, height: 48, borderRadius: 10,
                       background: d.color || '#ef4444', color: '#fff',
                       display: 'flex', alignItems: 'center',
                       justifyContent: 'center', fontSize: 24 }}>
          {d.icono || '🎁'}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong style={{ fontSize: 14, color: 'var(--text-0)' }}>{d.nombre}</strong>
          <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
            {d.ambito === 'general' ? '✨ Total del ticket'
              : `📦 ${d.producto_nombre || '?'}`}
          </div>
        </div>
        <div style={{ fontSize: 20, fontWeight: 800,
                       color: d.color || '#ef4444',
                       fontFamily: 'var(--font-mono)' }}>
          -{d.valor}{esPct ? '%' : '€'}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6,
                     borderTop: '1px solid var(--line)', paddingTop: 8 }}>
        {d.active ? (
          <>
            {onEdit && (
              <Btn variant="ghost" size="sm" onClick={onEdit}>
                <Pencil size={11} /> Editar
              </Btn>
            )}
            <div style={{ flex: 1 }} />
            {onArchive && (
              <Btn variant="ghost" size="sm" onClick={onArchive}
                   style={{ color: 'var(--red)' }}>
                <Archive size={11} /> Archivar
              </Btn>
            )}
          </>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>Archivado</span>
        )}
      </div>
    </div>
  )
}


function DescuentoModal({ identity, initial, productos, centros = [],
                          managerBare = false, defaultTrainer = null,
                          onClose, onSaved }) {
  const toast = useToast()
  const isEdit = !!initial?.id
  const [f, setF] = useState({
    codigo:      initial?.codigo || '',
    nombre:      initial?.nombre || '',
    tipo:        initial?.tipo || 'porcentaje',
    valor:       initial?.valor ?? '',
    ambito:      initial?.ambito || 'general',
    producto_id: initial?.producto_id || '',
    icono:       initial?.icono || '🎁',
    color:       initial?.color || '#ef4444',
    notas:       initial?.notas || '',
    id_trainer:  initial?.id_trainer
                 || defaultTrainer
                 || (centros.length === 1 ? String(centros[0].id_trainer) : ''),
  })
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!f.nombre.trim()) { toast.error('Nombre obligatorio'); return }
    if (!f.valor || Number(f.valor) <= 0) {
      toast.error('Valor debe ser > 0'); return
    }
    if (f.tipo === 'porcentaje' && Number(f.valor) > 100) {
      toast.error('Máximo 100%'); return
    }
    if (f.ambito === 'producto' && !f.producto_id) {
      toast.error('Selecciona el producto al que se aplica'); return
    }
    if (!isEdit && managerBare && !f.id_trainer) {
      toast.error('Selecciona el centro'); return
    }
    const payload = {
      ...f,
      valor: Number(f.valor),
      producto_id: f.ambito === 'producto' ? Number(f.producto_id) : null,
      id_trainer: f.id_trainer || undefined,
    }
    setSaving(true)
    try {
      if (isEdit) await posDescuentoUpdate(identity, initial.id, payload)
      else        await posDescuentoCreate(identity, payload)
      toast.success(isEdit ? 'Actualizado' : 'Creado')
      onSaved && onSaved()
    } catch (e) { toast.error(`Error: ${e.message}`) }
    setSaving(false)
  }

  return (
    <ModalShell title={isEdit ? `Editar ${initial.nombre}` : 'Nuevo descuento'}
                onClose={onClose} maxWidth={520}>
      <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>
        {managerBare && (
          <Field label="Centro *">
            <select value={f.id_trainer} onChange={e => set('id_trainer', e.target.value)}
                    disabled={isEdit} style={inputStyle}>
              <option value="">— Selecciona centro —</option>
              {centros.map(c =>
                <option key={c.id_trainer} value={c.id_trainer}>
                  🏢 {c.nombre || `Centro ${c.id_trainer}`}
                </option>
              )}
            </select>
          </Field>
        )}

        <Field label="Nombre *">
          <input value={f.nombre} onChange={e => set('nombre', e.target.value)}
                 placeholder="ej. Descuento socio, Promo lunes…"
                 style={inputStyle} />
        </Field>

        {/* Tipo */}
        <Field label="Tipo de descuento">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {[['porcentaje', '% Porcentaje'], ['importe', '€ Importe fijo']].map(([id, lbl]) =>
              <button key={id} onClick={() => set('tipo', id)} style={{
                padding: '10px 12px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                background: f.tipo === id ? 'var(--green)' : 'var(--bg-2)',
                color: f.tipo === id ? '#fff' : 'var(--text-1)',
                border: 'none', cursor: 'pointer',
              }}>{lbl}</button>
            )}
          </div>
        </Field>

        <Field label={f.tipo === 'porcentaje'
                       ? 'Porcentaje (1-100)' : 'Importe en € (positivo)'}>
          <input type="number" min="0" max={f.tipo === 'porcentaje' ? 100 : undefined}
                 step="0.01"
                 value={f.valor} onChange={e => set('valor', e.target.value)}
                 style={{ ...inputStyle, fontSize: 18, textAlign: 'right',
                          fontFamily: 'var(--font-mono)' }} />
        </Field>

        {/* Ámbito */}
        <Field label="¿Sobre qué se aplica?">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {[
              ['general',  '✨ Total del ticket'],
              ['producto', '📦 Un producto'],
            ].map(([id, lbl]) =>
              <button key={id} onClick={() => set('ambito', id)} style={{
                padding: '10px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                background: f.ambito === id ? 'var(--green)' : 'var(--bg-2)',
                color: f.ambito === id ? '#fff' : 'var(--text-1)',
                border: 'none', cursor: 'pointer',
              }}>{lbl}</button>
            )}
          </div>
        </Field>

        {f.ambito === 'producto' && (
          <Field label="Producto al que se vincula *">
            <select value={f.producto_id} onChange={e => set('producto_id', e.target.value)}
                    style={inputStyle}>
              <option value="">— Selecciona producto —</option>
              {productos.map(p =>
                <option key={p.id} value={p.id}>{p.codigo} · {p.nombre}</option>
              )}
            </select>
          </Field>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Icono">
            <input value={f.icono} onChange={e => set('icono', e.target.value)}
                   maxLength={3}
                   style={{ ...inputStyle, textAlign: 'center', fontSize: 20 }} />
          </Field>
          <Field label="Color">
            <input type="color" value={f.color} onChange={e => set('color', e.target.value)}
                   style={{ ...inputStyle, padding: 4, height: 38 }} />
          </Field>
        </div>

        <Field label="Notas (opcional)">
          <textarea value={f.notas} onChange={e => set('notas', e.target.value)}
                    rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
        </Field>
      </div>

      <div style={{ padding: '12px 20px', borderTop: '1px solid var(--line)',
                     display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Btn variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Btn>
        <Btn variant="primary" onClick={submit} disabled={saving}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : null}
          {' '}{isEdit ? 'Guardar' : 'Crear descuento'}
        </Btn>
      </div>
    </ModalShell>
  )
}


// ═══════════════════════════════════════════════════════════════════════
//                         HELPERS UI
// ═══════════════════════════════════════════════════════════════════════

function ModalShell({ title, children, onClose, maxWidth = 600 }) {
  return (
    <div role="dialog" aria-modal="true"
         style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  zIndex: 10000 }}
         onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
           style={{ background: 'var(--bg-1)', borderRadius: 14, maxWidth,
                    width: '92%', maxHeight: '90vh', display: 'flex', flexDirection: 'column',
                    border: '1px solid var(--line)',
                    boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
                    color: 'var(--text-0)' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line)',
                       display: 'flex', alignItems: 'center', gap: 8 }}>
          <strong style={{ fontSize: 15 }}>{title}</strong>
          <div style={{ flex: 1 }} />
          <button onClick={onClose}
                  style={{ background: 'none', border: 'none', cursor: 'pointer',
                           padding: 4, color: 'var(--text-2)' }}>
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}


// ─────────────────────────────────────────────────────────────────────────
// MediaField — input híbrido: pegar URL externa o subir archivo al server.
// El archivo subido va a /var/www/round/uploads/pos/<manager>/<uuid>.<ext>
// y el componente recibe la URL pública (relativa: /uploads/pos/...).
// ─────────────────────────────────────────────────────────────────────────
function MediaField({ identity, kind = 'image', label, value, onChange }) {
  const toast = useToast()
  const inputRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  // Para mostrar preview con host completo en producción
  const previewUrl = value && value.startsWith('/')
    ? `${window.location.origin}${value}`
    : value
  const accept = kind === 'image'
    ? 'image/png,image/jpeg,image/gif,image/webp,image/avif'
    : 'video/mp4,video/webm,video/quicktime'
  const maxMB = kind === 'image' ? 10 : 80

  const onPick = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > maxMB * 1024 * 1024) {
      toast.error(`Archivo demasiado grande. Máximo ${maxMB} MB.`)
      e.target.value = ''
      return
    }
    setUploading(true)
    try {
      const res = await posUploadMedia(identity, file, kind)
      onChange(res.url)
      toast.success(`Subido: ${res.filename}`)
    } catch (err) {
      toast.error(`Error al subir: ${err.message}`)
    }
    setUploading(false)
    e.target.value = ''
  }

  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 11, color: 'var(--text-3)',
                       marginBottom: 4 }}>{label}</label>

      {/* Preview */}
      {value && (
        <div style={{ marginBottom: 6, padding: 6, borderRadius: 8,
                       background: 'var(--bg-2)', display: 'flex',
                       gap: 8, alignItems: 'center' }}>
          {kind === 'image' ? (
            <img src={previewUrl} alt=""
                 style={{ width: 56, height: 56, objectFit: 'cover',
                          borderRadius: 6, background: 'var(--bg-3)' }}
                 onError={(e) => { e.target.style.opacity = 0.3 }} />
          ) : (
            <div style={{ width: 56, height: 56, borderRadius: 6,
                           background: 'var(--bg-3)', color: 'var(--text-2)',
                           display: 'flex', alignItems: 'center',
                           justifyContent: 'center' }}>
              <Film size={20} />
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0, fontSize: 11,
                         color: 'var(--text-2)', wordBreak: 'break-all' }}>
            {value.startsWith('/uploads/') ? '📁 ' + value.split('/').pop() : '🔗 ' + value}
          </div>
          <button onClick={() => onChange('')} type="button"
                  title="Quitar"
                  style={{ background: 'none', border: 'none', cursor: 'pointer',
                           color: 'var(--red)', padding: 4 }}>
            <Trash2 size={14} />
          </button>
        </div>
      )}

      {/* Inputs */}
      <div style={{ display: 'flex', gap: 6 }}>
        <input value={value || ''} onChange={e => onChange(e.target.value)}
               placeholder="URL externa https://…  o sube archivo →"
               style={{ ...inputStyle, flex: 1, fontSize: 12 }} />
        <input ref={inputRef} type="file" accept={accept}
               onChange={onPick} style={{ display: 'none' }} />
        <button type="button" onClick={() => inputRef.current?.click()}
                disabled={uploading}
                title={`Subir archivo (máx ${maxMB} MB)`}
                style={{
                  padding: '8px 12px', borderRadius: 8, fontSize: 12,
                  background: uploading ? 'var(--bg-3)' : 'var(--green)',
                  color: '#fff', border: 'none',
                  cursor: uploading ? 'wait' : 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  whiteSpace: 'nowrap',
                }}>
          {uploading
            ? <Loader2 size={14} className="animate-spin" />
            : <Upload size={14} />}
          Subir
        </button>
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 3 }}>
        {kind === 'image'
          ? 'PNG · JPG · GIF · WEBP · AVIF — máx 10 MB'
          : 'MP4 · WEBM · MOV — máx 80 MB'}
      </div>
    </div>
  )
}


function Field({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 11, color: 'var(--text-3)',
                       marginBottom: 4 }}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 3 }}>{hint}</div>}
    </div>
  )
}


const inputStyle = {
  width: '100%', padding: 8, borderRadius: 8, fontSize: 13,
  background: 'var(--bg-2)', border: '1px solid var(--line)', color: 'var(--text-0)',
}
const iconBtnStyle = {
  background: 'transparent', border: 'none', cursor: 'pointer',
  padding: 6, borderRadius: 6, color: 'var(--text-2)',
}
