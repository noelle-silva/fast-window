import { chatSessionRunSummaryFromChat, normalizeChatSessionRunStatus } from './chatSessionRunStatus'

function timeValue(value: unknown) {
  if (typeof value === 'number' && isFinite(value) && value > 0) return value
  const text = String(value || '').trim()
  if (!text) return 0
  const parsed = Date.parse(text)
  return isFinite(parsed) && parsed > 0 ? parsed : 0
}

function chatListOrderTime(chat: any) {
  const hasMessages = chat && typeof chat === 'object' && Array.isArray(chat.messages)
  const runSummary = hasMessages ? chatSessionRunSummaryFromChat(chat) : null
  const status = runSummary?.status || normalizeChatSessionRunStatus(chat?.hasPending ? 'running' : chat?.runStatus || chat?.status)
  const runChangedAt = timeValue(runSummary?.changedAt) || timeValue(chat?.runStatusChangedAt)
  const updatedAt = timeValue(chat?.updatedAt)
  const createdAt = timeValue(chat?.createdAt)
  if (status === 'running') return runChangedAt || createdAt || updatedAt
  return updatedAt || runChangedAt || createdAt
}

export function sortChatListItemsForDisplay<T = any>(itemsRaw: T[]): T[] {
  const items = Array.isArray(itemsRaw) ? itemsRaw : []
  return items.slice().sort((a: any, b: any) => {
    const ta = chatListOrderTime(a)
    const tb = chatListOrderTime(b)
    if (ta !== tb) return tb - ta
    const ca = timeValue(a?.createdAt)
    const cb = timeValue(b?.createdAt)
    if (ca !== cb) return cb - ca
    return String(a?.id || '').localeCompare(String(b?.id || ''))
  })
}
