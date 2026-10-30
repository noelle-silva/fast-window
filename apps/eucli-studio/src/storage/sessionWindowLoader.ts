import type { SessionScope, SessionSwitchClient, SessionWindowRequest } from '../protocol/sessionSwitchProtocol'

// SessionWindowLoader = 消息窗口的分页装配。
//
// 业务端只负责「切出这一窗」（head 必含、单条不可切分、先到 limit/maxBytes 者生效）；
// 客户端负责把多窗拼成一份可渲染的会话文档。
//
// 三条硬约束：
//   1. 组装结果是「会话形状」：与整份会话同构，因此下游 normalizeStoredChat 无需分叉；
//   2. 分页只按 cursor 前进：不用 offset（删除消息会让 offset 整体错位）；
//   3. 同一会话的并发翻页共享一次请求（in-flight 合流），不重复打业务端。
//
// head 的语义（design-4 决策 3）：用「以这条消息为终点的路径」表达用户在看哪条分支。
// branchId 不可靠（空值一律回落 main，运行期新建消息固定用默认分支），
// 真正的分叉事实是 parentMessageId + 多个 child。因此窗口请求必须能带 head。

export type SessionWindowLoaderDeps = {
  sessionSwitch: Pick<SessionSwitchClient, 'hasFeature' | 'sessionWindow'>
  // 首屏条数与字节预算：先到者生效。
  initialLimit?: number
  maxBytes?: number
  // headFor 提供「当前活动分支的头部消息 id」。
  // 缺席时退回默认策略（业务端自己决定 head），语义等价于旧行为。
  headFor?: (scope: SessionScope, chatId: string) => string
  // switchIdFor 提供「当前这次切换」的关联键。
  // 缺席时不带 switchId：观测链在缺键时整条不启动（零成本旁路）。
  switchIdFor?: (scope: SessionScope, chatId: string) => string
}

export type SessionWindowState = {
  scope: SessionScope
  chatId: string
  chat: any
  nextCursor: string
  hasMore: boolean
  loadedMessages: number
}

export type SessionWindowLoader = {
  // load 取首屏（或已缓存的首屏）。
  load: (scope: SessionScope, chatId: string) => Promise<any>
  // loadOlder 往前翻一窗，并把结果并回同一份会话文档。
  loadOlder: (scope: SessionScope, chatId: string) => Promise<any | null>
  // refresh 重取首窗并并回已加载的历史：写路径之后的刷新不能把更早的窗口丢掉。
  refresh: (scope: SessionScope, chatId: string) => Promise<any>
  peek: (scope: SessionScope, chatId: string) => SessionWindowState | null
  invalidate: (scope: SessionScope, chatId: string) => void
  invalidateScope: (scope: SessionScope) => void
  clear: () => void
}

export const SESSION_WINDOW_DEFAULT_LIMIT = 24
export const SESSION_WINDOW_DEFAULT_MAX_BYTES = 512 * 1024

function windowKey(scope: SessionScope, chatId: string) {
  return `${scope.kind}:${String(scope.targetId || '').trim()}:${String(chatId || '').trim()}`
}

function messageId(message: any): string {
  return String(message?.id || '').trim()
}

function messageCreatedAt(message: any): number {
  const value = Number(message?.createdAt || 0)
  if (Number.isFinite(value) && value > 0) return value
  const parsed = Date.parse(String(message?.createdAt || ''))
  return Number.isFinite(parsed) ? parsed : 0
}

// mergeWindowPage 把一窗消息并进会话文档：
//   - 按 id 去重（分页边界会重复给出锚点消息）
//   - 按 (createdAt, id) 稳定升序（与 wire 契约同源）
//   - 窗口文档的会话级字段只在首窗生效，后续窗不覆盖
export function mergeWindowPage(base: any, page: any): any {
  const baseMessages: any[] = Array.isArray(base?.messages) ? base.messages : []
  const pageMessages: any[] = Array.isArray(page?.messages) ? page.messages : []
  const byId = new Map<string, any>()
  for (const message of [...pageMessages, ...baseMessages]) {
    const id = messageId(message)
    if (!id || byId.has(id)) continue
    byId.set(id, message)
  }
  const messages = Array.from(byId.values()).sort((left, right) => {
    const l = messageCreatedAt(left)
    const r = messageCreatedAt(right)
    if (l !== r) return l - r
    return messageId(left).localeCompare(messageId(right))
  })
  return { ...base, messages }
}

