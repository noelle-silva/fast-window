import { now, uid } from '../core/utils'
import { VERSION, SPLIT_SCHEMA_VERSION, CLIENT_PREFERENCES_KEY, SESSION_FAVORITES_KEY } from '../domain/constants'
import { normalizeData } from '../domain/dataNormalizers'
import { normalizeFavorites } from '../domain/favorites'
import {
  projectionOwnedSettings,
  PROJECTION_ASSIST_SETTING_KEYS,
  PROJECTION_TOP_LEVEL_NON_OWNED_SETTING_KEYS,
} from '../domain/projectionSettings'
import {
  splitRoleKey,
  splitChatKey,
  splitGroupKey,
  splitGroupChatKey,
  splitRoleChatIndexKey,
  splitGroupsIndexKey,
  splitGroupChatIndexKey,
  splitProviderKey,
  roleFolderName,
  groupFolderName,
  providerFolderName,
} from '../domain/storageKeys'
import {
  ClientPreferencesWriteBlockedError,
  createClientPreferencesSnapshot,
  overlayClientPreferences,
  preferencesOfRead,
  readClientPreferences,
  trustedClientPreferencesRead,
  type ClientPreferences,
  type ClientPreferencesRead,
  type ClientPreferencesReadStatus,
  type ClientPreferencesStorage,
} from './clientPreferences'
import { chatIndexKeyFor, loadSplitMetaSnapshot, normalizeStoredChatIndex } from './splitIndexes'
import { initializeStickerSettingsStorage } from './stickerSettingsPersistence'

function stringList(value: any): string[] {
  return Array.isArray(value) ? value.map((item: any) => String(item || '').trim()).filter(Boolean) : []
}

function stringMap(value: any): Record<string, string> {
  const src = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const out: Record<string, string> = {}
  for (const [key, raw] of Object.entries(src)) {
    const k = String(key || '').trim()
    const v = String(raw || '').trim()
    if (k && v) out[k] = v
  }
  return out
}

// 供应商目录是可选事实：历史草稿 / 幽灵条目可能只存在于 providerOrder，
// 没有任何 folder 记录。删除时必须同样把它们从目录里摘掉，而不是抛错。
export function removeProviderFromCatalog(meta: any, providerIdRaw: any) {
  const providerId = String(providerIdRaw || '').trim()
  const providerOrder = stringList(meta?.providerOrder).filter((id) => id !== providerId)
  const providerFolders = stringMap(meta?.providerFolders)
  const folder = String(providerFolders[providerId] || '').trim()
  if (folder) delete providerFolders[providerId]
  return { providerOrder, providerFolders, folder }
}

function uniqueFolder(baseRaw: string, used: Set<string>, id: string, prefix: string) {
  const base = String(baseRaw || prefix).trim() || prefix
  if (!used.has(base)) return base
  const tail = id.slice(Math.max(0, id.length - 8)) || uid(prefix)
  let folder = `${base}__${tail}`
  let suffix = 2
  while (used.has(folder)) folder = `${base}__${tail}_${suffix++}`
  return folder
}

async function writeRequired(storage: { set: (key: string, value: any) => Promise<any> }, key: string, value: any) {
  await storage.set(key, value)
}

async function removeRequired(storage: { remove: (key: string) => Promise<any> }, key: string) {
  await storage.remove(key)
}

const noop = async () => {}

// 未连接业务端时的外壳数据：形状与已加载数据一致，但没有业务内容。
// 客户端偏好来自独立的 client-state/preferences 通道，因此离线外壳也能
// 保留外观 / 字体 / 布局 / 壁纸 / 主题等本地设置。
export function createEmptyShellData(preferences?: ClientPreferences | null) {
  const view = overlayClientPreferences({ ui: {}, settings: {} }, preferences || null)
  return normalizeData({
    version: VERSION,
    settings: view.settings,
    favorites: {},
    roles: [],
    chatsByRole: {},
    groups: [],
    chatsByGroup: {},
    ui: view.ui,
  })
}

