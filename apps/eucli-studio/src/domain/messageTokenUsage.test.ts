import { describe, expect, it } from 'vitest'
import { formatTokenUsage, formatTokenUsageShort, normalizeTokenUsage, tokenUsageTotal } from './messageTokenUsage'

describe('messageTokenUsage', () => {
  it('normalizes upstream usage truth and ignores non-numeric fields', () => {
    expect(normalizeTokenUsage({ inputTokens: 30, outputTokens: 12, totalTokens: 42 })).toEqual({ inputTokens: 30, outputTokens: 12, totalTokens: 42 })
    expect(normalizeTokenUsage({ totalTokens: 42, extra: 'ignored' })).toEqual({ totalTokens: 42 })
    expect(normalizeTokenUsage({ inputTokens: 'x' })).toBeNull()
    expect(normalizeTokenUsage({})).toBeNull()
    expect(normalizeTokenUsage(null)).toBeNull()
  })

  it('prefers the upstream total and otherwise uses input plus output', () => {
    expect(tokenUsageTotal({ totalTokens: 42, inputTokens: 1, outputTokens: 2 })).toBe(42)
    expect(tokenUsageTotal({ inputTokens: 30, outputTokens: 12 })).toBe(42)
    expect(tokenUsageTotal(null)).toBeNull()
    expect(tokenUsageTotal({})).toBeNull()
  })

  it('shows a question mark instead of a substituted number when there is no truth', () => {
    expect(formatTokenUsage(null)).toBe('?')
    expect(formatTokenUsageShort(undefined)).toBe('?')
  })

  it('formats the truth directly', () => {
    expect(formatTokenUsage({ totalTokens: 42 })).toBe('42 tokens')
    expect(formatTokenUsage({ inputTokens: 6000, outputTokens: 3500 })).toBe('9.5k tokens')
  })
})
