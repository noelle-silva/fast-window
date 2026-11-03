import { parseStickerSize } from './stickerSize'

export { parseStickerSize } from './stickerSize'

export function hydrateStickerSizes(root: unknown) {
  if (!(root instanceof HTMLElement) && !(root instanceof DocumentFragment)) return
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

