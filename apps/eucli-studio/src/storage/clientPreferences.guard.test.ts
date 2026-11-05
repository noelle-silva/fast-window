import { describe, expect, it, vi } from 'vitest'
import { CLIENT_PREFERENCES_KEY, SPLIT_META_KEY, SPLIT_SCHEMA_VERSION, VERSION } from '../domain/constants'
import {
  ClientPreferencesWriteBlockedError,
  readClientPreferences,
} from './clientPreferences'
import { createEmptyShellData, createSplitStorage } from './splitStorage'

const UI_BASE = {
  activeRoleId: '',
  activeGroupId: '',
  activeWorkspaceId: '',
  activeTargetKind: 'role',
}

function metaDoc(ui: Record<string, any> = UI_BASE, settings: Record<string, any> = {}) {
  return {
    schemaVersion: SPLIT_SCHEMA_VERSION,
    dataVersion: VERSION,
    updatedAt: 1,
    ui: JSON.parse(JSON.stringify(ui)),
    settings: JSON.parse(JSON.stringify(settings)),
    roleOrder: [],
    roleFolders: {},
    groupOrder: [],
    groupFolders: {},
  }
}

function clone<T>(value: T): T {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

function memoryStorage(initial: Record<string, any>) {
  const values: Record<string, any> = clone(initial)
  const writes: string[] = []
  let preferencesReadError: unknown = null
  return {
    values,
    writes,
    failPreferenceReads(error: unknown) {
      preferencesReadError = error
    },
    recoverPreferenceReads() {
      preferencesReadError = null
    },
    get: vi.fn(async (key: string) => {
      if (key === CLIENT_PREFERENCES_KEY && preferencesReadError) throw preferencesReadError
      return clone(values[key] ?? null)
    }),
    set: vi.fn(async (key: string, value: any) => {
      writes.push(key)
      values[key] = clone(value)
    }),
    remove: vi.fn(async (key: string) => {
      delete values[key]
    }),
  }
}

function makeState(data: any, draft: Record<string, any> = { ...UI_BASE }) {
  return { data, draft: { ...draft }, loading: false }
}

function loadedPreferences() {
  return {
    ui: { ...UI_BASE, sidebarWidth: 421 },
    settings: {
      chatFontSize: 19,
      chatFontFamily: 'Consolas',
      chatLetterSpacing: 2,
      chatLineHeight: 2,
      chatBgOpacity: 42,
      wallpaper: {
        enabled: true,
        activeId: 'w2',
        presets: [{ id: 'w2', relPath: 'wallpapers/w2.webp', view: { x: 50, y: 50, scale: 1 } }],
      },
      colorTheme: { activePresetId: 'sakura-night', importedPresets: [] },
    },
  }
}

describe('readClientPreferences：读取语义必须可区分', () => {
  it('抛错是 failed，不是 missing', async () => {
    const result = await readClientPreferences({
      get: async () => {
        throw new Error('file locked')
      },
    })
    expect(result).toMatchObject({ status: 'failed' })
  })

  it('通道不存在是 missing', async () => {
    await expect(readClientPreferences({ get: async () => null })).resolves.toEqual({ status: 'missing' })
  })

  it('通道形状损坏是 invalid', async () => {
    await expect(readClientPreferences({ get: async () => ['bad'] })).resolves.toEqual({ status: 'invalid' })
  })

  it('有效偏好是 loaded', async () => {
    const result = await readClientPreferences({ get: async () => loadedPreferences() })
    expect(result.status).toBe('loaded')
    if (result.status === 'loaded') expect(result.preferences.ui.sidebarWidth).toBe(421)
  })
})

describe('客户端偏好写入熔断闸门', () => {
  it('启动读取失败后，后续保存不得用默认值覆盖盘上历史偏好', async () => {
    const original = loadedPreferences()
    const storage = memoryStorage({
      [SPLIT_META_KEY]: metaDoc(),
      [CLIENT_PREFERENCES_KEY]: original,
    })
    storage.failPreferenceReads(new Error('file locked'))
    const state = makeState(createEmptyShellData())
    const store = createSplitStorage({ storage, getState: () => state })

    await store.loadSplitMeta()
    storage.writes.length = 0

    // 文件锁解除后，用户改了一个设置；此时如果直接落盘会整包覆盖历史偏好。
    storage.recoverPreferenceReads()
    state.data.settings.chatFontSize = 30

    await expect(store.saveMetaOnly()).rejects.toBeInstanceOf(ClientPreferencesWriteBlockedError)
    expect(storage.writes).toEqual([])
    expect(storage.values[CLIENT_PREFERENCES_KEY]).toEqual(original)
  })

  it('离线外壳读取失败时，保存同样被阻断', async () => {
    const original = loadedPreferences()
    const storage = memoryStorage({ [CLIENT_PREFERENCES_KEY]: original })
    storage.failPreferenceReads(new Error('file locked'))
    const state = makeState(createEmptyShellData())
    const store = createSplitStorage({ storage, getState: () => state })

    const shell = await store.loadClientPreferencesShell()
    state.data = shell
    storage.recoverPreferenceReads()
    storage.writes.length = 0
    state.data.settings.chatFontSize = 30

    await expect(store.saveMetaOnly()).rejects.toBeInstanceOf(ClientPreferencesWriteBlockedError)
    expect(storage.writes).toEqual([])
    expect(storage.values[CLIENT_PREFERENCES_KEY]).toEqual(original)
  })

  it('内存是出厂默认值、盘面有历史偏好时，静默保存被阻断', async () => {
    const original = loadedPreferences()
    const storage = memoryStorage({ [CLIENT_PREFERENCES_KEY]: original })
    const state = makeState(createEmptyShellData())
    const store = createSplitStorage({ storage, getState: () => state })

    await expect(store.saveMetaOnly()).rejects.toBeInstanceOf(ClientPreferencesWriteBlockedError)
    expect(storage.writes).toEqual([])
    expect(storage.values[CLIENT_PREFERENCES_KEY]).toEqual(original)
  })

  it('显式恢复默认才允许覆盖盘上历史偏好', async () => {
    const storage = memoryStorage({ [CLIENT_PREFERENCES_KEY]: loadedPreferences() })
    const state = makeState(createEmptyShellData())
    const store = createSplitStorage({ storage, getState: () => state })

    await store.saveMetaOnly({ explicitReset: true })

    const factory = createEmptyShellData()
    expect(storage.writes).toEqual([CLIENT_PREFERENCES_KEY])
    expect(storage.values[CLIENT_PREFERENCES_KEY].settings.chatFontSize).toBe(factory.settings.chatFontSize)
    expect(storage.values[CLIENT_PREFERENCES_KEY].settings.wallpaper.presets).toEqual([])
  })

  it('首次运行（盘面没有偏好）允许保存用户改动', async () => {
    const storage = memoryStorage({ [SPLIT_META_KEY]: metaDoc() })
    const state = makeState(createEmptyShellData())
    state.data.settings.chatFontSize = 30
    const store = createSplitStorage({ storage, getState: () => state })

    await store.saveMetaOnly()

    expect(storage.writes).toEqual([CLIENT_PREFERENCES_KEY])
    expect(storage.values[CLIENT_PREFERENCES_KEY].settings.chatFontSize).toBe(30)
  })

  it('读取失败时即使没有用户改动也不产生写盘', async () => {
    const storage = memoryStorage({ [CLIENT_PREFERENCES_KEY]: loadedPreferences() })
    storage.failPreferenceReads(new Error('file locked'))
    const state = makeState(createEmptyShellData())
    const store = createSplitStorage({ storage, getState: () => state })

    await expect(store.saveMetaOnly()).rejects.toBeInstanceOf(ClientPreferencesWriteBlockedError)

    expect(storage.writes).toEqual([])
  })
})
