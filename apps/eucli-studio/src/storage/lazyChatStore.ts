import { writeChatListProjection } from '../domain/chatListProjection'
import { splitChatKey, splitGroupChatKey } from '../domain/storageKeys'
import { buildStateFromMeta } from './buildStateFromMeta'
import { normalizeStoredChat } from './normalizeStoredChat'
import type { ChatIndexSnapshot, ProjectionScope } from './splitProjectionCache'
import { projectionScopeKey } from './splitProjectionCache'
import type { SessionWriteGuard, SessionWriteToken } from './sessionWriteGuard'
import {
  firstChatIdInBox,
  readActiveChatSelection,
  writeActiveChatSelection,
} from '../domain/activeChatSelection'

export type LazyChatKind = 'role' | 'group'

export type LazyChatStorage = {
  get: (key: string) => Promise<any>
  set: (key: string, value: any) => Promise<void>
  remove?: (key: string) => Promise<void>
}

function targetBox(data: any, kind: LazyChatKind, targetId: string) {
  if (!data) return null
  const root = kind === 'group' ? ((data as any).chatsByGroup ||= {}) : (data.chatsByRole ||= {})
  const fallbackTitle = kind === 'group' ? '群聊' : '新聊天'
  if (!root[targetId] || typeof root[targetId] !== 'object') root[targetId] = { activeChatId: '', chatMetas: [], chats: [] }
  const box = root[targetId]
  writeChatListProjection(box, { kind: 'derive', fallbackTitle })
  writeActiveChatSelection(box, readActiveChatSelection(box))
  return box
}

function folderForTarget(meta: any, kind: LazyChatKind, targetId: string): string {
  const folders = kind === 'group' ? meta?.groupFolders : meta?.roleFolders
  return String(folders?.[targetId] || '').trim()
}

function chatKeyFor(kind: LazyChatKind, folder: string, chatId: string): string {
  return kind === 'group' ? splitGroupChatKey(folder, chatId) : splitChatKey(folder, chatId)
}

function isMissingChatError(error: unknown) {
  const message = String((error as any)?.message || error || '')
  return message.includes('json file does not exist') || message.includes('会话不存在') || message.includes('session does not exist')
}

function boxHasChatRef(box: any, chatId: string) {
  if (!box || !chatId) return false
  const metas = Array.isArray(box.chatMetas) ? box.chatMetas : []
  if (metas.some((meta: any) => String(meta?.id || '').trim() === chatId)) return true
  const chats = Array.isArray(box.chats) ? box.chats : []
  return chats.some((chat: any) => String(chat?.id || '').trim() === chatId)
}

function removeMissingChatRef(box: any, chatId: string, kind: LazyChatKind) {
  if (!box || !chatId) return
  writeChatListProjection(box, { kind: 'remove', chatId, fallbackTitle: kind === 'group' ? '群聊' : '新聊天' })
  if (readActiveChatSelection(box) === chatId) writeActiveChatSelection(box, firstChatIdInBox(box))
}

