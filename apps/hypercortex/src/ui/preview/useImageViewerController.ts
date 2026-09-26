import * as React from 'react'
import { useEvent } from './useEvent'

/**
 * 图片查看器（宿主共享预览设施）：资产预览与面插件的渲染产物共用。
 * 只负责图片集合的收集、翻页与缩放状态；不包含任何面类型知识。
 */

export type ImageViewerState = {
  items: { src: string; alt: string }[]
  index: number
  scale: number
}

export type ImageViewController = {
  toast: (message: string) => Promise<void> | void
  actions: {
    closeModal: () => void
    openImageViewer: (rootEl: unknown, srcEl: unknown) => void
    imagePrev: () => void
    imageNext: () => void
    imageSetScale: (scale: number) => void
  }
}

function clampIndex(idx: number, len: number) {
  const n = Math.floor(Number(idx || 0))
  if (!(len > 0)) return 0
  if (n < 0) return 0
  if (n >= len) return len - 1
  return n
}

function listPreviewImages(root: Element): HTMLImageElement[] {
  const prefer = root instanceof HTMLElement && root.classList.contains('hc-render')
  const sel = prefer ? 'img' : '.hc-render img'
  const a = Array.from(root.querySelectorAll?.(sel) || [])
  const list = a.length ? a : Array.from(root.querySelectorAll?.('img') || [])
  return list.filter((x): x is HTMLImageElement => x instanceof HTMLImageElement)
}

export function useImageViewerController(opts: { toast: (message: string) => Promise<void> | void }): {
  modal: '' | 'image'
  imageViewer: ImageViewerState
  controller: ImageViewController
} {
  const toastRef = React.useRef(opts.toast)
  toastRef.current = opts.toast

  const [modal, setModal] = React.useState<'' | 'image'>('')
  const [imageViewer, setImageViewer] = React.useState<ImageViewerState>({ items: [], index: 0, scale: 1 })

  const closeModal = useEvent(() => setModal(''))

  const openImageViewer = useEvent((rootEl: unknown, srcEl: unknown) => {
    const root = rootEl instanceof Element ? rootEl : document.body
    const imgs = listPreviewImages(root)
    const items: { src: string; alt: string }[] = []
    const elToIdx = new Map<HTMLImageElement, number>()

    for (const img of imgs) {
      const src = String(img.getAttribute('src') || '').trim()
      if (!src) continue
      const idx = items.length
      items.push({ src, alt: String(img.getAttribute('alt') || '图片') })
      elToIdx.set(img, idx)
    }
    if (!items.length) return

    let idx = 0
    const src = srcEl instanceof Element ? srcEl : null
    if (src) {
      const img = src instanceof HTMLImageElement ? src : (src.closest?.('img') as any)
      const i = img instanceof HTMLImageElement ? elToIdx.get(img) : -1
      if (typeof i === 'number' && i >= 0) idx = i
    }

    setImageViewer({ items, index: clampIndex(idx, items.length), scale: 1 })
    setModal('image')
  })

  const imagePrev = useEvent(() => {
    setImageViewer((prev) => {
      const len = Array.isArray(prev.items) ? prev.items.length : 0
      if (!len) return prev
      const nextIndex = (Number(prev.index || 0) - 1 + len) % len
      return { ...prev, index: nextIndex, scale: 1 }
    })
  })

  const imageNext = useEvent(() => {
    setImageViewer((prev) => {
      const len = Array.isArray(prev.items) ? prev.items.length : 0
      if (!len) return prev
      const nextIndex = (Number(prev.index || 0) + 1) % len
      return { ...prev, index: nextIndex, scale: 1 }
    })
  })

  const imageSetScale = useEvent((scale: number) => {
    setImageViewer((prev) => ({ ...prev, scale: Number(scale || 1) }))
  })

  const controller: ImageViewController = React.useMemo(() => {
    return {
      toast: (message: string) => toastRef.current(message),
      actions: {
        closeModal,
        openImageViewer,
        imagePrev,
        imageNext,
        imageSetScale,
      },
    }
  }, [closeModal, imageNext, imagePrev, imageSetScale, openImageViewer])

  return { modal, imageViewer, controller }
}
