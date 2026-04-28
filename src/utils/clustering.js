// ─────────────────────────────────────────────────────────────────────────────
// Algoritmo de clustering de clientes por patrones de uso
// ─────────────────────────────────────────────────────────────────────────────
// Entrada: salas (clases) de los últimos N días + usuarios por sala + clientes
// Proceso:
//   1. Por cada cliente, extraer vector de características:
//        - Distribución por día de semana (7)
//        - Distribución por franja horaria (6)
//        - Frecuencia semanal (1)
//        - Distribución por actividad sobre vocabulario top-12 (12)
//        - Género one-hot [masculino, femenino] (2)
//        - Franja de edad one-hot (5)
//      Total: ~33 dimensiones
//   2. K-means++ con distancia euclídea y RNG determinista
//   3. Análisis post-cluster: día/hora dominante, tipos top, nombres heurísticos
// Salida: { clusters: [{ id, name, members, ... }], outliers, params }
// ─────────────────────────────────────────────────────────────────────────────

import { getSalasByRange, getUsuariosBySala, getClientes } from './api'

export const HOUR_BUCKETS = [
  { label: '6-9',   from: 6,  to: 9  },
  { label: '9-12',  from: 9,  to: 12 },
  { label: '12-15', from: 12, to: 15 },
  { label: '15-18', from: 15, to: 18 },
  { label: '18-21', from: 18, to: 21 },
  { label: '21-24', from: 21, to: 24 },
]

export const DOW_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

export const AGE_BUCKETS = [
  { label: '<25',   from: 0,  to: 25  },
  { label: '25-35', from: 25, to: 35  },
  { label: '35-45', from: 35, to: 45  },
  { label: '45-55', from: 45, to: 55  },
  { label: '55+',   from: 55, to: 200 },
]

// ── RNG determinista (mulberry32) ────────────────────────────────────────────
function makeRng(seed = 42) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6D2B79F5) | 0
    let t = Math.imul(s ^ (s >>> 15), s | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ── Utilidades vectoriales ───────────────────────────────────────────────────
function sqDist(a, b) {
  let s = 0
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d }
  return s
}
function mean(vectors) {
  const n = vectors.length
  if (n === 0) return null
  const dim = vectors[0].length
  const out = new Array(dim).fill(0)
  for (const v of vectors) for (let i = 0; i < dim; i++) out[i] += v[i]
  for (let i = 0; i < dim; i++) out[i] /= n
  return out
}
function normalize(arr) {
  const sum = arr.reduce((a, b) => a + b, 0)
  if (sum === 0) return arr.map(() => 0)
  return arr.map(v => v / sum)
}

// ── Helpers demográficos ─────────────────────────────────────────────────────
function calcAge(birthdate) {
  if (!birthdate) return null
  const birth = new Date(birthdate)
  if (isNaN(birth)) return null
  const now = new Date()
  let age = now.getFullYear() - birth.getFullYear()
  const m = now.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--
  return age >= 0 && age < 120 ? age : null
}

function encodeGender(gender) {
  if (!gender) return [0, 0]
  const g = String(gender).toLowerCase().trim()
  if (g === 'm' || g === 'male' || g === 'masculino' || g === 'hombre') return [1, 0]
  if (g === 'f' || g === 'female' || g === 'femenino' || g === 'mujer') return [0, 1]
  return [0, 0]
}

function encodeAgeBuckets(birthdate) {
  const age = calcAge(birthdate)
  const vec = new Array(AGE_BUCKETS.length).fill(0)
  if (age == null) return vec
  const idx = AGE_BUCKETS.findIndex(b => age >= b.from && age < b.to)
  if (idx >= 0) vec[idx] = 1
  return vec
}

// ── Extracción de features por cliente ───────────────────────────────────────
/**
 * @param {Array<{date: Date, nameTraining: string}>} sesiones
 * @param {number} dias  ventana total analizada
 * @param {{ vocabulary?: string[], clientInfo?: object }} opts
 */
