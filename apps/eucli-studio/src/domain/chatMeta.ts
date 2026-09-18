import { now } from '../core/utils'
import { chatSessionRunSummaryFromChat, normalizeChatSessionRunStatus, type ChatSessionRunStatus } from './chatSessionRunStatus'
import { CHAT_MESSAGE_TYPE_ASYNC_TOOL_RESULT } from './message'

export type ChatMeta = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  lastMessagePreview: string
  messageCount: number
  hasPending: boolean
  runStatus: ChatSessionRunStatus
  runStatusChangedAt: number
}

function normalizeWhitespace(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function clampPreview(value: unknown): string {
  const text = normalizeWhitespace(value)
  return text.length > 80 ? `${text.slice(0, 80).trim()}...` : text
}

function toolStateText(value: unknown): string {
  const state = String(value || '').trim()
  if (state === 'requested') return '已请求'
  if (state === 'needs_confirmation') return '等待确认'
  if (state === 'approved') return '已同意'
  if (state === 'rejected') return '已拒绝'
  if (state === 'running') return '运行中'
  if (state === 'completed') return '已完成'
  if (state === 'error') return '失败'
  if (state === 'denied') return '已拒绝'
  if (state === 'cancelled') return '已取消'
  return state
}

function toolResultStatusText(value: unknown): string {
  const status = String(value || '').trim()
  const lower = status.toLowerCase()
  if (lower === 'success' || lower === 'completed' || lower === 'ok') return '成功'
  if (lower === 'error' || lower === 'failed' || lower === 'failure') return '失败'
  return status
}

function toolPartPreview(part: any): string {
  if (!part || typeof part !== 'object') return ''
  const result = (part as any).result && typeof (part as any).result === 'object' ? (part as any).result : null
  const name = normalizeWhitespace((part as any).toolName || result?.toolName) || 'tool'
  if (result) {
    const status = toolResultStatusText(result.status)
    return `工具返回：${name}${status ? `（${status}）` : ''}`
  }
  const state = toolStateText((part as any).state)
  return `工具调用：${name}${state ? `（${state}）` : ''}`
}

function legacyToolResponsePreview(content: string): string {
  if (!content.startsWith('<<<[TOOL_RESPONSE]>>>')) return ''
  const resultTags = content.match(/<<\[RESULT-\d+\]>>/g) || []
  const names = Array.from(content.matchAll(/tool_name:「start」([\s\S]*?)「end」/g))
    .map((x) => normalizeWhitespace(x?.[1] || ''))
    .filter(Boolean)
  const statuses = Array.from(content.matchAll(/status:「start」([\s\S]*?)「end」/g))
    .map((x) => toolResultStatusText(x?.[1] || ''))
    .filter(Boolean)
  const pairs = names.slice(0, 3).map((name, index) => {
    const status = statuses[index] || ''
    return status ? `${name}（${status}）` : name
  })
  const count = resultTags.length
  if (count) return `工具返回：${count}项${pairs.length ? `：${pairs.join('，')}${count > 3 ? '...' : ''}` : ''}`
  return pairs.length ? `工具返回：${pairs.join('，')}` : '工具返回结果'
}

function contentPreview(message: any): string {
  const content = String(message?.content ?? '')
  if (String(message?.type || '').trim() === CHAT_MESSAGE_TYPE_ASYNC_TOOL_RESULT) return clampPreview(`异步工具返回：${content}`)
  const legacyToolPreview = legacyToolResponsePreview(content)
  if (legacyToolPreview) return clampPreview(legacyToolPreview)
  return clampPreview(content)
}

function partPreview(part: any): string {
  if (!part || typeof part !== 'object') return ''
  const type = String((part as any).type || '').trim()
  if (type === 'text') return clampPreview((part as any).text)
  if (type === 'tool') return clampPreview(toolPartPreview(part))
  if (type === 'reasoning') return ''
  return ''
}

function messagePreview(message: any): string {
  if (!message || typeof message !== 'object') return ''
  const parts = Array.isArray(message.parts) ? message.parts : []
  const text = contentPreview(message)
  if (text) return text
  for (const part of parts) {
    const preview = partPreview(part)
    if (preview) return preview
  }
  const images = Array.isArray(message.images) ? message.images : []
  if (images.length) return '图片'
  const attachments = Array.isArray(message.attachments) ? message.attachments : []
  if (attachments.length) return '文件'
  return ''
}

export function chatMetaFromChat(chat: any, fallbackTitle = '新聊天'): ChatMeta | null {
  if (!chat || typeof chat !== 'object') return null
  const id = normalizeWhitespace(chat.id)
  if (!id) return null
  const messages = Array.isArray(chat.messages) ? chat.messages.filter((x: any) => x && typeof x === 'object') : []
  const last = messages.length ? messages[messages.length - 1] : null
  const createdAt = Number(chat.createdAt || 0) || now()
  const updatedAt = Number(chat.updatedAt || 0) || createdAt
  const runSummary = chatSessionRunSummaryFromChat(chat)
  const hasPending = runSummary.status === 'running'
  return {
    id,
    title: normalizeWhitespace(chat.title) || fallbackTitle,
    createdAt,
    updatedAt,
    lastMessagePreview: messagePreview(last),
    messageCount: messages.length,
    hasPending,
    runStatus: hasPending ? 'running' : runSummary.status,
    runStatusChangedAt: Number(runSummary.changedAt || updatedAt || createdAt || 0),
  }
}

export function normalizeChatMeta(raw: any, fallbackId = '', fallbackTitle = '新聊天', fallbackUpdatedAt = 0): ChatMeta | null {
  const obj = raw && typeof raw === 'object' ? raw : {}
  const id = normalizeWhitespace((obj as any).id || fallbackId)
  if (!id) return null
  const createdAt = Number((obj as any).createdAt || 0) || Number(fallbackUpdatedAt || 0) || now()
  const updatedAt = Number((obj as any).updatedAt || 0) || Number(fallbackUpdatedAt || 0) || createdAt
  const runStatus = normalizeChatSessionRunStatus((obj as any).runStatus || (obj as any).status)
  const hasPending = runStatus === 'running'
  return {
    id,
    title: normalizeWhitespace((obj as any).title) || fallbackTitle,
    createdAt,
    updatedAt,
    lastMessagePreview: clampPreview((obj as any).lastMessagePreview || (obj as any).snippet || ''),
    messageCount: Math.max(0, Math.floor(Number((obj as any).messageCount || 0) || 0)),
    hasPending,
    runStatus: hasPending ? 'running' : runStatus,
    runStatusChangedAt: Number((obj as any).runStatusChangedAt || (obj as any).statusChangedAt || updatedAt || createdAt || 0) || updatedAt,
  }
}

export function normalizeChatMetas(raw: any, chatIdsRaw: any, chatUpdatedAtRaw: any, fallbackTitle = '新聊天'): ChatMeta[] {
  const chatIds = Array.isArray(chatIdsRaw) ? chatIdsRaw.map((x: any) => normalizeWhitespace(x)).filter(Boolean) : []
  const updated = chatUpdatedAtRaw && typeof chatUpdatedAtRaw === 'object' ? chatUpdatedAtRaw : {}
  const byId = new Map<string, ChatMeta>()

  const add = (item: any, fallbackId = '') => {
    const id0 = normalizeWhitespace((item as any)?.id || fallbackId)
    const meta = normalizeChatMeta(item, id0, fallbackTitle, Number((updated as any)?.[id0] || 0))
    if (meta && !byId.has(meta.id)) byId.set(meta.id, meta)
  }

  if (Array.isArray(raw)) {
    for (const item of raw) add(item)
  } else if (raw && typeof raw === 'object') {
    for (const [id, item] of Object.entries(raw)) add(item, id)
  }

  const out: ChatMeta[] = []
  const seen = new Set<string>()
  for (const id of chatIds) {
    const meta = byId.get(id) || normalizeChatMeta(null, id, fallbackTitle, Number((updated as any)?.[id] || 0))
    if (!meta || seen.has(meta.id)) continue
    seen.add(meta.id)
    out.push(meta)
  }
  for (const meta of byId.values()) {
    if (seen.has(meta.id)) continue
    seen.add(meta.id)
    out.push(meta)
  }
  return out
}

export function chatMetasFromBox(box: any, fallbackTitle = '新聊天'): ChatMeta[] {
  const metas = normalizeChatMetas(box?.chatMetas, box?.chatIds, box?.chatUpdatedAt, fallbackTitle)
  const out = metas.slice()
  const indexById = new Map(out.map((m, index) => [m.id, index]))
  const chats = Array.isArray(box?.chats) ? box.chats : []
  for (const chat of chats) {
    const meta = chatMetaFromChat(chat, fallbackTitle)
    if (!meta) continue
    const index = indexById.get(meta.id)
    if (typeof index === 'number') out[index] = meta
    else {
      indexById.set(meta.id, out.length)
      out.push(meta)
    }
  }
  return out
}

export function chatMetasSortedByUpdatedAt(listRaw: any, fallbackTitle = '新聊天'): ChatMeta[] {
  return normalizeChatMetas(listRaw, [], {}, fallbackTitle).sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
}

export function upsertChatMeta(listRaw: any, metaRaw: any, fallbackTitle = '新聊天'): ChatMeta[] {
  const meta = normalizeChatMeta(metaRaw, '', fallbackTitle)
  const list = Array.isArray(listRaw) ? listRaw : []
  if (!meta) return normalizeChatMetas(list, [], {}, fallbackTitle)
  const out = normalizeChatMetas(list, [], {}, fallbackTitle)
  const index = out.findIndex((x) => x.id === meta.id)
  if (index >= 0) out[index] = { ...out[index], ...meta }
  else out.unshift(meta)
  return out
}

export function removeChatMeta(listRaw: any, chatId: unknown, fallbackTitle = '新聊天'): ChatMeta[] {
  const cid = normalizeWhitespace(chatId)
  return normalizeChatMetas(listRaw, [], {}, fallbackTitle).filter((x) => x.id !== cid)
}

export function chatMetaIds(listRaw: any): string[] {
  return normalizeChatMetas(listRaw, [], {}, '新聊天').map((x) => x.id).filter(Boolean)
}

export function chatMetaUpdatedAtMap(listRaw: any): Record<string, number> {
  const out: Record<string, number> = {}
  for (const meta of normalizeChatMetas(listRaw, [], {}, '新聊天')) {
    out[meta.id] = Number(meta.updatedAt || 0)
  }
  return out
}
