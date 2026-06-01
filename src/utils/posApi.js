// POS (Terminal de Caja) — cliente API.
// Endpoints en backend bajo /api/pos/.

const BASE = '/api/pos'
const TOKEN = import.meta.env.VITE_CONFIG_API_TOKEN || ''


function headers(identity) {
  const h = {
    'Content-Type': 'application/json',
    'X-Round-Token': TOKEN,
    'X-Round-Manager-Id': identity?.managerId || '',
  }
  if (identity?.trainerId) h['X-Round-Trainer-Id'] = String(identity.trainerId)
  return h
}


async function _req(method, path, identity, body = null) {
  const init = { method, headers: headers(identity) }
  if (body) init.body = JSON.stringify(body)
  const r = await fetch(`${BASE}${path}`, init)
  const text = await r.text()
  let data
  try { data = JSON.parse(text) } catch { data = { error: text } }
  if (!r.ok || data?.ok === false) {
    const e = new Error(data?.detalle || data?.error || `HTTP ${r.status}`)
    e.codigo = data?.codigo
    e.status = r.status
    throw e
  }
  return data
}


// ─── Categorías ─────────────────────────────────────────────────────────
export const posCategoriasList = (identity, { incluir_inactivas = false } = {}) =>
  _req('GET',
       `/categorias${incluir_inactivas ? '?incluir_inactivas=1' : ''}`,
       identity).then(d => d.categorias || [])

export const posCategoriaCreate = (identity, body) =>
  _req('POST', '/categorias', identity, body).then(d => d.categoria)

export const posCategoriaUpdate = (identity, id, body) =>
  _req('PATCH', `/categorias/${id}`, identity, body).then(d => d.categoria)

export const posCategoriaArchive = (identity, id) =>
  _req('DELETE', `/categorias/${id}`, identity).then(d => d.ok)


// ─── Productos ──────────────────────────────────────────────────────────
// Productos son per-trainer. Si `identity.trainerId` está presente, el
// backend filtra automáticamente. Para forzar otro centro desde un manager
// bare pasar `params.id_trainer = 'X'`.
export const posProductosList = (identity, params = {}) => {
  const qs = new URLSearchParams()
  if (params.archivados) qs.set('archivados', '1')
  if (params.cat) qs.set('cat', params.cat)
  if (params.tipo) qs.set('tipo', params.tipo)
  if (params.q) qs.set('q', params.q)
  if (params.id_trainer) qs.set('id_trainer', params.id_trainer)
  const suf = qs.toString() ? `?${qs}` : ''
  return _req('GET', `/productos${suf}`, identity).then(d => d.productos || [])
}

export const posProductoGet = (identity, id) =>
  _req('GET', `/productos/${id}`, identity).then(d => d.producto)

export const posProductoCreate = (identity, body) =>
  _req('POST', '/productos', identity, body).then(d => d.id)

export const posProductoUpdate = (identity, id, body) =>
  _req('PATCH', `/productos/${id}`, identity, body).then(d => d.ok)

export const posProductoArchive = (identity, id) =>
  _req('POST', `/productos/${id}/archivar`, identity).then(d => d.ok)

export const posProductoRestore = (identity, id) =>
  _req('POST', `/productos/${id}/restaurar`, identity).then(d => d.ok)


// ─── Stock ──────────────────────────────────────────────────────────────
export const posStockAjuste = (identity, id, body) =>
  _req('POST', `/productos/${id}/stock/ajuste`, identity, body)

export const posStockHistorial = (identity, id) =>
  _req('GET', `/productos/${id}/stock/historial`, identity).then(d => d.movimientos || [])


// ─── Subida de media (imagen / vídeo) ───────────────────────────────────
// Devuelve { ok, url, kind, size, filename }. La URL pública es relativa
// ('/uploads/pos/<manager>/<uuid>.<ext>') — se sirve bajo el mismo host.
export const posUploadMedia = async (identity, file, kind = null) => {
  const fd = new FormData()
  fd.append('file', file)
  if (kind) fd.append('kind', kind)
  const h = {
    'X-Round-Token': TOKEN,
    'X-Round-Manager-Id': identity?.managerId || '',
  }
  if (identity?.trainerId) h['X-Round-Trainer-Id'] = String(identity.trainerId)
  const r = await fetch(`${BASE}/upload-media`, { method: 'POST', headers: h, body: fd })
  const data = await r.json().catch(() => ({}))
  if (!r.ok || data?.ok === false) {
    const e = new Error(data?.detalle || data?.error || `HTTP ${r.status}`)
    e.status = r.status
    throw e
  }
  return data
}

