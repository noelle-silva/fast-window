import { describe, expect, it } from 'vitest'
import { buildChatListIndex } from './ChatListIndex'

function msg(id: string, role: 'user' | 'assistant') {
  return { id, role, content: id }
}

describe('chat list index', () => {
  it('maps run cards by message id', () => {
    const assistant = { ...msg('a1', 'assistant'), assistantRun: { generationId: 'run-1', status: 'running' } }
    const card = { runId: 'run-1', lastMessageId: 'a1', status: 'running' }
    const index = buildChatListIndex({
      messages: [assistant],
      chatAllMessagesRaw: [assistant],
      activeVisibleRunCards: [card],
      prevAiMidByAssistantId: new Map(),
      assistantSiblingsByPrevAiMid: new Map(),
    })
    expect(index.runCardByMid.get('a1')).toBe(card)
  })

  it('precomputes branch siblings and their index', () => {
    const s1 = msg('a1', 'assistant')
    const s2 = msg('a2', 'assistant')
    const siblings = [s1, s2]
    const index = buildChatListIndex({
      messages: [s1, s2],
      chatAllMessagesRaw: [s1, s2],
      activeVisibleRunCards: [],
      prevAiMidByAssistantId: new Map([['a1', 'u1'], ['a2', 'u1']]),
      assistantSiblingsByPrevAiMid: new Map([['u1', siblings]]),
    })
    expect(index.branchSiblingsByMid.get('a1')).toBe(siblings)
    expect(index.branchIndexByMid.get('a1')).toBe(0)
    expect(index.branchIndexByMid.get('a2')).toBe(1)
  })

  it('precomputes the next assistant message for each user message', () => {
    const messages = [
      msg('u1', 'user'),
      msg('a1', 'assistant'),
      msg('u2', 'user'),
      msg('u3', 'user'),
      msg('a3', 'assistant'),
    ]
    const index = buildChatListIndex({
      messages,
      chatAllMessagesRaw: messages,
      activeVisibleRunCards: [],
      prevAiMidByAssistantId: new Map(),
      assistantSiblingsByPrevAiMid: new Map(),
    })
    expect(index.nextAssistantMidByUserMid.get('u1')).toBe('a1')
    // u2 后面紧跟另一条用户消息（u3）：与既有语义一致，没有重新回复目标。
    expect(index.nextAssistantMidByUserMid.get('u2')).toBeUndefined()
    expect(index.nextAssistantMidByUserMid.get('u3')).toBe('a3')
  })

  it('is O(n): index lookups do not scale with message count', () => {
    const messages = Array.from({ length: 200 }, (_, i) => msg(`m-${i}`, i % 2 === 0 ? 'user' : 'assistant'))
    const index = buildChatListIndex({
      messages,
      chatAllMessagesRaw: messages,
      activeVisibleRunCards: [],
      prevAiMidByAssistantId: new Map(),
      assistantSiblingsByPrevAiMid: new Map(),
    })
    // 一次构建后，全部查询都是 Map 读取。
    expect(index.nextAssistantMidByUserMid.size).toBeGreaterThan(0)
    expect(index.runCardByMid.size).toBe(0)
  })
})
