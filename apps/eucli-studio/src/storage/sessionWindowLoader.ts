import type { SessionScope, SessionSwitchClient, SessionWindowRequest } from '../protocol/sessionSwitchProtocol'
import { resolveChatMessageUnionFact } from '../domain/chatBodyPrecedence'
import { createGenerationGuard, createInflightRegistry } from './cacheGuard'
import {
  applySessionIdentity,
  mergeSessionIdentity,
  sessionIdentityFromChat,
  type ChatSessionIdentity,
  type SessionIdentityResolver,
} from '../domain/sessionIdentity'

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
// 会话级事实（标题 / 创建时间 / 更新时间）不由窗口端点保证：
// 分页切片只承担消息，因此加载器必须从「会话索引」补齐这些事实，
// 否则下游会用「新聊天」/now() 兜底，把真实标题与时间覆盖掉、排序错乱。
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
  // resolveIdentity 提供会话级事实的唯一来源（会话索引里的 chatMeta）。
  // 窗口端点不带这些字段时由它补齐；缺席则只能用窗口自身携带的事实。
  resolveIdentity?: SessionIdentityResolver
}

export type SessionWindowState = {
  scope: SessionScope
  chatId: string
  chat: any
  nextCursor: string
  hasMore: boolean
  loadedMessages: number
}

// WindowReadResult 是读取的落地判定：
//   stale=false —— 属于当前代，state 可以交给调用方（已写入分页状态）；
//   stale=true  —— 属于上一代（期间发生过失效），调用方必须丢弃并重取。
type WindowReadResult = { stale: boolean; state: SessionWindowState | null }

function settled(state: SessionWindowState): WindowReadResult {
  return { stale: false, state }
}

const STALE: WindowReadResult = { stale: true, state: null }

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

// 一次读取最多重取几轮：只在「读到一半被失效作废」时才会用上。
// 连续失效说明状态在抖动，必须快速失败，而不是无限打业务端。
const MAX_STALE_ATTEMPTS = 2

function windowKey(scope: SessionScope, chatId: string) {
  return `${scope.kind}:${String(scope.targetId || '').trim()}:${String(chatId || '').trim()}`
}

function messageId(message: any): string {
  return String(message?.id || '').trim()
}

