import { describe, expect, it, vi } from 'vitest'
import { SESSION_FAVORITES_KEY, STICKERS_KEY, VERSION } from '../domain/constants'
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

function memoryStorage() {
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
          return null
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
})