export function extractFeatures(sesiones, dias, { vocabulary = [], clientInfo = null } = {}) {
  const dow  = new Array(7).fill(0)
  const hour = new Array(HOUR_BUCKETS.length).fill(0)
  const types = new Map()

  sesiones.forEach(s => {
    const d = s.date
    const dIdx = d.getDay() === 0 ? 6 : d.getDay() - 1
    dow[dIdx]++
    const h = d.getHours()
    const hIdx = HOUR_BUCKETS.findIndex(b => h >= b.from && h < b.to)
    if (hIdx >= 0) hour[hIdx]++
    const t = s.nameTraining || 'Otro'
    types.set(t, (types.get(t) || 0) + 1)
  })

  const total = sesiones.length
  const weeks = Math.max(1, dias / 7)
  const sessionsPerWeek = total / weeks

  const dowN  = normalize(dow)
  const hourN = normalize(hour)
  const freqN = Math.min(1, Math.log2(1 + sessionsPerWeek) / Math.log2(8))

  // Distribución de actividad sobre vocabulario fijo
  const actRaw = vocabulary.map(name => types.get(name) || 0)
  const actN   = normalize(actRaw)

  // Género y edad
  const genderVec = encodeGender(clientInfo?.gender)
  const ageVec    = encodeAgeBuckets(clientInfo?.birthdate)

  const vector = [
    ...dowN.map(v => v * 1.0),
    ...hourN.map(v => v * 1.0),
    freqN * 0.6,
    ...actN.map(v => v * 0.8),
    ...genderVec.map(v => v * 0.5),
    ...ageVec.map(v => v * 0.5),
  ]

  return {
    dow, hour, sessionsPerWeek, types, total, vector,
    actDist: actN,
    genderVec,
    ageVec,
    genderRaw: clientInfo?.gender ?? null,
    ageRaw: calcAge(clientInfo?.birthdate),
  }
}

// ── K-means++ ────────────────────────────────────────────────────────────────
function kmeansInit(vectors, k, rng) {
  const n = vectors.length
  const centroids = [vectors[Math.floor(rng() * n)].slice()]
  for (let c = 1; c < k; c++) {
    const dists = vectors.map(v => {
      let min = Infinity
      for (const ct of centroids) {
        const d = sqDist(v, ct)
        if (d < min) min = d
      }
      return min
    })
    const total = dists.reduce((a, b) => a + b, 0)
    if (total === 0) { centroids.push(vectors[Math.floor(rng() * n)].slice()); continue }
    let r = rng() * total
    let pick = 0
    for (let i = 0; i < n; i++) {
      r -= dists[i]
      if (r <= 0) { pick = i; break }
    }
    centroids.push(vectors[pick].slice())
  }
  return centroids
}

export function kmeans(vectors, k, { maxIter = 100, seed = 42 } = {}) {
  if (vectors.length < k) return { labels: vectors.map((_, i) => i), centroids: vectors.map(v => v.slice()) }
  const rng = makeRng(seed)
  let centroids = kmeansInit(vectors, k, rng)
  const labels = new Array(vectors.length).fill(-1)

  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false
    for (let i = 0; i < vectors.length; i++) {
      let best = 0, bestDist = Infinity
      for (let c = 0; c < k; c++) {
        const d = sqDist(vectors[i], centroids[c])
        if (d < bestDist) { bestDist = d; best = c }
      }
      if (labels[i] !== best) { labels[i] = best; changed = true }
    }
    if (!changed) break
    const groups = Array.from({ length: k }, () => [])
    for (let i = 0; i < vectors.length; i++) groups[labels[i]].push(vectors[i])
    centroids = centroids.map((c, i) => groups[i].length > 0 ? mean(groups[i]) : c)
  }

  let inertia = 0
  for (let i = 0; i < vectors.length; i++) inertia += sqDist(vectors[i], centroids[labels[i]])

  return { labels, centroids, inertia }
}

// ── Nombres heurísticos para clusters ────────────────────────────────────────
function dominantDayGroup(dowCounts) {
  const weekdays = dowCounts.slice(0, 5).reduce((a, b) => a + b, 0)
  const weekend  = dowCounts.slice(5).reduce((a, b) => a + b, 0)
  if (weekdays + weekend === 0) return ''
  if (weekend / (weekdays + weekend) > 0.55) return 'fin de semana'
  if (weekdays / (weekdays + weekend) > 0.85) return 'entre semana'
  const top = [...dowCounts.map((v, i) => ({ v, i }))].sort((a, b) => b.v - a.v).slice(0, 3)
  const indices = top.map(t => t.i).sort((a, b) => a - b)
  return indices.map(i => DOW_LABELS[i]).join('-')
}

