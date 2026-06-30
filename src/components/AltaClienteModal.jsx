// Modal de Alta Cliente — flujo guiado para procesar a un cliente recién
// registrado en NoofitPro (escaneando QR del trainer).
//
// Pide solo lo necesario, en orden:
//   1. Categoría (selección)
//   2. Cuotas (multi-selección, soporta multicuota)
//   3. Fecha de alta (default: hoy)
//   4. Periodicidad (mensual / trimestral / …)
//   5. Forma de pago RECURRENTE (sepa / tarjeta_token / efectivo / enlace_pago)
//      → si SEPA, pide IBAN
//   6. Texto del recibo de alta (default: "Alta + cuota")
//   7. Importe primera cuota
//   8. Fecha fin del primer pago (default: fin del periodo)
//   9. Forma de pago del ALTA (caja / TPV / pasarela)
//
// Al aceptar:
//   1. Asigna la categoría al cliente (BD round_config)
//   2. Crea forma_pago_cliente (BD) con la forma recurrente + IBAN si SEPA
//   3. Por cada cuota seleccionada: llama a /api/cuotas/alta-cliente
//      (que crea sub Odoo + recibo + procesa pago).
//   4. La sub queda activa y el primer recibo marcado como pagado
//      (o impagado si forma_pago_alta = aplazar).

import { useState, useEffect, useMemo } from 'react'
import {
  Loader2, CheckCircle2, X, Tag, Receipt, Calendar, CreditCard,
  Wallet, Info, Trash2,
} from 'lucide-react'
import { Btn, Card, Badge } from './UI'
import Modal from './Modal'
import { useToast } from './Toast'
import { useAuth } from '../contexts/AuthContext'
import {
  getRoundIdentity, cuotasList as cfgCuotasList, descuentosList,
  pasarelasList, epAltaCreate, EP_FORMAS_POR_ENTRADA, EP_FORMAS_POR_MES,
} from '../utils/configApi'
import { altaCliente } from '../utils/cuotasApi'
import { useCategoriasMap } from '../hooks/useCategoriasMap'
import { validarIBAN } from '../utils/validators'
import IBANInput from './IBANInput'

const PERIODICIDAD_OPTS = [
  { value: 'mensual',    label: 'Mensual',    dias: 30 },
  { value: 'bimensual',  label: 'Bimensual',  dias: 60 },
  { value: 'trimestral', label: 'Trimestral', dias: 90 },
  { value: 'semestral',  label: 'Semestral',  dias: 180 },
  { value: 'anual',      label: 'Anual',      dias: 365 },
]

const FORMA_PAGO_RECURRENTE_OPTS = [
  { value: 'sepa',          label: 'SEPA — domiciliación bancaria (IBAN)' },
  { value: 'tarjeta_token', label: 'Tarjeta tokenizada (recurrente)' },
  { value: 'enlace_pago',   label: 'Enlace de pago / Bizum' },
  { value: 'efectivo',      label: 'Efectivo / caja' },
]

// Forma de pago de la PRIMERA cuota (caja, tarjeta TPV, pasarela)
const FORMA_PAGO_ALTA_OPTS = [
  { value: 'efectivo',    label: 'Caja (efectivo)' },
  { value: 'tpv_fisico',  label: 'TPV físico (datáfono)' },
  { value: 'enlace_pago', label: 'Enlace de pago (PayComet)' },
  { value: 'aplazar',     label: 'Aplazar al próximo recibo' },
]

// Calcular fin de periodicidad desde una fecha (default: fin de mes)
function calcFinPeriodo(fechaIni, periodicidad) {
  if (!fechaIni) return ''
  const d = new Date(fechaIni)
  if (isNaN(d)) return ''
  const opt = PERIODICIDAD_OPTS.find(o => o.value === periodicidad) || PERIODICIDAD_OPTS[0]
  // Mensual → último día del mes corriente
  if (opt.value === 'mensual') {
    const fin = new Date(d.getFullYear(), d.getMonth() + 1, 0)
    return fin.toISOString().slice(0, 10)
  }
  // Otros → sumar N días
  const fin = new Date(d)
  fin.setDate(fin.getDate() + opt.dias)
  return fin.toISOString().slice(0, 10)
}

function hoyISO() {
  return new Date().toISOString().slice(0, 10)
}

