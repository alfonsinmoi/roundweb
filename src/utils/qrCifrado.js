// Cifrado del QR del perfil de trainer (NoofitPro / WiemsPro Easy).
//
// Spec (docs/QR_TRAINER_CLIENTE.md):
//   Texto plano:  "TRAINER;{idTrainer};{managerId};{nombreCompleto}"
//   Algoritmo:    AES-256-CBC (PKCS7 padding)
//   Password:     "WiemsPro2023/"
//   Salt:         bytes ASCII de "WiemsPro2023/"
//   KDF:          PBKDF2-HMAC-SHA1, 1000 iteraciones, 48 bytes salida
//   Key:          primeros 32 bytes del derivado
//   IV:           siguientes 16 bytes del derivado
//   Salida:       base64 del ciphertext
//
// Implementado con Web Crypto (subtle). Asíncrono.

const PASSWORD = 'WiemsPro2023/'
const ASCII = (str) => new TextEncoder('utf-8').encode(str)
// La salt y el password son los mismos bytes (literalmente "WiemsPro2023/").
const SALT_BYTES = ASCII(PASSWORD)

let _cachedKeyMaterial = null
async function _deriveKeyIv() {
  if (_cachedKeyMaterial) return _cachedKeyMaterial
  const baseKey = await crypto.subtle.importKey(
    'raw', ASCII(PASSWORD), 'PBKDF2', false, ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: SALT_BYTES, iterations: 1000, hash: 'SHA-1' },
    baseKey,
    48 * 8, // 48 bytes
  )
  const buf = new Uint8Array(bits)
  const keyBytes = buf.slice(0, 32)
  const iv = buf.slice(32, 48)
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'AES-CBC' }, false, ['encrypt'],
  )
  _cachedKeyMaterial = { cryptoKey, iv }
  return _cachedKeyMaterial
}

function _bufferToBase64(buf) {
  const bytes = new Uint8Array(buf)
  let str = ''
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i])
  return btoa(str)
}

/**
 * Cifra el QR del perfil del trainer.
 * @param {string|number} idTrainer  Id NoofitPro del trainer.
 * @param {string|number} managerId  Id NoofitPro del manager.
 * @param {string} nombreCompleto    Nombre del trainer/centro.
 * @returns {Promise<string>} contenido del QR (base64).
 */
export async function cifrarQrTrainer(idTrainer, managerId, nombreCompleto) {
  if (!idTrainer || !managerId) {
    throw new Error('idTrainer y managerId son obligatorios')
  }
  const texto = `TRAINER;${idTrainer};${managerId};${nombreCompleto || ''}`
  const { cryptoKey, iv } = await _deriveKeyIv()
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-CBC', iv },
    cryptoKey,
    ASCII(texto),
  )
  return _bufferToBase64(ciphertext)
}

/**
 * Genera el contenido del QR de "Vincular con QR" (sin cifrado).
 * Spec:
 *   - cedeDatos=true  (defecto)  → "TRAINERLINK;<idCliente>"
 *   - cedeDatos=false            → "cedeDatosFalse:<idCliente>:<dni>:<idTrainer>"
 */
export function payloadQrVincular({ idCliente, dni, idTrainer, cedeDatos = true }) {
  if (!idCliente) return null
  if (cedeDatos === false) {
    return `cedeDatosFalse:${idCliente}:${dni || ''}:${idTrainer || ''}`
  }
  return `TRAINERLINK;${idCliente}`
}
