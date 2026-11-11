import * as React from 'react'
import {
  MESSAGE_BATCH_INITIAL_SIZE,
  MESSAGE_BATCH_SIZE,
  planMessageBatchMount,
  type MessageBatch,
  type MessageBatchGroup,
} from '../../domain/messageBatchMount'
import type { FrameBudgetOptions } from '../scheduling/frameBudget'
import { runFrameSlicedQueue } from '../scheduling/frameSlicedQueue'

type PlannedBatch = MessageBatch & { revealed: boolean }

type MountState = {
  sessionKey: string
  initialized: boolean
  anchorId: string
  anchorIndex: number
  batches: PlannedBatch[]
  // pendingIds 是按「从新到旧」排列的待上屏历史消息。
  // 切片器每次从这里取一段（最多一批），消费多少就移除多少。
  pendingIds: string[]
  // stagedSeq 保证每次切片的 React key 唯一（同 id 序列重复出现也不会撞 key）。
  stagedSeq: number
  // plannedIds 是「这份计划已经覆盖过的消息集合」。
  // 消息窗口往前翻时列表会变长，必须据此补批次，
  // 否则新加载的更早消息不在任何批次里，会「加载了但不显示」。
  plannedIds: Set<string>
}

type ScrollAnchor = {
  node: HTMLElement
  top: number
  scrollHeight: number
}

type StagedMarker = {
  sessionKey: string
  key: string
}

const STAGING_SELECTOR = '[data-fw-message-batch="staging"]'

function messageId(message: any) {
  return String(message?.id || '').trim()
}

const PAGED_BATCH_PREFIX = 'message-batch:older:'

function batchKey(seq: number, ids: readonly string[]): string {
  return `message-batch:slice:${seq}:${ids.length}`
}

function createMountState(sessionKey: string, messages: any[], initialSize: number, batchSize: number): MountState {
  const plan = planMessageBatchMount(messages, { initialSize, batchSize })
  const plannedIds = new Set<string>()
  for (const message of Array.isArray(messages) ? messages : []) {
    const id = messageId(message)
    if (id) plannedIds.add(id)
  }
  return {
    sessionKey,
    initialized: Array.isArray(messages) && messages.length > 0,
    anchorId: plan.anchorId,
    anchorIndex: plan.anchorIndex,
    batches: [],
    pendingIds: plan.batches.flatMap((batch) => batch.ids),
    stagedSeq: 0,
    plannedIds,
  }
}

// tailStartIndex 是「尾部可见区」的起点：anchor 及其之后的消息直接上屏，
// anchor 之前属于历史区（按批次渐进揭示）。
function tailStartIndex(state: MountState, messages: any[], initialSize: number): number {
  const anchoredIndex = state.anchorId
    ? messages.findIndex((message) => messageId(message) === state.anchorId)
    : -1
  return anchoredIndex >= 0 ? anchoredIndex : Math.max(0, messages.length - initialSize)
}

// hasUnplannedHistory 判断历史区里是否出现了这份计划尚未覆盖的消息。
// 会话窗口往前翻页时会命中，此时必须补批次，否则更早的消息永远不会上屏。
//
// 注意只检查历史区：尾部新到的消息本来就该直接可见，
// 把它们算进来会让「新消息」被当成「更早历史」慢慢揭示（新消息消失的根因）。
function hasUnplannedHistory(state: MountState, messages: any[], initialSize: number): boolean {
  const tailStart = tailStartIndex(state, messages, initialSize)
  for (let index = 0; index < tailStart; index++) {
    const id = messageId(messages[index])
    if (id && !state.plannedIds.has(id)) return true
  }
  return false
}

// appendUnplannedBatches 只补「历史区里计划未覆盖」的消息，已上屏内容保持原样。
//
// 不重新规划的理由：重新规划会把 batches 清空再逐批揭示，
// 用户已经看到的历史会短暂消失再重新长出来——翻页不该有这种闪烁。
//
// 顺序沿用既有约定：batches 按「从新到旧」存放，渲染时反向遍历，
// 于是最老的一块落在最上面。补进来的批次直接标记 revealed：
// 它们是用户主动要的「更早历史」，不需要再演一遍渐进上屏。
function appendUnplannedBatches(state: MountState, sessionKey: string, messages: any[], initialSize: number, batchSize: number): MountState {
  if (state.sessionKey !== sessionKey) return state
  const tailStart = tailStartIndex(state, messages, initialSize)
  const missing: string[] = []
  for (let index = 0; index < tailStart; index++) {
    const id = messageId(messages[index])
    if (!id || state.plannedIds.has(id)) continue
    missing.push(id)
  }
  if (!missing.length) return state
  const batches = state.batches.slice()
  for (let end = missing.length; end > 0; end -= batchSize) {
    const start = Math.max(0, end - batchSize)
    const ids = missing.slice(start, end)
    batches.push({ key: `${PAGED_BATCH_PREFIX}${ids[0]}:${ids[ids.length - 1]}`, ids, revealed: true })
  }
  const plannedIds = new Set(state.plannedIds)
  for (const id of missing) plannedIds.add(id)
  return { ...state, batches, plannedIds }
}

