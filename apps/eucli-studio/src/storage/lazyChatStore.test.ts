import { describe, expect, it, vi } from 'vitest'
import { createLazyChatStore } from './lazyChatStore'

// 回归：会话进入内存状态必须只有一种形状。
//
// 现场故障：写路径之后的重载把业务端原始字节直接塞进状态，
// 原始用户消息没有 parentMid、时间还是 ISO 字符串：
//   - 消息树退化成「每条用户消息都是根」，界面只剩最后一问一答；
//   - 侧边栏 meta 的 updatedAt 被 Number('ISO') 算成 0 后一起回落 now()，
//     排序时间全部相同，列表看起来是乱的。
//
// upsertLoadedChat 是入状态的唯一入口：无论调用方给原始字节还是规范会话，
// 这里都归一化一次。

function createHarness() {
  const state: any = {
    data: {
      chatsByRole: {
        'role-1': { activeChatId: 'chat-1', chatMetas: [], chats: [] },
      },
      chatsByGroup: {},
    },
  }
  const store = createLazyChatStore({
    storage: { get: vi.fn(async () => null), set: vi.fn(async () => {}) },
    getState: () => state,
    loadSplitMeta: vi.fn(async () => ({})),
    loadChatIndex: vi.fn(async () => null),
  })
  return { state, store }
}

const rawSession = {
  id: 'chat-1',
  title: '会话',
  createdAt: '2026-10-31T17:32:31.8294373Z',
  updatedAt: '2026-10-31T17:39:14.4078946Z',
  messages: [
    { id: 'u1', type: 'user', content: '第一问', branchId: 'main', createdAt: '2026-10-31T17:32:31.8294373Z', updatedAt: '2026-10-31T17:32:31.8294373Z' },
    {
      id: 'a1',
      type: 'assistant',
      content: '第一答',
      parentMessageId: 'u1',
      branchId: 'main',
      createdAt: '2026-10-31T17:32:35.0548421Z',
      updatedAt: '2026-10-31T17:32:35.0548421Z',
    },
    { id: 'u2', type: 'user', content: '第二问', parentMessageId: 'a1', branchId: 'main', createdAt: '2026-10-31T17:38:02.5199299Z', updatedAt: '2026-10-31T17:38:02.5199299Z' },
  ],
}

describe('upsertLoadedChat 是会话入状态的唯一入口', () => {
  it('原始会话入状态后保留父子链并转成数值时间', () => {
    const harness = createHarness()
    const chat = harness.store.upsertLoadedChat('role', 'role-1', rawSession)

    expect(chat).not.toBeNull()
    const messages = chat?.messages || []
    expect(messages.find((m: any) => m.id === 'u1')?.parentMid).toBe('')
    expect(messages.find((m: any) => m.id === 'a1')?.parentMid).toBe('u1')
    // 关键：用户消息也必须有父链接，否则消息树每题都是根。
    expect(messages.find((m: any) => m.id === 'u2')?.parentMid).toBe('a1')
    expect(typeof chat?.updatedAt).toBe('number')
    expect(chat?.updatedAt).toBe(Date.parse('2026-10-31T17:39:14.4078946Z'))
  })

  it('原始会话的 meta 时间来自会话自身，而不是统一的 now()', () => {
    const harness = createHarness()
    harness.store.upsertLoadedChat('role', 'role-1', rawSession)

    const meta = harness.state.data.chatsByRole['role-1'].chatMetas.find((m: any) => m.id === 'chat-1')
    expect(meta?.updatedAt).toBe(Date.parse('2026-10-31T17:39:14.4078946Z'))
  })

  it('已归一化的会话再次入状态保持幂等', () => {
    const harness = createHarness()
    const first = harness.store.upsertLoadedChat('role', 'role-1', rawSession)
    const second = harness.store.upsertLoadedChat('role', 'role-1', first)

    expect(second?.messages.map((m: any) => [m.id, m.parentMid])).toEqual(first?.messages.map((m: any) => [m.id, m.parentMid]))
    expect(harness.state.data.chatsByRole['role-1'].chats).toHaveLength(1)
  })
})
