import { chatMetasFromBox } from '../domain/chatMeta'
import { writeChatListProjection } from '../domain/chatListProjection'
import { isStoredChatNewerThanCurrent } from '../domain/chatStorageSync'
import { readActiveChatSelection, reconcileActiveChatSelection } from '../domain/activeChatSelection'
import { projectionScopeKey, type ChatIndexSnapshot, type ProjectionScope } from './splitProjectionCache'

// 目标会话对账：角色 / 群聊共用一套实现。
//
// 曾经 role 与 group 各写了一份「把索引快照合并进 UI 状态」的逻辑：
//   - role 走 reloadChatBody（权威重取）；
//   - group 走 loadChatBody（命中缓存就返回旧正文）。
// 两份实现一旦分叉，群聊在强制对账时永远看不到服务端的新正文。
//
// 现在只有这一条路径：
//   - 索引事实来自调用方传入的权威快照（refreshChatIndex 的结果）；
//   - 正文事实只通过 reloadChatBody 取回，绝不复用缓存；
//   - 入状态统一走 upsertLoadedChat（会话进入内存状态的唯一入口）；
//   - force 表示「这次不看本地时间戳，必须取回权威正文」——
//     断线 / 服务端重建之后本地 updatedAt 不可信，只能强制重取。

export type TargetChatScope = ProjectionScope & { kind: 'role' | 'group' }

export type TargetChatSyncDeps = {
  getState: () => any
  // 权威正文重取（不是缓存命中）：角色 / 群聊必须走同一个入口。
  reloadChatBody: (scope: ProjectionScope, chatId: string) => Promise<any>
  // 会话进入内存状态的唯一入口：负责归一化 + 合并 + 写 meta。
  upsertLoadedChat: (kind: 'role' | 'group', targetId: string, chat: any) => any
  // 运行中的会话以内存为准，对账不得覆盖它。
  hasActiveRun: (scope: ProjectionScope, chatId: string) => boolean
}

function fallbackTitle(scope: TargetChatScope) {
  return scope.kind === 'group' ? '群聊' : '新聊天'
}

function chatsRootKey(scope: TargetChatScope) {
  return scope.kind === 'group' ? 'chatsByGroup' : 'chatsByRole'
}

function ensureChatsBox(state: any, scope: TargetChatScope) {
  const rootKey = chatsRootKey(scope)
  if (!state.data[rootKey] || typeof state.data[rootKey] !== 'object') state.data[rootKey] = {}
  const boxes = state.data[rootKey]
  if (!boxes[scope.targetId] || typeof boxes[scope.targetId] !== 'object') {
    boxes[scope.targetId] = { activeChatId: '', chatMetas: [], chats: [] }
  }
  const box = boxes[scope.targetId]
  writeChatListProjection(box, { kind: 'ensure' })
  return box
}

export function createTargetChatSync(deps: TargetChatSyncDeps) {
  // 并发保护按 scope 分桶：不同 target 的对账互不阻塞。
  const syncingScopes = new Set<string>()

  // syncTargetChats 是「索引快照 → UI 状态」的唯一入口。
  // 返回 false 表示这次被并发对账挡下，调用方不得据此推进版本门。
  async function syncTargetChats(
    scope: TargetChatScope,
    snapshot: ChatIndexSnapshot,
    options?: { force?: boolean },
  ): Promise<boolean> {
    const state = deps.getState()
    if (!state.data) return false
    const scopeKey = projectionScopeKey(scope)
    if (syncingScopes.has(scopeKey)) return false
    syncingScopes.add(scopeKey)
    try {
      const title = fallbackTitle(scope)
      const chatMetas = snapshot.chatMetas.length ? snapshot.chatMetas : chatMetasFromBox(snapshot, title)
      const desiredChatIds = chatMetas.map((meta: any) => String(meta?.id || '')).filter((id: string) => !!id)
      const desiredActiveChatId = String(snapshot.activeChatId || '')
      const wantUpdatedAt = snapshot.chatUpdatedAt || {}

      const box = ensureChatsBox(state, scope)
      const keepChatNow = readActiveChatSelection(box)
      const activeChatId = keepChatNow || desiredActiveChatId || String(desiredChatIds[0] || '')

      const curById = new Map<string, any>()
      for (const chat of box.chats) {
        const chatId = String(chat?.id || '')
        if (chatId) curById.set(chatId, chat)
      }

      // 先按索引顺序收敛列表：索引是列表事实的唯一来源。
      const nextChats: any[] = []
      for (const chatId of desiredChatIds) {
        const cur = curById.get(chatId) || null
        if (!cur) continue
        const metaUpdatedAt = Number(wantUpdatedAt[chatId] || 0)
        if (metaUpdatedAt && chatId !== activeChatId && isStoredChatNewerThanCurrent(metaUpdatedAt, cur.updatedAt)) {
          cur.updatedAt = metaUpdatedAt
        }
        nextChats.push(cur)
      }
      writeChatListProjection(box, { kind: 'replace', chats: nextChats, chatMetas })

      if (activeChatId && !deps.hasActiveRun(scope, activeChatId)) {
        const metaUpdatedAt = Number(wantUpdatedAt[activeChatId] || 0)
        const cur = curById.get(activeChatId) || null
        const curUpdatedAt = Number(cur?.updatedAt || 0)
        // force：本地时间戳不可信（断线 / 服务端重建），必须取回权威正文。
        const mustReload = options?.force === true || isStoredChatNewerThanCurrent(metaUpdatedAt, curUpdatedAt)
        if (mustReload) {
          const raw = await deps.reloadChatBody(scope, activeChatId)
          if (raw && typeof raw === 'object') deps.upsertLoadedChat(scope.kind, scope.targetId, raw)
        }
      }

      reconcileActiveChatSelection(box, [keepChatNow, desiredActiveChatId, ...desiredChatIds])
      return true
    } finally {
      syncingScopes.delete(scopeKey)
    }
  }

  // syncChatById 是「事件通知指向某条会话」的唯一入口：
  // 同样只通过 reloadChatBody 取权威正文，不区分角色 / 群聊。
  async function syncChatById(scope: TargetChatScope, chatIdRaw: string): Promise<boolean> {
    const state = deps.getState()
    if (!state.data) return false
    const chatId = String(chatIdRaw || '').trim()
    if (!chatId) return false
    if (deps.hasActiveRun(scope, chatId)) return false

    const raw = await deps.reloadChatBody(scope, chatId)
    if (!raw || typeof raw !== 'object') return false
    return !!deps.upsertLoadedChat(scope.kind, scope.targetId, raw)
  }

  return { syncTargetChats, syncChatById }
}

export type TargetChatSync = ReturnType<typeof createTargetChatSync>
