import { describe, expect, it } from 'vitest'
import { SPLIT_META_KEY, SPLIT_SCHEMA_VERSION } from '../domain/constants'
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

  it('ui 真变化时写一次 meta，且不 bump 全局 updatedAt', async () => {
    const ui = { activeRoleId: 'role-1', activeGroupId: '', activeWorkspaceId: '', activeTargetKind: 'role' }
    const storage = memoryStorage({ [SPLIT_META_KEY]: metaDoc(ui) })
    const state = makeState(ui)
    state.draft.activeRoleId = 'role-2'

    const store = createSplitStorage({ storage, getState: () => state })
    await store.loadSplitMeta()
    storage.writes.length = 0

    await store.saveMetaOnly()
    expect(storage.writes).toEqual([SPLIT_META_KEY])
    const saved = storage.values[SPLIT_META_KEY]
    expect(saved.ui.activeRoleId).toBe('role-2')
    // updatedAt 已降级为纯展示字段：偏好写入不再推进它。
    expect(saved.updatedAt).toBe(111)
  })

  it('settings 变化时同样写一次 meta', async () => {
    const ui = { activeRoleId: 'role-1', activeGroupId: '', activeWorkspaceId: '', activeTargetKind: 'role' }
    const storage = memoryStorage({ [SPLIT_META_KEY]: metaDoc(ui, { streamEnabled: true }) })
    const state = makeState(ui, { streamEnabled: false })
    state.draft.activeRoleId = 'role-1'

    const store = createSplitStorage({ storage, getState: () => state })
    await store.loadSplitMeta()
    storage.writes.length = 0

    await store.saveMetaOnly()
    expect(storage.writes).toEqual([SPLIT_META_KEY])
    expect(storage.values[SPLIT_META_KEY].settings.streamEnabled).toBe(false)
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
