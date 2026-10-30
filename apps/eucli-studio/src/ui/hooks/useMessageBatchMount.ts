import * as React from 'react'
import {
  MESSAGE_BATCH_INITIAL_SIZE,
  MESSAGE_BATCH_SIZE,
  MESSAGE_BATCH_YIELD_MS,
  planMessageBatchMount,
  type MessageBatch,
  type MessageBatchGroup,
} from '../../domain/messageBatchMount'

type PlannedBatch = MessageBatch & { revealed: boolean }

type MountState = {
  sessionKey: string
  initialized: boolean
  anchorId: string
  anchorIndex: number
  batches: PlannedBatch[]
  pending: MessageBatch[]
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

const STAGING_SELECTOR = '[data-fw-message-batch="staging"]'

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
    pending: plan.batches,
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
    batches.push({ key: `message-batch:older:${ids[0]}:${ids[ids.length - 1]}`, ids, revealed: true })
  }
  const plannedIds = new Set(state.plannedIds)
  for (const id of missing) plannedIds.add(id)
  return { ...state, batches, plannedIds }
}

function messageId(message: any) {
  return String(message?.id || '').trim()
}

function revealLastBatch(state: MountState, sessionKey: string): MountState {
  if (state.sessionKey !== sessionKey || !state.batches.length) return state
  const index = state.batches.length - 1
  const batch = state.batches[index]
  if (batch.revealed) return state
  const batches = state.batches.slice()
  batches[index] = { ...batch, revealed: true }
  return { ...state, batches }
}

function stageNextBatch(state: MountState, sessionKey: string): MountState {
  if (state.sessionKey !== sessionKey || !state.pending.length) return state
  const [next, ...pending] = state.pending
  return { ...state, pending, batches: [...state.batches, { ...next, revealed: false }] }
}

export function useMessageBatchMount(options: {
  sessionKey: string
  messages: any[]
  scrollRef: React.RefObject<HTMLElement | null>
  // pageActive：只有可见页允许推进分批上屏。
  // 保活页（隐藏）不排队、不触发 setTimeout，切回时从原进度继续。
  active?: boolean
  initialSize?: number
  batchSize?: number
  yieldMs?: number
}): { batchGroups: MessageBatchGroup[]; visibleMessages: any[] } {
  const { sessionKey, messages, scrollRef } = options
  const active = options.active !== false
  const initialSize = Math.max(1, Math.floor(Number(options.initialSize ?? MESSAGE_BATCH_INITIAL_SIZE) || 1))
  const batchSize = Math.max(1, Math.floor(Number(options.batchSize ?? MESSAGE_BATCH_SIZE) || 1))
  const yieldMs = Math.max(0, Math.floor(Number(options.yieldMs ?? MESSAGE_BATCH_YIELD_MS) || 0))

  const messagesRef = React.useRef(messages)
  messagesRef.current = messages

  const [state, setState] = React.useState<MountState>(() => createMountState(sessionKey, messages, initialSize, batchSize))
  const [readyKey, setReadyKey] = React.useState('')
  const epochRef = React.useRef(0)
  const scrollAnchorRef = React.useRef<ScrollAnchor | null>(null)

  const sessionState = state.sessionKey === sessionKey ? state : createMountState(sessionKey, messages, initialSize, batchSize)
  const effectiveState = !sessionState.initialized && messages.length > 0
    ? createMountState(sessionKey, messages, initialSize, batchSize)
    : sessionState

  React.useLayoutEffect(() => {
    epochRef.current += 1
    const epoch = epochRef.current
    scrollAnchorRef.current = null
    setReadyKey('')
    setState(createMountState(sessionKey, messagesRef.current, initialSize, batchSize))
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
    const frame = requestAnimationFrame(() => {
      if (epoch !== epochRef.current) return
      const node = scrollRef.current
      if (node) node.scrollTop = node.scrollHeight
      setReadyKey(sessionKey)
    })
    return () => {
      epochRef.current += 1
      cancelAnimationFrame(frame)
    }
  }, [sessionKey, initialSize, batchSize, scrollRef])

  React.useEffect(() => {
    if (state.sessionKey !== sessionKey || state.initialized) return
    if (!messagesRef.current.length) return
    setState(createMountState(sessionKey, messagesRef.current, initialSize, batchSize))
  }, [sessionKey, state.sessionKey, state.initialized, messages.length, initialSize, batchSize])

  const anchorPresent = !effectiveState.anchorId || messages.some((message) => messageId(message) === effectiveState.anchorId)
  React.useEffect(() => {
    if (!effectiveState.initialized || !effectiveState.anchorId || anchorPresent) return
    epochRef.current += 1
    scrollAnchorRef.current = null
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
    setState(createMountState(sessionKey, messagesRef.current, initialSize, batchSize))
  }, [sessionKey, effectiveState.initialized, effectiveState.anchorId, anchorPresent, initialSize, batchSize, scrollRef])

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

  React.useEffect(() => {
    if (!active) return
    if (readyKey !== sessionKey) return
    if (state.sessionKey !== sessionKey || !state.initialized) return

    const staging = state.batches.length ? state.batches[state.batches.length - 1] : null
    if (staging && !staging.revealed) {
      const epoch = epochRef.current
      let secondFrame = 0
      const firstFrame = requestAnimationFrame(() => {
        if (epoch !== epochRef.current) return
        secondFrame = requestAnimationFrame(() => {
          if (epoch !== epochRef.current) return
          captureScrollAnchor()
          setState((prev) => revealLastBatch(prev, sessionKey))
        })
      })
      return () => {
        cancelAnimationFrame(firstFrame)
        cancelAnimationFrame(secondFrame)
      }
    }

    if (!state.pending.length) return
    const epoch = epochRef.current
    const timer = setTimeout(() => {
      if (epoch !== epochRef.current) return
      setState((prev) => stageNextBatch(prev, sessionKey))
    }, yieldMs)
    return () => clearTimeout(timer)
  }, [active, readyKey, sessionKey, state, yieldMs, captureScrollAnchor])

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
