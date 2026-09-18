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
    const vb = String(root.getAttribute('viewBox') || '').trim()
    if (vb) {
      const nums = vb
        .split(/[\s,]+/g)
        .map((x) => Number(x))
        .filter((x) => isFinite(x))
      if (nums.length >= 4) return { w: Math.max(0, nums[2]), h: Math.max(0, nums[3]) }
    }
    const w = String(root.getAttribute('width') || '').trim()
    const h = String(root.getAttribute('height') || '').trim()
    if (w.endsWith('%') || h.endsWith('%')) return { w: 0, h: 0 }
    const nw = parseFloat(w)
    const nh = parseFloat(h)
    return { w: Math.max(0, isFinite(nw) ? nw : 0), h: Math.max(0, isFinite(nh) ? nh : 0) }
  } catch (_) {
    return { w: 0, h: 0 }
  }
}

function getMermaidCopyBitmapSize(baseW: number, baseH: number) {
  const exportScale = Math.min(
    MERMAID_COPY_IMAGE_MAX_SCALE,
    Math.max(MERMAID_COPY_IMAGE_MIN_SCALE, Number(window.devicePixelRatio || 1) * MERMAID_COPY_IMAGE_DPR_FACTOR),
  )
  const scaledLongest = Math.max(baseW, baseH) * exportScale
  const fitScale = scaledLongest > MERMAID_COPY_IMAGE_MAX_SIDE ? MERMAID_COPY_IMAGE_MAX_SIDE / scaledLongest : 1
  const pixelScale = exportScale * fitScale
  return {
    width: Math.max(1, Math.round(baseW * pixelScale)),
    height: Math.max(1, Math.round(baseH * pixelScale)),
  }
}

function normalizeSvgForExport(raw: string, baseW: number, baseH: number) {
  const svgDoc = new DOMParser().parseFromString(raw, 'image/svg+xml')
  const root = svgDoc.querySelector('svg') || svgDoc.documentElement
  if (!root) throw new Error('SVG 内容无效')
  if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  if (!root.getAttribute('xmlns:xlink')) root.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
  root.setAttribute('width', String(baseW))
  root.setAttribute('height', String(baseH))
  if (!String(root.getAttribute('viewBox') || '').trim()) root.setAttribute('viewBox', `0 0 ${baseW} ${baseH}`)
  return new XMLSerializer().serializeToString(root)
}

async function rasterizeSvgToPngDataUrl(svgMarkup: string, width: number, height: number) {
  const blob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    return await new Promise<string>((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas')
          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d')
          if (!ctx) return reject(new Error('无法创建画布'))
          ctx.fillStyle = MERMAID_COPY_IMAGE_BG
          ctx.fillRect(0, 0, width, height)
          ctx.imageSmoothingEnabled = true
          ;(ctx as any).imageSmoothingQuality = 'high'
          ctx.drawImage(img, 0, 0, width, height)
          const out = canvas.toDataURL('image/png')
          if (!String(out || '').startsWith('data:image/')) return reject(new Error('导出图片失败'))
          resolve(out)
        } catch (e) {
          reject(e)
        }
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
  const baseW = Math.max(Math.round(rect.width || 0), Math.round(parsed.w || 0))
  const baseH = Math.max(Math.round(rect.height || 0), Math.round(parsed.h || 0))
  if (!(baseW > 0 && baseH > 0)) throw new Error('无法确定图片尺寸')

  const svgMarkup = normalizeSvgForExport(raw, baseW, baseH)
  const bitmap = getMermaidCopyBitmapSize(baseW, baseH)
  return rasterizeSvgToPngDataUrl(svgMarkup, bitmap.width, bitmap.height)
}
