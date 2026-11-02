import { AI_CHAT_DIRECT_EVENT } from '../protocol/aiChatProtocol'
import { readActiveEbRunCardsForTarget } from '../domain/activeRunCards'
import { pendingChatForTarget } from '../domain/pendingChat'
import { writeChatListProjection } from '../domain/chatListProjection'
import { projectionScopeKey, type ChatIndexSnapshot, type ProjectionScope } from '../storage/splitProjectionCache'
import { createTargetChatSync, type TargetChatScope } from '../storage/targetChatSync'
import type { SessionWriteGuard } from '../storage/sessionWriteGuard'
import { createIndexRevisionGate } from './indexRevisionGate'

type DirectEventSubscription = (listener: (event: any) => void) => () => void

// 去轮询（design-5 第九节）：
//
//   5s UI tick       → 删除定时器，保留 tick 函数（由事件驱动按需调用）
//   15s meta 对账    → 降级为版本门（epoch + revision 都没变就什么都不做）
//   15s notice 对账  → 删除（studio 侧没有生产者，轮询一个永远不存在的键）
//
// 真正必需的安全网只剩三个：启动快照、桥接层重连、用户发起的有限期任务跟踪。
//
// 对账必须取回权威数据（否则两条安全网会同时失效）：
//   1. 索引永远走 refreshChatIndex —— 绕过投影缓存，向服务端确认最新 revision；
//   2. 正文永远走 reloadChatBody —— 绝不接受缓存命中的旧正文；
//   3. 版本门比较 (epoch, revision)，换代即重新生效 ——
//      服务端重建后 revision 可能相同，只记 revision 会被永久跳过。

export type UiPollingDeps = {
  getState: () => any
  emit: () => void
  subscribeDirectEvents?: DirectEventSubscription
  // 连接重建成功：断线期间可能漏掉事件，必须强制对账。
  onReconnected?: (listener: () => void) => () => void
  activeTargetKind: () => string
  activeChatFromData: () => any
  // 版本门数据源：即使缓存命中也要向服务端确认最新 revision。
  refreshChatIndex: (scope: ProjectionScope) => Promise<ChatIndexSnapshot | null>
  // 版本门守卫：读取期间被失效 / 换代挡下的旧快照不能驱动对账。
  isChatIndexSnapshotCurrent?: (scope: ProjectionScope, snapshot: ChatIndexSnapshot | null) => boolean
  // 权威正文重取：重取首窗但保留已翻出的更早窗口。
  reloadChatBody: (scope: ProjectionScope, chatId: string) => Promise<any>
  // 会话进入内存状态的唯一入口。
  upsertLoadedChat: (kind: 'role' | 'group', targetId: string, chat: any) => any
  // 当前连接 / 投影代际：版本门必须把它和 revision 一起比较。
  getEpoch?: () => number
  // 会话写回代数：对账期间会话被删除，旧正文不得回填。
  sessionWrites?: SessionWriteGuard
}

