import { now } from '../core/utils'
import { chatMetaUpdatedAtMap, chatMetasFromBox, upsertChatMeta } from '../domain/chatMeta'
import { splitGroupChatIndexKey } from '../domain/storageKeys'

export function createGroupChatSync(deps: {
  storage: { get: (k: string) => Promise<any>; set: (k: string, v: any) => Promise<void> }
  getState: () => any
  setState: (data: any) => void
  loadSplitMeta: () => Promise<any>
  getSplitMetaCache: () => any
  withSplitMetaWrite: <T>(fn: () => Promise<T>) => Promise<T>
}) {
  const { storage, getState, setState, loadSplitMeta, getSplitMetaCache, withSplitMetaWrite } = deps

  let uiLastMetaUpdatedAt = 0
  let uiChatSyncing = false

  async function touchGroupChatUpdatedAt(groupId: any, chatId: any, updatedAt: any) {
    const gid = String(groupId || '').trim()
    const cid = String(chatId || '').trim()
    const ua0 = Number(updatedAt || 0)
    if (!gid || !cid) return

    await withSplitMetaWrite(async () => {
      const meta = (await loadSplitMeta()) || getSplitMetaCache()
      if (!meta) return
      const folder = String((meta as any).groupFolders?.[gid] || '').trim()
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

      const meta = metaOverride || (await loadSplitMeta())
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
        if (metaUpdatedAt && cid !== activeChatId) cur.updatedAt = metaUpdatedAt
        nextChats.push(cur)
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
