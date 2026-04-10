export const REF_IMG_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA='

export function markPreviewImages(root: unknown) {
  if (!(root instanceof HTMLElement)) return
  const imgs = Array.from(root.querySelectorAll?.('img') || [])
  for (const img of imgs) {
    if (!(img instanceof HTMLImageElement)) continue
    const src = String(img.getAttribute('src') || '').trim()
    if (!src) continue
    if (img.getAttribute('data-fw-img') === '1') continue
    img.setAttribute('data-fw-img', '1')
    try {
      img.style.cursor = 'zoom-in'
    } catch (_) {}
  }
}

export function createRefImageHydrator(refImgCache: Map<string, string>, refImgPending: Set<string>) {
  function hydrateRefImages(root: unknown) {
    if (!(root instanceof HTMLElement)) return

    const w = window as any
    const read = w?.fastWindow?.files?.images?.read
    if (typeof read !== 'function') return

    const els = Array.from(root.querySelectorAll?.('img[data-ref-img]') || [])
    const byPath = new Map<string, HTMLImageElement[]>()

    for (const el of els) {
      if (!(el instanceof HTMLImageElement)) continue
      const path = String(el.getAttribute('data-ref-img') || '').trim()
      if (!path) continue

      const cached = refImgCache.get(path)
      if (typeof cached === 'string' && cached) {
        el.src = cached
        continue
      }

      const list = byPath.get(path) || []
      list.push(el)
      byPath.set(path, list)
    }

    for (const [path, list] of byPath) {
      if (refImgPending.has(path)) continue
      refImgPending.add(path)
      Promise.resolve()
        .then(() => read({ scope: 'data', path }))
        .then((dataUrl: unknown) => {
          const src = typeof dataUrl === 'string' && dataUrl.startsWith('data:') ? dataUrl : ''
          if (src) refImgCache.set(path, src)
          for (const img of list) {
            if (!(img instanceof HTMLImageElement)) continue
            if (!img.isConnected) continue
            if (src) img.src = src
          }
        })
        .catch(() => {})
        .finally(() => {
          refImgPending.delete(path)
        })
    }
  }

  return { hydrateRefImages }
}

