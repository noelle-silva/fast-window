import { chatSessionRunSummaryFromChat, normalizeChatSessionRunStatus, type ChatSessionRunStatus } from '../domain/chatSessionRunStatus'
import { numericTimeValue } from './utils/time'

export type ChatSessionRunNoticeKind = Exclude<ChatSessionRunStatus, 'idle' | 'running'>

export type ChatSessionRunNotice = {
  kind: ChatSessionRunNoticeKind
  changedAt: number
}

export type ChatSessionRunObservation = {
  key: string
  status: ChatSessionRunStatus
  changedAt: number
}

export function chatSessionRunNoticeKey(targetKind: 'role' | 'group' | 'workspace', targetId: unknown, chatId: unknown) {
  const tid = String(targetId || '').trim()
  const cid = String(chatId || '').trim()
  if (!tid || !cid) return ''
  return `${targetKind}:${tid}:${cid}`
}

export function chatSessionRunSummaryFromListItem(item: any) {
  const status = normalizeChatSessionRunStatus(item?.hasPending ? 'running' : item?.runStatus || item?.status)
  const changedAt = numericTimeValue(item?.runStatusChangedAt) || numericTimeValue(item?.updatedAt) || numericTimeValue(item?.createdAt)
  if (item && typeof item === 'object' && Array.isArray(item.messages)) {
    const chatSummary = chatSessionRunSummaryFromChat(item)
    if (status !== 'idle') return { status, changedAt: changedAt || chatSummary.changedAt }
    return chatSummary
  }
  return { status, changedAt }
}

export function collectChatSessionRunObservations(data: any): ChatSessionRunObservation[] {
  const byKey = new Map<string, ChatSessionRunObservation>()
  const collectBox = (targetKind: 'role' | 'group' | 'workspace', targetId: string, box: any) => {
    if (!targetId || !box || typeof box !== 'object') return
    const add = (item: any) => {
      const chatId = String(item?.id || '').trim()
      const key = chatSessionRunNoticeKey(targetKind, targetId, chatId)
      if (!key) return
      const summary = chatSessionRunSummaryFromListItem(item)
      if (summary.status === 'idle') return
      byKey.set(key, { key, status: summary.status, changedAt: Number(summary.changedAt || 0) })
    }
    if (Array.isArray(box.chats)) box.chats.forEach(add)
    if (Array.isArray(box.chatMetas)) box.chatMetas.forEach(add)
  }

  const roleBoxes = data?.chatsByRole && typeof data.chatsByRole === 'object' ? data.chatsByRole : {}
  for (const [targetId, box] of Object.entries(roleBoxes)) collectBox('role', String(targetId || ''), box)
  const groupBoxes = data?.chatsByGroup && typeof data.chatsByGroup === 'object' ? data.chatsByGroup : {}
  for (const [targetId, box] of Object.entries(groupBoxes)) collectBox('group', String(targetId || ''), box)
  const workspaceBoxes = (data as any)?.chatsByWorkspace && typeof (data as any).chatsByWorkspace === 'object' ? (data as any).chatsByWorkspace : {}
  for (const [targetId, box] of Object.entries(workspaceBoxes)) collectBox('workspace', String(targetId || ''), box)
  return Array.from(byKey.values())
}
