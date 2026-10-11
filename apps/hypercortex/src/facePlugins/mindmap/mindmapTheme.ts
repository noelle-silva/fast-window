/** 暗色主题覆盖：与导图库默认主题深度合并。 */
const MINDMAP_DARK_THEME: Record<string, unknown> = {
  backgroundColor: '#1f2430',
  lineColor: '#5b6472',
  root: { fillColor: '#4f46e5', color: '#ffffff' },
  second: { fillColor: '#2b3242', color: '#e5e7eb', borderColor: '#6366f1' },
  node: { color: '#cbd5e1' },
}

/** 按主题名取主题覆盖配置（默认主题返回空覆盖）。 */
export function mindmapThemeConfig(theme: string): Record<string, unknown> {
  return theme === 'dark' ? MINDMAP_DARK_THEME : {}
}
