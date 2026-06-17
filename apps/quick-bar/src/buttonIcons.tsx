import * as React from 'react'
import { DynamicIcon, iconNames, type IconName } from 'lucide-react/dynamic.js'

export type ButtonIconId = IconName

const CURATED_BUTTON_ICON_NAMES = [
  'sparkles',
  'message-square',
  'book-open',
  'pencil-line',
  'languages',
  'search',
  'brain-circuit',
  'code-2',
  'file-text',
  'zap',
  'star',
  'wand-sparkles',
  'clipboard-list',
  'globe',
  'mail',
  'chart-bar',
  'shield-check',
  'link-2',
  'lightbulb',
  'palette',
  'settings-2',
  'database',
  'folder-open',
  'clock-3',
  'check',
  'plus',
  'rotate-cw',
  'shuffle',
  'scan',
  'history',
  'layout-grid',
  'arrow-right-left',
  'help-circle',
  'monitor',
  'eye',
  'sliders-horizontal',
  'workflow',
  'layers-3',
  'panel-top',
  'panel-left',
  'waypoints',
  'blocks',
  'cable',
  'notebook-pen',
  'message-circle',
  'book-text',
  'library-big',
  'pen-tool',
  'search-check',
  'files',
  'timer-reset',
  'sparkle',
  'clipboard-check',
  'power',
  'power-off',
  'toggle-left',
  'toggle-right',
  'circle-off',
  'save',
  'trash-2',
  'x',
  'circle-dashed',
  'brain',
  'code',
  'scan-search',
] as const satisfies readonly IconName[]

const LEGACY_BUTTON_ICON_ALIASES = {
  spark: 'sparkles',
  chat: 'message-square',
  book: 'book-open',
  pen: 'pencil-line',
  translate: 'languages',
  search: 'search',
  brain: 'brain-circuit',
  code: 'code-2',
  summary: 'file-text',
  bolt: 'zap',
  star: 'star',
  wand: 'wand-sparkles',
  clipboard: 'clipboard-list',
  globe: 'globe',
  mail: 'mail',
  chart: 'chart-bar',
  shield: 'shield-check',
  link: 'link-2',
} as const satisfies Record<string, IconName>

export const BUTTON_ICON_NAMES = uniqueIconNames(CURATED_BUTTON_ICON_NAMES, iconNames)
export const BUTTON_ICON_TOTAL = BUTTON_ICON_NAMES.length
const BUTTON_ICON_STROKE_WIDTH = 1.25

export function resolveButtonIconId(iconId: string | null | undefined, seed: string): ButtonIconId {
  const candidate = String(iconId || '').trim()
  if (isButtonIconId(candidate)) return candidate
  if (candidate in LEGACY_BUTTON_ICON_ALIASES) return LEGACY_BUTTON_ICON_ALIASES[candidate as keyof typeof LEGACY_BUTTON_ICON_ALIASES]
  return seededButtonIconId(seed)
}

export function randomButtonIconId(currentIconId?: string | null): ButtonIconId {
  const current = String(currentIconId || '').trim()
  const candidates = BUTTON_ICON_NAMES.filter(iconName => iconName !== current)
  const pool = candidates.length ? candidates : BUTTON_ICON_NAMES
  return pool[Math.floor(Math.random() * pool.length)]
}

export function ButtonIconGlyph(props: { iconId: string | null | undefined; seed: string; className?: string; size?: number }) {
  const iconId = resolveButtonIconId(props.iconId, props.seed)
  return <DynamicIcon className={props.className} aria-hidden="true" name={iconId} size={props.size ?? 20} strokeWidth={BUTTON_ICON_STROKE_WIDTH} />
}

function isButtonIconId(value: string): value is ButtonIconId {
  return BUTTON_ICON_NAMES.includes(value as IconName)
}

function seededButtonIconId(seed: string): ButtonIconId {
  const text = seed.trim() || 'quick-bar'
  let hash = 0
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0
  }
  return BUTTON_ICON_NAMES[hash % BUTTON_ICON_NAMES.length]
}

function uniqueIconNames(primary: readonly IconName[], secondary: readonly IconName[]): IconName[] {
  const seen = new Set<IconName>()
  const result: IconName[] = []
  for (const iconName of [...primary, ...secondary]) {
    if (seen.has(iconName)) continue
    seen.add(iconName)
    result.push(iconName)
  }
  return result
}
