import { now } from '../core/utils'
import type { ProjectionScope } from './splitProjectionCache'
import { projectionScopeKey } from './splitProjectionCache'

// ChatBodyLoader（design-1 三层架构的第三层）：
//
//   ChatBodyLoader = 单飞 + LRU
//
// 三条硬约束：
//   1. 单飞：同一会话并发加载只打一次请求，等待者共享同一 promise；
//   2. 有界：条目上限 + 字节预算，双上限同时生效（只按条数会被单条大会话击穿）；
//   3. 显式失效：写路径必须调用 invalidate / invalidateScope / clear，
//      禁止用 TTL 当数据刷新通道（TTL 会让「刚写完的会话」读到旧值）。
//
// 失效必须是「代际」语义而不是「删条目」：一次失效之后，失效之前发起、
// 失效之后才落地的 in-flight 读取绝不能把旧正文重新塞回缓存。
// 这就是 generation 的职责——每个 key 一个代数，store 时校验代数是否还成立。

const DEFAULT_MAX_ENTRIES = 24
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024

export type ChatBodyEntry = {
  key: string
  scope: string
  chatId: string
  chat: any
  bytes: number
  loadedAt: number
}

export type ChatBodyLoaderDeps = {
  load: (scope: ProjectionScope, chatId: string) => Promise<any>
  maxEntries?: number
  maxBytes?: number
  // estimateBytes 只在需要字节预算时调用：默认用消息条数做廉价估算。
  estimateBytes?: (chat: any) => number
}

export type ChatBodyLoader = {
  load: (scope: ProjectionScope, chatId: string) => Promise<any>
  peek: (scope: ProjectionScope, chatId: string) => any | null
  // remember 是翻页结果回写：窗口加载器拼出更长会话后写回缓存，
  // 下一次 load 直接命中，不再重复打业务端。
  remember: (scope: ProjectionScope, chatId: string, chat: any) => void
  invalidate: (scope: ProjectionScope, chatId: string) => void
  invalidateScope: (scope: ProjectionScope) => void
  clear: () => void
  stats: () => { entries: number; bytes: number; inflight: number }
}

export function chatBodyKey(scope: ProjectionScope, chatId: string): string {
  return `${projectionScopeKey(scope)}:${String(chatId || '').trim()}`
}

function defaultEstimateBytes(chat: any): number {
  if (!chat || typeof chat !== 'object') return 0
  const messages = Array.isArray(chat.messages) ? chat.messages : []
  let bytes = 512
  for (const message of messages) {
    bytes += 256
    const content = typeof message?.content === 'string' ? message.content.length : 0
    bytes += content * 2
    const parts = Array.isArray(message?.parts) ? message.parts : []
    for (const part of parts) {
      const text = typeof part?.text === 'string' ? part.text.length : 0
      const raw = typeof part?.raw === 'string' ? part.raw.length : 0
      bytes += (text + raw) * 2
    }
  }
  return bytes
}

