import { describe, expect, it } from 'vitest'
import { buildAssistantMetaLine, buildUserMetaLine, formatContextTokens } from './messageMetaLine'

describe('messageMetaLine', () => {
  it('shows the context the model had read when the user message was sent', () => {
    expect(buildUserMetaLine({ contextTokens: 32000, timeText: '15:30' })).toBe('32k · 15:30')
    expect(buildUserMetaLine({ contextTokens: 0, timeText: '15:30' })).toBe('? · 15:30')
  })

  it('puts the request model left of the cache rate', () => {
    expect(
      buildAssistantMetaLine({
        modelText: '主供应商 / gpt-4.1',
        cacheRate: 0.857,
        contextTokens: 32000,
        timeText: '15:30',
        durationText: '3.2s',
      }),
    ).toBe('主供应商 / gpt-4.1 · 85.7% · 32k · 15:30 · 3.2s')
  })

  it('skips the model slot when the request model is unknown', () => {
    expect(
      buildAssistantMetaLine({ modelText: '', cacheRate: 0.8, contextTokens: 1500, timeText: '15:30', durationText: '1s' }),
    ).toBe('80% · 1.5k · 15:30 · 1s')
  })

  it('shows a question mark when upstream gives no cache rate', () => {
    expect(
      buildAssistantMetaLine({ modelText: '', cacheRate: null, contextTokens: 1500, timeText: '15:30', durationText: '1s' }),
    ).toBe('? · 1.5k · 15:30 · 1s')
  })

  it('shows a question mark when upstream gives no context tokens', () => {
    expect(
      buildAssistantMetaLine({ modelText: '', cacheRate: 0.8, contextTokens: 0, timeText: '15:30', durationText: '1s' }),
    ).toBe('80% · ? · 15:30 · 1s')
  })

  it('drops the time and duration slots when they have no fact', () => {
    expect(
      buildAssistantMetaLine({ modelText: '', cacheRate: 1, contextTokens: 1000, timeText: '', durationText: '' }),
    ).toBe('100% · 1k')
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
