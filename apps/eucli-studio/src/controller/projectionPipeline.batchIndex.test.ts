import { describe, expect, it } from 'vitest'
import { createProjectionPipeline } from './projectionPipeline'

// 批量索引读取的契约：多个 target 合并成一次请求，落地即可被缓存复用。
function fakeClient(calls: any[][]) {
  return {
    hasFeature: (feature: string) => feature === 'sessionIndex.get',
    sessionIndexGet: async (scopes: any[]) => {
      calls.push(scopes)
      return {
        schemaVersion: 1,
        dataRevision: 1,
        preferenceRevision: 1,
        epoch: 1,
        indexes: scopes.map((scope) => ({
          scope: `${scope.kind}:${scope.targetId}`,
          activeChatId: '',
          chatIds: [`${scope.targetId}-chat`],
          chatUpdatedAt: {},
          chatVersions: {},
          chatMetas: [{ id: `${scope.targetId}-chat`, title: `${scope.targetId} 的会话` }],
          updatedAt: 10,
          revision: 1,
        })),
      } as any
    },
  } as any
}

function pipelineOf(calls: any[][]) {
  return createProjectionPipeline({
    storage: { get: async () => null, set: async () => {} },
    sessionSwitch: fakeClient(calls),
    loadSplitMeta: async () => ({}),
    getSplitMetaCache: () => null,
    applyLocalSelection: () => {},
  })
}

describe('批量索引读取', () => {
  it('多个 scope 合并成一次请求，重复的只算一次', async () => {
    const calls: any[][] = []
    const pipeline = pipelineOf(calls)
    const loaded = await pipeline.loadChatIndexes([
      { kind: 'role', targetId: 'role-1' },
      { kind: 'workspace', targetId: 'ws-1::role-2' },
      { kind: 'role', targetId: 'role-1' },
    ])

    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual([
      { kind: 'role', targetId: 'role-1' },
      { kind: 'workspace', targetId: 'ws-1::role-2' },
    ])
    expect(loaded.map((item) => `${item.scope.kind}:${item.scope.targetId}`)).toEqual([
      'role:role-1',
      'workspace:ws-1::role-2',
    ])
  })

  it('落地的索引直接进缓存，后续读取不再发请求', async () => {
    const calls: any[][] = []
    const pipeline = pipelineOf(calls)
    await pipeline.loadChatIndexes([{ kind: 'workspace', targetId: 'ws-1::role-2' }])

    const cached = pipeline.cache.peekChatIndex({ kind: 'workspace', targetId: 'ws-1::role-2' })
    expect(cached?.chatMetas[0]?.title).toBe('ws-1::role-2 的会话')

    await pipeline.loadChatIndex({ kind: 'workspace', targetId: 'ws-1::role-2' })
    expect(calls).toHaveLength(1)
  })

  it('后端不支持索引接口时返回空清单，不抛错', async () => {
    const pipeline = createProjectionPipeline({
      storage: { get: async () => null, set: async () => {} },
      sessionSwitch: { hasFeature: () => false } as any,
      loadSplitMeta: async () => ({}),
      getSplitMetaCache: () => null,
      applyLocalSelection: () => {},
    })
    await expect(pipeline.loadChatIndexes([{ kind: 'role', targetId: 'role-1' }])).resolves.toEqual([])
  })
})
