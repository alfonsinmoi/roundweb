import { describe, it, expect } from 'vitest'
import { formatHora, formatFecha, formatDate, formatDuration } from './formatters'

describe('formatHora', () => {
  it('formats a valid date string to HH:MM', () => {
    const result = formatHora('2026-04-15T14:30:00')
    expect(result).toMatch(/14:30/)
  })

  it('returns — for empty input', () => {
    expect(formatHora('')).toBe('—')
    expect(formatHora(null)).toBe('—')
    expect(formatHora(undefined)).toBe('—')
  })

  it('returns — for invalid date', () => {
    expect(formatHora('not-a-date')).toBe('—')
  })
})

describe('formatFecha', () => {
  it('formats a date with weekday', () => {
    const result = formatFecha('2026-04-15T10:00:00')
    expect(result).toContain('2026')
  })

  it('returns — for empty', () => {
    expect(formatFecha(null)).toBe('—')
  })
})

describe('formatDate', () => {
  it('formats to DD/MM/YYYY', () => {
    const result = formatDate('2026-01-15')
    expect(result).toMatch(/15/)
    expect(result).toMatch(/2026/)
  })

  it('returns — for empty', () => {
    expect(formatDate(null)).toBe('—')
    expect(formatDate('')).toBe('—')
  })
})

describe('formatDuration', () => {
  it('converts seconds to minutes', () => {
    expect(formatDuration(3600)).toBe('60 min')
    expect(formatDuration(1800)).toBe('30 min')
  })

  it('returns empty for falsy', () => {
    expect(formatDuration(0)).toBe('')
    expect(formatDuration(null)).toBe('')
  })
})
