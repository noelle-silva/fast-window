const MERMAID_COPY_IMAGE_MIN_SCALE = 3
const MERMAID_COPY_IMAGE_MAX_SCALE = 6
const MERMAID_COPY_IMAGE_DPR_FACTOR = 3
const MERMAID_COPY_IMAGE_MAX_SIDE = 12288
const MERMAID_COPY_IMAGE_BG = '#ffffff'

export function parseSvgSize(raw: string) {
  try {
    const doc = new DOMParser().parseFromString(raw, 'image/svg+xml')
    const root = doc.querySelector('svg') || doc.documentElement
    if (!root) return { w: 0, h: 0 }
    const viewBox = String(root.getAttribute('viewBox') || '').trim()
    if (viewBox) {
      const numbers = viewBox
        .split(/[\s,]+/g)
        .map(value => Number(value))
        .filter(value => isFinite(value))
      if (numbers.length >= 4) return { w: Math.max(0, numbers[2]), h: Math.max(0, numbers[3]) }
    }
    const width = String(root.getAttribute('width') || '').trim()
    const height = String(root.getAttribute('height') || '').trim()
    if (width.endsWith('%') || height.endsWith('%')) return { w: 0, h: 0 }
    const parsedWidth = parseFloat(width)
    const parsedHeight = parseFloat(height)
    return { w: Math.max(0, isFinite(parsedWidth) ? parsedWidth : 0), h: Math.max(0, isFinite(parsedHeight) ? parsedHeight : 0) }
  } catch (_) {
    return { w: 0, h: 0 }
  }
}

function getMermaidCopyBitmapSize(baseWidth: number, baseHeight: number) {
  const exportScale = Math.min(
    MERMAID_COPY_IMAGE_MAX_SCALE,
    Math.max(MERMAID_COPY_IMAGE_MIN_SCALE, Number(window.devicePixelRatio || 1) * MERMAID_COPY_IMAGE_DPR_FACTOR),
  )
  const scaledLongest = Math.max(baseWidth, baseHeight) * exportScale
  const fitScale = scaledLongest > MERMAID_COPY_IMAGE_MAX_SIDE ? MERMAID_COPY_IMAGE_MAX_SIDE / scaledLongest : 1
  const pixelScale = exportScale * fitScale
  return {
    width: Math.max(1, Math.round(baseWidth * pixelScale)),
    height: Math.max(1, Math.round(baseHeight * pixelScale)),
  }
}

function normalizeSvgForExport(raw: string, baseWidth: number, baseHeight: number) {
  const svgDoc = new DOMParser().parseFromString(raw, 'image/svg+xml')
  const root = svgDoc.querySelector('svg') || svgDoc.documentElement
  if (!root) throw new Error('SVG 内容无效')
  if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  if (!root.getAttribute('xmlns:xlink')) root.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
  root.setAttribute('width', String(baseWidth))
  root.setAttribute('height', String(baseHeight))
  if (!String(root.getAttribute('viewBox') || '').trim()) root.setAttribute('viewBox', `0 0 ${baseWidth} ${baseHeight}`)
  return new XMLSerializer().serializeToString(root)
}

async function rasterizeSvgToPngDataUrl(svgMarkup: string, width: number, height: number) {
  const blob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    return await new Promise<string>((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d')
        if (!context) return reject(new Error('无法创建画布'))
        context.fillStyle = MERMAID_COPY_IMAGE_BG
        context.fillRect(0, 0, width, height)
        context.imageSmoothingEnabled = true
        ;(context as any).imageSmoothingQuality = 'high'
        context.drawImage(img, 0, 0, width, height)
        const out = canvas.toDataURL('image/png')
        if (!String(out || '').startsWith('data:image/')) return reject(new Error('导出图片失败'))
        resolve(out)
      }
      img.onerror = () => reject(new Error('SVG 转图片失败'))
      img.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function exportSvgElementToPngDataUrl(svgEl: SVGSVGElement) {
  const raw = String(new XMLSerializer().serializeToString(svgEl) || '').trim()
  if (!raw) throw new Error('无法读取 Mermaid 图内容')

  const rect = svgEl.getBoundingClientRect()
  const parsed = parseSvgSize(raw)
  const baseWidth = Math.max(Math.round(rect.width || 0), Math.round(parsed.w || 0))
  const baseHeight = Math.max(Math.round(rect.height || 0), Math.round(parsed.h || 0))
  if (!(baseWidth > 0 && baseHeight > 0)) throw new Error('无法确定图片尺寸')

  const svgMarkup = normalizeSvgForExport(raw, baseWidth, baseHeight)
  const bitmap = getMermaidCopyBitmapSize(baseWidth, baseHeight)
  return rasterizeSvgToPngDataUrl(svgMarkup, bitmap.width, bitmap.height)
}
