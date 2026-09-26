import * as React from 'react'

import { useEvent } from '../../ui/preview/useEvent'
import { useImageViewerController, type ImageViewerState } from '../../ui/preview/useImageViewerController'

/**
 * 文字面预览控制器（面插件私有）：图片查看器复用宿主共享设施，Mermaid 查看器属于本面自己的渲染产物。
 */

export type MermaidViewerState = {
  items: { svg: string }[]
  index: number
  scale: number
}

export type MarkdownPreviewController = {
  toast: (message: string) => Promise<void> | void
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

type MarkdownPreviewModal = '' | 'image' | 'mermaid'

function clampIndex(idx: number, len: number) {
  const n = Math.floor(Number(idx || 0))
  if (!(len > 0)) return 0
  if (n < 0) return 0
  if (n >= len) return len - 1
  return n
}

function listPreviewMermaids(root: Element): HTMLElement[] {
  const blocks = Array.from(root.querySelectorAll?.('.mermaid-block[data-mermaid="1"]') || [])
  return blocks.filter((x): x is HTMLElement => x instanceof HTMLElement)
}

export function useMarkdownPreview(opts: { toast: (message: string) => Promise<void> | void; sanitizeSvg?: (svg: unknown) => string }): {
  modal: MarkdownPreviewModal
  imageViewer: ImageViewerState
  mermaid: MermaidViewerState
  controller: MarkdownPreviewController
} {
  const image = useImageViewerController({ toast: opts.toast })

  const [mermaidModal, setMermaidModal] = React.useState(false)
  const [mermaid, setMermaid] = React.useState<MermaidViewerState>({ items: [], index: 0, scale: 1 })

  const sanitizeSvgRef = React.useRef(opts.sanitizeSvg)
  sanitizeSvgRef.current = opts.sanitizeSvg

  const closeImage = image.controller.actions.closeModal
  const openImage = image.controller.actions.openImageViewer

  const closeModal = useEvent(() => {
    setMermaidModal(false)
    closeImage()
  })

  const openImageViewer = useEvent((rootEl: unknown, srcEl: unknown) => {
    setMermaidModal(false)
    openImage(rootEl, srcEl)
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
    closeImage()
    setMermaidModal(true)
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

  const controller: MarkdownPreviewController = React.useMemo(() => {
    return {
      toast: image.controller.toast,
      actions: {
        closeModal,
        openImageViewer,
        openMermaidViewer,
        imagePrev: image.controller.actions.imagePrev,
        imageNext: image.controller.actions.imageNext,
        imageSetScale: image.controller.actions.imageSetScale,
        mermaidPrev,
        mermaidNext,
        mermaidSetScale,
      },
    }
  }, [closeModal, image.controller, mermaidNext, mermaidPrev, mermaidSetScale, openImageViewer, openMermaidViewer])

  const modal: MarkdownPreviewModal = mermaidModal ? 'mermaid' : image.modal === 'image' ? 'image' : ''
  return { modal, imageViewer: image.imageViewer, mermaid, controller }
}
