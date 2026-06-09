export type QuickBarAction = {
  id: string
  label: string
  description: string
}

export const QUICK_BAR_ACTIONS: QuickBarAction[] = [
  { id: 'ai', label: 'AI', description: '预留给智能处理动作' },
  { id: 'translate', label: '翻译', description: '预留给翻译动作' },
  { id: 'search', label: '搜索', description: '预留给搜索动作' },
  { id: 'copy', label: '复制', description: '预留给复制动作' },
]
