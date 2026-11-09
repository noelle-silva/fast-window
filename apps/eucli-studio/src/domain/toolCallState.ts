// 工具调用状态的唯一词汇表：状态文案、结果文案、色相位都从这里出。
// 侧边栏预览、详情 HTML、消息块状态圆点三处消费同一份映射，
// 新增状态只改这里一次，不必在各展示层各补一份。

export type ToolCallPhase = 'running' | 'success' | 'error' | 'pending'

export type ToolTone = '' | 'success' | 'danger' | 'warning'

export function toolStateText(value: unknown, fallback = ''): string {
  const state = String(value || '').trim()
  if (state === 'requested') return '已请求'
  if (state === 'needs_confirmation') return '等待确认'
  if (state === 'approved') return '已同意'
  if (state === 'rejected') return '已拒绝'
  if (state === 'running') return '运行中'
  if (state === 'completed') return '已完成'
  if (state === 'error') return '失败'
  if (state === 'denied') return '已拒绝'
  if (state === 'cancelled' || state === 'canceled') return '已取消'
  return state || fallback
}

export function toolResultStatusText(value: unknown): string {
  const status = String(value || '').trim()
  const lower = status.toLowerCase()
  if (lower === 'success' || lower === 'completed' || lower === 'ok') return '成功'
  if (lower === 'error' || lower === 'failed' || lower === 'failure') return '失败'
  return status
}

// 调用状态（state）的色相位：详情面板的状态胶囊用它上色。
export function toolStateTone(value: unknown): ToolTone {
  const state = String(value || '').trim()
  if (state === 'completed' || state === 'approved') return 'success'
  if (state === 'error' || state === 'failed' || state === 'denied' || state === 'rejected' || state === 'cancelled' || state === 'canceled') return 'danger'
  if (state === 'running' || state === 'needs_confirmation') return 'warning'
  return ''
}

// 返回结果（result.status）的色相位：结果一旦落地，成功失败以它为准。
export function toolResultTone(value: unknown): ToolTone {
  const status = String(value || '').trim().toLowerCase()
  if (status === 'success' || status === 'completed' || status === 'ok') return 'success'
  if (status === 'error' || status === 'failed' || status === 'failure') return 'danger'
  return ''
}

// toolCallPhase 是工具块左侧状态圆的唯一判定：
// 结果事实优先（result 存在即已定论），没有结果时才退回调用状态。
export function toolCallPhase(part: any): ToolCallPhase {
  const result = part?.result && typeof part.result === 'object' ? part.result : null
  const resultTone = toolResultTone(result?.status)
  if (resultTone === 'danger') return 'error'
  if (resultTone === 'success') return 'success'

  const state = String(part?.state || '').trim()
  if (state === 'needs_confirmation') return 'pending'
  const stateTone = toolStateTone(state)
  if (stateTone === 'danger') return 'error'
  if (stateTone === 'success') return 'success'
  return 'running'
}