export function createLazyChatStore(deps: {
  storage: LazyChatStorage
  getState: () => any
  loadSplitMeta: () => Promise<any>
  getSplitMetaCache?: () => any
  // 会话索引已经不属于 meta：按 scope 从投影缓存读取（带 revision 的完整快照）。
  loadChatIndex: (scope: ProjectionScope) => Promise<ChatIndexSnapshot | null>
  // 会话正文：单飞 + LRU 的加载器（优先走它，缺省时才直读 storage）。
  chatBodies?: {
    load: (scope: ProjectionScope, chatId: string) => Promise<any>
    invalidate?: (scope: ProjectionScope, chatId: string) => void
  }
  // 删除会话 / target 时推进代数：删除之前发起的加载不得把结果写回盒子里。
  sessionWrites?: SessionWriteGuard
}) {
  const { storage, getState, loadSplitMeta, getSplitMetaCache, loadChatIndex, chatBodies, sessionWrites } = deps
  // 在途登记带令牌：删除之后的新调用不能复用旧代的 promise。
  const loadingChats = new Map<string, { token: SessionWriteToken | null; promise: Promise<any> }>()

  function cachedSplitMetaFor(kind: LazyChatKind, targetId: string) {
    const meta = typeof getSplitMetaCache === 'function' ? getSplitMetaCache() : null
    if (!meta || typeof meta !== 'object') return null
    return folderForTarget(meta, kind, targetId) ? meta : null
  }

  async function loadSplitMetaFor(kind: LazyChatKind, targetId: string) {
    return cachedSplitMetaFor(kind, targetId) || (await loadSplitMeta())
  }

  function loadingChatKey(kind: LazyChatKind, targetId: string, chatId: string) {
    return `${kind}:${targetId}:${chatId}`
  }

  function scopeFor(kind: LazyChatKind, targetId: string): ProjectionScope {
    return { kind, targetId }
  }

  async function loadShell() {
    const meta = await loadSplitMeta()
    if (!meta) return null
    return buildStateFromMeta({ meta, storage, loadChatIndex })
  }

  async function ensureChatLoaded(kind: LazyChatKind, targetIdRaw: any, chatIdRaw: any) {
    const state = getState()
    if (!state.data) return null
    const targetId = String(targetIdRaw || '').trim()
    const chatId = String(chatIdRaw || '').trim()
    if (!targetId || !chatId) return null
    const box = targetBox(state.data, kind, targetId)
    if (!box) return null
    const existing = box.chats.find((c: any) => String(c?.id || '') === chatId) || null
    if (existing && !existing.runtimePartial) return existing

    const pendingKey = loadingChatKey(kind, targetId, chatId)
    const token = sessionWrites?.capture(kind, targetId, chatId) || null
    const pending = loadingChats.get(pendingKey)
    // 旧代在途请求即使还没落地也已经作废：删除之后必须发起新请求。
    if (pending && (!sessionWrites || sessionWrites.isCurrent(pending.token))) return pending.promise
    if (pending) loadingChats.delete(pendingKey)

    const run = (async () => {
      const meta = await loadSplitMetaFor(kind, targetId)
      const folder = folderForTarget(meta, kind, targetId)
      if (!folder) throw new Error(kind === 'group' ? '群组不存在' : '角色不存在')
      let raw: any = null
      try {
        raw = chatBodies
          ? await chatBodies.load(scopeFor(kind, targetId), chatId)
          : await storage.get(chatKeyFor(kind, folder, chatId))
      } catch (error) {
        if (isMissingChatError(error)) {
          removeMissingChatRef(box, chatId, kind)
          return null
        }
        throw error
      }
      // 会话在读取途中被删除：旧结果不得写回，否则已删除的会话会复活。
      if (sessionWrites && !sessionWrites.isCurrent(token)) return null
      const chat = normalizeStoredChat(raw, kind)
      if (!chat) {
        removeMissingChatRef(box, chatId, kind)
        return null
      }

      const fallbackTitle = kind === 'group' ? '群聊' : '新聊天'
      return writeChatListProjection(box, { kind: 'upsert', chat, fallbackTitle })?.chat || null
    })()
    loadingChats.set(pendingKey, { token, promise: run })
    try {
      return await run
    } finally {
      // 只摘自己：旧代请求收尾不能删掉同 key 的新代登记。
      if (loadingChats.get(pendingKey)?.promise === run) loadingChats.delete(pendingKey)
    }
  }

  async function loadChat(kind: LazyChatKind, targetIdRaw: any, chatIdRaw: any) {
    const targetId = String(targetIdRaw || '').trim()
    const chatId = String(chatIdRaw || '').trim()
    if (!targetId || !chatId) return null
    const meta = await loadSplitMetaFor(kind, targetId)
    const folder = folderForTarget(meta, kind, targetId)
    if (!folder) throw new Error(kind === 'group' ? '群组不存在' : '角色不存在')
    const raw = chatBodies
      ? await chatBodies.load(scopeFor(kind, targetId), chatId)
      : await storage.get(chatKeyFor(kind, folder, chatId))
    return normalizeStoredChat(raw, kind)
  }

  async function removeChat(kind: LazyChatKind, targetIdRaw: any, chatIdRaw: any) {
    const targetId = String(targetIdRaw || '').trim()
    const chatId = String(chatIdRaw || '').trim()
    if (!targetId || !chatId || typeof storage.remove !== 'function') return
    const meta = await loadSplitMetaFor(kind, targetId)
    const folder = folderForTarget(meta, kind, targetId)
    if (!folder) return
    await storage.remove(chatKeyFor(kind, folder, chatId))
    chatBodies?.invalidate?.({ kind, targetId }, chatId)
  }

  async function ensureActiveChatLoaded() {
    const state = getState()
    if (!state.data) return null
    const kind = String(state.draft?.activeTargetKind || state.data?.ui?.activeTargetKind || '') === 'group' ? 'group' : 'role'
    const targetId = kind === 'group' ? String(state.draft?.activeGroupId || state.data?.ui?.activeGroupId || '') : String(state.draft?.activeRoleId || state.data?.ui?.activeRoleId || '')
    const box = targetBox(state.data, kind, targetId)
    const ids = [String(box?.activeChatId || ''), ...(Array.isArray(box?.chatMetas) ? box.chatMetas.map((m: any) => String(m?.id || '')) : [])]
      .map((id) => id.trim())
      .filter((id, index, list) => !!id && list.indexOf(id) === index)
    for (const chatId of ids) {
      // ids 是循环开始时的快照：期间可能已经被删除。删除之后不得再写偏好，
      // 也不得用「删除之后才发起」的加载把会话重新写回。
      if (!boxHasChatRef(box, chatId)) continue
      writeActiveChatSelection(box, chatId)
      const chat = await ensureChatLoaded(kind, targetId, chatId)
      if (chat) return chat
    }
    writeActiveChatSelection(box, '')
    return null
  }

  // upsertLoadedChat 是「会话进入内存状态」的唯一入口。
  //
  // 入参可以是业务端原始字节，也可以是已归一化的会话：这里统一归一化一次，
  // 保证内存里只有一种会话形状（数值时间 + parentMid 消息树）。
  // 若让调用方各自决定形状，未归一化的原始消息会丢掉 parentMid、
  // 时间保持 ISO 字符串，消息树退化成"每条都是根"，侧边栏排序时间也会塌缩。
  function upsertLoadedChat(kind: LazyChatKind, targetIdRaw: any, chatRaw: any) {
    const state = getState()
    if (!state.data || !chatRaw || typeof chatRaw !== 'object') return null
    const targetId = String(targetIdRaw || '').trim()
    if (!targetId) return null
    const chat = normalizeStoredChat(chatRaw, kind)
    if (!chat) return null
    const chatId = String(chat.id || '').trim()
    if (!chatId) return null
    const box = targetBox(state.data, kind, targetId)
    if (!box) return null
    return writeChatListProjection(box, {
      kind: 'upsert',
      chat,
      fallbackTitle: kind === 'group' ? '群聊' : '新聊天',
    })?.chat || null
  }

  function removeLoadedChat(kind: LazyChatKind, targetIdRaw: any, chatIdRaw: any) {
    const state = getState()
    if (!state.data) return
    const targetId = String(targetIdRaw || '').trim()
    const chatId = String(chatIdRaw || '').trim()
    if (!targetId || !chatId) return
    const box = targetBox(state.data, kind, targetId)
    if (!box) return
    writeChatListProjection(box, { kind: 'remove', chatId, fallbackTitle: kind === 'group' ? '群聊' : '新聊天' })
    if (readActiveChatSelection(box) === chatId) writeActiveChatSelection(box, firstChatIdInBox(box))
  }

  return {
    loadShell,
    loadChat,
    removeChat,
    ensureChatLoaded,
    ensureActiveChatLoaded,
    upsertLoadedChat,
    removeLoadedChat,
  }
}

export function chatScopeKey(kind: LazyChatKind, targetId: string) {
  return projectionScopeKey({ kind, targetId })
}
