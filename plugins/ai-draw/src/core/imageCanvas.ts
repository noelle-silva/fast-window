import { id } from './utils'

export function estimateBytesFromBase64(b64: any) {
  const s = String(b64 || '').trim()
  if (!s) return 0
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0
  return Math.floor((s.length * 3) / 4) - pad
}

export function dataUrlToBase64(dataUrl: any) {
  const s = String(dataUrl || '')
  const i = s.indexOf('base64,')
  if (i === -1) return ''
  return s.slice(i + 'base64,'.length)
}

export async function loadImageFromDataUrl(dataUrl: any): Promise<HTMLImageElement> {
  return await new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('解析图片失败'))
    img.src = String(dataUrl || '')
  })
}

export async function shrinkRefImageDataUrl(
  dataUrl: any,
  opts: { maxDimension: number; ifOverBytes: number },
) {
  const rawUrl = String(dataUrl || '').trim()
  if (!rawUrl.startsWith('data:image/')) return rawUrl

  const b64 = dataUrlToBase64(rawUrl)
  const bytes = estimateBytesFromBase64(b64)
  const img = await loadImageFromDataUrl(rawUrl)
  const w0 = img.naturalWidth || img.width
  const h0 = img.naturalHeight || img.height
  if (!w0 || !h0) return rawUrl

  const maxDim = Math.max(1, Math.floor(Number(opts.maxDimension) || 1))
  const maxBytes = Math.max(1, Math.floor(Number(opts.ifOverBytes) || 1))

  const scale = Math.min(1, maxDim / Math.max(w0, h0))
  if (scale === 1 && bytes > 0 && bytes <= maxBytes) return rawUrl

  const w = Math.max(1, Math.round(w0 * scale))
  const h = Math.max(1, Math.round(h0 * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return rawUrl

  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)

  let q = 0.86
  let out = canvas.toDataURL('image/jpeg', q)
  for (let i = 0; i < 3; i++) {
    const outBytes = estimateBytesFromBase64(dataUrlToBase64(out))
    if (outBytes > 0 && outBytes <= maxBytes) return out
    q = Math.max(0.6, q - 0.1)
    out = canvas.toDataURL('image/jpeg', q)
  }
  return out
}

export function clamp01(n: any) {
  const v = Number(n)
  if (!Number.isFinite(v)) return 0
  if (v < 0) return 0
  if (v > 1) return 1
  return v
}

export function normalizeSelRect(sel: any): { x: number; y: number; w: number; h: number } | null {
  if (!sel || typeof sel !== 'object') return null
  const x = clamp01(sel.x)
  const y = clamp01(sel.y)
  const w = clamp01(sel.w)
  const h = clamp01(sel.h)
  if (!(w > 0 && h > 0)) return null
  if (x + w <= 0 || y + h <= 0) return null
  return { x, y, w: Math.min(1 - x, w), h: Math.min(1 - y, h) }
}

export function selRectToPixels(
  sel: any,
  imgW: any,
  imgH: any,
): { x: number; y: number; w: number; h: number } | null {
  const s = normalizeSelRect(sel)
  const w0 = Number(imgW) || 0
  const h0 = Number(imgH) || 0
  if (!s || !w0 || !h0) return null

  const x = Math.max(0, Math.floor(s.x * w0))
  const y = Math.max(0, Math.floor(s.y * h0))
  const w = Math.max(1, Math.floor(s.w * w0))
  const h = Math.max(1, Math.floor(s.h * h0))
  const w1 = Math.min(w0 - x, w)
  const h1 = Math.min(h0 - y, h)
  if (!(w1 > 0 && h1 > 0)) return null
  return { x, y, w: w1, h: h1 }
}

export async function cropDataUrlByPixels(dataUrl: any, rect: any) {
  const srcUrl = String(dataUrl || '').trim()
  if (!srcUrl.startsWith('data:image/')) return ''
  const r = rect && typeof rect === 'object' ? rect : null
  const x = Math.max(0, Math.floor(Number(r?.x) || 0))
  const y = Math.max(0, Math.floor(Number(r?.y) || 0))
  const w = Math.max(1, Math.floor(Number(r?.w) || 0))
  const h = Math.max(1, Math.floor(Number(r?.h) || 0))

  const img = await loadImageFromDataUrl(srcUrl)
  const w0 = img.naturalWidth || img.width
  const h0 = img.naturalHeight || img.height
  if (!w0 || !h0) return ''
  const w1 = Math.min(w0 - x, w)
  const h1 = Math.min(h0 - y, h)
  if (!(w1 > 0 && h1 > 0)) return ''

  const canvas = document.createElement('canvas')
  canvas.width = w1
  canvas.height = h1
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.drawImage(img, x, y, w1, h1, 0, 0, w1, h1)
  return canvas.toDataURL('image/png')
}

export async function compositePatchToBase(baseDataUrl: any, patchDataUrl: any, rect: any) {
  const baseUrl = String(baseDataUrl || '').trim()
  const patchUrl = String(patchDataUrl || '').trim()
  if (!baseUrl.startsWith('data:image/')) return ''
  if (!patchUrl.startsWith('data:image/')) return ''

  const b = rect && typeof rect === 'object' ? rect : null
  const x = Math.max(0, Math.floor(Number(b?.x) || 0))
  const y = Math.max(0, Math.floor(Number(b?.y) || 0))
  const w = Math.max(1, Math.floor(Number(b?.w) || 0))
  const h = Math.max(1, Math.floor(Number(b?.h) || 0))

  const baseImg = await loadImageFromDataUrl(baseUrl)
  const patchImg = await loadImageFromDataUrl(patchUrl)
  const bw = baseImg.naturalWidth || baseImg.width
  const bh = baseImg.naturalHeight || baseImg.height
  if (!bw || !bh) return ''

  const canvas = document.createElement('canvas')
  canvas.width = bw
  canvas.height = bh
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  ctx.drawImage(baseImg, 0, 0, bw, bh)
  const w1 = Math.min(bw - x, w)
  const h1 = Math.min(bh - y, h)
  if (w1 > 0 && h1 > 0) {
    ctx.drawImage(
      patchImg,
      0,
      0,
      patchImg.naturalWidth || patchImg.width,
      patchImg.naturalHeight || patchImg.height,
      x,
      y,
      w1,
      h1,
    )
  }
  return canvas.toDataURL('image/png')
}

export type PickedImage = { id: string; name: string; dataUrl: string; sourcePath?: string }

export function normalizePickedImages(raw: any, maxCount: number): PickedImage[] {
  const list = Array.isArray(raw) ? raw : []
  const out: PickedImage[] = []
  for (const it of list) {
    const name = typeof (it as any)?.name === 'string' ? (it as any).name : ''
    const sourcePath = typeof (it as any)?.sourcePath === 'string' ? String((it as any).sourcePath || '').trim() : ''
    const dataUrl =
      typeof (it as any)?.dataUrl === 'string' ? (it as any).dataUrl : typeof (it as any)?.data_url === 'string' ? (it as any).data_url : ''
    const u = String(dataUrl || '').trim()
    if (!u.startsWith('data:image/')) continue
    out.push({ id: id('ref'), name: String(name || ''), dataUrl: u, ...(sourcePath ? { sourcePath } : null) })
    if (out.length >= maxCount) break
  }
  return out
}
