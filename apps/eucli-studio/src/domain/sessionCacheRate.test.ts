import { describe, expect, it } from 'vitest'
import { formatCacheRate, normalizeCacheRate } from './sessionCacheRate'

describe('sessionCacheRate', () => {
  it('keeps the session cache rate truth only when it is a valid ratio', () => {
    expect(normalizeCacheRate(0)).toBe(0)
    expect(normalizeCacheRate(0.8)).toBe(0.8)
    expect(normalizeCacheRate(1)).toBe(1)
    expect(normalizeCacheRate(-0.1)).toBeNull()
    expect(normalizeCacheRate(1.1)).toBeNull()
    expect(normalizeCacheRate(Number.NaN)).toBeNull()
    expect(normalizeCacheRate('0.8')).toBeNull()
    expect(normalizeCacheRate(null)).toBeNull()
  })

  it('shows a question mark instead of a substituted value when there is no truth', () => {
    expect(formatCacheRate(null)).toBe('?')
    expect(formatCacheRate(undefined)).toBe('?')
  })

  it('formats the truth directly as a percentage', () => {
    expect(formatCacheRate(0)).toBe('0%')
    expect(formatCacheRate(0.8)).toBe('80%')
    expect(formatCacheRate(0.857)).toBe('85.7%')
    expect(formatCacheRate(1)).toBe('100%')
  })
})
