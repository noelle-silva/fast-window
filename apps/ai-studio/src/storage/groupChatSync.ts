import { now } from '../core/utils'
import { splitGroupChatIndexKey, splitGroupChatKey } from '../domain/storageKeys'

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
      if (!(idx as any).chatUpdatedAt || typeof (idx as any).chatUpdatedAt !== 'object') (idx as any).chatUpdatedAt = {}
      ;(idx as any).chatUpdatedAt[String(cid)] = ua0 > 0 ? ua0 : now()
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

      const desiredChatIds = Array.isArray((idx as any).chatIds) ? (idx as any).chatIds.map((x: any) => String(x || '')).filter((x: any) => !!x) : []
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
          const c0 = await storage.get(splitGroupChatKey(folder, cid))
          const c1 = c0 && typeof c0 === 'object' ? c0 : null
          if (c1) nextChats.push(c1)
          continue
        }

        const metaUpdatedAt = Number((wantUpdatedAt as any)?.[cid] || 0)
        if (metaUpdatedAt && cid !== activeChatId) cur.updatedAt = metaUpdatedAt
        nextChats.push(cur)
      }

      for (const c of curChats) {
        const cid = String(c?.id || '')
        if (!cid) continue
        if (!desiredChatIds.includes(cid)) continue
        if (cid !== activeChatId) continue

        const cur = curById.get(cid) || null
        if (!cur) continue
        const want = Number((wantUpdatedAt as any)?.[cid] || 0)
        if (!want || Number(cur.updatedAt || 0) === want) continue
        const c0 = await storage.get(splitGroupChatKey(folder, cid))
        const c1 = c0 && typeof c0 === 'object' ? c0 : null
        if (c1) {
          const idx0 = nextChats.findIndex((x) => String(x?.id || '') === activeChatId)
          if (idx0 >= 0) nextChats[idx0] = c1
          else nextChats.unshift(c1)
        }
      }

      box.chats = nextChats

      if (keepChatNow && nextChats.some((c: any) => String(c?.id || '') === keepChatNow)) box.activeChatId = keepChatNow
      else if (desiredActiveChatId && nextChats.some((c: any) => String(c?.id || '') === desiredActiveChatId)) box.activeChatId = desiredActiveChatId
      else box.activeChatId = String(nextChats[0]?.id || '')
    } finally {
      uiChatSyncing = false
    }
  }

  return {
    touchGroupChatUpdatedAt,
    syncActiveGroupChatsFromStorage,
  }
}
