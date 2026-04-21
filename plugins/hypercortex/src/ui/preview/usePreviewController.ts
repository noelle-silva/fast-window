import * as React from 'react'
import type { Api } from '../../core'
import { useEvent } from './useEvent'

type PreviewModal = '' | 'image' | 'mermaid'

export type ImageViewerState = {
  items: { src: string; alt: string }[]
  index: number
  scale: number
}

export type MermaidViewerState = {
  items: { svg: string }[]
  index: number
  scale: number
}

export type PreviewController = {
  api: Api
  actions: {
    closeModal: () => void
    openImageViewer: (rootEl: unknown, srcEl: unknown) => void
    openMermaidViewer: (rootEl: unknown, srcEl: unknown) => void
    imagePrev: () => void
    imageNext: () => void
    imageSetScale: (scale: number) => void
    mermaidPrev: () => void
    mermaidNext: () => void
    mermaidSetScale: (scale: number) => void
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

function listPreviewMermaids(root: Element): HTMLElement[] {
  const blocks = Array.from(root.querySelectorAll?.('.mermaid-block[data-mermaid="1"]') || [])
  return blocks.filter((x): x is HTMLElement => x instanceof HTMLElement)
}

export function usePreviewController(opts: { api: Api; sanitizeSvg?: (svg: unknown) => string }): {
  modal: PreviewModal
  imageViewer: ImageViewerState
  mermaid: MermaidViewerState
  controller: PreviewController
} {
  const apiRef = React.useRef(opts.api)
  apiRef.current = opts.api

  const sanitizeSvgRef = React.useRef(opts.sanitizeSvg)
  sanitizeSvgRef.current = opts.sanitizeSvg

  const [modal, setModal] = React.useState<PreviewModal>('')
  const [imageViewer, setImageViewer] = React.useState<ImageViewerState>({ items: [], index: 0, scale: 1 })
  const [mermaid, setMermaid] = React.useState<MermaidViewerState>({ items: [], index: 0, scale: 1 })

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

  const openMermaidViewer = useEvent((rootEl: unknown, srcEl: unknown) => {
    const root = rootEl instanceof Element ? rootEl : document.body
    const blocks = listPreviewMermaids(root)
    const items: { svg: string }[] = []
    const sanitize = sanitizeSvgRef.current
    for (const b of blocks) {
      const svg = String(b.innerHTML || '')
      if (!svg) continue
      const safe = typeof sanitize === 'function' ? sanitize(svg) : svg
      if (safe) items.push({ svg: safe })
    }
    if (!items.length) return

    let idx = 0
    const src = srcEl instanceof Element ? srcEl : null
    if (src) {
      const i = blocks.findIndex((b) => b === src || b.contains(src))
      if (i >= 0) idx = i
    }

    setMermaid({ items, index: clampIndex(idx, items.length), scale: 1 })
    setModal('mermaid')
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

  const mermaidPrev = useEvent(() => {
    setMermaid((prev) => {
      const len = Array.isArray(prev.items) ? prev.items.length : 0
      if (!len) return prev
      const nextIndex = (Number(prev.index || 0) - 1 + len) % len
      return { ...prev, index: nextIndex, scale: 1 }
    })
  })

  const mermaidNext = useEvent(() => {
    setMermaid((prev) => {
      const len = Array.isArray(prev.items) ? prev.items.length : 0
      if (!len) return prev
      const nextIndex = (Number(prev.index || 0) + 1) % len
      return { ...prev, index: nextIndex, scale: 1 }
    })
  })

  const mermaidSetScale = useEvent((scale: number) => {
    setMermaid((prev) => ({ ...prev, scale: Number(scale || 1) }))
  })

  const controller: PreviewController = React.useMemo(() => {
    return {
      get api() {
        return apiRef.current
      },
      actions: {
        closeModal,
        openImageViewer,
        openMermaidViewer,
        imagePrev,
        imageNext,
        imageSetScale,
        mermaidPrev,
        mermaidNext,
        mermaidSetScale,
      },
    } as any
  }, [closeModal, imageNext, imagePrev, imageSetScale, mermaidNext, mermaidPrev, mermaidSetScale, openImageViewer, openMermaidViewer])

  return { modal, imageViewer, mermaid, controller }
}