// stageSlice 把切片器给出的一段消息整批挂到屏幕外。
// 只有这段消息仍然是 pendingIds 的前缀时才接受，避免过期切片改到新会话的状态。
function stageSlice(state: MountState, sessionKey: string, key: string, ids: readonly string[]): MountState {
  if (state.sessionKey !== sessionKey || !ids.length) return state
  for (let index = 0; index < ids.length; index++) {
    if (state.pendingIds[index] !== ids[index]) return state
  }
  // batches 必须保持「从新到旧」：翻页补进来的更早历史直接落在数组末尾，
  // 因此尚未上屏的计划切片要插在它们前面，而不是排在更老的历史之后。
  const batches = state.batches.slice()
  const pagedIndex = batches.findIndex((batch) => batch.key.startsWith(PAGED_BATCH_PREFIX))
  batches.splice(pagedIndex < 0 ? batches.length : pagedIndex, 0, {
    key,
    ids: ids.slice(),
    revealed: false,
  })
  return {
    ...state,
    batches,
    pendingIds: state.pendingIds.slice(ids.length),
    stagedSeq: state.stagedSeq + 1,
  }
}

function revealBatch(state: MountState, sessionKey: string, key: string): MountState {
  if (state.sessionKey !== sessionKey) return state
  const index = state.batches.findIndex((batch) => batch.key === key)
  if (index < 0) return state
  const batch = state.batches[index]
  if (batch.revealed) return state
  const batches = state.batches.slice()
  batches[index] = { ...batch, revealed: true }
  return { ...state, batches }
}

// rollbackSlice 把「已挂到屏幕外但尚未揭示」的批次退回待上屏队列。
// 推进被取消（隐藏页、切换会话、锚点失效）时调用，保证恢复可见后
// 从原位置重新切片，而不是留一批半成品藏在 DOM 里。
function rollbackSlice(state: MountState, sessionKey: string, key: string): MountState {
  if (state.sessionKey !== sessionKey) return state
  const index = state.batches.findIndex((batch) => batch.key === key)
  if (index < 0) return state
  const batch = state.batches[index]
  if (batch.revealed) return state
  const batches = state.batches.slice()
  batches.splice(index, 1)
  return { ...state, batches, pendingIds: [...batch.ids, ...state.pendingIds] }
}

