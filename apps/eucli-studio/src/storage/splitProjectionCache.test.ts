import { describe, expect, it } from 'vitest'
import {
  buildChatIndexSnapshot,
  chatIndexMatchesChats,
  createSplitProjectionCache,
  normalizeCatalogSnapshot,
  normalizeChatIndexSnapshot,
  projectionScopeKey,
  type CatalogSnapshot,
  type ChatIndexSnapshot,
  type ProjectionVersions,
} from './splitProjectionCache'

function catalog(): CatalogSnapshot {
  return normalizeCatalogSnapshot({
    roleOrder: ['role-1', 'role-2'],
    roleFolders: { 'role-1': '角色一', 'role-2': '角色二' },
    groupOrder: ['group-1'],
    groupFolders: { 'group-1': '群组一' },
    providerOrder: ['p1'],
    providerFolders: { p1: '供应商一' },
    modelGroupOrder: [],
    modelGroupFolders: {},
  })
}

function chatIndex(scopeKey: string, ids: string[], activeChatId = ''): ChatIndexSnapshot {
  return {
    scope: scopeKey,
    activeChatId,
    chatIds: ids,
    chatUpdatedAt: Object.fromEntries(ids.map((id, index) => [id, 1000 + index])),
    chatMetas: ids.map((id, index) => ({
      id,
      title: `会话${id}`,
      createdAt: 1000 + index,
      updatedAt: 1000 + index,
      lastMessagePreview: '',
      messageCount: 0,
      hasPending: false,
      runStatus: 'idle',
      runStatusChangedAt: 0,
    })),
    updatedAt: 2000,
    revision: 7,
  }
}

describe('SplitProjectionCache', () => {
  it('目录只加载一次，命中后不再请求', async () => {
    let calls = 0
    const versions: ProjectionVersions = { dataRevision: 1, preferenceRevision: 1, epoch: 3 }
    const cache = createSplitProjectionCache({
      loadCatalog: async () => {
        calls += 1
        return catalog()
      },
      loadChatIndex: async () => null,
      getVersions: () => versions,
    })

    const first = await cache.loadCatalog()
    const second = await cache.loadCatalog()
    expect(calls).toBe(1)
    expect(first).toBe(second)
    expect(second.roleOrder).toEqual(['role-1', 'role-2'])
  })

  it('并发加载同一 scope 只请求一次', async () => {
    let calls = 0
    const versions: ProjectionVersions = { dataRevision: 1, preferenceRevision: 1, epoch: 3 }
    const scope = { kind: 'role' as const, targetId: 'role-1' }
    const cache = createSplitProjectionCache({
      loadCatalog: async () => catalog(),
      loadChatIndex: async (requested) => {
        calls += 1
        await new Promise((resolve) => setTimeout(resolve, 5))
        return chatIndex(projectionScopeKey(requested), ['chat-1', 'chat-2'])
      },
      getVersions: () => versions,
    })

    const results = await Promise.all([1, 2, 3, 4].map(() => cache.loadChatIndex(scope)))
    expect(calls).toBe(1)
    for (const result of results) expect(result?.chatIds).toEqual(['chat-1', 'chat-2'])
  })

  it('epoch 变化让目录与所有 scope 索引整份作废', async () => {
    let catalogCalls = 0
    let indexCalls = 0
    const versions: ProjectionVersions = { dataRevision: 1, preferenceRevision: 1, epoch: 3 }
    const scope = { kind: 'role' as const, targetId: 'role-1' }
    const cache = createSplitProjectionCache({
      loadCatalog: async () => {
        catalogCalls += 1
        return catalog()
      },
      loadChatIndex: async (requested) => {
        indexCalls += 1
        return chatIndex(projectionScopeKey(requested), ['chat-1'])
      },
      getVersions: () => versions,
    })

    await cache.loadCatalog()
    await cache.loadChatIndex(scope)
    expect(catalogCalls).toBe(1)
    expect(indexCalls).toBe(1)

    // 同一 epoch：缓存命中。
    expect(cache.peekCatalog()).not.toBeNull()
    expect(cache.peekChatIndex(scope)).not.toBeNull()

    versions.epoch = 4
    expect(cache.peekCatalog()).toBeNull()
    expect(cache.peekChatIndex(scope)).toBeNull()

    await cache.loadCatalog()
    await cache.loadChatIndex(scope)
    expect(catalogCalls).toBe(2)
    expect(indexCalls).toBe(2)
  })

  it('单个 scope 失效不波及其它 scope', async () => {
    const versions: ProjectionVersions = { dataRevision: 1, preferenceRevision: 1, epoch: 3 }
    const calls: string[] = []
    const cache = createSplitProjectionCache({
      loadCatalog: async () => catalog(),
      loadChatIndex: async (scope) => {
        calls.push(scope.targetId)
        return chatIndex(projectionScopeKey(scope), [`${scope.targetId}-chat`])
      },
      getVersions: () => versions,
    })

    await cache.loadChatIndex({ kind: 'role', targetId: 'role-1' })
    await cache.loadChatIndex({ kind: 'role', targetId: 'role-2' })
    expect(calls).toEqual(['role-1', 'role-2'])

    cache.invalidateScope({ kind: 'role', targetId: 'role-1' })
    expect(cache.peekChatIndex({ kind: 'role', targetId: 'role-1' })).toBeNull()
    expect(cache.peekChatIndex({ kind: 'role', targetId: 'role-2' })).not.toBeNull()
  })

  it('setActiveChatId 只改偏好，不动数据事实', async () => {
    const versions: ProjectionVersions = { dataRevision: 1, preferenceRevision: 1, epoch: 3 }
    const scope = { kind: 'role' as const, targetId: 'role-1' }
    const cache = createSplitProjectionCache({
      loadCatalog: async () => catalog(),
      loadChatIndex: async (requested) => chatIndex(projectionScopeKey(requested), ['chat-1', 'chat-2'], 'chat-1'),
      getVersions: () => versions,
    })

    const before = await cache.loadChatIndex(scope)
    cache.setActiveChatId(scope, 'chat-2')
    const after = cache.peekChatIndex(scope)
    expect(after?.activeChatId).toBe('chat-2')
    expect(after?.chatIds).toEqual(before?.chatIds)
    expect(after?.revision).toBe(before?.revision)
    expect(after?.updatedAt).toBe(before?.updatedAt)
  })

  // 审查偏差 B：版本门必须能观察到服务端最新 revision，缓存命中不能吞掉它。
  it('refreshChatIndex 即使缓存命中也会重新确认服务端 revision', async () => {
    let revision = 7
    let calls = 0
    const versions: ProjectionVersions = { dataRevision: 1, preferenceRevision: 1, epoch: 3 }
    const scope = { kind: 'role' as const, targetId: 'role-1' }
    const cache = createSplitProjectionCache({
      loadCatalog: async () => catalog(),
      loadChatIndex: async (requested) => {
        calls += 1
        return { ...chatIndex(projectionScopeKey(requested), ['chat-1']), revision }
      },
      getVersions: () => versions,
    })

    const first = await cache.loadChatIndex(scope)
    expect(first?.revision).toBe(7)
    expect(calls).toBe(1)

    // 缓存命中：loadChatIndex 不产生请求（这是热路径）。
    const cached = await cache.loadChatIndex(scope)
    expect(cached?.revision).toBe(7)
    expect(calls).toBe(1)

    // 服务端已经推进：refreshChatIndex 必须看到新值并回写缓存。
    revision = 8
    const refreshed = await cache.refreshChatIndex(scope)
    expect(refreshed?.revision).toBe(8)
    expect(calls).toBe(2)
    expect(cache.peekChatIndex(scope)?.revision).toBe(8)
  })

  it('refreshChatIndex 并发合流：同一 scope 只请求一次', async () => {
    let calls = 0
    const versions: ProjectionVersions = { dataRevision: 1, preferenceRevision: 1, epoch: 3 }
    const scope = { kind: 'role' as const, targetId: 'role-1' }
    const cache = createSplitProjectionCache({
      loadCatalog: async () => catalog(),
      loadChatIndex: async (requested) => {
        calls += 1
        await new Promise((resolve) => setTimeout(resolve, 5))
        return chatIndex(projectionScopeKey(requested), ['chat-1'])
      },
      getVersions: () => versions,
    })

    await Promise.all([cache.refreshChatIndex(scope), cache.refreshChatIndex(scope), cache.refreshChatIndex(scope)])
    expect(calls).toBe(1)
  })
})