export function createChatBodyLoader(deps: ChatBodyLoaderDeps): ChatBodyLoader {
  const maxEntries = Math.max(1, Math.floor(Number(deps.maxEntries) || DEFAULT_MAX_ENTRIES))
  const maxBytes = Math.max(64 * 1024, Math.floor(Number(deps.maxBytes) || DEFAULT_MAX_BYTES))
  const estimateBytes = deps.estimateBytes || defaultEstimateBytes

  // Map 的插入序即 LRU 序：命中时先 delete 再 set 把条目提到最新。
  const entries = new Map<string, ChatBodyEntry>()
  // in-flight 必须带代数：失效之前发起的读取，失效之后既不能回填，
  // 也不能被新的 load 直接复用（那等于把旧正文又交出去一次）。
  const inflight = new Map<string, { generation: number; promise: Promise<any> }>()
  const generations = new Map<string, number>()
  let totalBytes = 0

  function generationOf(key: string): number {
    const current = generations.get(key)
    if (current !== undefined) return current
    generations.set(key, 0)
    return 0
  }

  function bumpGeneration(key: string) {
    generations.set(key, generationOf(key) + 1)
  }

  function evictIfNeeded() {
    while (entries.size > maxEntries || totalBytes > maxBytes) {
      const oldest = entries.keys().next()
      if (oldest.done) break
      const entry = entries.get(oldest.value)
      entries.delete(oldest.value)
      totalBytes -= entry ? entry.bytes : 0
    }
    if (totalBytes < 0) totalBytes = 0
  }

  function touch(key: string): ChatBodyEntry | null {
    const entry = entries.get(key)
    if (!entry) return null
    entries.delete(key)
    entries.set(key, entry)
    return entry
  }

  function store(key: string, scope: string, chatId: string, chat: any) {
    if (!chat || typeof chat !== 'object') return
    const bytes = Math.max(0, Math.floor(Number(estimateBytes(chat)) || 0))
    // 单条超过总预算的会话不缓存：它会把其它条目全部挤掉，收益为负。
    if (bytes > maxBytes) return
    const existing = entries.get(key)
    if (existing) totalBytes -= existing.bytes
    entries.delete(key)
    entries.set(key, { key, scope, chatId, chat, bytes, loadedAt: now() })
    totalBytes += bytes
    evictIfNeeded()
  }

  function dropEntry(key: string) {
    const entry = entries.get(key)
    if (!entry) return
    entries.delete(key)
    totalBytes -= entry.bytes
    if (totalBytes < 0) totalBytes = 0
  }

  async function load(scope: ProjectionScope, chatIdRaw: string): Promise<any> {
    const chatId = String(chatIdRaw || '').trim()
    if (!chatId) return null
    const key = chatBodyKey(scope, chatId)
    const cached = touch(key)
    if (cached) return cached.chat

    const generation = generationOf(key)
    const pending = inflight.get(key)
    // 只有同代在途请求可以复用：上一代的请求即使还没回来也已经作废。
    if (pending && pending.generation === generation) return pending.promise

    const promise = deps
      .load(scope, chatId)
      .then((chat) => {
        // 失效发生在读取途中：这次结果属于上一代，绝不能回填。
        if (generationOf(key) !== generation) return chat
        store(key, projectionScopeKey(scope), chatId, chat)
        return chat
      })
      .finally(() => {
        if (inflight.get(key)?.promise === promise) inflight.delete(key)
      })
    inflight.set(key, { generation, promise })
    return promise
  }

  function peek(scope: ProjectionScope, chatIdRaw: string) {
    const chatId = String(chatIdRaw || '').trim()
    if (!chatId) return null
    return touch(chatBodyKey(scope, chatId))?.chat || null
  }

  function remember(scope: ProjectionScope, chatIdRaw: string, chat: any) {
    const chatId = String(chatIdRaw || '').trim()
    if (!chatId) return
    store(chatBodyKey(scope, chatId), projectionScopeKey(scope), chatId, chat)
  }

  function invalidate(scope: ProjectionScope, chatIdRaw: string) {
    const chatId = String(chatIdRaw || '').trim()
    if (!chatId) return
    const key = chatBodyKey(scope, chatId)
    // 代数先推进：即使条目本来不存在，正在途中的旧读取也必须作废。
    bumpGeneration(key)
    dropEntry(key)
    // 旧代的在途请求不再具备复用价值，直接摘掉让下一次 load 重新发起。
    const pending = inflight.get(key)
    if (pending && pending.generation !== generationOf(key)) inflight.delete(key)
  }

  function invalidateScope(scope: ProjectionScope) {
    const prefix = `${projectionScopeKey(scope)}:`
    // 候选键 = 已缓存条目 + 已知代数（remember 可能先于 load 发生）。
    const keys = new Set<string>()
    for (const key of entries.keys()) if (key.startsWith(prefix)) keys.add(key)
    for (const key of generations.keys()) if (key.startsWith(prefix)) keys.add(key)
    for (const key of keys) {
      bumpGeneration(key)
      dropEntry(key)
      const pending = inflight.get(key)
      if (pending && pending.generation !== generationOf(key)) inflight.delete(key)
    }
  }

  function clear() {
    // 全清同样推进所有已知 key 的代数，避免在途读取把旧正文塞回来。
    for (const key of [...generations.keys()]) bumpGeneration(key)
    entries.clear()
    inflight.clear()
    totalBytes = 0
  }

  return {
    load,
    peek,
    remember,
    invalidate,
    invalidateScope,
    clear,
    stats: () => ({ entries: entries.size, bytes: totalBytes, inflight: inflight.size }),
  }
}
