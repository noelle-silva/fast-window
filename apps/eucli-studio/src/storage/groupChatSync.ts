import { now } from '../core/utils'
import { chatMetaUpdatedAtMap, chatMetasFromBox, upsertChatMeta } from '../domain/chatMeta'
import { isStoredChatNewerThanCurrent, mergeChatFromStorage } from '../domain/chatStorageSync'
import { splitGroupChatIndexKey } from '../domain/storageKeys'
import { normalizeStoredChat } from './normalizeStoredChat'
import type { ChatIndexSnapshot, ProjectionScope } from './splitProjectionCache'

// 群聊索引同步：索引读取统一走 SplitProjectionCache（带 revision 的完整快照），
// 本模块只负责「把快照合并进 UI 状态」与「touch 更新时间」两种动作。
// 不再依赖 meta.chatIndexByGroup：会话索引已经不属于 meta。

export function createGroupChatSync(deps: {
  storage: { get: (k: string) => Promise<any>; set: (k: string, v: any) => Promise<void> }
  getState: () => any
  loadSplitMeta: () => Promise<any>
  getSplitMetaCache: () => any
  withSplitMetaWrite: <T>(fn: () => Promise<T>) => Promise<T>
  hasActiveGroupRunInSession: (groupId: string, chatId: string) => boolean
  loadChatIndex: (scope: ProjectionScope) => Promise<ChatIndexSnapshot | null>
  loadChatBody: (scope: ProjectionScope, chatId: string) => Promise<any>
  onSessionIndexInvalidated?: (kind: 'role' | 'group', targetId: string) => void
}) {
  const {
    storage,
    getState,
    loadSplitMeta,
    getSplitMetaCache,
    withSplitMetaWrite,
    hasActiveGroupRunInSession,
    loadChatIndex,
    loadChatBody,
    onSessionIndexInvalidated,
  } = deps

  let uiChatSyncing = false

  async function loadGroupFolder(groupId: string) {
    if (!groupId) return ''
    let meta = getSplitMetaCache()
    let folder = String((meta as any)?.groupFolders?.[groupId] || '').trim()
    if (meta && folder) return folder
    meta = await loadSplitMeta()
    folder = String((meta as any)?.groupFolders?.[groupId] || '').trim()
    return folder
  }

  async function touchGroupChatUpdatedAt(groupId: any, chatId: any, updatedAt: any) {
    const gid = String(groupId || '').trim()
    const cid = String(chatId || '').trim()
    const ua0 = Number(updatedAt || 0)
    if (!gid || !cid) return

    await withSplitMetaWrite(async () => {
      const folder = await loadGroupFolder(gid)
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
      // 写路径必须显式失效缓存：禁止用 TTL 当刷新通道。
      onSessionIndexInvalidated?.('group', gid)
    })
  }

  async function syncActiveGroupChatsFromStorage() {
    const state = getState()
    if (!state.data) return
    if (uiChatSyncing) return
    uiChatSyncing = true
    try {
      const gid = String((state.draft as any).activeGroupId || (state.data?.ui as any)?.activeGroupId || '').trim()
      if (!gid) return

      const folder = await loadGroupFolder(gid)
      if (!folder) return
      const snapshot = await loadChatIndex({ kind: 'group', targetId: gid })
      if (!snapshot) return

      const chatMetas = snapshot.chatMetas.length ? snapshot.chatMetas : chatMetasFromBox(snapshot, '群聊')
      const desiredChatIds = chatMetas.map((x: any) => String(x?.id || '')).filter((x: any) => !!x)
      const desiredActiveChatId = String(snapshot.activeChatId || '')
      const wantUpdatedAt = snapshot.chatUpdatedAt || {}

      if (!(state.data as any).chatsByGroup || typeof (state.data as any).chatsByGroup !== 'object') (state.data as any).chatsByGroup = {}
      if (!(state.data as any).chatsByGroup[gid] || typeof (state.data as any).chatsByGroup[gid] !== 'object') (state.data as any).chatsByGroup[gid] = { activeChatId: '', chats: [] }
      const box = (state.data as any).chatsByGroup[gid]
      if (!Array.isArray(box.chats)) box.chats = []

      const keepChatNow = String(box.activeChatId || '')
      const activeChatId = keepChatNow || desiredActiveChatId || String(desiredChatIds[0] || '')

      const curById = new Map<string, any>()
      for (const c of box.chats) {
        const cid = String(c?.id || '')
        if (cid) curById.set(cid, c)
      }

      const nextChats: any[] = []
      for (const cid of desiredChatIds) {
        const cur = curById.get(cid) || null
        if (!cur) continue
        const metaUpdatedAt = Number(wantUpdatedAt[cid] || 0)
        if (metaUpdatedAt && cid !== activeChatId && isStoredChatNewerThanCurrent(metaUpdatedAt, cur.updatedAt)) cur.updatedAt = metaUpdatedAt
        nextChats.push(cur)
      }

      if (activeChatId) {
        const metaUpdatedAt = Number(wantUpdatedAt[activeChatId] || 0)
        const cur = curById.get(activeChatId) || null
        const curUpdatedAt = Number(cur?.updatedAt || 0)
        if (!hasActiveGroupRunInSession(gid, activeChatId) && isStoredChatNewerThanCurrent(metaUpdatedAt, curUpdatedAt)) {
          const c0 = await loadChatBody({ kind: 'group', targetId: gid }, activeChatId)
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
