import { now, uid } from '../core/utils'
import { VERSION, SPLIT_SCHEMA_VERSION, SPLIT_META_KEY, SESSION_FAVORITES_KEY } from '../domain/constants'
import { normalizeData } from '../domain/dataNormalizers'
import { normalizeFavorites } from '../domain/favorites'
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
import { chatIndexKeyFor, loadProvidersFromStorage, loadSplitMetaSnapshot, normalizeStoredChatIndex } from './splitIndexes'
import { initializeStickerSettingsStorage, loadStickerSettingsFromStorage } from './stickerSettingsPersistence'

let splitMetaCache: any = null
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
// 会话界面靠它保持可渲染，业务数据由连接成功后的正常加载路径填充。
export function createEmptyShellData() {
  return normalizeData({
    version: VERSION,
    settings: {},
    favorites: {},
    roles: [],
    chatsByRole: {},
    groups: [],
    chatsByGroup: {},
    ui: {},
  })
}

// sameMetaPayload 判断「这次 saveMetaOnly 是否真的有变化」。
// 只比较「客户端偏好」那部分：providers / stickers 是后端派生字段，
// 每次 meta() 都会重新组装，拿它们做比较会让每次保存都判定为「有变化」。
function sameMetaPayload(ui: any, settings: any, previous: any) {
  const normalize = (value: any) => {
    const source = value && typeof value === 'object' ? { ...value } : {}
    // providers / stickers 是后端派生字段：每次 meta() 都重新组装，
    // 拿它们做比较会让每次保存都判定为「有变化」。
    delete (source as any).stickers
    delete (source as any).providers
    const keys = Object.keys(source).sort()
    const out: Record<string, string> = {}
    for (const key of keys) out[key] = JSON.stringify((source as any)[key] ?? null)
    return JSON.stringify(out)
  }
  if (normalize(ui) !== normalize(previous?.ui)) return false
  return normalize(settings) === normalize(previous?.settings)
}

