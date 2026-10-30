import { describe, expect, it } from 'vitest'
import { SPLIT_META_KEY, SPLIT_SCHEMA_VERSION } from '../domain/constants'
import { loadProvidersFromStorage, loadSplitMetaSnapshot, normalizeStoredChatIndex } from './splitIndexes'

function memoryStorage(initial: Record<string, any>) {
  const values = { ...initial }
  const writes: string[] = []
  const reads: string[] = []
  return {
    values,
    writes,
    reads,
    get: async (key: string) => {
      reads.push(key)
      return values[key] ?? null
    },
    set: async (key: string, value: any) => {
      writes.push(key)
      values[key] = value
    },
  }
}

function metaDoc(extra: Record<string, any> = {}) {
  return {
    schemaVersion: SPLIT_SCHEMA_VERSION,
    dataVersion: 7,
    updatedAt: 1000,
    ui: { activeRoleId: 'role-1' },
    settings: {},
    roleOrder: ['role-1'],
    roleFolders: { 'role-1': '角色一' },
    groupOrder: ['group-1'],
    groupFolders: { 'group-1': '群组一' },
    providerOrder: ['p1'],
    providerFolders: { p1: '供应商一' },
    modelGroupOrder: ['mg1'],
    modelGroupFolders: { mg1: '模型组一' },
    ...extra,
  }
}

describe('loadSplitMetaSnapshot', () => {
  it('只读一次 meta/index，不再扇出 4 个 index key', async () => {
    const storage = memoryStorage({
      [SPLIT_META_KEY]: metaDoc(),
      'chats/index': { roleOrder: ['role-1'], roleFolders: { 'role-1': '角色一' } },
      'groups/index': { groupOrder: [], groupFolders: {} },
      'providers/index': { providerOrder: ['p1'], providerFolders: { p1: '供应商一' } },
      'model-groups/index': { modelGroupOrder: [], modelGroupFolders: {} },
    })

    const meta = await loadSplitMetaSnapshot(storage)
    expect(meta?.roleOrder).toEqual(['role-1'])
    expect(meta?.groupOrder).toEqual(['group-1'])
    expect(meta?.providerOrder).toEqual(['p1'])
    expect(meta?.modelGroupOrder).toEqual(['mg1'])
    // 关键：读路径只碰 meta/index 一个键。
    expect(storage.reads).toEqual([SPLIT_META_KEY])
  })

  it('不携带任何 scope 的 chatIndex（索引按 scope 懒加载）', async () => {
    const storage = memoryStorage({ [SPLIT_META_KEY]: metaDoc() })
    const meta = await loadSplitMetaSnapshot(storage)
    expect(meta).not.toHaveProperty('chatIndexByRole')
    expect(meta).not.toHaveProperty('chatIndexByGroup')
  })

  it('读路径绝不写盘（禁止读时修复并回写）', async () => {
    const storage = memoryStorage({ [SPLIT_META_KEY]: metaDoc() })
    await loadSplitMetaSnapshot(storage)
    expect(storage.writes).toEqual([])
  })

  it('meta 文档缺失时返回 null（而不是伪造空文档）', async () => {
    const storage = memoryStorage({})
    expect(await loadSplitMetaSnapshot(storage)).toBeNull()
  })

  it('schema 版本不符时快速失败', async () => {
    const storage = memoryStorage({ [SPLIT_META_KEY]: { ...metaDoc(), schemaVersion: 99 } })
    await expect(loadSplitMetaSnapshot(storage)).rejects.toThrow('meta/index 格式不正确')
  })
})

describe('loadProvidersFromStorage', () => {
  it('供应商直接取自 meta.settings.providers，不再读 providers/index', async () => {
    const storage = memoryStorage({ 'providers/index': { providerOrder: ['p1'], providerFolders: { p1: '供应商一' } } })
    const providers = await loadProvidersFromStorage(storage, {
      settings: { providers: [{ id: 'p1', name: '供应商一' }, null, 'bad'] },
    })
    expect(providers).toEqual([{ id: 'p1', name: '供应商一' }])
    expect(storage.reads).toEqual([])
  })

  it('没有 providers 时返回空数组', async () => {
    const storage = memoryStorage({})
    expect(await loadProvidersFromStorage(storage, { settings: {} })).toEqual([])
  })
})

describe('normalizeStoredChatIndex', () => {
  it('保留 activeChatId 与数据事实，且不产生写盘', () => {
    const index = normalizeStoredChatIndex(
      {
        activeChatId: 'chat-2',
        chatIds: ['chat-1', 'chat-2'],
        chatUpdatedAt: { 'chat-1': 10, 'chat-2': 20 },
        chatMetas: [{ id: 'chat-1', title: '一' }, { id: 'chat-2', title: '二' }],
        updatedAt: 30,
      },
      { kind: 'role', targetId: 'role-1' },
      '新聊天',
    )
    expect(index.scope).toBe('role:role-1')
    expect(index.activeChatId).toBe('chat-2')
    expect(index.chatIds).toEqual(['chat-1', 'chat-2'])
    expect(index.chatUpdatedAt).toEqual({ 'chat-1': 10, 'chat-2': 20 })
    expect(index.updatedAt).toBe(30)
  })

  it('chatIds 缺失时回落到 chatMetas', () => {
    const index = normalizeStoredChatIndex(
      { chatMetas: [{ id: 'a' }, { id: 'b' }] },
      { kind: 'group', targetId: 'group-1' },
      '群聊',
    )
    expect(index.chatIds).toEqual(['a', 'b'])
  })

  it('空索引返回空形状而不是抛错', () => {
    const index = normalizeStoredChatIndex(null, { kind: 'role', targetId: 'role-1' }, '新聊天')
    expect(index.chatIds).toEqual([])
    expect(index.activeChatId).toBe('')
  })
})
