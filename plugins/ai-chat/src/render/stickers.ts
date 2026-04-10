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

export function hydrateStickerSizes(root: unknown) {
  if (!(root instanceof HTMLElement)) return
  const imgs = Array.from(root.querySelectorAll?.('img.fw-sticker[data-fw-sticker-size]') || [])
  for (const img of imgs) {
    if (!(img instanceof HTMLImageElement)) continue
    const raw = img.getAttribute('data-fw-sticker-size') || ''
    const size = parseStickerSize(raw)
    if (!size) continue
    img.style.maxWidth = `min(${size}px, 100%)`
    img.style.maxHeight = `min(${size}px, 70vh)`
  }
}

