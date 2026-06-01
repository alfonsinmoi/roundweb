// Helpers de comparación de texto para filtros y búsquedas.
//
// Diseño: TODOS los filtros de la app deben usar `normalizar()` para que
// "María" y "maria" matcheen igual, "José" y "jose" matcheen igual, etc.
// El usuario no debería tener que recordar acentos o capitalización.

// Regex de marcas diacríticas combinables (bloque Unicode U+0300 .. U+036F).
// Construido vía `new RegExp` con string template para evitar problemas de
// portabilidad cuando el fichero se guarda en distintas codificaciones.
const _DIACRITICOS_RE = new RegExp('[̀-ͯ]', 'g')

/**
 * Normaliza una cadena para comparaciones case+accent-insensitive.
 * Pasos:
 *   1. Pasar a string (acepta null/undefined → '').
 *   2. NFD descompone "á" → "a" + tilde combinada.
 *   3. Quitar marcas diacríticas (bloque U+0300 .. U+036F).
 *   4. Bajar a minúsculas.
 *   5. Trim.
 * Ejemplos:
 *   normalizar('María José') → 'maria jose'
 *   normalizar('  CAMARÓN  ') → 'camaron'
 *   normalizar('Ñoño') → 'ñoño' (la ñ NO es diacrítica — se mantiene;
 *                                pero "ñ" === "ñ" igualmente)
 */
export function normalizar(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(_DIACRITICOS_RE, '')
    .toLowerCase()
    .trim()
}

/**
 * ¿`haystack` contiene `needle` ignorando case+acentos?
 *   coincideTexto('María Jiménez', 'maria')   → true
 *   coincideTexto('María Jiménez', 'jimenez') → true
 *   coincideTexto('María', '')                → true (vacía siempre matchea)
 */
export function coincideTexto(haystack, needle) {
  const n = normalizar(needle)
  if (!n) return true
  return normalizar(haystack).includes(n)
}

/**
 * Igualdad case+accent-insensitive.
 *   igualTexto('Trabajador', 'trabajador') → true
 *   igualTexto('Cliente', 'CLIENTE')       → true
 */
export function igualTexto(a, b) {
  return normalizar(a) === normalizar(b)
}
