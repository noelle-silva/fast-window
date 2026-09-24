import * as React from 'react'

import type { FaceContentStore } from './protocol'

/**
 * 面内容存储：面内容的唯一持有者；可编辑面用它承载未保存草稿，只读面用它承载静态内容。
 * 宿主只通过 getContent / isDirty 取内容与脏标记，不持久化内容本身。
 */
export type { FaceContentStore }

/** 文本型面的通用内容存储（markdown / html 等文本内容的插件可直接复用）。 */
export function createTextContentStore(initialContent: string, savedContent: string = initialContent): FaceContentStore {
  let saved = String(savedContent ?? '')
  let content = String(initialContent ?? '')
  const listeners = new Set<() => void>()
  const emit = () => {
    for (const listener of Array.from(listeners)) listener()
  }
  return {
    getContent: () => content,
    setContent: next => {
      const value = String(next ?? '')
      if (value === content) return
      content = value
      emit()
    },
    subscribe: listener => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    reset: next => {
      const value = String(next ?? '')
      saved = value
      content = value
      emit()
    },
    isDirty: () => content !== saved,
  }
}

/** 宿主侧订阅钩子：视窗通过它读取面内容并触发重渲染。 */
export function useFaceContent(store: FaceContentStore | null | undefined): { content: string; setContent: (next: string) => void } {
  const content = React.useSyncExternalStore(
    React.useCallback(
      (listener: () => void) => (store ? store.subscribe(listener) : () => {}),
      [store],
    ),
    () => (store ? store.getContent() : ''),
    () => '',
  )
  const setContent = React.useCallback((next: string) => {
    store?.setContent(next)
  }, [store])
  return { content, setContent }
}