// createEmptyShellDataFromStorage 只读客户端偏好通道，不触碰 meta/index，
// 因此「未连接业务端」的启动路径不再依赖 eucli-box。
// 这里只产出归一化后的外壳数据；偏好基线与读取健康度归各 splitStorage
// 实例所有，由 loadClientPreferencesShell 负责登记。
export async function createEmptyShellDataFromStorage(storage: ClientPreferencesStorage) {
  return createEmptyShellData(preferencesOfRead(await readClientPreferences(storage)))
}

// createFactoryClientData 是「显式恢复默认」的唯一数据入口：
//   - ui 与投影自有 settings 回出厂默认；
//   - 业务派生的 providers / stickers 与 assist 视图原样保留，
//     避免重置瞬间把业务事实闪空；
//   - 角色 / 会话 / 收藏等业务数据完全不动。
export function createFactoryClientData(current: any): any {
  const source = current && typeof current === 'object' ? current : {}
  const factory = createEmptyShellData()
  const currentSettings =
    source.settings && typeof source.settings === 'object' && !Array.isArray(source.settings) ? source.settings : {}
  const nextSettings: Record<string, any> = { ...factory.settings }
  for (const key of PROJECTION_TOP_LEVEL_NON_OWNED_SETTING_KEYS) {
    if (currentSettings[key] !== undefined) nextSettings[key] = currentSettings[key]
  }
  const currentAiServices = currentSettings.aiServices
  if (currentAiServices && typeof currentAiServices === 'object' && !Array.isArray(currentAiServices)) {
    const nextAiServices: Record<string, any> = { ...(factory.settings.aiServices || {}) }
    for (const key of PROJECTION_ASSIST_SETTING_KEYS) {
      if (currentAiServices[key] !== undefined) nextAiServices[key] = currentAiServices[key]
    }
    nextSettings.aiServices = nextAiServices
  }
  return { ...source, ui: factory.ui, settings: nextSettings }
}

