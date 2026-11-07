import { GROUP_ENTRY_VISIBLE } from '../appConstants'
import {
  SETTINGS_NAVIGATION_VALUES,
  normalizeSettingsNavOrder,
  type SettingsTabValue,
} from '../../domain/settingsNavigation'

export type { SettingsTabValue }

export type SettingsNavigationItem = {
  value: SettingsTabValue
  label: string
}

// 标签是 UI 展示事实；分类的合法值与默认顺序由 domain 层统一维护。
const SETTINGS_NAVIGATION_LABELS: Record<SettingsTabValue, string> = {
  tools: 'AI 工具管理',
  systemPlugins: '系统插件管理',
  roles: '角色管理',
  providers: '供应商管理',
  modelGroups: '模型组',
  placeholders: '占位符管理',
  hookPrompts: 'hook 提示词',
  promptLibrary: '提示词仓库管理',
  session: '会话设置',
  workspaces: '工作区管理',
  groups: '群组管理',
  services: 'AI 微服务',
  eb: 'eucli-box连接设置',
  appearance: '客户端外观',
  stickers: '表情包',
  commandSystem: '命令系统管理',
  access: '端口开放设置',
  requestRecords: '请求记录',
  data: '客户端数据',
}

const ALL_SETTINGS_NAVIGATION_ITEMS: SettingsNavigationItem[] = SETTINGS_NAVIGATION_VALUES.map((value) => ({
  value,
  label: SETTINGS_NAVIGATION_LABELS[value],
}))

// 群组入口显隐总开关（唯一事实源）关闭时，从导航列表过滤掉「群组管理」；开启时原样恢复。
export const SETTINGS_NAVIGATION_ITEMS: SettingsNavigationItem[] = ALL_SETTINGS_NAVIGATION_ITEMS.filter(
  (item) => GROUP_ENTRY_VISIBLE || item.value !== 'groups',
)

// 解析当前应显示的设置分类：给定值合法则用给定值，否则回落到排序中的第一个分类。
export function resolveSettingsTab(value: unknown, items: SettingsNavigationItem[]): SettingsTabValue {
  const candidate = String(value ?? '').trim()
  if (SETTINGS_NAVIGATION_ITEMS.some((item) => item.value === candidate)) return candidate as SettingsTabValue
  return items[0]?.value ?? SETTINGS_NAVIGATION_ITEMS[0].value
}

// 顺序归一化复用 domain 单一事实源，再按当前显隐规则映射为可见导航项。
export function mergeSettingsNavigationItems(rawOrder: unknown): SettingsNavigationItem[] {
  const byValue = new Map<SettingsTabValue, SettingsNavigationItem>(
    SETTINGS_NAVIGATION_ITEMS.map((item) => [item.value, item]),
  )
  const ordered: SettingsNavigationItem[] = []

  for (const value of normalizeSettingsNavOrder(rawOrder)) {
    const item = byValue.get(value)
    if (item) ordered.push(item)
  }

  return ordered
}
