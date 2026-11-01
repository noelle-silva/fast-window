// 缓存失效的代数守卫（索引 / 窗口 / 正文三条缓存共用）。
//
// 失效不是「删条目」而是「换代」：一次失效之后，失效之前发起、失效之后才落地的
// 读取属于上一代，既不能回填缓存，也不能被后续读取复用。
//
// 把「代数」与「在途登记」抽成一份机制：三个缓存只负责取数 / 组装 / 淘汰，
// 不必各自重写一遍失效语义。

export type GenerationGuard = {
  // current 取当前代数；第一次访问的 key 从 0 开始。
  current: (key: string) => number
  // advance 推进代数：这是「失效」的唯一动作。
  advance: (key: string) => void
  // advanceMatching 批量换代：按 scope 前缀失效时用，覆盖「在途但还没落地」的键。
  advanceMatching: (match: (key: string) => boolean) => void
  advanceAll: () => void
  // isCurrent 判断某个请求捕获的代数是否仍然成立（成立才允许回填）。
  isCurrent: (key: string, generation: number) => boolean
}

export function createGenerationGuard(): GenerationGuard {
  const generations = new Map<string, number>()

  function current(key: string): number {
    const value = generations.get(key)
    if (value !== undefined) return value
    generations.set(key, 0)
    return 0
  }

  function advance(key: string) {
    generations.set(key, current(key) + 1)
  }

  function advanceMatching(match: (key: string) => boolean) {
    for (const key of [...generations.keys()]) if (match(key)) advance(key)
  }

  function advanceAll() {
    for (const key of [...generations.keys()]) advance(key)
  }

  function isCurrent(key: string, generation: number): boolean {
    return current(key) === generation
  }

  return { current, advance, advanceMatching, advanceAll, isCurrent }
}

// 在途登记：同代（且同 version）的在途请求可以复用，其余一律视为已作废。
// version 是调用方额外的维度（投影缓存用它携带 epoch）。
export type InflightRegistry<T> = {
  find: (key: string, generation: number, version?: number) => Promise<T> | null
  track: (key: string, generation: number, promise: Promise<T>, version?: number) => Promise<T>
  release: (key: string, promise: Promise<T>) => void
  drop: (key: string) => void
  dropMatching: (match: (key: string) => boolean) => void
  clear: () => void
  size: () => number
}

type InflightEntry<T> = { generation: number; version: number; promise: Promise<T> }

export function createInflightRegistry<T>(): InflightRegistry<T> {
  const pending = new Map<string, InflightEntry<T>>()

  function find(key: string, generation: number, version = 0): Promise<T> | null {
    const entry = pending.get(key)
    if (!entry) return null
    if (entry.generation !== generation || entry.version !== version) return null
    return entry.promise
  }

  function track(key: string, generation: number, promise: Promise<T>, version = 0): Promise<T> {
    pending.set(key, { generation, version, promise })
    return promise
  }

  // release 只摘自己：旧代请求落地时不能把同 key 的新代在途登记删掉。
  function release(key: string, promise: Promise<T>) {
    if (pending.get(key)?.promise === promise) pending.delete(key)
  }

  function drop(key: string) {
    pending.delete(key)
  }

  function dropMatching(match: (key: string) => boolean) {
    for (const key of [...pending.keys()]) if (match(key)) pending.delete(key)
  }

  function clear() {
    pending.clear()
  }

  function size() {
    return pending.size
  }

  return { find, track, release, drop, dropMatching, clear, size }
}
