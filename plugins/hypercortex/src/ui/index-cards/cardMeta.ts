export function formatTimeAgo(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return '时间未知'
  const delta = Math.max(0, Date.now() - ts)
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  if (delta < minute) return '刚刚更新'
  if (delta < hour) return `${Math.floor(delta / minute)} 分钟前`
  if (delta < day) return `${Math.floor(delta / hour)} 小时前`
  if (delta < day * 30) return `${Math.floor(delta / day)} 天前`
  return new Date(ts).toLocaleDateString('zh-CN')
}

export function formatCountLabel(count: number, singular: string): string {
  const safe = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0
  return `${safe} 个${singular}`
}

export function formatFileSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return '未知大小'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = size
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  const text = value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)
  return `${text} ${units[unitIndex]}`
}
