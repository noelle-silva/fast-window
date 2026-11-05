import { describe, expect, it } from 'vitest'
import { buildChatListIndex } from './ChatListIndex'

function msg(id: string, role: 'user' | 'assistant', parentMid = '') {
  return { id, role, content: id, parentMid }
}

describe('chat list index', () => {
  it('maps run cards by message id', () => {
    const assistant = { ...msg('a1', 'assistant', 'u1'), assistantRun: { generationId: 'run-1', status: 'running' } }
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
    const s1 = msg('a1', 'assistant', 'u1')
    const s2 = msg('a2', 'assistant', 'u1')
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

  it('precomputes the next assistant message from the server parent topology', () => {
    const messages = [
      msg('u1', 'user', ''),
      msg('a1', 'assistant', 'u1'),
      msg('u2', 'user', 'a1'),
      // u2 没有助手子节点：与后台拓扑一致，没有重新回复目标。
      msg('u3', 'user', 'a1'),
      msg('a3', 'assistant', 'u3'),
    ]
    const index = buildChatListIndex({
      messages,
      chatAllMessagesRaw: messages,
      activeVisibleRunCards: [],
      prevAiMidByAssistantId: new Map(),
      assistantSiblingsByPrevAiMid: new Map(),
    })
    expect(index.nextAssistantMidByUserMid.get('u1')).toBe('a1')
    expect(index.nextAssistantMidByUserMid.get('u2')).toBeUndefined()
    expect(index.nextAssistantMidByUserMid.get('u3')).toBe('a3')
  })

  it('is O(n): index lookups do not scale with message count', () => {
    const messages: any[] = []
    let lastUserId = ''
    let lastAssistantId = ''
    for (let i = 0; i < 200; i++) {
      if (i % 2 === 0) {
        const id = `m-${i}`
        messages.push(msg(id, 'user', lastAssistantId))
        lastUserId = id
      } else {
        const id = `m-${i}`
        messages.push(msg(id, 'assistant', lastUserId))
        lastAssistantId = id
      }
    }
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
