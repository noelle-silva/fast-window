// 工具运行计时事实：运行中的工具以快照里进入运行状态的时刻为锚点，
// 客户端据此每秒换算已运行时长；完成后的最终耗时仍以内核结果为准。

export function isToolPartRunning(part: any) {
  return String(part?.state || '').trim() === 'running'
}

// toolRunAnchorMs 返回工具进入运行状态的时刻（毫秒）；不在运行或缺少时刻时为 0。
export function toolRunAnchorMs(part: any) {
  if (!isToolPartRunning(part)) return 0
  const anchor = Number(part?.updatedAt || 0) || Number(part?.createdAt || 0)
  return Number.isFinite(anchor) && anchor > 0 ? Math.floor(anchor) : 0
}

// toolLiveElapsedMs 以 nowMs 为当下时刻换算工具已运行时长；无锚点时恒为 0。
export function toolLiveElapsedMs(part: any, nowMs: unknown) {
  const anchor = toolRunAnchorMs(part)
  if (!anchor) return 0
  const current = Number(nowMs || 0)
  if (!Number.isFinite(current) || current <= 0) return 0
  return Math.max(0, Math.floor(current - anchor))
}