function dominantHourBucket(hourCounts) {
  const max = Math.max(...hourCounts)
  if (max === 0) return ''
  const idx = hourCounts.indexOf(max)
  const b = HOUR_BUCKETS[idx]
  if (b.from < 10) return 'mañanas'
  if (b.from < 13) return 'mediodía'
  if (b.from < 18) return 'tardes'
  return 'noches'
}

function frequencyLabel(sessionsPerWeek) {
  if (sessionsPerWeek >= 4) return 'Intensivos'
  if (sessionsPerWeek >= 2) return 'Regulares'
  return 'Ocasionales'
}

function buildClusterName(stats) {
  const freq     = frequencyLabel(stats.avgSessionsPerWeek)
  const dayGroup = dominantDayGroup(stats.dowTotal)
  const hourGroup = dominantHourBucket(stats.hourTotal)
  const parts = [freq]
  if (hourGroup) parts.push(`de ${hourGroup}`)
  if (dayGroup)  parts.push(`(${dayGroup})`)
  return parts.join(' ')
}

// ── Análisis agregado por cluster ────────────────────────────────────────────
function analyzeCluster(members, clusterIdx) {
  const dowTotal  = new Array(7).fill(0)
  const hourTotal = new Array(HOUR_BUCKETS.length).fill(0)
  const ageTotal  = new Array(AGE_BUCKETS.length).fill(0)
  const typeTotal = new Map()
  let sumSessionsPerWeek = 0
  let sumTotal = 0
  let maleCount = 0, femaleCount = 0, unknownGender = 0

  members.forEach(m => {
    m.features.dow.forEach((v, i)  => { dowTotal[i]  += v })
    m.features.hour.forEach((v, i) => { hourTotal[i] += v })
    m.features.ageVec.forEach((v, i) => { ageTotal[i] += v })
    m.features.types.forEach((v, k) => typeTotal.set(k, (typeTotal.get(k) || 0) + v))
    sumSessionsPerWeek += m.features.sessionsPerWeek
    sumTotal           += m.features.total

    const g = encodeGender(m.features.genderRaw)
    if (g[0] === 1)      maleCount++
    else if (g[1] === 1) femaleCount++
    else                 unknownGender++
  })

  const avgSessionsPerWeek = members.length > 0 ? sumSessionsPerWeek / members.length : 0
  const topTypes = [...typeTotal.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count, pct: Math.round((count / sumTotal) * 100) }))

  const stats = {
    size: members.length,
    avgSessionsPerWeek,
    totalSessions: sumTotal,
    dowTotal,
    hourTotal,
    ageTotal,
    topTypes,
    genderCount: { male: maleCount, female: femaleCount, unknown: unknownGender },
  }

  return {
    id: clusterIdx,
    name: buildClusterName(stats),
    ...stats,
    members: [...members].sort((a, b) => b.features.sessionsPerWeek - a.features.sessionsPerWeek),
  }
}

// ── Auto-k: silhouette sobre rango candidato ────────────────────────────────
function silhouette(vectors, labels, k) {
  if (k < 2) return 0
  const byCluster = Array.from({ length: k }, () => [])
  labels.forEach((l, i) => byCluster[l].push(i))
  let sum = 0, n = 0
  for (let i = 0; i < vectors.length; i++) {
    const own = byCluster[labels[i]]
    if (own.length <= 1) continue
    let a = 0
    for (const j of own) if (j !== i) a += Math.sqrt(sqDist(vectors[i], vectors[j]))
    a /= (own.length - 1)
    let b = Infinity
    for (let c = 0; c < k; c++) {
      if (c === labels[i]) continue
      const mbs = byCluster[c]
      if (mbs.length === 0) continue
      let dist = 0
      for (const j of mbs) dist += Math.sqrt(sqDist(vectors[i], vectors[j]))
      dist /= mbs.length
      if (dist < b) b = dist
    }
    sum += (b - a) / Math.max(a, b)
    n++
  }
  return n > 0 ? sum / n : 0
}

