import * as React from 'react'
import type { PageId } from './workspacePages'

// 笔记主区域滚动位置的记录与还原：按笔记标识记账，滚动时帧节流写入，切换/可见化时还原。
// 现场负责提供滚动容器引用与当前页面/笔记状态，模块负责记账容器与滚动副作用。

/** 现场层：持有主区域滚动容器与按笔记标识的滚动位置记账，并装配保存/还原副作用。 */
export function useNoteScrollMemory(opts: {
  visible: boolean
  page: PageId
  activeNoteId: string
  pageRef: React.MutableRefObject<PageId>
  activeNoteIdRef: React.MutableRefObject<string>
}): {
  mainScrollElRef: React.MutableRefObject<HTMLDivElement | null>
  noteScrollTopByIdRef: React.MutableRefObject<Record<string, number>>
} {
  const { visible, page, activeNoteId, pageRef, activeNoteIdRef } = opts
  const mainScrollElRef = React.useRef<HTMLDivElement | null>(null)
  const noteScrollTopByIdRef = React.useRef<Record<string, number>>({})
  const scrollSaveRafRef = React.useRef<number | null>(null)

  React.useEffect(() => {
    const el = mainScrollElRef.current
    if (!el) return

    const onScroll = () => {
      if (scrollSaveRafRef.current != null) return
      scrollSaveRafRef.current = requestAnimationFrame(() => {
        scrollSaveRafRef.current = null
        if (!visible) return
        if (pageRef.current !== 'note-detail') return
        const nid = String(activeNoteIdRef.current || '').trim()
        if (!nid) return
        noteScrollTopByIdRef.current[nid] = el.scrollTop
      })
    }

    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      if (scrollSaveRafRef.current != null) cancelAnimationFrame(scrollSaveRafRef.current)
      scrollSaveRafRef.current = null
    }
  }, [activeNoteId, page, visible])

  React.useLayoutEffect(() => {
    const el = mainScrollElRef.current
    if (!el) return
    if (!visible) return
    if (page !== 'note-detail') return
    const nid = String(activeNoteId || '').trim()
    if (!nid) return
    const saved = noteScrollTopByIdRef.current[nid]
    const next = typeof saved === 'number' && Number.isFinite(saved) && saved > 0 ? saved : 0
    el.scrollTop = next
  }, [activeNoteId, page, visible])

  return { mainScrollElRef, noteScrollTopByIdRef }
}