export function createUiPolling(deps: UiPollingDeps) {
  const gate = createIndexRevisionGate()
  const targetChatSync = createTargetChatSync({
    getState: deps.getState,
    reloadChatBody: deps.reloadChatBody,
    upsertLoadedChat: deps.upsertLoadedChat,
    hasActiveRun: (scope, chatId) => readActiveEbRunCardsForTarget(deps.getState(), scope.kind, scope.targetId, chatId).length > 0,
    getEpoch: deps.getEpoch,
    sessionWrites: deps.sessionWrites,
  })

  let uiLastChatUpdatedNoticeId = ''
  let uiPollingDisposed = false
  let unsubscribeDirectEvents: (() => void) | null = null
  let unsubscribeReconnected: (() => void) | null = null
  let chatUpdatedNoticeChain = Promise.resolve()
  // force 表示「这次不看版本门，必须对账」：重连 / 可见性恢复 / 首次进入。
  let pendingForceReconcile = false

  function currentEpoch(): number {
    return Number(deps.getEpoch?.() || 0)
  }

  function activeScope(): TargetChatScope | null {
    const state = deps.getState()
    if (!state.data) return null
    const kind = deps.activeTargetKind()
    if (kind !== 'group' && kind !== 'role') return null
    const targetId =
      kind === 'group'
        ? String((state.draft as any).activeGroupId || (state.data?.ui as any)?.activeGroupId || '').trim()
        : String(state.draft.activeRoleId || state.data?.ui?.activeRoleId || '').trim()
    if (!targetId) return null
    return { kind, targetId }
  }

  // reconcileScope 是「读权威索引 + 写回 UI 状态」的唯一实现。
  // 返回 true 表示这次真的应用了一个新版本。
  async function reconcileScope(scope: TargetChatScope, options?: { force?: boolean }): Promise<boolean> {
    // 索引永远是权威读取：refreshChatIndex 绕过缓存确认服务端 revision。
    const snapshot = await deps.refreshChatIndex(scope)
    if (!snapshot) return false
    // 读取期间发生过失效 / 换代：refreshChatIndex 只返回快照、不回填缓存，
    // 它已经不是当前权威事实，不能驱动列表收敛，也不能推进版本门。
    if (deps.isChatIndexSnapshotCurrent && !deps.isChatIndexSnapshotCurrent(scope, snapshot)) return false

    // epoch 必须在 refresh 之后读：refreshChatIndex 内部会用服务端快照推进版本。
    const epoch = currentEpoch()
    const scopeKey = projectionScopeKey(scope)
    const revision = Number(snapshot.revision || 0)
    const force = options?.force === true
    if (!force && !gate.shouldApply(scopeKey, epoch, revision)) return false

    const applied = await targetChatSync.syncTargetChats(scope, snapshot, {
      force,
      isCurrent: () => !deps.isChatIndexSnapshotCurrent || deps.isChatIndexSnapshotCurrent(scope, snapshot),
    })
    // 被并发对账挡下时不推进版本门：下一次仍会重试，不会把缺口吞掉。
    if (!applied) return false
    gate.markApplied(scopeKey, epoch, revision)
    return true
  }

  // uiPollTick 不再由定时器驱动：它是「版本门」的唯一入口，
  // 由事件（chat-updated）/ 重连 / 可见性恢复 / 显式调用触发。
  async function uiPollTick(options?: { force?: boolean }) {
    if (uiPollingDisposed) return
    const state = deps.getState()
    if (state.loading || !state.data) return

    const scope = activeScope()
    if (!scope) return
    if (pendingChatForTarget(state, scope.kind, scope.targetId)) return

    const force = !!options?.force || pendingForceReconcile
    try {
      const applied = await reconcileScope(scope, { force })
      // 只有真的应用了新版本才算补上缺口：被并发挡下 / 没有快照时保持 force，
      // 下一次事件或触发器仍会强制重试。
      if (applied) {
        pendingForceReconcile = false
        deps.emit()
      }
    } catch {
      // 版本门是后台对账：单次失败不打扰用户，下一次事件 / 重连会再试。
      // 失败时不清理 pendingForceReconcile：缺口仍然存在，必须留给下一次。
    }
  }

  // applyChatUpdatedNoticeOnce 只处理「事件里直接带来的通知」：
  // studio 侧没有 runtime notice 生产者，因此不再回读 storage（那是在轮询一个不存在的键）。
  async function applyChatUpdatedNoticeOnce(noticeOverride?: any): Promise<boolean> {
    const state = deps.getState()
    if (state.loading || !state.data) return false
    const raw = noticeOverride && typeof noticeOverride === 'object' ? noticeOverride : null
    if (!raw) return false

    const nid = String((raw as any).id || '')
    if (!nid || nid === uiLastChatUpdatedNoticeId) return false

    // A notice is marked only after the UI has either applied it or proved the
    // visible data is already current. Seeing a notice is not the same as
    // reconciling it.
    const markNoticeApplied = () => {
      uiLastChatUpdatedNoticeId = nid
    }

    const kindText = String((raw as any).targetKind || '').trim()
    const kind = kindText === 'group' ? 'group' : kindText === 'workspace' ? 'workspace' : 'role'
    const tid = String((raw as any).targetId || (raw as any).roleId || '').trim()
    const cid = String((raw as any).chatId || '').trim()
    const updatedAt = Number((raw as any).updatedAt || 0)
    if (!tid || !cid) return false

    const scope = activeScope()
    if (!scope || kind !== scope.kind || tid !== scope.targetId) return false
    if (pendingChatForTarget(state, scope.kind, scope.targetId)) return false

    const box = scope.kind === 'group' ? (state.data as any)?.chatsByGroup?.[tid] : state.data?.chatsByRole?.[tid]
    const activeChatId = String(deps.activeChatFromData()?.id || box?.activeChatId || '').trim()
    if (!activeChatId || cid === activeChatId) {
      // 通知指向当前会话（或当前还没有会话）：唯一正确的动作是取回权威正文。
      // 新会话尚未出现在列表时，索引也必须一起权威重取。
      if (!activeChatId) {
        if (!(await reconcileScope(scope, { force: true }))) return false
        const latestBox = scope.kind === 'group' ? (deps.getState().data as any)?.chatsByGroup?.[tid] : deps.getState().data?.chatsByRole?.[tid]
        const visible = hasChatInBox(latestBox, cid)
        if (!visible) return false
        markNoticeApplied()
        return true
      }
      if (readActiveEbRunCardsForTarget(state, scope.kind, scope.targetId, cid).length > 0) return false
      const currentUpdatedAt = Number(deps.activeChatFromData()?.updatedAt || 0)
      if (updatedAt && currentUpdatedAt && updatedAt <= currentUpdatedAt) {
        markNoticeApplied()
        return false
      }
      const ok = await targetChatSync.syncChatById(scope, cid)
      if (ok) markNoticeApplied()
      return ok
    }

    const metas = Array.isArray(box?.chatMetas) ? box.chatMetas : []
    const meta = metas.find((item: any) => String(item?.id || '') === cid) || null
    if (meta) {
      if (updatedAt && Number(meta.updatedAt || 0) !== updatedAt) {
        writeChatListProjection(box, {
          kind: 'upsertMeta',
          meta: { ...meta, updatedAt },
          fallbackTitle: scope.kind === 'group' ? '群聊' : '新聊天',
        })
        markNoticeApplied()
        return true
      }
      markNoticeApplied()
      return false
    }

    // 通知指向一条本地还看不见的会话：索引必须权威重取，再看它是否已经出现。
    if (!(await reconcileScope(scope, { force: true }))) return false
    const latestBox = scope.kind === 'group' ? (deps.getState().data as any)?.chatsByGroup?.[tid] : deps.getState().data?.chatsByRole?.[tid]
    if (!hasChatInBox(latestBox, cid)) return false
    markNoticeApplied()
    return true
  }

  function hasChatInBox(box: any, chatId: string): boolean {
    const metas = Array.isArray(box?.chatMetas) ? box.chatMetas : []
    if (metas.some((item: any) => String(item?.id || '') === chatId)) return true
    const chats = Array.isArray(box?.chats) ? box.chats : []
    return chats.some((item: any) => String(item?.id || '') === chatId)
  }

  function enqueueChatUpdatedNotice(raw: any) {
    // Direct chat-updated events are the normal path: the storage write has
    // already succeeded, so the UI can reconcile exactly the touched chat.
    // The promise chain keeps bursts ordered and prevents overlapping storage
    // reads from making the page compete with itself during active clicking.
    chatUpdatedNoticeChain = chatUpdatedNoticeChain
      .then(async () => {
        if (uiPollingDisposed) return
        const changed = await applyChatUpdatedNoticeOnce(raw)
        if (changed) deps.emit()
      })
      .catch(() => {})
  }

  function startDirectEventSubscription() {
    if (unsubscribeDirectEvents) return
    if (typeof deps.subscribeDirectEvents !== 'function') return
    unsubscribeDirectEvents = deps.subscribeDirectEvents((event: any) => {
      if (String(event?.name || '').trim() !== AI_CHAT_DIRECT_EVENT.chatUpdated) return
      enqueueChatUpdatedNotice(event?.payload)
      // 索引版本门只在事件到达时检查：空闲界面不产生任何请求。
      void uiPollTick()
    })
  }

  // 重连成功 / 页面重新可见：断线或隐藏期间的事件会丢，必须强制对账一次。
  function requestForceReconcile() {
    pendingForceReconcile = true
    void uiPollTick({ force: true })
  }

  const onVisibilityChange = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') requestForceReconcile()
  }

  function installReconcileTriggers() {
    if (typeof deps.onReconnected === 'function') {
      unsubscribeReconnected = deps.onReconnected(requestForceReconcile)
    }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibilityChange)
    if (typeof window !== 'undefined') window.addEventListener('online', requestForceReconcile)
  }

  function startUiPollers() {
    if (uiPollingDisposed) return
    // 只订阅事件与恢复触发点，不再创建任何定时器（5s tick / 15s 对账全部退役）。
    startDirectEventSubscription()
    installReconcileTriggers()
  }

  function stopUiPollers() {
    uiPollingDisposed = true
    if (unsubscribeDirectEvents) {
      unsubscribeDirectEvents()
      unsubscribeDirectEvents = null
    }
    if (unsubscribeReconnected) {
      unsubscribeReconnected()
      unsubscribeReconnected = null
    }
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibilityChange)
    if (typeof window !== 'undefined') window.removeEventListener('online', requestForceReconcile)
  }

  return {
    startUiPollers,
    stopUiPollers,
    uiPollTick,
    applyChatUpdatedNoticeOnce,
  }
}