export const posDeleteMedia = (identity, url) =>
  _req('DELETE', '/upload-media', identity, { url })


// ─── Ventas TPV ─────────────────────────────────────────────────────────
export const posVentaCreate = (identity, body) =>
  _req('POST', '/ventas', identity, body)

export const posVentasList = (identity, params = {}) => {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, v)
  }
  const suf = qs.toString() ? `?${qs}` : ''
  return _req('GET', `/ventas${suf}`, identity).then(d => d.ventas || [])
}

export const posVentaGet = (identity, id) =>
  _req('GET', `/ventas/${id}`, identity)

export const posVentaAnular = (identity, id, motivo = '') =>
  _req('POST', `/ventas/${id}/anular`, identity, { motivo })

// Reintento de sync con Odoo (fase 4)
export const posVentaSyncOdoo = (identity, id) =>
  _req('POST', `/ventas/${id}/sync-odoo`, identity)


// ─── Descuentos ─────────────────────────────────────────────────────────
export const posDescuentosList = (identity, params = {}) => {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, v)
  }
  const suf = qs.toString() ? `?${qs}` : ''
  return _req('GET', `/descuentos${suf}`, identity).then(d => d.descuentos || [])
}
export const posDescuentoCreate = (identity, body) =>
  _req('POST', '/descuentos', identity, body).then(d => d.descuento)
export const posDescuentoUpdate = (identity, id, body) =>
  _req('PATCH', `/descuentos/${id}`, identity, body).then(d => d.descuento)
export const posDescuentoArchive = (identity, id) =>
  _req('DELETE', `/descuentos/${id}`, identity)


// ─── Caja — cuadre diario (Fase 8) ──────────────────────────────────────
export const posCajaResumen = (identity, { fecha, id_trainer } = {}) => {
  const qs = new URLSearchParams()
  if (fecha) qs.set('fecha', fecha)
  if (id_trainer) qs.set('id_trainer', id_trainer)
  const suf = qs.toString() ? `?${qs}` : ''
  return _req('GET', `/caja/resumen${suf}`, identity)
}
export const posCajaCerrar = (identity, body) =>
  _req('POST', '/caja/cerrar', identity, body)
export const posCajaCierres = (identity, params = {}) => {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, v)
  }
  const suf = qs.toString() ? `?${qs}` : ''
  return _req('GET', `/caja/cierres${suf}`, identity).then(d => d.cierres || [])
}


// ─── Proveedores (Fase 7) ───────────────────────────────────────────────
export const posProveedoresList = (identity, params = {}) => {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, v)
  }
  const suf = qs.toString() ? `?${qs}` : ''
  return _req('GET', `/proveedores${suf}`, identity).then(d => d.facturas || [])
}
export const posProveedorGet = (identity, id) =>
  _req('GET', `/proveedores/${id}`, identity).then(d => d.factura)
export const posProveedorCreate = (identity, body) =>
  _req('POST', '/proveedores', identity, body).then(d => d.factura)
export const posProveedorUpdate = (identity, id, body) =>
  _req('PATCH', `/proveedores/${id}`, identity, body).then(d => d.factura)
export const posProveedorAnular = (identity, id, motivo = '') =>
  _req('POST', `/proveedores/${id}/anular`, identity, { motivo })
export const posProveedorSync = (identity, id) =>
  _req('POST', `/proveedores/${id}/sync`, identity)


// ─── Dashboard ventas (Fase 9) ──────────────────────────────────────────
export const posDashboard = (identity, params = {}) => {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, v)
  }
  const suf = qs.toString() ? `?${qs}` : ''
  return _req('GET', `/dashboard${suf}`, identity)
}