// mergeRefreshedPage 是「写路径之后」的窗口合并：与 mergeWindowPage 的差别在于
// 首窗范围内的旧消息一律以新页为准。
//
// 为什么不能用 mergeWindowPage：它是按 id 并集，会把「已从首窗删掉的消息」
// 从旧文档里重新捞回来（已删消息复活）。写后刷新必须让首窗成为权威，
// 只保留严格早于首窗最早消息的历史（那些是用户已翻出来的、本次写不涉及的部分）。
export function mergeRefreshedPage(previous: any, page: any): any {
  const pageMessages: any[] = Array.isArray(page?.messages) ? page.messages : []
  const pageIds = new Set<string>()
  let oldestInPage = Number.POSITIVE_INFINITY
  for (const message of pageMessages) {
    const id = messageId(message)
    if (id) pageIds.add(id)
    const at = messageCreatedAt(message)
    if (at > 0 && at < oldestInPage) oldestInPage = at
  }
  const olderHistory = (Array.isArray(previous?.messages) ? previous.messages : []).filter((message: any) => {
    const id = messageId(message)
    if (!id || pageIds.has(id)) return false
    const at = messageCreatedAt(message)
    // 首窗为空（会话被清空）时保留不了任何历史。
    if (!Number.isFinite(oldestInPage)) return false
    // 严格早于首窗最早消息 = 已翻出的更早窗口；其余都属于首窗范围，以新页为准。
    return at > 0 && at < oldestInPage
  })
  return mergeWindowPage(page, { ...page, messages: olderHistory })
}

