import { now } from '../core/utils'
import {
  normalizeCatalogSnapshot,
  createSplitProjectionCache,
  projectionScopeKey,
  type CatalogSnapshot,
  type ChatIndexSnapshot,
  type ProjectionScope,
  type ProjectionVersions,
} from '../storage/splitProjectionCache'
import { createActiveSelectionWriter, type ActiveSelectionWriter } from '../storage/activeSelectionWriter'
import { createChatBodyLoader, type ChatBodyLoader } from '../storage/chatBodyLoader'
import { createSessionWindowLoader, type SessionWindowLoader } from '../storage/sessionWindowLoader'
import { normalizeStoredChatIndex } from '../storage/splitIndexes'
import { splitChatKey, splitGroupChatIndexKey, splitGroupChatKey, splitRoleChatIndexKey } from '../domain/storageKeys'
import type { SessionSwitchClient } from '../protocol/sessionSwitchProtocol'

// 切换管线装配：把 SplitProjectionCache / ActiveSelectionWriter / ChatBodyLoader
// 三件事装成一个模块，controller 只负责注入依赖与消费结果。
//
// 数据流：
//   catalog（目录事实）→ 一次 meta/index 读取，按 epoch 缓存
//   每个 target 的 chatIndex → 优先 sessionIndex.get，迁移期读 chats/<folder>/index
//   activeChatId → 只发偏好命令，不碰索引数据事实
//   会话正文 → 消息窗口分页（首屏一窗，往前按 cursor 续翻）

export type ProjectionPipelineStorage = {
  get: (key: string) => Promise<any>
  set: (key: string, value: any) => Promise<void>
}

export type ProjectionPipelineDeps = {
  storage: ProjectionPipelineStorage
  sessionSwitch?: SessionSwitchClient
  // 目录事实（folder 映射）来自 meta 文档，用于把 scope 映射成旧 storage key。
  loadSplitMeta: () => Promise<any>
  getSplitMetaCache: () => any
  // 本地 UI 状态同步：命令成功后只改偏好那一格。
  applyLocalSelection: (scope: ProjectionScope, chatId: string) => void
  // head 端到端：返回「该会话当前活动分支的头部消息 id」。
  // 窗口首窗用它表达「用户在看哪条路径」（design-4 决策 3）。
  resolveBranchHead?: (scope: ProjectionScope, chatId: string) => string
  // switchId 端到端：返回「当前这次切换」的关联键。
  // 正文加载（window / get / graph）必须与偏好命令共享同一个值。
  resolveSwitchId?: () => string
  onError?: (message: string) => void
}

export type ProjectionPipeline = {
  cache: ReturnType<typeof createSplitProjectionCache>
  activeSelection: ActiveSelectionWriter
  chatBodies: ChatBodyLoader
  sessionWindows: SessionWindowLoader
  versions: () => ProjectionVersions
  applyVersions: (next: Partial<ProjectionVersions>) => void
  loadChatIndex: (scope: ProjectionScope) => Promise<ChatIndexSnapshot | null>
  // 版本门数据源：即使缓存命中也要向服务端确认最新 revision。
  refreshChatIndex: (scope: ProjectionScope) => Promise<ChatIndexSnapshot | null>
  loadOlderMessages: (scope: ProjectionScope, chatId: string) => Promise<any>
  reloadChatBody: (scope: ProjectionScope, chatId: string) => Promise<any>
  invalidateSessionIndex: (kind: 'role' | 'group', targetId: string) => void
  invalidateCatalog: () => void
  invalidateChatBody: (scope: ProjectionScope, chatId: string) => void
  invalidateSessionWindow: (scope: ProjectionScope, chatId: string) => void
  invalidateAll: () => void
  folderForScope: (scope: ProjectionScope) => string
  // 当前这次切换的关联键（空串表示没有进行中的切换）。
  currentSwitchId: () => string
}

