import * as React from 'react'
import { Box } from '@mui/material'
import type { SidebarLayout } from './sidebarLayout'
import { resolveSidebarExpandedWidthFromDrag } from '../sidebarWidth'

export type SidebarRailProps = {
  /** 边栏所在侧：决定浮层锚点、阴影方向与拖拽方向。 */
  side: 'left' | 'right'
  layout: SidebarLayout
  /** 拖拽结束回调最终宽度；未提供则不显示拖拽手柄。 */
  onResizeEnd?: (width: number) => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
  /** 悬停条目委托：边栏条目的悬停上报统一在轨道外壳上监听。 */
  onMouseOver?: React.MouseEventHandler<HTMLDivElement>
  children: React.ReactNode
}

// 边栏外壳：轨道占位 + 面板 + 悬停覆盖 + 边界拖拽手柄。左右边栏共用，仅锚点、阴影与拖拽方向随所在侧翻转。
// 拖拽期间的宽度变化属于瞬时物理表现，直接写 DOM，不进入 React 状态树；仅松手后上报最终宽度。
export function SidebarRail(props: SidebarRailProps): React.ReactNode {
  const { side, layout, onResizeEnd, onMouseEnter, onMouseLeave, onMouseOver, children } = props
  const overlay = layout.overlay
  const outerRef = React.useRef<HTMLDivElement | null>(null)
  const panelRef = React.useRef<HTMLDivElement | null>(null)
  const dragRef = React.useRef<null | { pointerId: number; startX: number; startWidth: number; width: number }>(null)
  const [dragging, setDragging] = React.useState(false)

  // 非拖拽时清空手动内联宽度，交回样式系统接管，避免残留覆盖后续状态。
  React.useLayoutEffect(() => {
    if (dragging) return
    if (outerRef.current) {
      outerRef.current.style.width = ''
      outerRef.current.style.minWidth = ''
    }
    if (panelRef.current) panelRef.current.style.width = ''
  }, [dragging, layout.railWidth, layout.panelWidth])

  const applyWidth = React.useCallback(
    (width: number) => {
      if (overlay) {
        if (panelRef.current) panelRef.current.style.width = `${width}px`
        return
      }
      if (outerRef.current) {
        outerRef.current.style.width = `${width}px`
        outerRef.current.style.minWidth = `${width}px`
      }
      if (panelRef.current) panelRef.current.style.width = `${width}px`
    },
    [overlay],
  )

  const handlePointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!onResizeEnd) return
      e.preventDefault()
      e.stopPropagation()
      e.currentTarget.setPointerCapture(e.pointerId)
      dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startWidth: layout.expandedWidth, width: layout.expandedWidth }
      setDragging(true)
    },
    [layout.expandedWidth, onResizeEnd],
  )

  const handlePointerMove = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const state = dragRef.current
      if (!state || state.pointerId !== e.pointerId) return
      const width = resolveSidebarExpandedWidthFromDrag(side, state.startWidth, e.clientX - state.startX)
      if (width === state.width) return
      state.width = width
      applyWidth(width)
    },
    [applyWidth, side],
  )

  const handlePointerEnd = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const state = dragRef.current
      if (!state || state.pointerId !== e.pointerId) return
      dragRef.current = null
      setDragging(false)
      onResizeEnd?.(state.width)
    },
    [onResizeEnd],
  )

  // 拖拽期间锁定悬停展开：指针滑出轨道不触发收起，避免面板中途塌缩。
  const handleMouseEnter = React.useCallback(() => {
    if (dragging) return
    onMouseEnter?.()
  }, [dragging, onMouseEnter])

  const handleMouseLeave = React.useCallback(() => {
    if (dragging) return
    onMouseLeave?.()
  }, [dragging, onMouseLeave])

  const showHandle = !!onResizeEnd && (layout.expanded || dragging)

  return (
    <Box
      ref={outerRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseOver={onMouseOver}
      sx={{
        width: layout.railWidth,
        minWidth: layout.railWidth,
        minHeight: 0,
        position: 'relative',
        bgcolor: 'var(--hc-surface-soft)',
      }}
    >
      <Box
        ref={panelRef}
        sx={{
          width: layout.panelWidth,
          minHeight: 0,
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          bgcolor: 'var(--hc-surface)',
          position: overlay ? 'absolute' : 'relative',
          left: side === 'left' ? 0 : 'auto',
          right: side === 'right' ? 0 : 'auto',
          top: 0,
          bottom: 0,
          zIndex: overlay ? 20 : 'auto',
          boxShadow: layout.panelWidth > layout.railWidth ? (side === 'left' ? '12px 0 30px rgba(15,23,42,.07)' : '-12px 0 30px rgba(15,23,42,.07)') : 'none',
        }}
      >
        {children}
        {showHandle ? (
          <Box
            role="separator"
            aria-orientation="vertical"
            aria-label="拖拽调整侧边栏宽度"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            onPointerCancel={handlePointerEnd}
            sx={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              zIndex: 30,
              width: 6,
              left: side === 'left' ? 'auto' : -3,
              right: side === 'left' ? -3 : 'auto',
              cursor: 'col-resize',
              touchAction: 'none',
              userSelect: 'none',
              bgcolor: dragging ? 'var(--hc-primary)' : 'transparent',
              opacity: dragging ? 0.6 : 1,
              transition: 'background-color 120ms ease',
              '&:hover': { bgcolor: 'var(--hc-primary)', opacity: 0.5 },
            }}
          />
        ) : null}
      </Box>
    </Box>
  )
}