// canonicalJson 递归排序对象键，保证「语义相同、键序不同」的两份偏好
// 得到同一个指纹；数组保持原序。
function canonicalJson(value: any): string {
  if (value === null || typeof value !== 'object') {
    const text = JSON.stringify(value)
    return text === undefined ? 'null' : text
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  const keys = Object.keys(value).sort()
  const parts: string[] = []
  for (const key of keys) {
    if (value[key] === undefined) continue
    parts.push(`${JSON.stringify(key)}:${canonicalJson(value[key])}`)
  }
  return `{${parts.join(',')}}`
}

// preferenceFingerprint 只覆盖「客户端偏好」：ui + 投影自有 settings。
// 过滤名单的唯一事实源是 domain/projectionSettings，禁止在这里复制。
// 基线在读取成功、写入成功两个时刻更新，且只保存字符串，不保存对象。
function preferenceFingerprint(ui: any, settings: any) {
  return `${canonicalJson(ui)}|${canonicalJson(projectionOwnedSettings(settings))}`
}

// factoryPreferenceSnapshot 是「出厂偏好视图」的写盘形状：
// 必须与 saveMetaOnly 写前补全的 ui 键完全一致，否则默认值指纹会被
// activeGroupId / activeWorkspaceId 这类空字段误判成「用户已修改」。
let factoryPreferenceSnapshotCache: ClientPreferences | null = null
function factoryPreferenceSnapshot(): ClientPreferences {
  if (factoryPreferenceSnapshotCache === null) {
    const shell = createEmptyShellData()
    factoryPreferenceSnapshotCache = createClientPreferencesSnapshot(
      {
        ...shell.ui,
        activeRoleId: '',
        activeGroupId: '',
        activeWorkspaceId: '',
        activeTargetKind: 'role',
      },
      shell.settings,
    )
  }
  return factoryPreferenceSnapshotCache
}

// factoryPreferenceFingerprint 用于识别「内存里只剩默认值」的静默写入。
// 只计算一次：归一化结果不会被运行时修改。
let factoryPreferenceFingerprintCache: string | null = null
function factoryPreferenceFingerprint() {
  if (factoryPreferenceFingerprintCache === null) {
    const factory = factoryPreferenceSnapshot()
    factoryPreferenceFingerprintCache = preferenceFingerprint(factory.ui, factory.settings)
  }
  return factoryPreferenceFingerprintCache
}

const PREFERENCE_SELECTION_UI_KEYS = new Set(['activeRoleId', 'activeGroupId', 'activeWorkspaceId', 'activeTargetKind'])

// isFactoryPreferenceView 判断一份偏好是否「没有任何自定义内容」：
//   - 完整默认视图（归一化后）算出厂视图；
//   - 空 settings + 仅含默认选择键的空 ui 的暂行视图也算出厂视图。
// 该判定只用于保险丝，不参与正常保存的「是否变化」比较。
function isFactoryPreferenceView(preferences: ClientPreferences) {
  if (preferenceFingerprint(preferences.ui, preferences.settings) === factoryPreferenceFingerprint()) return true
  const ownedSettings = projectionOwnedSettings(preferences.settings)
  if (Object.keys(ownedSettings).length > 0) return false
  const uiKeys = Object.keys(preferences.ui)
  if (!uiKeys.every((key) => PREFERENCE_SELECTION_UI_KEYS.has(key))) return false
  const factory = factoryPreferenceSnapshot()
  return uiKeys.every((key) => canonicalJson(preferences.ui[key]) === canonicalJson(factory.ui[key]))
}


export function createSplitStorage(deps: {
  storage: { get: (k: string) => Promise<any>; set: (k: string, v: any) => Promise<void>; remove: (k: string) => Promise<void> }
  syncRoleAvatarFile?: (folder: any, role: any) => Promise<void>
  syncGroupAvatarFile?: (folder: any, group: any) => Promise<void>
  getState?: () => any
  // 整体 load 已删除（状态组装统一走 lazyChatStore.loadShell）。
  // 这两个字段仅保留给现有控制器装配，待控制器侧清理后移除。
  setState?: (data: any) => void
  onError?: (msg: string) => void
  // 会话索引已迁出 meta：任何会话索引失效都通知上层缓存作废。
  onSessionIndexInvalidated?: (kind: 'role' | 'group', targetId: string) => void
  // 目录事实（实体集合 / folder 映射）变化时通知上层作废目录缓存。
  onCatalogInvalidated?: () => void
  // activeChatId 是 UI 偏好命令，由上层注入；缺省时退化为最小索引写。
  setActiveChatCommand?: (kind: 'role' | 'group', targetId: string, chatId: string) => Promise<boolean>
}) {
  const {
    storage,
    syncRoleAvatarFile: _syncRoleAvatarFile = noop,
    syncGroupAvatarFile: _syncGroupAvatarFile = noop,
    getState,
    onSessionIndexInvalidated,
    onCatalogInvalidated,
    setActiveChatCommand,
  } = deps

  // 以下状态由本实例独占：同一进程内可能同时存在多个 splitStorage
  // （重连、测试、未来多窗口）。共享缓存会让一个实例的写入污染另一个
  // 实例的目录事实，共享写链会让彼此互相阻塞。
  let splitMetaCache: any = null
  // splitMetaWriteGeneration 标识「本实例的内存事实已被写入推进」。
  // 读盘是异步的：若一次读取早于某次写入发起、晚于它完成，盘面可能更旧，
  // 此时绝不能用旧快照覆盖已经提交的内存缓存。
  let splitMetaWriteGeneration = 0
  // splitMetaBaseline 是「本实例上次成功落盘的 ui + settings」的规范化指纹。
  // 它必须是不可变字符串，绝不能持有 state / 存储快照里的对象引用，
  // 否则内存一改，基线跟着变，「无变化不写盘」就会误判为相等。
  let splitMetaBaseline: string | null = null
  // preferenceReadState 记录「当前内存视图所依赖的那次读取」是否可信：
  // failed / invalid 得到的只是暂行视图，绝不能反向落盘。
  let preferenceReadState: ClientPreferencesReadStatus | 'unread' = 'unread'
  let splitMetaWriteChain: Promise<void> = Promise.resolve()
  let sessionFavoritesWriteChain: Promise<void> = Promise.resolve()

  // trackPreferenceRead 是读取状态登记的唯一入口：
  // 视图取值与健康度必须来自同一次读取结果。
  function trackPreferenceRead(read: ClientPreferencesRead): ClientPreferences | null {
    preferenceReadState = read.status
    return preferencesOfRead(read)
  }

  // rememberMetaSnapshot 是「内存快照 + 落盘基线」的唯一入口：
  // 两者必须同时基于同一份已隔离的深拷贝更新。
  function rememberMetaSnapshot(meta: any) {
    splitMetaCache = meta
    splitMetaBaseline = meta ? preferenceFingerprint(meta.ui, meta.settings) : null
  }

  // commitSplitMetaCache 是写入路径提交内存事实的唯一入口：
  // 推进代数，让读取期间发起的旧盘面回填失效。
  function commitSplitMetaCache(meta: any) {
    splitMetaWriteGeneration += 1
    splitMetaCache = meta
  }

  // getSplitMetaCache 是目录事实缓存的唯一读取入口。
  // 缓存由本模块的 load / 实体写入两条路径共同维护，控制器与投影管线
  // 只能通过它读取，禁止各自再维护一份可变副本。
  function getSplitMetaCache() {
    return splitMetaCache
  }

  async function loadSplitMeta() {
    const generation = splitMetaWriteGeneration
    const meta = await loadSplitMetaSnapshot(storage)
    // 目录 / 派生字段仍来自 meta；客户端偏好独立通道在读取边界叠加。
    // 读取结果同时登记健康度：failed / invalid 只允许形成暂行视图。
    const preferencesRead = await readClientPreferences(storage)
    // 读取期间有写入落地：盘面属于上一代，返回已经提交的内存事实。
    if (generation !== splitMetaWriteGeneration) return splitMetaCache
    const preferences = trackPreferenceRead(preferencesRead)
    const effective = meta ? { ...meta, ...overlayClientPreferences(meta, preferences) } : null
    rememberMetaSnapshot(effective)
    return effective
  }

  // loadClientPreferencesShell 是离线 / 未连接业务端启动的唯一入口：
  // 它和在线路径共享同一份读取状态与基线，因此失败读取只会得到暂行视图，
  // 不会被随后的 saveMetaOnly 当成「用户选择了默认值」写回盘面。
  async function loadClientPreferencesShell() {
    const preferencesRead = await readClientPreferences(storage)
    const preferences = trackPreferenceRead(preferencesRead)
    const data = createEmptyShellData(preferences)
    if (trustedClientPreferencesRead(preferencesRead)) {
      splitMetaBaseline = preferenceFingerprint(data.ui, data.settings)
    } else {
      splitMetaBaseline = null
    }
    return data
  }

  function withSplitMetaWrite<T>(fn: () => Promise<T>): Promise<T> {
    const run = () => Promise.resolve().then(fn)
    const p = splitMetaWriteChain.then(run, run) as Promise<T>
    splitMetaWriteChain = p.then(
      () => undefined,
      () => undefined,
    )
    return p
  }

  function invalidateSessionIndex(kind: 'role' | 'group', targetId: string) {
    onSessionIndexInvalidated?.(kind, targetId)
  }

  // activeChatId 是「用户选中了谁」，不是「索引变了」：
  // 这里只发偏好命令，绝不整包写 chats/<folder>/index。
  //
  // 一旦注入了 setActiveChatCommand，它就是唯一写入点（命令内部自己处理
  // 「后端不支持 → 迁移垫片」的分支）。这里绝不再补写一次索引：
  // 第二个 activeChatId 写入点会让两个来源互相覆盖。
  async function writeActiveSelection(kind: 'role' | 'group', targetId: string, chatId: string) {
    if (typeof setActiveChatCommand === 'function') {
      const applied = await setActiveChatCommand(kind, targetId, chatId)
      // 命令失败必须让调用方知道：这里不做「写不成就退回整包写索引」的兜底。
      if (!applied) throw new Error('切换会话偏好失败')
      return
    }
    const meta = (await loadSplitMeta()) || splitMetaCache
    if (!meta) throw new Error('存储未初始化')
    const folder = String((kind === 'group' ? meta.groupFolders : meta.roleFolders)?.[targetId] || '').trim()
    if (!folder) throw new Error(kind === 'group' ? '群组不存在' : '角色不存在')
    // 独立使用（无 controller 注入）时的最小写：只写 activeChatId 一个字段，
    // 后端只取这一格，不会覆盖 chatIds / chatMetas / updatedAt。
    await storage.set(chatIndexKeyFor({ kind, targetId }, folder), { activeChatId: chatId })
  }

  async function setActiveRoleChatSelection(roleIdRaw: any, chatIdRaw: any) {
    const roleId = String(roleIdRaw || '').trim()
    if (!roleId) return
    await writeActiveSelection('role', roleId, String(chatIdRaw || '').trim())
  }

  async function setActiveGroupChatSelection(groupIdRaw: any, chatIdRaw: any) {
    const groupId = String(groupIdRaw || '').trim()
    if (!groupId) return
    await writeActiveSelection('group', groupId, String(chatIdRaw || '').trim())
  }

  async function removeRoleChatEntry(roleIdRaw: any, chatIdRaw: any) {
    const roleId = String(roleIdRaw || '').trim()
    const chatId = String(chatIdRaw || '').trim()
    if (!roleId || !chatId) return
    await withSplitMetaWrite(async () => {
      const meta = (await loadSplitMeta()) || splitMetaCache
      if (!meta) throw new Error('存储未初始化')
      const folder = String(meta?.roleFolders?.[roleId] || '').trim()
      if (folder) await storage.remove(splitChatKey(folder, chatId)).catch(() => {})
      invalidateSessionIndex('role', roleId)
    })
  }

  async function removeGroupChatEntry(groupIdRaw: any, chatIdRaw: any) {
    const groupId = String(groupIdRaw || '').trim()
    const chatId = String(chatIdRaw || '').trim()
    if (!groupId || !chatId) return
    await withSplitMetaWrite(async () => {
      const meta = (await loadSplitMeta()) || splitMetaCache
      if (!meta) throw new Error('存储未初始化')
      const folder = String(meta?.groupFolders?.[groupId] || '').trim()
      if (folder) await storage.remove(splitGroupChatKey(folder, chatId)).catch(() => {})
      invalidateSessionIndex('group', groupId)
    })
  }

  async function saveGroupEntity(group: any) {
    const groupId = String(group?.id || '').trim()
    if (!groupId || !group || typeof group !== 'object') throw new Error('群组无效')

    await withSplitMetaWrite(async () => {
      const meta = (await loadSplitMeta()) || splitMetaCache
      if (!meta) throw new Error('存储未初始化')

      const groupOrder = stringList((meta as any).groupOrder)
      if (!groupOrder.includes(groupId)) groupOrder.unshift(groupId)

      const groupFolders = stringMap((meta as any).groupFolders)
      if (!groupFolders[groupId]) {
        groupFolders[groupId] = uniqueFolder(groupFolderName(group), new Set(Object.values(groupFolders)), groupId, 'group')
      }
      const folder = groupFolders[groupId]

      await writeRequired(storage, splitGroupKey(folder), group)
      await _syncGroupAvatarFile(folder, group)
      await writeRequired(storage, splitGroupsIndexKey(), { schemaVersion: SPLIT_SCHEMA_VERSION, updatedAt: now(), groupOrder, groupFolders })

      commitSplitMetaCache({ ...meta, groupOrder, groupFolders })
      onCatalogInvalidated?.()
    })
  }

  async function removeGroupEntity(groupIdRaw: any) {
    const groupId = String(groupIdRaw || '').trim()
    if (!groupId) throw new Error('群组无效')

    await withSplitMetaWrite(async () => {
      const meta = (await loadSplitMeta()) || splitMetaCache
      if (!meta) throw new Error('存储未初始化')

      const groupOrder = stringList((meta as any).groupOrder).filter((id) => id !== groupId)
      const groupFolders = stringMap((meta as any).groupFolders)
      const folder = groupFolders[groupId]
      if (!folder) throw new Error('群组不存在')

      const chatIds = await readScopeChatIds('group', groupId, folder)
      delete groupFolders[groupId]

      await removeRequired(storage, splitGroupKey(folder))
      await storage.remove(splitGroupChatIndexKey(folder)).catch(() => {})
      for (const chatId of chatIds) await storage.remove(splitGroupChatKey(folder, chatId)).catch(() => {})

      await writeRequired(storage, splitGroupsIndexKey(), { schemaVersion: SPLIT_SCHEMA_VERSION, updatedAt: now(), groupOrder, groupFolders })
      invalidateSessionIndex('group', groupId)
      commitSplitMetaCache({ ...meta, groupOrder, groupFolders })
      onCatalogInvalidated?.()
    })
  }

  async function saveRoleEntity(role: any) {
    const roleId = String(role?.id || '').trim()
    if (!roleId || !role || typeof role !== 'object') throw new Error('角色无效')

    await withSplitMetaWrite(async () => {
      const meta = (await loadSplitMeta()) || splitMetaCache
      if (!meta) throw new Error('存储未初始化')

      const roleFolders = stringMap(meta.roleFolders)
      if (!roleFolders[roleId]) {
        roleFolders[roleId] = uniqueFolder(roleFolderName(role), new Set(Object.values(roleFolders)), roleId, 'role')
      }
      const folder = roleFolders[roleId]

      await writeRequired(storage, splitRoleKey(folder), role)
      await _syncRoleAvatarFile(folder, role)

      commitSplitMetaCache({ ...meta, roleFolders })
      onCatalogInvalidated?.()
    })
  }

  async function removeRoleEntity(roleIdRaw: any) {
    const roleId = String(roleIdRaw || '').trim()
    if (!roleId) throw new Error('角色无效')

    await withSplitMetaWrite(async () => {
      const meta = (await loadSplitMeta()) || splitMetaCache
      if (!meta) throw new Error('存储未初始化')

      const roleFolders = stringMap(meta.roleFolders)
      const folder = roleFolders[roleId]
      if (!folder) throw new Error('角色不存在')

      const chatIds = await readScopeChatIds('role', roleId, folder)
      delete roleFolders[roleId]

      await removeRequired(storage, splitRoleKey(folder))
      await storage.remove(splitRoleChatIndexKey(folder)).catch(() => {})
      for (const chatId of chatIds) await storage.remove(splitChatKey(folder, chatId)).catch(() => {})

      invalidateSessionIndex('role', roleId)
      commitSplitMetaCache({ ...meta, roleFolders })
      onCatalogInvalidated?.()
    })
  }

  async function saveProviderEntity(provider: any) {
    const providerId = String(provider?.id || '').trim()
    if (!providerId || !provider || typeof provider !== 'object') throw new Error('供应商无效')

    await withSplitMetaWrite(async () => {
      const meta = (await loadSplitMeta()) || splitMetaCache
      if (!meta) throw new Error('存储未初始化')

      const providerOrder = stringList((meta as any).providerOrder)
      if (!providerOrder.includes(providerId)) providerOrder.unshift(providerId)

      const providerFolders = stringMap((meta as any).providerFolders)
      if (!providerFolders[providerId]) {
        providerFolders[providerId] = uniqueFolder(providerFolderName(provider), new Set(Object.values(providerFolders)), providerId, 'provider')
      }

      // 供应商实体走 providers/<folder>/provider：后端在这一步把 folder 映射
      // 收进投影配置，因此前端不再额外写 providers/index（那是一个无效写）。
      await writeRequired(storage, splitProviderKey(providerFolders[providerId]), provider)

      commitSplitMetaCache({ ...meta, providerOrder, providerFolders })
      onCatalogInvalidated?.()
    })
  }

  async function removeProviderEntity(providerIdRaw: any) {
    const providerId = String(providerIdRaw || '').trim()
    if (!providerId) throw new Error('供应商无效')

    await withSplitMetaWrite(async () => {
      const meta = (await loadSplitMeta()) || splitMetaCache
      if (!meta) throw new Error('存储未初始化')

      const { providerOrder, providerFolders, folder } = removeProviderFromCatalog(meta, providerId)
      if (folder) await removeRequired(storage, splitProviderKey(folder))

      commitSplitMetaCache({ ...meta, providerOrder, providerFolders })
      onCatalogInvalidated?.()
    })
  }

  // readScopeChatIds 只读一次 scope 索引，用于删除实体时清理会话文件。
  async function readScopeChatIds(kind: 'role' | 'group', targetId: string, folder: string) {
    const raw = await storage.get(chatIndexKeyFor({ kind, targetId }, folder)).catch(() => null)
    return normalizeStoredChatIndex(raw, { kind, targetId }, kind === 'group' ? '群聊' : '新聊天').chatIds
  }

  // ensureSplitStoreReady 只建立「客户端可用」的最小存储骨架：
  //   - sessions/favorites
  //   - 表情包设置
  //
  // meta/index 已降级为目录 / 派生字段的只读投影，由 studio 后端组装，
  // 前端绝不再预写空 meta；客户端偏好则走 client-state/preferences。
  // 不再预写 groups/index、providers/index：前者只在用户改群组顺序时写，
  // 后者已是纯派生物（顺序由业务端供应商列表决定）。
  async function ensureSplitStoreReady() {
    const meta = (await loadSplitMeta()) || splitMetaCache
    if (meta) return
    await initializeStickerSettingsStorage(storage)
    await storage.set(SESSION_FAVORITES_KEY, { folders: [], chatRefsByFolderId: {} })
  }

  // saveMetaOnly 的语义已经收敛为「保存客户端偏好」：
  //   - 只写 client-state/preferences（ui + 投影自有 settings）；
  //   - 不再写 meta/index，meta 只作为目录 / 派生字段的只读投影；
  //   - 切换会话不再产生一次偏好写；
  //   - 通道走本地状态区，因此保存不要求 eucli-box 连接。
  //
  // 写入遵循「基线双锁 + 空值保险丝」：
  //   1. 基线锁：只有与上次可信读取 / 成功写入的指纹不同才写盘；
  //   2. 读健康锁：本次内存视图若来自 failed / invalid 读取，禁止反向落盘；
  //   3. 空值保险丝：内存是出厂默认值、盘面却有历史有效偏好时，必须由用户
  //      在设置页显式「恢复默认」（explicitReset）才允许覆盖。
  //
  // 整个「读状态 → 比较 → 写盘 → 更新基线」都放进单一写链：
  // 连续保存按调用顺序执行，后一次能看到前一次落盘后的基线。
  async function saveMetaOnly(options: { explicitReset?: boolean } = {}) {
    return withSplitMetaWrite(async () => {
      const state = getState?.()
      if (!state?.data) return

      state.data.ui.activeRoleId = String(state.draft?.activeRoleId || '')
      ;(state.data.ui as any).activeGroupId = String(state.draft?.activeGroupId || '')
      ;(state.data.ui as any).activeWorkspaceId = String((state.draft as any)?.activeWorkspaceId || '')
      const targetKind = String(state.draft?.activeTargetKind || '').trim()
      ;(state.data.ui as any).activeTargetKind = targetKind === 'group' ? 'group' : targetKind === 'workspace' ? 'workspace' : 'role'

      // 写盘 payload 与指纹共用同一份「投影自有 settings」过滤：
      // providers / stickers / assist 子键都不进入偏好通道。
      const preferences = createClientPreferencesSnapshot(state.data.ui, state.data.settings)
      const fingerprint = preferenceFingerprint(preferences.ui, preferences.settings)
      const explicitReset = options.explicitReset === true

      // 只有 ui / 投影自有 settings 真的变了才写盘（显式重置也必须落盘）。
      if (!explicitReset && fingerprint === splitMetaBaseline) return

      if (!explicitReset) {
        // 写前必须亲自确认盘面：不得拿「内存暂行视图」直接覆盖盘上历史数据。
        const persistedRead = await readClientPreferences(storage)
        const persisted = preferencesOfRead(persistedRead)
        if (persistedRead.status === 'failed' || persistedRead.status === 'invalid') {
          throw new ClientPreferencesWriteBlockedError(
            '客户端偏好读取失败，已阻断覆盖写入以保护本地设置',
          )
        }

        const persistedView = persisted ? createEmptyShellData(persisted) : null
        if (persistedView) {
          const persistedFingerprint = preferenceFingerprint(persistedView.ui, persistedView.settings)
          // 内存与盘面语义等价：只是缺少基线，补齐即可，绝不产生写盘。
          if (fingerprint === persistedFingerprint) {
            splitMetaBaseline = fingerprint
            preferenceReadState = 'loaded'
            return
          }
        }

        // 只有真正要写盘时才需要读健康锁：failed / invalid 的暂行视图禁止落盘。
        if (preferenceReadState === 'failed' || preferenceReadState === 'invalid') {
          throw new ClientPreferencesWriteBlockedError(
            '客户端偏好尚未成功读取，已阻断用默认值覆盖本地设置',
          )
        }

        if (persistedView) {
          // 空值保险丝：默认值视图不得静默覆盖盘上历史偏好。
          if (isFactoryPreferenceView(preferences) && !isFactoryPreferenceView(persistedView)) {
            throw new ClientPreferencesWriteBlockedError(
              '当前客户端偏好为出厂默认值，已阻断覆盖历史设置；请在设置页显式恢复默认',
            )
          }
        } else if (isFactoryPreferenceView(preferences)) {
          // 首次运行：盘面没有偏好，内存也只是默认值，无需制造一次写盘。
          splitMetaBaseline = fingerprint
          preferenceReadState = 'missing'
          return
        }
      }

      // 写失败必须抛给调用方：基线保持不变，下一次仍会重试。
      await storage.set(CLIENT_PREFERENCES_KEY, preferences)
      splitMetaBaseline = fingerprint
      preferenceReadState = 'loaded'
      if (splitMetaCache) {
        const effective = overlayClientPreferences(splitMetaCache, preferences)
        commitSplitMetaCache({ ...splitMetaCache, ui: effective.ui, settings: effective.settings })
      }
    })
  }

  async function saveFavoritesOnly() {
    const state = getState?.()
    if (!state?.data) return
    const favorites = normalizeFavorites((state.data as any).favorites)
    const run = () => storage.set(SESSION_FAVORITES_KEY, favorites)
    const next = sessionFavoritesWriteChain.then(run, run)
    sessionFavoritesWriteChain = next.then(
      () => undefined,
      () => undefined,
    )
    await next
  }

  return {
    loadSplitMeta,
    loadClientPreferencesShell,
    getSplitMetaCache,
    withSplitMetaWrite,
    ensureSplitStoreReady,
    saveRoleEntity,
    removeRoleEntity,
    saveGroupEntity,
    removeGroupEntity,
    saveProviderEntity,
    removeProviderEntity,
    setActiveRoleChatSelection,
    removeRoleChatEntry,
    setActiveGroupChatSelection,
    removeGroupChatEntry,
    saveMetaOnly,
    saveFavoritesOnly,
  }
}
