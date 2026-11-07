import { describe, expect, it } from 'vitest'
import { latestContextTokens, normalizeChatMessage } from './message'
import { formatRequestModelText } from './modelRefUtils'

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

describe('message usage facts normalization', () => {
  it('derives the session context from the last message that carries truth', () => {
    expect(latestContextTokens([{ contextTokens: 1000 }, { contextTokens: 0 }, { contextTokens: 32000 }])).toBe(32000)
    expect(latestContextTokens([{ contextTokens: 1000 }])).toBe(1000)
    expect(latestContextTokens([])).toBe(0)
    expect(latestContextTokens(null as any)).toBe(0)
  })

  it('keeps cache rate and context tokens from upstream truth', () => {
    const message = normalizeChatMessage({
      id: 'm3',
      type: 'assistant',
      content: '回答',
      cacheRate: 0.857,
      contextTokens: 32000,
    })

    expect(message.cacheRate).toBe(0.857)
    expect(message.contextTokens).toBe(32000)
  })

  it('drops an out-of-range cache rate and normalizes a missing context to zero', () => {
    const message = normalizeChatMessage({ id: 'm4', type: 'assistant', content: '回答', cacheRate: 1.5, contextTokens: -5 })

    expect(message).not.toHaveProperty('cacheRate')
    expect(message.contextTokens).toBe(0)
  })

  it('keeps the resolved request model and drops one without a model id', () => {
    const kept = normalizeChatMessage({
      id: 'm5',
      type: 'assistant',
      content: '回答',
      requestModel: { providerId: 'p1', providerName: '主供应商', modelId: 'gpt-4.1' },
    })
    expect(kept.requestModel).toEqual({ providerId: 'p1', providerName: '主供应商', modelId: 'gpt-4.1' })

    const dropped = normalizeChatMessage({ id: 'm6', type: 'assistant', content: '回答', requestModel: { providerId: 'p1' } })
    expect(dropped).not.toHaveProperty('requestModel')
  })

  it('formats the request model as provider and model id', () => {
    expect(formatRequestModelText({ providerId: 'p1', providerName: '主供应商', modelId: 'gpt-4.1' })).toBe('主供应商 / gpt-4.1')
    expect(formatRequestModelText({ providerId: 'p1', modelId: 'gpt-4.1' })).toBe('p1 / gpt-4.1')
    expect(formatRequestModelText({})).toBe('')
    expect(formatRequestModelText(null)).toBe('')
  })
})

describe('tool produced image routing', () => {
  it('routes assistant attachments into toolImages', () => {
    const message = normalizeChatMessage({
      id: 'a1',
      type: 'assistant',
      content: '画好了',
      attachments: [{ id: 'att-9', kind: 'image', name: '生成图', path: 'sessions/roles/developer/s1/attachments/att-9/image.png' }],
    })
    expect(message.images).toEqual([])
    expect(message.toolImages).toEqual(['sessions/roles/developer/s1/attachments/att-9/image.png'])
  })

  it('keeps user attachments in images', () => {
    const message = normalizeChatMessage({
      id: 'u1',
      type: 'user',
      content: '看这个',
      attachments: [{ id: 'att-10', kind: 'image', name: '素材', path: 'sessions/roles/developer/s1/attachments/att-10/image.png' }],
    })
    expect(message.images).toEqual(['sessions/roles/developer/s1/attachments/att-10/image.png'])
    expect(message.toolImages).toEqual([])
  })
})
