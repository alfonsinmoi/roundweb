// ── IBAN / DNI validators (same as NooFitPro) ────────────────────────────────

/**
 * Normaliza un IBAN quitando espacios/guiones y poniendo todo en mayúsculas.
 * Útil antes de enviar al backend o validar.
 */
export function normalizarIBAN(input) {
  return String(input || '').replace(/[\s-]/g, '').toUpperCase()
}

/**
 * Formatea un IBAN insertando un espacio cada 4 caracteres para que el usuario
 * pueda comprobarlo visualmente (formato BBAN-like).
 * Ejemplo: "ES9121000418450200051332" → "ES91 2100 0418 4502 0005 1332".
 * No valida — sólo formatea. Para validar usa validarIBAN().
 */
export function formatearIBAN(input) {
  const norm = normalizarIBAN(input)
  return norm.match(/.{1,4}/g)?.join(' ') || ''
}

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

/**
 * Valida CIF español con dígito de control.
 * Espejo del backend round_config_api/app/validators.py:validate_cif.
 * Devuelve true/false.
 */
export function validarCIF(input) {
  const cif = String(input || '').trim().toUpperCase().replace(/[-. ]/g, '')
  if (!/^[ABCDEFGHJKLMNPQRSUVW]\d{7}[0-9A-J]$/.test(cif)) return false
  const digits = cif.slice(1, 8)
  const control = cif[8]
  const CTRL_LETRAS = 'JABCDEFGHI'
  // Pares (i=1,3,5)
  let par = 0
  for (let i = 1; i < digits.length; i += 2) par += Number(digits[i])
  // Impares (i=0,2,4,6) duplicados y con cifras sumadas si >9
  let impar = 0
  for (let i = 0; i < digits.length; i += 2) {
    const x = Number(digits[i]) * 2
    impar += x < 10 ? x : Math.floor(x / 10) + (x % 10)
  }
  const cd = (10 - ((par + impar) % 10)) % 10
  const first = cif[0]
  if ('KPQRSNW'.includes(first)) return control === CTRL_LETRAS[cd]
  if ('ABEH'.includes(first))     return control === String(cd)
  // Resto admiten ambos
  return control === String(cd) || control === CTRL_LETRAS[cd]
}

/**
 * Valida NIF/NIE/CIF — espejo del backend validators.py:validate_nif_cif_nie.
 * Devuelve { ok: boolean, tipo: 'NIF'|'NIE'|'CIF'|null, msg: string }
 */
export function validarNifCifNie(input) {
  const v = String(input || '').trim().toUpperCase().replace(/[-. ]/g, '')
  if (!v) return { ok: false, tipo: null, msg: 'vacío' }
  if (/^\d{8}[A-Z]$/.test(v)) {
    return validarDNI(v)
      ? { ok: true, tipo: 'NIF', msg: 'ok' }
      : { ok: false, tipo: 'NIF', msg: 'letra de control NIF incorrecta' }
  }
  if (/^[XYZ]\d{7}[A-Z]$/.test(v)) {
    return validarDNI(v)
      ? { ok: true, tipo: 'NIE', msg: 'ok' }
      : { ok: false, tipo: 'NIE', msg: 'letra de control NIE incorrecta' }
  }
  if (/^[ABCDEFGHJKLMNPQRSUVW]\d{7}[0-9A-J]$/.test(v)) {
    return validarCIF(v)
      ? { ok: true, tipo: 'CIF', msg: 'ok' }
      : { ok: false, tipo: 'CIF', msg: 'dígito de control CIF incorrecto' }
  }
  return { ok: false, tipo: null,
           msg: 'formato no reconocido (esperaba NIF / NIE / CIF español)' }
}

export function validarEmail(input) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(input).trim())
}

export function validarTelefono(input) {
  return /^\+?\d{6,15}$/.test(String(input).trim().replace(/[\s-]/g, ''))
}
