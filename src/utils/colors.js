/**
 * Shared color-from-name hashing — single source of truth.
 */

const HUES = ['var(--green)', '#4361EE', '#22C55E', '#F59E0B', '#A855F7', '#06B6D4', '#EC4899']

export function colorFromName(name = '') {
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffffffff
  return HUES[Math.abs(hash) % HUES.length]
}

/** Exercise type labels/colors */
export const tipoLabel = { 0: 'Fuerza', 1: 'Cardio', 2: 'Funcional', 3: 'Resistencia', 4: 'HIIT', 5: 'Flexibilidad' }
export const tipoColor = { 0: 'blue', 1: 'red', 2: 'yellow', 3: 'green', 4: 'red', 5: 'green' }
