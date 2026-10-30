import { describe, expect, it, vi } from 'vitest'
import { applyEditSnapshotParts, loadSessionEditSnapshot } from './sessionEditSnapshot'

const scope = { kind: 'role' as const, targetId: 'role-1' }

function snapshot(messages: any[]) {
  return {
    schemaVersion: 1,
    id: 'chat-1',
    asyncToolTasks: [],
    messages,
  }
}

describe('loadSessionEditSnapshot', () => {
  it('requests the edit profile so parts stay complete', async () => {
    const sessionGet = vi.fn(async () => snapshot([
      { id: 'm1', branchId: 'main', parentMessageId: '', createdAt: 1, content: 'hi', parts: [] },
    ]))
    const result = await loadSessionEditSnapshot(
      { sessionSwitch: { hasFeature: () => true, sessionGet } },
      scope,
      'chat-1',
    )
    expect(sessionGet).toHaveBeenCalledWith(scope, 'chat-1', { profile: 'edit' })
    expect(result?.messages).toHaveLength(1)
  })

  it('returns null when the backend has no session.get', async () => {
    const sessionGet = vi.fn()
    const result = await loadSessionEditSnapshot(
      { sessionSwitch: { hasFeature: () => false, sessionGet } },
      scope,
      'chat-1',
    )
    expect(result).toBeNull()
    expect(sessionGet).not.toHaveBeenCalled()
  })

  it('returns null without a session switch client', async () => {
    expect(await loadSessionEditSnapshot({}, scope, 'chat-1')).toBeNull()
  })

  // switchId 必须随写路径快照一起走，否则同一次切换里前端观测键与
  // studio→box 的 X-Eucli-Trace 不是同一个值，三跳 trace 断链。
  it('forwards switchId with the edit snapshot request', async () => {
    const sessionGet = vi.fn(async () => snapshot([]))
    await loadSessionEditSnapshot(
      { sessionSwitch: { hasFeature: () => true, sessionGet } },
      scope,
      'chat-1',
      { switchId: 'sw-42' },
    )
    expect(sessionGet).toHaveBeenCalledWith(scope, 'chat-1', { profile: 'edit', switchId: 'sw-42' })
  })

  it('omits switchId when there is no active switch', async () => {
    const sessionGet = vi.fn(async () => snapshot([]))
    await loadSessionEditSnapshot(
      { sessionSwitch: { hasFeature: () => true, sessionGet } },
      scope,
      'chat-1',
      { switchId: '   ' },
    )
    expect(sessionGet).toHaveBeenCalledWith(scope, 'chat-1', { profile: 'edit' })
  })
})

describe('applyEditSnapshotParts', () => {
  it('copies parts and content from the snapshot', () => {
    const chat = { messages: [{ id: 'm1', content: 'view text', parts: [] }] }
    applyEditSnapshotParts(chat, snapshot([
      { id: 'm1', content: 'full text', parts: [{ id: 'p1', type: 'tool', raw: '{}' }] },
    ]))
    expect(chat.messages[0].content).toBe('full text')
    expect(chat.messages[0].parts).toHaveLength(1)
  })

  it('keeps local-only fields on the message', () => {
    const chat = { messages: [{ id: 'm1', content: 'view', parts: [], streaming: true, display: { local: true } }] }
    applyEditSnapshotParts(chat, snapshot([{ id: 'm1', content: 'full', parts: [] }]))
    expect((chat.messages[0] as any).streaming).toBe(true)
    expect((chat.messages[0] as any).display).toEqual({ local: true })
  })

  it('leaves messages missing from the snapshot untouched', () => {
    const chat = { messages: [{ id: 'm1', content: 'a', parts: [] }, { id: 'm2', content: 'b', parts: [] }] }
    applyEditSnapshotParts(chat, snapshot([{ id: 'm1', content: 'x', parts: [] }]))
    expect(chat.messages[1].content).toBe('b')
  })
})
