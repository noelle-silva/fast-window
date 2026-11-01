import { normalizeTimeMs } from '../core/utils'
import type { ChatMeta } from './chatMeta'

// 会话级事实（标题 / 创建时间 / 更新时间）的唯一归并规则。
//
// 事实源是会话索引里的 chatMeta：窗口切片可以不带这些字段，
// 但「窗口拼出来的会话文档」必须始终带着它们，否则下游 normalizeStoredChat
// 会用「新聊天」/now() 兜底，把真实事实覆盖掉，侧边栏排序随之错乱。
//
// 三条约束：
//   1. 占位标题（「新聊天」等）与 0 时间不算事实，永不参与归并；
//   2. 更新时间只能前进：稍旧的一方不得回退它（写路径刚产生的更新优先）；
//   3. 事实源缺席时，才退回页内 / 已加载会话携带的真实值。

export type ChatSessionIdentity = {
  title: string
  createdAt: number
  updatedAt: number
}

export type SessionIdentityScope = {
  kind: 'role' | 'group'
  targetId: string
}

// SessionIdentityResolver 是「会话级事实」的注入点：
// 事实源在会话索引里，窗口加载器只负责询问，不自己编造。
// 允许异步：索引未就绪时由实现方去取，取不到就返回 null。
export type SessionIdentityResolver = (
  scope: SessionIdentityScope,
  chatId: string,
) => ChatSessionIdentity | null | Promise<ChatSessionIdentity | null>

// GENERIC_SESSION_TITLES 是「会话还没有真实标题」时的展示占位符。
//
// 它们只是渲染用的兜底文案，不是会话事实：任何「事实归并」都必须把它们
// 当作缺失处理，否则一次兜底就会把用户真实改过的标题覆盖掉。
const GENERIC_SESSION_TITLES = new Set(['新聊天', '群聊', '工作区会话'])

export function isGenericSessionTitle(title: unknown): boolean {
  const text = String(title ?? '').trim()
  return !!text && GENERIC_SESSION_TITLES.has(text)
}

// realSessionTitle 只返回真实标题：空串与占位符都视为「没有标题事实」。
export function realSessionTitle(title: unknown): string {
  const text = String(title ?? '').trim()
  return text && !isGenericSessionTitle(text) ? text : ''
}

function positiveTime(value: unknown): number {
  return normalizeTimeMs(value, 0)
}

export function sessionIdentityFromChat(chat: any): ChatSessionIdentity | null {
  if (!chat || typeof chat !== 'object') return null
  const title = realSessionTitle((chat as any).title)
  const createdAt = positiveTime((chat as any).createdAt)
  const updatedAt = positiveTime((chat as any).updatedAt)
  if (!title && !createdAt && !updatedAt) return null
  return { title, createdAt, updatedAt }
}

export function sessionIdentityFromMeta(meta: ChatMeta | null | undefined): ChatSessionIdentity | null {
  if (!meta) return null
  const title = realSessionTitle(meta.title)
  const createdAt = Number(meta.createdAt || 0)
  const updatedAt = Number(meta.updatedAt || 0)
  if (!title && !(createdAt > 0) && !(updatedAt > 0)) return null
  return {
    title,
    createdAt: createdAt > 0 ? createdAt : 0,
    updatedAt: updatedAt > 0 ? updatedAt : 0,
  }
}

// mergeSessionIdentity 表达事实优先级：标题与创建时间取「先出现的真实事实」，
// 更新时间取两者较大者（时间只能前进，稍旧的一方不得回退它）。
export function mergeSessionIdentity(
  primary: ChatSessionIdentity | null | undefined,
  secondary: ChatSessionIdentity | null | undefined,
): ChatSessionIdentity | null {
  if (!primary) return secondary || null
  if (!secondary) return primary
  return {
    title: primary.title || secondary.title,
    createdAt: primary.createdAt > 0 ? primary.createdAt : secondary.createdAt,
    updatedAt: Math.max(primary.updatedAt, secondary.updatedAt),
  }
}

// applySessionIdentity 把「权威的会话级事实」写进会话文档。
//
// 标题与创建时间以事实源为准（索引里的 chatMeta 是唯一权威）；
// 更新时间取「已有值与事实源的较大者」——时间事实只能前进不能后退，
// 否则写路径刚产生的更新会被稍旧的索引快照回退，侧边栏排序会抖动。
// identity 缺席的字段保持原样，绝不写兜底值。
export function applySessionIdentity(chat: any, identity: ChatSessionIdentity | null | undefined): any {
  if (!chat || typeof chat !== 'object' || !identity) return chat
  const next = { ...chat }
  if (identity.title) next.title = identity.title
  if (identity.createdAt > 0) next.createdAt = identity.createdAt
  if (identity.updatedAt > positiveTime(next.updatedAt)) next.updatedAt = identity.updatedAt
  return next
}

// preserveSessionIdentity 是「窗口切片入状态」时的事实保护。
//
// 切片不承担会话级事实，归一化时缺失字段会被填成「新聊天」/now() 兜底。
// 因此已加载会话（它来自索引事实）在标题与创建时间上始终优先：
// 创建时间不会变，兜底的 now() 只会让「新建于」错乱。
// 更新时间只能前进：写路径刚产生的更新不能被稍旧的切片回退。
export function preserveSessionIdentity(nextChat: any, currentChat: any) {
  if (!nextChat || typeof nextChat !== 'object' || !currentChat || typeof currentChat !== 'object') return
  const currentTitle = realSessionTitle(currentChat.title)
  if (currentTitle) nextChat.title = currentTitle
  const currentCreatedAt = positiveTime(currentChat.createdAt)
  if (currentCreatedAt > 0) nextChat.createdAt = currentCreatedAt
  const currentUpdatedAt = positiveTime(currentChat.updatedAt)
  if (currentUpdatedAt > positiveTime(nextChat.updatedAt)) nextChat.updatedAt = currentUpdatedAt
}
