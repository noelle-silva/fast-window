import { now, uid } from '../core/utils'

export const ASSISTANT_RUNNING_CONTENT = '（生成中…）'

export type AssistantRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'
export type AssistantRunMode = 'new' | 'regenerate' | 'tool-followup'

export type AssistantRunState = {
  generationId: string
  status: AssistantRunStatus
  mode: AssistantRunMode
  stream: boolean
  startedAt: number
  updatedAt: number
  finishedAt?: number
}

export type AssistantRunSignal = {
  text: string
  generationId: string
  status?: AssistantRunStatus
  updatedAt?: number
  finishedAt?: number
  expiresAt?: number
}

export type AssistantMessageMergeOptions = {
  storedChatStatus?: unknown
}

function normalizeRunStatus(value: unknown): AssistantRunStatus {
  const s = String(value || '').trim()
  if (s === 'queued' || s === 'running' || s === 'succeeded' || s === 'failed' || s === 'canceled') return s
  return 'running'
}

function normalizeRunMode(value: unknown): AssistantRunMode {
  const s = String(value || '').trim()
  if (s === 'regenerate' || s === 'tool-followup') return s
  return 'new'
}

function finiteTime(value: unknown, fallback: number) {
  const n = Number(value)
  return isFinite(n) && n > 0 ? n : fallback
}

function isTerminalStoredChatStatus(value: unknown) {
  const status = String(value || '').trim().toLowerCase()
  return status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'canceled'
}

function isTerminalToolPartState(value: unknown) {
  const state = String(value || '').trim().toLowerCase()
  return state === 'completed' || state === 'denied' || state === 'cancelled' || state === 'canceled' || state === 'error' || state === 'failed'
}

export function hasSettledAssistantToolParts(message: unknown) {
  const m = message && typeof message === 'object' ? (message as any) : null
  if (!m || m.role !== 'assistant') return false
  const parts = Array.isArray(m?.parts) ? m.parts.filter((part: any) => String(part?.type || '') === 'tool') : []
  if (!parts.length) return false
  let hasSettledPart = false
  for (const part of parts) {
    const settled = isTerminalToolPartState(part?.state) || !!(part?.result && typeof part.result === 'object')
    if (!settled) return false
    hasSettledPart = true
  }
  return hasSettledPart
}

function storedMessageSettlesActiveRun(stored: any, options?: AssistantMessageMergeOptions) {
  if (isTerminalStoredChatStatus(options?.storedChatStatus)) return true
  if (stored?.error && typeof stored.error === 'object') return true
  return hasSettledAssistantToolParts(stored)
}

export function normalizeAssistantRunState(raw: unknown): AssistantRunState | null {
  const r = raw && typeof raw === 'object' ? (raw as any) : null
  if (!r) return null
  const generationId = String(r.generationId || '').trim()
  if (!generationId) return null
  const t = now()
  const status = normalizeRunStatus(r.status)
  const startedAt = finiteTime(r.startedAt, finiteTime(r.updatedAt, t))
  const updatedAt = finiteTime(r.updatedAt, startedAt)
  const finishedAt = finiteTime(r.finishedAt, 0)
  const out: AssistantRunState = {
    generationId,
    status,
    mode: normalizeRunMode(r.mode),
    stream: !!r.stream,
    startedAt,
    updatedAt,
  }
  if (finishedAt > 0) out.finishedAt = finishedAt
  return out
}

export function isAssistantRunActive(run: unknown) {
  const r = normalizeAssistantRunState(run)
  return !!r && (r.status === 'queued' || r.status === 'running')
}

export function isAssistantGenerating(message: unknown) {
  const m = message && typeof message === 'object' ? (message as any) : null
  if (!m || m.role !== 'assistant') return false
  const run = normalizeAssistantRunState(m.assistantRun)
  if (run) return isAssistantRunActive(run)
  return m.pending === true
}

export function isAssistantRunInterrupted(message: unknown) {
  const m = message && typeof message === 'object' ? (message as any) : null
  if (!m || m.role !== 'assistant') return false
  const run = normalizeAssistantRunState(m.assistantRun)
  if (run && (run.status === 'failed' || run.status === 'canceled')) return true
  return !!(m.error && typeof m.error === 'object')
}

export function hasAssistantVisibleOutput(message: unknown) {
  const m = message && typeof message === 'object' ? (message as any) : null
  if (!m || m.role !== 'assistant') return false
  const content = String(m.content ?? '').trim()
  if (content && content !== ASSISTANT_RUNNING_CONTENT) return true
  const parts = Array.isArray(m.parts) ? m.parts : []
  return parts.some((part: any) => {
    if (!part || typeof part !== 'object') return false
    const type = String(part.type || '').trim()
    if (type === 'text') return !!String(part.text || '').trim()
    if (type === 'reasoning') return !!String(part.text || '').trim()
    return type === 'tool'
  })
}

function hasAssistantPrimaryOutput(message: unknown) {
  const m = message && typeof message === 'object' ? (message as any) : null
  if (!m || m.role !== 'assistant') return false
  const content = String(m.content ?? '').trim()
  if (content && content !== ASSISTANT_RUNNING_CONTENT) return true
  const parts = Array.isArray(m.parts) ? m.parts : []
  return parts.some((part: any) => {
    if (!part || typeof part !== 'object') return false
    const type = String(part.type || '').trim()
    if (type === 'text') return !!String(part.text || '').trim()
    return type === 'tool'
  })
}

