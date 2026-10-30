import { chatMetaFromChat, chatMetasFromBox, upsertChatMeta } from '../domain/chatMeta'
import { normalizeStoredChat } from '../storage/normalizeStoredChat'
import { isStoredChatNewerThanCurrent, mergeChatFromStorage } from '../domain/chatStorageSync'
import { pendingChatForTarget } from '../domain/pendingChat'
import { readActiveEbRunCardsForTarget } from '../domain/activeRunCards'
import { AI_CHAT_DIRECT_EVENT } from '../protocol/aiChatProtocol'
import { projectionScopeKey, type ChatIndexSnapshot, type ProjectionScope } from '../storage/splitProjectionCache'

type DirectEventSubscription = (listener: (event: any) => void) => () => void

// 去轮询（design-5 第九节）：
//
//   5s UI tick       → 删除定时器，保留 tick 函数（由事件驱动按需调用）
//   15s meta 对账    → 降级为版本门（revision 不变就什么都不做）
//   15s notice 对账  → 删除（studio 侧没有生产者，轮询一个永远不存在的键）
//
// 真正必需的安全网只剩三个：启动快照、桥接层重连、用户发起的有限期任务跟踪。
//
// 版本门（design-5 P4「revision + 缺口检测」）：
//   1. 必须读到服务端最新 revision —— 缓存命中也要做一次轻量确认；
//   2. 必须按 scope 记录已应用版本 —— 全局单值会让切到另一个 target 后永不刷新；
//   3. 重连成功 / 页面重新可见时强制对账一次 —— 断线期间的缺口只能这样补齐。

