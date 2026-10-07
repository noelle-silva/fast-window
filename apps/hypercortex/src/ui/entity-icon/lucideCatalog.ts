import { icons } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

// 图标库模式的取值来源：直接采用 lucide 图标库当前版本导出的全部图标，
// 随依赖升级自动获得新图标，不再手工维护名单。
const iconByName = new Map<string, LucideIcon>()
const lowerIndex = new Map<string, LucideIcon>()
for (const [name, component] of Object.entries(icons as Record<string, LucideIcon>)) {
  iconByName.set(name, component)
  lowerIndex.set(name.toLowerCase(), component)
}

// 编辑器网格与随机按钮共用的完整名单；名称即 lucide 的 PascalCase 图标名。
export const AVAILABLE_LUCIDE_ICON_NAMES: readonly string[] = Object.keys(icons).sort((a, b) => a.localeCompare(b))

export function getLucideIcon(name: string): LucideIcon | undefined {
  const key = String(name || '').trim()
  if (!key) return undefined
  return iconByName.get(key) || lowerIndex.get(key.toLowerCase())
}

export function pickRandomLucideIconName(): string {
  const names = AVAILABLE_LUCIDE_ICON_NAMES
  if (!names.length) return ''
  return names[Math.floor(Math.random() * names.length)]
}
