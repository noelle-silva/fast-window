import { describe, expect, it } from 'vitest'
import { CLIENT_PREFERENCES_KEY, SPLIT_META_KEY, SPLIT_SCHEMA_VERSION } from '../domain/constants'
import { createSplitStorage } from './splitStorage'

function memoryStorage(initial: Record<string, any>) {
  const values = { ...initial }
  const writes: string[] = []
  return {
    values,
    writes,
    get: async (key: string) => values[key] ?? null,
    set: async (key: string, value: any) => {
      writes.push(key)
      values[key] = value
    },
    remove: async (key: string) => {
      writes.push(`remove:${key}`)
      delete values[key]
    },
  }
}

function metaDoc(ui: Record<string, any>, settings: Record<string, any> = {}) {
  // 深拷贝：metaDoc 与 state 必须持有彼此独立的 ui 对象，
  // 否则 saveMetaOnly 里的「写前赋值」会同时改到基线，比较永远相等。
  return {
    schemaVersion: SPLIT_SCHEMA_VERSION,
    dataVersion: 7,
    updatedAt: 111,
    ui: JSON.parse(JSON.stringify(ui)),
    settings: JSON.parse(JSON.stringify(settings)),
    roleOrder: [],
    roleFolders: { 'role-1': '角色一' },
    groupOrder: [],
    groupFolders: { 'group-1': '群组一' },
  }
}

function makeState(ui: Record<string, any>, settings: Record<string, any> = {}) {
  return {
    data: { ui, settings, roles: [], chatsByRole: {}, groups: [], chatsByGroup: {} },
    draft: { activeRoleId: '', activeGroupId: '', activeWorkspaceId: '', activeTargetKind: 'role' },
    loading: false,
  }
}

