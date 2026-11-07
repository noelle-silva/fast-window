import { describe, expect, it } from 'vitest'
import { buildAssistantMetaLine, formatContextTokens } from './messageMetaLine'

describe('messageMetaLine', () => {
  it('orders cache rate, context, time and duration', () => {
    expect(
      buildAssistantMetaLine({ cacheRate: 0.857, contextTokens: 32000, timeText: '15:30', durationText: '3.2s' }),
    ).toBe('85.7% · 32k · 15:30 · 3.2s')
  })

  it('shows a question mark when upstream gives no cache rate', () => {
    expect(buildAssistantMetaLine({ cacheRate: null, contextTokens: 1500, timeText: '15:30', durationText: '1s' })).toBe(
      '? · 1.5k · 15:30 · 1s',
    )
  })

  it('shows a question mark when upstream gives no context tokens', () => {
    expect(buildAssistantMetaLine({ cacheRate: 0.8, contextTokens: 0, timeText: '15:30', durationText: '1s' })).toBe(
      '80% · ? · 15:30 · 1s',
    )
  })

  it('drops the time and duration slots when they have no fact', () => {
    expect(buildAssistantMetaLine({ cacheRate: 1, contextTokens: 1000, timeText: '', durationText: '' })).toBe('100% · 1k')
  })

  it('formats context tokens directly', () => {
    expect(formatContextTokens(999)).toBe('1k')
    expect(formatContextTokens(1000)).toBe('1k')
    expect(formatContextTokens(12345)).toBe('12k')
    expect(formatContextTokens(0)).toBe('?')
    expect(formatContextTokens(undefined)).toBe('?')
    expect(formatContextTokens('x')).toBe('?')
  })
})
