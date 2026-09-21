// 消息耗时事实：业务端采集的毫秒耗时在客户端的归一化与展示口径。
// 流式回复有思考/书写两个阶段跨度；非流式只有消息级模型调用总耗时。

export function normalizeDurationMs(input: unknown): number {
  const value = Number(input)
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.floor(value)
}

// resolveReplyDurationMs：回复耗时优先取正文部件的书写跨度；
// 非流式没有书写跨度时退回该轮模型调用总耗时；两者都没有时为 0。
export function resolveReplyDurationMs(message: any): number {
  const parts = Array.isArray(message?.parts) ? message.parts : []
  for (const part of parts) {
    if (String(part?.type || '').trim() !== 'text') continue
    const duration = normalizeDurationMs(part?.durationMs)
    if (duration > 0) return duration
  }
  return normalizeDurationMs(message?.modelDurationMs)
}
