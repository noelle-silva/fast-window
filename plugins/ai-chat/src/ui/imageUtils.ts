import { clamp } from '../core/utils'
import { looksLikeImageDataUrl } from '../domain/textProcessing'
import { REF_IMG_PLACEHOLDER } from '../domain/constants'

export function createImageUtils(deps: {
  filesImagesRead: (req: { scope: string; path: string }) => Promise<string>
  uiRefImgCache?: Map<string, string>
  uiRefImgPending?: Set<string>
}) {
  const { filesImagesRead, uiRefImgCache = new Map(), uiRefImgPending = new Set() } = deps

  function shrinkImageDataUrl(dataUrl, maxSide) {
    return new Promise((resolve) => {
      try {
        const u = String(dataUrl || '').trim()
        if (!looksLikeImageDataUrl(u)) return resolve('')

        const max = clamp(Math.round(Number(maxSide || 0)), 64, 4096)
        const img = new Image()
        img.decoding = 'async'
        img.onload = () => {
          try {
            const w0 = Number(img.naturalWidth || 0)
            const h0 = Number(img.naturalHeight || 0)
            if (!w0 || !h0) return resolve('')

            const s = Math.min(1, max / Math.max(w0, h0))
            const w = Math.max(1, Math.round(w0 * s))
            const h = Math.max(1, Math.round(h0 * s))

            const canvas = document.createElement('canvas')
            canvas.width = w
            canvas.height = h
            const ctx = canvas.getContext('2d')
            if (!ctx) return resolve('')
            ctx.clearRect(0, 0, w, h)
            ctx.drawImage(img, 0, 0, w, h)

            const out = canvas.toDataURL('image/png')
            resolve(looksLikeImageDataUrl(out) ? out : '')
          } catch (_) {
            resolve('')
          }
        }
        img.onerror = () => resolve('')
        img.src = u
      } catch (_) {
        resolve('')
      }
    })
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      if (!(file instanceof File)) return reject(new Error('file 无效'))
      const r = new FileReader()
      r.onload = () => resolve(String(r.result || ''))
      r.onerror = () => reject(new Error('读取图片失败'))
      r.readAsDataURL(file)
    })
  }

  function hydrateRefImages(root) {
    if (!(root instanceof HTMLElement)) return
    if (typeof filesImagesRead !== 'function') return

    const els = Array.from(root.querySelectorAll('[data-ref-img]'))
    const byPath = new Map()

    for (const el of els) {
      if (!(el instanceof HTMLImageElement)) continue
      const path = String(el.getAttribute('data-ref-img') || '').trim()
      if (!path) continue

      const cached = uiRefImgCache.get(path)
      if (typeof cached === 'string' && cached) {
        el.src = cached
        continue
      }

      if (!byPath.has(path)) byPath.set(path, [])
      byPath.get(path).push(el)
    }

    for (const [path, list] of byPath) {
      if (uiRefImgPending.has(path)) continue
      uiRefImgPending.add(path)
      filesImagesRead({ scope: 'data', path })
        .then((dataUrl) => {
          const ok = typeof dataUrl === 'string' && dataUrl.startsWith('data:')
          if (ok) uiRefImgCache.set(path, dataUrl)
          const src = ok ? dataUrl : REF_IMG_PLACEHOLDER
          for (const img of list) {
            if (!(img instanceof HTMLImageElement)) continue
            if (!img.isConnected) continue
            img.src = src
          }
        })
        .catch(() => {})
        .finally(() => {
          uiRefImgPending.delete(path)
        })
    }
  }

  return { shrinkImageDataUrl, readFileAsDataUrl, hydrateRefImages }
}
