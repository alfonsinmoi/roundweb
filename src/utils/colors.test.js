import { describe, it, expect } from 'vitest'
import { colorFromName, tipoLabel, tipoColor } from './colors'

describe('colorFromName', () => {
  it('returns a color string for any name', () => {
    const color = colorFromName('Test Class')
    expect(color).toBeTruthy()
    expect(typeof color).toBe('string')
  })

  it('returns the same color for the same name', () => {
    expect(colorFromName('Yoga')).toBe(colorFromName('Yoga'))
  })

  it('handles empty string', () => {
    expect(colorFromName('')).toBeTruthy()
  })

  it('handles undefined', () => {
    expect(colorFromName()).toBeTruthy()
  })
})

describe('tipoLabel', () => {
  it('has labels for known types', () => {
    expect(tipoLabel[0]).toBe('Fuerza')
    expect(tipoLabel[1]).toBe('Cardio')
  })
})

describe('tipoColor', () => {
  it('has colors for known types', () => {
    expect(tipoColor[0]).toBe('blue')
    expect(tipoColor[1]).toBe('red')
  })
})
