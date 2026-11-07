import { describe, expect, it } from 'vitest'
import { formatTokenEstimate, formatTokenEstimateShort } from './messageTokenUsage'

describe('messageTokenUsage', () => {
  it('formats tokens with a readable unit', () => {
    expect(formatTokenEstimate(0)).toBe('0 tokens')
    expect(formatTokenEstimate(42)).toBe('42 tokens')
    expect(formatTokenEstimate(9500)).toBe('9.5k tokens')
    expect(formatTokenEstimate(12000)).toBe('12k tokens')
  })

  it('formats the short form in k only', () => {
    expect(formatTokenEstimateShort(0)).toBe('0k')
    expect(formatTokenEstimateShort(1500)).toBe('1.5k')
    expect(formatTokenEstimateShort(12345)).toBe('12k')
  })
})
