import { describe, expect, it } from 'vitest'
import { CLIENT_PREFERENCES_KEY, SPLIT_META_KEY, SPLIT_SCHEMA_VERSION, SESSION_FAVORITES_KEY } from '../domain/constants'
import { createProjectionPipeline } from '../controller/projectionPipeline'
import { createEmptyShellDataFromStorage, createSplitStorage } from './splitStorage'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function metaDoc(roleFolder: string, providerFolder: string) {
  return {
    schemaVersion: SPLIT_SCHEMA_VERSION,
    dataVersion: 1,
    updatedAt: 1,
    ui: {},
    settings: {},
    roleOrder: ['role-existing'],
    roleFolders: { 'role-existing': roleFolder },
    groupOrder: [],
    groupFolders: {},
    providerOrder: ['provider-existing'],
    providerFolders: { 'provider-existing': providerFolder },
    modelGroupOrder: [],
    modelGroupFolders: {},
  }
}

// 模拟 studio 后端：实体文件写入后，meta() 的目录事实随之更新。
// 前端 saveProviderEntity / saveRoleEntity 不再单独写索引，缓存必须能在
// 下一次 loadSplitMeta 时从后端投影里读回同样的目录事实。
function applyEntityWrite(values: Record<string, any>, key: string, value: any) {
  const meta = values[SPLIT_META_KEY]
  if (!meta) return
  for (const [prefix, suffix, orderKey, foldersKey] of [
    ['providers/', '/provider', 'providerOrder', 'providerFolders'],
    ['roles/', '/role', 'roleOrder', 'roleFolders'],
  ] as const) {
    if (!key.startsWith(prefix) || !key.endsWith(suffix)) continue
    const folder = key.slice(prefix.length, -suffix.length)
    const id = String(value?.id || '').trim()
    if (!id) return
    meta[orderKey] = [id, ...(meta[orderKey] || []).filter((item: string) => item !== id)]
    meta[foldersKey] = { ...(meta[foldersKey] || {}), [id]: folder }
    return
  }
}

function memoryStorage(initial: Record<string, any>) {
  const values: Record<string, any> = { ...initial }
  return {
    values,
    get: async (key: string) => values[key] ?? null,
    set: async (key: string, value: any) => {
      values[key] = value
      applyEntityWrite(values, key, value)
    },
    remove: async (key: string) => {
      delete values[key]
    },
  }
}

function createHarness(roleFolder: string, providerFolder: string, state?: any) {
  const storage = memoryStorage({ [SPLIT_META_KEY]: metaDoc(roleFolder, providerFolder) })
  let pipeline!: ReturnType<typeof createProjectionPipeline>
  const store = createSplitStorage({
    storage,
    getState: state ? () => state : undefined,
    onCatalogInvalidated: () => pipeline.invalidateCatalog(),
  })
  pipeline = createProjectionPipeline({
    storage,
    loadSplitMeta: () => store.loadSplitMeta(),
    getSplitMetaCache: () => store.getSplitMetaCache(),
    applyLocalSelection: () => {},
  })
  return { storage, store, pipeline }
}

