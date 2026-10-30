import { now } from '../core/utils'
import { chatMetaFromChat, chatMetasFromBox, type ChatMeta } from '../domain/chatMeta'

// 前端投影缓存（design-1 三层架构的第一层）：
//
//   SplitProjectionCache = catalog（实体集合）+ 每个 target 一份 chatIndex
//
// 三条硬约束：
//   1. 只缓存带 revision / epoch 的完整快照，绝不缓存半截对象；
//   2. 读路径只读缓存，不写盘、不回写索引；
//   3. 缓存键含连接身份（epoch），连接换代即整份作废。

export type ProjectionScopeKind = 'role' | 'group'

export type ProjectionScope = {
  kind: ProjectionScopeKind
  targetId: string
}

export type CatalogSnapshot = {
  roleOrder: string[]
  roleFolders: Record<string, string>
  groupOrder: string[]
  groupFolders: Record<string, string>
  providerOrder: string[]
  providerFolders: Record<string, string>
  modelGroupOrder: string[]
  modelGroupFolders: Record<string, string>
}

export type ChatIndexSnapshot = {
  scope: string
  activeChatId: string
  chatIds: string[]
  chatUpdatedAt: Record<string, number>
  chatMetas: ChatMeta[]
  updatedAt: number
  revision: number
}

export type ProjectionVersions = {
  dataRevision: number
  preferenceRevision: number
  epoch: number
}

export function projectionScopeKey(scope: ProjectionScope): string {
  return `${scope.kind}:${String(scope.targetId || '').trim()}`
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    const id = String(item || '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

function normalizeStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const id = String(key || '').trim()
    const folder = String(raw || '').trim()
    if (id && folder) out[id] = folder
  }
  return out
}

export function emptyCatalogSnapshot(): CatalogSnapshot {
  return {
    roleOrder: [],
    roleFolders: {},
    groupOrder: [],
    groupFolders: {},
    providerOrder: [],
    providerFolders: {},
    modelGroupOrder: [],
    modelGroupFolders: {},
  }
}

export function normalizeCatalogSnapshot(raw: any): CatalogSnapshot {
  const source = raw && typeof raw === 'object' ? raw : {}
  return {
    roleOrder: normalizeStringList(source.roleOrder),
    roleFolders: normalizeStringMap(source.roleFolders),
    groupOrder: normalizeStringList(source.groupOrder),
    groupFolders: normalizeStringMap(source.groupFolders),
    providerOrder: normalizeStringList(source.providerOrder),
    providerFolders: normalizeStringMap(source.providerFolders),
    modelGroupOrder: normalizeStringList(source.modelGroupOrder),
    modelGroupFolders: normalizeStringMap(source.modelGroupFolders),
  }
}

export function normalizeChatIndexSnapshot(raw: any, scope: ProjectionScope): ChatIndexSnapshot | null {
  if (!raw || typeof raw !== 'object') return null
  const key = projectionScopeKey(scope)
  const fallbackTitle = scope.kind === 'group' ? '群聊' : '新聊天'
  const chatIds = normalizeStringList((raw as any).chatIds)
  const chatMetas = chatMetasFromBox(raw, fallbackTitle)
  const updatedRaw = (raw as any).chatUpdatedAt && typeof (raw as any).chatUpdatedAt === 'object' ? (raw as any).chatUpdatedAt : {}
  const chatUpdatedAt: Record<string, number> = {}
  for (const [id, value] of Object.entries(updatedRaw as Record<string, unknown>)) {
    const chatId = String(id || '').trim()
    const number = Number(value || 0)
    if (chatId && Number.isFinite(number)) chatUpdatedAt[chatId] = number
  }
  const ids = chatIds.length ? chatIds : chatMetas.map((meta) => meta.id)
  return {
    scope: key,
    activeChatId: String((raw as any).activeChatId || ''),
    chatIds: ids,
    chatUpdatedAt,
    chatMetas,
    updatedAt: Number((raw as any).updatedAt || 0),
    revision: Number((raw as any).revision || 0),
  }
}

export type SplitProjectionCacheDeps = {
  // catalog 的 4 个 index key 由调用方注入（迁移期一次 storageGetMany，之后是 sessionIndex.get）
  loadCatalog: () => Promise<CatalogSnapshot>
  loadChatIndex: (scope: ProjectionScope) => Promise<ChatIndexSnapshot | null>
  getVersions: () => ProjectionVersions
}

