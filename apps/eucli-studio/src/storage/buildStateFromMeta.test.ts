import { describe, expect, it, vi } from 'vitest'
import { CLIENT_PREFERENCES_KEY, SESSION_FAVORITES_KEY, STICKERS_KEY, VERSION } from '../domain/constants'
import { splitGroupKey, splitRoleKey } from '../domain/storageKeys'
import { buildStateFromMeta } from './buildStateFromMeta'
import { createLazyChatStore } from './lazyChatStore'

const meta = {
  schemaVersion: 1,
  dataVersion: VERSION,
  updatedAt: 100,
  ui: { activeRoleId: 'role-1', activeGroupId: '', activeWorkspaceId: '', activeTargetKind: 'role' },
  settings: {
    streamEnabled: true,
    branchTree: { dir: 'lr' },
    providers: [{ id: 'p1', name: '供应商' }],
  },
  roleOrder: ['role-1'],
  roleFolders: { 'role-1': '角色一' },
  groupOrder: ['group-1'],
  groupFolders: { 'group-1': '群组一' },
}

function memoryStorage(initial: Record<string, any> = {}) {
  return {
    get: vi.fn(async (key: string) => {
      switch (key) {
        case STICKERS_KEY:
          return { enabled: true, categories: ['默认'], map: { 默认: {} } }
        case SESSION_FAVORITES_KEY:
          return { folders: [], chatRefsByFolderId: {} }
        case splitRoleKey('角色一'):
          return { id: 'role-1', name: '角色一' }
        case splitGroupKey('群组一'):
          return { id: 'group-1', name: '群组一' }
        default:
          return initial[key] ?? null
      }
    }),
    set: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  }
}

function indexLoader() {
  return vi.fn(async ({ kind, targetId }: { kind: 'role' | 'group'; targetId: string }): Promise<any> => {
    if (kind === 'role' && targetId === 'role-1') {
      return { activeChatId: 'chat-1', chatMetas: [{ id: 'chat-1', title: '会话' }] }
    }
    if (kind === 'group' && targetId === 'group-1') {
      return { activeChatId: '', chatMetas: [] }
    }
    return null
  })
}