// windowPageHasMessages 判断一页窗口是否真的带有消息。
// 「空页」是业务端对 head 无法解析的一种可能答复，不能当成「会话为空」。
function windowPageHasMessages(page: any): boolean {
  return Array.isArray(page?.messages) && page.messages.length > 0
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
  // 同一 id 以新页（服务端事实）为准，旧文档（本地投影）只补缺。
  const messages = resolveChatMessageUnionFact({
    authoritative: pageMessages,
    secondary: baseMessages,
  }).sort((left, right) => {
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
  // 与正文缓存同一套机制：失效推进代数，在途读取落地时校验代数。
  // 失效之前发起的请求（load / loadOlder / refresh）失效之后一律不得回填，
  // 否则「已删除的会话」会被旧窗口重新写回，「编辑后的正文」会被旧页覆盖。
  const guard = createGenerationGuard()
  const inflight = createInflightRegistry<SessionWindowState | null>()

  // commit 是分页状态唯一的落地动作。
  //
  // 它同时承担「写序」职责：每次成功写入都推进代数，让同一代的其它在途写入
  // （refresh 与 loadOlder 并发时最常见）在落地时发现自己已经过期，从而丢弃。
  // 没有这一步，「首窗重取」会覆盖刚翻出的更早窗口，「旧翻页」也会把已删除的
  // 消息并回新正文——两者都属于旧结果覆盖新事实。
  function commit(key: string, state: SessionWindowState) {
    guard.advance(key)
    states.set(key, state)
  }

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
  //
  // head 来自本地已加载会话的活动分支，而本地在运行期会先出现「尚未落盘」的
  // 运行时消息（runtimePartial）。用这种 head 去切已落盘的会话，业务端可能
  // 解析不到该锚点而返回空窗。空窗不是「会话为空」的证据，绝不能据此清空正文，
  // 因此这里在拿到空窗时退一次「不带 head」的默认路径（等价旧行为）。
  async function requestHeadPage(scope: SessionScope, chatId: string) {
    const head = resolveHead(scope, chatId)
    const switchId = resolveSwitchID(scope, chatId)
    const extra: SessionWindowRequest = {}
    if (head) extra.head = head
    if (switchId) extra.switchId = switchId
    const page = await requestPage(scope, chatId, extra)
    if (head && !windowPageHasMessages(page)) {
      const retry: SessionWindowRequest = {}
      if (switchId) retry.switchId = switchId
      return requestPage(scope, chatId, retry)
    }
    return page
  }

  // resolveIdentity 是「会话级事实」的唯一询问点：事实源在会话索引里。
  // 没有注入解析器时返回 null（只能用窗口自身携带的事实）。
  // 注入了解析器却读不出来时必须向上抛：会话级事实缺失是真实故障，
  // 静默吞掉只会让标题与时间退化成兜底值，正是这次要修的问题。
  async function resolveIdentity(scope: SessionScope, chatId: string): Promise<ChatSessionIdentity | null> {
    if (typeof deps.resolveIdentity !== 'function') return null
    const resolved = await deps.resolveIdentity({ kind: scope.kind, targetId: String(scope.targetId || '').trim() }, chatId)
    return resolved || null
  }

  // identityFor 表达会话级事实的优先级：页内事实 > 索引事实 > 已加载会话的既有事实。
  //
  // 窗口端点按契约只承担消息，页内通常不带会话级字段，此时由索引补齐；
  // 页内若显式携带了真实事实，说明它与索引来自同一次读取，比缓存更可信。
  // 已加载会话排最后：它是上一次补齐的结果，只能补缺，不能压过新读取。
  async function identityFor(scope: SessionScope, chatId: string, page: any, previous: SessionWindowState | null): Promise<ChatSessionIdentity | null> {
    const indexIdentity = await resolveIdentity(scope, chatId)
    const local = mergeSessionIdentity(indexIdentity, sessionIdentityFromChat(previous?.chat))
    return mergeSessionIdentity(sessionIdentityFromChat(page), local)
  }

  async function stateFromPage(scope: SessionScope, chatId: string, page: any, previous: SessionWindowState | null): Promise<SessionWindowState> {
    const merged = previous ? mergeWindowPage(previous.chat, page) : mergeWindowPage(page, page)
    // 窗口端点由 chatId 寻址，身份由请求确定：分页切片不必重复携带会话级字段，
    // 但下游（normalizeStoredChat / UI 列表）必须始终拿得到可用文档。
    //
    // 会话级事实（标题 / 创建时间 / 更新时间）由 identityFor 补齐：
    // 缺了它们，normalizeStoredChat 会用「新聊天」/now() 兜底，
    // 侧边栏标题与排序时间就会被兜底值覆盖。
    // windowPartial 是显式事实：这份会话只加载了一窗，
    // 条数与摘要都不代表整份会话，列表事实仍以索引为准。
    const identity = await identityFor(scope, chatId, page, previous)
    const chat = applySessionIdentity({ ...merged, id: String(merged?.id || chatId), windowPartial: true }, identity)
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
    const result = await readWithGeneration(key, () => loadHeadOnce(key, scope, chatId))
    return result.state ? result.state.chat : null
  }

  // loadHeadOnce 取一次首窗：命中缓存直接返回，在途请求按「同代」合流。
  async function loadHeadOnce(key: string, scope: SessionScope, chatId: string): Promise<WindowReadResult> {
    const cached = states.get(key)
    if (cached) return settled(cached)
    const generation = guard.current(key)
    const pending = inflight.find(key, generation)
    if (pending) {
      const state = await pending
      return state ? settled(state) : STALE
    }

    const promise = requestHeadPage(scope, chatId)
      .then(async (page) => {
        // 失效发生在读取途中：这次窗口属于上一代，绝不能写回。
        if (!guard.isCurrent(key, generation)) return null
        const state = await stateFromPage(scope, chatId, page, null)
        // 补齐会话级事实期间同样可能发生失效：落地前再确认一次。
        if (!guard.isCurrent(key, generation)) return null
        commit(key, state)
        return state
      })
      .finally(() => {
        inflight.release(key, promise)
      })
    inflight.track(key, generation, promise)
    const state = await promise
    return state ? settled(state) : STALE
  }

  async function loadOlder(scope: SessionScope, chatIdRaw: string) {
    const chatId = String(chatIdRaw || '').trim()
    if (!chatId) return null
    if (!supportsWindow()) throw new Error('后端不支持 session.window')
    const key = windowKey(scope, chatId)
    const result = await readWithGeneration(key, () => loadOlderOnce(key, scope, chatId))
    return result.state ? result.state.chat : null
  }

  async function loadOlderOnce(key: string, scope: SessionScope, chatId: string): Promise<WindowReadResult> {
    const current = states.get(key)
    // 没有游标就说明已经没有更早的窗口：这不是错误，是分页的自然终点。
    if (!current || !current.nextCursor) return { stale: false, state: current || null }

    const generation = guard.current(key)
    const pending = inflight.find(key, generation)
    if (pending) {
      const state = await pending
      return state ? settled(state) : STALE
    }

    // 翻页属于同一次切换：cursor 之外还要带上同一个 switchId。
    const switchId = resolveSwitchID(scope, chatId)
    const pageOptions: SessionWindowRequest = { cursor: current.nextCursor }
    if (switchId) pageOptions.switchId = switchId
    const promise = requestPage(scope, chatId, pageOptions)
      .then(async (page) => {
        // 失效发生在翻页途中：分页状态已经换代，旧页不得并回。
        if (!guard.isCurrent(key, generation)) return null
        const state = await stateFromPage(scope, chatId, page, current)
        // 补齐会话级事实期间同样可能发生失效：落地前再确认一次。
        if (!guard.isCurrent(key, generation)) return null
        commit(key, state)
        return state
      })
      .finally(() => {
        inflight.release(key, promise)
      })
    inflight.track(key, generation, promise)
    const state = await promise
    return state ? settled(state) : STALE
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
    const result = await readWithGeneration(key, () => refreshOnce(key, scope, chatId))
    return result.state ? result.state.chat : null
  }

  async function refreshOnce(key: string, scope: SessionScope, chatId: string): Promise<WindowReadResult> {
    // previous 必须取「本次请求所属代」的基线；落地前再确认它没有被别的写入替换。
    const previous = states.get(key) || null
    const generation = guard.current(key)
    const page = await requestHeadPage(scope, chatId)
    // 失效发生在重取途中：旧首窗会把已删消息 / 旧正文带回来，绝不能落缓存。
    if (!guard.isCurrent(key, generation)) return STALE
    const merged = previous ? mergeRefreshedPage(previous.chat, page) : mergeWindowPage(page, page)
    const identity = await identityFor(scope, chatId, page, previous)
    // 补齐会话级事实期间同样可能发生失效或已被更新的写入抢先：
    // 旧首窗落地会把新正文 / 已翻出的历史覆盖掉。
    if (!guard.isCurrent(key, generation)) return STALE
    const chat = applySessionIdentity({ ...merged, id: String(merged?.id || chatId), windowPartial: true }, identity)
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
    commit(key, state)
    return settled(state)
  }

  // readWithGeneration 是「失效即作废」的统一出口：
  // 一次读取若在落地时发现代数已推进，说明期间发生过失效，
  // 这份结果属于上一代 —— 丢弃并重取，绝不把旧数据交给调用方。
  // 重取有上限：连续失效说明状态在抖动，必须快速失败而不是无限打业务端。
  async function readWithGeneration(
    key: string,
    attempt: () => Promise<WindowReadResult>,
  ): Promise<WindowReadResult> {
    for (let round = 0; round < MAX_STALE_ATTEMPTS; round++) {
      const result = await attempt()
      if (!result.stale) return result
    }
    throw new Error('会话窗口在连续失效中无法收敛')
  }

  function invalidate(scope: SessionScope, chatIdRaw: string) {
    const chatId = String(chatIdRaw || '').trim()
    if (!chatId) return
    const key = windowKey(scope, chatId)
    // 代数先推进：即使条目本来不存在，正在途中的旧读取也必须作废。
    guard.advance(key)
    states.delete(key)
    inflight.drop(key)
  }

  function invalidateScope(scope: SessionScope) {
    const prefix = `${scope.kind}:${String(scope.targetId || '').trim()}:`
    const matches = (key: string) => key.startsWith(prefix)
    // 先给已缓存分页状态登记代数（在途读取可能还没落地），再按 scope 统一换代。
    for (const key of states.keys()) guard.current(key)
    guard.advanceMatching(matches)
    for (const key of states.keys()) if (matches(key)) states.delete(key)
    inflight.dropMatching(matches)
  }

  function clear() {
    // 全清同样推进所有已知 key 的代数，避免在途读取把旧窗口塞回来。
    guard.advanceAll()
    states.clear()
    inflight.clear()
  }

  return { load, loadOlder, refresh, peek, invalidate, invalidateScope, clear }
}
