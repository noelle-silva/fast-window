import * as React from 'react'
import { encodeSidebarPreviewTarget, type SidebarPreviewTarget } from './previewTarget'
import { useSidebarPreviewHover } from './useSidebarPreviewHover'

// 按住预览：快捷键按住期间，悬停任一边栏条目即在主区域覆盖展示其预览。
// 现场负责快捷键与边栏事件的接线，模块负责预览目标状态、悬停去重、延迟还原与滚轮转发。

export function useSidebarHoldPreview(opts: { visible: boolean }): {
  previewTarget: SidebarPreviewTarget | null
  previewHoldRef: React.MutableRefObject<boolean>
  previewOverlayScrollRef: React.MutableRefObject<HTMLDivElement | null>
  cancelPreviewClear: () => void
  applyPreviewTarget: (target: SidebarPreviewTarget | null) => void
  handleSidebarPreviewHover: (target: SidebarPreviewTarget | null) => void
  leftPreviewHover: { onMouseOver: React.MouseEventHandler<HTMLElement> }
  rightPreviewHover: { onMouseOver: React.MouseEventHandler<HTMLElement> }
  stopPreview: () => void
} {
  const { visible } = opts

  const [previewTarget, setPreviewTarget] = React.useState<SidebarPreviewTarget | null>(null)
  const previewHoldRef = React.useRef(false)
  const previewTargetKeyRef = React.useRef('')
  const previewOverlayScrollRef = React.useRef<HTMLDivElement | null>(null)
  // 条目间存在缝隙，指针扫过缝隙时不应立即还原，否则会在条目间来回闪烁。
  // 离开条目后短暂延迟再还原；期间进入下一条目即取消，实现无缝切换。
  const previewClearTimerRef = React.useRef<number | null>(null)

  const cancelPreviewClear = React.useCallback(() => {
    if (previewClearTimerRef.current === null) return
    window.clearTimeout(previewClearTimerRef.current)
    previewClearTimerRef.current = null
  }, [])

  // 预览目标写入的唯一入口：按目标键去重，避免同一目标在鼠标移动中反复触发重渲染。
  const applyPreviewTarget = React.useCallback((target: SidebarPreviewTarget | null) => {
    const key = target ? encodeSidebarPreviewTarget(target) : ''
    if (key === previewTargetKeyRef.current) return
    previewTargetKeyRef.current = key
    setPreviewTarget(target)
  }, [])

  // 边栏条目悬停上报：按住快捷键时，鼠标进入条目即切换预览，离开条目延迟还原。
  const handleSidebarPreviewHover = React.useCallback(
    (target: SidebarPreviewTarget | null) => {
      if (!previewHoldRef.current) return
      if (target) {
        cancelPreviewClear()
        applyPreviewTarget(target)
        return
      }
      if (previewClearTimerRef.current !== null) return
      previewClearTimerRef.current = window.setTimeout(() => {
        previewClearTimerRef.current = null
        if (previewHoldRef.current) applyPreviewTarget(null)
      }, 100)
    },
    [applyPreviewTarget, cancelPreviewClear],
  )
  const leftPreviewHover = useSidebarPreviewHover({ onHover: handleSidebarPreviewHover })
  const rightPreviewHover = useSidebarPreviewHover({ onHover: handleSidebarPreviewHover })

  const stopPreview = React.useCallback(() => {
    previewHoldRef.current = false
    cancelPreviewClear()
    applyPreviewTarget(null)
  }, [applyPreviewTarget, cancelPreviewClear])

  // 现场切走时还原预览：常驻现场不销毁，遗留的预览态不得跨现场泄漏。
  React.useEffect(() => {
    if (!visible) stopPreview()
  }, [stopPreview, visible])

  // 卸载时清掉待还原定时器，避免定时器在组件销毁后触发状态写入。
  React.useEffect(() => cancelPreviewClear, [cancelPreviewClear])

  // 预览期间在原位滚轮：把边栏上的滚轮事件转发给覆盖层滚动容器，滚动主区域预览内容。
  React.useEffect(() => {
    if (!visible) return
    const onWheelCapture = (e: WheelEvent) => {
      const overlay = previewOverlayScrollRef.current
      if (!overlay) return
      const target = e.target instanceof Element ? e.target : null
      if (!target) return
      if (target.closest('[data-hc-hold-preview-overlay="1"]')) return
      if (!target.closest('[data-hc-preview-entry]')) return
      overlay.scrollTop += e.deltaY
      e.preventDefault()
    }
    window.addEventListener('wheel', onWheelCapture, { capture: true, passive: false })
    return () => window.removeEventListener('wheel', onWheelCapture, true)
  }, [visible])

  return {
    previewTarget,
    previewHoldRef,
    previewOverlayScrollRef,
    cancelPreviewClear,
    applyPreviewTarget,
    handleSidebarPreviewHover,
    leftPreviewHover,
    rightPreviewHover,
    stopPreview,
  }
}
