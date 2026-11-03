import { now, uid } from '../core/utils'
import { VERSION, SPLIT_SCHEMA_VERSION, CLIENT_PREFERENCES_KEY, SESSION_FAVORITES_KEY } from '../domain/constants'
import { normalizeData } from '../domain/dataNormalizers'
import { normalizeFavorites } from '../domain/favorites'
import { projectionOwnedSettings } from '../domain/projectionSettings'
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
  createClientPreferencesSnapshot,
  overlayClientPreferences,
  readClientPreferences,
  type ClientPreferences,
  type ClientPreferencesStorage,
} from './clientPreferences'
import { chatIndexKeyFor, loadSplitMetaSnapshot, normalizeStoredChatIndex } from './splitIndexes'
import { initializeStickerSettingsStorage } from './stickerSettingsPersistence'

let splitMetaCache: any = null
// splitMetaWriteGeneration 标识「内存事实已被写入推进」。
// 读盘是异步的：若一次读取早于某次写入发起、晚于它完成，盘面可能更旧，
// 此时绝不能用旧快照覆盖已经提交的内存缓存。
let splitMetaWriteGeneration = 0
// splitMetaBaseline 是「上次成功落盘的 ui + settings」的规范化指纹。
// 它必须是不可变字符串，绝不能持有 state / 存储快照里的对象引用，
// 否则内存一改，基线跟着变，「无变化不写盘」就会误判为相等。
let splitMetaBaseline: string | null = null
let splitMetaWriteChain: Promise<void> = Promise.resolve()
let sessionFavoritesWriteChain: Promise<void> = Promise.resolve()

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
export async function createEmptyShellDataFromStorage(storage: ClientPreferencesStorage) {
  const data = createEmptyShellData(await readClientPreferences(storage))
  // 离线外壳的「当前视图」就是偏好基线：归一化补出的默认值不应在
  // 第一次无改动保存时被误判成用户变更。
  splitMetaBaseline = preferenceFingerprint(data.ui, data.settings)
  return data
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
    // 叠加发生在 cache / 基线之前，所以「无变化不写盘」比较的是
    // 用户真正看到的偏好，而不是 meta 里可能为空的占位值。
    const preferences = meta ? await readClientPreferences(storage) : null
    const effective = meta ? { ...meta, ...overlayClientPreferences(meta, preferences) } : null
    // 读取期间有写入落地：盘面属于上一代，返回已经提交的内存事实。
    if (generation !== splitMetaWriteGeneration) return splitMetaCache
    rememberMetaSnapshot(effective)
    return effective
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
  // 整个「读状态 → 比较 → 写盘 → 更新基线」都放进单一写链：
  // 连续保存按调用顺序执行，后一次能看到前一次落盘后的基线。
  async function saveMetaOnly() {
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

      // 基线尚未建立时，本地读一次偏好通道（不读 meta、不需要业务连接）。
      // 通道缺失时基线保持 null：第一次保存必须落盘。
      if (splitMetaBaseline === null) {
        const persisted = await readClientPreferences(storage)
        if (persisted) splitMetaBaseline = preferenceFingerprint(persisted.ui, persisted.settings)
      }
      // 只有 ui / 投影自有 settings 真的变了才写盘。
      if (fingerprint === splitMetaBaseline) return

      // 写失败必须抛给调用方：基线保持不变，下一次仍会重试。
      await storage.set(CLIENT_PREFERENCES_KEY, preferences)
      splitMetaBaseline = fingerprint
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
