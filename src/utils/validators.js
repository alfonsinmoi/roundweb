// ── IBAN / DNI validators (same as NooFitPro) ────────────────────────────────

export function validarIBAN(input) {
  const iban = input.replace(/[\s-]/g, '').toUpperCase()
  if (iban.length < 15 || iban.length > 34 || !/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) return false
  const reord = iban.slice(4) + iban.slice(0, 4)
  let num = ''
  for (const c of reord) num += /[A-Z]/.test(c) ? (c.charCodeAt(0) - 55).toString() : c
  let rem = 0
  for (const c of num) rem = (rem * 10 + Number(c)) % 97
  return rem === 1
}

export function validarDNI(input) {
  const dni = input.trim().toUpperCase().replace(/[-. ]/g, '')
  if (dni.length < 8) return false
  const letras = 'TRWAGMYFPDXBNJZSQVHLCKE'
  if (/^\d{8}[A-Z]$/.test(dni)) return dni[8] === letras[parseInt(dni.slice(0, 8)) % 23]
  if (/^[XYZ]\d{7}[A-Z]$/.test(dni)) {
    const n = ({ X: '0', Y: '1', Z: '2' }[dni[0]] ?? '') + dni.slice(1, 8)
    return dni[8] === letras[parseInt(n) % 23]
  }
  if (/^[ABCDEFGHJKLMNPQRSUVW]\d{8}$/.test(dni)) return true
  return false
}

export function validarEmail(input) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(input).trim())
}

export function validarTelefono(input) {
  return /^\+?\d{6,15}$/.test(String(input).trim().replace(/[\s-]/g, ''))
}
