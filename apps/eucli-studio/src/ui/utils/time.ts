export function numericTimeValue(value: unknown) {
  if (typeof value === 'number' && isFinite(value) && value > 0) return value
  const text = String(value || '').trim()
  if (!text) return 0
  const parsed = Date.parse(text)
  return isFinite(parsed) && parsed > 0 ? parsed : 0
}

// formatDurationMs 把毫秒耗时格式化为人类可读的分秒：不足一分钟保留一位小数秒，
// 超过一分钟显示「X 分 Y 秒」，超过一小时显示「X 小时 Y 分」。
export function formatDurationMs(value: unknown) {
  const ms = Number(value)
  if (!isFinite(ms) || ms <= 0) return ''
  if (ms < 60_000) return `${(Math.floor(ms / 100) / 10).toFixed(1)} 秒`
  if (ms < 3_600_000) {
    const minutes = Math.floor(ms / 60_000)
    const seconds = Math.round((ms - minutes * 60_000) / 1000)
    if (seconds === 60) return `${minutes + 1} 分 0 秒`
    return `${minutes} 分 ${seconds} 秒`
  }
  const hours = Math.floor(ms / 3_600_000)
  const minutes = Math.round((ms - hours * 3_600_000) / 60_000)
  if (minutes === 60) return `${hours + 1} 小时 0 分`
  return `${hours} 小时 ${minutes} 分`
}
