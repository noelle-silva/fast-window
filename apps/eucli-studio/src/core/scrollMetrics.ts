// 自制滚动条的几何度量与拖拽换算。
//
// 纯计算：不创建 DOM、不含任何视觉样式，因此可以被两条渲染路径共用：
//   - React 容器与多行输入框：src/ui/scroll/CustomScrollbar.tsx
//   - 渲染管道产出的裸 DOM（Markdown 表格）：src/render/scrollbar.ts
// 「指针位移 → 滚动位置」的换算只有这一处实现，两边的拖拽手感天然一致。

export type CustomScrollAxis = 'x' | 'y'

export type CustomScrollMetrics = {
  canY: boolean
  canX: boolean
  yTop: number
  yHeight: number
  xLeft: number
  xWidth: number
}

export const CUSTOM_SCROLL_EDGE_INSET = 4
export const CUSTOM_SCROLL_MIN_THUMB_SIZE = 34
export const CUSTOM_SCROLL_THUMB_THICKNESS = 7
export const CUSTOM_SCROLL_THUMB_ATTR = 'data-eucli-scroll-thumb'

export function sameCustomScrollMetrics(a: CustomScrollMetrics, b: CustomScrollMetrics) {
  return (
    a.canY === b.canY &&
    a.canX === b.canX &&
    Math.round(a.yTop) === Math.round(b.yTop) &&
    Math.round(a.yHeight) === Math.round(b.yHeight) &&
    Math.round(a.xLeft) === Math.round(b.xLeft) &&
    Math.round(a.xWidth) === Math.round(b.xWidth)
  )
}

// thumbTravelSize 返回滑块沿该轴可移动的距离：轨道长度减去两端内缩与滑块自身长度。
// 至少给 1，避免除零把拖拽换算变成 NaN。
export function thumbTravelSize(args: { viewportSize: number; thumbSize: number }) {
  return Math.max(1, args.viewportSize - CUSTOM_SCROLL_EDGE_INSET * 2 - args.thumbSize)
}

// computeThumbDragScroll 把「指针位移」换算成「滚动位置」。
// startScroll 是按下时的滚动位置，因此拖拽过程不累积误差；结果钳制在合法区间。
export function computeThumbDragScroll(args: {
  startScroll: number
  pointerDelta: number
  maxScroll: number
  maxThumbTravel: number
}) {
  const maxScroll = Math.max(0, args.maxScroll)
  const travel = Math.max(1, args.maxThumbTravel)
  const next = args.startScroll + args.pointerDelta * (maxScroll / travel)
  return Math.min(Math.max(next, 0), maxScroll)
}

export function measureCustomScrollArea(el: HTMLElement, options?: { allowX?: boolean }): CustomScrollMetrics {
  const allowX = options?.allowX !== false
  const height = Math.max(0, el.clientHeight)
  const width = Math.max(0, el.clientWidth)
  const maxY = Math.max(0, el.scrollHeight - height)
  const maxX = allowX ? Math.max(0, el.scrollWidth - width) : 0
  const yRange = Math.max(0, height - CUSTOM_SCROLL_EDGE_INSET * 2)
  const xRange = Math.max(0, width - CUSTOM_SCROLL_EDGE_INSET * 2)
  const yHeight = maxY > 1 ? Math.min(yRange, Math.max(CUSTOM_SCROLL_MIN_THUMB_SIZE, (height / Math.max(el.scrollHeight, 1)) * yRange)) : 0
  const xWidth = maxX > 1 ? Math.min(xRange, Math.max(CUSTOM_SCROLL_MIN_THUMB_SIZE, (width / Math.max(el.scrollWidth, 1)) * xRange)) : 0
  const yTop = maxY > 1 && yRange > yHeight ? CUSTOM_SCROLL_EDGE_INSET + (el.scrollTop / maxY) * (yRange - yHeight) : CUSTOM_SCROLL_EDGE_INSET
  const xLeft = maxX > 1 && xRange > xWidth ? CUSTOM_SCROLL_EDGE_INSET + (el.scrollLeft / maxX) * (xRange - xWidth) : CUSTOM_SCROLL_EDGE_INSET

  return {
    canY: maxY > 1 && yRange > CUSTOM_SCROLL_MIN_THUMB_SIZE,
    canX: maxX > 1 && xRange > CUSTOM_SCROLL_MIN_THUMB_SIZE,
    yTop,
    yHeight,
    xLeft,
    xWidth,
  }
}
