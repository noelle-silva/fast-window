import { activeEbRunCardsForTarget, readActiveEbRoleRunCards } from './activeRunCards'

export type ChatSessionRunStatus = 'idle' | 'running' | 'completed' | 'interrupted'

export type ChatSessionRunSummary = {
  status: ChatSessionRunStatus
  changedAt: number
}

export type ChatRunTarget = {
  targetKind: 'role' | 'group' | 'workspace'
  targetId: string
}

function text(value: unknown) {
  return String(value ?? '').trim()
}

function timeValue(value: unknown) {
  if (typeof value === 'number' && isFinite(value) && value > 0) return value
  const valueText = String(value || '').trim()
  if (!valueText) return 0
  const parsed = Date.parse(valueText)
  return isFinite(parsed) && parsed > 0 ? parsed : 0
}

function statusUpdatedAt(value: any) {
  return timeValue(value?.finishedAt) || timeValue(value?.updatedAt) || timeValue(value?.createdAt)
}

export function normalizeChatSessionRunStatus(value: unknown): ChatSessionRunStatus {
  const status = String(value || '').trim().toLowerCase()
  if (status === 'queued' || status === 'running' || status === 'waiting_confirmation') return 'running'
  if (status === 'succeeded' || status === 'completed') return 'completed'
  if (status === 'failed' || status === 'failure' || status === 'error' || status === 'canceled' || status === 'cancelled') return 'interrupted'
  return 'idle'
}

// chat.status 的读取语义唯一入口。
//
// 保留原始状态字符串（queued / failed / cancelled ...），不要在写入或读取时
// 提前折叠成列表展示用的四态：落盘事实与展示投影是两层，折叠只发生在投影里。
export function readChatRunStatus(chat: any): string {
  return text(chat?.status)
}

// chat.status 的唯一写入口。
//
// 事实只有一个来源：该会话当前仍在活动的 run 卡。
// 没有活动卡时，由调用方给出本次收尾/快照的权威状态（终态事件或运行中载荷）。
// 任何其他模块都不得直接给 chat.status 赋值——否则同一个事实会出现
// 「事件里写一份、终态里再写一份」的双写路径，先后顺序不同就会互相覆盖。
export function writeChatRunStatus(
  state: any,
  chat: any,
  options: { fallbackStatus?: unknown; target?: ChatRunTarget | null } = {},
): boolean {
  const sessionId = text(chat?.id)
  if (!sessionId) return false
  const cards = options.target
    ? activeEbRunCardsForTarget(state, options.target.targetKind, options.target.targetId, sessionId)
    : readActiveEbRoleRunCards(state).filter((card) => card.sessionId === sessionId)
  const nextStatus = cards.length ? text(cards[cards.length - 1]?.status) || 'running' : text(options.fallbackStatus)
  if (!nextStatus) return false
  if (readChatRunStatus(chat) === nextStatus) return false
  chat.status = nextStatus
  return true
}

// 会话运行状态的读取投影。
//
// chat.status 已由唯一写入口收口，这里只做「原始状态 → 列表四态」的映射，
// 不再扫描消息里的 assistantRun 二次推导状态：
// 同一事实若同时存在「存储字段」与「读时推导」，两套结果迟早会分叉。
export function chatSessionRunSummaryFromChat(chat: any): ChatSessionRunSummary {
  return {
    status: normalizeChatSessionRunStatus(readChatRunStatus(chat)),
    changedAt: statusUpdatedAt(chat),
  }
}
