import * as React from 'react'
import { SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_MIN } from '../../domain/uiMode'
import { clampNum } from '../utils/numbers'
import { useEvent } from './useEvent'

// 侧边栏宽度拖拽：拖动中直接改 DOM 的宽度（不触发 React 重渲染），松手才提交一次。
// 提交后的宽度成为新的事实源；外部宽度变化（切换模式等）时再同步回内联宽度。
export function useSidebarResize(deps: {
  side: 'left' | 'right'
  width: number
  onCommit: (width: number) => void
}) {
  const { side, width: savedWidth, onCommit } = deps
  const sidebarRef = React.useRef<HTMLElement | null>(null)
  const [resizing, setResizing] = React.useState(false)
  const dragRef = React.useRef<{ pid: number; startX: number; startW: number } | null>(null)
  const lastXRef = React.useRef(0)
  const rafRef = React.useRef(0)
  const widthRef = React.useRef(savedWidth)

  // 外部宽度（含切换模式）变化时同步到内联样式；拖拽期间由拖拽逻辑独占。
  React.useEffect(() => {
    widthRef.current = savedWidth
    const el = sidebarRef.current
    if (el) el.style.width = `${savedWidth}px`
  }, [savedWidth])

  const onSplitterPointerDown = useEvent((e: React.PointerEvent) => {
    if (e.button !== 0) return
    const el = sidebarRef.current
    const startW = el ? Number(el.getBoundingClientRect().width || savedWidth) : savedWidth
    widthRef.current = startW
    lastXRef.current = Number(e.clientX || 0)
    dragRef.current = { pid: Number(e.pointerId), startX: Number(e.clientX || 0), startW }
    setResizing(true)
    e.preventDefault()
    e.stopPropagation()
    try {
      ;(e.currentTarget as any)?.setPointerCapture?.(e.pointerId)
    } catch (_) {}
  })

  const onSplitterPointerMove = useEvent((e: React.PointerEvent) => {
    const st = dragRef.current
    if (!st) return
    if (Number(e.pointerId) !== st.pid) return
    lastXRef.current = Number(e.clientX || 0)
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      const cur = dragRef.current
      const el = sidebarRef.current
      if (!cur || !el) return
      const dx = lastXRef.current - cur.startX
      const raw = side === 'right' ? cur.startW - dx : cur.startW + dx
      const next = clampNum(Math.round(raw), SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX)
      widthRef.current = next
      // 直接写 DOM：绕开 React 渲染，拖拽跟手。
      el.style.width = `${next}px`
    })
  })

  const endResize = useEvent((e?: React.PointerEvent) => {
    const st = dragRef.current
    if (!st) return
    if (e && Number(e.pointerId) !== st.pid) return
    dragRef.current = null
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
    setResizing(false)
    onCommit(clampNum(Math.round(widthRef.current), SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX))
  })

  React.useEffect(() => {
    if (!resizing) return
    const onUp = () => endResize()
    window.addEventListener('mouseup', onUp)
    window.addEventListener('blur', onUp)
    return () => {
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('blur', onUp)
    }
  }, [resizing, endResize])

  return { sidebarRef, resizing, onSplitterPointerDown, onSplitterPointerMove, endResize }
}
