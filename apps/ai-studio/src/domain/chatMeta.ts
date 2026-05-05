import { now } from '../core/utils'

export type ChatMeta = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  lastMessagePreview: string
  messageCount: number
  hasPending: boolean
}

function normalizeWhitespace(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function clampPreview(value: unknown): string {
  const text = normalizeWhitespace(value)
  return text.length > 80 ? `${text.slice(0, 80).trim()}...` : text
}

function messagePreview(message: any): string {
  if (!message || typeof message !== 'object') return ''
  const text = clampPreview(message.content)
  if (text) return text
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
  return {
    id,
    title: normalizeWhitespace(chat.title) || fallbackTitle,
    createdAt,
    updatedAt,
    lastMessagePreview: messagePreview(last),
    messageCount: messages.length,
    hasPending: messages.some((m: any) => m?.role === 'assistant' && !!m?.pending),
  }
}

export function normalizeChatMeta(raw: any, fallbackId = '', fallbackTitle = '新聊天', fallbackUpdatedAt = 0): ChatMeta | null {
  const obj = raw && typeof raw === 'object' ? raw : {}
  const id = normalizeWhitespace((obj as any).id || fallbackId)
  if (!id) return null
  const createdAt = Number((obj as any).createdAt || 0) || Number(fallbackUpdatedAt || 0) || now()
  const updatedAt = Number((obj as any).updatedAt || 0) || Number(fallbackUpdatedAt || 0) || createdAt
  return {
    id,
    title: normalizeWhitespace((obj as any).title) || fallbackTitle,
    createdAt,
    updatedAt,
    lastMessagePreview: clampPreview((obj as any).lastMessagePreview || (obj as any).snippet || ''),
    messageCount: Math.max(0, Math.floor(Number((obj as any).messageCount || 0) || 0)),
    hasPending: !!(obj as any).hasPending,
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
  const seen = new Set(out.map((m) => m.id))
  const chats = Array.isArray(box?.chats) ? box.chats : []
  for (const chat of chats) {
    const meta = chatMetaFromChat(chat, fallbackTitle)
    if (!meta || seen.has(meta.id)) continue
    seen.add(meta.id)
    out.push(meta)
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
