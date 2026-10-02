// 边栏外壳的物理布局：宽度与展开形态。左侧「已打开笔记」栏与右侧「收藏夹导航」栏共用同一套计算。
// 手动模式展开时挤压主内容；悬停模式收起为窄轨道，展开时以浮层覆盖主内容。

import { DEFAULT_SIDEBAR_EXPANDED_WIDTH, normalizeSidebarExpandedWidth } from '../sidebarWidth'

export const SIDEBAR_RAIL_WIDTH = 52

export type SidebarMode = 'manual' | 'hover'

export type SidebarLayoutInput = {
  mode: SidebarMode
  collapsed: boolean
  /** 悬停模式下鼠标是否停留在边栏上；手动模式忽略此值。 */
  hoverOpen: boolean
  /** 展开宽度（可拖拽调整）；缺省用默认宽度。 */
  expandedWidth?: number
}

export type SidebarLayout = {
  /** 轨道占位宽度：无论是否展开，主内容都为此让出的空间。 */
  railWidth: number
  /** 面板实际宽度。 */
  panelWidth: number
  /** 面板展开时的目标宽度（已归一化）。 */
  expandedWidth: number
  /** 面板是否处于展开（可见完整内容）状态。 */
  expanded: boolean
  /** 展开时是否以浮层覆盖主内容（悬停模式）。 */
  overlay: boolean
}

export function resolveSidebarLayout(input: SidebarLayoutInput): SidebarLayout {
  const expandedWidth = input.expandedWidth === undefined
    ? DEFAULT_SIDEBAR_EXPANDED_WIDTH
    : normalizeSidebarExpandedWidth(input.expandedWidth)
  if (input.mode === 'hover') {
    const expanded = input.hoverOpen
    return {
      railWidth: SIDEBAR_RAIL_WIDTH,
      panelWidth: expanded ? expandedWidth : SIDEBAR_RAIL_WIDTH,
      expandedWidth,
      expanded,
      overlay: expanded,
    }
  }
  const railWidth = input.collapsed ? SIDEBAR_RAIL_WIDTH : expandedWidth
  return {
    railWidth,
    panelWidth: railWidth,
    expandedWidth,
    expanded: !input.collapsed,
    overlay: false,
  }
}
