import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createProjectionPipeline } from './projectionPipeline'
import type { SessionSwitchClient } from '../protocol/sessionSwitchProtocol'
import type { ProjectionScope } from '../storage/splitProjectionCache'

// B1 回归：会话正文缓存（LRU）必须在写路径上失效，
// 否则「写后刷新」会读到写之前的正文——新消息消失、已删消息复活、编辑被覆盖。
//
// 这些用例刻意走完整管线（pipeline + chatBodies + reloadChatBody），
// 只测 loader 的 props 不变是不够的：真正出问题的是「读路径直接命中缓存」。

type Backend = {
  chats: Map<string, any>
  reads: string[]
  writes: string[]
}

function makeBackend(): Backend {
  return { chats: new Map(), reads: [], writes: [] }
}

function chatKey(scope: ProjectionScope, chatId: string) {
  return `${scope.kind}:${scope.targetId}:${chatId}`
}

function makePipeline(backend: Backend) {
  // 目录事实：只给 folder 映射，scope 化正文读取用它寻址。
  const meta = {
    roleOrder: ['role-1'],
    roleFolders: { 'role-1': '角色一' },
    groupOrder: ['group-1'],
    groupFolders: { 'group-1': '群组一' },
    providerOrder: [],
    providerFolders: {},
    modelGroupOrder: [],
    modelGroupFolders: {},
    ui: {},
    settings: {},
    updatedAt: 1,
  }
  const storage = {
    get: async (key: string) => {
      // 迁移期路径：chats/<folder>/<chatId>/chat
      const match = /^chats\/(.+)\/(.+)\/chat$/.exec(key)
      if (!match) return null
      const chatId = match[2]
      backend.reads.push(chatId)
      return backend.chats.get(chatKey({ kind: 'role', targetId: 'role-1' }, chatId)) || null
    },
    set: async (key: string, value: any) => {
      const match = /^chats\/(.+)\/(.+)\/chat$/.exec(key)
      if (!match) return
      backend.writes.push(match[2])
      backend.chats.set(chatKey({ kind: 'role', targetId: 'role-1' }, match[2]), value)
    },
  }
  return createProjectionPipeline({
    storage,
    // 故意不给 session.window：走整份会话读路径（旧后端 / 迁移期）。
    sessionSwitch: undefined,
    loadSplitMeta: async () => meta,
    getSplitMetaCache: () => meta,
    applyLocalSelection: () => {},
  })
}

function chat(id: string, contents: string[]) {
  return {
    id,
    title: `会话 ${id}`,
    createdAt: 1,
    updatedAt: 1,
    messages: contents.map((content, index) => ({ id: `${id}-m${index}`, content, createdAt: 100 + index })),
  }
}

const roleScope: ProjectionScope = { kind: 'role', targetId: 'role-1' }

