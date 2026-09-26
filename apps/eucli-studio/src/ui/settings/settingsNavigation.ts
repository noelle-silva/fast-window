export type SettingsTabValue = 'appearance' | 'session' | 'data' | 'groups' | 'roles' | 'workspaces' | 'providers' | 'modelGroups' | 'services' | 'tools' | 'stickers' | 'hookPrompts' | 'placeholders' | 'systemPlugins' | 'commandSystem' | 'eb' | 'access' | 'requestRecords'

export type SettingsNavigationItem = {
  value: SettingsTabValue
  label: string
}

export const SETTINGS_NAVIGATION_ITEMS: SettingsNavigationItem[] = [
  { value: 'tools', label: 'AI 工具管理' },
  { value: 'systemPlugins', label: '系统插件管理' },
  { value: 'roles', label: '角色管理' },
  { value: 'providers', label: '供应商管理' },
  { value: 'modelGroups', label: '模型组' },
  { value: 'placeholders', label: '占位符管理' },
  { value: 'hookPrompts', label: 'hook 提示词' },
  { value: 'session', label: '会话设置' },
  { value: 'workspaces', label: '工作区管理' },
  { value: 'groups', label: '群组管理' },
  { value: 'services', label: 'AI 微服务' },
  { value: 'eb', label: 'eucli-box连接设置' },
  { value: 'appearance', label: '客户端外观' },
  { value: 'stickers', label: '表情包' },
  { value: 'commandSystem', label: '命令系统管理' },
  { value: 'access', label: '端口开放设置' },
  { value: 'requestRecords', label: '请求记录' },
  { value: 'data', label: '客户端数据' },
]

// 保存的顺序只作为“优先顺序”：未知条目忽略、重复忽略，未覆盖到的分类按默认顺序补在末尾。
export function mergeSettingsNavigationItems(rawOrder: unknown): SettingsNavigationItem[] {
  const byValue = new Map<SettingsTabValue, SettingsNavigationItem>(SETTINGS_NAVIGATION_ITEMS.map((item) => [item.value, item]))
  const ordered: SettingsNavigationItem[] = []
  const seen = new Set<SettingsTabValue>()

  if (Array.isArray(rawOrder)) {
    for (const raw of rawOrder) {
      const item = byValue.get(String(raw || '').trim() as SettingsTabValue)
      if (!item || seen.has(item.value)) continue
      seen.add(item.value)
      ordered.push(item)
    }
  }

  for (const item of SETTINGS_NAVIGATION_ITEMS) {
    if (seen.has(item.value)) continue
    seen.add(item.value)
    ordered.push(item)
  }

  return ordered
}
