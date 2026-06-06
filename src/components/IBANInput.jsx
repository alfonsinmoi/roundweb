// Input de IBAN con auto-formato y validación visual.
//
//   - Muestra el IBAN formateado en bloques de 4 (ES91 2100 0418 4502 0005 1332)
//     para que el usuario pueda comprobar visualmente que coincide con su tarjeta
//     bancaria.
//   - Valida con MOD-97 (algoritmo oficial IBAN, lo mismo que NoofitPro usa).
//   - Muestra ✓ verde si el IBAN es válido, ✗ rojo si no, nada si está vacío.
//
// Devuelve al onChange el IBAN tal como lo teclea el usuario (formateado).
// Para enviar al backend usa `normalizarIBAN()` antes (sin espacios, mayúsculas).

import { useState, useEffect } from 'react'
import { Check, AlertCircle } from 'lucide-react'
import { formatearIBAN, validarIBAN, normalizarIBAN } from '../utils/validators'

const inputStyleBase = {
  width: '100%', padding: 10, borderRadius: 10, fontSize: 13,
  background: 'var(--bg-2)', border: '1px solid var(--line)', color: 'var(--text-0)',
  fontFamily: 'monospace', letterSpacing: '0.04em',
}

export default function IBANInput({ value, onChange, placeholder, style, required = false, disabled = false, id }) {
  // Mantenemos el texto formateado en estado local. El padre puede pasar
  // el IBAN normalizado o formateado — lo reformateamos para mostrarlo.
  const [display, setDisplay] = useState(() => formatearIBAN(value))

  // Resincronizar si el valor externo cambia (p.ej. reset del form).
  useEffect(() => {
    const newFormatted = formatearIBAN(value)
    // Solo actualizar si difiere de lo que ya mostramos (evita pisar el
    // cursor del usuario mientras teclea).
    if (newFormatted !== display && normalizarIBAN(value) !== normalizarIBAN(display)) {
      setDisplay(newFormatted)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const norm = normalizarIBAN(display)
  const empty = norm.length === 0
  const valido = !empty && validarIBAN(norm)
  const invalido = !empty && !valido

  const handleChange = (e) => {
    const newNorm = normalizarIBAN(e.target.value)
    setDisplay(formatearIBAN(newNorm))
    // Devolvemos el IBAN NORMALIZADO (sin espacios, mayúsculas) al padre.
    // Es el formato que el backend espera; el padre no tiene que limpiar nada.
    onChange && onChange(newNorm)
  }

  const borderColor = invalido ? 'var(--red)' : valido ? 'var(--green)' : 'var(--line)'

  return (
    <div style={{ position: 'relative' }}>
      <input
        id={id}
        type="text"
        value={display}
        onChange={handleChange}
        placeholder={placeholder || 'ES00 0000 0000 0000 0000 0000'}
        required={required}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        // 24 dígitos ES + 5 espacios = 29 chars máx en formato ES.
        // Permitimos hasta 42 para IBANs de otros países (max 34 chars + espacios).
        maxLength={42}
        style={{
          ...inputStyleBase, ...style,
          border: `1px solid ${borderColor}`,
          paddingRight: 36,   // hueco para el icono ✓ / ✗
        }}
      />
      {/* Icono de validez en la esquina derecha del input */}
      {!empty && (
        <span style={{
          position: 'absolute', right: 10, top: '50%',
          transform: 'translateY(-50%)',
          color: valido ? 'var(--green)' : 'var(--red)',
          pointerEvents: 'none',
          display: 'inline-flex',
        }}>
          {valido ? <Check size={16} aria-label="IBAN válido" />
                  : <AlertCircle size={16} aria-label="IBAN inválido" />}
        </span>
      )}
      {/* Mensaje textual debajo */}
      {invalido && (
        <p style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>
          IBAN no válido — revisa los dígitos (formato esperado: ES91 2100 0418 4502 0005 1332).
        </p>
      )}
      {valido && (
        <p style={{ fontSize: 11, color: 'var(--green)', marginTop: 4 }}>
          IBAN válido ✓ ({norm.length} caracteres, MOD-97 correcto)
        </p>
      )}
    </div>
  )
}