export function createSplitProjectionCache(deps: SplitProjectionCacheDeps) {
  let catalog: CatalogSnapshot | null = null
  let catalogEpoch = 0
  let catalogPromise: Promise<CatalogSnapshot> | null = null
  const indexes = new Map<string, ChatIndexSnapshot>()
  const indexEpoch = new Map<string, number>()
  const indexPromises = new Map<string, Promise<ChatIndexSnapshot | null>>()

  function currentEpoch() {
    return Number(deps.getVersions().epoch || 0)
  }

  function invalidateAll() {
    catalog = null
    catalogEpoch = 0
    catalogPromise = null
    indexes.clear()
    indexEpoch.clear()
    indexPromises.clear()
  }

  // invalidateScope 只作废单个 target 的索引：切换会话不会波及别的 target。
  function invalidateScope(scope: ProjectionScope) {
    const key = projectionScopeKey(scope)
    indexes.delete(key)
    indexEpoch.delete(key)
    indexPromises.delete(key)
  }

  // invalidateCatalog 只作废目录事实：实体增删 / 改名 / 改 folder 时调用。
  // 会话索引仍然有效，不该跟着一起重拉。
  function invalidateCatalog() {
    catalog = null
    catalogEpoch = 0
    catalogPromise = null
  }

  function peekCatalog(): CatalogSnapshot | null {
    if (!catalog) return null
    if (catalogEpoch !== currentEpoch()) return null
    return catalog
  }

  async function loadCatalog(): Promise<CatalogSnapshot> {
    const cached = peekCatalog()
    if (cached) return cached
    if (catalogPromise) return catalogPromise
    const epoch = currentEpoch()
    catalogPromise = deps
      .loadCatalog()
      .then((snapshot) => {
        catalog = snapshot
        catalogEpoch = epoch
        return snapshot
      })
      .finally(() => {
        catalogPromise = null
      })
    return catalogPromise
  }

  function peekChatIndex(scope: ProjectionScope): ChatIndexSnapshot | null {
    const key = projectionScopeKey(scope)
    const snapshot = indexes.get(key)
    if (!snapshot) return null
    if (indexEpoch.get(key) !== currentEpoch()) return null
    return snapshot
  }

  async function loadChatIndex(scope: ProjectionScope): Promise<ChatIndexSnapshot | null> {
    const cached = peekChatIndex(scope)
    if (cached) return cached
    return refreshChatIndex(scope)
  }

  // refreshChatIndex 是「版本门」的唯一数据源：即使缓存命中，也向服务端确认一次
  // 最新 revision。命中缓存直接返回会让版本门永远看到同一个旧 revision，
  // 对账永不执行（design-5 P4「revision + 缺口检测」）。
  //
  // 它仍然单飞：同一 scope 的并发确认共享一次请求。
  async function refreshChatIndex(scope: ProjectionScope): Promise<ChatIndexSnapshot | null> {
    const key = projectionScopeKey(scope)
    const pending = indexPromises.get(key)
    if (pending) return pending
    const epoch = currentEpoch()
    const promise = deps
      .loadChatIndex(scope)
      .then((snapshot) => {
        if (snapshot) {
          indexes.set(key, snapshot)
          indexEpoch.set(key, epoch)
        }
        return snapshot
      })
      .finally(() => {
        indexPromises.delete(key)
      })
    indexPromises.set(key, promise)
    return promise
  }

  // applyChatIndex 是唯一「写入缓存」的入口：只接受完整快照，且版本必须匹配。
  function applyChatIndex(snapshot: ChatIndexSnapshot) {
    if (!snapshot || !snapshot.scope) return
    indexes.set(snapshot.scope, snapshot)
    indexEpoch.set(snapshot.scope, currentEpoch())
  }

  // setActiveChatId 只改 UI 偏好那一格：索引里的数据事实（chatIds/chatMetas）不变。
  function setActiveChatId(scope: ProjectionScope, chatId: string) {
    const key = projectionScopeKey(scope)
    const snapshot = indexes.get(key)
    if (!snapshot) return
    const next = String(chatId || '').trim()
    if (snapshot.activeChatId === next) return
    indexes.set(key, { ...snapshot, activeChatId: next })
  }

  function chatIndexIds(scope: ProjectionScope): string[] {
    return peekChatIndex(scope)?.chatIds.slice() || []
  }

  function catalogRevision() {
    return currentEpoch()
  }

  return {
    invalidateAll,
    invalidateScope,
    invalidateCatalog,
    peekCatalog,
    loadCatalog,
    peekChatIndex,
    loadChatIndex,
    refreshChatIndex,
    applyChatIndex,
    setActiveChatId,
    chatIndexIds,
    catalogRevision,
  }
}

export type SplitProjectionCache = ReturnType<typeof createSplitProjectionCache>

// buildChatIndexSnapshot 把「旧 storage key 形状」的一次性读取结果转成快照。
// 迁移期专用：一旦后端 sessionIndex.get 可用，就只走协议快照。
export function buildChatIndexSnapshot(raw: any, scope: ProjectionScope): ChatIndexSnapshot | null {
  const snapshot = normalizeChatIndexSnapshot(raw, scope)
  if (!snapshot) return null
  return { ...snapshot, updatedAt: snapshot.updatedAt || now() }
}

// chatIndexMatchesChats 判断「索引是否已经覆盖了本地已知会话」，
// 用于避免无意义的重复拉取（不是兜底，而是省一次往返）。
export function chatIndexMatchesChats(snapshot: ChatIndexSnapshot | null, chats: any[]): boolean {
  if (!snapshot) return false
  const known = new Set(snapshot.chatIds)
  for (const chat of Array.isArray(chats) ? chats : []) {
    const id = String(chat?.id || '').trim()
    if (!id) continue
    if (!known.has(id)) return false
  }
  return true
}

// chatMetaListFromIndex 是缓存快照到 UI 列表的唯一出口。
export function chatMetaListFromIndex(snapshot: ChatIndexSnapshot | null, fallbackTitle = '新聊天'): ChatMeta[] {
  if (!snapshot) return []
  return snapshot.chatMetas.length ? snapshot.chatMetas : normalizeChatMetaList(snapshot.chatIds, fallbackTitle)
}

function normalizeChatMetaList(ids: string[], fallbackTitle: string): ChatMeta[] {
  return ids
    .map((id) => chatMetaFromChat({ id, title: fallbackTitle, messages: [] }, fallbackTitle))
    .filter((meta): meta is ChatMeta => !!meta)
}
