import { useState, useEffect, useCallback } from 'react'
import { Filter, Download, ShieldCheck, ShieldAlert } from 'lucide-react'
import { Card, Btn, Badge, Table, EmptyState, Input } from '../../components/UI'
import { useToast } from '../../components/Toast'
import { eventosList, trabajadoresList } from '../../utils/horarioApi'


const tipoBadgeColor = {
  ENTRADA:            'green',
  SALIDA:             'amber',
  PAUSA_INI:          'cyan',
  PAUSA_FIN:          'cyan',
  CORRECCION_INSERT:  'purple',
  CORRECCION_ANULAR:  'red',
}


function _today() { return new Date().toISOString().slice(0, 10) }
function _addDays(d, n) {
  const x = new Date(d); x.setDate(x.getDate() + n)
  return x.toISOString().slice(0, 10)
}


export default function FichajesTab({ identity }) {
  const toast = useToast()
  const [trabajadores, setTrabajadores] = useState([])
  const [filters, setFilters] = useState({
    trabajador_id: '',
    trainer:       '',
    desde:         _addDays(_today(), -7),
    hasta:         _today(),
  })
  const [eventos, setEventos] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    trabajadoresList(identity, { incluir_bajas: 1 }).then(setTrabajadores).catch(() => {})
  }, [identity])

  const fetch_ = useCallback(async () => {
    setLoading(true)
    try {
      const params = {}
      if (filters.trabajador_id) params.trabajador_id = filters.trabajador_id
      if (filters.trainer)       params.trainer = filters.trainer
      if (filters.desde)         params.desde = filters.desde + 'T00:00:00Z'
      if (filters.hasta)         params.hasta = filters.hasta + 'T23:59:59Z'
      const evs = await eventosList(identity, params)
      setEventos(evs || [])
    } catch (e) {
      toast.error('Error: ' + (e.message || 'desconocido'))
    } finally { setLoading(false) }
  }, [identity, filters, toast])

  useEffect(() => { fetch_() }, [fetch_])

  function exportCsv() {
    if (!eventos.length) { toast.error('Sin datos para exportar'); return }
    const cols = ['id', 'trabajador_id', 'trabajador_nombre', 'id_trainer',
                  'tipo', 'ts_evento', 'pausa_motivo', 'origen', 'origen_ip',
                  'verificacion_ubicacion', 'qr_origen', 'autor_rol', 'hash']
    const csv = [
      cols.join(','),
      ...eventos.map(e => cols.map(c => {
        const v = e[c]
        if (v == null) return ''
        const s = String(v).replace(/"/g, '""')
        return /[,"\n]/.test(s) ? `"${s}"` : s
      }).join(',')),
    ].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `fichajes_${filters.desde}_${filters.hasta}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div>
      <Card style={{ padding: 14, marginBottom: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, alignItems: 'end' }}>
          <div>
            <label style={labelStyle}>Trabajador</label>
            <select value={filters.trabajador_id}
                    onChange={e => setFilters(f => ({ ...f, trabajador_id: e.target.value }))}
                    style={selectStyle}>
              <option value="">Todos</option>
              {trabajadores.map(t => (
                <option key={t.id} value={t.id}>{t.nombre_completo} ({t.nif || '?'})</option>
              ))}
            </select>
          </div>
          <Input label="Trainer (id)" value={filters.trainer}
                 onChange={e => setFilters(f => ({ ...f, trainer: e.target.value }))} />
          <Input label="Desde" type="date" value={filters.desde}
                 onChange={e => setFilters(f => ({ ...f, desde: e.target.value }))} />
          <Input label="Hasta" type="date" value={filters.hasta}
                 onChange={e => setFilters(f => ({ ...f, hasta: e.target.value }))} />
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <Btn variant="ghost" onClick={exportCsv}>
            <Download size={14} /> Exportar CSV
          </Btn>
          <Btn onClick={fetch_}>
            <Filter size={14} /> Aplicar
          </Btn>
        </div>
      </Card>

      {loading && <p style={{ color: 'var(--text-3)' }}>Cargando…</p>}
      {!loading && eventos.length === 0 && (
        <EmptyState icon={Filter} title="Sin fichajes en el rango"
                    description="Cambia el filtro o amplía el rango de fechas." />
      )}
      {!loading && eventos.length > 0 && (
        <Card style={{ padding: 0 }}>
          <Table
            ariaLabel="Fichajes"
            columns={[
              { key: 'ts',      label: 'Fecha / hora', render: (_, r) => fmtTs(r.ts_evento) },
              { key: 'trab',    label: 'Trabajador',   render: (_, r) => r.trabajador_nombre || r.trabajador_id },
              { key: 'trainer', label: 'Trainer',      render: (_, r) => r.id_trainer },
              { key: 'tipo',    label: 'Tipo',         render: (_, r) => <Badge color={tipoBadgeColor[r.tipo]}>{r.tipo}</Badge> },
              { key: 'mot',     label: 'Motivo pausa', render: (_, r) => r.pausa_motivo || '' },
              { key: 'origen',  label: 'Origen',       render: (_, r) => r.origen },
              { key: 'verif',   label: 'Verif.', render: (_, r) => r.verificacion_ubicacion === 'QR'
                ? <span style={{ color: 'var(--green)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <ShieldCheck size={13} /> QR ({r.qr_origen})
                  </span>
                : <span style={{ color: 'var(--text-3)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <ShieldAlert size={13} /> sin verificar
                  </span>
              },
              { key: 'autor',   label: 'Autor', render: (_, r) => r.autor_rol },
            ]}
            data={eventos}
          />
        </Card>
      )}
    </div>
  )
}


function fmtTs(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'medium' })
  } catch { return iso }
}


const labelStyle = {
  display: 'block', marginBottom: 4, fontSize: 12, color: 'var(--text-3)', fontWeight: 500,
}
const selectStyle = {
  width: '100%', padding: '8px 10px', borderRadius: 8,
  border: '1px solid var(--line)', background: 'var(--bg-1)',
  color: 'var(--text-1)', fontSize: 13,
}
