import '../vendor'

import { esc } from '../../core/utils'
import { markSwitchBoundary } from '../../domain/switchTrace'
import { createHtmlSanitizer, sanitizeSvg } from '../sanitize'
import { createRefImageHydrator } from '../refImages'
import { createMathRenderer } from '../mathRender'
import { commitBlocks, commitHtml } from '../domCommit'
import { messageHtmlCache } from '../messageCache'
import { assistantRenderCacheKey, normalizeRenderSafetyPolicy } from '../renderCacheKey'
import { createRenderCapabilities } from '../capabilities'
import type { BoolRef, RenderSafetyPolicy } from '../types'
import type { RenderContext } from '../contract'
import type { AiChatCapabilities } from '../../gateway/capabilities'
import { createUnifiedPipeline } from './pipeline'
import type { RenderPluginContext } from './plugins/registry'

// ============================================================================
// unified 渲染引擎：以「解析成树 → 插件处理 → 序列化」为底座。
//
// 与旧引擎的分工完全一致：
//   - 本文件只负责「字符串 → HTML 字符串」（解析 / 认领 / 序列化）
//   - 消毒、增量提交、装饰、收尾全部复用既有能力实现，表现层不变
//
// 插件层（rehype）产出与旧引擎 1:1 的结构，因此 decorate / enhance 可原样复用。
// ============================================================================

export type UnifiedRenderOptions = {
  stickersEnabled?: boolean
  getStickerPath?: (category: string, name: string) => string
  renderSafetyPolicy?: RenderSafetyPolicy
  // streaming=true 时禁用消息级缓存：流式中态永远不缓存。
  streaming?: boolean
  // cacheScope 是缓存代际（会话身份）：切会话即整代降级。
  cacheScope?: string
}

export type UnifiedRenderEngine = {
  ensureRenderer: () => Promise<void>
  sanitizeHtml: (html: unknown, policy?: RenderSafetyPolicy) => string
  sanitizeSvg: (svg: unknown, policy?: RenderSafetyPolicy) => string
  renderAssistantInto: (el: unknown, text: unknown, options?: UnifiedRenderOptions) => void
}

export function createUnifiedAssistantRenderEngine(capabilities: AiChatCapabilities): UnifiedRenderEngine {
  let rendererPromise: Promise<void> | null = null

  const domPurifyHooked: BoolRef = { value: false }
  const mermaidInited: BoolRef = { value: false }
  const mermaidSvgCache = new Map<string, string>()
  const refImgCache = new Map<string, string>()
  const refImgPending = new Set<string>()

  const htmlSanitizer = createHtmlSanitizer(domPurifyHooked)
  const refImages = createRefImageHydrator(refImgCache, refImgPending, capabilities)
  const mathRenderer = createMathRenderer()

  // 能力集合：装饰 / 收尾 / 交互与旧引擎共用同一套实现。
  const capabilityList = createRenderCapabilities({
    capabilities,
    mermaidInited,
    mermaidSvgCache,
    mathRenderer,
    refImages,
  })

  // 每次渲染的可变上下文（processSync 是同步的，不存在交错）。
  const pluginCtx: RenderPluginContext = {
    stickersEnabled: false,
    getStickerPath: null,
    mathClaims: [],
    htmlBlocks: [],
  }

  // 纯计算管线：预处理 → 保护 → 解析 → 序列化。
  // 与 Worker 共用同一实现，主线程这里只负责失败降级与后续提交。
  const pipeline = createUnifiedPipeline(pluginCtx)

  function ensureRenderer() {
    if (rendererPromise) return rendererPromise
    rendererPromise = (async () => {
      for (const capability of capabilityList) {
        try {
          await capability.init?.()
        } catch (_) {}
      }
    })()
    return rendererPromise
  }

  // 地盘版本：每次渲染递增。异步任务回填前据此核对目标是否仍在位。
  const versionByHost = new WeakMap<HTMLElement, number>()

  function renderAssistantInto(el: unknown, text: unknown, options?: UnifiedRenderOptions) {
    if (!(el instanceof HTMLElement)) return
    const host = el
    ensureRenderer().catch(() => {})

    const version = (versionByHost.get(host) || 0) + 1
    versionByHost.set(host, version)

    const renderSafetyPolicy = normalizeRenderSafetyPolicy(options?.renderSafetyPolicy)
    const getStickerPath = typeof options?.getStickerPath === 'function' ? options.getStickerPath : null

    pluginCtx.stickersEnabled = !!options?.stickersEnabled
    pluginCtx.getStickerPath = getStickerPath

    const ctx: RenderContext = {
      host,
      version,
      isCurrent: () => versionByHost.get(host) === version && host.isConnected,
      policy: renderSafetyPolicy,
      stickersEnabled: !!options?.stickersEnabled,
      getStickerPath,
      capabilities,
      commit: null,
    }

    // 交互接线只需在根上绑定一次；能力自身保证幂等。
    for (const capability of capabilityList) {
      try {
        capability.bind?.(host, ctx)
      } catch (_) {}
    }

    const source = String(text || '')
    const streaming = !!options?.streaming
    const cacheScope = String(options?.cacheScope || '')

    // 消息级缓存：只缓存「已消毒的顶层块」。
    // 明确不缓存：流式中态、失败降级结果（下面 fail 分支直接跳过写入）。
    const cacheKey = assistantRenderCacheKey({
      source,
      streaming,
      scope: cacheScope,
      policy: renderSafetyPolicy,
      stickersEnabled: !!options?.stickersEnabled,
      hasStickerPath: !!getStickerPath,
    })

    markSwitchBoundary('frontend.enhanceStart')

    if (cacheKey) {
      const cached = messageHtmlCache.get(cacheKey)
      if (cached) {
        const hitCommit = commitBlocks(host, cached, (fragment) => {
          for (const capability of capabilityList) {
            try {
              capability.decorate?.(fragment, ctx)
            } catch (_) {}
          }
        })
        markSwitchBoundary('frontend.enhanceEnd')
        ctx.commit = hitCommit
        for (const capability of capabilityList) {
          try {
            Promise.resolve(capability.enhance?.(ctx)).catch(() => {})
          } catch (_) {}
        }
        return
      }
    }

    // HTML 缩进去缩进、公式与 HTML 块保护、解析、序列化全部由纯计算管线完成。
    let html = ''
    let degraded = false
    try {
      html = pipeline.render(source)
    } catch (_) {
      // 失败隔离：解析整体失败时降级为纯文本，不影响其余消息。
      // 降级结果不进入缓存：它代表失败，不应被当成正常成品复用。
      degraded = true
      html = `<pre>${esc(source)}</pre>`
    }

    let safe = htmlSanitizer.sanitizeHtml(html, renderSafetyPolicy)

    // 增量提交：只对新增尾部片段做装饰。
    const commit = commitHtml(host, safe, (fragment) => {
      for (const capability of capabilityList) {
        try {
          capability.decorate?.(fragment, ctx)
        } catch (_) {}
      }
    })
    markSwitchBoundary('frontend.enhanceEnd')
    if (cacheKey && !degraded) messageHtmlCache.put(cacheKey, commit.blocks, cacheScope)
    // 收尾阶段只认本次新增节点：能力据此避免整块地盘重扫。
    ctx.commit = commit

    // 收尾：异步产出与临时资源清理（能力内部保证成功与失败都收尾）。
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
