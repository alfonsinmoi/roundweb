import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Users, Clock, CheckCircle2, XCircle, UserPlus,
  UserMinus, Loader2, Search
} from 'lucide-react'
import { Card, Badge, Btn, Avatar } from '../components/UI'
import Modal from '../components/Modal'
import ConfirmDialog from '../components/ConfirmDialog'
import { useToast } from '../components/Toast'
import { formatHora, formatFecha } from '../utils/formatters'
import { getSalas, getUsuariosBySala, updateUsuarioSala, userJoinSalas, userRemoveSala, getClientes } from '../utils/api'

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

  const fetchData = async () => {
    try {
      const [salasData, usuariosData] = await Promise.all([
        getSalas(),
        getUsuariosBySala(Number(id)),
      ])
      const found = salasData.find(s => String(s.id) === String(id))
      if (!found) { setError('No se pudo cargar la información solicitada'); return }
      setSala(found)
      setUsuarios(usuariosData)
    } catch {
      setError('No se pudo cargar la información. Inténtalo de nuevo más tarde.')
    } finally {
      setLoading(false)
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

  const handleOpenInscribir = async () => {
    setShowInscribir(true)
    if (clientes.length === 0) {
      setLoadingClientes(true)
      try {
        const data = await getClientes()
        setClientes(data.filter(c => c.enabled !== false))
      } catch {
        // silently handled — empty list shown
      } finally {
        setLoadingClientes(false)
      }
    }
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
          {usuarios.map(u => (
            <Card key={u.id} style={{ padding: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>

                {/* Avatar + info */}
                <Avatar nombre={u.nameClient || '?'} size={44} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontFamily: 'Outfit', fontSize: 15, fontWeight: 600, color: 'var(--text-0)' }}>
                    {u.nameClient || `Cliente #${u.idClient}`}
                  </p>
                  <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
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
          ))}
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
                  <Avatar nombre={`${c.name} ${c.surname}`} size={38} />
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
    </div>
  )
}
