export type CustomScrollAxis = 'x' | 'y'

export type CustomScrollMetrics = {
  canY: boolean
  canX: boolean
  yTop: number
  yHeight: number
  xLeft: number
  xWidth: number
}

type DragState = {
  axis: CustomScrollAxis
  pointerId: number
  startPointer: number
  startScroll: number
  maxScroll: number
  maxThumbTravel: number
}

export const CUSTOM_SCROLL_EDGE_INSET = 4
export const CUSTOM_SCROLL_MIN_THUMB_SIZE = 34
export const CUSTOM_SCROLL_THUMB_THICKNESS = 7
export const CUSTOM_SCROLL_THUMB_ATTR = 'data-eucli-scroll-thumb'

export const customScrollbarHiddenSx = {
  scrollbarWidth: 'none',
  msOverflowStyle: 'none',
  '&::-webkit-scrollbar': { display: 'none', width: 0, height: 0 },
} as const

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

export function measureCustomScrollArea(el: HTMLElement): CustomScrollMetrics {
  const height = Math.max(0, el.clientHeight)
  const width = Math.max(0, el.clientWidth)
  const maxY = Math.max(0, el.scrollHeight - height)
  const maxX = Math.max(0, el.scrollWidth - width)
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
