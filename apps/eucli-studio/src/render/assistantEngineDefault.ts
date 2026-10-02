import './vendor'
import { createMarkdownRenderer, preprocessHtmlIndentation } from './markdown'
import { createRefImageHydrator } from './refImages'
import { createHtmlSanitizer, sanitizeSvg } from './sanitize'
import type { BoolRef, RenderSafetyPolicy } from './types'
import { createMathRenderer } from './mathRender'
import { commitHtml } from './domCommit'
import { shapeContent, substituteClaims } from './shaper'
import { createRenderCapabilities } from './capabilities'
import type { RenderContext } from './contract'
import type { AiChatCapabilities } from '../gateway/capabilities'

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
  const markedConfigured: BoolRef = { value: false }
  const mermaidInited: BoolRef = { value: false }

  const mermaidSvgCache = new Map<string, string>()
  const refImgCache = new Map<string, string>()
  const refImgPending = new Set<string>()

  const htmlSanitizer = createHtmlSanitizer(domPurifyHooked)
  const markdownRenderer = createMarkdownRenderer(markedConfigured)
  const refImages = createRefImageHydrator(refImgCache, refImgPending, capabilities)
  const mathRenderer = createMathRenderer()

  // 能力集合：由装配入口产出，引擎只认识契约，不认识任何具体能力实现。
  const capabilityList = createRenderCapabilities({
    capabilities,
    mermaidInited,
    mermaidSvgCache,
    mathRenderer,
    refImages,
  })

  // 地盘版本：每次渲染递增。异步任务回填前据此核对目标是否仍在位。
  const versionByHost = new WeakMap<HTMLElement, number>()

  function ensureRenderer() {
    if (rendererPromise) return rendererPromise
    rendererPromise = (async () => {
      // v2: 依赖在构建期打包为本地依赖（见 src/render/vendor.ts），运行时不再拉公共 CDN。
      for (const capability of capabilityList) {
        try {
          await capability.init?.()
        } catch (_) {}
      }
    })()
    return rendererPromise
  }

  function normalizeRenderSafetyPolicy(options?: AssistantRenderOptions): RenderSafetyPolicy {
    return options?.renderSafetyPolicy === 'unsafe' ? 'unsafe' : options?.renderSafetyPolicy === 'baseline' ? 'baseline' : 'original'
  }

  function renderAssistantInto(el: unknown, text: unknown, options?: AssistantRenderOptions) {
    if (!(el instanceof HTMLElement)) return
    const host = el
    ensureRenderer().catch(() => {})

    const version = (versionByHost.get(host) || 0) + 1
    versionByHost.set(host, version)

    const renderSafetyPolicy = normalizeRenderSafetyPolicy(options)
    const getStickerPath = typeof options?.getStickerPath === 'function' ? options.getStickerPath : null
    const ctx: RenderContext = {
      host,
      version,
      isCurrent: () => versionByHost.get(host) === version && host.isConnected,
      policy: renderSafetyPolicy,
      stickersEnabled: !!options?.stickersEnabled,
      getStickerPath,
      capabilities,
    }

    // 交互接线只需在根上绑定一次；能力自身保证幂等。
    for (const capability of capabilityList) {
      try {
        capability.bind?.(host, ctx)
      } catch (_) {}
    }

    const noIndent = preprocessHtmlIndentation(String(text || ''))
    const shaped = shapeContent(noIndent, ctx, capabilityList)
    const html = markdownRenderer.renderMarkdownSource(shaped.text)
    let safe = htmlSanitizer.sanitizeHtml(html, renderSafetyPolicy)
    safe = substituteClaims(safe, shaped.claims, ctx, capabilityList)

    // 增量提交：逐节点比对，相同前缀原地保留（同一 DOM 对象，已渲染的公式与交互不动），
    // 只重建发生变化的尾部，并只对新增尾部做装饰。
    commitHtml(host, safe, (fragment) => {
      for (const capability of capabilityList) {
        try {
          capability.decorate?.(fragment, ctx)
        } catch (_) {}
      }
    })

    // 收尾：异步产出与临时资源清理，成功与失败都必须收尾（能力内部保证）。
    for (const capability of capabilityList) {
      try {
        Promise.resolve(capability.enhance?.(ctx)).catch(() => {})
      } catch (_) {}
    }
  }

  return {
    ensureRenderer,
    sanitizeHtml: htmlSanitizer.sanitizeHtml,
    sanitizeSvg,
    renderAssistantInto,
  }
}
