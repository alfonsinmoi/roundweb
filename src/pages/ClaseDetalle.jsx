import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Users, Clock, CheckCircle2, XCircle, UserPlus,
  UserMinus, Loader2, Search, CalendarCheck, X,
} from 'lucide-react'
import { Card, Badge, Btn, Avatar } from '../components/UI'
import Modal from '../components/Modal'
import ConfirmDialog from '../components/ConfirmDialog'
import { useToast } from '../components/Toast'
import { formatHora, formatFecha } from '../utils/formatters'
import {
  getSalas, getUsuariosBySala, updateUsuarioSala, userJoinSalas, userRemoveSala, getClientes,
  getTrainingsUser, getTrainingsFromSalas,
} from '../utils/api'

export default function ClaseDetalle() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const [sala, setSala] = useState(null)
  const [usuarios, setUsuarios] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionLoading, setActionLoading] = useState('')

  // Para inscribir clientes
  const [showInscribir, setShowInscribir] = useState(false)
  const [clientes, setClientes] = useState([])
  const [clientSearch, setClientSearch] = useState('')
  const [loadingClientes, setLoadingClientes] = useState(false)

  // Para confirmar eliminación
  const [confirmRemove, setConfirmRemove] = useState(null)

  // Foto ampliada inline (10x10 cm al lado del cliente)
  const [fotoAmpliada, setFotoAmpliada] = useState(null) // userId

  // Popup con últimas clases del cliente
  const [ultimasClases, setUltimasClases] = useState(null) // { idClient, nombre, apellidos, imgUrl, trainings, loading }

  const fetchData = async () => {
    try {
      const [salasData, usuariosData, clientesData] = await Promise.all([
        getSalas(),
        getUsuariosBySala(Number(id)),
        getClientes().catch(() => []),
      ])
      const found = salasData.find(s => String(s.id) === String(id))
      if (!found) { setError('No se pudo cargar la información solicitada'); return }
      // Enriquecer cada usuario con nombre/apellidos reales del cliente
      const clientMap = new Map(clientesData.map(c => [String(c.id), c]))
      const usuariosEnriquecidos = usuariosData.map(u => {
        const c = clientMap.get(String(u.idClient))
        const fallback = (u.nameClient || '').trim().split(/\s+/)
        return {
          ...u,
          nombre:    c?.name    ?? fallback[0] ?? '',
          apellidos: c?.surname ?? fallback.slice(1).join(' ') ?? '',
          imgUrl:    c?.imgUrl || u.pictureClient || '',
        }
      })
      setSala(found)
      setUsuarios(usuariosEnriquecidos)
      setClientes(clientesData)
    } catch {
      setError('No se pudo cargar la información. Inténtalo de nuevo más tarde.')
    } finally {
      setLoading(false)
    }
  }

  const handleVerUltimasClases = async (u) => {
    setUltimasClases({ idClient: u.idClient, nombre: u.nombre, apellidos: u.apellidos, imgUrl: u.imgUrl, trainings: null, loading: true })
    try {
      let data = await getTrainingsUser(u.idClient).catch(() => [])
      if (!data || data.length === 0) {
        data = await getTrainingsFromSalas(u.idClient, { dias: 180 }).catch(() => [])
      }
      const sorted = [...(data ?? [])]
        .map(t => ({ ...t, _fecha: new Date(t.dateStart ?? t.fecha ?? t.date ?? 0) }))
        .filter(t => !isNaN(t._fecha))
        .sort((a, b) => b._fecha - a._fecha)
        .slice(0, 12)
      setUltimasClases(prev => prev && prev.idClient === u.idClient
        ? { ...prev, trainings: sorted, loading: false }
        : prev)
    } catch {
      setUltimasClases(prev => prev && prev.idClient === u.idClient
        ? { ...prev, trainings: [], loading: false }
        : prev)
    }
  }

  useEffect(() => { fetchData() }, [id])

  const handleToggleAsistencia = async (usuario) => {
    setActionLoading(`toggle-${usuario.id}`)
    try {
      await updateUsuarioSala({ ...usuario, verify: !usuario.verify })
      setUsuarios(prev => prev.map(u => u.id === usuario.id ? { ...u, verify: !u.verify } : u))
      toast.success(usuario.verify ? 'Asistencia desmarcada' : 'Asistencia confirmada')
    } catch {
      toast.error('No se pudo actualizar la asistencia. Inténtalo de nuevo.')
    } finally {
      setActionLoading('')
    }
  }

  const handleEliminarUsuario = async (usuario) => {
    setActionLoading(`remove-${usuario.id}`)
    try {
      await userRemoveSala(usuario.id)
      setUsuarios(prev => prev.filter(u => u.id !== usuario.id))
      toast.success(`${usuario.nameClient} eliminado de la clase`)
    } catch {
      toast.error('No se pudo eliminar al usuario. Inténtalo de nuevo.')
    } finally {
      setActionLoading('')
      setConfirmRemove(null)
    }
  }

  const handleOpenInscribir = () => {
    setShowInscribir(true)
  }

  const handleInscribirCliente = async (cliente) => {
    setActionLoading(`join-${cliente.id}`)
    try {
      await userJoinSalas({
        idClient: cliente.id,
        nameClient: `${cliente.name} ${cliente.surname}`,
        pictureClient: cliente.imgUrl || '',
        verify: false,
        isPause: false,
        idSalaJoin: sala.id,
        idsSala: [sala.id],
        ems: false,
        tem: false,
        pulsometro: false,
        idEquipoJoin: 0,
        posicion: 0,
      })
      setShowInscribir(false)
      setClientSearch('')
      const updated = await getUsuariosBySala(Number(id))
      setUsuarios(updated)
      toast.success(`${cliente.name} ${cliente.surname} inscrito correctamente`)
    } catch {
      toast.error('No se pudo inscribir al cliente. Inténtalo de nuevo.')
    } finally {
      setActionLoading('')
    }
  }

  // Clientes ya inscritos (para filtrarlos)
  const idsInscritos = new Set(usuarios.map(u => u.idClient))

  const clientesFiltrados = clientes
    .filter(c => c.enabled !== false)
    .filter(c => !idsInscritos.has(c.id))
    .filter(c => {
      if (!clientSearch) return true
      const q = clientSearch.toLowerCase()
      return `${c.name} ${c.surname} ${c.email}`.toLowerCase().includes(q)
    })

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '120px 0' }}>
      <Loader2 size={22} className="animate-spin" style={{ color: 'var(--green)' }} aria-label="Cargando datos de la clase" />
    </div>
  )

  if (error) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '120px 0' }}>
      <p style={{ color: 'var(--red)', fontSize: 14 }}>{error}</p>
      <Btn variant="secondary" onClick={() => navigate('/clases')}><ArrowLeft size={14} aria-hidden="true" /> Volver</Btn>
    </div>
  )

  const asistieron = usuarios.filter(u => u.verify).length
  const total = usuarios.length

  return (
    <div style={{ maxWidth: 900 }}>

      {/* Back */}
      <button onClick={() => navigate('/clases')}
              className="nav-link"
              style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer', background: 'none', border: 'none', marginBottom: 28 }}>
        <ArrowLeft size={15} aria-hidden="true" /> Clases
      </button>

      {/* Header */}
      <Card style={{ padding: 36, marginBottom: 24 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20 }}>
          <div>
            <h1 style={{ fontFamily: 'Outfit', fontSize: 28, fontWeight: 700, color: 'var(--text-0)', marginBottom: 8 }}>
              {sala.name || sala.nameTraining}
            </h1>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, fontSize: 13, color: 'var(--text-3)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Clock size={14} aria-hidden="true" /> {formatFecha(sala.dateStart)} · {formatHora(sala.dateStart)}
              </span>
              {sala.nameTrainer && <span>Monitor: {sala.nameTrainer}</span>}
              {sala.durationTraining > 0 && <span>{Math.round(sala.durationTraining / 60)} min</span>}
              {sala.idEspejo != null && <span style={{ fontFamily: 'monospace' }}>Espejo: {sala.idEspejo}</span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <Badge color={total >= (sala.aforo || 999) ? 'red' : 'green'}>
              {total}/{sala.aforo || '∞'} inscritos
            </Badge>
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginTop: 28, paddingTop: 24, borderTop: '1px solid var(--line)' }}>
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontFamily: 'Outfit', fontSize: 32, fontWeight: 700, color: 'var(--text-0)' }}>{total}</p>
            <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>Inscritos</p>
          </div>
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontFamily: 'Outfit', fontSize: 32, fontWeight: 700, color: 'var(--green)' }}>{asistieron}</p>
            <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>Asistieron</p>
          </div>
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontFamily: 'Outfit', fontSize: 32, fontWeight: 700, color: total - asistieron > 0 ? 'var(--red)' : 'var(--text-3)' }}>{total - asistieron}</p>
            <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>No asistieron</p>
          </div>
        </div>
      </Card>

      {/* Toolbar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ fontFamily: 'Outfit', fontSize: 18, fontWeight: 600, color: 'var(--text-0)' }}>
          Lista de asistencia
        </h2>
        <Btn variant="primary" size="md" onClick={handleOpenInscribir}>
          <UserPlus size={15} aria-hidden="true" /> Inscribir cliente
        </Btn>
      </div>

      {/* Usuarios inscritos */}
      {usuarios.length === 0 ? (
        <Card style={{ padding: 64, textAlign: 'center' }}>
          <Users size={28} style={{ color: 'var(--text-3)', margin: '0 auto 12px' }} aria-hidden="true" />
          <p style={{ fontSize: 14, color: 'var(--text-3)' }}>No hay clientes inscritos en esta clase</p>
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {usuarios.map(u => {
            const ampliada = fotoAmpliada === u.id
            const nombreCompleto = `${u.nombre} ${u.apellidos}`.trim() || `Cliente #${u.idClient}`
            return (
            <Card key={u.id} style={{ padding: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>

                {/* Avatar clicable — al hacer click se amplía a 10x10 cm al lado del cliente */}
                <button onClick={() => setFotoAmpliada(ampliada ? null : u.id)}
                        aria-label={ampliada ? `Reducir foto de ${nombreCompleto}` : `Ampliar foto de ${nombreCompleto}`}
                        style={{
                          background: 'none', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0,
                          borderRadius: 14, transition: 'transform 0.2s ease',
                        }}>
                  <Avatar nombre={nombreCompleto} size={44} imgUrl={u.imgUrl} />
                </button>

                {/* Foto ampliada inline 10x10 cm */}
                {ampliada && (
                  <div style={{
                    width: '10cm', height: '10cm', flexShrink: 0,
                    borderRadius: 16, overflow: 'hidden',
                    border: '1px solid var(--line)', background: 'var(--bg-3)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    position: 'relative',
                  }}>
                    {u.imgUrl ? (
                      <img src={u.imgUrl} alt={nombreCompleto}
                           style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <span style={{ fontSize: 14, color: 'var(--text-3)' }}>Sin foto</span>
                    )}
                    <button onClick={() => setFotoAmpliada(null)}
                            aria-label="Cerrar foto ampliada"
                            style={{
                              position: 'absolute', top: 8, right: 8,
                              width: 32, height: 32, borderRadius: 10,
                              background: 'rgba(0,0,0,0.55)', color: '#fff',
                              border: 'none', cursor: 'pointer',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                      <X size={16} aria-hidden="true" />
                    </button>
                  </div>
                )}

                {/* Info — nombre clicable para ver últimas clases */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <button onClick={() => handleVerUltimasClases(u)}
                          aria-label={`Ver últimas clases de ${nombreCompleto}`}
                          className="nav-link"
                          style={{
                            display: 'flex', alignItems: 'baseline', gap: 6,
                            background: 'none', border: 'none', padding: 0,
                            fontFamily: 'Outfit', fontSize: 15, fontWeight: 600,
                            color: 'var(--text-0)', cursor: 'pointer', textAlign: 'left',
                            maxWidth: '100%',
                          }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {u.nombre || `Cliente #${u.idClient}`}
                    </span>
                    {u.apellidos && (
                      <span style={{ fontWeight: 500, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {u.apellidos}
                      </span>
                    )}
                  </button>
                  <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                    {u.verify
                      ? <Badge color="green"><CheckCircle2 size={10} aria-hidden="true" /> Asistió</Badge>
                      : <Badge color="gray"><XCircle size={10} aria-hidden="true" /> Sin confirmar</Badge>
                    }
                    {u.isPause && <Badge color="yellow">Pausado</Badge>}
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  {/* Toggle asistencia */}
                  <Btn
                    variant={u.verify ? 'danger' : 'primary'}
                    size="sm"
                    onClick={() => handleToggleAsistencia(u)}
                    disabled={actionLoading === `toggle-${u.id}`}
                  >
                    {actionLoading === `toggle-${u.id}`
                      ? <Loader2 size={14} className="animate-spin" aria-label="Procesando" />
                      : u.verify ? <XCircle size={14} aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />
                    }
                    {u.verify ? 'Desmarcar' : 'Asistió'}
                  </Btn>

                  {/* Eliminar */}
                  <Btn
                    variant="secondary"
                    size="sm"
                    onClick={() => setConfirmRemove(u)}
                    disabled={actionLoading === `remove-${u.id}`}
                  >
                    {actionLoading === `remove-${u.id}`
                      ? <Loader2 size={14} className="animate-spin" aria-label="Procesando" />
                      : <UserMinus size={14} aria-hidden="true" />
                    }
                  </Btn>
                </div>
              </div>
            </Card>
          )})}
        </div>
      )}

      {/* ConfirmDialog for removing a user */}
      <ConfirmDialog
        open={confirmRemove !== null}
        title="Eliminar de la clase"
        message={confirmRemove ? `¿Eliminar a ${confirmRemove.nameClient} de esta clase?` : ''}
        confirmText="Eliminar"
        variant="danger"
        onConfirm={() => confirmRemove && handleEliminarUsuario(confirmRemove)}
        onCancel={() => setConfirmRemove(null)}
      />

      {/* Modal inscribir cliente */}
      <Modal
        open={showInscribir}
        onClose={() => { setShowInscribir(false); setClientSearch('') }}
        title="Inscribir cliente"
        maxWidth={520}
      >
        {/* Search */}
        <div style={{ padding: '20px 32px 0' }}>
          <div style={{ position: 'relative', marginBottom: 20 }}>
            <Search size={15} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50)', color: 'var(--text-3)' }} aria-hidden="true" />
            <input
              type="search"
              placeholder="Buscar cliente..."
              value={clientSearch}
              onChange={e => setClientSearch(e.target.value)}
              autoFocus
              className="form-input"
              style={{
                width: '100%', padding: '14px 18px 14px 48px', borderRadius: 14, fontSize: 14,
                background: 'var(--bg-1)', border: '1px solid var(--line)', color: 'var(--text-0)',
              }}
            />
          </div>
        </div>

        {/* Client list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 32px 28px', maxHeight: '50vh' }}>
          {loadingClientes ? (
            <div style={{ padding: 40, textAlign: 'center' }}>
              <Loader2 size={20} className="animate-spin" style={{ color: 'var(--green)' }} aria-label="Cargando clientes" />
            </div>
          ) : clientesFiltrados.length === 0 ? (
            <p style={{ padding: 40, textAlign: 'center', fontSize: 13, color: 'var(--text-3)' }}>
              {clientSearch ? 'No se encontraron clientes' : 'Todos los clientes ya están inscritos'}
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {clientesFiltrados.slice(0, 30).map(c => (
                <button key={c.id}
                        onClick={() => handleInscribirCliente(c)}
                        disabled={actionLoading === `join-${c.id}`}
                        className="interactive-row"
                        style={{
                          display: 'flex', alignItems: 'center', gap: 14,
                          padding: 14, borderRadius: 14, cursor: 'pointer',
                          background: 'transparent', border: '1px solid transparent',
                          textAlign: 'left', width: '100%',
                        }}>
                  <Avatar nombre={`${c.name} ${c.surname}`} size={38} imgUrl={c.imgUrl} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-0)' }}>{c.name} {c.surname}</p>
                    <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{c.email}</p>
                  </div>
                  {actionLoading === `join-${c.id}`
                    ? <Loader2 size={16} className="animate-spin" style={{ color: 'var(--green)' }} aria-label="Inscribiendo" />
                    : <UserPlus size={16} style={{ color: 'var(--green)', flexShrink: 0 }} aria-hidden="true" />
                  }
                </button>
              ))}
              {clientesFiltrados.length > 30 && (
                <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-3)', padding: 10 }}>
                  +{clientesFiltrados.length - 30} más — usa el buscador
                </p>
              )}
            </div>
          )}
        </div>

        {/* Modal footer */}
        <div style={{ padding: '16px 32px', borderTop: '1px solid var(--line)' }}>
          <Btn variant="secondary" size="md" onClick={() => { setShowInscribir(false); setClientSearch('') }}
               style={{ width: '100%', justifyContent: 'center' }}>
            Cerrar
          </Btn>
        </div>
      </Modal>

      {/* Popup: Últimas clases del cliente */}
      <Modal open={!!ultimasClases}
             onClose={() => setUltimasClases(null)}
             title={ultimasClases ? `${ultimasClases.nombre} ${ultimasClases.apellidos}`.trim() : ''}
             subtitle="Últimas clases realizadas"
             maxWidth={560}>
        <div style={{ padding: '20px 28px 28px' }}>
          {ultimasClases?.loading && (
            <div style={{ padding: '40px 0', textAlign: 'center' }}>
              <Loader2 size={20} className="animate-spin" style={{ color: 'var(--green)' }} aria-label="Cargando clases" />
            </div>
          )}
          {ultimasClases && !ultimasClases.loading && ultimasClases.trainings?.length === 0 && (
            <div style={{ padding: '40px 0', textAlign: 'center' }}>
              <CalendarCheck size={26} style={{ color: 'var(--text-3)', margin: '0 auto 10px' }} aria-hidden="true" />
              <p style={{ fontSize: 13, color: 'var(--text-3)' }}>Sin clases registradas</p>
            </div>
          )}
          {ultimasClases && !ultimasClases.loading && ultimasClases.trainings?.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {ultimasClases.trainings.map((t, i) => {
                const f = t._fecha
                const nombre = t.nameTraining || t.name || t.nombre || '—'
                const dur = t.duration ?? t.durationTraining ?? null
                return (
                  <div key={t.id ?? i} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
                    padding: '10px 14px', borderRadius: 10,
                    background: 'var(--bg-3)', border: '1px solid var(--line)',
                  }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {nombre}
                      </p>
                      <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                        {f.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        {dur != null && ` · ${dur} min`}
                      </p>
                    </div>
                    {t.verify === true && <Badge color="green"><CheckCircle2 size={10} aria-hidden="true" /> Asistió</Badge>}
                    {t.verify === false && <Badge color="gray"><XCircle size={10} aria-hidden="true" /></Badge>}
                  </div>
                )
              })}
            </div>
          )}
        </div>
        <div style={{ padding: '12px 28px 20px', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', gap: 10 }}>
          {ultimasClases && (
            <Btn variant="secondary" size="sm" onClick={() => { navigate(`/clientes/${ultimasClases.idClient}`); setUltimasClases(null) }}>
              Ver perfil completo
            </Btn>
          )}
          <Btn variant="primary" size="sm" onClick={() => setUltimasClases(null)} style={{ marginLeft: 'auto' }}>
            Cerrar
          </Btn>
        </div>
      </Modal>
    </div>
  )
}
