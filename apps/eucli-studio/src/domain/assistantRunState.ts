import { now, uid } from '../core/utils'
import { writeChatMessageFields } from './chatMessageFields'
import {
  clearRuntimeMessageMarker,
  isRuntimeMessageInFlight,
  markRuntimeMessageInFlight,
} from './runtimeMessageMarker'

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

export function hasAssistantPrimaryOutput(message: unknown) {
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
  const fields: Record<string, unknown> = {
    assistantRun: run,
    pending: true,
    streaming: !!options?.stream,
  }
  if (options?.resetContent !== false) fields.content = ASSISTANT_RUNNING_CONTENT
  writeChatMessageFields(message, fields)
  markRuntimeMessageInFlight(message)
  return run
}

export function checkpointAssistantRun(message: any, content: unknown, updatedAt?: number) {
  if (!message || typeof message !== 'object') return false
  if (!isAssistantGenerating(message)) return false
  const text = String(content ?? '')
  const changed = String(message.content ?? '') !== text
  const fields: Record<string, unknown> = { content: text, pending: true }
  if (message.assistantRun && typeof message.assistantRun === 'object') {
    fields.assistantRun = {
      ...message.assistantRun,
      status: 'running',
      updatedAt: finiteTime(updatedAt, now()),
    }
  }
  writeChatMessageFields(message, fields)
  return changed
}

export function finishAssistantRun(message: any, content: unknown, status: AssistantRunStatus = 'succeeded', finishedAt?: number) {
  if (!message || typeof message !== 'object') return false
  const t = finiteTime(finishedAt, now())
  const text = String(content ?? '')
  const hadRuntimeMarker = isRuntimeMessageInFlight(message)
  const changed =
    String(message.content ?? '') !== text ||
    message.pending !== false ||
    message.streaming !== false ||
    hadRuntimeMarker ||
    normalizeAssistantRunState(message.assistantRun)?.status !== status

  const fields: Record<string, unknown> = { content: text, pending: false, streaming: false }
  if (hadRuntimeMarker) fields.runtimeOnly = false
  const cur = normalizeAssistantRunState(message.assistantRun)
  if (cur) {
    fields.assistantRun = {
      ...cur,
      status,
      updatedAt: t,
      finishedAt: t,
    }
  }
  writeChatMessageFields(message, fields)
  return changed
}
