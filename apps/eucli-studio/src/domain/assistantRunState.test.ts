import { describe, expect, it } from 'vitest'
import { ASSISTANT_RUNNING_CONTENT, hasAssistantAnyOutput } from './assistantRunState'

describe('hasAssistantAnyOutput', () => {
  it('treats the first reasoning increment as real output', () => {
    expect(
      hasAssistantAnyOutput({
        role: 'assistant',
        content: ASSISTANT_RUNNING_CONTENT,
        parts: [{ type: 'reasoning', text: '想' }],
      }),
    ).toBe(true)
  })

  it('treats text and tool parts as output', () => {
    expect(hasAssistantAnyOutput({ role: 'assistant', content: '', parts: [{ type: 'text', text: '你' }] })).toBe(true)
    expect(hasAssistantAnyOutput({ role: 'assistant', content: '', parts: [{ type: 'tool', callId: 'c1' }] })).toBe(true)
  })

  it('does not count the running placeholder or blank parts', () => {
    expect(hasAssistantAnyOutput({ role: 'assistant', content: ASSISTANT_RUNNING_CONTENT, parts: [] })).toBe(false)
    expect(hasAssistantAnyOutput({ role: 'assistant', content: '', parts: [{ type: 'reasoning', text: '  ' }] })).toBe(false)
    expect(hasAssistantAnyOutput({ role: 'user', content: 'hi' })).toBe(false)
    expect(hasAssistantAnyOutput(null)).toBe(false)
  })
})