export default function AltaClienteModal({ cliente, onClose, onSaved, recaptacion = false }) {
  const toast = useToast()
  const { user } = useAuth()
  const identity = useMemo(() => getRoundIdentity(user), [user])

  // ── Catálogos ──
  const [cuotasCat, setCuotasCat] = useState([])
  const [descuentos, setDescuentos] = useState([])
  const [pasarelas, setPasarelas] = useState([])
  const { categorias, mapa: catMapa, setCategoria: setCategoriaBD, loaded: catLoaded } =
    useCategoriasMap()

  // ── Form state ──
  const [categoriaId, setCategoriaId] = useState('')
  const [cuotasSeleccionadas, setCuotasSeleccionadas] = useState([])  // array de codigos
  const [fechaAlta, setFechaAlta] = useState(hoyISO())
  const [periodicidad, setPeriodicidad] = useState('mensual')
  const [formaPagoRecurrente, setFormaPagoRecurrente] = useState('sepa')
  const [iban, setIban] = useState('')
  const [textoRecibo, setTextoRecibo] = useState('Alta + cuota')
  const [importePrimera, setImportePrimera] = useState('')
  const [justificacionCero, setJustificacionCero] = useState('')
  const [fechaFinPrimero, setFechaFinPrimero] = useState(calcFinPeriodo(hoyISO(), 'mensual'))
  const [formaPagoAlta, setFormaPagoAlta] = useState('efectivo')
  // Entrada puntual
  const [epModo, setEpModo] = useState('por_entrada')   // por_entrada | por_mes
  const [epForma, setEpForma] = useState('efectivo')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Sincronizar fecha fin cuando cambia fecha alta o periodicidad
  useEffect(() => {
    setFechaFinPrimero(calcFinPeriodo(fechaAlta, periodicidad))
  }, [fechaAlta, periodicidad])

  // Carga catálogos del manager
  useEffect(() => {
    if (!identity?.managerId) return
    cfgCuotasList(identity).then(arr => setCuotasCat((arr || []).filter(c => c.active !== false)))
                          .catch(() => setCuotasCat([]))
    descuentosList(identity).then(arr => setDescuentos((arr || []).filter(d => d.active !== false)))
                            .catch(() => setDescuentos([]))
    if (typeof pasarelasList === 'function') {
      pasarelasList(identity).then(arr => setPasarelas(arr || []))
                             .catch(() => setPasarelas([]))
    }
  }, [identity?.managerId, identity?.trainerId])

  // Detectar descuentos combinados activos según las cuotas seleccionadas.
  // Soporta:
  //  - precio_combo (legacy): cuota_requerida + cuota_aplicada + precio_final
  //  - varias_cuotas (nuevo): cuota_requerida + lista combo_secundarias[{cuota_codigo, precio}]
  // Devuelve { codigoCuotaAfectada: {precio, descuento} } por cada cuota
  // a la que se le aplica precio combinado.
  const comboPrecios = useMemo(() => {
    const aplicar = {}
    if (!descuentos || cuotasSeleccionadas.length === 0) return aplicar
    for (const c of descuentos) {
      if (!c.cuota_requerida_codigo) continue
      if (!cuotasSeleccionadas.includes(c.cuota_requerida_codigo)) continue
      // varias_cuotas: lista de secundarias con precio cada una
      if (c.tipo === 'varias_cuotas') {
        const sec = Array.isArray(c.combo_secundarias) ? c.combo_secundarias : []
        for (const s of sec) {
          if (s?.cuota_codigo && cuotasSeleccionadas.includes(s.cuota_codigo)) {
            aplicar[s.cuota_codigo] = { precio: Number(s.precio), descuento: c }
          }
        }
      }
      // precio_combo (legacy): una sola cuota aplicada
      else if (c.tipo === 'precio_combo' && c.cuota_aplicada_codigo
               && cuotasSeleccionadas.includes(c.cuota_aplicada_codigo)) {
        aplicar[c.cuota_aplicada_codigo] = { precio: Number(c.precio_final), descuento: c }
      }
    }
    return aplicar
  }, [descuentos, cuotasSeleccionadas])

  // Pre-seleccionar categoría existente
  useEffect(() => {
    if (!cliente || !catLoaded) return
    const actual = catMapa[String(cliente.id)]
    if (actual?.id) setCategoriaId(String(actual.id))
  }, [cliente?.id, catLoaded, catMapa])

  // Pre-rellenar importe primera cuota cuando se elige una cuota única.
  // Si hay combo aplicable, usar su precio_final.
  useEffect(() => {
    if (cuotasSeleccionadas.length === 0) return
    const codigo = cuotasSeleccionadas[0]
    const c = cuotasCat.find(x => x.codigo === codigo)
    if (!c) return
    // Si esta cuota está afectada por un combo, usar el precio_final
    const combo = comboPrecios[codigo]
    if (combo) {
      setImportePrimera(String(combo.precio))
      return
    }
    const campo = `precio_${periodicidad}`
    const precio = c[campo] != null ? c[campo] : c.precio_mensual
    if (precio != null && precio > 0 && !importePrimera) {
      setImportePrimera(String(precio))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cuotasSeleccionadas, periodicidad, comboPrecios])

  // ── Validaciones ──
  const categoriasActivas = (categorias || []).filter(c => c.activa)
  const necesitaIban = formaPagoRecurrente === 'sepa'
  const ibanValido = !necesitaIban || (iban && validarIBAN(iban))
  const tieneTokenizacion = pasarelas.some(p => p.activa && /paycomet|pasarela/i.test(p.tipo || ''))
  const opcionesFormaPago = FORMA_PAGO_RECURRENTE_OPTS.filter(o =>
    o.value !== 'tarjeta_token' || tieneTokenizacion
  )
  const opcionesFormaPagoAlta = FORMA_PAGO_ALTA_OPTS.filter(o =>
    o.value !== 'enlace_pago' || tieneTokenizacion
  )

  // Categoría seleccionada (objeto) y si requiere cuota. Categorías como
  // Wellhub, Invitado o Trabajador suelen tener tiene_cuota=false → no se
  // les emite recibo y por tanto no hay que pedir cuota/IBAN/etc.
  const categoriaSel = (categorias || []).find(c => String(c.id) === String(categoriaId))
  const requiereCuota = !!categoriaSel?.tiene_cuota

  // Entrada puntual: si la (única) cuota seleccionada es de tipo entrada_puntual
  // cambiamos el flujo (modo de cobro en vez de importe/recibo).
  const cuotaUnicaSel = cuotasSeleccionadas.length === 1
    ? cuotasCat.find(c => c.codigo === cuotasSeleccionadas[0]) : null
  const esEntradaPuntual = cuotaUnicaSel?.tipo_cuota === 'entrada_puntual'
  const epFormas = epModo === 'por_mes' ? EP_FORMAS_POR_MES : EP_FORMAS_POR_ENTRADA
  const epNecesitaIban = esEntradaPuntual && epModo === 'por_mes' && epForma === 'sepa'

  // Al cambiar de modo, asegurar que la forma de pago elegida sigue siendo
  // válida para ese modo (si no, coger la primera válida).
  useEffect(() => {
    if (!esEntradaPuntual) return
    const validas = (epModo === 'por_mes' ? EP_FORMAS_POR_MES : EP_FORMAS_POR_ENTRADA).map(f => f.id)
    if (!validas.includes(epForma)) setEpForma(validas[0])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epModo, esEntradaPuntual])

  const validar = () => {
    if (!categoriaId) return 'Elige una categoría'
    if (!requiereCuota) return null    // categoría sin cuota: no exigimos nada más
    if (cuotasSeleccionadas.length === 0) return 'Selecciona al menos una cuota'
    // Entrada puntual: validación propia (modo + forma de pago)
    if (esEntradaPuntual) {
      if (!epModo) return 'Elige cómo se cobra (por entrada o por mes)'
      if (!epForma) return 'Elige la forma de pago'
      if (epNecesitaIban && !ibanValido) return 'IBAN inválido (requerido para SEPA)'
      return null
    }
    if (cuotasSeleccionadas.some(cod => {
      const c = cuotasCat.find(x => x.codigo === cod)
      return c?.tipo_cuota === 'entrada_puntual'
    })) return 'Las cuotas de entrada puntual deben darse de alta de una en una'
    if (!fechaAlta) return 'Pon una fecha de alta'
    if (!periodicidad) return 'Elige una periodicidad'
    if (!formaPagoRecurrente) return 'Elige una forma de pago recurrente'
    if (necesitaIban && !ibanValido) return 'IBAN inválido (requerido para SEPA)'
    // Importe primera cuota: permitimos 0 (cortesía/beca/promo) PERO exigiendo
    // una justificación. Negativo o vacío siguen siendo inválidos.
    if (importePrimera === '' || isNaN(Number(importePrimera)) || Number(importePrimera) < 0)
      return 'Importe primera cuota inválido'
    if (Number(importePrimera) === 0 && !justificacionCero.trim())
      return 'Indica la justificación del importe 0€'
    if (!textoRecibo.trim()) return 'Escribe el texto del recibo'
    if (!fechaFinPrimero) return 'Fecha fin del primer pago inválida'
    if (!formaPagoAlta) return 'Elige forma de pago del alta'
    return null
  }

  const toggleCuota = (codigo) => {
    setCuotasSeleccionadas(prev =>
      prev.includes(codigo) ? prev.filter(c => c !== codigo) : [...prev, codigo]
    )
  }

  // ── Aceptar ──
  const handleSave = async () => {
    const err = validar()
    if (err) { setError(err); return }
    setError('')
    setSaving(true)
    try {
      // 1. Asignar categoría
      try {
        await setCategoriaBD(cliente.id, parseInt(categoriaId, 10))
      } catch (e) {
        console.warn('no se pudo guardar categoría:', e?.message)
      }

      // Si la categoría NO requiere cuota (Wellhub, Invitado, Trabajador…),
      // basta con haber asignado la categoría. Sin recibo, sin suscripción.
      if (!requiereCuota) {
        toast.success(`Categoría asignada: ${categoriaSel?.nombre}. No requiere cuota.`)
        if (typeof onSaved === 'function') {
          try { await onSaved() } catch {}
        }
        onClose()
        return
      }

      // Entrada puntual: registrar el alta local (sin recibo ahora; las
      // entradas se cobran por reserva confirmada / al cierre de mes).
      if (esEntradaPuntual) {
        const nombre = `${cliente.nombre || cliente.name || ''} ${cliente.apellidos || cliente.surname || ''}`.trim()
        await epAltaCreate(identity, {
          cliente_idnoofit: String(cliente.id),
          cliente_nombre: nombre,
          cuota_codigo: cuotaUnicaSel.codigo,
          actividades_idnoofit: cuotaUnicaSel.actividades_idnoofit || [],
          modo: epModo,
          forma_pago: epForma,
          precio_entrada: Number(cuotaUnicaSel.precio_entrada || 0),
          iban: epNecesitaIban ? iban : null,
        })
        toast.success(
          epModo === 'por_entrada'
            ? 'Alta en entrada puntual. Cada reserva confirmada aparecerá para cobrar en recepción.'
            : 'Alta en entrada puntual. Las entradas se facturarán agregadas al cierre de mes.'
        )
        if (typeof onSaved === 'function') { try { await onSaved() } catch {} }
        onClose()
        return
      }

      // 2. Llamar alta-cliente por cada cuota seleccionada
      const idnoofit = String(cliente.id)
      const errores = []
      const exitos = []
      for (const cuotaCodigo of cuotasSeleccionadas) {
        const cuotaInfo = cuotasCat.find(x => x.codigo === cuotaCodigo)
        // Si la cuota está afectada por un descuento combo, usar precio_final
        const combo = comboPrecios[cuotaCodigo]
        const importeEsta = combo
          ? Number(combo.precio)
          : (cuotasSeleccionadas.length === 1
              ? Number(importePrimera)
              : (cuotaInfo?.[`precio_${periodicidad}`] ?? cuotaInfo?.precio_mensual ?? 0))
        const payload = {
          cliente: {
            idnoofit,
            nombre: cliente.nombre || cliente.name || '',
            apellidos: cliente.apellidos || cliente.surname || '',
            email: cliente.email || '',
            movil: cliente.cellPhone || cliente.movil || '',
            dni: cliente.dni || '',
            iban: necesitaIban ? iban : '',
          },
          suscripcion: {
            cuota_codigo: cuotaCodigo,
            periodicidad,
            forma_pago_recurrente: formaPagoRecurrente,
            fecha_alta: fechaAlta,
          },
          alta: {
            forma_pago_alta: formaPagoAlta,
            importe_alta: importeEsta,
            matricula: 0,
            recaptacion: !!recaptacion,
            descripcion: textoRecibo.trim(),
            fecha_vencimiento: fechaFinPrimero,
            // Importe 0 justificado: el backend NO sustituirá por precio
            // catálogo y guardará la justificación en el recibo.
            importe_cero_justificado: Number(importeEsta) === 0,
            justificacion: Number(importeEsta) === 0 ? justificacionCero.trim() : '',
          },
        }
        try {
          const r = await altaCliente(identity, payload)
          if (r?.ok) exitos.push({ cuota: cuotaCodigo, recibo: r.invoice_id })
          else errores.push({ cuota: cuotaCodigo, error: r?.error || 'desconocido' })
        } catch (e) {
          errores.push({ cuota: cuotaCodigo, error: e.message })
        }
      }

      if (exitos.length > 0) {
        const msgEx = exitos.map(e => `${e.cuota} (recibo #${e.recibo})`).join(', ')
        toast.success(`Alta procesada: ${msgEx}`)
      }
      if (errores.length > 0) {
        const msgEr = errores.map(e => `${e.cuota}: ${e.error}`).join('; ')
        toast.warning(`Avisos: ${msgEr}`)
      }
      if (errores.length === 0) {
        if (typeof onSaved === 'function') {
          try { await onSaved() } catch {}
        }
        onClose()
      } else {
        setError('Algunas cuotas fallaron. Revisa los avisos arriba.')
      }
    } catch (e) {
      setError('Error al procesar el alta: ' + (e.message || ''))
    }
    setSaving(false)
  }

  if (!cliente) return null

  return (
    <Modal open={!!cliente} onClose={onClose} disabled={saving}
           title="Alta de cliente"
           subtitle={`${cliente.name || cliente.nombre || ''} ${cliente.surname || cliente.apellidos || ''}`.trim()
                     || `Cliente #${cliente.id}`}
           maxWidth={900}>
      <div style={{ padding: '20px 28px', flex: 1, overflowY: 'auto', minHeight: 0 }}>
        <div style={{
          padding: '12px 14px', marginBottom: 18, borderRadius: 12,
          background: 'var(--blue-bg)', border: '1px solid var(--blue-border)',
          display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13, color: 'var(--text-1)',
        }}>
          <Info size={16} style={{ color: 'var(--blue)', flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
          <p style={{ margin: 0, lineHeight: 1.5 }}>
            Configura el alta de este cliente: categoría, cuota, forma de pago y primer recibo.
            El primer recibo se generará y marcará como <strong>pagado</strong> según la forma de
            pago del alta. La suscripción quedará activa para los siguientes recibos automáticos.
          </p>
        </div>

        {/* 1. Categoría */}
        <Section icon={Tag} title="1. Categoría del cliente" required>
          <select value={categoriaId} onChange={e => setCategoriaId(e.target.value)}
                  style={inputStyle} aria-required="true">
            <option value="">— Selecciona —</option>
            {categoriasActivas.map(c => (
              <option key={c.id} value={c.id}>
                {c.nombre}{c.tiene_cuota ? ' · cuota' : ''}{!c.puede_reservar ? ' · sin reserva' : ''}
              </option>
            ))}
          </select>
          {categoriaSel && !requiereCuota && (
            <p style={{
              marginTop: 10, padding: '10px 12px', borderRadius: 8,
              background: 'rgba(45,212,168,0.10)',
              border: '1px solid rgba(45,212,168,0.35)',
              color: 'var(--text-1)', fontSize: 12.5, lineHeight: 1.5,
            }}>
              <strong style={{ color: 'var(--green)' }}>{categoriaSel.nombre}</strong> no
              requiere cuota. Pulsa <em>Aceptar</em> y el cliente quedará categorizado sin
              emitir recibo ni suscripción. No tienes que rellenar nada más abajo.
            </p>
          )}
        </Section>

        {/* 2. Cuotas */}
        <Section icon={Receipt} title="2. Cuotas (multi)" required
                 hint="Marca las cuotas que paga este cliente. Se creará una suscripción por cada una.">
          {cuotasCat.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text-3)' }}>No hay cuotas configuradas.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {cuotasCat.map(c => {
                const sel = cuotasSeleccionadas.includes(c.codigo)
                const combo = comboPrecios[c.codigo]
                return (
                  <label key={c.id || c.codigo}
                         style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                                  borderRadius: 10, cursor: 'pointer',
                                  background: sel ? 'var(--green-bg)' : 'var(--bg-2)',
                                  border: `1px solid ${sel ? 'var(--green)' : 'var(--line)'}` }}>
                    <input type="checkbox" checked={sel}
                           onChange={() => toggleCuota(c.codigo)} />
                    <span style={{ flex: 1, fontWeight: sel ? 600 : 400,
                                   color: sel ? 'var(--green)' : 'var(--text-1)' }}>
                      <strong>{c.codigo}</strong>
                      {c.descripcion && <span style={{ color: 'var(--text-2)', marginLeft: 8 }}>{c.descripcion}</span>}
                    </span>
                    {combo ? (
                      <span style={{ fontSize: 11, fontWeight: 600,
                                     color: 'var(--amber, #f59e0b)',
                                     padding: '2px 8px', borderRadius: 999,
                                     background: 'rgba(245,158,11,0.12)',
                                     border: '1px solid rgba(245,158,11,0.4)' }}>
                        {c.precio_mensual && (
                          <s style={{ color: 'var(--text-3)', marginRight: 6, fontWeight: 400 }}>
                            {c.precio_mensual}€
                          </s>
                        )}
                        {combo.precio}€ combo
                      </span>
                    ) : (
                      <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                        {c.precio_mensual != null && `${c.precio_mensual}€/mes`}
                      </span>
                    )}
                  </label>
                )
              })}
            </div>
          )}
          {Object.keys(comboPrecios).length > 0 && (
            <div style={{
              marginTop: 8, padding: '8px 12px', borderRadius: 10,
              background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)',
              fontSize: 12, color: 'var(--text-1)',
            }}>
              ✨ <strong>Descuento combinado activo</strong>: el precio de las cuotas marcadas
              en ámbar se aplicará en lugar del precio normal por tener combinación válida.
            </div>
          )}
        </Section>

        {/* Entrada puntual: modo de cobro + forma de pago (sustituye 3-9) */}
        {esEntradaPuntual && (
          <>
            <div style={{
              padding: '12px 14px', marginBottom: 14, borderRadius: 12,
              background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)',
              fontSize: 13, color: 'var(--text-1)', lineHeight: 1.5,
            }}>
              <strong>Cuota de entrada puntual.</strong> No se emite recibo ahora.
              Cada reserva confirmada de la actividad cuenta como una entrada
              ({Number(cuotaUnicaSel.precio_entrada || 0).toFixed(2)}€/entrada).
            </div>
            <Section icon={Wallet} title="Cómo se cobra" required>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {[
                  { v: 'por_entrada', t: 'Por cada entrada', d: 'Cobro en recepción al entrar (efectivo / TPV / tarjeta).' },
                  { v: 'por_mes', t: 'Por mes', d: 'Se acumulan y se factura agregado al cierre (SEPA / tarjeta).' },
                ].map(o => (
                  <button key={o.v} type="button" onClick={() => setEpModo(o.v)}
                          style={{
                            flex: 1, minWidth: 200, textAlign: 'left', cursor: 'pointer',
                            padding: '10px 12px', borderRadius: 10,
                            background: epModo === o.v ? 'var(--green-bg)' : 'var(--bg-1)',
                            border: `1px solid ${epModo === o.v ? 'var(--green)' : 'var(--line)'}`,
                          }}>
                    <div style={{ fontSize: 13, fontWeight: 600,
                                  color: epModo === o.v ? 'var(--green)' : 'var(--text-0)' }}>{o.t}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{o.d}</div>
                  </button>
                ))}
              </div>
            </Section>
            <Section icon={CreditCard} title="Forma de pago" required
                     hint={epModo === 'por_entrada'
                       ? 'Forma por defecto al cobrar cada entrada (se puede cambiar en recepción).'
                       : 'Forma con la que se cobrará el recibo agregado del mes.'}>
              <select value={epForma} onChange={e => setEpForma(e.target.value)} style={inputStyle}>
                {epFormas.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
              {epNecesitaIban && (
                <div style={{ marginTop: 8 }}>
                  <IBANInput value={iban} onChange={setIban} required />
                </div>
              )}
            </Section>
          </>
        )}

        {!esEntradaPuntual && (<>
        {/* 3-4. Fecha alta + periodicidad */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
          <Section icon={Calendar} title="3. Fecha de alta" required>
            <input type="date" value={fechaAlta}
                   onChange={e => setFechaAlta(e.target.value)} style={inputStyle} />
          </Section>
          <Section icon={Calendar} title="4. Periodicidad" required>
            <select value={periodicidad} onChange={e => setPeriodicidad(e.target.value)}
                    style={inputStyle}>
              {PERIODICIDAD_OPTS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Section>
        </div>

        {/* 5. Forma de pago recurrente */}
        <Section icon={CreditCard} title="5. Forma de pago recurrente"
                 hint="Cómo cobrarás las próximas cuotas (no la primera)." required>
          <select value={formaPagoRecurrente}
                  onChange={e => setFormaPagoRecurrente(e.target.value)}
                  style={inputStyle}>
            {opcionesFormaPago.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {necesitaIban && (
            <div style={{ marginTop: 8 }}>
              <IBANInput value={iban} onChange={setIban} required />
            </div>
          )}
          {!tieneTokenizacion && (
            <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
              💡 Configura una pasarela en <em>Configuración → Pasarelas</em> para habilitar
              tarjeta tokenizada y enlace de pago.
            </p>
          )}
        </Section>

        {/* 6-7. Texto recibo + importe */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          <Section icon={Receipt} title="6. Texto del recibo" required>
            <input type="text" value={textoRecibo}
                   onChange={e => setTextoRecibo(e.target.value)}
                   placeholder="Alta + cuota" style={inputStyle} />
          </Section>
          <Section icon={Wallet} title="7. Importe primera cuota (€)" required
                   hint="Pon 0 para alta de cortesía/beca/promo (pedirá justificación).">
            <input type="number" min={0} step="0.01" value={importePrimera}
                   onChange={e => setImportePrimera(e.target.value)}
                   placeholder="0.00" style={inputStyle} />
          </Section>
        </div>

        {/* Justificación obligatoria si el importe de la primera cuota es 0 */}
        {Number(importePrimera) === 0 && importePrimera !== '' && (
          <Section icon={Info} title="Justificación del importe 0€" required
                   hint="Queda registrada en el recibo (ej. beca, cortesía, promo de captación).">
            <input type="text" value={justificacionCero}
                   onChange={e => setJustificacionCero(e.target.value)}
                   placeholder="Motivo del alta sin coste…" style={inputStyle} />
          </Section>
        )}

        {/* 8-9. Fecha fin + forma pago alta */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
          <Section icon={Calendar} title="8. Fecha fin primer pago" required
                   hint="Hasta cuándo cubre el primer recibo.">
            <input type="date" value={fechaFinPrimero}
                   onChange={e => setFechaFinPrimero(e.target.value)} style={inputStyle} />
          </Section>
          <Section icon={Wallet} title="9. Forma de pago del alta" required
                   hint="Cómo cobras la primera cuota AHORA.">
            <select value={formaPagoAlta} onChange={e => setFormaPagoAlta(e.target.value)}
                    style={inputStyle}>
              {opcionesFormaPagoAlta.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Section>
        </div>
        </>)}
      </div>

      {/* Footer */}
      <div style={{ padding: '16px 28px', borderTop: '1px solid var(--line)', flexShrink: 0,
                    background: 'var(--bg-2)' }}>
        {error && (
          <div role="alert" style={{
            padding: '10px 14px', borderRadius: 10, marginBottom: 12, fontSize: 13,
            color: 'var(--red)', background: 'rgba(248,113,113,0.06)',
            border: '1px solid rgba(248,113,113,0.2)',
          }}>
            {error}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Btn variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Btn>
          <Btn variant="primary" onClick={handleSave} disabled={saving}>
            {saving
              ? <><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Procesando…</>
              : <><CheckCircle2 size={14} aria-hidden="true" /> Generar alta y recibo</>
            }
          </Btn>
        </div>
      </div>
    </Modal>
  )
}


function Section({ icon: Icon, title, hint, required, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <p style={{ display: 'flex', alignItems: 'center', gap: 8,
                  fontSize: 13, fontWeight: 600, color: 'var(--text-0)', marginBottom: 4 }}>
        {Icon && <Icon size={14} aria-hidden="true" style={{ color: 'var(--green)' }} />}
        {title}
        {required && <span style={{ color: 'var(--red)' }}>*</span>}
      </p>
      {hint && (
        <p style={{ fontSize: 11, color: 'var(--text-3)', margin: '0 0 6px' }}>{hint}</p>
      )}
      {children}
    </div>
  )
}


const inputStyle = {
  width: '100%', padding: '10px 12px', borderRadius: 10, fontSize: 14,
  background: 'var(--bg-1)', border: '1px solid var(--line)',
  color: 'var(--text-0)', outline: 'none', boxSizing: 'border-box',
}
