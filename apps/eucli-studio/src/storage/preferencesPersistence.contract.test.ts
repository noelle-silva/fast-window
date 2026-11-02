import { describe, expect, it, vi } from 'vitest'
import { SPLIT_META_KEY, SPLIT_SCHEMA_VERSION, VERSION } from '../domain/constants'
import { normalizeData } from '../domain/dataNormalizers'
import { createLazyChatStore } from './lazyChatStore'
import { createSplitStorage } from './splitStorage'

const DRAFT = { activeRoleId: '', activeGroupId: '', activeWorkspaceId: '', activeTargetKind: 'role' }

function normalizedSettings(): Record<string, any> {
  const data = normalizeData({
    version: VERSION,
    settings: {},
    favorites: {},
    roles: [],
    chatsByRole: {},
    groups: [],
    chatsByGroup: {},
    ui: {},
  })
  return data.settings
}

function settingsFixture(overrides: Record<string, any> = {}) {
  return { ...normalizedSettings(), composerModelShowProvider: false, ...overrides }
}

function metaDoc(settings: Record<string, any>) {
  return {
    schemaVersion: SPLIT_SCHEMA_VERSION,
    dataVersion: VERSION,
    updatedAt: 100,
    ui: { activeRoleId: '', activeGroupId: '', activeWorkspaceId: '', activeTargetKind: 'role' },
    settings,
    roleOrder: [],
    roleFolders: {},
    groupOrder: [],
    groupFolders: {},
  }
}

function cloneDocument(value: any) {
  return value == null ? null : JSON.parse(JSON.stringify(value))
}

function memoryStorage(initial: Record<string, any>) {
  const values: Record<string, any> = { ...initial }
  const writes: string[] = []
  return {
    values,
    writes,
    get: vi.fn(async (key: string) => cloneDocument(values[key] ?? null)),
    set: vi.fn(async (key: string, value: any) => {
      writes.push(key)
      values[key] = cloneDocument(value)
    }),
    remove: vi.fn(async (key: string) => {
      delete values[key]
    }),
  }
}

function createHarness(settings: Record<string, any> = settingsFixture()) {
  return memoryStorage({ [SPLIT_META_KEY]: metaDoc(settings) })
}

function createStore(storage: ReturnType<typeof memoryStorage>) {
  const state: any = { data: null, draft: { ...DRAFT }, loading: false }
  const split = createSplitStorage({ storage, getState: () => state })
  let loadedMeta: any = null
  const lazy = createLazyChatStore({
    storage,
    getState: () => state,
    loadSplitMeta: async () => {
      loadedMeta = await split.loadSplitMeta()
      return loadedMeta
    },
    loadChatIndex: vi.fn(async () => null),
  })
  return { state, split, lazy, loadedMeta: () => loadedMeta }
}

async function loadShellData(storage: ReturnType<typeof memoryStorage>) {
  const ctx = createStore(storage)
  await ctx.split.loadSplitMeta()
  ctx.state.data = await ctx.lazy.loadShell()
  return ctx
}

async function saveMutation(mutate: (settings: any) => void) {
  const storage = createHarness()
  const { state, split } = await loadShellData(storage)
  mutate(state.data.settings)
  await split.saveMetaOnly()
  return { storage, payload: storage.values[SPLIT_META_KEY] }
}

async function reloadAfterSave(storage: ReturnType<typeof memoryStorage>) {
  const { state } = await loadShellData(storage)
  return state.data
}

describe('客户端偏好保存/重载·引用隔离', () => {
  it('loadShell 返回的 settings 与 loadShell 使用的 meta.settings 不是同一对象', async () => {
    const storage = createHarness()
    const { state, loadedMeta } = await loadShellData(storage)

    expect(state.data.settings).not.toBe(loadedMeta().settings)
  })

  it('嵌套 aiServices / branchTree 不与 meta 共享引用', async () => {
    const storage = createHarness()
    const { state, loadedMeta } = await loadShellData(storage)
    const metaSettings = loadedMeta().settings

    expect(state.data.settings.aiServices).not.toBe(metaSettings.aiServices)
    expect(state.data.settings.aiServices.mermaidFix).not.toBe(metaSettings.aiServices.mermaidFix)
    expect(state.data.settings.branchTree).not.toBe(metaSettings.branchTree)
  })

  it('修改 state.data.settings 不污染 loadShell 使用的 meta.settings', async () => {
    const storage = createHarness()
    const { state, loadedMeta } = await loadShellData(storage)

    state.data.settings.composerModelShowProvider = true
    state.data.settings.branchTree.dir = 'tb'
    state.data.settings.aiServices.mermaidFix.enabled = true

    expect(loadedMeta().settings.composerModelShowProvider).toBe(false)
    expect(loadedMeta().settings.branchTree.dir).toBe('lr')
    expect(loadedMeta().settings.aiServices.mermaidFix.enabled).toBe(false)
  })
})

