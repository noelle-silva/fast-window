import { normalizeAssistantRunState, type AssistantRunStatus } from './assistantRunState'

export type ChatSessionRunStatus = 'idle' | 'running' | 'completed' | 'interrupted'

export type ChatSessionRunSummary = {
  status: ChatSessionRunStatus
  changedAt: number
}

function timeValue(value: unknown) {
  if (typeof value === 'number' && isFinite(value) && value > 0) return value
  const text = String(value || '').trim()
  if (!text) return 0
  const parsed = Date.parse(text)
  return isFinite(parsed) && parsed > 0 ? parsed : 0
}

function statusUpdatedAt(value: any) {
  return timeValue(value?.finishedAt) || timeValue(value?.updatedAt) || timeValue(value?.createdAt)
}

function statusStartedAt(value: any) {
  return timeValue(value?.startedAt) || timeValue(value?.createdAt) || timeValue(value?.updatedAt)
}

export function normalizeChatSessionRunStatus(value: unknown): ChatSessionRunStatus {
  const status = String(value || '').trim().toLowerCase()
  if (status === 'queued' || status === 'running' || status === 'waiting_confirmation') return 'running'
  if (status === 'succeeded' || status === 'completed') return 'completed'
  if (status === 'failed' || status === 'failure' || status === 'error' || status === 'canceled' || status === 'cancelled') return 'interrupted'
  return 'idle'
}

function assistantRunSummary(message: any): ChatSessionRunSummary | null {
  if (!message || typeof message !== 'object') return null
  if (String(message?.role || message?.type || '').trim() !== 'assistant') return null
  if (message?.error && typeof message.error === 'object') return { status: 'interrupted', changedAt: statusUpdatedAt(message) }

  const run = normalizeAssistantRunState(message?.assistantRun)
  if (!run) return null
  const status = normalizeChatSessionRunStatus(run.status as AssistantRunStatus)
  if (status === 'running') return null
  if (status === 'idle') return null
  return { status, changedAt: statusUpdatedAt(run) || statusUpdatedAt(message) }
}

export function chatSessionRunSummaryFromChat(chat: any): ChatSessionRunSummary {
  const chatStatus = normalizeChatSessionRunStatus(chat?.status)
  const messages = Array.isArray(chat?.messages) ? chat.messages : []

  for (let index = messages.length - 1; index >= 0; index--) {
    const summary = assistantRunSummary(messages[index])
    if (summary) {
      if (chatStatus === 'running') return { status: 'running', changedAt: summary.changedAt || statusUpdatedAt(chat) }
      if (chatStatus === 'completed' || chatStatus === 'interrupted') return { status: chatStatus, changedAt: statusUpdatedAt(chat) || summary.changedAt }
      return summary
    }
  }

  if (chatStatus !== 'idle') return { status: chatStatus, changedAt: statusUpdatedAt(chat) }
  return { status: 'idle', changedAt: statusUpdatedAt(chat) }
}
