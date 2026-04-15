import { describe, it, expect } from 'vitest'
import { validarIBAN, validarDNI, validarEmail, validarTelefono } from './validators'

describe('validarIBAN', () => {
  it('accepts a valid Spanish IBAN', () => {
    expect(validarIBAN('ES91 2100 0418 4502 0005 1332')).toBe(true)
  })

  it('accepts valid IBAN without spaces', () => {
    expect(validarIBAN('ES9121000418450200051332')).toBe(true)
  })

  it('rejects an IBAN with wrong check digits', () => {
    expect(validarIBAN('ES00 2100 0418 4502 0005 1332')).toBe(false)
  })

  it('rejects too short input', () => {
    expect(validarIBAN('ES91')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(validarIBAN('')).toBe(false)
  })
})

describe('validarDNI', () => {
  it('accepts a valid DNI with correct letter', () => {
    expect(validarDNI('12345678Z')).toBe(true)
  })

  it('rejects a DNI with wrong letter', () => {
    expect(validarDNI('12345678A')).toBe(false)
  })

  it('accepts a valid NIE starting with X', () => {
    expect(validarDNI('X1234567L')).toBe(true)
  })

  it('accepts a valid CIF', () => {
    expect(validarDNI('B12345678')).toBe(true)
  })

  it('rejects too short input', () => {
    expect(validarDNI('1234')).toBe(false)
  })

  it('handles spaces and dots', () => {
    expect(validarDNI('12.345.678-Z')).toBe(true)
  })
})

describe('validarEmail', () => {
  it('accepts valid email', () => {
    expect(validarEmail('user@example.com')).toBe(true)
  })

  it('rejects email without @', () => {
    expect(validarEmail('userexample.com')).toBe(false)
  })

  it('rejects email without domain', () => {
    expect(validarEmail('user@')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(validarEmail('')).toBe(false)
  })
})

describe('validarTelefono', () => {
  it('accepts a valid phone number', () => {
    expect(validarTelefono('+34612345678')).toBe(true)
  })

  it('accepts phone without prefix', () => {
    expect(validarTelefono('612345678')).toBe(true)
  })

  it('rejects too short phone', () => {
    expect(validarTelefono('123')).toBe(false)
  })

  it('handles spaces and dashes', () => {
    expect(validarTelefono('+34 612-345-678')).toBe(true)
  })
})
