import { describe, expect, it } from 'vitest'
import { SPLIT_META_KEY, SPLIT_SCHEMA_VERSION } from '../domain/constants'
import { createSplitStorage } from '../storage/splitStorage'
import { createProjectionPipeline } from './projectionPipeline'

// 回归：实体写入只更新 splitStorage 的目录缓存，但投影管线曾读控制器侧的
// 启动快照，导致同一会话内 providerOrder / providerFolders 永远看不到新实体。
//
// 这里按生产装配接线（splitStorage 提供 loadSplitMeta / getSplitMetaCache，
// 实体写入回调作废 catalog），不重建控制器，验证「写后立即读」与「读路径零额外读盘」。

function metaDoc() {
  return {
    schemaVersion: SPLIT_SCHEMA_VERSION,
    dataVersion: 1,
    updatedAt: 1,
    ui: {},
    settings: {},
    roleOrder: [],
    roleFolders: {},
    groupOrder: [],
    groupFolders: {},
    providerOrder: ['provider-existing'],
    providerFolders: { 'provider-existing': '既有供应商' },
    modelGroupOrder: [],
    modelGroupFolders: {},
  }
}

function createHarness() {
  const values: Record<string, any> = { [SPLIT_META_KEY]: metaDoc() }
  let metaReads = 0
  let pendingBlock: { markEntered: () => void; wait: Promise<void> } | null = null

  function blockNextMetaRead() {
    let markEntered!: () => void
    let release!: () => void
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve
    })
    const wait = new Promise<void>((resolve) => {
      release = resolve
    })
    pendingBlock = { markEntered, wait }
    return { entered, release }
  }

  function applyProviderWrite(key: string, provider: any) {
    if (!key.startsWith('providers/') || !key.endsWith('/provider')) return
    const meta = values[SPLIT_META_KEY]
    const id = String(provider?.id || '').trim()
    if (!meta || !id) return
    const folder = key.slice('providers/'.length, -'/provider'.length)
    meta.providerOrder = [id, ...(meta.providerOrder || []).filter((item: string) => item !== id)]
    meta.providerFolders = { ...(meta.providerFolders || {}), [id]: folder }
  }

  function applyProviderRemove(key: string) {
    if (!key.startsWith('providers/') || !key.endsWith('/provider')) return
    const meta = values[SPLIT_META_KEY]
    if (!meta) return
    const folder = key.slice('providers/'.length, -'/provider'.length)
    const id = Object.entries(meta.providerFolders || {}).find(([, value]) => value === folder)?.[0]
    if (!id) return
    meta.providerOrder = (meta.providerOrder || []).filter((item: string) => item !== id)
    delete meta.providerFolders[id]
  }

  const storage = {
    get: async (key: string) => {
      if (key === SPLIT_META_KEY) {
        metaReads += 1
        const block = pendingBlock
        if (block) {
          pendingBlock = null
          const snapshot = JSON.parse(JSON.stringify(values[SPLIT_META_KEY]))
          block.markEntered()
          await block.wait
          return snapshot
        }
      }
      return values[key] ?? null
    },
    set: async (key: string, value: any) => {
      values[key] = value
      applyProviderWrite(key, value)
    },
    remove: async (key: string) => {
      delete values[key]
      applyProviderRemove(key)
    },
  }

  let pipeline!: ReturnType<typeof createProjectionPipeline>
  const store = createSplitStorage({
    storage,
    onCatalogInvalidated: () => pipeline.invalidateCatalog(),
  })
  pipeline = createProjectionPipeline({
    storage,
    loadSplitMeta: () => store.loadSplitMeta(),
    getSplitMetaCache: () => store.getSplitMetaCache(),
    applyLocalSelection: () => {},
  })

  return {
    store,
    pipeline,
    values,
    metaReads: () => metaReads,
    blockNextMetaRead,
  }
}

describe('目录事实的会话内一致性', () => {
  it('保存供应商后 loadCatalog 立即包含新条目，删除后立即消失', async () => {
    const harness = createHarness()
    const initial = await harness.pipeline.cache.loadCatalog()
    expect(initial.providerOrder).toEqual(['provider-existing'])

    await harness.store.saveProviderEntity({ id: 'provider-new', name: '新供应商' })
    const readsAfterSave = harness.metaReads()
    const afterSave = await harness.pipeline.cache.loadCatalog()
    expect(afterSave.providerOrder).toEqual(['provider-new', 'provider-existing'])
    expect(afterSave.providerFolders['provider-new']).toBe('新供应商')
    // 写后读取目录必须命中 splitStorage 的内存事实，不允许再读一次 meta 掩盖问题。
    expect(harness.metaReads()).toBe(readsAfterSave)

    await harness.store.removeProviderEntity('provider-new')
    const readsAfterRemove = harness.metaReads()
    const afterRemove = await harness.pipeline.cache.loadCatalog()
    expect(afterRemove.providerOrder).toEqual(['provider-existing'])
    expect(afterRemove.providerFolders).not.toHaveProperty('provider-new')
    expect(harness.metaReads()).toBe(readsAfterRemove)
  })

  it('写入期间完成的旧盘面读取不会覆盖已提交的目录事实', async () => {
    const harness = createHarness()
    await harness.pipeline.cache.loadCatalog()

    const gate = harness.blockNextMetaRead()
    const staleLoad = harness.store.loadSplitMeta()
    await gate.entered

    await harness.store.saveProviderEntity({ id: 'provider-new', name: '新供应商' })

    gate.release()
    const staleMeta = await staleLoad
    expect(staleMeta.providerOrder).toContain('provider-new')

    const catalog = await harness.pipeline.cache.loadCatalog()
    expect(catalog.providerOrder).toContain('provider-new')
    expect(catalog.providerFolders['provider-new']).toBe('新供应商')
  })
})
