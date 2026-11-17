import { describe, expect, it } from 'vitest'
import { resolveActiveRunTailAnchorMs } from './chatMessageDisplay'

describe('resolveActiveRunTailAnchorMs', () => {
  it('restarts from the latest settled message after a tool round', () => {
    const messages = [
      { id: 'u1', role: 'user', updatedAt: 1000 },
      { id: 'a1', role: 'assistant', updatedAt: 2000 },
      { id: 't1', role: 'assistant', type: 'tool', updatedAt: 9000 },
    ]
    expect(resolveActiveRunTailAnchorMs(messages, { createdAt: 1000, updatedAt: 9000 })).toBe(9000)
  })

  it('falls back to the run start when the last message is older (regenerate)', () => {
    const messages = [{ id: 'a1', role: 'assistant', updatedAt: 2000 }]
    expect(resolveActiveRunTailAnchorMs(messages, { createdAt: 5000, updatedAt: 5200 })).toBe(5000)
  })

  it('uses the last message for the very first reply', () => {
    const messages = [{ id: 'u1', role: 'user', createdAt: 3000, updatedAt: 3000 }]
    expect(resolveActiveRunTailAnchorMs(messages, { createdAt: 3000 })).toBe(3000)
  })

  it('falls back to the card when there are no messages', () => {
    expect(resolveActiveRunTailAnchorMs([], { createdAt: 4000 })).toBe(4000)
  })

  it('returns zero when no time fact exists', () => {
    expect(resolveActiveRunTailAnchorMs([], null)).toBe(0)
    expect(resolveActiveRunTailAnchorMs([{ id: 'x' }], {})).toBe(0)
  })
})
