/** 思维导图面生效设置的收敛形态。 */
export type MindmapSettings = {
  layout: string
  theme: string
  scale: number
}

const DEFAULT_LAYOUT = 'mindMap'
const DEFAULT_THEME = 'default'
const DEFAULT_SCALE = 1

/** 从宿主解析后的生效设置里读取思维导图面的三项配置。 */
export function readMindmapSettings(raw: Record<string, unknown> | undefined): MindmapSettings {
  const layout = typeof raw?.layout === 'string' && raw.layout ? raw.layout : DEFAULT_LAYOUT
  const theme = typeof raw?.theme === 'string' && raw.theme ? raw.theme : DEFAULT_THEME
  const scale = typeof raw?.scale === 'number' && Number.isFinite(raw.scale) ? raw.scale : DEFAULT_SCALE
  return { layout, theme, scale }
}
