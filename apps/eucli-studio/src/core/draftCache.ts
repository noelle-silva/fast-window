import * as React from 'react'

// 编辑中的草稿缓存：模态窗关掉、层级换来换去，没保存的改动都不该丢。
//
// 只做一件事：按调用方给的键存一份值，并在变化时通知订阅者。
// 键怎么拼、值是什么语义，全由各自的领域模块决定——这里不认识任务也不认识提示词。
export type DraftCache<T> = {
  get: (key: string) => T | null
  has: (key: string) => boolean
  set: (key: string, value: T) => void
  remove: (key: string) => void
  clear: () => void
  keys: () => string[]
  version: () => number
  subscribe: (listener: () => void) => () => void
}

export function createDraftCache<T>(): DraftCache<T> {
  const items = new Map<string, T>()
  let version = 0
  const listeners = new Set<() => void>()

  const notify = () => {
    version += 1
    listeners.forEach((listener) => listener())
  }

  return {
    get: (key) => (items.has(key) ? (items.get(key) as T) : null),
    has: (key) => items.has(key),
    set: (key, value) => {
      items.set(key, value)
      notify()
    },
    remove: (key) => {
      if (!items.delete(key)) return
      notify()
    },
    clear: () => {
      if (!items.size) return
      items.clear()
      notify()
    },
    keys: () => Array.from(items.keys()),
    version: () => version,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/** 订阅某份草稿缓存的变化，拿到的是版本号：缓存一变，用它的组件就重渲染。 */
export function useDraftCacheVersion<T>(cache: DraftCache<T>): number {
  return React.useSyncExternalStore(cache.subscribe, cache.version, cache.version)
}
