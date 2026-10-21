import * as React from 'react'
import { type SidebarSide } from '../../domain/sidebarLayout'
import { resolveSidebarLineX, resolveSidebarWidthFromLine } from '../../domain/sidebarResize'
import { setSidebarResizeLock } from '../sidebarResizeLock'
import { useEvent } from './useEvent'

// 侧边栏宽度拖拽：拖动期间不改任何宽度，只让一条竖线随光标左右移动；
// 松手时才按竖线位置换算成宽度、提交一次（只重排一次）。
// 指针事件挂在整窗，指针到哪竖线到哪，快速拖动不丢跟。
export function useSidebarResize(deps: {
  side: SidebarSide
  onCommit: (width: number) => void
}) {
  const { side, onCommit } = deps
  const sidebarRef = React.useRef<HTMLElement | null>(null)
  const lineRef = React.useRef<HTMLDivElement | null>(null)
  const [resizing, setResizing] = React.useState(false)
  // 拖拽态：锚点（侧边栏贴边的那条外缘的横坐标）与竖线当前横坐标。
  const dragRef = React.useRef<{ pid: number; anchorX: number; lineX: number } | null>(null)
  const sideRef = React.useRef(side)
  sideRef.current = side
  const commit = useEvent(onCommit)

  const onSplitterPointerDown = useEvent((e: React.PointerEvent) => {
    if (e.button !== 0) return
    const el = sidebarRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const anchorX = sideRef.current === 'left' ? rect.left : rect.right
    const width = resolveSidebarWidthFromLine(sideRef.current, anchorX, Number(e.clientX || 0))
    dragRef.current = {
      pid: Number(e.pointerId),
      anchorX,
      lineX: resolveSidebarLineX(sideRef.current, anchorX, width),
    }
    e.preventDefault()
    e.stopPropagation()
    setResizing(true)
  })

  React.useEffect(() => {
    if (!resizing) return

    const applyLine = () => {
      const st = dragRef.current
      const line = lineRef.current
      if (!st || !line) return
      line.style.transform = `translateX(${st.lineX}px)`
    }

    const onMove = (e: PointerEvent) => {
      const st = dragRef.current
      if (!st || e.pointerId !== st.pid) return
      const s = sideRef.current
      const width = resolveSidebarWidthFromLine(s, st.anchorX, Number(e.clientX || 0))
      st.lineX = resolveSidebarLineX(s, st.anchorX, width)
      applyLine()
    }

    const onUp = (e: PointerEvent) => {
      const st = dragRef.current
      if (!st || e.pointerId !== st.pid) return
      dragRef.current = null
      const width = resolveSidebarWidthFromLine(sideRef.current, st.anchorX, st.lineX)
      setResizing(false)
      commit(width)
    }

    // 竖线起始落在光标处。
    applyLine()
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    setSidebarResizeLock(true)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      setSidebarResizeLock(false)
    }
  }, [resizing, commit])

  return { sidebarRef, lineRef, resizing, onSplitterPointerDown }
}
