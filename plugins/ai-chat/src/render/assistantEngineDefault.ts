import { esc } from '../core/utils'
import './vendor'
import type { ToolRequestRenderPreset } from '../core/toolRequestPresets'
import { enhanceCodeBlocks } from './copy'
import { createMarkdownRenderer, preprocessHtmlIndentation } from './markdown'
import { createMermaidSupport } from './mermaid'
import { preprocessAssistantContent } from './preprocess'
import { REF_IMG_PLACEHOLDER, createRefImageHydrator, markPreviewImages } from './refImages'
import { createHtmlSanitizer, sanitizeSvg } from './sanitize'
import { hydrateStickerSizes } from './stickers'
import { ensureToolReqCssOnce, ensureToolRequestToggleHandlerOnce, renderToolRequestHtml } from './toolRequestUi'
import type { BoolRef } from './types'
import { enhanceMathCopyButtons } from './mathCopy'

type RenderSafetyPolicy = 'original' | 'baseline' | 'unsafe'

export type AssistantRenderEngine = {
  ensureRenderer: () => Promise<void>
  sanitizeHtml: (html: unknown, policy?: RenderSafetyPolicy) => string
  sanitizeSvg: (svg: unknown, policy?: RenderSafetyPolicy) => string
  renderAssistantInto: (
    el: unknown,
    text: unknown,
    options?: {
      stickersEnabled?: boolean
      getStickerPath?: (category: string, name: string) => string
      toolRequestPreset?: ToolRequestRenderPreset | null
      renderSafetyPolicy?: RenderSafetyPolicy
    },
  ) => void
}

export function createDefaultAssistantRenderEngine(): AssistantRenderEngine {
  let rendererPromise: Promise<void> | null = null
  const domPurifyHooked: BoolRef = { value: false }
  const mermaidInited: BoolRef = { value: false }
  const markedConfigured: BoolRef = { value: false }
  const toolReqCssInited: BoolRef = { value: false }

  const mermaidSvgCache = new Map<string, string>()
  const refImgCache = new Map<string, string>()
  const refImgPending = new Set<string>()

  const htmlSanitizer = createHtmlSanitizer(domPurifyHooked)
  const markdownRenderer = createMarkdownRenderer(markedConfigured)
  const refImages = createRefImageHydrator(refImgCache, refImgPending)
  const mermaidSupport = createMermaidSupport({ mermaidInited, mermaidSvgCache })

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

  function renderAssistantInto(
    el: unknown,
    text: unknown,
    options?: {
      stickersEnabled?: boolean
      getStickerPath?: (category: string, name: string) => string
      toolRequestPreset?: ToolRequestRenderPreset | null
      renderSafetyPolicy?: RenderSafetyPolicy
    },
  ) {
    if (!(el instanceof HTMLElement)) return
    ensureRenderer().catch(() => {})
    ensureToolReqCssOnce(toolReqCssInited)
    const raw = String(text || '')
    let html = ''
    const renderSafetyPolicy: RenderSafetyPolicy =
      options?.renderSafetyPolicy === 'unsafe' ? 'unsafe' : options?.renderSafetyPolicy === 'baseline' ? 'baseline' : 'original'

    const noIndent = preprocessHtmlIndentation(raw)
    const toolReqPreset = (options as any)?.toolRequestPreset
    const pre = preprocessAssistantContent(noIndent, { stickersEnabled: !!options?.stickersEnabled })
    const src = String(pre.text || '')
    const getStickerPath = typeof options?.getStickerPath === 'function' ? options.getStickerPath : null

    html = markdownRenderer.renderMarkdownSource(src)

    let safe = htmlSanitizer.sanitizeHtml(html, renderSafetyPolicy)
    if (Array.isArray(pre.math) && pre.math.length) {
      safe = safe.replace(/@@MATH_(INLINE|BLOCK)_(\d+)@@/g, (_m, kind, id) => {
        const it = pre.math[Number(id)]
        const tex = it ? String(it.tex || '') : ''
        if (kind === 'INLINE') return `<span class="math-inline" data-tex="${esc(tex)}"></span>`
        return `<div class="math-block" data-tex="${esc(tex)}"></div>`
      })
    }
    if (Array.isArray(pre.mermaid) && pre.mermaid.length) {
      safe = safe.replace(/@@MERMAID_(\d+)@@/g, (_m, id) => {
        const code = pre.mermaid[Number(id)] ?? ''
        return `<pre><code class="language-mermaid">${esc(code)}</code></pre>`
      })
    }
    if (Array.isArray(pre.toolRequests) && pre.toolRequests.length) {
      safe = safe.replace(/@@TOOL_REQUEST_(\d+)@@/g, (_m, id) => {
        const it = pre.toolRequests[Number(id)] || null
        if (!it) return ''

        const toolNames = Array.isArray(it.toolNames) ? it.toolNames : []
        const summary = toolNames.length ? toolNames.map((n) => esc(String(n || '').trim() || '(无 tool_name)')).join('<br/>') : esc('(工具调用解析失败)')
        const detailText = String(it.detailText || '')
        return renderToolRequestHtml(toolReqPreset, summary, detailText)
      })
    }
    if (Array.isArray(pre.stickers) && pre.stickers.length) {
      safe = safe.replace(/@@STICKER_(\d+)@@/g, (_m, id) => {
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

    el.innerHTML = safe
    enhanceCodeBlocks(el)
    mermaidSupport.ensureMermaidErrorCopyHandlerOnce(el)
    mermaidSupport.ensureMermaidErrorAiFixHandlerOnce(el)
    ensureToolRequestToggleHandlerOnce(el)
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
      enhanceMathCopyButtons(el)
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
