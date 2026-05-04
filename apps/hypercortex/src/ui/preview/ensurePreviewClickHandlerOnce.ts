import type { PreviewController } from './usePreviewController'

export function ensurePreviewClickHandlerOnce(
  el: HTMLElement,
  opts: {
    controller: PreviewController
    stopPropagation?: boolean
    getRoot?: (current: HTMLElement) => Element | null
  },
) {
  if (!(el instanceof HTMLElement)) return
  if (el.getAttribute('data-hc-preview-hook') === '1') return
  el.setAttribute('data-hc-preview-hook', '1')

  const stop = opts.stopPropagation !== false
  const getRoot = typeof opts.getRoot === 'function' ? opts.getRoot : (x: HTMLElement) => x

  el.addEventListener('click', (e) => {
    const target = e.target instanceof Element ? e.target : null
    if (!target) return
    if (target.closest('button,[role="button"],input,textarea,select')) return

    const root = getRoot(el) || el

    const img = target.closest('img')
    if (img instanceof HTMLImageElement) {
      const src = String(img.getAttribute('src') || '').trim()
      if (!src) return
      if (stop) {
        e.preventDefault()
        e.stopPropagation()
      }
      opts.controller.actions.openImageViewer(root, img)
      return
    }

    const block = target.closest('.mermaid-block[data-mermaid="1"]')
    if (block instanceof HTMLElement) {
      if (stop) {
        e.preventDefault()
        e.stopPropagation()
      }
      opts.controller.actions.openMermaidViewer(root, block)
    }
  })
}

