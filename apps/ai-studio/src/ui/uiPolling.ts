// ai-chat UI 轮询模块
// 提取自 controller/createController.ts
// 职责：定时轮询 stream 状态、同步 chat 索引、处理跨 tab 聊天更新通知

import { now } from '../core/utils'
import { UI_CHAT_UPDATED_NOTICE_KEY } from '../runtime/runtimeKeys'

function splitChatKey(folder: string, chatId: string) {
  return `chats/${String(folder || '')}/${String(chatId || '')}`
}

function splitGroupChatKey(folder: string, chatId: string) {
  return `groups/${String(folder || '')}/chats/${String(chatId || '')}`
}

export function createUiPolling(deps: {
  getState: () => any
  storage: { get: (key: string) => Promise<any>; set: (key: string, value: any) => Promise<void> }
  rtStorage: { get: (key: string) => Promise<any> }
  aiGateway: {
    readAssistantStream: (id: string) => Promise<{ text?: string } | null>
    consumeAssistantFinal: (id: string) => Promise<{ text?: string; expiresAt?: number } | null>
    resetAssistantRuntime: (id: string) => Promise<void>
  }
  loadSplitMeta: () => Promise<any>
  getSplitMetaCache: () => any
  emit: () => void
  activeTargetKind: () => string
  activeChatFromData: () => any
  syncActiveGroupChatsFromStorage: (meta: any) => Promise<void>
  save: () => Promise<void>
}) {
  let uiPollTimer = 0
  let uiLastMetaCheckMs = 0
  let uiLastMetaUpdatedAt = 0
  const uiStreamCache = new Map()
  let uiChatSyncing = false
  let uiLastChatUpdatedNoticeId = ''

  async function syncActiveRoleChatsFromStorage(metaOverride?: any) {
    const state = deps.getState()
    if (!state.data) return
    if (uiChatSyncing) return
    uiChatSyncing = true
    try {
      const rid = String(state.draft.activeRoleId || state.data?.ui?.activeRoleId || '')
      if (!rid) return

      const meta = metaOverride || (await deps.loadSplitMeta())
      if (!meta || typeof meta !== 'object') return

      const updatedAt = Number((meta as any).updatedAt || 0)
      if (updatedAt) uiLastMetaUpdatedAt = Math.max(uiLastMetaUpdatedAt, updatedAt)

      const folder = String((meta as any).roleFolders?.[rid] || '')
      const idx = (meta as any).chatIndexByRole?.[rid]
      if (!folder || !idx || typeof idx !== 'object') return

      const desiredChatIds = Array.isArray((idx as any).chatIds) ? (idx as any).chatIds.map((x: any) => String(x || '')).filter((x: any) => !!x) : []
      const desiredActiveChatId = String((idx as any).activeChatId || '')
      const wantUpdatedAt = (idx as any).chatUpdatedAt && typeof (idx as any).chatUpdatedAt === 'object' ? (idx as any).chatUpdatedAt : {}

      if (!state.data.chatsByRole || typeof state.data.chatsByRole !== 'object') state.data.chatsByRole = {}
      if (!state.data.chatsByRole[rid] || typeof state.data.chatsByRole[rid] !== 'object') state.data.chatsByRole[rid] = { activeChatId: '', chats: [] }
      const box = state.data.chatsByRole[rid]
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
          const c0 = await deps.storage.get(splitChatKey(folder, cid))
          const c1 = c0 && typeof c0 === 'object' ? c0 : null
          if (c1) nextChats.push(c1)
          continue
        }

        const metaUpdatedAt = Number((wantUpdatedAt as any)?.[cid] || 0)
        if (metaUpdatedAt && cid !== activeChatId) cur.updatedAt = metaUpdatedAt
        nextChats.push(cur)
      }

      if (activeChatId) {
        const metaUpdatedAt = Number((wantUpdatedAt as any)?.[activeChatId] || 0)
        const cur = curById.get(activeChatId) || null
        const curUpdatedAt = Number(cur?.updatedAt || 0)
        if (metaUpdatedAt && metaUpdatedAt !== curUpdatedAt) {
          const c0 = await deps.storage.get(splitChatKey(folder, activeChatId))
          const c1 = c0 && typeof c0 === 'object' ? c0 : null
          if (c1) {
            const idx0 = nextChats.findIndex((c: any) => String(c?.id || '') === activeChatId)
            if (idx0 >= 0) nextChats[idx0] = c1
            else nextChats.unshift(c1)
          }
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

  async function syncActiveTargetChatsFromStorage(metaOverride?: any) {
    if (deps.activeTargetKind() === 'group') return deps.syncActiveGroupChatsFromStorage(metaOverride)
    return syncActiveRoleChatsFromStorage(metaOverride)
  }

  async function syncChatByIdFromStorage(roleId: any, chatId: any) {
    const state = deps.getState()
    if (!state.data) return false
    const rid = String(roleId || '').trim()
    const cid = String(chatId || '').trim()
    if (!rid || !cid) return false

    const meta = (await deps.loadSplitMeta()) || deps.getSplitMetaCache()
    if (!meta) return false
    const folder = String(meta.roleFolders?.[rid] || '')
    if (!folder) return false

    const raw = await deps.storage.get(splitChatKey(folder, cid))
    const chat = raw && typeof raw === 'object' ? raw : null
    if (!chat) return false

    if (!state.data.chatsByRole || typeof state.data.chatsByRole !== 'object') state.data.chatsByRole = {}
    if (!state.data.chatsByRole[rid] || typeof state.data.chatsByRole[rid] !== 'object') state.data.chatsByRole[rid] = { activeChatId: '', chats: [] }
    const box = state.data.chatsByRole[rid]
    if (!Array.isArray(box.chats)) box.chats = []

    const idx = box.chats.findIndex((c: any) => String(c?.id || '') === cid)
    if (idx >= 0) box.chats[idx] = chat
    else box.chats.unshift(chat)

    return true
  }

  async function syncGroupChatByIdFromStorage(groupId: any, chatId: any) {
    const state = deps.getState()
    if (!state.data) return false
    const gid = String(groupId || '').trim()
    const cid = String(chatId || '').trim()
    if (!gid || !cid) return false

    const meta = (await deps.loadSplitMeta()) || deps.getSplitMetaCache()
    if (!meta) return false
    const folder = String((meta as any).groupFolders?.[gid] || '')
    if (!folder) return false

    const raw = await deps.storage.get(splitGroupChatKey(folder, cid))
    const chat = raw && typeof raw === 'object' ? raw : null
    if (!chat) return false

    if (!(state.data as any).chatsByGroup || typeof (state.data as any).chatsByGroup !== 'object') (state.data as any).chatsByGroup = {}
    if (!(state.data as any).chatsByGroup[gid] || typeof (state.data as any).chatsByGroup[gid] !== 'object') (state.data as any).chatsByGroup[gid] = { activeChatId: '', chats: [] }
    const box = (state.data as any).chatsByGroup[gid]
    if (!Array.isArray(box.chats)) box.chats = []

    const idx = box.chats.findIndex((c: any) => String(c?.id || '') === cid)
    if (idx >= 0) box.chats[idx] = chat
    else box.chats.unshift(chat)

    return true
  }

  async function applyChatUpdatedNoticeOnce() {
    const state = deps.getState()
    if (state.loading || !state.data) return false
    let raw = null
    try {
      raw = await deps.rtStorage.get(UI_CHAT_UPDATED_NOTICE_KEY)
    } catch (_) {
      raw = null
    }
    if (!raw || typeof raw !== 'object') return false

    const nid = String((raw as any).id || '')
    if (!nid || nid === uiLastChatUpdatedNoticeId) return false
    uiLastChatUpdatedNoticeId = nid

    const kind = String((raw as any).targetKind || '').trim() === 'group' ? 'group' : 'role'
    const tid = String((raw as any).targetId || (raw as any).roleId || '').trim()
    const cid = String((raw as any).chatId || '').trim()
    const updatedAt = Number((raw as any).updatedAt || 0)
    if (!tid || !cid) return false

    const activeKind = deps.activeTargetKind()
    const activeTid =
      activeKind === 'group'
        ? String((state.draft as any).activeGroupId || (state.data?.ui as any)?.activeGroupId || '').trim()
        : String(state.draft.activeRoleId || state.data?.ui?.activeRoleId || '').trim()
    if (!activeTid || kind !== activeKind || tid !== activeTid) return false

    const activeChatId = String(deps.activeChatFromData()?.id || '').trim()
    if (activeChatId && cid === activeChatId) {
      const ok = kind === 'group' ? await syncGroupChatByIdFromStorage(tid, cid) : await syncChatByIdFromStorage(tid, cid)
      return !!ok
    }

    try {
      const ok = kind === 'group' ? await syncGroupChatByIdFromStorage(tid, cid) : await syncChatByIdFromStorage(tid, cid)
      if (ok) return true
    } catch (_) {}

    const box = kind === 'group' ? (state.data as any)?.chatsByGroup?.[tid] : state.data?.chatsByRole?.[tid]
    const chats = Array.isArray(box?.chats) ? box.chats : []
    const it = chats.find((c: any) => String(c?.id || '') === cid) || null
    if (it && updatedAt && Number(it.updatedAt || 0) !== updatedAt) {
      it.updatedAt = updatedAt
      return true
    }

    return false
  }

  function reapplyUiStreamCache(chatOverride?: any) {
    const chat = chatOverride || deps.activeChatFromData()
    if (!chat) return false
    const items = Array.isArray(chat.messages) ? chat.messages : []
    let changed = false
    for (const m of items.slice(-30)) {
      if (!m || !m.pending || !m.streaming) continue
      const mid = String(m.id || '')
      const cached = uiStreamCache.get(mid)
      if (typeof cached !== 'string' || !cached) continue
      if (String(m.content || '') === cached) continue
      m.content = cached
      changed = true
    }
    return changed
  }

  async function uiPollTick() {
    const state = deps.getState()
    if (state.loading || !state.data) return

    let chat = deps.activeChatFromData()
    if (!chat) return

    try {
      const changedByNotice = await applyChatUpdatedNoticeOnce()
      if (changedByNotice) {
        chat = deps.activeChatFromData()
        reapplyUiStreamCache(chat)
        deps.emit()
      }
    } catch (_) {}

    const items = Array.isArray(chat.messages) ? chat.messages : []
    const pending = items.filter((m: any) => m && m.role === 'assistant' && m.pending).slice(-8)

    if (pending.length) {
      let changed = false
      for (const m of pending) {
        if (!m.streaming) continue
        const s = await deps.aiGateway.readAssistantStream(String(m.id || ''))
        const text = String(s?.text || '')
        const mid = String(m.id || '')
        if (!text) {
          try {
            const fin = await deps.aiGateway.consumeAssistantFinal(mid)
            const finText = String(fin?.text || '').trim()
            const exp = Number(fin?.expiresAt || 0)
            if (fin && (!exp || exp > now())) {
              if (finText) m.content = finText
              m.pending = false
              m.streaming = false
              changed = true
              try {
                await deps.aiGateway.resetAssistantRuntime(mid)
              } catch (_) {}
            }
          } catch (_) {}
          continue
        }
        if (uiStreamCache.get(mid) === text) continue
        uiStreamCache.set(mid, text)
        m.content = text
        changed = true
      }
      if (changed) {
        deps.emit()
        deps.save().catch(() => {})
      }

      const t = now()
      if (t - uiLastMetaCheckMs > 350) {
        uiLastMetaCheckMs = t
        if (state.sending || state.pendingChat || (state as any).pendingGroupChat) return
        try {
          const meta = await deps.loadSplitMeta()
          const updatedAt = Number(meta?.updatedAt || 0)
          if (updatedAt && updatedAt !== uiLastMetaUpdatedAt) {
            await syncActiveTargetChatsFromStorage(meta)
            chat = deps.activeChatFromData()
            reapplyUiStreamCache(chat)
            deps.emit()
          }
        } catch (_) {}
      }

      return
    }

    uiStreamCache.clear()

    const t2 = now()
    if (t2 - uiLastMetaCheckMs > 900) {
      uiLastMetaCheckMs = t2
      if (!state.sending && !state.pendingChat && !(state as any).pendingGroupChat) {
        try {
          const meta = await deps.loadSplitMeta()
          const updatedAt = Number(meta?.updatedAt || 0)
          if (updatedAt && updatedAt !== uiLastMetaUpdatedAt) {
            await syncActiveTargetChatsFromStorage(meta)
            chat = deps.activeChatFromData()
            reapplyUiStreamCache(chat)
            deps.emit()
          }
        } catch (_) {}
      }
    }

    if (state.sending) {
      state.sending = false
      deps.emit()
    }
  }

  function startUiPollers() {
    if (uiPollTimer) return
    uiPollTimer = window.setInterval(() => {
      uiPollTick().catch(() => {})
    }, 350)
  }

  return {
    startUiPollers,
    uiPollTick,
    syncActiveRoleChatsFromStorage,
    syncActiveTargetChatsFromStorage,
    syncChatByIdFromStorage,
    syncGroupChatByIdFromStorage,
    applyChatUpdatedNoticeOnce,
    reapplyUiStreamCache,
  }
}