describe('splitStorage 实例隔离', () => {
  it('实例之间不共享目录事实缓存', async () => {
    const a = createHarness('角色A', '供应商A')
    const b = createHarness('角色B', '供应商B')

    await a.pipeline.cache.loadCatalog()
    await b.pipeline.cache.loadCatalog()

    await a.store.saveProviderEntity({ id: 'provider-a', name: '新供应商A' })
    await a.store.saveRoleEntity({ id: 'role-a', name: '新角色A' })

    const aMeta = a.store.getSplitMetaCache()
    expect(aMeta.providerOrder).toContain('provider-a')
    expect(aMeta.roleFolders).toHaveProperty('role-a')

    const bMeta = b.store.getSplitMetaCache()
    expect(bMeta.providerOrder).toEqual(['provider-existing'])
    expect(bMeta.providerFolders).not.toHaveProperty('provider-a')
    expect(bMeta.roleFolders).not.toHaveProperty('role-a')

    const bCatalog = await b.pipeline.cache.loadCatalog()
    expect(bCatalog.providerOrder).toEqual(['provider-existing'])
    expect(bCatalog.providerFolders).not.toHaveProperty('provider-a')
    expect(bCatalog.roleFolders).not.toHaveProperty('role-a')

    const aCatalog = await a.pipeline.cache.loadCatalog()
    expect(aCatalog.providerOrder).toContain('provider-a')
    expect(aCatalog.roleFolders).toHaveProperty('role-a')
  })

  it('实例之间不共享 meta 写链', async () => {
    const a = createHarness('角色A', '供应商A')
    const b = createHarness('角色B', '供应商B')

    const entered = deferred()
    const release = deferred()
    const slow = a.store.withSplitMetaWrite(async () => {
      entered.resolve()
      await release.promise
      return 'a'
    })
    await entered.promise

    // A 的写还挂在门闩上，B 的写必须立刻完成，而不是排在 A 后面。
    await expect(b.store.withSplitMetaWrite(async () => 'b')).resolves.toBe('b')

    release.resolve()
    await expect(slow).resolves.toBe('a')
  })

  it('实例之间不共享偏好写链', async () => {
    const makeState = () => ({ data: { favorites: { folders: [], chatRefsByFolderId: {} } } })
    const a = createHarness('角色A', '供应商A', makeState())
    const b = createHarness('角色B', '供应商B', makeState())

    const entered = deferred()
    const release = deferred()
    const originalSet = a.storage.set
    a.storage.set = async (key: string, value: any) => {
      if (key === SESSION_FAVORITES_KEY) {
        entered.resolve()
        await release.promise
      }
      return originalSet(key, value)
    }

    const slow = a.store.saveFavoritesOnly()
    await entered.promise

    await expect(b.store.saveFavoritesOnly()).resolves.toBeUndefined()

    release.resolve()
    await expect(slow).resolves.toBeUndefined()
  })

  it('离线外壳的偏好基线归实例所有，互不覆盖', async () => {
    const makeOffline = async (preferences: any) => {
      const writes: string[] = []
      const storage = {
        get: async (key: string) => (key === CLIENT_PREFERENCES_KEY ? preferences : null),
        set: async (key: string) => {
          writes.push(key)
        },
        remove: async () => {},
      }
      const data = await createEmptyShellDataFromStorage(storage)
      const state: any = {
        data,
        draft: {
          activeRoleId: String(data.ui.activeRoleId || ''),
          activeGroupId: String((data.ui as any).activeGroupId || ''),
          activeWorkspaceId: String((data.ui as any).activeWorkspaceId || ''),
          activeTargetKind: String((data.ui as any).activeTargetKind || 'role'),
        },
        loading: false,
      }
      const store = createSplitStorage({ storage, getState: () => state })
      return { store, writes }
    }

    const uiBase = { activeRoleId: '', activeGroupId: '', activeWorkspaceId: '', activeTargetKind: 'role' }
    const a = await makeOffline({ ui: { ...uiBase, sidebarWidth: 321 }, settings: { chatFontSize: 19 } })
    const b = await makeOffline({ ui: { ...uiBase, sidebarWidth: 654 }, settings: { chatFontSize: 21 } })

    await a.store.saveMetaOnly()
    await b.store.saveMetaOnly()

    expect(a.writes).toEqual([])
    expect(b.writes).toEqual([])
  })

  it('同一实例的旧盘面读取不会覆盖已提交的写入', async () => {
    const values: Record<string, any> = { [SPLIT_META_KEY]: metaDoc('角色A', '供应商A') }
    const entered = deferred()
    const release = deferred()
    let blockNextRead = false

    const storage = {
      get: async (key: string) => {
        if (key === SPLIT_META_KEY && blockNextRead) {
          blockNextRead = false
          const snapshot = JSON.parse(JSON.stringify(values[key]))
          entered.resolve()
          await release.promise
          return snapshot
        }
        return values[key] ?? null
      },
      set: async (key: string, value: any) => {
        values[key] = value
      },
      remove: async (key: string) => {
        delete values[key]
      },
    }

    const store = createSplitStorage({ storage })
    await store.loadSplitMeta()

    blockNextRead = true
    const staleLoad = store.loadSplitMeta()
    await entered.promise

    await store.saveProviderEntity({ id: 'provider-new', name: '新供应商' })
    release.resolve()

    const staleMeta = await staleLoad
    expect(staleMeta.providerOrder).toContain('provider-new')
    expect(store.getSplitMetaCache().providerOrder).toContain('provider-new')
  })
})
