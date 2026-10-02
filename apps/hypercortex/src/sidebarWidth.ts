// 侧边栏展开宽度的边界与归一化。左右侧栏共用同一解析，
// 设置面板、拖拽落库、布局计算都从这里取值，保证宽度事实源唯一。

export const DEFAULT_SIDEBAR_EXPANDED_WIDTH = 220
export const MIN_SIDEBAR_EXPANDED_WIDTH = 160
export const MAX_SIDEBAR_EXPANDED_WIDTH = 520

export function normalizeSidebarExpandedWidth(value: unknown): number {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return DEFAULT_SIDEBAR_EXPANDED_WIDTH
  if (n < MIN_SIDEBAR_EXPANDED_WIDTH) return MIN_SIDEBAR_EXPANDED_WIDTH
  if (n > MAX_SIDEBAR_EXPANDED_WIDTH) return MAX_SIDEBAR_EXPANDED_WIDTH
  return n
}

// 拖拽手柄的横向位移 → 新宽度。右侧栏向左拖（位移为负）才是变宽。
export function resolveSidebarExpandedWidthFromDrag(
  side: 'left' | 'right',
  startWidth: number,
  deltaX: number,
): number {
  return normalizeSidebarExpandedWidth(startWidth + (side === 'left' ? deltaX : -deltaX))
}
