import { now } from '../core/utils'
import { chatMetaFromChat, chatMetaUpdatedAtMap, chatMetasFromBox, upsertChatMeta } from '../domain/chatMeta'
import { splitChatKey, splitGroupChatIndexKey, splitGroupChatKey, splitRoleChatIndexKey } from '../domain/storageKeys'
import { loadSplitMetaSnapshot } from './splitIndexes'

export type ChatIndexKind = 'role' | 'group'

export type ChatIndexPatch = {
  chat?: any
  updatedAt?: any
  title?: any
  remove?: boolean
}

export type ChatIndexStorage = {
  get: (key: string) => Promise<any>
  set: (key: string, value: any) => Promise<void>
}

export async function updateStoredChatIndexEntry(
  storage: ChatIndexStorage,
  kind: ChatIndexKind,
  targetId: any,
  chatId: any,
  patch: ChatIndexPatch,
  metaOverride?: any,
) {
  const tid = String(targetId || '').trim()
  const cid = String(chatId || '').trim()
  if (!tid || !cid) return null

  const meta = metaOverride || (await loadSplitMetaSnapshot(storage))
  if (!meta || typeof meta !== 'object') return null

  const folder = kind === 'group' ? String((meta as any).groupFolders?.[tid] || '').trim() : String(meta.roleFolders?.[tid] || '').trim()
  if (!folder) return meta

  const key = kind === 'group' ? splitGroupChatIndexKey(folder) : splitRoleChatIndexKey(folder)
  const idx = await storage.get(key).catch(() => null)
  if (!idx || typeof idx !== 'object') return meta

  const fallbackTitle = kind === 'group' ? '群聊' : '新聊天'
  let metas = chatMetasFromBox(idx, fallbackTitle)
  if (patch.remove) {
    metas = metas.filter((m: any) => String(m?.id || '') !== cid)
  } else {
    const current = metas.find((m: any) => String(m?.id || '') === cid) || null
    const updatedAt = Number(patch.updatedAt || patch.chat?.updatedAt || current?.updatedAt || now())
    let chatForMeta = patch.chat
    if (!chatForMeta && patch.title == null) {
      const chatKey = kind === 'group' ? splitGroupChatKey(folder, cid) : splitChatKey(folder, cid)
      const rawChat = await storage.get(chatKey).catch(() => null)
      chatForMeta = rawChat && typeof rawChat === 'object' ? rawChat : null
    }
    const metaItem = chatForMeta
      ? chatMetaFromChat(chatForMeta, fallbackTitle)
      : {
          id: cid,
          title: String(patch.title ?? current?.title ?? fallbackTitle).replace(/\s+/g, ' ').trim() || fallbackTitle,
          createdAt: Number(current?.createdAt || updatedAt || now()),
          updatedAt,
          lastMessagePreview: String(current?.lastMessagePreview || ''),
          messageCount: Number(current?.messageCount || 0),
          hasPending: !!current?.hasPending,
        }
    metas = upsertChatMeta(metas, metaItem, fallbackTitle)
  }

  ;(idx as any).chatMetas = metas
  ;(idx as any).chatIds = metas.map((m: any) => String(m?.id || '')).filter(Boolean)
  ;(idx as any).chatUpdatedAt = chatMetaUpdatedAtMap(metas)
  if (patch.remove && String((idx as any).activeChatId || '') === cid) (idx as any).activeChatId = String(metas[0]?.id || '')
  if (!patch.remove && cid && !(idx as any).activeChatId) (idx as any).activeChatId = cid
  ;(idx as any).updatedAt = now()
  await storage.set(key, idx)
  return meta
}
