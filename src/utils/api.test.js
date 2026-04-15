import { describe, it, expect, beforeEach } from 'vitest'
import { invalidateCache } from './api'

describe('api module', () => {
  beforeEach(() => {
    invalidateCache()
    sessionStorage.clear()
  })

  it('invalidateCache does not throw when cache is empty', () => {
    expect(() => invalidateCache()).not.toThrow()
  })

  it('invalidateCache with key does not throw', () => {
    expect(() => invalidateCache('nonexistent')).not.toThrow()
  })
})
