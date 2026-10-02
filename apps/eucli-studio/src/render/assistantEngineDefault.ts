import { esc } from '../core/utils'
import './vendor'
import { decorateCodeBlocks, ensureCodeCopyHandlerOnce } from './copy'
import { createMarkdownRenderer, preprocessHtmlIndentation } from './markdown'
import { createMermaidSupport } from './mermaid'
import { preprocessAssistantContent } from './preprocess'
import { REF_IMG_PLACEHOLDER, createRefImageHydrator, markPreviewImages } from './refImages'
import { createHtmlSanitizer, sanitizeSvg } from './sanitize'
import { hydrateStickerSizes } from './stickers'
import type { BoolRef } from './types'
import { decorateMathHost, ensureMathCopyHandler } from './mathCopy'
import { createMathRenderer } from './mathRender'
import { commitHtml } from './domCommit'
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
  const mathRenderer = createMathRenderer()

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
        return `<pre data-fw-mermaid-complete="1"><code class="language-mermaid">${esc(code)}</code></pre>`
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

  // 事件委托只需在根上绑定一次；节点增删不影响已绑定的委托。
  function bindDelegatedHandlersOnce(el: HTMLElement) {
    ensureCodeCopyHandlerOnce(el)
    ensureMathCopyHandler(el, capabilities)
    mermaidSupport.ensureMermaidBlockCopyHandlerOnce(el)
    mermaidSupport.ensureMermaidErrorCopyHandlerOnce(el)
    mermaidSupport.ensureMermaidErrorAiFixHandlerOnce(el)
  }

  // decorateFragment 只处理本次「新增的尾部节点」：代码块按钮、公式渲染与复制按钮、
  // 图片标记、贴纸尺寸。已复用的前缀节点不会被重复处理。
  function decorateFragment(fragment: DocumentFragment, renderSafetyPolicy: RenderSafetyPolicy) {
    decorateCodeBlocks(fragment)
    markPreviewImages(fragment)
    hydrateStickerSizes(fragment)
    refImages.hydrateRefImages(fragment)

    const w = window as any
    const katex = w.katex
    if (katex && typeof katex.renderToString === 'function') {
      const blocks = Array.from(fragment.querySelectorAll?.('.math-block[data-tex]') || [])
      for (const b of blocks) {
        if (!(b instanceof HTMLElement)) continue
        mathRenderer.renderMathInto(b, b.getAttribute('data-tex') || '', true)
        decorateMathHost(b)
      }
      const inlines = Array.from(fragment.querySelectorAll?.('.math-inline[data-tex]') || [])
      for (const s of inlines) {
        if (!(s instanceof HTMLElement)) continue
        mathRenderer.renderMathInto(s, s.getAttribute('data-tex') || '', false)
        decorateMathHost(s)
      }
    }
  }

  function renderAssistantInto(el: unknown, text: unknown, options?: AssistantRenderOptions) {
    if (!(el instanceof HTMLElement)) return
    ensureRenderer().catch(() => {})
    const renderSafetyPolicy = normalizeRenderSafetyPolicy(options)
    bindDelegatedHandlersOnce(el)
    // 增量提交：逐节点比对，相同前缀原地保留（同一 DOM 对象，已渲染的公式与交互不动），
    // 只重建发生变化的尾部，并只对新增尾部做装饰。
    const html = renderAssistantTextHtml(text, options)
    commitHtml(el, html, (fragment) => decorateFragment(fragment, renderSafetyPolicy))

    mermaidSupport.renderMermaidInto(el, renderSafetyPolicy).catch(() => {})
  }

  return {
    ensureRenderer,
    sanitizeHtml: htmlSanitizer.sanitizeHtml,
    sanitizeSvg,
    renderAssistantInto,
  }
}
