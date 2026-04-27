import type { PreviewController } from './usePreviewController'

function pickFirstMermaidBlock(root: Element): HTMLElement | null {
  const el = root.querySelector('.mermaid-block[data-mermaid="1"]')
  return el instanceof HTMLElement ? el : null
}

function pickFirstImage(root: Element): HTMLImageElement | null {
  const el = root.querySelector('img')
  return el instanceof HTMLImageElement ? el : null
}

const ASSET_IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg'])

function hasAssetImagePlaceholder(root: Element): boolean {
  const ph = root.querySelector('.hc-asset[data-hc-asset-ref]')
  if (!(ph instanceof HTMLElement)) return false
  const ref = String(ph.getAttribute('data-hc-asset-ref') || '').trim()
  const dot = ref.lastIndexOf('.')
  if (dot <= 0) return false
  const ext = ref.slice(dot + 1).toLowerCase()
  return ASSET_IMAGE_EXTS.has(ext)
}

/**
 * Live 编辑器（CM6 widget）场景：
 * - 点击预览内容本体应该“回到源码”而不是弹预览
 * - 预览能力通过右上角按钮触发，避免与“回退源码”手势冲突
 */
export function ensureLiveEditorPreviewButton(
  renderedEl: HTMLElement,
  opts: {
    controller: PreviewController
    getRoot?: (current: HTMLElement) => Element | null
    /** 仅当存在可预览内容时才显示按钮（默认 true） */
    onlyIfHasPreview?: boolean
  },
) {
  if (!(renderedEl instanceof HTMLElement)) return
  const wrap = renderedEl.closest('.hc-cm6-preview')
  if (!(wrap instanceof HTMLElement)) return

  // 避免重复插入/重复绑定
  if (wrap.getAttribute('data-hc-live-preview-btn') === '1') return

  const onlyIfHasPreview = opts.onlyIfHasPreview !== false

  const kind = String(wrap.getAttribute('data-kind') || '').trim()
  const isMermaidBlock = kind === 'mermaid'
  const isAssetBlock = kind === 'asset'

  const hasMermaid = isMermaidBlock || !!pickFirstMermaidBlock(renderedEl)
  const hasImage = !!pickFirstImage(renderedEl)
  const hasAssetImage = isAssetBlock && (hasImage || hasAssetImagePlaceholder(renderedEl))

  // Mermaid 即使还未异步渲染完成，也允许提前显示按钮。
  // 附件图片：在图片 아직未 resolve 出 <img> 时，仍允许显示按钮（否则看起来像“只有 mermaid 有”）。
  if (onlyIfHasPreview && !hasMermaid && !hasImage && !hasAssetImage) return

  wrap.setAttribute('data-hc-live-preview-btn', '1')
  wrap.style.position = 'relative'

  const actions = document.createElement('div')
  actions.className = 'hc-cm6-preview-actions'

  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'hc-cm6-preview-action-btn'
  btn.setAttribute('aria-label', '预览')
  btn.setAttribute('title', '预览')
  btn.textContent = '预览'

  btn.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()

    const getRoot = typeof opts.getRoot === 'function'
      ? opts.getRoot
      : (current: HTMLElement) => current.closest('.cm-editor')
    const root = getRoot(wrap) || wrap

    if (isMermaidBlock) {
      const block = pickFirstMermaidBlock(root) || pickFirstMermaidBlock(renderedEl)
      if (!block) {
        try { void opts.controller.toast('Mermaid 还没渲染好，请稍后再试') } catch (_) {}
        return
      }
      opts.controller.actions.openMermaidViewer(root, block)
      return
    }

    // 附件图片（{{asset:...}}）：只打开当前块里已经 resolve 出来的图片，
    // 避免 fallback 到整个编辑器 root 后误打开“别的图片”。
    if (isAssetBlock) {
      const img = pickFirstImage(renderedEl)
      if (!img) {
        try { void opts.controller.toast('图片还在加载中，请稍后再试') } catch (_) {}
        return
      }
      opts.controller.actions.openImageViewer(root, img)
      return
    }

    const img = pickFirstImage(renderedEl) || pickFirstImage(root)
    if (img) {
      opts.controller.actions.openImageViewer(root, img)
      return
    }

    const block = pickFirstMermaidBlock(root) || pickFirstMermaidBlock(renderedEl)
    if (block) {
      opts.controller.actions.openMermaidViewer(root, block)
      return
    }

    try { void opts.controller.toast('没有可预览内容') } catch (_) {}
  })

  actions.appendChild(btn)
  wrap.appendChild(actions)
}
