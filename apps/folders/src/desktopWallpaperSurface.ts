import { normalizeDesktopWallpaperView } from './desktopWallpaperPresets'
import type { DesktopWallpaperView } from './types'

export type DesktopWallpaperFrame = {
  offsetX: number
  offsetY: number
  width: number
  height: number
  originX: number
  originY: number
  scale: number
}

function positiveSize(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}

function withoutNegativeZero(value: number): number {
  return value === 0 ? 0 : value
}

export function desktopWallpaperFrame(
  imageWidth: number,
  imageHeight: number,
  frameWidth: number,
  frameHeight: number,
  view: DesktopWallpaperView,
): DesktopWallpaperFrame {
  const normalized = normalizeDesktopWallpaperView(view)
  const scale = normalized.scale
  const safeImageWidth = positiveSize(imageWidth)
  const safeImageHeight = positiveSize(imageHeight)
  const safeFrameWidth = positiveSize(frameWidth)
  const safeFrameHeight = positiveSize(frameHeight)

  if (!safeImageWidth || !safeImageHeight || !safeFrameWidth || !safeFrameHeight) {
    return { offsetX: 0, offsetY: 0, width: 0, height: 0, originX: 0, originY: 0, scale }
  }

  const coverScale = Math.max(safeFrameWidth / safeImageWidth, safeFrameHeight / safeImageHeight)
  const width = safeImageWidth * coverScale
  const height = safeImageHeight * coverScale

  return {
    offsetX: withoutNegativeZero((safeFrameWidth - width) * normalized.x / 100),
    offsetY: withoutNegativeZero((safeFrameHeight - height) * normalized.y / 100),
    width,
    height,
    originX: safeFrameWidth * normalized.x / 100,
    originY: safeFrameHeight * normalized.y / 100,
    scale,
  }
}

export function clearDesktopWallpaperSurface(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
}

export function drawDesktopWallpaperSurface(
  canvas: HTMLCanvasElement,
  source: CanvasImageSource,
  imageWidth: number,
  imageHeight: number,
  frameWidth: number,
  frameHeight: number,
  pixelRatio: number,
  view: DesktopWallpaperView,
): void {
  if (!positiveSize(frameWidth) || !positiveSize(frameHeight)) return

  const ratio = positiveSize(pixelRatio) || 1
  const deviceWidth = Math.max(1, Math.round(frameWidth * ratio))
  const deviceHeight = Math.max(1, Math.round(frameHeight * ratio))
  if (canvas.width !== deviceWidth) canvas.width = deviceWidth
  if (canvas.height !== deviceHeight) canvas.height = deviceHeight

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  ctx.clearRect(0, 0, frameWidth, frameHeight)

  const frame = desktopWallpaperFrame(imageWidth, imageHeight, frameWidth, frameHeight, view)
  if (frame.width <= 0 || frame.height <= 0) return

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.translate(frame.originX, frame.originY)
  ctx.scale(frame.scale, frame.scale)
  ctx.translate(-frame.originX, -frame.originY)
  ctx.drawImage(source, frame.offsetX, frame.offsetY, frame.width, frame.height)
}