describe('客户端偏好保存/重载·保存到 meta/index', () => {
  it('端到端保存 composerModelShowProvider 到 meta/index', async () => {
    const { storage, payload } = await saveMutation((settings) => {
      settings.composerModelShowProvider = true
    })

    expect(storage.set).toHaveBeenCalled()
    expect(storage.writes).toEqual([SPLIT_META_KEY])
    expect(payload.settings.composerModelShowProvider).toBe(true)
  })

  it('在 meta/index 上端到端保存 branchTree.dir', async () => {
    const { storage, payload } = await saveMutation((settings) => {
      settings.branchTree.dir = 'tb'
    })

    expect(storage.set).toHaveBeenCalled()
    expect(storage.writes).toEqual([SPLIT_META_KEY])
    expect(payload.settings.branchTree.dir).toBe('tb')
  })

  it('aiServices 的 assist 子键变化不触发 meta 写盘', async () => {
    const { storage, payload } = await saveMutation((settings) => {
      settings.aiServices.mermaidFix.enabled = true
    })

    // assist 配置由 aiChat.assistConfig.set 单独写入，不属于客户端偏好。
    expect(storage.set).not.toHaveBeenCalled()
    expect(storage.writes).toEqual([])
    expect(payload.settings.aiServices.mermaidFix.enabled).toBe(false)
  })

  it('aiServices 的非 assist 本地键仍作为客户端偏好保存', async () => {
    const { storage, payload } = await saveMutation((settings) => {
      settings.aiServices.localOnly = { enabled: true }
    })

    expect(storage.set).toHaveBeenCalled()
    expect(storage.writes).toEqual([SPLIT_META_KEY])
    expect(payload.settings.aiServices.localOnly).toEqual({ enabled: true })
  })
})

describe('客户端偏好保存/重载·重启读回', () => {
  it('重启后 composerModelShowProvider 仍为 true', async () => {
    const { storage } = await saveMutation((settings) => {
      settings.composerModelShowProvider = true
    })

    const data = await reloadAfterSave(storage)
    expect(data.settings.composerModelShowProvider).toBe(true)
  })

  it('重启后 branchTree.dir 仍为 tb', async () => {
    const { storage } = await saveMutation((settings) => {
      settings.branchTree.dir = 'tb'
    })

    const data = await reloadAfterSave(storage)
    expect(data.settings.branchTree.dir).toBe('tb')
  })

  it('重启后 aiServices 的非 assist 本地键仍存在', async () => {
    const { storage } = await saveMutation((settings) => {
      settings.aiServices.localOnly = { enabled: true }
    })

    const data = await reloadAfterSave(storage)
    expect(data.settings.aiServices.localOnly).toEqual({ enabled: true })
  })

  it('重启后 assist 子键不会被客户端偏好回灌', async () => {
    const { storage } = await saveMutation((settings) => {
      settings.aiServices.mermaidFix.enabled = true
    })

    const data = await reloadAfterSave(storage)
    // 未写盘：读回的仍是 meta/index 里的旧值，真实 assist 配置由业务端提供。
    expect(data.settings.aiServices.mermaidFix.enabled).toBe(false)
  })
})

describe('客户端偏好保存/重载·无变化不写盘', () => {
  it('未修改时调用 saveMetaOnly 不写盘', async () => {
    const storage = createHarness()
    const { split } = await loadShellData(storage)

    await split.saveMetaOnly()

    expect(storage.set).not.toHaveBeenCalled()
    expect(storage.writes).toEqual([])
  })
})
