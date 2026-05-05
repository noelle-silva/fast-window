import { now } from '../core/utils'
import { SPLIT_META_KEY, SPLIT_SCHEMA_VERSION } from '../domain/constants'
import { normalizeChatMetas } from '../domain/chatMeta'
import { normalizeSplitMeta } from '../domain/dataNormalizers'
import {
  splitChatsIndexKey,
  splitRoleChatIndexKey,
  splitGroupsIndexKey,
  splitGroupChatIndexKey,
  splitProvidersIndexKey,
  splitProviderKey,
} from '../domain/storageKeys'

export type SplitStorageReader = {
  get: (key: string) => Promise<any>
}

function objectOrEmpty(value: any): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function stringList(value: any): string[] {
  return Array.isArray(value) ? value.map((x: any) => String(x || '').trim()).filter(Boolean) : []
}

function stringMap(value: any): Record<string, string> {
  const src = objectOrEmpty(value)
  const out: Record<string, string> = {}
  for (const [key, raw] of Object.entries(src)) {
    const k = String(key || '').trim()
    const v = String(raw || '').trim()
    if (k && v) out[k] = v
  }
  return out
}

function maxUpdatedAt(...items: any[]): number {
  let out = 0
  for (const item of items) {
    const n = Number(item || 0)
    if (Number.isFinite(n) && n > out) out = n
  }
  return out
}

async function readObject(storage: SplitStorageReader, key: string): Promise<Record<string, any>> {
  try {
    const value = await storage.get(key)
    return objectOrEmpty(value)
  } catch (_) {
    return {}
  }
}

export async function loadProvidersFromStorage(storage: SplitStorageReader, metaOverride?: any): Promise<any[]> {
  const index = await readObject(storage, splitProvidersIndexKey())
  const providerOrder = stringList(index.providerOrder)
  const providerFolders = stringMap(index.providerFolders)

  if (!providerOrder.length && metaOverride?.settings && Array.isArray(metaOverride.settings.providers)) {
    return metaOverride.settings.providers.filter((x: any) => x && typeof x === 'object')
  }

  const providers: any[] = []
  for (const providerId of providerOrder) {
    const folder = providerFolders[providerId]
    if (!folder) continue
    const provider = await readObject(storage, splitProviderKey(folder))
    if (!provider || !Object.keys(provider).length) continue
    providers.push(provider)
  }
  return providers
}

export async function loadSplitMetaSnapshot(storage: SplitStorageReader) {
  const raw = await storage.get(SPLIT_META_KEY)
  if (raw == null) return null
  const meta = normalizeSplitMeta(raw)
  if (!meta) throw new Error('存储索引损坏：meta/index 格式不正确')

  const chatsIndex = await readObject(storage, splitChatsIndexKey())
  const roleOrder = stringList(chatsIndex.roleOrder).length ? stringList(chatsIndex.roleOrder) : stringList(meta.roleOrder)
  const roleFolders = Object.keys(stringMap(chatsIndex.roleFolders)).length ? stringMap(chatsIndex.roleFolders) : stringMap(meta.roleFolders)
  const chatIndexByRole: Record<string, any> = {}

  let updatedAt = maxUpdatedAt(meta.updatedAt, chatsIndex.updatedAt)
  for (const roleId of roleOrder) {
    const folder = roleFolders[roleId]
    if (!folder) continue
    const idx = await readObject(storage, splitRoleChatIndexKey(folder))
    chatIndexByRole[roleId] = {
      activeChatId: String(idx.activeChatId || ''),
      chatIds: stringList(idx.chatIds),
      chatUpdatedAt: objectOrEmpty(idx.chatUpdatedAt),
      chatMetas: normalizeChatMetas(idx.chatMetas, idx.chatIds, idx.chatUpdatedAt, '新聊天'),
    }
    updatedAt = maxUpdatedAt(updatedAt, idx.updatedAt)
  }

  const groupsIndex = await readObject(storage, splitGroupsIndexKey())
  const groupOrder = stringList(groupsIndex.groupOrder)
  const groupFolders = stringMap(groupsIndex.groupFolders)
  const chatIndexByGroup: Record<string, any> = {}
  updatedAt = maxUpdatedAt(updatedAt, groupsIndex.updatedAt)

  for (const groupId of groupOrder) {
    const folder = groupFolders[groupId]
    if (!folder) continue
    const idx = await readObject(storage, splitGroupChatIndexKey(folder))
    chatIndexByGroup[groupId] = {
      activeChatId: String(idx.activeChatId || ''),
      chatIds: stringList(idx.chatIds),
      chatUpdatedAt: objectOrEmpty(idx.chatUpdatedAt),
      chatMetas: normalizeChatMetas(idx.chatMetas, idx.chatIds, idx.chatUpdatedAt, '群聊'),
    }
    updatedAt = maxUpdatedAt(updatedAt, idx.updatedAt)
  }

  const providersIndex = await readObject(storage, splitProvidersIndexKey())

  return {
    ...meta,
    schemaVersion: SPLIT_SCHEMA_VERSION,
    updatedAt: updatedAt || now(),
    roleOrder,
    roleFolders,
    chatIndexByRole,
    groupOrder,
    groupFolders,
    chatIndexByGroup,
    providerOrder: stringList(providersIndex.providerOrder),
    providerFolders: stringMap(providersIndex.providerFolders),
  }
}