export function createSessionWindowLoader(deps: SessionWindowLoaderDeps): SessionWindowLoader {
  const { sessionSwitch, headFor, switchIdFor } = deps
  const initialLimit = Math.max(1, Math.floor(Number(deps.initialLimit) || SESSION_WINDOW_DEFAULT_LIMIT))
  const maxBytes = Math.max(1, Math.floor(Number(deps.maxBytes) || SESSION_WINDOW_DEFAULT_MAX_BYTES))

  const states = new Map<string, SessionWindowState>()
  const inflight = new Map<string, Promise<SessionWindowState>>()

  function supportsWindow() {
    return sessionSwitch.hasFeature('session.window')
  }

  // resolveHead 只在「首窗」请求里使用：翻页走 cursor，cursor 已内含 head。
  // 拿不到 head 时返回空串，让业务端用默认路径（等价旧行为）。
  function resolveHead(scope: SessionScope, chatId: string): string {
    if (typeof headFor !== 'function') return ''
    try {
      return String(headFor(scope, chatId) || '').trim()
    } catch (_) {
      return ''
    }
  }

  // resolveSwitchID 只在「首窗」请求里使用：翻页共享同一次切换的 switchId。
  // 拿不到时返回空串，请求就不带该字段（观测整条不启动）。
  function resolveSwitchID(scope: SessionScope, chatId: string): string {
    if (typeof switchIdFor !== 'function') return ''
    try {
      return String(switchIdFor(scope, chatId) || '').trim()
    } catch (_) {
      return ''
    }
  }

  function windowOptions(extra?: SessionWindowRequest): SessionWindowRequest {
    return {
      limit: initialLimit,
      maxBytes,
      profile: 'view',
      ...extra,
    }
  }

  async function requestPage(scope: SessionScope, chatId: string, options: SessionWindowRequest) {
    return sessionSwitch.sessionWindow(scope, chatId, windowOptions(options))
  }

  // requestHeadPage 是「首窗」请求：显式带上 head，实现「按 head 看路径」。
  async function requestHeadPage(scope: SessionScope, chatId: string) {
    const head = resolveHead(scope, chatId)
    const switchId = resolveSwitchID(scope, chatId)
    const extra: SessionWindowRequest = {}
    if (head) extra.head = head
    if (switchId) extra.switchId = switchId
    return requestPage(scope, chatId, extra)
  }

  function stateFromPage(scope: SessionScope, chatId: string, page: any, previous: SessionWindowState | null): SessionWindowState {
    const merged = previous ? mergeWindowPage(previous.chat, page) : mergeWindowPage(page, page)
    // 窗口端点由 chatId 寻址，身份由请求确定：分页切片不必重复携带会话级字段，
    // 但下游（normalizeStoredChat / UI 列表）必须始终拿得到可用文档。
    // windowPartial 是显式事实：这份会话只加载了一窗，
    // 条数与摘要都不代表整份会话，列表事实仍以索引为准。
    const chat = { ...merged, id: String(merged?.id || chatId), windowPartial: true }
    const nextCursor = String(page?.nextCursor || page?.cursor || '')
    return {
      scope,
      chatId,
      chat,
      nextCursor,
      hasMore: !!nextCursor,
      loadedMessages: Array.isArray(chat?.messages) ? chat.messages.length : 0,
    }
  }

  async function load(scope: SessionScope, chatIdRaw: string) {
    const chatId = String(chatIdRaw || '').trim()
    if (!chatId) return null
    if (!supportsWindow()) throw new Error('后端不支持 session.window')
    const key = windowKey(scope, chatId)
    const cached = states.get(key)
    if (cached) return cached.chat
    const pending = inflight.get(key)
    if (pending) return (await pending).chat

    const promise = requestHeadPage(scope, chatId)
      .then((page) => {
        const state = stateFromPage(scope, chatId, page, null)
        states.set(key, state)
        return state
      })
      .finally(() => {
        inflight.delete(key)
      })
    inflight.set(key, promise)
    return (await promise).chat
  }

  async function loadOlder(scope: SessionScope, chatIdRaw: string) {
    const chatId = String(chatIdRaw || '').trim()
    if (!chatId) return null
    if (!supportsWindow()) throw new Error('后端不支持 session.window')
    const key = windowKey(scope, chatId)
    const current = states.get(key)
    // 没有游标就说明已经没有更早的窗口：这不是错误，是分页的自然终点。
    if (!current || !current.nextCursor) return current?.chat || null

    const pending = inflight.get(key)
    if (pending) return (await pending).chat

    // 翻页属于同一次切换：cursor 之外还要带上同一个 switchId。
    const switchId = resolveSwitchID(scope, chatId)
    const pageOptions: SessionWindowRequest = { cursor: current.nextCursor }
    if (switchId) pageOptions.switchId = switchId
    const promise = requestPage(scope, chatId, pageOptions)
      .then((page) => {
        const state = stateFromPage(scope, chatId, page, current)
        states.set(key, state)
        return state
      })
      .finally(() => {
        inflight.delete(key)
      })
    inflight.set(key, promise)
    return (await promise).chat
  }

  function peek(scope: SessionScope, chatIdRaw: string) {
    const chatId = String(chatIdRaw || '').trim()
    if (!chatId) return null
    return states.get(windowKey(scope, chatId)) || null
  }

  // refresh 与 load 的差别只有一处：保留已经翻出来的更早窗口。
  // 写路径（编辑消息 / 删除消息）之后必须走它，否则会话会「缩水」回首屏。
  //
  // 关键：首窗范围内以新页为权威——不能用按 id 并集，
  // 否则从首窗删掉的消息会被旧文档重新捞回来（已删消息复活）。
  async function refresh(scope: SessionScope, chatIdRaw: string) {
    const chatId = String(chatIdRaw || '').trim()
    if (!chatId) return null
    if (!supportsWindow()) throw new Error('后端不支持 session.window')
    const key = windowKey(scope, chatId)
    const previous = states.get(key) || null
    const page = await requestHeadPage(scope, chatId)
    const merged = previous ? mergeRefreshedPage(previous.chat, page) : mergeWindowPage(page, page)
    const chat = { ...merged, id: String(merged?.id || chatId), windowPartial: true }
    const state: SessionWindowState = {
      scope,
      chatId,
      chat,
      nextCursor: previous ? previous.nextCursor : String(page?.nextCursor || page?.cursor || ''),
      hasMore: false,
      loadedMessages: Array.isArray(chat?.messages) ? chat.messages.length : 0,
    }
    // 已经翻过的窗口不会被首窗重取推翻：续翻锚点沿用旧游标（含「已到底」）。
    state.hasMore = !!state.nextCursor
    states.set(key, state)
    return state.chat
  }

  function invalidate(scope: SessionScope, chatIdRaw: string) {
    const chatId = String(chatIdRaw || '').trim()
    if (!chatId) return
    states.delete(windowKey(scope, chatId))
  }

  function invalidateScope(scope: SessionScope) {
    const prefix = `${scope.kind}:${String(scope.targetId || '').trim()}:`
    for (const key of [...states.keys()]) {
      if (key.startsWith(prefix)) states.delete(key)
    }
  }

  function clear() {
    states.clear()
    inflight.clear()
  }

  return { load, loadOlder, refresh, peek, invalidate, invalidateScope, clear }
}
