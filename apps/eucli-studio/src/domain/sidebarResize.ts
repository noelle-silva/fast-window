// 侧边栏宽度拖拽的纯几何：竖线位置 ↔ 宽度，按侧别换算，并统一夹在上下限内。
// 拖拽期间只移动竖线、不落宽度；松手时才用这里换算出的宽度提交一次。

import { normalizeSidebarWidth, type SidebarSide } from './sidebarLayout'

// 竖线在窗口中的横坐标 → 侧边栏宽度。
// 侧边栏在左：宽度 = 竖线到左锚点的距离；在右：宽度 = 右锚点到竖线的距离。
export function resolveSidebarWidthFromLine(side: SidebarSide, anchorX: number, lineX: number): number {
  return normalizeSidebarWidth(side === 'left' ? lineX - anchorX : anchorX - lineX)
}

// 宽度 → 竖线应在的横坐标（拖拽起点与限位回填用）。
export function resolveSidebarLineX(side: SidebarSide, anchorX: number, width: number): number {
  return side === 'left' ? anchorX + width : anchorX - width
}
