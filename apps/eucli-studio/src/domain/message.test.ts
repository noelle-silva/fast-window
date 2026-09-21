import { describe, expect, it } from 'vitest'
import { normalizeChatMessage } from './message'

describe('message timing normalization', () => {
  it('keeps duration fields on parts and tool results', () => {
    const message = normalizeChatMessage({
      id: 'm1',
      type: 'assistant',
      content: '回答',
      modelDurationMs: 4321,
      parts: [
        { id: 'p1', type: 'text', text: '回答', durationMs: 1234 },
        { id: 'p2', type: 'reasoning', text: '思考', durationMs: 2345 },
        { id: 'p3', type: 'tool', callId: 'c1', toolName: 'shell_command', state: 'completed', result: { id: 'r1', status: 'success', content: 'ok', durationMs: 777 } },
      ],
    })

    expect(message.modelDurationMs).toBe(4321)
    expect(message.parts[0].durationMs).toBe(1234)
    expect(message.parts[1].durationMs).toBe(2345)
    expect(message.parts[2].result.durationMs).toBe(777)
  })

  it('normalizes missing durations to zero', () => {
    const message = normalizeChatMessage({
      id: 'm2',
      type: 'assistant',
      content: '回答',
      parts: [{ id: 'p1', type: 'text', text: '回答' }],
    })

    expect(message.modelDurationMs).toBe(0)
    expect(message.parts[0].durationMs).toBe(0)
  })
})
