import { now, uid } from '../core/utils'
import { VERSION, SPLIT_SCHEMA_VERSION, SPLIT_META_KEY, SESSION_FAVORITES_KEY } from '../domain/constants'
import { normalizeData } from '../domain/dataNormalizers'
import { normalizeFavorites } from '../domain/favorites'
import {
  splitRoleKey,
  splitChatKey,
  splitGroupKey,
  splitGroupChatKey,
  splitChatsIndexKey,
  splitRoleChatIndexKey,
  splitGroupsIndexKey,
  splitGroupChatIndexKey,
  splitProvidersIndexKey,
  splitProviderKey,
  roleFolderName,
  groupFolderName,
  providerFolderName,
} from '../domain/storageKeys'
import { loadProvidersFromStorage, loadSplitMetaSnapshot } from './splitIndexes'
import { updateStoredChatIndexEntry, type ChatIndexKind } from './chatIndexUpdater'
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

export function createSplitStorage(deps: {
  storage: { get: (k: string) => Promise<any>; set: (k: string, v: any) => Promise<void>; remove: (k: string) => Promise<void> }
  syncRoleAvatarFile?: (folder: any, role: any) => Promise<void>
  syncGroupAvatarFile?: (folder: any, group: any) => Promise<void>
  getState?: () => any
  setState?: (data: any) => void
  onError?: (msg: string) => void
}) {
  const {
    storage,
    syncRoleAvatarFile: _syncRoleAvatarFile = noop,
    syncGroupAvatarFile: _syncGroupAvatarFile = noop,
    getState,
    setState,
    onError,
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

  async function updateChatIndexEntry(kind: ChatIndexKind, targetId: any, chatId: any, patch: { chat?: any; updatedAt?: any; title?: any; remove?: boolean }) {
    await withSplitMetaWrite(async () => {
      const meta = (await loadSplitMeta()) || splitMetaCache
      const nextMeta = await updateStoredChatIndexEntry(storage, kind, targetId, chatId, patch, meta)
      splitMetaCache = nextMeta || meta
    })
  }

  async function touchChatUpdatedAt(roleId: any, chatId: any, updatedAt: any) {
    const rid = String(roleId || '').trim()
    const cid = String(chatId || '').trim()
    const ua0 = Number(updatedAt || 0)
    if (!rid || !cid) return

    await updateChatIndexEntry('role', rid, cid, { updatedAt: ua0 > 0 ? ua0 : now() })
  }

  async function touchGroupChatUpdatedAt(groupId: any, chatId: any, updatedAt: any) {
    const gid = String(groupId || '').trim()
    const cid = String(chatId || '').trim()
    const ua0 = Number(updatedAt || 0)
    if (!gid || !cid) return
    await updateChatIndexEntry('group', gid, cid, { updatedAt: ua0 > 0 ? ua0 : now() })
  }

  async function setActiveRoleChatSelection(roleIdRaw: any, chatIdRaw: any) {
    const roleId = String(roleIdRaw || '').trim()
    const chatId = String(chatIdRaw || '').trim()
    if (!roleId) return
    await withSplitMetaWrite(async () => {
      const meta = (await loadSplitMeta()) || splitMetaCache
      if (!meta) throw new Error('存储未初始化')
      const folder = String(meta?.roleFolders?.[roleId] || '').trim()
      if (!folder) throw new Error('角色不存在')
      const key = splitRoleChatIndexKey(folder)
      const idx0 = await storage.get(key).catch(() => null)
      const idx = idx0 && typeof idx0 === 'object'
        ? { ...idx0 }
        : { schemaVersion: SPLIT_SCHEMA_VERSION, roleId, roleFolder: folder, chatIds: [], chatUpdatedAt: {}, chatMetas: [] }
      ;(idx as any).activeChatId = chatId
      ;(idx as any).updatedAt = now()
      await storage.set(key, idx)
      const chatIndexByRole = { ...(meta.chatIndexByRole || {}) }
      chatIndexByRole[roleId] = { ...(chatIndexByRole[roleId] || {}), ...(idx as any) }
      splitMetaCache = { ...meta, chatIndexByRole }
    })
  }

  async function removeRoleChatEntry(roleIdRaw: any, chatIdRaw: any) {
    const roleId = String(roleIdRaw || '').trim()
    const chatId = String(chatIdRaw || '').trim()
    if (!roleId || !chatId) return
    await withSplitMetaWrite(async () => {
      const meta = (await loadSplitMeta()) || splitMetaCache
      if (!meta) throw new Error('存储未初始化')
      const nextMeta = await updateStoredChatIndexEntry(storage, 'role', roleId, chatId, { remove: true }, meta)
      const folder = String(meta?.roleFolders?.[roleId] || '').trim()
      if (folder) await storage.remove(splitChatKey(folder, chatId)).catch(() => {})
      splitMetaCache = nextMeta || meta
    })
  }

  async function setActiveGroupChatSelection(groupIdRaw: any, chatIdRaw: any) {
    const groupId = String(groupIdRaw || '').trim()
    const chatId = String(chatIdRaw || '').trim()
    if (!groupId) return
    await withSplitMetaWrite(async () => {
      const meta = (await loadSplitMeta()) || splitMetaCache
      if (!meta) throw new Error('存储未初始化')
      const folder = String((meta as any)?.groupFolders?.[groupId] || '').trim()
      if (!folder) throw new Error('群组不存在')
      const key = splitGroupChatIndexKey(folder)
      const idx0 = await storage.get(key).catch(() => null)
      const idx = idx0 && typeof idx0 === 'object'
        ? { ...idx0 }
        : { schemaVersion: SPLIT_SCHEMA_VERSION, groupId, groupFolder: folder, activeChatId: '', chatIds: [], chatUpdatedAt: {}, chatMetas: [] }
      ;(idx as any).activeChatId = chatId
      ;(idx as any).updatedAt = now()
      await storage.set(key, idx)
      const chatIndexByGroup = { ...((meta as any).chatIndexByGroup || {}) }
      chatIndexByGroup[groupId] = { ...(chatIndexByGroup[groupId] || {}), ...(idx as any) }
      splitMetaCache = { ...meta, chatIndexByGroup }
    })
  }

  async function removeGroupChatEntry(groupIdRaw: any, chatIdRaw: any) {
    const groupId = String(groupIdRaw || '').trim()
    const chatId = String(chatIdRaw || '').trim()
    if (!groupId || !chatId) return
    await withSplitMetaWrite(async () => {
      const meta = (await loadSplitMeta()) || splitMetaCache
      if (!meta) throw new Error('存储未初始化')
      const nextMeta = await updateStoredChatIndexEntry(storage, 'group', groupId, chatId, { remove: true }, meta)
      const folder = String((meta as any)?.groupFolders?.[groupId] || '').trim()
      if (folder) await storage.remove(splitGroupChatKey(folder, chatId)).catch(() => {})
      splitMetaCache = nextMeta || meta
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

      const chatIndexByGroup = { ...((meta as any).chatIndexByGroup || {}) }
      const oldIndex = chatIndexByGroup[groupId] || {}
      delete chatIndexByGroup[groupId]
      delete groupFolders[groupId]

      await removeRequired(storage, splitGroupKey(folder))
      await storage.remove(splitGroupChatIndexKey(folder)).catch(() => {})
      for (const chatId of stringList(oldIndex.chatIds)) await storage.remove(splitGroupChatKey(folder, chatId)).catch(() => {})
      await writeRequired(storage, splitGroupsIndexKey(), { schemaVersion: SPLIT_SCHEMA_VERSION, updatedAt: now(), groupOrder, groupFolders })

      splitMetaCache = { ...meta, groupOrder, groupFolders, chatIndexByGroup }
    })
  }

  async function saveRoleEntity(role: any) {
    const roleId = String(role?.id || '').trim()
    if (!roleId || !role || typeof role !== 'object') throw new Error('角色无效')

    await withSplitMetaWrite(async () => {
      const meta = (await loadSplitMeta()) || splitMetaCache
      if (!meta) throw new Error('存储未初始化')

      const roleOrder = stringList(meta.roleOrder)
      if (!roleOrder.includes(roleId)) roleOrder.unshift(roleId)

      const roleFolders = stringMap(meta.roleFolders)
      if (!roleFolders[roleId]) {
        roleFolders[roleId] = uniqueFolder(roleFolderName(role), new Set(Object.values(roleFolders)), roleId, 'role')
      }
      const folder = roleFolders[roleId]

      await writeRequired(storage, splitRoleKey(folder), role)
      await _syncRoleAvatarFile(folder, role)
      await writeRequired(storage, splitChatsIndexKey(), { schemaVersion: SPLIT_SCHEMA_VERSION, updatedAt: now(), roleOrder, roleFolders })

      splitMetaCache = { ...meta, roleOrder, roleFolders }
    })
  }

  async function removeRoleEntity(roleIdRaw: any) {
    const roleId = String(roleIdRaw || '').trim()
    if (!roleId) throw new Error('角色无效')

    await withSplitMetaWrite(async () => {
      const meta = (await loadSplitMeta()) || splitMetaCache
      if (!meta) throw new Error('存储未初始化')

      const roleOrder = stringList(meta.roleOrder).filter((id) => id !== roleId)
      const roleFolders = stringMap(meta.roleFolders)
      const folder = roleFolders[roleId]
      if (!folder) throw new Error('角色不存在')

      const chatIndexByRole = { ...(meta.chatIndexByRole || {}) }
      const oldIndex = chatIndexByRole[roleId] || {}
      delete chatIndexByRole[roleId]
      delete roleFolders[roleId]

      await removeRequired(storage, splitRoleKey(folder))
      await storage.remove(splitRoleChatIndexKey(folder)).catch(() => {})
      for (const chatId of stringList(oldIndex.chatIds)) await storage.remove(splitChatKey(folder, chatId)).catch(() => {})
      await writeRequired(storage, splitChatsIndexKey(), { schemaVersion: SPLIT_SCHEMA_VERSION, updatedAt: now(), roleOrder, roleFolders })

      splitMetaCache = { ...meta, roleOrder, roleFolders, chatIndexByRole }
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

      await writeRequired(storage, splitProvidersIndexKey(), { schemaVersion: SPLIT_SCHEMA_VERSION, updatedAt: now(), providerOrder, providerFolders })
      await writeRequired(storage, splitProviderKey(providerFolders[providerId]), provider)

      splitMetaCache = { ...meta, providerOrder, providerFolders }
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
      await writeRequired(storage, splitProvidersIndexKey(), { schemaVersion: SPLIT_SCHEMA_VERSION, updatedAt: now(), providerOrder, providerFolders })

      splitMetaCache = { ...meta, providerOrder, providerFolders }
    })
  }

  async function saveRoleOrder(roleIdsRaw: any) {
    const roleIds = stringList(roleIdsRaw)
    await withSplitMetaWrite(async () => {
      const meta = (await loadSplitMeta()) || splitMetaCache
      if (!meta) throw new Error('存储未初始化')
      const roleFolders = stringMap(meta.roleFolders)
      const known = new Set(Object.keys(roleFolders))
      const filtered = roleIds.filter((id) => known.has(id))
      const remaining = stringList(meta.roleOrder).filter((id) => !filtered.includes(id) && known.has(id))
      const roleOrder = filtered.concat(remaining)
      await writeRequired(storage, splitChatsIndexKey(), { schemaVersion: SPLIT_SCHEMA_VERSION, updatedAt: now(), roleOrder, roleFolders })
      splitMetaCache = { ...meta, roleOrder, roleFolders }
    })
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

      const idx = meta.chatIndexByRole?.[rid]
      const box = idx && typeof idx === 'object' ? idx : {}
      const activeChatId = String(box.activeChatId || '')
      const chatIds = Array.isArray(box.chatIds) ? box.chatIds.map((x: any) => String(x || '')).filter((x: any) => !!x) : []

      const chats = []
      for (const cid of chatIds) {
        const c0 = await storage.get(splitChatKey(folder, cid))
        const c = c0 && typeof c0 === 'object' ? c0 : null
        if (!c) throw new Error('存储损坏：会话文件缺失或无效')
        chats.push(c)
      }

      d.chatsByRole[String(role.id || rid)] = {
        activeChatId,
        chats,
      }
    }

    for (const gid of (meta as any).groupOrder || []) {
      const folder = String((meta as any).groupFolders?.[gid] || '')
      if (!folder) throw new Error('存储索引损坏：groupFolders 缺失')

      const g0 = await storage.get(splitGroupKey(folder))
      const group = g0 && typeof g0 === 'object' ? g0 : null
      if (!group) throw new Error('存储损坏：群组文件缺失或无效')

      ;(d as any).groups.push(group)

      const idx = (meta as any).chatIndexByGroup?.[gid]
      const box = idx && typeof idx === 'object' ? idx : {}
      const activeChatId = String((box as any).activeChatId || '')
      const chatIds = Array.isArray((box as any).chatIds) ? (box as any).chatIds.map((x: any) => String(x || '')).filter((x: any) => !!x) : []

      const chats = []
      for (const cid of chatIds) {
        const c0 = await storage.get(splitGroupChatKey(folder, cid))
        const c = c0 && typeof c0 === 'object' ? c0 : null
        if (!c) throw new Error('存储损坏：群聊会话文件缺失或无效')
        chats.push(c)
      }

      ;(d as any).chatsByGroup[String(group.id || gid)] = { activeChatId, chats }
    }

    return normalizeData(d)
  }

  async function ensureSplitStoreReady() {
    const meta = (await loadSplitMeta()) || splitMetaCache
    if (meta) return
    const updatedAt = now()
    await initializeStickerSettingsStorage(storage)
    await storage.set(SESSION_FAVORITES_KEY, { folders: [], chatRefsByFolderId: {} })
    await writeRequired(storage, splitChatsIndexKey(), {
      schemaVersion: SPLIT_SCHEMA_VERSION,
      updatedAt,
      roleOrder: [],
      roleFolders: {},
    })
    await writeRequired(storage, splitGroupsIndexKey(), {
      schemaVersion: SPLIT_SCHEMA_VERSION,
      updatedAt,
      groupOrder: [],
      groupFolders: {},
    })
    await writeRequired(storage, splitProvidersIndexKey(), {
      schemaVersion: SPLIT_SCHEMA_VERSION,
      updatedAt,
      providerOrder: [],
      providerFolders: {},
    })
    await writeRequired(storage, SPLIT_META_KEY, {
      schemaVersion: SPLIT_SCHEMA_VERSION,
      dataVersion: VERSION,
      updatedAt,
      ui: {},
      settings: {},
      roleOrder: [],
      roleFolders: {},
      chatIndexByRole: {},
      groupOrder: [],
      groupFolders: {},
      chatIndexByGroup: {},
    })
    splitMetaCache = await loadSplitMetaSnapshot(storage)
  }

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

    const settingsMeta = state.data.settings && typeof state.data.settings === 'object' ? { ...(state.data.settings as any) } : {}
    try {
      delete (settingsMeta as any).stickers
      delete (settingsMeta as any).providers
    } catch (_) {}

    const meta = {
      schemaVersion: SPLIT_SCHEMA_VERSION,
      dataVersion: VERSION,
      updatedAt: now(),
      ui: state.data.ui && typeof state.data.ui === 'object' ? state.data.ui : {},
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
    touchChatUpdatedAt,
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
    saveRoleOrder,
    touchGroupChatUpdatedAt,
    saveMetaOnly,
    saveFavoritesOnly,
    load,
    save,
  }
}
