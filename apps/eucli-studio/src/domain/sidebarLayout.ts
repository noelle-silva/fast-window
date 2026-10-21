// 侧边栏布局：整块聊天界面只有一份侧边栏，靠左还是靠右、多宽都只有一份配置。
// 旧的按「角色模式 / 工作区模式」各存一份的结构在归一化时迁移并删除，避免事实源分叉。

export type SidebarSide = 'left' | 'right'

export type SidebarLayout = {
  side: SidebarSide
  width: number
}

export const SIDEBAR_LAYOUT_SETTING_KEY = 'sidebarLayout'
export const SIDEBAR_WIDTH_MIN = 200
export const SIDEBAR_WIDTH_MAX = 560
export const SIDEBAR_WIDTH_DEFAULT = 260

export function normalizeSidebarSide(raw: unknown): SidebarSide {
  return String(raw ?? '').trim() === 'right' ? 'right' : 'left'
}

export function normalizeSidebarWidth(raw: unknown): number {
  const n = Number(raw)
  if (!isFinite(n)) return SIDEBAR_WIDTH_DEFAULT
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(n)))
}

export function normalizeSidebarLayout(raw: any): SidebarLayout {
  const box = raw && typeof raw === 'object' ? raw : {}
  return {
    side: normalizeSidebarSide(box.side),
    width: normalizeSidebarWidth(box.width),
  }
}

export function resolveSidebarLayout(settings: any): SidebarLayout {
  const box = settings && typeof settings === 'object' ? settings : {}
  return normalizeSidebarLayout(box[SIDEBAR_LAYOUT_SETTING_KEY])
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
