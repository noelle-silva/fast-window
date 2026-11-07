// 设置导航分类的合法值与默认顺序：domain 层单一事实源。
// UI 只负责为分类附加展示标签与显隐过滤，顺序归一化统一由这里提供。

export type SettingsTabValue =
  | 'tools'
  | 'systemPlugins'
  | 'roles'
  | 'providers'
  | 'modelGroups'
  | 'placeholders'
  | 'hookPrompts'
  | 'promptLibrary'
  | 'session'
  | 'workspaces'
  | 'groups'
  | 'services'
  | 'eb'
  | 'appearance'
  | 'stickers'
  | 'commandSystem'
  | 'access'
  | 'requestRecords'
  | 'data'

export const SETTINGS_NAVIGATION_VALUES: readonly SettingsTabValue[] = [
  'tools',
  'systemPlugins',
  'roles',
  'providers',
  'modelGroups',
  'placeholders',
  'hookPrompts',
  'promptLibrary',
  'session',
  'workspaces',
  'groups',
  'services',
  'eb',
  'appearance',
  'stickers',
  'commandSystem',
  'access',
  'requestRecords',
  'data',
]

const SETTINGS_NAVIGATION_VALUE_SET: ReadonlySet<string> = new Set(SETTINGS_NAVIGATION_VALUES)

export function isSettingsTabValue(value: unknown): value is SettingsTabValue {
  return SETTINGS_NAVIGATION_VALUE_SET.has(String(value ?? '').trim())
}

// 保存的顺序只作为“优先顺序”：未知条目忽略、重复忽略，未覆盖到的分类按默认顺序补在末尾。
export function normalizeSettingsNavOrder(rawOrder: unknown): SettingsTabValue[] {
  const ordered: SettingsTabValue[] = []
  const seen = new Set<SettingsTabValue>()

  if (Array.isArray(rawOrder)) {
    for (const raw of rawOrder) {
      const candidate = String(raw ?? '').trim()
      if (!isSettingsTabValue(candidate) || seen.has(candidate)) continue
      seen.add(candidate)
      ordered.push(candidate)
    }
  }

  for (const value of SETTINGS_NAVIGATION_VALUES) {
    if (seen.has(value)) continue
    seen.add(value)
    ordered.push(value)
  }

  return ordered
}
