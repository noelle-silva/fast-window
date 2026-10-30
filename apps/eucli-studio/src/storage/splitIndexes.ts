import { now } from '../core/utils'
import { SPLIT_META_KEY, SPLIT_SCHEMA_VERSION } from '../domain/constants'
import { normalizeChatMetas, type ChatMeta } from '../domain/chatMeta'
import { normalizeSplitMeta } from '../domain/dataNormalizers'
import { splitGroupChatIndexKey, splitRoleChatIndexKey } from '../domain/storageKeys'
import type { ProjectionScope } from './splitProjectionCache'

export type SplitStorageReader = {
  get: (key: string) => Promise<any>
  set?: (key: string, value: any) => Promise<any>
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

// loadSplitMetaSnapshot 只读一次 meta/index。
//
// 这里曾经扇出读取 chats/index + groups/index + providers/index 三份额外文档，
// 再逐个读 chats/<folder>/index 修复并回写。现在：
//   - 目录事实（order / folder 映射）已由 studio 后端 meta() 纯组装进 meta/index；
//   - 会话索引按 scope 懒加载（SplitProjectionCache）；
//   - 读路径绝不写盘（禁止「读时修复并回写」）。
export async function loadSplitMetaSnapshot(storage: SplitStorageReader) {
  const raw = await storage.get(SPLIT_META_KEY)
  if (raw == null) return null
  const meta = normalizeSplitMeta(raw)
  if (!meta) throw new Error('存储索引损坏：meta/index 格式不正确')

  return {
    schemaVersion: SPLIT_SCHEMA_VERSION,
    dataVersion: Number(meta.dataVersion || 0),
    // updatedAt 只用于展示排序，禁止参与任何新鲜度判定。
    updatedAt: Number(meta.updatedAt || 0) || now(),
    ui: meta.ui,
    settings: meta.settings,
    roleOrder: stringList(meta.roleOrder),
    roleFolders: stringMap(meta.roleFolders),
    groupOrder: stringList(meta.groupOrder),
    groupFolders: stringMap(meta.groupFolders),
    providerOrder: stringList((meta as any).providerOrder),
    providerFolders: stringMap((meta as any).providerFolders),
    modelGroupOrder: stringList((meta as any).modelGroupOrder),
    modelGroupFolders: stringMap((meta as any).modelGroupFolders),
  }
}

// loadProvidersFromStorage 直接用 meta.settings.providers：
// 供应商实体是 studio 后端 meta() 的派生物，前端不需要再读 providers/index。
export async function loadProvidersFromStorage(_storage: SplitStorageReader, metaOverride?: any): Promise<any[]> {
  const providers = metaOverride?.settings?.providers
  if (!Array.isArray(providers)) return []
  return providers.filter((x: any) => x && typeof x === 'object')
}

// chatIndexKeyFor 是 scope 到旧 storage key 的唯一映射，供迁移期读取使用。
export function chatIndexKeyFor(scope: ProjectionScope, folder: string): string {
  return scope.kind === 'group' ? splitGroupChatIndexKey(folder) : splitRoleChatIndexKey(folder)
}

export type StoredChatIndex = {
  scope: string
  activeChatId: string
  chatIds: string[]
  chatUpdatedAt: Record<string, number>
  chatMetas: ChatMeta[]
  updatedAt: number
  revision: number
}

function numberMap(value: any): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [key, raw] of Object.entries(objectOrEmpty(value))) {
    const id = String(key || '').trim()
    const number = Number(raw || 0)
    if (id && Number.isFinite(number)) out[id] = number
  }
  return out
}

// normalizeStoredChatIndex 是纯读：不修复、不回写、不读会话正文。
export function normalizeStoredChatIndex(raw: any, scope: ProjectionScope, fallbackTitle: string): StoredChatIndex {
  const index = objectOrEmpty(raw)
  const chatIds = stringList(index.chatIds)
  const chatMetas = normalizeChatMetas(index.chatMetas, chatIds, index.chatUpdatedAt, fallbackTitle)
  return {
    scope: `${scope.kind}:${scope.targetId}`,
    activeChatId: String(index.activeChatId || ''),
    chatIds: chatIds.length ? chatIds : chatMetas.map((meta) => meta.id),
    chatUpdatedAt: numberMap(index.chatUpdatedAt),
    chatMetas,
    updatedAt: Number(index.updatedAt || 0),
    revision: Number(index.revision || 0),
  }
}
