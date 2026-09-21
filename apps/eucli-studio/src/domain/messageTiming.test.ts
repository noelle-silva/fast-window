import { describe, expect, it } from 'vitest'
import { normalizeDurationMs, resolveReplyDurationMs } from './messageTiming'

describe('normalizeDurationMs', () => {
  it('keeps positive millisecond values as integers', () => {
    expect(normalizeDurationMs(1234.9)).toBe(1234)
    expect(normalizeDurationMs('250')).toBe(250)
  })

  it('treats missing, invalid and non-positive values as absent', () => {
    expect(normalizeDurationMs(0)).toBe(0)
    expect(normalizeDurationMs(-5)).toBe(0)
    expect(normalizeDurationMs(undefined)).toBe(0)
    expect(normalizeDurationMs(null)).toBe(0)
    expect(normalizeDurationMs('abc')).toBe(0)
    expect(normalizeDurationMs(Infinity)).toBe(0)
  })
})

describe('resolveReplyDurationMs', () => {
  it('prefers the text part writing span', () => {
    const message = {
      parts: [
        { type: 'reasoning', durationMs: 900 },
        { type: 'text', durationMs: 400 },
      ],
      modelDurationMs: 1500,
    }
    expect(resolveReplyDurationMs(message)).toBe(400)
  })

  it('falls back to the model call duration when the writing span is absent', () => {
    const message = {
      parts: [
        { type: 'reasoning', durationMs: 0 },
        { type: 'text', durationMs: 0 },
      ],
      modelDurationMs: 1500,
    }
    expect(resolveReplyDurationMs(message)).toBe(1500)
  })

  it('returns zero when nothing is recorded', () => {
    expect(resolveReplyDurationMs({ parts: [], modelDurationMs: 0 })).toBe(0)
    expect(resolveReplyDurationMs(undefined)).toBe(0)
  })
})
