// 全局关系图的布局与外观设置：斥力、紧凑度、节点半径上下限、连线粗细、箭头显示。
// 关系图浮层、应用设置归一化共用同一解析，保证设置形态单一事实源。

export type HyperCortexGraphSettingsV1 = {
  /** 斥力（力导向负电荷强度，越负越散）。 */
  repulsion: number
  /** 往中心收的紧凑度（向心力的强度，越大越紧凑）。 */
  centerStrength: number
  /** 节点半径最小值：孤立笔记取该值。 */
  minNodeRadius: number
  /** 节点半径最大值：连接数最多的笔记取该值。 */
  maxNodeRadius: number
  /** 连线粗细（画布线宽）。 */
  linkWidth: number
  /** 是否绘制引用方向箭头。 */
  showArrows: boolean
  /** 悬停时是否虚化其余节点：开启只保留该节点及其直接邻居，关闭则悬停不虚化。 */
  dimOnHover: boolean
}

export const GRAPH_REPULSION_DEFAULT = 120
export const GRAPH_REPULSION_MIN = 10
export const GRAPH_REPULSION_MAX = 600
export const GRAPH_REPULSION_STEP = 10

export const GRAPH_CENTER_STRENGTH_DEFAULT = 0.06
export const GRAPH_CENTER_STRENGTH_MIN = 0
export const GRAPH_CENTER_STRENGTH_MAX = 0.4
export const GRAPH_CENTER_STRENGTH_STEP = 0.01

export const GRAPH_NODE_RADIUS_DEFAULT_MIN = 7
export const GRAPH_NODE_RADIUS_DEFAULT_MAX = 13
export const GRAPH_NODE_RADIUS_LIMIT_MIN = 2
export const GRAPH_NODE_RADIUS_LIMIT_MAX = 40
export const GRAPH_NODE_RADIUS_STEP = 1

export const GRAPH_LINK_WIDTH_DEFAULT = 1.2
export const GRAPH_LINK_WIDTH_MIN = 0.5
export const GRAPH_LINK_WIDTH_MAX = 6
export const GRAPH_LINK_WIDTH_STEP = 0.1

export const DEFAULT_GRAPH_SETTINGS: HyperCortexGraphSettingsV1 = {
  repulsion: GRAPH_REPULSION_DEFAULT,
  centerStrength: GRAPH_CENTER_STRENGTH_DEFAULT,
  minNodeRadius: GRAPH_NODE_RADIUS_DEFAULT_MIN,
  maxNodeRadius: GRAPH_NODE_RADIUS_DEFAULT_MAX,
  linkWidth: GRAPH_LINK_WIDTH_DEFAULT,
  showArrows: true,
  dimOnHover: true,
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value)
  const base = Number.isFinite(n) ? n : fallback
  return Math.min(Math.max(base, min), max)
}

export function normalizeGraphSettings(input: unknown): HyperCortexGraphSettingsV1 {
  const source = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const minNodeRadius = Math.round(
    clampNumber(source.minNodeRadius, GRAPH_NODE_RADIUS_LIMIT_MIN, GRAPH_NODE_RADIUS_LIMIT_MAX, GRAPH_NODE_RADIUS_DEFAULT_MIN),
  )
  const maxNodeRadius = Math.round(
    clampNumber(source.maxNodeRadius, minNodeRadius, GRAPH_NODE_RADIUS_LIMIT_MAX, GRAPH_NODE_RADIUS_DEFAULT_MAX),
  )
  return {
    repulsion: clampNumber(source.repulsion, GRAPH_REPULSION_MIN, GRAPH_REPULSION_MAX, GRAPH_REPULSION_DEFAULT),
    centerStrength: clampNumber(source.centerStrength, GRAPH_CENTER_STRENGTH_MIN, GRAPH_CENTER_STRENGTH_MAX, GRAPH_CENTER_STRENGTH_DEFAULT),
    minNodeRadius,
    maxNodeRadius,
    linkWidth: clampNumber(source.linkWidth, GRAPH_LINK_WIDTH_MIN, GRAPH_LINK_WIDTH_MAX, GRAPH_LINK_WIDTH_DEFAULT),
    showArrows: source.showArrows !== false,
    dimOnHover: source.dimOnHover !== false,
  }
}