describe('saveMetaOnly', () => {
  it('切换会话（ui 与 settings 都不变）不写 meta', async () => {
    const ui = { activeRoleId: 'role-1', activeGroupId: '', activeWorkspaceId: '', activeTargetKind: 'role' }
    const storage = memoryStorage({ [SPLIT_META_KEY]: metaDoc(ui) })
    const state = makeState(ui)
    state.draft.activeRoleId = 'role-1'

    const store = createSplitStorage({ storage, getState: () => state })
    await store.loadSplitMeta()
    storage.writes.length = 0

    await store.saveMetaOnly()
    expect(storage.writes).toEqual([])
  })

  it('ui 真变化时只写一次偏好通道，且不触碰 meta/index', async () => {
    const ui = { activeRoleId: 'role-1', activeGroupId: '', activeWorkspaceId: '', activeTargetKind: 'role' }
    const storage = memoryStorage({ [SPLIT_META_KEY]: metaDoc(ui) })
    const state = makeState(ui)
    state.draft.activeRoleId = 'role-2'

    const store = createSplitStorage({ storage, getState: () => state })
    await store.loadSplitMeta()
    storage.writes.length = 0

    await store.saveMetaOnly()
    expect(storage.writes).toEqual([CLIENT_PREFERENCES_KEY])
    const saved = storage.values[CLIENT_PREFERENCES_KEY]
    expect(saved.ui.activeRoleId).toBe('role-2')
    // 偏好文档只有 ui / settings，不再是 meta/index 的形状。
    expect(saved).not.toHaveProperty('schemaVersion')
    expect(saved).not.toHaveProperty('updatedAt')
    expect(storage.values[SPLIT_META_KEY].ui.activeRoleId).toBe('role-1')
  })

  it('settings 变化时写偏好通道，而不是 meta/index', async () => {
    const ui = { activeRoleId: 'role-1', activeGroupId: '', activeWorkspaceId: '', activeTargetKind: 'role' }
    const storage = memoryStorage({ [SPLIT_META_KEY]: metaDoc(ui, { streamEnabled: true }) })
    const state = makeState(ui, { streamEnabled: false })
    state.draft.activeRoleId = 'role-1'

    const store = createSplitStorage({ storage, getState: () => state })
    await store.loadSplitMeta()
    storage.writes.length = 0

    await store.saveMetaOnly()
    expect(storage.writes).toEqual([CLIENT_PREFERENCES_KEY])
    expect(storage.values[CLIENT_PREFERENCES_KEY].settings.streamEnabled).toBe(false)
  })

  it('aiServices 的 assist 子键变化不算偏好变化', async () => {
    const ui = { activeRoleId: 'role-1', activeGroupId: '', activeWorkspaceId: '', activeTargetKind: 'role' }
    const storage = memoryStorage({
      [SPLIT_META_KEY]: metaDoc(ui, {
        streamEnabled: true,
        aiServices: { mermaidFix: { enabled: false }, localOnly: { enabled: true } },
      }),
    })
    // assist 子键由 aiChat.assistConfig.set 单独写入，不进入客户端偏好指纹。
    const state = makeState(ui, {
      streamEnabled: true,
      aiServices: { mermaidFix: { enabled: true }, contextCompression: { retainRecentMessages: 9 }, localOnly: { enabled: true } },
    })
    state.draft.activeRoleId = 'role-1'

    const store = createSplitStorage({ storage, getState: () => state })
    await store.loadSplitMeta()
    storage.writes.length = 0

    await store.saveMetaOnly()
    expect(storage.writes).toEqual([])
  })

  it('aiServices 的非 assist 本地键仍参与偏好判定并落盘', async () => {
    const ui = { activeRoleId: 'role-1', activeGroupId: '', activeWorkspaceId: '', activeTargetKind: 'role' }
    const storage = memoryStorage({
      [SPLIT_META_KEY]: metaDoc(ui, {
        aiServices: { mermaidFix: { enabled: false }, localOnly: { enabled: true } },
      }),
    })
    const state = makeState(ui, {
      aiServices: { mermaidFix: { enabled: true }, localOnly: { enabled: false } },
    })
    state.draft.activeRoleId = 'role-1'

    const store = createSplitStorage({ storage, getState: () => state })
    await store.loadSplitMeta()
    storage.writes.length = 0

    await store.saveMetaOnly()
    expect(storage.writes).toEqual([CLIENT_PREFERENCES_KEY])
    const saved = storage.values[CLIENT_PREFERENCES_KEY]
    expect(saved.settings.aiServices.localOnly).toEqual({ enabled: false })
    // assist 子键不进入偏好通道：它们由业务端独立写入。
    expect(saved.settings.aiServices.mermaidFix).toBeUndefined()
  })

  it('外观字段变化仍被指纹检测到，且派生 / 专用字段不落进偏好通道', async () => {
    const ui = { activeRoleId: 'role-1', activeGroupId: '', activeWorkspaceId: '', activeTargetKind: 'role' }
    const storage = memoryStorage({
      [SPLIT_META_KEY]: metaDoc(ui, {
        wallpaper: { activeId: 'w1' },
        providers: [{ id: 'p1' }],
        stickers: { enabled: false },
        aiServices: { mermaidFix: { enabled: false } },
      }),
    })
    const state = makeState(ui, {
      wallpaper: { activeId: 'w2' },
      providers: [{ id: 'p2' }],
      stickers: { enabled: true },
      aiServices: { mermaidFix: { enabled: true } },
    })
    state.draft.activeRoleId = 'role-1'

    const store = createSplitStorage({ storage, getState: () => state })
    await store.loadSplitMeta()
    storage.writes.length = 0

    await store.saveMetaOnly()
    expect(storage.writes).toEqual([CLIENT_PREFERENCES_KEY])
    const saved = storage.values[CLIENT_PREFERENCES_KEY]
    expect(saved.settings.wallpaper.activeId).toBe('w2')
    expect(saved.settings.providers).toBeUndefined()
    expect(saved.settings.stickers).toBeUndefined()
    expect(saved.settings.aiServices.mermaidFix).toBeUndefined()
  })

  it('派生字段（providers / stickers）变化不算偏好变化', async () => {
    const ui = { activeRoleId: 'role-1', activeGroupId: '', activeWorkspaceId: '', activeTargetKind: 'role' }
    const storage = memoryStorage({ [SPLIT_META_KEY]: metaDoc(ui, { streamEnabled: true, providers: [{ id: 'p1' }] }) })
    // state.data.settings 带着后端派生的 providers：它每次 meta() 都会重算，
    // 不该因此触发一次偏好写盘。
    const state = makeState(ui, { streamEnabled: true, providers: [{ id: 'p1' }, { id: 'p2' }] })
    state.draft.activeRoleId = 'role-1'

    const store = createSplitStorage({ storage, getState: () => state })
    await store.loadSplitMeta()
    storage.writes.length = 0

    await store.saveMetaOnly()
    expect(storage.writes).toEqual([])
  })

  it('没有 meta/index 也能保存客户端偏好（不依赖业务连接）', async () => {
    const ui = { activeRoleId: 'role-1', activeGroupId: '', activeWorkspaceId: '', activeTargetKind: 'role' }
    const storage = memoryStorage({})
    const state = makeState(ui, { streamEnabled: false })
    state.draft.activeRoleId = 'role-1'

    const store = createSplitStorage({ storage, getState: () => state })
    await store.saveMetaOnly()

    expect(storage.writes).toEqual([CLIENT_PREFERENCES_KEY])
    expect(storage.values[CLIENT_PREFERENCES_KEY]).toMatchObject({
      ui: { activeRoleId: 'role-1' },
      settings: { streamEnabled: false },
    })
  })

  it('连续保存按调用顺序串行落盘', async () => {
    const ui = { activeRoleId: 'role-1', activeGroupId: '', activeWorkspaceId: '', activeTargetKind: 'role' }
    const storage = memoryStorage({ [SPLIT_META_KEY]: metaDoc(ui, { streamEnabled: true }) })
    const state = makeState(ui, { streamEnabled: true })
    const store = createSplitStorage({ storage, getState: () => state })
    await store.loadSplitMeta()
    storage.writes.length = 0

    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let started!: () => void
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve
    })
    const originalSet = storage.set
    let calls = 0
    storage.set = async (key: string, value: any) => {
      calls += 1
      if (calls === 1) {
        started()
        await gate
      }
      return originalSet(key, value)
    }

    state.data.settings.streamEnabled = false
    const first = store.saveMetaOnly()
    await startedPromise

    state.data.settings.streamEnabled = true
    const second = store.saveMetaOnly()
    await Promise.resolve()
    // 第一次写盘还没完成，第二次必须排队等待。
    expect(calls).toBe(1)

    release()
    await Promise.all([first, second])

    expect(calls).toBe(2)
    expect(storage.values[CLIENT_PREFERENCES_KEY].settings.streamEnabled).toBe(true)
  })

  it('写盘失败上抛，基线不前进，下一次仍会重试', async () => {
    const ui = { activeRoleId: 'role-1', activeGroupId: '', activeWorkspaceId: '', activeTargetKind: 'role' }
    const storage = memoryStorage({ [SPLIT_META_KEY]: metaDoc(ui, { streamEnabled: true }) })
    const state = makeState(ui, { streamEnabled: true })
    const store = createSplitStorage({ storage, getState: () => state })
    await store.loadSplitMeta()
    storage.writes.length = 0

    const originalSet = storage.set
    let shouldFail = true
    storage.set = async (key: string, value: any) => {
      if (shouldFail) {
        shouldFail = false
        throw new Error('disk full')
      }
      return originalSet(key, value)
    }

    state.data.settings.streamEnabled = false
    await expect(store.saveMetaOnly()).rejects.toThrow('disk full')
    expect(storage.writes).toEqual([])

    await store.saveMetaOnly()
    expect(storage.writes).toEqual([CLIENT_PREFERENCES_KEY])
    expect(storage.values[CLIENT_PREFERENCES_KEY].settings.streamEnabled).toBe(false)
  })
})

