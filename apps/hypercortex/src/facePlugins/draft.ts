import * as React from 'react'

import type { FaceDraftStore } from './protocol'

/**
 * 面草稿存储：草稿归插件自持，视图与保存共用同一份内容。
 * 宿主只通过 getContent / isDirty 取内容与脏标记，不保存草稿本身。
 */
export type { FaceDraftStore }

/** 文本型面的通用草稿存储（markdown / html 等文本内容的插件可直接复用）。 */
export function createTextDraftStore(initialContent: string): FaceDraftStore {
  let saved = initialContent
  let content = initialContent
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

/** 宿主侧订阅钩子：视窗通过它读取草稿内容并触发重渲染。 */
export function useFaceDraft(store: FaceDraftStore | null | undefined): { content: string; setContent: (next: string) => void } {
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