export function createUiPolling(deps: {
  getState: () => any
  loadSplitMeta: () => Promise<any>
  getSplitMetaCache: () => any
  emit: () => void
  subscribeDirectEvents?: DirectEventSubscription
  // 连接重建成功：断线期间可能漏掉事件，必须强制对账。
  onReconnected?: (listener: () => void) => () => void
  activeTargetKind: () => string
  activeChatFromData: () => any
  syncActiveGroupChatsFromStorage: () => Promise<void>
  // 会话索引缓存：对账走版本门；确认最新版本时必须绕过缓存（refreshChatIndex）。
  loadChatIndex: (scope: ProjectionScope) => Promise<ChatIndexSnapshot | null>
  // 版本确认：即使缓存命中也要向服务端确认最新 revision。
  // 缺席时回落到 loadChatIndex（旧后端没有 revision 语义）。
  refreshChatIndex?: (scope: ProjectionScope) => Promise<ChatIndexSnapshot | null>
  // 会话正文：统一走 ChatBodyLoader（单飞 + LRU），不再各自直读 storage。
  loadChatBody: (scope: ProjectionScope, chatId: string) => Promise<any>
  // 写路径 / 事件驱动的重取：重取首窗但保留已翻出的更早窗口。
  // 缺席时回落到 loadChatBody（旧后端整份会话，语义等价）。
  reloadChatBody?: (scope: ProjectionScope, chatId: string) => Promise<any>
  invalidateSessionIndex?: (kind: 'role' | 'group', targetId: string) => void
}) {
  // 已应用的索引版本按 scope 记录：不同 target 各自一条版本门。
  const appliedIndexRevisions = new Map<string, number>()
  let uiChatSyncing = false
  let uiLastChatUpdatedNoticeId = ''
  let uiPollingDisposed = false
  let unsubscribeDirectEvents: (() => void) | null = null
  let unsubscribeReconnected: (() => void) | null = null
  let chatUpdatedNoticeChain = Promise.resolve()
  // force 表示「这次不看版本门，必须对账」：重连 / 可见性恢复 / 首次进入。
  let pendingForceReconcile = false

  function hasActiveRunInSession(targetKind: 'role' | 'group' | 'workspace', targetId: string, chatId: string) {
    return readActiveEbRunCardsForTarget(deps.getState(), targetKind, targetId, chatId).length > 0
  }

  async function loadTargetFolder(activeKind: 'role' | 'group', activeTid: string) {
    if (!activeTid) return ''
    let meta = deps.getSplitMetaCache()
    let folder = activeKind === 'group' ? String((meta as any)?.groupFolders?.[activeTid] || '').trim() : String(meta?.roleFolders?.[activeTid] || '').trim()
    if (meta && folder) return folder
    meta = await deps.loadSplitMeta()
    folder = activeKind === 'group' ? String((meta as any)?.groupFolders?.[activeTid] || '').trim() : String(meta?.roleFolders?.[activeTid] || '').trim()
    return folder
  }

  // 事件驱动的重取：窗口模式下必须保留已翻出的更早窗口，
  // 否则一次外部更新就会把长会话缩回首屏。
  async function reloadChatBody(scope: ProjectionScope, chatId: string) {
    if (typeof deps.reloadChatBody === 'function') return deps.reloadChatBody(scope, chatId)
    return deps.loadChatBody(scope, chatId)
  }

  // 会话索引统一从投影缓存读：版本门只看索引自己的 revision，
  // 绝不看 meta.updatedAt（它已降级为纯展示排序字段）。
  async function loadActiveTargetIndex(activeKind: 'role' | 'group', activeTid: string, options?: { confirmLatest?: boolean }) {
    if (!activeTid) return null
    const scope: ProjectionScope = { kind: activeKind, targetId: activeTid }
    // 版本确认必须绕过缓存：命中缓存直接返回会让版本门永远看到同一个旧 revision。
    const loader = options?.confirmLatest && typeof deps.refreshChatIndex === 'function'
      ? deps.refreshChatIndex
      : deps.loadChatIndex
    const snapshot = await loader(scope)
    if (!snapshot) return null
    return snapshot
  }

  async function syncActiveRoleChatsFromStorage(snapshot?: ChatIndexSnapshot | null, folderOverride?: string) {
    const state = deps.getState()
    if (!state.data) return
    if (uiChatSyncing) return
    uiChatSyncing = true
    try {
      const rid = String(state.draft.activeRoleId || state.data?.ui?.activeRoleId || '')
      if (!rid) return

      const folder = String(folderOverride || '').trim() || (await loadTargetFolder('role', rid))
      const index = snapshot || (await deps.loadChatIndex({ kind: 'role', targetId: rid }))
      if (!folder || !index) return

      const chatMetas = index.chatMetas.length ? index.chatMetas : chatMetasFromBox(index, '新聊天')
      const desiredChatIds = chatMetas.map((x: any) => String(x?.id || '')).filter((x: any) => !!x)
      const desiredActiveChatId = String(index.activeChatId || '')
      const wantUpdatedAt = index.chatUpdatedAt || {}

      if (!state.data.chatsByRole || typeof state.data.chatsByRole !== 'object') state.data.chatsByRole = {}
      if (!state.data.chatsByRole[rid] || typeof state.data.chatsByRole[rid] !== 'object') state.data.chatsByRole[rid] = { activeChatId: '', chats: [] }
      const box = state.data.chatsByRole[rid]
      if (!Array.isArray(box.chats)) box.chats = []

      const keepChatNow = String(box.activeChatId || '')
      const activeChatId = keepChatNow || desiredActiveChatId || String(desiredChatIds[0] || '')

      const curById = new Map<string, any>()
      for (const c of box.chats) {
        const cid = String(c?.id || '')
        if (cid) curById.set(cid, c)
      }

      const nextChats: any[] = []
      for (const cid of desiredChatIds) {
        const cur = curById.get(cid) || null
        if (!cur) continue
        const metaUpdatedAt = Number(wantUpdatedAt[cid] || 0)
        if (metaUpdatedAt && cid !== activeChatId && isStoredChatNewerThanCurrent(metaUpdatedAt, cur.updatedAt)) cur.updatedAt = metaUpdatedAt
        nextChats.push(cur)
      }

      if (activeChatId) {
        const metaUpdatedAt = Number(wantUpdatedAt[activeChatId] || 0)
        const cur = curById.get(activeChatId) || null
        const curUpdatedAt = Number(cur?.updatedAt || 0)
        if (!hasActiveRunInSession('role', rid, activeChatId) && isStoredChatNewerThanCurrent(metaUpdatedAt, curUpdatedAt)) {
          const c0 = await reloadChatBody({ kind: 'role', targetId: rid }, activeChatId)
          const c1 = c0 && typeof c0 === 'object' ? normalizeStoredChat(c0, 'role') : null
          if (c1) {
            const idx0 = nextChats.findIndex((c: any) => String(c?.id || '') === activeChatId)
            if (idx0 >= 0) nextChats[idx0] = mergeChatFromStorage(c1, nextChats[idx0])
            else nextChats.unshift(c1)
          }
        }
      }

      box.chats = nextChats
      box.chatMetas = chatMetas

      if (keepChatNow && desiredChatIds.includes(keepChatNow)) box.activeChatId = keepChatNow
      else if (desiredActiveChatId && desiredChatIds.includes(desiredActiveChatId)) box.activeChatId = desiredActiveChatId
      else box.activeChatId = String(desiredChatIds[0] || '')
    } finally {
      uiChatSyncing = false
    }
  }

  async function syncActiveTargetChatsFromStorage(snapshot?: ChatIndexSnapshot | null) {
    if (deps.activeTargetKind() === 'workspace') return false
    if (deps.activeTargetKind() === 'group') return deps.syncActiveGroupChatsFromStorage()
    return syncActiveRoleChatsFromStorage(snapshot)
  }

  async function syncChatByIdFromStorage(roleId: any, chatId: any) {
    const state = deps.getState()
    if (!state.data) return false
    const rid = String(roleId || '').trim()
    const cid = String(chatId || '').trim()
    if (!rid || !cid) return false
    if (hasActiveRunInSession('role', rid, cid)) return false

    const folder = await loadTargetFolder('role', rid)
    if (!folder) return false

    const raw = await reloadChatBody({ kind: 'role', targetId: rid }, cid)
    const chat = raw && typeof raw === 'object' ? normalizeStoredChat(raw, 'role') : null
    if (!chat) return false

    if (!state.data.chatsByRole || typeof state.data.chatsByRole !== 'object') state.data.chatsByRole = {}
    if (!state.data.chatsByRole[rid] || typeof state.data.chatsByRole[rid] !== 'object') state.data.chatsByRole[rid] = { activeChatId: '', chats: [] }
    const box = state.data.chatsByRole[rid]
    if (!Array.isArray(box.chats)) box.chats = []

    const idx = box.chats.findIndex((c: any) => String(c?.id || '') === cid)
    const nextChat = mergeChatFromStorage(chat, idx >= 0 ? box.chats[idx] : null)
    if (idx >= 0) box.chats[idx] = nextChat
    else box.chats.unshift(nextChat)
    box.chatMetas = upsertChatMeta(box.chatMetas, chatMetaFromChat(nextChat, '新聊天'), '新聊天')

    return true
  }

  async function syncGroupChatByIdFromStorage(groupId: any, chatId: any) {
    const state = deps.getState()
    if (!state.data) return false
    const gid = String(groupId || '').trim()
    const cid = String(chatId || '').trim()
    if (!gid || !cid) return false
    if (hasActiveRunInSession('group', gid, cid)) return false

    const folder = await loadTargetFolder('group', gid)
    if (!folder) return false

    const raw = await reloadChatBody({ kind: 'group', targetId: gid }, cid)
    const chat = raw && typeof raw === 'object' ? normalizeStoredChat(raw, 'group') : null
    if (!chat) return false

    if (!(state.data as any).chatsByGroup || typeof (state.data as any).chatsByGroup !== 'object') (state.data as any).chatsByGroup = {}
    if (!(state.data as any).chatsByGroup[gid] || typeof (state.data as any).chatsByGroup[gid] !== 'object') (state.data as any).chatsByGroup[gid] = { activeChatId: '', chats: [] }
    const box = (state.data as any).chatsByGroup[gid]
    if (!Array.isArray(box.chats)) box.chats = []

    const idx = box.chats.findIndex((c: any) => String(c?.id || '') === cid)
    const nextChat = mergeChatFromStorage(chat, idx >= 0 ? box.chats[idx] : null)
    if (idx >= 0) box.chats[idx] = nextChat
    else box.chats.unshift(nextChat)
    box.chatMetas = upsertChatMeta(box.chatMetas, chatMetaFromChat(nextChat, '群聊'), '群聊')

    return true
  }

  // applyChatUpdatedNoticeOnce 只处理「事件里直接带来的通知」：
  // studio 侧没有 runtime notice 生产者，因此不再回读 storage（那是在轮询一个不存在的键）。
  async function applyChatUpdatedNoticeOnce(noticeOverride?: any) {
    const state = deps.getState()
    if (state.loading || !state.data) return false
    const raw = noticeOverride && typeof noticeOverride === 'object' ? noticeOverride : null
    if (!raw) return false

    const nid = String((raw as any).id || '')
    if (!nid || nid === uiLastChatUpdatedNoticeId) return false

    const markNoticeApplied = () => {
      // A notice is marked only after the UI has either applied it or proved the
      // visible data is already current. Seeing a notice is not the same as
      // reconciling it.
      uiLastChatUpdatedNoticeId = nid
    }

    const hasNoticeChatInActiveTarget = () => {
      const latestState = deps.getState()
      const latestBox = kind === 'group' ? (latestState.data as any)?.chatsByGroup?.[tid] : kind === 'workspace' ? (latestState.data as any)?.chatsByWorkspace?.[tid] : latestState.data?.chatsByRole?.[tid]
      const latestMetas = Array.isArray(latestBox?.chatMetas) ? latestBox.chatMetas : []
      const latestChats = Array.isArray(latestBox?.chats) ? latestBox.chats : []
      return latestMetas.some((c: any) => String(c?.id || '') === cid) || latestChats.some((c: any) => String(c?.id || '') === cid)
    }

    const kindText = String((raw as any).targetKind || '').trim()
    const kind = kindText === 'group' ? 'group' : kindText === 'workspace' ? 'workspace' : 'role'
    const tid = String((raw as any).targetId || (raw as any).roleId || '').trim()
    const cid = String((raw as any).chatId || '').trim()
    const updatedAt = Number((raw as any).updatedAt || 0)
    if (!tid || !cid) return false

    const activeKind = deps.activeTargetKind()
    const activeTid =
      activeKind === 'group'
        ? String((state.draft as any).activeGroupId || (state.data?.ui as any)?.activeGroupId || '').trim()
        : activeKind === 'workspace'
          ? String((state.draft as any).activeWorkspaceId || (state.data?.ui as any)?.activeWorkspaceId || '').trim()
        : String(state.draft.activeRoleId || state.data?.ui?.activeRoleId || '').trim()
    if (!activeTid || kind !== activeKind || tid !== activeTid) return false
    if (pendingChatForTarget(state, kind, tid)) return false

    const activeBox = kind === 'group' ? (state.data as any)?.chatsByGroup?.[tid] : kind === 'workspace' ? (state.data as any)?.chatsByWorkspace?.[tid] : state.data?.chatsByRole?.[tid]
    const activeChatId = String(deps.activeChatFromData()?.id || activeBox?.activeChatId || '').trim()
    if (!activeChatId) {
      // A notice for the current target can be the first chat created by another
      // window/client. In that case there is no active chat yet, so the correct
      // root action is to reconcile the target index before looking for a chat.
      deps.invalidateSessionIndex?.(kind as 'role' | 'group', tid)
      await syncActiveTargetChatsFromStorage()
      if (!hasNoticeChatInActiveTarget()) return false
      markNoticeApplied()
      return true
    }
    if (activeChatId && cid === activeChatId) {
      if (hasActiveRunInSession(kind, tid, cid)) return false
      const currentUpdatedAt = Number(deps.activeChatFromData()?.updatedAt || 0)
      if (updatedAt && currentUpdatedAt && updatedAt <= currentUpdatedAt) {
        markNoticeApplied()
        return false
      }
      const ok = kind === 'group' ? await syncGroupChatByIdFromStorage(tid, cid) : kind === 'workspace' ? false : await syncChatByIdFromStorage(tid, cid)
      if (ok) markNoticeApplied()
      return !!ok
    }

    const box = activeBox
    const metas = Array.isArray(box?.chatMetas) ? box.chatMetas : []
    const it = metas.find((c: any) => String(c?.id || '') === cid) || null
    if (it && updatedAt && Number(it.updatedAt || 0) !== updatedAt) {
      it.updatedAt = updatedAt
      markNoticeApplied()
      return true
    }
    if (it && updatedAt && Number(it.updatedAt || 0) === updatedAt) markNoticeApplied()
    if (!it) {
      // A notice for a non-active chat may point to a newly-created chat that is
      // not in the local target list yet. Reconcile the target index, then mark
      // the notice only if that concrete chat is now visible locally.
      deps.invalidateSessionIndex?.(kind as 'role' | 'group', tid)
      await syncActiveTargetChatsFromStorage()
      if (!hasNoticeChatInActiveTarget()) return false
      markNoticeApplied()
      return true
    }

    return false
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

  // uiPollTick 不再由定时器驱动：它是「版本门」的唯一实现，
  // 由事件（chat-updated）/ 重连 / 可见性恢复 / 显式调用触发。
  //
  // options.force 表示「不看版本门，必须对账」：
  // 断线期间可能漏掉事件，只能靠强制对账补齐缺口。
  async function uiPollTick(options?: { force?: boolean }) {
    if (uiPollingDisposed) return
    const state = deps.getState()
    if (state.loading || !state.data) return

    const activeKind = deps.activeTargetKind() === 'group' ? 'group' : deps.activeTargetKind() === 'workspace' ? 'workspace' : 'role'
    if (activeKind === 'workspace') return
    const activeTid =
      activeKind === 'group'
        ? String((state.draft as any).activeGroupId || (state.data?.ui as any)?.activeGroupId || '').trim()
        : String(state.draft.activeRoleId || state.data?.ui?.activeRoleId || '').trim()
    if (!activeTid || pendingChatForTarget(state, activeKind, activeTid)) return

    const scope: ProjectionScope = { kind: activeKind, targetId: activeTid }
    const scopeKey = projectionScopeKey(scope)
    const force = !!options?.force || pendingForceReconcile
    try {
      // 版本门必须观察服务端最新 revision：这里始终做一次轻量确认（缓存命中也要确认）。
      const snapshot = await loadActiveTargetIndex(activeKind, activeTid, { confirmLatest: true })
      if (!snapshot) return
      const revision = Number(snapshot.revision || 0)
      // 版本门：revision 没变就什么都不做，绝不再「事件没来就全量重算」。
      // 但强制对账时忽略版本门：断线 / 隐藏期间的变化不会产生事件。
      if (!force && revision && appliedIndexRevisions.get(scopeKey) === revision) return
      await syncActiveTargetChatsFromStorage(snapshot)
      if (revision) appliedIndexRevisions.set(scopeKey, revision)
      pendingForceReconcile = false
      deps.emit()
    } catch {
      // 版本门是后台对账：单次失败不打扰用户，下一次事件 / 重连会再试。
    }
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
    syncActiveRoleChatsFromStorage,
    syncActiveTargetChatsFromStorage,
    syncChatByIdFromStorage,
    syncGroupChatByIdFromStorage,
    applyChatUpdatedNoticeOnce,
  }
}
