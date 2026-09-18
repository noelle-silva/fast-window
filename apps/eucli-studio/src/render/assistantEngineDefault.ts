import { esc } from '../core/utils'
import './vendor'
import { enhanceCodeBlocks } from './copy'
import { createMarkdownRenderer, preprocessHtmlIndentation } from './markdown'
import { createMermaidSupport } from './mermaid'
import { preprocessAssistantContent } from './preprocess'
import { REF_IMG_PLACEHOLDER, createRefImageHydrator, markPreviewImages } from './refImages'
import { createHtmlSanitizer, sanitizeSvg } from './sanitize'
import { hydrateStickerSizes } from './stickers'
import type { BoolRef } from './types'
import { enhanceMathCopyButtons } from './mathCopy'
import type { AiChatCapabilities } from '../gateway/capabilities'

type RenderSafetyPolicy = 'original' | 'baseline' | 'unsafe'
type AssistantRenderOptions = {
  stickersEnabled?: boolean
  getStickerPath?: (category: string, name: string) => string
  renderSafetyPolicy?: RenderSafetyPolicy
}

export type AssistantRenderEngine = {
  ensureRenderer: () => Promise<void>
  sanitizeHtml: (html: unknown, policy?: RenderSafetyPolicy) => string
  sanitizeSvg: (svg: unknown, policy?: RenderSafetyPolicy) => string
  renderAssistantInto: (el: unknown, text: unknown, options?: AssistantRenderOptions) => void
}

export function createDefaultAssistantRenderEngine(capabilities: AiChatCapabilities): AssistantRenderEngine {
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
      // v2: 依赖在构建期打包为本地依赖（见 src/render/vendor.ts），运行时不再拉公共 CDN。
      try {
        mermaidSupport.initMermaidOnce()
      } catch (_) {}
    })()
    return rendererPromise
  }

  function normalizeRenderSafetyPolicy(options?: AssistantRenderOptions): RenderSafetyPolicy {
    return options?.renderSafetyPolicy === 'unsafe' ? 'unsafe' : options?.renderSafetyPolicy === 'baseline' ? 'baseline' : 'original'
  }

  function renderAssistantTextHtml(text: unknown, options?: AssistantRenderOptions, placeholders?: Map<string, string>) {
    const raw = String(text || '')
    let html = ''
    const renderSafetyPolicy = normalizeRenderSafetyPolicy(options)

    const noIndent = preprocessHtmlIndentation(raw)
    const pre = preprocessAssistantContent(noIndent, { stickersEnabled: !!options?.stickersEnabled })
    const src = String(pre.text || '')
    const getStickerPath = typeof options?.getStickerPath === 'function' ? options.getStickerPath : null

    html = markdownRenderer.renderMarkdownSource(src)

    let safe = htmlSanitizer.sanitizeHtml(html, renderSafetyPolicy)
    if (Array.isArray(pre.math) && pre.math.length) {
      safe = safe.replace(/@@MATH_(INLINE|BLOCK)_(\d+)@@/g, (_m: string, kind: string, id: string) => {
        const it = pre.math[Number(id)]
        const tex = it ? String(it.tex || '') : ''
        if (kind === 'INLINE') return `<span class="math-inline" data-tex="${esc(tex)}"></span>`
        return `<div class="math-block" data-tex="${esc(tex)}"></div>`
      })
    }
    if (Array.isArray(pre.mermaid) && pre.mermaid.length) {
      safe = safe.replace(/@@MERMAID_(\d+)@@/g, (_m: string, id: string) => {
        const code = pre.mermaid[Number(id)] ?? ''
        return `<pre><code class="language-mermaid">${esc(code)}</code></pre>`
      })
    }
    if (Array.isArray(pre.stickers) && pre.stickers.length) {
      safe = safe.replace(/@@STICKER_(\d+)@@/g, (_m: string, id: string) => {
        const it = pre.stickers[Number(id)] || null
        if (!it) return ''
        const rawToken = String(it.raw || '')
        const category = String(it.category || '')
        const name = String(it.name || '')
        const size = typeof it.size === 'number' && Number.isFinite(it.size) ? Math.round(it.size) : 0
        const label = category && name ? `${category}/${name}` : rawToken
        const relPath = getStickerPath ? String(getStickerPath(category, name) || '').trim() : ''
        if (!relPath) return `<span class="fw-sticker-miss">${esc(rawToken)}</span>`
        const sizeAttr = size > 0 ? ` data-fw-sticker-size="${String(size)}"` : ''
        return `<img class="fw-sticker" data-fw-img="1" data-ref-img="${esc(relPath)}"${sizeAttr} src="${REF_IMG_PLACEHOLDER}" alt="${esc(name || 'sticker')}" title="${esc(label)}" />`
      })
    }
    if (placeholders?.size) {
      safe = safe.replace(/<div(?=[^>]*\bclass="fw-tool-placeholder")(?=[^>]*\bdata-fw-tool-placeholder="([A-Za-z0-9_-]+)")[^>]*><\/div>/g, (match: string, token: string) => placeholders.get(token) || match)
    }

    return safe
  }

  function enhanceAssistantDom(el: HTMLElement, renderSafetyPolicy: RenderSafetyPolicy) {
    enhanceCodeBlocks(el)
    mermaidSupport.ensureMermaidBlockCopyHandlerOnce(el)
    mermaidSupport.ensureMermaidErrorCopyHandlerOnce(el)
    mermaidSupport.ensureMermaidErrorAiFixHandlerOnce(el)
    markPreviewImages(el)
    hydrateStickerSizes(el)
    refImages.hydrateRefImages(el)

    const w = window as any
    const katex = w.katex
    if (katex && typeof katex.render === 'function') {
      const blocks = Array.from(el.querySelectorAll?.('.math-block[data-tex]') || [])
      for (const b of blocks) {
        if (!(b instanceof HTMLElement)) continue
        const tex = b.getAttribute('data-tex') || ''
        try {
          katex.render(tex, b, { displayMode: true, throwOnError: false })
        } catch (_) {}
      }
      const inlines = Array.from(el.querySelectorAll?.('.math-inline[data-tex]') || [])
      for (const s of inlines) {
        if (!(s instanceof HTMLElement)) continue
        const tex = s.getAttribute('data-tex') || ''
        try {
          katex.render(tex, s, { displayMode: false, throwOnError: false })
        } catch (_) {}
      }
      enhanceMathCopyButtons(el, capabilities)
    }

    mermaidSupport.renderMermaidInto(el, renderSafetyPolicy).catch(() => {})
  }

  function renderAssistantInto(el: unknown, text: unknown, options?: AssistantRenderOptions) {
    if (!(el instanceof HTMLElement)) return
    ensureRenderer().catch(() => {})
    const renderSafetyPolicy = normalizeRenderSafetyPolicy(options)
    el.innerHTML = renderAssistantTextHtml(text, options)
    enhanceAssistantDom(el, renderSafetyPolicy)
  }

  return {
    ensureRenderer,
    sanitizeHtml: htmlSanitizer.sanitizeHtml,
    sanitizeSvg,
    renderAssistantInto,
  }
}