export function useMessageBatchMount(options: {
  sessionKey: string
  messages: any[]
  scrollRef: React.RefObject<HTMLElement | null>
  // active：只有可见页允许推进分批上屏。
  // 保活页（隐藏）不排队、不采样帧长、不触发让出，切回时从原进度继续。
  active?: boolean
  initialSize?: number
  batchSize?: number
  // frameBudget：测试注入点（可控时钟与让出函数）；生产环境全部走默认实现。
  frameBudget?: Omit<FrameBudgetOptions, 'maxTasksPerSlice'>
}): { batchGroups: MessageBatchGroup[]; visibleMessages: any[] } {
  const { sessionKey, messages, scrollRef } = options
  const active = options.active !== false
  const initialSize = Math.max(1, Math.floor(Number(options.initialSize ?? MESSAGE_BATCH_INITIAL_SIZE) || 1))
  const batchSize = Math.max(1, Math.floor(Number(options.batchSize ?? MESSAGE_BATCH_SIZE) || 1))

  const messagesRef = React.useRef(messages)
  messagesRef.current = messages

  const [state, setState] = React.useState<MountState>(() => createMountState(sessionKey, messages, initialSize, batchSize))
  const [readyKey, setReadyKey] = React.useState('')
  const [pumpVersion, setPumpVersion] = React.useState(0)
  const epochRef = React.useRef(0)
  const scrollAnchorRef = React.useRef<ScrollAnchor | null>(null)
  const runRef = React.useRef<{ cancel: () => void } | null>(null)
  const stagedRef = React.useRef<StagedMarker | null>(null)
  const mountedRef = React.useRef(true)
  const frameBudgetRef = React.useRef(options.frameBudget)
  frameBudgetRef.current = options.frameBudget

  const sessionState = state.sessionKey === sessionKey ? state : createMountState(sessionKey, messages, initialSize, batchSize)
  const effectiveState = !sessionState.initialized && messages.length > 0
    ? createMountState(sessionKey, messages, initialSize, batchSize)
    : sessionState

  React.useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const cancelProgression = React.useCallback(() => {
    epochRef.current += 1
    const run = runRef.current
    runRef.current = null
    run?.cancel()
    const staged = stagedRef.current
    stagedRef.current = null
    if (staged) {
      setState((prev) => rollbackSlice(prev, staged.sessionKey, staged.key))
    }
  }, [])

  // 就绪信号（readyKey）只表达「这一版布局已经提交并跨过一帧」，
  // 与推进的取消代数解耦：页面失活只该停下正在跑的推进，
  // 不该把已经提交的布局判成失效——否则这一帧被拦下来，
  // readyKey 就永远为空，历史区批次永远停在队列里（会话只显示尾部几条）。
  const layoutSessionRef = React.useRef('')
  const readyFrameRef = React.useRef(0)
  const armReady = React.useCallback(
    (session: string) => {
      if (!session) return
      if (readyFrameRef.current) return
      readyFrameRef.current = requestAnimationFrame(() => {
        readyFrameRef.current = 0
        // 布局已经换成别的会话：这一帧不再代表那版布局。
        if (layoutSessionRef.current !== session) return
        const node = scrollRef.current
        if (node) node.scrollTop = node.scrollHeight
        setReadyKey(session)
      })
    },
    [scrollRef],
  )

  React.useLayoutEffect(() => {
    cancelProgression()
    layoutSessionRef.current = sessionKey
    scrollAnchorRef.current = null
    setReadyKey('')
    setState(createMountState(sessionKey, messagesRef.current, initialSize, batchSize))
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
    armReady(sessionKey)
    return () => {
      if (readyFrameRef.current) {
        cancelAnimationFrame(readyFrameRef.current)
        readyFrameRef.current = 0
      }
      if (layoutSessionRef.current === sessionKey) layoutSessionRef.current = ''
      cancelProgression()
    }
  }, [sessionKey, initialSize, batchSize, scrollRef, cancelProgression, armReady])

  React.useEffect(() => {
    if (state.sessionKey !== sessionKey || state.initialized) return
    if (!messagesRef.current.length) return
    setState(createMountState(sessionKey, messagesRef.current, initialSize, batchSize))
  }, [sessionKey, state.sessionKey, state.initialized, messages.length, initialSize, batchSize])

  const anchorPresent = !effectiveState.anchorId || messages.some((message) => messageId(message) === effectiveState.anchorId)
  React.useEffect(() => {
    if (!effectiveState.initialized || !effectiveState.anchorId || anchorPresent) return
    cancelProgression()
    scrollAnchorRef.current = null
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
    setState(createMountState(sessionKey, messagesRef.current, initialSize, batchSize))
  }, [sessionKey, effectiveState.initialized, effectiveState.anchorId, anchorPresent, initialSize, batchSize, scrollRef, cancelProgression])

  // 窗口往前翻页：只补历史区的批次，不重排已上屏内容（翻页不该闪烁）。
  React.useEffect(() => {
    if (!effectiveState.initialized) return
    if (!hasUnplannedHistory(effectiveState, messagesRef.current, initialSize)) return
    setState((prev) => appendUnplannedBatches(prev, sessionKey, messagesRef.current, initialSize, batchSize))
  }, [sessionKey, effectiveState.initialized, messages.length, initialSize, batchSize])

  const captureScrollAnchor = React.useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    let node: HTMLElement | null = null
    for (const candidate of Array.from(el.querySelectorAll<HTMLElement>('[data-mid]'))) {
      if (candidate.closest(STAGING_SELECTOR)) continue
      node = candidate
      break
    }
    if (!node) return
    scrollAnchorRef.current = {
      node,
      top: node.getBoundingClientRect().top,
      scrollHeight: el.scrollHeight,
    }
  }, [scrollRef])

  const startProgression = React.useCallback((pendingIds: readonly string[], stagedSeq: number) => {
    if (runRef.current) return
    const epoch = epochRef.current
    const session = sessionKey
    let sliceSeq = stagedSeq
    const run = runFrameSlicedQueue<string>({
      items: pendingIds.slice(),
      maxItemsPerSlice: batchSize,
      ratio: frameBudgetRef.current?.ratio,
      frameLengthMs: frameBudgetRef.current?.frameLengthMs,
      now: frameBudgetRef.current?.now,
      yieldToMain: frameBudgetRef.current?.yieldToMain,
      onSlice: async (ids, timing) => {
        if (timing.isCancelled() || epoch !== epochRef.current) return
        const key = batchKey(sliceSeq, ids)
        sliceSeq += 1
        stagedRef.current = { sessionKey: session, key }
        setState((prev) => stageSlice(prev, session, key, ids))
        if (!(await timing.nextFrame())) return
        if (!(await timing.nextFrame())) return
        if (timing.isCancelled() || epoch !== epochRef.current) return
        captureScrollAnchor()
        setState((prev) => revealBatch(prev, session, key))
        if (stagedRef.current?.key === key) stagedRef.current = null
        await timing.nextFrame()
      },
    })
    const handle = { cancel: run.cancel }
    runRef.current = handle
    void run.done.then(
      (reason) => {
        if (runRef.current === handle) runRef.current = null
        if (reason === 'completed' && mountedRef.current) setPumpVersion((version) => version + 1)
      },
      (error: unknown) => {
        if (runRef.current === handle) runRef.current = null
        cancelProgression()
        if (typeof console !== 'undefined' && typeof console.error === 'function') {
          console.error('[useMessageBatchMount] batch progression failed', error)
        }
      },
    )
  }, [batchSize, sessionKey, captureScrollAnchor, cancelProgression])

  React.useEffect(() => {
    if (!active) cancelProgression()
  }, [active, cancelProgression])

  // 页面从缓存页回到可见页时补一次就绪信号：
  // 失活会让推进停下（未揭示的切片退回队列），但「这一版布局已提交」的事实没变，
  // 重新激活只需要重新放行，不必重建状态。
  React.useEffect(() => {
    if (!active) return
    if (!sessionKey) return
    if (readyKey === sessionKey) return
    armReady(sessionKey)
  }, [active, sessionKey, readyKey, armReady])

  React.useEffect(() => {
    if (!active) return
    if (readyKey !== sessionKey) return
    if (state.sessionKey !== sessionKey || !state.initialized) return
    if (runRef.current) return
    if (!state.pendingIds.length) return
    startProgression(state.pendingIds, state.stagedSeq)
  }, [active, readyKey, sessionKey, state, pumpVersion, startProgression])

  React.useLayoutEffect(() => {
    const anchor = scrollAnchorRef.current
    const el = scrollRef.current
    if (!anchor || !el) return
    scrollAnchorRef.current = null
    const nodeTop = anchor.node.isConnected ? anchor.node.getBoundingClientRect().top : Number.NaN
    const delta = Number.isFinite(nodeTop) ? nodeTop - anchor.top : el.scrollHeight - anchor.scrollHeight
    if (!delta) return
    el.scrollTop = Math.max(0, el.scrollTop + delta)
  }, [state.batches, scrollRef])

  const rendered = React.useMemo(() => {
    const byId = new Map<string, any>()
    for (const message of messages) {
      const id = messageId(message)
      if (!id || byId.has(id)) continue
      byId.set(id, message)
    }

    const seen = new Set<string>()
    const batchGroups: MessageBatchGroup[] = []
    for (let i = effectiveState.batches.length - 1; i >= 0; i--) {
      const batch = effectiveState.batches[i]
      const groupMessages: any[] = []
      for (const id of batch.ids) {
        if (seen.has(id)) continue
        const message = byId.get(id)
        if (!message) continue
        seen.add(id)
        groupMessages.push(message)
      }
      if (!groupMessages.length) continue
      batchGroups.push({ key: batch.key, messages: groupMessages, revealed: batch.revealed })
    }

    const anchoredIndex = effectiveState.anchorId
      ? messages.findIndex((message) => messageId(message) === effectiveState.anchorId)
      : -1
    const tailStart = anchoredIndex >= 0 ? anchoredIndex : Math.max(0, messages.length - initialSize)
    const visibleMessages: any[] = []
    for (let i = tailStart; i < messages.length; i++) {
      const message = messages[i]
      if (!message) continue
      const id = messageId(message)
      if (id) {
        if (seen.has(id)) continue
        seen.add(id)
      }
      visibleMessages.push(message)
    }

    return { batchGroups, visibleMessages }
  }, [effectiveState, messages, initialSize])

  return rendered
}
