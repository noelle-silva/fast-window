import { SIDEBAR_TABS_VARIANT_DEFAULT, normalizeSidebarTabsVariant, type SidebarTabsVariant } from './sidebarTabs'

// 侧边栏布局：客户端内部有两个侧边栏身份 A / B。
// A 是原有的角色 / 工作区侧边栏，B 是预留的另一侧栏；两者各自存侧别与宽度。
// 唯一不变量：两个侧边栏必须分居窗口两侧，不能同时靠左或同时靠右。
// 因此「侧别」不按每个栏独立保存的自由值去理解，而是由 applySidebarSide 统一裁决：
// 指定任一侧的侧别，另一侧必然翻到对侧。

export type SidebarId = 'a' | 'b'
export type SidebarSide = 'left' | 'right'

export type SidebarConfig = {
  side: SidebarSide
  width: number
  /** 顶部切换栏的样式；两侧各选一份，互不影响。 */
  tabsVariant: SidebarTabsVariant
}

export type SidebarLayout = Record<SidebarId, SidebarConfig>

export const SIDEBAR_LAYOUT_SETTING_KEY = 'sidebarLayout'
export const SIDEBAR_IDS: readonly SidebarId[] = ['a', 'b']
export const SIDEBAR_WIDTH_MIN = 200
export const SIDEBAR_WIDTH_MAX = 560
export const SIDEBAR_WIDTH_DEFAULT = 260

export function isSidebarId(raw: unknown): raw is SidebarId {
  return raw === 'a' || raw === 'b'
}

export function normalizeSidebarSide(raw: unknown): SidebarSide {
  return String(raw ?? '').trim() === 'right' ? 'right' : 'left'
}

export function normalizeSidebarWidth(raw: unknown): number {
  const n = Number(raw)
  if (!isFinite(n)) return SIDEBAR_WIDTH_DEFAULT
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(n)))
}

export function normalizeSidebarConfig(raw: any, fallbackSide: SidebarSide): SidebarConfig {
  const box = raw && typeof raw === 'object' ? raw : {}
  return {
    side: box.side === undefined ? fallbackSide : normalizeSidebarSide(box.side),
    width: normalizeSidebarWidth(box.width),
    tabsVariant: normalizeSidebarTabsVariant(box.tabsVariant),
  }
}

export function oppositeSidebarSide(side: SidebarSide): SidebarSide {
  return side === 'left' ? 'right' : 'left'
}

// 扁平形态（历史单侧栏配置）只描述一个侧别与宽度，作为 A 的初值；B 落到对侧。
function normalizeFromFlat(box: any): SidebarLayout {
  const a = normalizeSidebarConfig(box, 'left')
  return {
    a,
    b: { side: oppositeSidebarSide(a.side), width: SIDEBAR_WIDTH_DEFAULT, tabsVariant: SIDEBAR_TABS_VARIANT_DEFAULT },
  }
}

// 双栏形态：A 决定基准侧别，B 缺失时落到对侧；B 显式给出的侧别若与 A 相同，判定为 A 的对侧。
export function normalizeSidebarLayout(raw: any): SidebarLayout {
  const box = raw && typeof raw === 'object' ? raw : {}
  const hasIdSections = 'a' in box || 'b' in box
  if (!hasIdSections) return normalizeFromFlat(box)

  const a = normalizeSidebarConfig(box.a, 'left')
  const b = normalizeSidebarConfig(box.b, oppositeSidebarSide(a.side))
  return {
    a,
    b: { side: b.side === a.side ? oppositeSidebarSide(a.side) : b.side, width: b.width, tabsVariant: b.tabsVariant },
  }
}

export function resolveSidebarLayout(settings: any): SidebarLayout {
  const box = settings && typeof settings === 'object' ? settings : {}
  return normalizeSidebarLayout(box[SIDEBAR_LAYOUT_SETTING_KEY])
}

// 侧别裁决：把某一栏放到指定侧，另一栏自动翻到对侧，保证互斥不变量永远成立。
export function applySidebarSide(layout: SidebarLayout, id: SidebarId, side: SidebarSide): SidebarLayout {
  const target = normalizeSidebarSide(side)
  const otherId: SidebarId = id === 'a' ? 'b' : 'a'
  return {
    ...layout,
    [id]: { ...layout[id], side: target },
    [otherId]: { ...layout[otherId], side: oppositeSidebarSide(target) },
  } as SidebarLayout
}

// 宽度只作用于目标栏，互不影响。
export function applySidebarWidth(layout: SidebarLayout, id: SidebarId, width: number): SidebarLayout {
  return { ...layout, [id]: { ...layout[id], width: normalizeSidebarWidth(width) } } as SidebarLayout
}

// 顶部切换栏样式：同样只作用于目标栏，两侧可以各选一种。
export function applySidebarTabsVariant(layout: SidebarLayout, id: SidebarId, variant: unknown): SidebarLayout {
  return {
    ...layout,
    [id]: { ...layout[id], tabsVariant: normalizeSidebarTabsVariant(variant) },
  } as SidebarLayout
}

function legacyConfigToLayout(config: any) {
  if (!config || typeof config !== 'object') return null
  return {
    side: config.side ?? config.sidebarSide,
    width: config.width ?? config.sidebarWidth,
  }
}

// 启动归一化时调用：新配置优先；旧 uiMode 取角色模式那一份作为迁移来源，
// 写入新键后删除旧键，之后所有读写只认新键。
export function migrateSidebarLayout(settings: any): SidebarLayout {
  const box = settings && typeof settings === 'object' ? settings : {}
  const legacy = box.uiMode && typeof box.uiMode === 'object' ? box.uiMode : null
  const source =
    box[SIDEBAR_LAYOUT_SETTING_KEY] ??
    legacyConfigToLayout(legacy?.role) ??
    legacyConfigToLayout(legacy?.workspace)
  const next = normalizeSidebarLayout(source)
  box[SIDEBAR_LAYOUT_SETTING_KEY] = next
  if (legacy) delete box.uiMode
  return next
}
