import './vendor'
import { enhanceCodeBlocks } from './copy'
import { createMarkdownRenderer, preprocessHtmlIndentation } from './markdown'
import { enhanceMathCopyButtons } from './mathCopy'
import { createMermaidSupport } from './mermaid'
import { preprocessAssistantContent } from './preprocess'
import { REF_IMG_PLACEHOLDER, createRefImageHydrator, markPreviewImages } from './refImages'
import { createHtmlSanitizer, sanitizeSvg } from './sanitize'
import { hydrateStickerSizes } from './stickers'
import type { AssistantRenderOptions, BoolRef, KnowledgeRenderCapabilities, RenderSafetyPolicy } from './types'
import { esc } from './utils'

export type AssistantRenderEngine = {
  ensureRenderer: () => Promise<void>
  sanitizeHtml: (html: unknown, policy?: RenderSafetyPolicy) => string
  sanitizeSvg: (svg: unknown, policy?: RenderSafetyPolicy) => string
  renderAssistantInto: (el: unknown, text: unknown, options?: AssistantRenderOptions) => void
}

export function createDefaultAssistantRenderEngine(capabilities: KnowledgeRenderCapabilities = {}): AssistantRenderEngine {
  let rendererPromise: Promise<void> | null = null
  const domPurifyHooked: BoolRef = { value: false }
  const mermaidInited: BoolRef = { value: false }
  const markedConfigured: BoolRef = { value: false }

  const mermaidSvgCache = new Map<string, string>()
  const refImgCache = new Map<string, string>()
  const refImgPending = new Set<string>()

  const htmlSanitizer = createHtmlSanitizer(domPurifyHooked)
  const markdownRenderer = createMarkdownRenderer(markedConfigured)
  const refImages = createRefImageHydrator(refImgCache, refImgPending, capabilities)
  const mermaidSupport = createMermaidSupport({ mermaidInited, mermaidSvgCache, capabilities })

  function ensureRenderer() {
    if (rendererPromise) return rendererPromise
    rendererPromise = (async () => {
      mermaidSupport.initMermaidOnce()
    })()
    return rendererPromise
  }

  function renderAssistantInto(el: unknown, text: unknown, options?: AssistantRenderOptions) {
    if (!(el instanceof HTMLElement)) return
    ensureRenderer().catch(() => {})
    const raw = String(text || '')
    const renderSafetyPolicy: RenderSafetyPolicy =
      options?.renderSafetyPolicy === 'unsafe' ? 'unsafe' : options?.renderSafetyPolicy === 'baseline' ? 'baseline' : 'original'

    const noIndent = preprocessHtmlIndentation(raw)
    const pre = preprocessAssistantContent(noIndent, { stickersEnabled: !!options?.stickersEnabled })
    const src = String(pre.text || '')
    const getStickerPath = typeof options?.getStickerPath === 'function' ? options.getStickerPath : null

    const html = markdownRenderer.renderMarkdownSource(src)
    let safe = htmlSanitizer.sanitizeHtml(html, renderSafetyPolicy)
    if (Array.isArray(pre.math) && pre.math.length) {
      safe = safe.replace(/@@MATH_(INLINE|BLOCK)_(\d+)@@/g, (_match: string, kind: string, id: string) => {
        const item = pre.math[Number(id)]
        const tex = item ? String(item.tex || '') : ''
        if (kind === 'INLINE') return `<span class="math-inline" data-tex="${esc(tex)}"></span>`
        return `<div class="math-block" data-tex="${esc(tex)}"></div>`
      })
    }
    if (Array.isArray(pre.mermaid) && pre.mermaid.length) {
      safe = safe.replace(/@@MERMAID_(\d+)@@/g, (_match: string, id: string) => {
        const code = pre.mermaid[Number(id)] ?? ''
        return `<pre><code class="language-mermaid">${esc(code)}</code></pre>`
      })
    }
    if (Array.isArray(pre.stickers) && pre.stickers.length) {
      safe = safe.replace(/@@STICKER_(\d+)@@/g, (_match: string, id: string) => {
        const item = pre.stickers[Number(id)] || null
        if (!item) return ''
        const rawToken = String(item.raw || '')
        const category = String(item.category || '')
        const name = String(item.name || '')
        const size = typeof item.size === 'number' && Number.isFinite(item.size) ? Math.round(item.size) : 0
        const label = category && name ? `${category}/${name}` : rawToken
        const relPath = getStickerPath ? String(getStickerPath(category, name) || '').trim() : ''
        if (!relPath) return `<span class="fw-sticker-miss">${esc(rawToken)}</span>`
        const sizeAttr = size > 0 ? ` data-fw-sticker-size="${String(size)}"` : ''
        return `<img class="fw-sticker" data-fw-img="1" data-ref-img="${esc(relPath)}"${sizeAttr} src="${REF_IMG_PLACEHOLDER}" alt="${esc(name || 'sticker')}" title="${esc(label)}" />`
      })
    }

    el.innerHTML = safe
    enhanceCodeBlocks(el)
    mermaidSupport.ensureMermaidBlockCopyHandlerOnce(el)
    mermaidSupport.ensureMermaidErrorCopyHandlerOnce(el)
    markPreviewImages(el)
    hydrateStickerSizes(el)
    refImages.hydrateRefImages(el)

    const katex = (window as any).katex
    if (katex && typeof katex.render === 'function') {
      const blocks = Array.from(el.querySelectorAll?.('.math-block[data-tex]') || [])
      for (const block of blocks) {
        if (!(block instanceof HTMLElement)) continue
        const tex = block.getAttribute('data-tex') || ''
        try {
          katex.render(tex, block, { displayMode: true, throwOnError: false })
        } catch (_) {}
      }
      const inlines = Array.from(el.querySelectorAll?.('.math-inline[data-tex]') || [])
      for (const inline of inlines) {
        if (!(inline instanceof HTMLElement)) continue
        const tex = inline.getAttribute('data-tex') || ''
        try {
          katex.render(tex, inline, { displayMode: false, throwOnError: false })
        } catch (_) {}
      }
      enhanceMathCopyButtons(el, capabilities)
    }

    mermaidSupport.renderMermaidInto(el, renderSafetyPolicy).catch(() => {})
  }

  return {
    ensureRenderer,
    sanitizeHtml: htmlSanitizer.sanitizeHtml,
    sanitizeSvg,
    renderAssistantInto,
  }
}
