import * as React from 'react'

export type SortableClickGuard = {
  onDragStart: () => void
  onDragStop: () => void
  shouldIgnoreClick: () => boolean
}

// 整行拖拽与点击共用同一指针区域：拖拽结束后浏览器仍会补发 click，
// 这里在拖拽期间抑制点选，避免「拖完顺手打开编辑」。
export function useSortableClickGuard(): SortableClickGuard {
  const draggingRef = React.useRef(false)
  const onDragStart = React.useCallback(() => {
    draggingRef.current = true
  }, [])
  const onDragStop = React.useCallback(() => {
    setTimeout(() => {
      draggingRef.current = false
    }, 0)
  }, [])
  const shouldIgnoreClick = React.useCallback(() => draggingRef.current, [])
  return { onDragStart, onDragStop, shouldIgnoreClick }
}