export function isAssistantAwaitingFirstOutput(message: unknown) {
  return isAssistantGenerating(message) && !hasAssistantPrimaryOutput(message)
}

export function assistantRunGenerationId(message: unknown) {
  const m = message && typeof message === 'object' ? (message as any) : null
  return normalizeAssistantRunState(m?.assistantRun)?.generationId || ''
}

export function normalizeAssistantRunSignal(raw: unknown): AssistantRunSignal | null {
  if (typeof raw === 'string') return { text: raw, generationId: '' }
  const r = raw && typeof raw === 'object' ? (raw as any) : null
  if (!r) return null
  const out: AssistantRunSignal = {
    text: String(r.text ?? ''),
    generationId: String(r.generationId || '').trim(),
  }
  const status = String(r.status || '').trim()
  if (status === 'queued' || status === 'running' || status === 'succeeded' || status === 'failed' || status === 'canceled') out.status = status
  const updatedAt = finiteTime(r.updatedAt, 0)
  const finishedAt = finiteTime(r.finishedAt, 0)
  const expiresAt = finiteTime(r.expiresAt, 0)
  if (updatedAt > 0) out.updatedAt = updatedAt
  if (finishedAt > 0) out.finishedAt = finishedAt
  if (expiresAt > 0) out.expiresAt = expiresAt
  return out
}

export function isAssistantRunSignalCurrent(message: unknown, signalRaw: unknown) {
  const m = message && typeof message === 'object' ? (message as any) : null
  if (!m || m.role !== 'assistant') return false
  const signal = normalizeAssistantRunSignal(signalRaw)
  if (!signal) return false
  const messageGenerationId = assistantRunGenerationId(m)
  return !!messageGenerationId && !!signal.generationId && signal.generationId === messageGenerationId
}

export function beginAssistantRun(
  message: any,
  options?: {
    generationId?: string
    mode?: AssistantRunMode
    stream?: boolean
    startedAt?: number
    resetContent?: boolean
  },
) {
  if (!message || typeof message !== 'object') return null
  const t = finiteTime(options?.startedAt, now())
  const run: AssistantRunState = {
    generationId: String(options?.generationId || uid('gen')),
    status: 'running',
    mode: options?.mode || 'new',
    stream: !!options?.stream,
    startedAt: t,
    updatedAt: t,
  }
  message.assistantRun = run
  message.pending = true
  message.streaming = !!options?.stream
  if (options?.resetContent !== false) message.content = ASSISTANT_RUNNING_CONTENT
  return run
}

export function checkpointAssistantRun(message: any, content: unknown, updatedAt?: number) {
  if (!message || typeof message !== 'object') return false
  if (!isAssistantGenerating(message)) return false
  const text = String(content ?? '')
  const changed = String(message.content ?? '') !== text
  message.content = text
  message.pending = true
  if (message.assistantRun && typeof message.assistantRun === 'object') {
    message.assistantRun = {
      ...message.assistantRun,
      status: 'running',
      updatedAt: finiteTime(updatedAt, now()),
    }
  }
  return changed
}

export function finishAssistantRun(message: any, content: unknown, status: AssistantRunStatus = 'succeeded', finishedAt?: number) {
  if (!message || typeof message !== 'object') return false
  const t = finiteTime(finishedAt, now())
  const text = String(content ?? '')
  const changed =
    String(message.content ?? '') !== text ||
    message.pending !== false ||
    message.streaming !== false ||
    normalizeAssistantRunState(message.assistantRun)?.status !== status

  message.content = text
  message.pending = false
  message.streaming = false
  const cur = normalizeAssistantRunState(message.assistantRun)
  if (cur) {
    message.assistantRun = {
      ...cur,
      status,
      updatedAt: t,
      finishedAt: t,
    }
  }
  return changed
}

export function resolveAssistantMessageForMerge(localMessage: any, storedMessage: any, options?: AssistantMessageMergeOptions) {
  const local = localMessage && typeof localMessage === 'object' ? localMessage : null
  const stored = storedMessage && typeof storedMessage === 'object' ? storedMessage : null
  if (!local || !stored) return localMessage
  if (local.role !== 'assistant' || stored.role !== 'assistant') return localMessage

  const localRun = normalizeAssistantRunState(local.assistantRun)
  const storedRun = normalizeAssistantRunState(stored.assistantRun)
  const localActive = isAssistantGenerating(local)
  const storedActive = isAssistantGenerating(stored)

  if (localRun && storedRun && localRun.generationId === storedRun.generationId) {
    if (!storedActive && localActive) return stored
    if (!localActive && storedActive) return local
    return Number(storedRun.updatedAt || 0) > Number(localRun.updatedAt || 0) ? stored : local
  }

  if (localRun && storedRun && localRun.generationId !== storedRun.generationId) {
    return Number(storedRun.startedAt || 0) > Number(localRun.startedAt || 0) ? stored : local
  }

  if (localActive && !storedActive) {
    if (!localRun) return stored
    if (storedMessageSettlesActiveRun(stored, options)) return stored
    return local
  }
  if (!localActive && storedActive) return local

  return local
}