export function createSplitStorage(deps: {
  storage: { get: (k: string) => Promise<any>; set: (k: string, v: any) => Promise<void>; remove: (k: string) => Promise<void> }
  syncRoleAvatarFile?: (folder: any, role: any) => Promise<void>
  syncGroupAvatarFile?: (folder: any, group: any) => Promise<void>
  getState?: () => any
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
    setState,
    onError,
    onSessionIndexInvalidated,
    onCatalogInvalidated,
    setActiveChatCommand,
  } = deps

  async function loadSplitMeta() {
    const meta = await loadSplitMetaSnapshot(storage)
    splitMetaCache = meta
    return meta
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

      splitMetaCache = { ...meta, groupOrder, groupFolders }
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
      splitMetaCache = { ...meta, groupOrder, groupFolders }
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

      splitMetaCache = { ...meta, roleFolders }
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
      splitMetaCache = { ...meta, roleFolders }
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

      splitMetaCache = { ...meta, providerOrder, providerFolders }
      onCatalogInvalidated?.()
    })
  }

  async function removeProviderEntity(providerIdRaw: any) {
    const providerId = String(providerIdRaw || '').trim()
    if (!providerId) throw new Error('供应商无效')

    await withSplitMetaWrite(async () => {
      const meta = (await loadSplitMeta()) || splitMetaCache
      if (!meta) throw new Error('存储未初始化')

      const providerOrder = stringList((meta as any).providerOrder).filter((id) => id !== providerId)
      const providerFolders = stringMap((meta as any).providerFolders)
      const folder = providerFolders[providerId]
      if (!folder) throw new Error('供应商不存在')
      delete providerFolders[providerId]

      await removeRequired(storage, splitProviderKey(folder))

      splitMetaCache = { ...meta, providerOrder, providerFolders }
      onCatalogInvalidated?.()
    })
  }

  // readScopeChatIds 只读一次 scope 索引，用于删除实体时清理会话文件。
  async function readScopeChatIds(kind: 'role' | 'group', targetId: string, folder: string) {
    const raw = await storage.get(chatIndexKeyFor({ kind, targetId }, folder)).catch(() => null)
    return normalizeStoredChatIndex(raw, { kind, targetId }, kind === 'group' ? '群聊' : '新聊天').chatIds
  }

  async function loadSplitData() {
    const meta = (await loadSplitMeta()) || splitMetaCache
    if (!meta) return null

    let stickers = null
    try {
      stickers = await loadStickerSettingsFromStorage(storage)
    } catch (_) {
      stickers = null
    }

    let favorites = null
    try {
      favorites = await storage.get(SESSION_FAVORITES_KEY)
    } catch (_) {
      favorites = null
    }

    const providers = await loadProvidersFromStorage(storage, meta)

    const d = {
      version: VERSION,
      settings: meta.settings && typeof meta.settings === 'object' ? meta.settings : {},
      favorites: normalizeFavorites(favorites),
      roles: [] as any[],
      chatsByRole: {} as Record<string, any>,
      groups: [] as any[],
      chatsByGroup: {} as Record<string, any>,
      ui: meta.ui && typeof meta.ui === 'object' ? meta.ui : {},
    }

    ;(d.settings as any).stickers = stickers && typeof stickers === 'object' ? stickers : {}
    ;(d.settings as any).providers = providers

    for (const rid of meta.roleOrder) {
      const folder = String(meta.roleFolders?.[rid] || '')
      if (!folder) throw new Error('存储索引损坏：roleFolders 缺失')

      const r = await storage.get(splitRoleKey(folder))
      const role = r && typeof r === 'object' ? r : null
      if (!role) throw new Error('存储损坏：角色文件缺失或无效')

      d.roles.push(role)

      const idx = normalizeStoredChatIndex(
        await storage.get(splitRoleChatIndexKey(folder)).catch(() => null),
        { kind: 'role', targetId: rid },
        '新聊天',
      )
      d.chatsByRole[String(role.id || rid)] = {
        activeChatId: idx.activeChatId,
        chatMetas: idx.chatMetas,
        chats: [],
      }
    }

    for (const gid of (meta as any).groupOrder || []) {
      const folder = String((meta as any).groupFolders?.[gid] || '')
      if (!folder) throw new Error('存储索引损坏：groupFolders 缺失')

      const g0 = await storage.get(splitGroupKey(folder))
      const group = g0 && typeof g0 === 'object' ? g0 : null
      if (!group) throw new Error('存储损坏：群组文件缺失或无效')

      ;(d as any).groups.push(group)

      const idx = normalizeStoredChatIndex(
        await storage.get(splitGroupChatIndexKey(folder)).catch(() => null),
        { kind: 'group', targetId: gid },
        '群聊',
      )
      ;(d as any).chatsByGroup[String(group.id || gid)] = {
        activeChatId: idx.activeChatId,
        chatMetas: idx.chatMetas,
        chats: [],
      }
    }

    return normalizeData(d)
  }

  // ensureSplitStoreReady 只建立最小目录骨架：
  //   - meta/index（偏好 + 目录事实，后端 meta() 会补齐派生字段）
  //   - sessions/favorites
  //   - 表情包设置
  // 不再预写 groups/index、providers/index：前者只在用户改群组顺序时写，
  // 后者已是纯派生物（顺序由业务端供应商列表决定）。
  async function ensureSplitStoreReady() {
    const meta = (await loadSplitMeta()) || splitMetaCache
    if (meta) return
    const updatedAt = now()
    await initializeStickerSettingsStorage(storage)
    await storage.set(SESSION_FAVORITES_KEY, { folders: [], chatRefsByFolderId: {} })
    await writeRequired(storage, SPLIT_META_KEY, {
      schemaVersion: SPLIT_SCHEMA_VERSION,
      dataVersion: VERSION,
      updatedAt,
      ui: {},
      settings: {},
      roleOrder: [],
      roleFolders: {},
      groupOrder: [],
      groupFolders: {},
    })
    splitMetaCache = await loadSplitMetaSnapshot(storage)
  }

  // saveMetaOnly 只在 ui 真变化时写盘：
  //   - 切换会话不再产生一次 meta 写；
  //   - 不再 bump 全局 updatedAt（updatedAt 已降级为纯展示排序字段）。
  async function saveMetaOnly() {
    const state = getState?.()
    if (!state?.data) return

    state.data.ui.activeRoleId = String(state.draft?.activeRoleId || '')
    ;(state.data.ui as any).activeGroupId = String(state.draft?.activeGroupId || '')
    ;(state.data.ui as any).activeWorkspaceId = String((state.draft as any)?.activeWorkspaceId || '')
    const targetKind = String(state.draft?.activeTargetKind || '').trim()
    ;(state.data.ui as any).activeTargetKind = targetKind === 'group' ? 'group' : targetKind === 'workspace' ? 'workspace' : 'role'

    const old = splitMetaCache || (await loadSplitMeta())
    if (!old) throw new Error('存储未初始化')

    const nextUi = state.data.ui && typeof state.data.ui === 'object' ? state.data.ui : {}

    const settingsMeta = state.data.settings && typeof state.data.settings === 'object' ? { ...(state.data.settings as any) } : {}
    try {
      delete (settingsMeta as any).stickers
      delete (settingsMeta as any).providers
    } catch (_) {}

    // 只有 ui / settings 真的变了才写盘：切换会话不产生 meta 写。
    if (sameMetaPayload(nextUi, settingsMeta, old)) return

    // meta/index 只承载「客户端偏好」：ui + settings。
    // 目录事实（order / folder 映射）归各自的 index key，会话索引归各 scope，
    // 三者不再混在一份文档里，避免一次偏好写入顺带覆盖别的事实。
    //
    // updatedAt 原样保留：它已降级为纯展示排序字段，偏好写入不再 bump 它，
    // 否则任何一次 ui 改动都会让所有下游以为「整份数据变了」。
    const meta = {
      schemaVersion: SPLIT_SCHEMA_VERSION,
      dataVersion: VERSION,
      updatedAt: Number(old.updatedAt || 0) || now(),
      ui: nextUi,
      settings: settingsMeta,
    }

    await storage.set(SPLIT_META_KEY, meta)
    splitMetaCache = { ...old, ...meta }
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

  async function load() {
    const state = getState?.()
    try {
      await ensureSplitStoreReady()
      const split = await loadSplitData()
      if (!split) throw new Error('存储未初始化')
      setState?.(split)
      if (state) {
        state.draft.activeRoleId = String(split?.ui?.activeRoleId || '')
        state.draft.activeGroupId = String((split?.ui as any)?.activeGroupId || '')
        ;(state.draft as any).activeWorkspaceId = String((split?.ui as any)?.activeWorkspaceId || '')
        const targetKind = String((split?.ui as any)?.activeTargetKind || 'role').trim()
        state.draft.activeTargetKind = targetKind === 'group' ? 'group' : targetKind === 'workspace' ? 'workspace' : 'role'
      }
    } catch (e: any) {
      setState?.(null)
      if (state) {
        state.draft.activeRoleId = ''
        state.draft.activeGroupId = ''
        ;(state.draft as any).activeWorkspaceId = ''
        state.draft.activeTargetKind = 'role'
      }
      onError?.(String(e?.message || e || '加载失败'))
    } finally {
      if (state) state.loading = false
    }
  }

  async function save() {
    const state = getState?.()
    if (!state?.data) return
    state.data.ui.activeRoleId = String(state.draft?.activeRoleId || '')
    ;(state.data.ui as any).activeGroupId = String(state.draft?.activeGroupId || '')
    ;(state.data.ui as any).activeWorkspaceId = String((state.draft as any)?.activeWorkspaceId || '')
    const targetKind = String(state.draft?.activeTargetKind || '').trim()
    ;(state.data.ui as any).activeTargetKind = targetKind === 'group' ? 'group' : targetKind === 'workspace' ? 'workspace' : 'role'
    await saveMetaOnly()
  }

  return {
    loadSplitMeta,
    withSplitMetaWrite,
    loadSplitData,
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
    load,
    save,
  }
}