describe('activeChatId 写入', () => {
  it('注入偏好命令后，只走命令，不再整包写索引', async () => {
    const ui = { activeRoleId: 'role-1', activeGroupId: '', activeWorkspaceId: '', activeTargetKind: 'role' }
    const storage = memoryStorage({
      [SPLIT_META_KEY]: metaDoc(ui),
      'chats/角色一/index': { activeChatId: 'chat-1', chatIds: ['chat-1', 'chat-2'], updatedAt: 5 },
    })
    const state = makeState(ui)
    const commands: Array<{ kind: string; targetId: string; chatId: string }> = []

    const store = createSplitStorage({
      storage,
      getState: () => state,
      setActiveChatCommand: async (kind, targetId, chatId) => {
        commands.push({ kind, targetId, chatId })
        return true
      },
    })
    await store.loadSplitMeta()
    storage.writes.length = 0

    await store.setActiveRoleChatSelection('role-1', 'chat-2')
    expect(commands).toEqual([{ kind: 'role', targetId: 'role-1', chatId: 'chat-2' }])
    // 关键：没有写 chats/<folder>/index，也没有写 meta。
    expect(storage.writes).toEqual([])
    expect(storage.values['chats/角色一/index']).toMatchObject({
      activeChatId: 'chat-1',
      chatIds: ['chat-1', 'chat-2'],
    })
  })

  it('命令失败时抛错，不静默退回整包写', async () => {
    const ui = { activeRoleId: 'role-1', activeGroupId: '', activeWorkspaceId: '', activeTargetKind: 'role' }
    const storage = memoryStorage({ [SPLIT_META_KEY]: metaDoc(ui) })
    const state = makeState(ui)

    const store = createSplitStorage({
      storage,
      getState: () => state,
      setActiveChatCommand: async () => false,
    })
    await store.loadSplitMeta()
    storage.writes.length = 0

    await expect(store.setActiveRoleChatSelection('role-1', 'chat-2')).rejects.toThrow('切换会话偏好失败')
    expect(storage.writes).toEqual([])
  })

  it('未注入命令时退化为最小索引写（只写 activeChatId 一格）', async () => {
    const ui = { activeRoleId: 'role-1', activeGroupId: '', activeWorkspaceId: '', activeTargetKind: 'role' }
    const storage = memoryStorage({
      [SPLIT_META_KEY]: metaDoc(ui),
      'chats/角色一/index': { activeChatId: 'chat-1', chatIds: ['chat-1', 'chat-2'], updatedAt: 5 },
    })
    const state = makeState(ui)

    const store = createSplitStorage({ storage, getState: () => state })
    await store.loadSplitMeta()
    storage.writes.length = 0

    await store.setActiveRoleChatSelection('role-1', 'chat-2')
    expect(storage.writes).toEqual(['chats/角色一/index'])
    // 最小写：只带 activeChatId，不覆盖 chatIds / updatedAt。
    expect(storage.values['chats/角色一/index']).toEqual({ activeChatId: 'chat-2' })
  })
})
