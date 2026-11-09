// 输入区底部工具条的可配置按钮与布局单一事实源。
//
// 每个功能按钮在这里登记一次（id / 名称 / 说明）；布局只回答两件事：
// 这个按钮直显在工具条上，还是收进「更多」菜单里；各自区域内排第几。
// 渲染端按同一份 id 联合类型建立注册表，漏登记会直接编译失败。

export const COMPOSER_TOOL_IDS = [
  'image-picker',
  'hook-prompt',
  'model-switch',
  'reasoning-effort',
  'context-usage',
  'cache-rate',
  'async-tasks',
  'stream-toggle',
  'clean-reasoning',
] as const

export type ComposerToolId = (typeof COMPOSER_TOOL_IDS)[number]

/** 按钮所在的区域：工具条直显，或收进更多菜单。 */
export type ComposerToolArea = 'inline' | 'menu'

export type ComposerToolMeta = {
  id: ComposerToolId
  name: string
  description: string
}

export const COMPOSER_TOOL_META: readonly ComposerToolMeta[] = [
  { id: 'image-picker', name: '添加图片', description: '选择图片放进草稿' },
  { id: 'hook-prompt', name: 'hook 提示词', description: '本会话的 hook 提示词预设' },
  { id: 'model-switch', name: '模型切换', description: '上一个 / 当前模型 / 下一个' },
  { id: 'reasoning-effort', name: '思考等级', description: '本会话的思考等级' },
  { id: 'context-usage', name: '上下文用量', description: '只读显示上下文占用' },
  { id: 'cache-rate', name: '缓存率', description: '只读显示缓存命中率' },
  { id: 'async-tasks', name: '异步工具任务', description: '后台工具任务的运行情况' },
  { id: 'stream-toggle', name: '流式输出', description: '切换本会话的流式输出' },
  { id: 'clean-reasoning', name: '清洗思维链', description: '按关键词清理会话里的思维链' },
]

export type ComposerToolsLayout = {
  /** 直显在工具条上的按钮，顺序即显示顺序。 */
  inline: ComposerToolId[]
  /** 收进「更多」菜单的按钮，顺序即菜单顺序。 */
  menu: ComposerToolId[]
}

export const COMPOSER_TOOLS_DEFAULT_LAYOUT: ComposerToolsLayout = {
  inline: [
    'image-picker',
    'hook-prompt',
    'model-switch',
    'reasoning-effort',
    'context-usage',
    'cache-rate',
    'async-tasks',
    'stream-toggle',
  ],
  menu: ['clean-reasoning'],
}

const COMPOSER_TOOL_ID_SET: ReadonlySet<string> = new Set(COMPOSER_TOOL_IDS)

const COMPOSER_TOOL_META_BY_ID: Record<ComposerToolId, ComposerToolMeta> = Object.fromEntries(
  COMPOSER_TOOL_META.map((meta) => [meta.id, meta]),
) as Record<ComposerToolId, ComposerToolMeta>

export function isComposerToolId(value: unknown): value is ComposerToolId {
  return typeof value === 'string' && COMPOSER_TOOL_ID_SET.has(value)
}

export function composerToolMeta(id: ComposerToolId): ComposerToolMeta {
  return COMPOSER_TOOL_META_BY_ID[id]
}

function collectKnownIds(raw: unknown): ComposerToolId[] {
  if (!Array.isArray(raw)) return []
  const out: ComposerToolId[] = []
  for (const item of raw) {
    if (!isComposerToolId(item)) continue
    if (out.includes(item)) continue
    out.push(item)
  }
  return out
}

// 归一化规则：
// 1. 只认白名单 id，数组内去重。
// 2. 同一个按钮只能出现在一处：直显优先，菜单里重复登记的一律丢弃。
// 3. 未登记的已知按钮按默认布局回到它默认所在区域的末尾，
//    这样旧数据缺字段、后续版本新增按钮都不会让按钮凭空消失。
export function normalizeComposerToolsLayout(raw: unknown): ComposerToolsLayout {
  const source = raw && typeof raw === 'object' ? (raw as any) : {}
  const inline = collectKnownIds(source.inline)
  const menu = collectKnownIds(source.menu).filter((id) => !inline.includes(id))

  for (const id of COMPOSER_TOOLS_DEFAULT_LAYOUT.inline) {
    if (!inline.includes(id) && !menu.includes(id)) inline.push(id)
  }
  for (const id of COMPOSER_TOOLS_DEFAULT_LAYOUT.menu) {
    if (!inline.includes(id) && !menu.includes(id)) menu.push(id)
  }

  return { inline, menu }
}

export function composerToolArea(layout: ComposerToolsLayout, id: ComposerToolId): ComposerToolArea {
  return layout.inline.includes(id) ? 'inline' : 'menu'
}

function layoutWithout(layout: ComposerToolsLayout, id: ComposerToolId): ComposerToolsLayout {
  return {
    inline: layout.inline.filter((item) => item !== id),
    menu: layout.menu.filter((item) => item !== id),
  }
}

// 勾选 / 取消勾选：把按钮迁到目标区域末尾。目标区域没变时原样返回，避免无意义写盘。
export function applyComposerToolPlacement(raw: unknown, id: unknown, onToolbar: boolean): ComposerToolsLayout {
  const layout = normalizeComposerToolsLayout(raw)
  if (!isComposerToolId(id)) return layout
  const target: ComposerToolArea = onToolbar ? 'inline' : 'menu'
  if (composerToolArea(layout, id) === target) return layout
  const next = layoutWithout(layout, id)
  next[target].push(id)
  return next
}

// 区域内换位：把 activeId 挪到 overId 当前所在的位置。
// 跨区域不在拖拽职责内 —— 放出来还是收进去，只由勾选决定。
export function moveComposerToolWithinArea(raw: unknown, activeId: unknown, overId: unknown): ComposerToolsLayout {
  const layout = normalizeComposerToolsLayout(raw)
  if (!isComposerToolId(activeId) || !isComposerToolId(overId) || activeId === overId) return layout
  const area = composerToolArea(layout, activeId)
  if (composerToolArea(layout, overId) !== area) return layout
  const list = layout[area]
  const from = list.indexOf(activeId)
  const to = list.indexOf(overId)
  if (from < 0 || to < 0) return layout
  const nextList = list.slice()
  nextList.splice(from, 1)
  nextList.splice(to, 0, activeId)
  return area === 'inline' ? { inline: nextList, menu: layout.menu } : { inline: layout.inline, menu: nextList }
}