describe('会话索引快照归一', () => {
  it('chatIds 缺失时回落到 chatMetas 的 id 序列', () => {
    const snapshot = normalizeChatIndexSnapshot(
      { chatMetas: [{ id: 'a' }, { id: 'b' }], updatedAt: 10 },
      { kind: 'role', targetId: 'role-1' },
    )
    expect(snapshot?.chatIds).toEqual(['a', 'b'])
    expect(snapshot?.scope).toBe('role:role-1')
  })

  it('群聊与角色的 fallback 标题不同', () => {
    const group = normalizeChatIndexSnapshot(
      { chatIds: ['g1'] },
      { kind: 'group', targetId: 'group-1' },
    )
    expect(group?.chatMetas[0]?.title).toBe('群聊')
    const role = normalizeChatIndexSnapshot({ chatIds: ['c1'] }, { kind: 'role', targetId: 'role-1' })
    expect(role?.chatMetas[0]?.title).toBe('新聊天')
  })

  it('非法输入返回 null 而不是半截对象', () => {
    expect(normalizeChatIndexSnapshot(null, { kind: 'role', targetId: 'r' })).toBeNull()
    expect(normalizeChatIndexSnapshot('bad', { kind: 'role', targetId: 'r' })).toBeNull()
  })

  it('buildChatIndexSnapshot 给缺 updatedAt 的索引补一个展示时间', () => {
    const snapshot = buildChatIndexSnapshot({ chatIds: ['a'] }, { kind: 'role', targetId: 'role-1' })
    expect(snapshot?.updatedAt).toBeGreaterThan(0)
  })
})

describe('chatIndexMatchesChats', () => {
  it('索引未覆盖本地会话时返回 false', () => {
    const snapshot = chatIndex('role:role-1', ['chat-1'])
    expect(chatIndexMatchesChats(snapshot, [{ id: 'chat-1' }])).toBe(true)
    expect(chatIndexMatchesChats(snapshot, [{ id: 'chat-1' }, { id: 'chat-2' }])).toBe(false)
    expect(chatIndexMatchesChats(null, [{ id: 'chat-1' }])).toBe(false)
  })
})
