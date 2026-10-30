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
}

type ScrollAnchor = {
  node: HTMLElement
  top: number
  scrollHeight: number
}

const STAGING_SELECTOR = '[data-fw-message-batch="staging"]'

function createMountState(sessionKey: string, messages: any[], initialSize: number, batchSize: number): MountState {
  const plan = planMessageBatchMount(messages, { initialSize, batchSize })
  return {
    sessionKey,
    initialized: Array.isArray(messages) && messages.length > 0,
    anchorId: plan.anchorId,
    anchorIndex: plan.anchorIndex,
    batches: [],
    pending: plan.batches,
  }
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
