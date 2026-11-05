import { chatMetasFromBox } from '../domain/chatMeta'
import { writeChatListProjection } from '../domain/chatListProjection'
import {
  readActiveChatSelection,
  reconcileActiveChatSelectionFact,
  resolveActiveChatSelectionFact,
} from '../domain/activeChatSelection'
import { projectionScopeKey, type ChatIndexSnapshot, type ProjectionScope } from './splitProjectionCache'
import type { SessionWindowRefreshOptions } from './sessionWindowLoader'
import type { SessionWriteGuard } from './sessionWriteGuard'

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
  // 对账路径一律带 authoritative：本地视窗 head 不得挡住后台新增事实。
  reloadChatBody: (scope: ProjectionScope, chatId: string, options?: SessionWindowRefreshOptions) => Promise<any>
  // 会话进入内存状态的唯一入口：负责归一化 + 合并 + 写 meta。
  upsertLoadedChat: (kind: 'role' | 'group', targetId: string, chat: any) => any
  // 索引级对账不覆盖运行中的会话：它只负责列表事实，正文由事件路径负责。
  hasActiveRun: (scope: ProjectionScope, chatId: string) => boolean
  // 连接 / 投影代际：正文重取期间换代，旧快照不得写回。
  getEpoch?: () => number
  // 会话代数：正文重取期间删除会话，旧正文不得写回。
  sessionWrites?: SessionWriteGuard
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
  // 单条会话的权威重取同样单飞：事件与通知可能同时指向同一条会话，
  // 共享一次拉取即可，绝不并发重取制造背压。
  const syncingChats = new Map<string, Promise<boolean>>()

  function epochSnapshot(): number | null {
    if (typeof deps.getEpoch !== 'function') return null
    const value = Number(deps.getEpoch())
    return Number.isFinite(value) ? value : null
  }

  function epochIsCurrent(epoch: number | null): boolean {
    if (epoch === null) return true
    return epochSnapshot() === epoch
  }

  // syncTargetChats 是「索引快照 → UI 状态」的唯一入口。
  // 返回 false 表示这次被并发对账挡下，调用方不得据此推进版本门。
  async function syncTargetChats(
    scope: TargetChatScope,
    snapshot: ChatIndexSnapshot,
    options?: { force?: boolean; isCurrent?: () => boolean; skipReloadChatIds?: Set<string> },
  ): Promise<boolean> {
    const state = deps.getState()
    if (!state.data) return false
    const scopeKey = projectionScopeKey(scope)
    if (syncingScopes.has(scopeKey)) return false
    syncingScopes.add(scopeKey)
    const epoch = epochSnapshot()
    try {
      const title = fallbackTitle(scope)
      const chatMetas = snapshot.chatMetas.length ? snapshot.chatMetas : chatMetasFromBox(snapshot, title)
      const desiredChatIds = chatMetas.map((meta: any) => String(meta?.id || '')).filter((id: string) => !!id)
      const desiredActiveChatId = String(snapshot.activeChatId || '')
      const wantUpdatedAt = snapshot.chatUpdatedAt || {}

      const box = ensureChatsBox(state, scope)
      // 选中会话的裁决统一交给事实规则：
      // 本窗口用户已保存的选择 > 服务端索引偏好 > 索引列表首条兜底。
      const keepChatNow = readActiveChatSelection(box)
      const activeChatId = resolveActiveChatSelectionFact(box, {
        userIntent: keepChatNow,
        serverFact: desiredActiveChatId,
        fallbackCandidates: desiredChatIds,
        // 重取正文发生在列表投影落盘之前：此刻只能按旧行为接受调用方给出的
        // 三种候选，存在性校验留给下面的最终 reconcile。
        availableChatIds: [keepChatNow, desiredActiveChatId, ...desiredChatIds],
      })

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
        // 索引是列表事实的唯一来源：后台时间直接覆盖本地投影，不做本地时间裁决。
        if (metaUpdatedAt && chatId !== activeChatId) cur.updatedAt = metaUpdatedAt
        nextChats.push(cur)
      }
      writeChatListProjection(box, { kind: 'replace', chats: nextChats, chatMetas })

      if (activeChatId && !deps.hasActiveRun(scope, activeChatId)) {
        const metaUpdatedAt = Number(wantUpdatedAt[activeChatId] || 0)
        const cur = curById.get(activeChatId) || null
        const curUpdatedAt = Number(cur?.updatedAt || 0)
        // 后台事实整体覆盖前端视图：索引时间与本地不一致就重取权威正文，
        // 不判断「谁更新」——本地状态不得压过后台事实。
        // force：连索引时间都不可信（断线 / 服务端重建），必须无条件重取。
        // 版本已经核对过的会话不再用索引时间二次判定：版本相等即证明本地正文最新。
        const versionGuarded = options?.skipReloadChatIds?.has(activeChatId) === true
        const mustReload = !versionGuarded && (options?.force === true || (metaUpdatedAt > 0 && metaUpdatedAt !== curUpdatedAt))
        if (mustReload) {
          const token = deps.sessionWrites?.capture(scope.kind, scope.targetId, activeChatId) || null
          const raw = await deps.reloadChatBody(scope, activeChatId, { authoritative: true })
          // 读取期间换代 / 会话被删除：旧正文不得写回，整次对账也不得推进版本门。
          if (!epochIsCurrent(epoch)) return false
          if (deps.sessionWrites && !deps.sessionWrites.isCurrent(token)) return false
          if (options?.isCurrent && !options.isCurrent()) return false
          if (raw && typeof raw === 'object') deps.upsertLoadedChat(scope.kind, scope.targetId, raw)
        }
      }

      // 读取期间索引被失效（删除会话 / target）：列表与选中事实都不能再落。
      if (options?.isCurrent && !options.isCurrent()) return false
      reconcileActiveChatSelectionFact(box, {
        userIntent: keepChatNow,
        serverFact: desiredActiveChatId,
        fallbackCandidates: desiredChatIds,
        availableChatIds: desiredChatIds,
      })
      return true
    } finally {
      syncingScopes.delete(scopeKey)
    }
  }

  // syncChatById 是「事件通知指向某条会话」的唯一入口：
  // 只通过 reloadChatBody 取权威正文，并且不走本地视窗 head。
  // 事件在后台写盘之后才发出，属于已落盘事实：本地运行卡不能让它跳过；
  // 运行期间尚未落盘的消息由消息层的「在途遮罩」保留，不由拉取层裁决。
  // 同一会话的并发请求共享一次拉取；返回值表示这次事实是否已落地。
  function syncChatById(scope: TargetChatScope, chatIdRaw: string): Promise<boolean> {
    const chatId = String(chatIdRaw || '').trim()
    if (!chatId) return Promise.resolve(false)
    const key = `${projectionScopeKey(scope)}:${chatId}`
    const pending = syncingChats.get(key)
    if (pending) return pending

    const promise = syncChatByIdOnce(scope, chatId).finally(() => {
      if (syncingChats.get(key) === promise) syncingChats.delete(key)
    })
    syncingChats.set(key, promise)
    return promise
  }

  async function syncChatByIdOnce(scope: TargetChatScope, chatId: string): Promise<boolean> {
    const state = deps.getState()
    if (!state.data) return false
    // 会话变更事件在后台写盘之后才发出，是已落盘事实，不因本地有运行卡而跳过。
    // 运行期间尚未落盘的临时消息由「在途遮罩」在合并层保留，不由拉取层裁决。

    const epoch = epochSnapshot()
    const token = deps.sessionWrites?.capture(scope.kind, scope.targetId, chatId) || null
    const raw = await deps.reloadChatBody(scope, chatId, { authoritative: true })
    if (!epochIsCurrent(epoch)) return false
    if (deps.sessionWrites && !deps.sessionWrites.isCurrent(token)) return false
    if (!raw || typeof raw !== 'object') return false
    return !!deps.upsertLoadedChat(scope.kind, scope.targetId, raw)
  }

  return { syncTargetChats, syncChatById }
}

export type TargetChatSync = ReturnType<typeof createTargetChatSync>
