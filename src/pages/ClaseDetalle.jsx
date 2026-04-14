import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Users, Clock, CheckCircle2, XCircle, UserPlus,
  UserMinus, Loader2, Search
} from 'lucide-react'
import { Card, Badge, Btn, Avatar } from '../components/UI'
import { getSalas, getUsuariosBySala, updateUsuarioSala, userJoinSalas, userRemoveSala, getClientes } from '../utils/api'

function formatHora(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return isNaN(d) ? '—' : d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
}

function formatFecha(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return isNaN(d) ? '—' : d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

export default function ClaseDetalle() {
  const { id } = useParams()
  const navigate = useNavigate()
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

  const fetchData = async () => {
    try {
      const [salasData, usuariosData] = await Promise.all([
        getSalas(),
        getUsuariosBySala(Number(id)),
      ])
      const found = salasData.find(s => String(s.id) === String(id))
      if (!found) { setError('Sala no encontrada'); return }
      setSala(found)
      setUsuarios(usuariosData)
    } catch (err) {
      setError(err.message)
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
    } catch (err) {
      alert('Error: ' + err.message)
    } finally {
      setActionLoading('')
    }
  }

  const handleEliminarUsuario = async (usuario) => {
    if (!window.confirm(`¿Eliminar a ${usuario.nameClient} de esta clase?`)) return
    setActionLoading(`remove-${usuario.id}`)
    try {
      await userRemoveSala(usuario.id)
      setUsuarios(prev => prev.filter(u => u.id !== usuario.id))
    } catch (err) {
      alert('Error: ' + err.message)
    } finally {
      setActionLoading('')
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
      // Recargar usuarios
      const updated = await getUsuariosBySala(Number(id))
      setUsuarios(updated)
    } catch (err) {
      alert('Error al inscribir: ' + err.message)
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
      <Loader2 size={22} className="animate-spin" style={{ color: 'var(--green)' }} />
    </div>
  )

  if (error) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '120px 0' }}>
      <p style={{ color: 'var(--red)', fontSize: 14 }}>{error}</p>
      <Btn variant="secondary" onClick={() => navigate('/clases')}><ArrowLeft size={14} /> Volver</Btn>
    </div>
  )

  const asistieron = usuarios.filter(u => u.verify).length
  const total = usuarios.length

  return (
    <div style={{ maxWidth: 900 }}>

      {/* Back */}
      <button onClick={() => navigate('/clases')}
              style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer', color: 'var(--text-3)', background: 'none', border: 'none', marginBottom: 28, transition: 'color 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--text-1)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--text-3)'}>
        <ArrowLeft size={15} /> Clases
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
                <Clock size={14} /> {formatFecha(sala.dateStart)} · {formatHora(sala.dateStart)}
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
          <UserPlus size={15} /> Inscribir cliente
        </Btn>
      </div>

      {/* Usuarios inscritos */}
      {usuarios.length === 0 ? (
        <Card style={{ padding: 64, textAlign: 'center' }}>
          <Users size={28} style={{ color: 'var(--text-3)', margin: '0 auto 12px' }} />
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
                      ? <Badge color="green"><CheckCircle2 size={10} /> Asistió</Badge>
                      : <Badge color="gray"><XCircle size={10} /> Sin confirmar</Badge>
                    }
                    {u.isPause && <Badge color="yellow">Pausado</Badge>}
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  {/* Toggle asistencia */}
                  <button
                    onClick={() => handleToggleAsistencia(u)}
                    disabled={actionLoading === `toggle-${u.id}`}
                    title={u.verify ? 'Desmarcar asistencia' : 'Marcar asistencia'}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '10px 18px', borderRadius: 12, fontSize: 13, fontWeight: 500,
                      cursor: 'pointer', border: 'none', transition: 'all 0.1s',
                      background: u.verify ? 'rgba(248,113,113,0.08)' : 'rgba(45,212,168,0.08)',
                      color: u.verify ? 'var(--red)' : 'var(--green)',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = u.verify ? 'rgba(248,113,113,0.15)' : 'rgba(45,212,168,0.15)'}
                    onMouseLeave={e => e.currentTarget.style.background = u.verify ? 'rgba(248,113,113,0.08)' : 'rgba(45,212,168,0.08)'}>
                    {actionLoading === `toggle-${u.id}`
                      ? <Loader2 size={14} className="animate-spin" />
                      : u.verify ? <XCircle size={14} /> : <CheckCircle2 size={14} />
                    }
                    {u.verify ? 'Desmarcar' : 'Asistió'}
                  </button>

                  {/* Eliminar */}
                  <button
                    onClick={() => handleEliminarUsuario(u)}
                    disabled={actionLoading === `remove-${u.id}`}
                    title="Eliminar de la clase"
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      padding: 10, borderRadius: 12, cursor: 'pointer',
                      background: 'var(--bg-3)', border: '1px solid var(--line)',
                      color: 'var(--text-3)', transition: 'all 0.1s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.color = 'var(--red)'; e.currentTarget.style.borderColor = 'var(--red)' }}
                    onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-3)'; e.currentTarget.style.borderColor = 'var(--line)' }}>
                    {actionLoading === `remove-${u.id}` ? <Loader2 size={14} className="animate-spin" /> : <UserMinus size={14} />}
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Modal inscribir cliente */}
      {showInscribir && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
        }}
        onClick={e => { if (e.target === e.currentTarget) { setShowInscribir(false); setClientSearch('') } }}>
          <div style={{
            width: '100%', maxWidth: 520, maxHeight: '80vh',
            background: 'var(--bg-2)', border: '1px solid var(--line)',
            borderRadius: 24, overflow: 'hidden', display: 'flex', flexDirection: 'column',
          }}>

            {/* Modal header */}
            <div style={{ padding: '28px 28px 0' }}>
              <h3 style={{ fontFamily: 'Outfit', fontSize: 20, fontWeight: 600, color: 'var(--text-0)', marginBottom: 20 }}>
                Inscribir cliente
              </h3>
              <div style={{ position: 'relative', marginBottom: 20 }}>
                <Search size={15} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }} />
                <input
                  type="search" placeholder="Buscar cliente..." value={clientSearch}
                  onChange={e => setClientSearch(e.target.value)} autoFocus
                  style={{
                    width: '100%', padding: '14px 18px 14px 48px', borderRadius: 14, fontSize: 14,
                    background: 'var(--bg-1)', border: '1px solid var(--line)', color: 'var(--text-0)',
                    outline: 'none', transition: 'border-color 0.15s',
                  }}
                  onFocus={e => e.target.style.borderColor = 'var(--green)'}
                  onBlur={e => e.target.style.borderColor = 'var(--line)'}
                />
              </div>
            </div>

            {/* Client list */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 28px 28px' }}>
              {loadingClientes ? (
                <div style={{ padding: 40, textAlign: 'center' }}>
                  <Loader2 size={20} className="animate-spin" style={{ color: 'var(--green)' }} />
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
                            style={{
                              display: 'flex', alignItems: 'center', gap: 14,
                              padding: 14, borderRadius: 14, cursor: 'pointer',
                              background: 'transparent', border: '1px solid transparent',
                              textAlign: 'left', width: '100%', transition: 'all 0.1s',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-3)'; e.currentTarget.style.borderColor = 'var(--line)' }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent' }}>
                      <Avatar nombre={`${c.name} ${c.surname}`} size={38} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-0)' }}>{c.name} {c.surname}</p>
                        <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{c.email}</p>
                      </div>
                      {actionLoading === `join-${c.id}`
                        ? <Loader2 size={16} className="animate-spin" style={{ color: 'var(--green)' }} />
                        : <UserPlus size={16} style={{ color: 'var(--green)', flexShrink: 0 }} />
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
            <div style={{ padding: '16px 28px', borderTop: '1px solid var(--line)' }}>
              <Btn variant="secondary" size="md" onClick={() => { setShowInscribir(false); setClientSearch('') }}
                   style={{ width: '100%', justifyContent: 'center' }}>
                Cerrar
              </Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
