import { describe, expect, it, vi } from 'vitest'
import { createLazyChatStore } from './lazyChatStore'
import { createSessionWriteGuard } from './sessionWriteGuard'

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

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('删除会话打断在途加载', () => {
  function createGuardedHarness() {
    const state: any = {
      data: {
        chatsByRole: {
          'role-1': { activeChatId: 'chat-1', chatMetas: [], chats: [] },
        },
        chatsByGroup: {},
      },
    }
    const sessionWrites = createSessionWriteGuard()
    const load = vi.fn()
    const store = createLazyChatStore({
      storage: { get: vi.fn(async () => null), set: vi.fn(async () => {}) },
      getState: () => state,
      loadSplitMeta: vi.fn(async () => ({ roleFolders: { 'role-1': 'role-folder' } })),
      loadChatIndex: vi.fn(async () => null),
      chatBodies: { load },
      sessionWrites,
    })
    return { state, store, sessionWrites, load }
  }

  it('删除之前发起的加载在删除之后落地：不写回内存，已删除会话不复活', async () => {
    const harness = createGuardedHarness()
    const pending = deferred<any>()
    harness.load.mockReturnValueOnce(pending.promise)

    const inFlight = harness.store.ensureChatLoaded('role', 'role-1', 'chat-1')
    harness.sessionWrites.invalidateSession('role', 'role-1', 'chat-1')
    pending.resolve(rawSession)

    expect(await inFlight).toBeNull()
    const box = harness.state.data.chatsByRole['role-1']
    expect(box.chats).toHaveLength(0)
    expect(box.chatMetas).toHaveLength(0)
  })

  it('删除之后的新加载捕获新代数，不复用旧代在途请求', async () => {
    const harness = createGuardedHarness()
    const first = deferred<any>()
    harness.load.mockReturnValueOnce(first.promise).mockResolvedValueOnce(rawSession)

    const inFlight = harness.store.ensureChatLoaded('role', 'role-1', 'chat-1')
    harness.sessionWrites.invalidateSession('role', 'role-1', 'chat-1')
    const second = harness.store.ensureChatLoaded('role', 'role-1', 'chat-1')
    first.resolve(rawSession)

    expect(await inFlight).toBeNull()
    const loaded = await second
    expect(loaded?.id).toBe('chat-1')
    expect(harness.load).toHaveBeenCalledTimes(2)
    expect(harness.state.data.chatsByRole['role-1'].chats.map((chat: any) => chat.id)).toEqual(['chat-1'])
  })
})

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

  it('权威会话版本进入内存，重新入状态不丢失、不回退', () => {
    const harness = createHarness()
    const first = harness.store.upsertLoadedChat('role', 'role-1', { ...rawSession, version: 4 })
    expect(first?.sessionVersion).toBe(4)

    // 已归一化会话再次入状态（没有 version 字段）：既有版本必须保留。
    const second = harness.store.upsertLoadedChat('role', 'role-1', { ...first })
    expect(second?.sessionVersion).toBe(4)

    // 迟到的旧版本不得把本地已知版本回退。
    const older = harness.store.upsertLoadedChat('role', 'role-1', { ...rawSession, version: 3 })
    expect(older?.sessionVersion).toBe(4)
  })

  it('迟到的旧版本正文整体不得覆盖本地视图', () => {
    const harness = createHarness()
    const newer = harness.store.upsertLoadedChat('role', 'role-1', { ...rawSession, title: '新标题', version: 4 })
    const stale = harness.store.upsertLoadedChat('role', 'role-1', {
      ...rawSession,
      title: '旧标题',
      version: 3,
      messages: [{ id: 'old', type: 'user', content: '旧正文', branchId: 'main', createdAt: rawSession.createdAt, updatedAt: rawSession.updatedAt }],
    })

    expect(stale).toBe(newer)
    expect(stale?.title).toBe('新标题')
    expect(stale?.messages.some((message: any) => message.id === 'old')).toBe(false)
    expect(stale?.sessionVersion).toBe(4)
  })
})
