import { now } from '../core/utils'
import { chatMetaUpdatedAtMap, chatMetasFromBox, upsertChatMeta } from '../domain/chatMeta'
import { isStoredChatNewerThanCurrent, mergeChatFromStorage } from '../domain/chatStorageSync'
import { splitGroupChatIndexKey, splitGroupChatKey } from '../domain/storageKeys'
import { normalizeStoredChat } from './normalizeStoredChat'

export function createGroupChatSync(deps: {
  storage: { get: (k: string) => Promise<any>; set: (k: string, v: any) => Promise<void> }
  getState: () => any
  loadSplitMeta: () => Promise<any>
  getSplitMetaCache: () => any
  withSplitMetaWrite: <T>(fn: () => Promise<T>) => Promise<T>
  hasActiveGroupRunInSession: (groupId: string, chatId: string) => boolean
}) {
  const { storage, getState, loadSplitMeta, getSplitMetaCache, withSplitMetaWrite, hasActiveGroupRunInSession } = deps

  let uiLastMetaUpdatedAt = 0
  let uiChatSyncing = false

  async function loadGroupFolderMeta(groupId: string) {
    if (!groupId) return null
    let meta = getSplitMetaCache()
    let folder = String((meta as any)?.groupFolders?.[groupId] || '').trim()
    if (meta && folder) return { meta, folder }

    meta = await loadSplitMeta()
    folder = String((meta as any)?.groupFolders?.[groupId] || '').trim()
    return meta && folder ? { meta, folder } : null
  }

  async function loadGroupIndexMeta(groupId: string) {
    const target = await loadGroupFolderMeta(groupId)
    const meta = target?.meta
    const folder = String(target?.folder || '').trim()
    if (!meta || !folder) return null
    const idx = await storage.get(splitGroupChatIndexKey(folder)).catch(() => null)
    if (!idx || typeof idx !== 'object') return { meta, folder, updatedAt: Number((meta as any)?.updatedAt || 0) }
    const updatedAt = Math.max(Number((meta as any)?.updatedAt || 0), Number((idx as any)?.updatedAt || 0))
    return {
      meta: { ...(meta as any), updatedAt, chatIndexByGroup: { ...((meta as any).chatIndexByGroup || {}), [groupId]: idx } },
      folder,
      updatedAt,
    }
  }

  async function touchGroupChatUpdatedAt(groupId: any, chatId: any, updatedAt: any) {
    const gid = String(groupId || '').trim()
    const cid = String(chatId || '').trim()
    const ua0 = Number(updatedAt || 0)
    if (!gid || !cid) return

    await withSplitMetaWrite(async () => {
      const target = await loadGroupFolderMeta(gid)
      const folder = String(target?.folder || '').trim()
      if (!folder) return
      const idx = await storage.get(splitGroupChatIndexKey(folder)).catch(() => null)
      if (!idx || typeof idx !== 'object') return
      const updatedAt = ua0 > 0 ? ua0 : now()
      let metas = chatMetasFromBox(idx, '群聊')
      const cur = metas.find((m: any) => String(m?.id || '') === cid) || null
      metas = upsertChatMeta(metas, {
        id: cid,
        title: String(cur?.title || '群聊'),
        createdAt: Number(cur?.createdAt || updatedAt),
        updatedAt,
        lastMessagePreview: String(cur?.lastMessagePreview || ''),
        messageCount: Number(cur?.messageCount || 0),
        hasPending: !!cur?.hasPending,
      }, '群聊')
      ;(idx as any).chatMetas = metas
      ;(idx as any).chatIds = metas.map((m: any) => String(m?.id || '')).filter(Boolean)
      ;(idx as any).chatUpdatedAt = chatMetaUpdatedAtMap(metas)
      ;(idx as any).updatedAt = now()
      await storage.set(splitGroupChatIndexKey(folder), idx)
    })
  }

  async function syncActiveGroupChatsFromStorage(metaOverride?: any) {
    const state = getState()
    if (!state.data) return
    if (uiChatSyncing) return
    uiChatSyncing = true
    try {
      const gid = String((state.draft as any).activeGroupId || (state.data?.ui as any)?.activeGroupId || '').trim()
      if (!gid) return

      const activeMeta = metaOverride ? null : await loadGroupIndexMeta(gid)
      const meta = metaOverride || activeMeta?.meta || (await loadSplitMeta())
      if (!meta || typeof meta !== 'object') return

      const updatedAt = Number((meta as any).updatedAt || 0)
      if (updatedAt) uiLastMetaUpdatedAt = Math.max(uiLastMetaUpdatedAt, updatedAt)

      const folder = String((meta as any).groupFolders?.[gid] || '')
      const idx = (meta as any).chatIndexByGroup?.[gid]
      if (!folder || !idx || typeof idx !== 'object') return

      const chatMetas = chatMetasFromBox(idx, '群聊')
      const desiredChatIds = chatMetas.map((x: any) => String(x?.id || '')).filter((x: any) => !!x)
      const desiredActiveChatId = String((idx as any).activeChatId || '')
      const wantUpdatedAt = (idx as any).chatUpdatedAt && typeof (idx as any).chatUpdatedAt === 'object' ? (idx as any).chatUpdatedAt : {}

      if (!(state.data as any).chatsByGroup || typeof (state.data as any).chatsByGroup !== 'object') (state.data as any).chatsByGroup = {}
      if (!(state.data as any).chatsByGroup[gid] || typeof (state.data as any).chatsByGroup[gid] !== 'object') (state.data as any).chatsByGroup[gid] = { activeChatId: '', chats: [] }
      const box = (state.data as any).chatsByGroup[gid]
      if (!Array.isArray(box.chats)) box.chats = []

      const keepChatNow = String(box.activeChatId || '')
      const activeChatId = keepChatNow || desiredActiveChatId || String(desiredChatIds[0] || '')

      const curChats = box.chats
      const curById = new Map<string, any>()
      for (const c of curChats) {
        const cid = String(c?.id || '')
        if (cid) curById.set(cid, c)
      }

      const nextChats: any[] = []
      for (const cid of desiredChatIds) {
        const cur = curById.get(cid) || null
        if (!cur) {
          continue
        }

        const metaUpdatedAt = Number((wantUpdatedAt as any)?.[cid] || 0)
        if (metaUpdatedAt && cid !== activeChatId && isStoredChatNewerThanCurrent(metaUpdatedAt, cur.updatedAt)) cur.updatedAt = metaUpdatedAt
        nextChats.push(cur)
      }

      if (activeChatId) {
        const metaUpdatedAt = Number((wantUpdatedAt as any)?.[activeChatId] || 0)
        const cur = curById.get(activeChatId) || null
        const curUpdatedAt = Number(cur?.updatedAt || 0)
        if (!hasActiveGroupRunInSession(gid, activeChatId) && isStoredChatNewerThanCurrent(metaUpdatedAt, curUpdatedAt)) {
          const c0 = await storage.get(splitGroupChatKey(folder, activeChatId))
          const c1 = c0 && typeof c0 === 'object' ? normalizeStoredChat(c0, 'group') : null
          if (c1) {
            const idx0 = nextChats.findIndex((c: any) => String(c?.id || '') === activeChatId)
            if (idx0 >= 0) nextChats[idx0] = mergeChatFromStorage(c1, nextChats[idx0])
            else nextChats.unshift(c1)
          }
        }
      }

      box.chats = nextChats
      ;(box as any).chatMetas = chatMetas

      if (keepChatNow && desiredChatIds.includes(keepChatNow)) box.activeChatId = keepChatNow
      else if (desiredActiveChatId && desiredChatIds.includes(desiredActiveChatId)) box.activeChatId = desiredActiveChatId
      else box.activeChatId = String(desiredChatIds[0] || '')
    } finally {
      uiChatSyncing = false
    }
  }

  return {
    touchGroupChatUpdatedAt,
    syncActiveGroupChatsFromStorage,
  }
}