// ── Orquestador principal ────────────────────────────────────────────────────
/**
 * @param {Object} opts
 * @param {number} opts.dias                ventana de análisis en días (default 90)
 * @param {number|'auto'} opts.k            número de grupos (default 'auto', rango 3-6)
 * @param {number} opts.minSessions         mínimo de sesiones para entrar en el análisis
 * @param {boolean} opts.soloActivos        filtrar a clientes enabled !== false
 * @returns {Promise<{ clusters, outliers, clientesAnalizados, clientesExcluidos, params }>}
 */
export async function runUsageClustering({
  dias = 90,
  k = 'auto',
  minSessions = 4,
  soloActivos = true,
} = {}) {
  const hasta = new Date()
  const desde = new Date(); desde.setDate(desde.getDate() - dias)

  const [salas, clientes] = await Promise.all([
    getSalasByRange(desde, hasta),
    getClientes().catch(() => []),
  ])

  const clientMap = new Map()
  clientes.forEach(c => clientMap.set(String(c.id), c))

  const resultados = await Promise.all(
    salas.map(s => getUsuariosBySala(s.id).then(us => ({ s, us })).catch(() => ({ s, us: [] })))
  )

  // Agrupar sesiones por cliente
  const sesionesPorCliente = new Map()
  resultados.forEach(({ s, us }) => {
    const fecha = new Date(s.dateStart)
    if (isNaN(fecha)) return
    us.forEach(u => {
      if (!u.verify) return
      const id = String(u.idClient)
      if (!sesionesPorCliente.has(id)) sesionesPorCliente.set(id, [])
      sesionesPorCliente.get(id).push({
        date: fecha,
        nameTraining: s.nameTraining || s.name || 'Otro',
        duration: s.duration ?? null,
      })
    })
  })

  // Vocabulario de actividades: top 12 por sesiones totales
  const allTypes = new Map()
  sesionesPorCliente.forEach(sesiones => {
    sesiones.forEach(s => {
      const t = s.nameTraining || 'Otro'
      allTypes.set(t, (allTypes.get(t) || 0) + 1)
    })
  })
  const vocabulary = [...allTypes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([name]) => name)

  // Construir puntos con features
  const puntos   = []
  const outliers = []
  sesionesPorCliente.forEach((sesiones, idClient) => {
    const info = clientMap.get(idClient)
    if (!info) return
    if (soloActivos && info.enabled === false) return
    const nombre   = `${info.name || ''} ${info.surname || ''}`.trim() || `Cliente #${idClient}`
    const features = extractFeatures(sesiones, dias, { vocabulary, clientInfo: info })
    const punto    = { idClient, nombre, imgUrl: info.imgUrl || '', features }
    if (features.total < minSessions) {
      outliers.push(punto)
    } else {
      puntos.push(punto)
    }
  })

  if (puntos.length === 0) {
    return {
      clusters: [],
      outliers,
      clientesAnalizados: 0,
      clientesExcluidos: outliers.length,
      params: { dias, k, minSessions },
      vocabulary,
    }
  }

  const vectors = puntos.map(p => p.features.vector)

  let chosenK = typeof k === 'number' ? Math.min(k, puntos.length) : null
  let bestResult = null
  if (chosenK == null) {
    const range = [3, 4, 5, 6].filter(x => x <= puntos.length)
    let bestScore = -Infinity
    for (const kk of range) {
      const res   = kmeans(vectors, kk, { seed: 42 })
      const score = silhouette(vectors, res.labels, kk)
      if (score > bestScore) { bestScore = score; bestResult = res; chosenK = kk }
    }
  } else {
    bestResult = kmeans(vectors, chosenK, { seed: 42 })
  }

  const grupos = Array.from({ length: chosenK }, () => [])
  bestResult.labels.forEach((l, i) => grupos[l].push(puntos[i]))
  const clusters = grupos
    .map((members, i) => analyzeCluster(members, i))
    .filter(c => c.size > 0)
    .sort((a, b) => b.size - a.size)
    .map((c, i) => ({ ...c, id: i }))

  return {
    clusters,
    outliers,
    clientesAnalizados: puntos.length,
    clientesExcluidos: outliers.length,
    params: { dias, k: chosenK, minSessions },
    vocabulary,
  }
}