export function createProjectionPipeline(deps: ProjectionPipelineDeps): ProjectionPipeline {
  const { storage, sessionSwitch, loadSplitMeta, getSplitMetaCache, applyLocalSelection, onError } = deps

  const versionsRef: ProjectionVersions = { dataRevision: 0, preferenceRevision: 0, epoch: 0 }

  function versions(): ProjectionVersions {
    return versionsRef
  }

  // 版本只来自服务端快照：前端永远不自己编版本号。
  // epoch 推进意味着「整份投影换代」：目录、所有 scope 索引、会话正文、
  // 消息窗口都必须一起作废——只清索引会让正文继续读上一代的缓存。
  function applyVersions(next: Partial<ProjectionVersions>) {
    let epochChanged = false
    for (const key of ['dataRevision', 'preferenceRevision', 'epoch'] as const) {
      const value = Number(next[key] ?? NaN)
      if (!Number.isFinite(value) || value <= 0) continue
      if (versionsRef[key] === value) continue
      versionsRef[key] = value
      if (key === 'epoch') epochChanged = true
    }
    if (epochChanged) invalidateAll()
  }

  async function loadMetaDoc(): Promise<any> {
    return getSplitMetaCache() || (await loadSplitMeta())
  }

  function folderForScope(scope: ProjectionScope): string {
    // catalog 是目录事实的缓存层：命中时零 I/O，未命中才回落到 meta 文档。
    const catalog = cache.peekCatalog()
    if (catalog) {
      const folders = scope.kind === 'group' ? catalog.groupFolders : catalog.roleFolders
      const folder = String(folders?.[scope.targetId] || '').trim()
      if (folder) return folder
    }
    const meta = getSplitMetaCache()
    const folders = scope.kind === 'group' ? meta?.groupFolders : meta?.roleFolders
    return String(folders?.[scope.targetId] || '').trim()
  }

  function chatIndexKeyFor(folder: string, scope: ProjectionScope): string {
    return scope.kind === 'group' ? splitGroupChatIndexKey(folder) : splitRoleChatIndexKey(folder)
  }

  function chatBodyKeyFor(folder: string, scope: ProjectionScope, chatId: string): string {
    return scope.kind === 'group' ? splitGroupChatKey(folder, chatId) : splitChatKey(folder, chatId)
  }

  // 目录事实直接来自 meta/index：后端 meta() 已是纯组装，目录字段随它一次返回。
  // 这是「删 4-key 扇出」的实现点：不再单独读 chats/index、groups/index、
  // providers/index、model-groups/index 四份文档。
  async function loadCatalog(): Promise<CatalogSnapshot> {
    const meta = await loadMetaDoc()
    return normalizeCatalogSnapshot({
      roleOrder: meta?.roleOrder,
      roleFolders: meta?.roleFolders,
      groupOrder: meta?.groupOrder,
      groupFolders: meta?.groupFolders,
      providerOrder: meta?.providerOrder,
      providerFolders: meta?.providerFolders,
      modelGroupOrder: meta?.modelGroupOrder,
      modelGroupFolders: meta?.modelGroupFolders,
    })
  }

  // 迁移期：读 chats/<folder>/index。纯读，不修复、不回写。
  async function readStoredChatIndex(scope: ProjectionScope): Promise<ChatIndexSnapshot | null> {
    const meta = await loadMetaDoc()
    const folders = scope.kind === 'group' ? meta?.groupFolders : meta?.roleFolders
    const folder = String(folders?.[scope.targetId] || '').trim()
    if (!folder) return null
    const raw = await storage.get(chatIndexKeyFor(folder, scope)).catch(() => null)
    if (!raw || typeof raw !== 'object') return null
    const stored = normalizeStoredChatIndex(raw, scope, scope.kind === 'group' ? '群聊' : '新聊天')
    return {
      scope: stored.scope,
      activeChatId: stored.activeChatId,
      chatIds: stored.chatIds,
      chatUpdatedAt: stored.chatUpdatedAt,
      chatMetas: stored.chatMetas,
      updatedAt: stored.updatedAt || now(),
      revision: stored.revision,
    }
  }

  const cache = createSplitProjectionCache({
    loadCatalog,
    loadChatIndex: async (scope) => {
      // 新协议优先：一次只拉请求的 scope，且带回版本。
      if (sessionSwitch?.hasFeature('sessionIndex.get')) {
        const bundle = await sessionSwitch.sessionIndexGet([scope])
        applyVersions(bundle)
        const snapshot = bundle.indexes.find((item) => item.scope === projectionScopeKey(scope))
        if (snapshot) {
          return {
            scope: snapshot.scope,
            activeChatId: snapshot.activeChatId,
            chatIds: snapshot.chatIds,
            chatUpdatedAt: snapshot.chatUpdatedAt,
            chatMetas: snapshot.chatMetas as any,
            updatedAt: snapshot.updatedAt,
            revision: snapshot.revision,
          }
        }
      }
      return readStoredChatIndex(scope)
    },
    getVersions: versions,
  })

  // 迁移垫片：后端还没有 setActiveChat 时，只写 activeChatId 一格。
  async function writeLegacySelection(scope: ProjectionScope, chatId: string) {
    const meta = await loadMetaDoc()
    const folders = scope.kind === 'group' ? meta?.groupFolders : meta?.roleFolders
    const folder = String(folders?.[scope.targetId] || '').trim()
    if (!folder) throw new Error(scope.kind === 'group' ? '群组不存在' : '角色不存在')
    await storage.set(chatIndexKeyFor(folder, scope), { activeChatId: chatId })
  }

  const activeSelection = createActiveSelectionWriter({
    hasCommand: () => !!sessionSwitch?.hasFeature('setActiveChat'),
    setActiveChat: (scope, chatId, options) => {
      if (!sessionSwitch) throw new Error('后端不支持切换会话偏好')
      return sessionSwitch.setActiveChat(scope, chatId, options)
    },    writeLegacySelection,
    applyLocalSelection: (scope, chatId) => {
      cache.setActiveChatId(scope, chatId)
      applyLocalSelection(scope, chatId)
    },
    onError,
  })

  // 消息窗口：首屏一窗 + 往前按 cursor 续翻。
  // 它与 chatBodies 是两层：window 负责「取哪一窗」，chatBodies 负责「单飞 + LRU」。
  const sessionWindows = createSessionWindowLoader({
    sessionSwitch: sessionSwitch ?? {
      hasFeature: () => false,
      sessionWindow: async () => {
        throw new Error('后端不支持 session.window')
      },
    },
    // head 端到端：首窗必须告诉业务端「用户在看哪条路径」。
    // 由上层注入（从本地会话的活动分支读），拿不到就退回业务端默认路径。
    headFor: (scope, chatId) => {
      try {
        return String(deps.resolveBranchHead?.({ kind: scope.kind, targetId: scope.targetId }, chatId) || '').trim()
      } catch (_) {
        return ''
      }
    },
    // switchId 端到端：正文加载必须携带「当前这次切换」的关联键，
    // 否则前端边界与 box 的 X-Eucli-Trace 不是同一个值，P0 无法用 trace 解释慢案例。
    switchIdFor: () => currentSwitchID(),
  })

  // currentSwitchID 是「最近一次切换」的关联键：与偏好命令同一个值。
  // 没有进行中的切换时返回空串，请求就不带该字段（观测整条不启动）。
  function currentSwitchID(): string {
    try {
      return String(deps.resolveSwitchId?.() || '').trim()
    } catch (_) {
      return ''
    }
  }

  const chatBodies = createChatBodyLoader({
    load: async (scope, chatId) => {
      const span = activeSelection.lastSpan()
      const loadId = span?.beginLoad()
      // 消息窗口是首屏读源：一次只取一窗，body 就绪后才继续往更早翻。
      // 后端不支持 window 时退回整份会话字节，行为与旧路径一致。
      if (sessionSwitch?.hasFeature('session.window')) {
        const chat = await sessionWindows.load(scope, chatId)
        span?.mark('frontend.bodyReady', loadId ? { loadId } : undefined)
        return chat
      }
      const meta = await loadMetaDoc()
      const folders = scope.kind === 'group' ? meta?.groupFolders : meta?.roleFolders
      const folder = String(folders?.[scope.targetId] || '').trim()
      if (!folder) throw new Error(scope.kind === 'group' ? '群组不存在' : '角色不存在')
      // 会话正文始终读业务端原始文档：前端是唯一真解析方。
      const raw = await storage.get(chatBodyKeyFor(folder, scope, chatId))
      // 正文就绪是纯咨询边界：只上报，不门控任何渲染。
      span?.mark('frontend.bodyReady', loadId ? { loadId } : undefined)
      return raw
    },
  })

  function invalidateSessionIndex(kind: 'role' | 'group', targetId: string) {
    cache.invalidateScope({ kind, targetId })
  }

  // invalidateCatalog 用于「实体集合 / folder 映射变化」：
  // 只作废目录事实，不动各 scope 的会话索引。
  function invalidateCatalog() {
    cache.invalidateCatalog()
  }

  // invalidateChatBody 只作废「正文缓存」，**不动分页状态**。
  //
  // 这是写路径的关键语义：写后刷新要保留用户已经翻出来的更早窗口，
  // 所以这里绝不能连带 sessionWindows.invalidate —— 一旦清掉分页状态，
  // reloadChatBody 的 refresh 就只能拼回首窗，长会话编辑后历史整体消失。
  //
  // 需要连分页一起丢的场景（epoch 换代 / 会话删除）走 invalidateSessionWindow。
  function invalidateChatBody(scope: ProjectionScope, chatId: string) {
    chatBodies.invalidate(scope, chatId)
  }

  // invalidateSessionWindow 是「分页状态整份作废」：会话被删除、
  // 或投影换代时才调用；写路径不要用它。
  function invalidateSessionWindow(scope: ProjectionScope, chatId: string) {
    sessionWindows.invalidate(scope, chatId)
  }

  function invalidateAll() {
    cache.invalidateAll()
    chatBodies.clear()
    sessionWindows.clear()
  }

  // loadOlderMessages 是「往前翻」的唯一入口：翻页结果回写 chatBodies，
  // 让下一次 load 直接拿到已经拼好的更长会话。
  async function loadOlderMessages(scope: ProjectionScope, chatId: string) {
    const chat = await sessionWindows.loadOlder(scope, chatId)
    if (chat) chatBodies.remember(scope, chatId, chat)
    return chat
  }

  // reloadChatBody 是「写路径之后的重读」：
  //   - 窗口模式：重取首窗并保留已翻出的更早窗口，否则一次编辑就把长会话缩回首屏；
  //   - 整份模式：先失效缓存，再走一次正常 load（不能只失效就返回 null）。
  async function reloadChatBody(scope: ProjectionScope, chatId: string) {
    if (sessionSwitch?.hasFeature('session.window')) {
      const chat = await sessionWindows.refresh(scope, chatId)
      if (chat) chatBodies.remember(scope, chatId, chat)
      return chat
    }
    chatBodies.invalidate(scope, chatId)
    return chatBodies.load(scope, chatId)
  }

  return {
    cache,
    activeSelection,
    chatBodies,
    sessionWindows,
    versions,
    applyVersions,
    loadChatIndex: (scope) => cache.loadChatIndex(scope),
    refreshChatIndex: (scope) => cache.refreshChatIndex(scope),
    loadOlderMessages,
    reloadChatBody,
    invalidateSessionIndex,
    invalidateCatalog,
    invalidateChatBody,
    invalidateSessionWindow,
    invalidateAll,
    folderForScope,
    currentSwitchId: currentSwitchID,
  }
}

export type { ProjectionScope, ChatIndexSnapshot, CatalogSnapshot }