describe('buildStateFromMeta', () => {
  it('装配角色 / 群组 / 派生 settings，并装索引事实', async () => {
    const data = await buildStateFromMeta({ meta, storage: memoryStorage(), loadChatIndex: indexLoader() })

    expect(data.roles).toHaveLength(1)
    expect(data.roles[0]).toMatchObject({ id: 'role-1', name: '角色一' })
    expect(data.groups).toHaveLength(1)
    expect(data.groups[0]).toMatchObject({ id: 'group-1', name: '群组一' })
    expect(data.chatsByRole['role-1']).toMatchObject({ activeChatId: 'chat-1', chats: [] })
    expect(data.chatsByRole['role-1'].chatMetas[0].id).toBe('chat-1')
    expect(data.chatsByGroup['group-1']).toMatchObject({ activeChatId: '', chats: [] })
    expect(data.settings.streamEnabled).toBe(true)
    expect(data.settings.stickers).toMatchObject({ enabled: true, categories: ['默认'] })
    expect(data.settings.providers[0]).toMatchObject({ id: 'p1', name: '供应商' })
    expect(data.favorites).toMatchObject({ folders: [], chatRefsByFolderId: {} })
  })

  it('state 的 ui / settings 与 meta 快照是两棵独立的树', async () => {
    const data = await buildStateFromMeta({ meta, storage: memoryStorage(), loadChatIndex: indexLoader() })

    data.ui.activeRoleId = 'role-2'
    data.settings.branchTree.dir = 'tb'
    data.settings.streamEnabled = false

    expect(meta.ui.activeRoleId).toBe('role-1')
    expect(meta.settings.branchTree.dir).toBe('lr')
    expect(meta.settings.streamEnabled).toBe(true)
  })

  it('索引缺失时回落到空 chatMetas，而不是抛错', async () => {
    const data = await buildStateFromMeta({ meta, storage: memoryStorage(), loadChatIndex: vi.fn(async () => null) })

    expect(data.chatsByRole['role-1'].activeChatId).toBe('')
    expect(data.chatsByRole['role-1'].chatMetas).toEqual([])
  })

  it('角色文件缺失时快速失败', async () => {
    const storage = memoryStorage()
    storage.get.mockImplementation(async () => null)

    await expect(buildStateFromMeta({ meta, storage, loadChatIndex: indexLoader() })).rejects.toThrow('角色文件缺失或无效')
  })

  it('客户端偏好通道覆盖 ui 与投影自有 settings，meta 仍提供 providers / stickers', async () => {
    const preferences = {
      ui: { sidebarWidth: 321, activeTargetKind: 'role' },
      settings: {
        streamEnabled: false,
        branchTree: { dir: 'tb' },
        providers: [{ id: 'bad' }],
        stickers: { enabled: false },
        aiServices: { mermaidFix: { enabled: true }, localOnly: { enabled: true } },
      },
    }
    const storage = memoryStorage({ [CLIENT_PREFERENCES_KEY]: preferences })

    const data = await buildStateFromMeta({ meta, storage, loadChatIndex: indexLoader() })

    expect(data.ui.sidebarWidth).toBe(321)
    expect(data.settings.streamEnabled).toBe(false)
    expect(data.settings.branchTree.dir).toBe('tb')
    // providers / stickers 仍来自 meta / 专用通道，偏好通道里的同名脏值被剥离。
    expect(data.settings.providers[0]).toMatchObject({ id: 'p1', name: '供应商' })
    expect(data.settings.stickers).toMatchObject({ enabled: true, categories: ['默认'] })
    // assist 子键不属于客户端偏好；非 assist 本地键保留。
    expect(data.settings.aiServices.mermaidFix.enabled).toBe(false)
    expect(data.settings.aiServices.localOnly).toEqual({ enabled: true })
  })

  it('偏好通道与 state / meta 三棵树互不共享引用', async () => {
    const preferences = {
      ui: { sidebarWidth: 321 },
      settings: { branchTree: { dir: 'tb' }, aiServices: { localOnly: { enabled: true } } },
    }
    const storage = memoryStorage({ [CLIENT_PREFERENCES_KEY]: preferences })

    const data = await buildStateFromMeta({ meta, storage, loadChatIndex: indexLoader() })
    data.settings.branchTree.dir = 'bt'
    data.settings.aiServices.localOnly.enabled = false

    expect(preferences.settings.branchTree.dir).toBe('tb')
    expect(preferences.settings.aiServices.localOnly.enabled).toBe(true)
    expect(meta.settings.branchTree.dir).toBe('lr')
  })

  it('偏好通道形状损坏时回落到 meta，不抛错', async () => {
    const storage = memoryStorage({ [CLIENT_PREFERENCES_KEY]: ['bad'] })

    const data = await buildStateFromMeta({ meta, storage, loadChatIndex: indexLoader() })
    expect(data.settings.streamEnabled).toBe(true)
    expect(data.ui.activeRoleId).toBe('role-1')
  })

  it('偏好通道读取失败时回落到 meta，不把失败折成默认偏好', async () => {
    const storage = memoryStorage({
      [CLIENT_PREFERENCES_KEY]: { ui: { sidebarWidth: 421 }, settings: { streamEnabled: false } },
    })
    const originalGet = storage.get.getMockImplementation()!
    storage.get.mockImplementation(async (key: string) => {
      if (key === CLIENT_PREFERENCES_KEY) throw new Error('file locked')
      return originalGet(key)
    })

    const data = await buildStateFromMeta({ meta, storage, loadChatIndex: indexLoader() })
    expect(data.settings.streamEnabled).toBe(true)
    expect(data.ui.activeRoleId).toBe('role-1')
  })
})

describe('loadShell 与 buildStateFromMeta 唯一组装路径', () => {
  it('loadShell 返回与直接调用组装器完全一致的状态', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    try {
      const direct = await buildStateFromMeta({ meta, storage: memoryStorage(), loadChatIndex: indexLoader() })

      const state: any = { data: null, draft: {}, loading: false }
      const lazy = createLazyChatStore({
        storage: memoryStorage(),
        getState: () => state,
        loadSplitMeta: async () => meta,
        loadChatIndex: indexLoader(),
      })

      expect(await lazy.loadShell()).toEqual(direct)
    } finally {
      vi.useRealTimers()
    }
  })

  it('loadShell 读取客户端偏好通道，不要求 meta 携带偏好', async () => {
    const storage = memoryStorage({
      [CLIENT_PREFERENCES_KEY]: { ui: { sidebarWidth: 400 }, settings: { streamEnabled: false } },
    })
    const state: any = { data: null, draft: {}, loading: false }
    const lazy = createLazyChatStore({
      storage,
      getState: () => state,
      loadSplitMeta: async () => meta,
      loadChatIndex: indexLoader(),
    })

    const data = await lazy.loadShell()
    expect(data.ui.sidebarWidth).toBe(400)
    expect(data.settings.streamEnabled).toBe(false)
  })
})
