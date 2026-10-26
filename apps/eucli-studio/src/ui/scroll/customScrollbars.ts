import { CUSTOM_SCROLL_THUMB_ATTR } from '../../core/scrollMetrics'

// 自制滚动条的样式常量。
// 几何度量与拖拽换算在 src/core/scrollMetrics.ts（纯计算，渲染管道也能用）。

export const customScrollbarHiddenSx = {
  scrollbarWidth: 'none',
  msOverflowStyle: 'none',
  '&::-webkit-scrollbar': { display: 'none', width: 0, height: 0 },
} as const

// 悬停在滚动容器上时让自制滑块显形；放在「与滑块同处一个定位上下文」的外框上。
export const customScrollbarRevealSx = {
  [`&:hover [${CUSTOM_SCROLL_THUMB_ATTR}="1"]`]: { opacity: 1 },
} as const
