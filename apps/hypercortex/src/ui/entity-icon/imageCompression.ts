// 图片图标压缩：粘贴或选取的本地图片先等比缩放到上限尺寸，再编码为紧凑 data URL，
// 避免把原图直接写进图标文件。无法在画布上解码时退回原始 data URL。
const DEFAULT_MAX_DIMENSION = 256
const DEFAULT_QUALITY = 0.86

export async function compressImageDataUrl(
  dataUrl: string,
  options?: { maxDimension?: number; quality?: number },
): Promise<string> {
  const raw = String(dataUrl || '').trim()
  if (!raw.startsWith('data:image/')) return raw
  const maxDimension = options?.maxDimension ?? DEFAULT_MAX_DIMENSION
  const quality = options?.quality ?? DEFAULT_QUALITY

  try {
    const image = await loadImage(raw)
    const { width, height } = fitWithin(image.naturalWidth || image.width, image.naturalHeight || image.height, maxDimension)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return raw
    ctx.drawImage(image, 0, 0, width, height)
    const hasAlpha = /^data:image\/(png|webp|gif|svg)/i.test(raw)
    const encoded = hasAlpha ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', quality)
    return encoded || raw
  } catch {
    return raw
  }
}

function fitWithin(width: number, height: number, maxDimension: number): { width: number; height: number } {
  const w = Math.max(1, Math.floor(width))
  const h = Math.max(1, Math.floor(height))
  if (w <= maxDimension && h <= maxDimension) return { width: w, height: h }
  const scale = maxDimension / Math.max(w, h)
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) }
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片解码失败'))
    image.src = dataUrl
  })
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })
}