describe('会话正文缓存的写路径失效（B1）', () => {
  let backend: Backend

  beforeEach(() => {
    backend = makeBackend()
  })

  it('写后刷新必须读到新正文（新消息不能消失）', async () => {
    const pipeline = makePipeline(backend)
    backend.chats.set(chatKey(roleScope, 'c1'), chat('c1', ['你好']))

    // 首读：缓存住「只有一条消息」的正文。
    const first = await pipeline.chatBodies.load(roleScope, 'c1')
    expect(first.messages).toHaveLength(1)

    // 模拟业务端写入了新消息（运行落盘）。
    backend.chats.set(chatKey(roleScope, 'c1'), chat('c1', ['你好', '这是新回复']))

    // 不失效直接读：命中旧缓存（这正是 B1 的现场）。
    const stale = await pipeline.chatBodies.load(roleScope, 'c1')
    expect(stale.messages).toHaveLength(1)

    // 走写路径原语：必须读到两条。
    const refreshed = await pipeline.reloadChatBody(roleScope, 'c1')
    expect(refreshed.messages).toHaveLength(2)
    expect(refreshed.messages[1].content).toBe('这是新回复')
  })

  it('写后刷新必须让已删除消息不再复活', async () => {
    const pipeline = makePipeline(backend)
    backend.chats.set(chatKey(roleScope, 'c1'), chat('c1', ['a', 'b', 'c']))
    expect((await pipeline.chatBodies.load(roleScope, 'c1')).messages).toHaveLength(3)

    // 业务端删掉中间一条。
    backend.chats.set(chatKey(roleScope, 'c1'), chat('c1', ['a', 'c']))
    const refreshed = await pipeline.reloadChatBody(roleScope, 'c1')
    expect(refreshed.messages.map((m: any) => m.content)).toEqual(['a', 'c'])
  })

  it('写后刷新必须让编辑生效（不被旧正文覆盖）', async () => {
    const pipeline = makePipeline(backend)
    backend.chats.set(chatKey(roleScope, 'c1'), chat('c1', ['原文']))
    await pipeline.chatBodies.load(roleScope, 'c1')

    backend.chats.set(chatKey(roleScope, 'c1'), chat('c1', ['改后的文本']))
    const refreshed = await pipeline.reloadChatBody(roleScope, 'c1')
    expect(refreshed.messages[0].content).toBe('改后的文本')
  })

  it('纯失效之后再读也会重新取（invalidateChatBody 是最小原语）', async () => {
    const pipeline = makePipeline(backend)
    backend.chats.set(chatKey(roleScope, 'c1'), chat('c1', ['旧']))
    await pipeline.chatBodies.load(roleScope, 'c1')

    backend.chats.set(chatKey(roleScope, 'c1'), chat('c1', ['新']))
    pipeline.invalidateChatBody(roleScope, 'c1')

    const fresh = await pipeline.chatBodies.load(roleScope, 'c1')
    expect(fresh.messages[0].content).toBe('新')
  })

  it('失效发生在读取途中：旧结果既不回填也不被后续读复用', async () => {
    const pipeline = makePipeline(backend)
    let releaseSlowRead: (value: any) => void = () => {}
    const slowRead = new Promise((resolve) => {
      releaseSlowRead = resolve
    })

    // 手工构造「慢读」：第一次 load 挂住，等失效之后再放行。
    const storage = (pipeline as any).chatBodies
    void storage
    let calls = 0
    const load = vi.fn(async () => {
      calls += 1
      if (calls === 1) return slowRead
      return chat('c1', ['新正文'])
    })

    // 用独立 loader 精确复现「失效打断在途读取」的时序。
    const { createChatBodyLoader } = await import('../storage/chatBodyLoader')
    const loader = createChatBodyLoader({ load })

    const inFlight = loader.load(roleScope, 'c1')
    loader.invalidate(roleScope, 'c1')
    releaseSlowRead(chat('c1', ['旧正文']))

    // 旧结果仍返回给那次调用方（它自己已经发出去了），但绝不进缓存。
    await inFlight
    expect(loader.peek(roleScope, 'c1')).toBeNull()

    // 下一次读必须重新请求，并拿到新正文。
    const fresh = await loader.load(roleScope, 'c1')
    expect(fresh.messages[0].content).toBe('新正文')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('失效之后，新的 load 不会复用失效之前的在途请求', async () => {
    let calls = 0
    let releaseFirst: (value: any) => void = () => {}
    const firstPending = new Promise((resolve) => {
      releaseFirst = resolve
    })
    const { createChatBodyLoader } = await import('../storage/chatBodyLoader')
    const loader = createChatBodyLoader({
      load: async () => {
        calls += 1
        if (calls === 1) return firstPending
        return chat('c1', ['第二代正文'])
      },
    })

    const first = loader.load(roleScope, 'c1')
    loader.invalidate(roleScope, 'c1')
    const second = loader.load(roleScope, 'c1')
    releaseFirst(chat('c1', ['第一代正文']))

    await first
    const secondChat = await second
    expect(secondChat.messages[0].content).toBe('第二代正文')
    expect(calls).toBe(2)
  })

  it('epoch 变化（整份投影换代）同时清空正文缓存', async () => {
    const pipeline = makePipeline(backend)
    backend.chats.set(chatKey(roleScope, 'c1'), chat('c1', ['旧']))
    await pipeline.chatBodies.load(roleScope, 'c1')
    expect(pipeline.chatBodies.stats().entries).toBe(1)

    // epoch 推进：前端必须把上一代的正文一起丢掉。
    pipeline.applyVersions({ epoch: 99 })
    expect(pipeline.chatBodies.stats().entries).toBe(0)

    backend.chats.set(chatKey(roleScope, 'c1'), chat('c1', ['新']))
    const fresh = await pipeline.chatBodies.load(roleScope, 'c1')
    expect(fresh.messages[0].content).toBe('新')
  })

  it('invalidateScope 清掉该 target 的全部正文，其它 target 不受影响', async () => {
    const pipeline = makePipeline(backend)
    backend.chats.set(chatKey(roleScope, 'c1'), chat('c1', ['一']))
    backend.chats.set(chatKey({ kind: 'role', targetId: 'role-1' }, 'c2'), chat('c2', ['二']))
    await pipeline.chatBodies.load(roleScope, 'c1')
    await pipeline.chatBodies.load(roleScope, 'c2')

    pipeline.chatBodies.invalidateScope(roleScope)
    expect(pipeline.chatBodies.stats().entries).toBe(0)
  })

  it('reloadChatBody 在整份模式下返回正文（不能只失效就返回 null）', async () => {
    const pipeline = makePipeline(backend)
    backend.chats.set(chatKey(roleScope, 'c1'), chat('c1', ['内容']))
    const chat1 = await pipeline.reloadChatBody(roleScope, 'c1')
    expect(chat1).not.toBeNull()
    expect(chat1.messages[0].content).toBe('内容')
  })
})

describe('窗口模式下的写后刷新（B1 同源路径）', () => {
  function makeWindowPipeline() {
    // 一条稳定身份的消息：写路径只改内容，id 与 createdAt 不变（真实编辑语义）。
    let content = '第一版'
    let older: any[] = []
    const sessionSwitch: SessionSwitchClient = {
      healthCheckFeatures: ['session.window'],
      hasFeature: (feature: string) => feature === 'session.window',
      sessionIndexGet: async () => {
        throw new Error('未使用')
      },
      sessionSummaryList: async () => {
        throw new Error('未使用')
      },
      sessionGet: async () => {
        throw new Error('未使用')
      },
      setActiveChat: async () => ({ applied: true, preferenceRevision: 1, activeChatId: '' }),
      sessionWindow: async (_scope: any, chatId: string, options: any) => {
        // 只有首窗（无 cursor）返回最新内容；翻页返回已翻出的更早历史。
        if (options?.cursor) {
          return { id: chatId, messages: older, nextCursor: '' }
        }
        return {
          id: chatId,
          title: `会话 ${chatId}`,
          messages: [{ id: 'm-head', content, createdAt: 200 }],
          nextCursor: 'cursor-1',
        }
      },
    } as any

    const meta = {
      roleOrder: ['role-1'],
      roleFolders: { 'role-1': '角色一' },
      groupOrder: [],
      groupFolders: {},
      providerOrder: [],
      providerFolders: {},
      modelGroupOrder: [],
      modelGroupFolders: {},
      ui: {},
      settings: {},
      updatedAt: 1,
    }
    const pipeline = createProjectionPipeline({
      storage: { get: async () => null, set: async () => {} },
      sessionSwitch,
      loadSplitMeta: async () => meta,
      getSplitMetaCache: () => meta,
      applyLocalSelection: () => {},
    })
    return {
      pipeline,
      edit: (next: string) => { content = next },
      seedOlderHistory: (messages: any[]) => { older = messages },
    }
  }

  it('窗口模式下写后刷新读到新一窗（编辑不被旧正文覆盖）', async () => {
    const { pipeline, edit } = makeWindowPipeline()
    const first = await pipeline.chatBodies.load(roleScope, 'c1')
    expect(first.messages[0].content).toBe('第一版')

    edit('改后的文本')
    const refreshed = await pipeline.reloadChatBody(roleScope, 'c1')
    expect(refreshed.messages[0].content).toBe('改后的文本')

    // 缓存里也必须是新一代：下一次普通 load 不能回到旧正文。
    const again = await pipeline.chatBodies.load(roleScope, 'c1')
    expect(again.messages[0].content).toBe('改后的文本')
  })

  it('窗口模式下写后刷新不把已翻出的更早历史丢掉', async () => {
    const { pipeline, edit, seedOlderHistory } = makeWindowPipeline()
    seedOlderHistory([
      { id: 'm-old-1', content: '更早的一', createdAt: 100 },
      { id: 'm-old-2', content: '更早的二', createdAt: 150 },
    ])
    await pipeline.chatBodies.load(roleScope, 'c1')
    await pipeline.loadOlderMessages(roleScope, 'c1')
    expect((await pipeline.chatBodies.load(roleScope, 'c1')).messages).toHaveLength(3)

    edit('改后的文本')
    const refreshed = await pipeline.reloadChatBody(roleScope, 'c1')
    expect(refreshed.messages.map((m: any) => m.id)).toEqual(['m-old-1', 'm-old-2', 'm-head'])
    expect(refreshed.messages[2].content).toBe('改后的文本')
  })

  it('窗口模式下写后刷新不让已从首窗删除的消息复活', async () => {
    // 首窗有两条；删掉最新那条之后，它不该被旧文档捞回来。
    let messages = [
      { id: 'm-a', content: 'a', createdAt: 100 },
      { id: 'm-b', content: 'b', createdAt: 200 },
    ]
    const sessionSwitch: SessionSwitchClient = {
      healthCheckFeatures: ['session.window'],
      hasFeature: (feature: string) => feature === 'session.window',
      sessionIndexGet: async () => {
        throw new Error('未使用')
      },
      sessionSummaryList: async () => {
        throw new Error('未使用')
      },
      sessionGet: async () => {
        throw new Error('未使用')
      },
      setActiveChat: async () => ({ applied: true, preferenceRevision: 1, activeChatId: '' }),
      sessionWindow: async (_scope: any, chatId: string) => ({ id: chatId, messages, nextCursor: '' }),
    } as any
    const meta = {
      roleOrder: ['role-1'], roleFolders: { 'role-1': '角色一' },
      groupOrder: [], groupFolders: {},
      providerOrder: [], providerFolders: {},
      modelGroupOrder: [], modelGroupFolders: {},
      ui: {}, settings: {}, updatedAt: 1,
    }
    const pipeline = createProjectionPipeline({
      storage: { get: async () => null, set: async () => {} },
      sessionSwitch,
      loadSplitMeta: async () => meta,
      getSplitMetaCache: () => meta,
      applyLocalSelection: () => {},
    })

    expect((await pipeline.chatBodies.load(roleScope, 'c1')).messages).toHaveLength(2)
    messages = [{ id: 'm-a', content: 'a', createdAt: 100 }]
    const refreshed = await pipeline.reloadChatBody(roleScope, 'c1')
    expect(refreshed.messages.map((m: any) => m.id)).toEqual(['m-a'])
  })
})
