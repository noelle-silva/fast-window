// UI 模式：聊天界面固定使用侧边栏，以及侧边栏靠左还是靠右、多宽。
// 角色模式与工作区模式各自独立保存一份配置，互不影响。

export type SidebarSide = 'left' | 'right'
export type UiModeTarget = 'role' | 'workspace'

export type UiModeConfig = {
  sidebarSide: SidebarSide
  sidebarWidth: number
}

export type UiModeSettings = Record<UiModeTarget, UiModeConfig>

export const UI_MODE_SETTING_KEY = 'uiMode'

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

export function normalizeUiModeConfig(raw: any): UiModeConfig {
  const box = raw && typeof raw === 'object' ? raw : {}
  return {
    sidebarSide: normalizeSidebarSide(box.sidebarSide),
    sidebarWidth: normalizeSidebarWidth(box.sidebarWidth),
  }
}

export function normalizeUiModeSettings(raw: any): UiModeSettings {
  const box = raw && typeof raw === 'object' ? raw : {}
  return {
    role: normalizeUiModeConfig(box.role),
    workspace: normalizeUiModeConfig(box.workspace),
  }
}

// 读取某个聊天模式的 UI 配置；数据缺失时回落到默认（左侧 + 默认宽度）。
export function resolveUiModeConfig(raw: any, target: UiModeTarget): UiModeConfig {
  return normalizeUiModeSettings(raw)[target === 'workspace' ? 'workspace' : 'role']
}
