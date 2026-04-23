export type LruCacheOptions = {
  maxEntries: number
}

/**
 * Minimal LRU cache.
 *
 * - get() marks entry as recently used
 * - set() overwrites and refreshes recency
 */
export class LruCache<K, V> {
  private readonly maxEntries: number
  private readonly map = new Map<K, V>()

  constructor(opts: LruCacheOptions) {
    const max = Math.max(0, Math.floor(Number(opts?.maxEntries) || 0))
    this.maxEntries = max
  }

  get size() {
    return this.map.size
  }

  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined
    const v = this.map.get(key) as V
    // Refresh recency.
    this.map.delete(key)
    this.map.set(key, v)
    return v
  }

  set(key: K, value: V) {
    if (this.maxEntries <= 0) return
    if (this.map.has(key)) this.map.delete(key)
    this.map.set(key, value)
    this.evictIfNeeded()
  }

  delete(key: K) {
    this.map.delete(key)
  }

  clear() {
    this.map.clear()
  }

  private evictIfNeeded() {
    while (this.map.size > this.maxEntries) {
      const firstKey = this.map.keys().next().value as K | undefined
      if (firstKey === undefined) break
      this.map.delete(firstKey)
    }
  }
}
