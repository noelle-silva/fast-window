// 表情包尺寸解析：纯字符串逻辑，不依赖 DOM。
// 从 stickers.ts 拆出，使 Worker 解析层可以只加载这一小段纯函数。
export function parseStickerSize(raw: unknown) {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
  if (!s) return 0
  const m = /^(\d{1,5})(?:px)?$/.exec(s)
  if (!m) return 0
  const n = Math.round(Number(m[1] || 0))
  if (!Number.isFinite(n)) return 0
  if (n < 16) return 16
  if (n > 4096) return 4096
  return n
}
