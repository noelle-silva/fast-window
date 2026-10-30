// 消息级渲染缓存（加速器，不是主线）。
//
// 缓存对象是「消毒后的顶层块 HTML 数组」，不是整串、不是 DOM 节点：
//   - 顶层块是 domCommit 的增量单位，命中后可直接提交，跳过解析与消毒；
//   - 不缓存 DOM 节点：节点带交互与生命周期，跨消息复用会制造隐式耦合。
//
// 三层淘汰同时生效：
//   - 条目上限（防止无限增长）；
//   - 字节预算（只按条数会被单条超大消息击穿）；
//   - 会话代际（会话内容整体换代时，该会话的条目整批作废）。
//
// 明确不缓存：未消毒 HTML、流式中态、失败降级结果。

// 引擎语义变化时必须升版本，否则旧缓存会被当成新结果复用。
export const ENGINE_VERSION = 1
export const MESSAGE_CACHE_MAX_ENTRIES = 300
export const MESSAGE_CACHE_MAX_BYTES = 16 * 1024 * 1024

// hash64：两个独立 FNV-1a 32 位哈希拼成 64 位。
// 目的只是「内容指纹」，不用于安全；碰撞概率对 300 条上限完全够用。
export function hash64(value: unknown): string {
  const text = String(value ?? '')
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    h1 ^= code
    h1 = Math.imul(h1, 0x01000193)
    h2 = Math.imul(h2 ^ code, 0x85ebca6b)
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`
}

export type MessageCacheKeyParts = {
  source: string
  policy: string
  capsSignature: string
  // scope 是会话身份：不同会话的相同文本互不干扰。
  scope: string
}

export function messageCacheKey(parts: MessageCacheKeyParts): string {
  return [
    hash64(parts.source),
    String(parts.source.length),
    `v${ENGINE_VERSION}`,
    String(parts.policy || ''),
    String(parts.capsSignature || ''),
    String(parts.scope || ''),
  ].join('|')
}

type Entry = {
  blocks: string[]
  bytes: number
  scope: string
  generation: number
}

export type MessageCache = {
  get: (key: string) => string[] | null
  put: (key: string, blocks: string[], scope: string) => void
  // 会话代际换代：该会话的全部条目整批作废。
  invalidateScope: (scope: string) => void
  // 全局换代：引擎语义或渲染条件整体变化时使用。
  bumpGeneration: () => void
  clear: () => void
  readonly size: number
  readonly bytes: number
}

function blocksBytes(blocks: string[]) {
  let total = 0
  for (const block of blocks) total += block.length
  return total
}

export function createMessageCache(options?: {
  maxEntries?: number
  maxBytes?: number
}): MessageCache {
  const maxEntries = Math.max(1, Math.floor(Number(options?.maxEntries ?? MESSAGE_CACHE_MAX_ENTRIES) || MESSAGE_CACHE_MAX_ENTRIES))
  const maxBytes = Math.max(1, Math.floor(Number(options?.maxBytes ?? MESSAGE_CACHE_MAX_BYTES) || MESSAGE_CACHE_MAX_BYTES))

  const entries = new Map<string, Entry>()
  const scopeGeneration = new Map<string, number>()
  let globalGeneration = 0
  let totalBytes = 0

  function evictOne() {
    // Map 保持插入序；命中时重插到队尾，所以队首就是最久未用的。
    const oldest = entries.keys().next().value
    if (typeof oldest !== 'string') return false
    const entry = entries.get(oldest)
    entries.delete(oldest)
    if (entry) totalBytes -= entry.bytes
    return true
  }

  function generationOf(scope: string) {
    return (scopeGeneration.get(scope) || 0) + globalGeneration
  }

  function get(key: string): string[] | null {
    const entry = entries.get(key)
    if (!entry) return null
    if (entry.generation !== generationOf(entry.scope)) {
      entries.delete(key)
      totalBytes -= entry.bytes
      return null
    }
    entries.delete(key)
    entries.set(key, entry)
    return entry.blocks
  }

  function put(key: string, blocks: string[], scopeRaw: string) {
    const list = Array.isArray(blocks) ? blocks : []
    if (!list.length) return
    const scope = String(scopeRaw || '')
    const bytes = blocksBytes(list)
    if (bytes > maxBytes) return

    const existing = entries.get(key)
    if (existing) {
      entries.delete(key)
      totalBytes -= existing.bytes
    }

    while (entries.size >= maxEntries || totalBytes + bytes > maxBytes) {
      if (!evictOne()) break
    }

    entries.set(key, { blocks: list.slice(), bytes, scope, generation: generationOf(scope) })
    totalBytes += bytes
  }

  function invalidateScope(scopeRaw: string) {
    const scope = String(scopeRaw || '')
    if (!scope) return
    scopeGeneration.set(scope, (scopeGeneration.get(scope) || 0) + 1)
    for (const [key, entry] of Array.from(entries.entries())) {
      if (entry.scope !== scope) continue
      entries.delete(key)
      totalBytes -= entry.bytes
    }
  }

  function bumpGeneration() {
    globalGeneration += 1
    entries.clear()
    totalBytes = 0
  }

  return {
    get,
    put,
    invalidateScope,
    bumpGeneration,
    clear: () => {
      entries.clear()
      totalBytes = 0
    },
    get size() {
      return entries.size
    },
    get bytes() {
      return totalBytes
    },
  }
}

// 进程级单例：缓存跨消息共享才有意义。
export const messageHtmlCache = createMessageCache()
