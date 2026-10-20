import '../vendor'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import remarkRehype from 'remark-rehype'
import rehypeRaw from 'rehype-raw'
import rehypeStringify from 'rehype-stringify'

import { esc } from '../../core/utils'
import { createHtmlSanitizer, sanitizeSvg } from '../sanitize'
import { createRefImageHydrator } from '../refImages'
import { createMathRenderer } from '../mathRender'
import { commitHtml } from '../domCommit'
import { createRenderCapabilities } from '../capabilities'
import { preprocessHtmlIndentation } from '../markdown'
import type { BoolRef, RenderSafetyPolicy } from '../types'
import type { RenderContext } from '../contract'
import type { AiChatCapabilities } from '../../gateway/capabilities'
import { rehypeSticker, rehypeMathPlaceholder, rehypeRestoreHtmlBlock, rehypeFence, rehypeMermaid, rehypeEscapeCode } from './plugins'
import { protectMath, type MathClaim } from './mathProtect'
import { protectHtmlBlocks, demoteOpenFences } from './htmlProtect'

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
}

export type UnifiedRenderEngine = {
  ensureRenderer: () => Promise<void>
  sanitizeHtml: (html: unknown, policy?: RenderSafetyPolicy) => string
  sanitizeSvg: (svg: unknown, policy?: RenderSafetyPolicy) => string
  renderAssistantInto: (el: unknown, text: unknown, options?: UnifiedRenderOptions) => void
}

function normalizeRenderSafetyPolicy(options?: UnifiedRenderOptions): RenderSafetyPolicy {
  return options?.renderSafetyPolicy === 'unsafe'
    ? 'unsafe'
    : options?.renderSafetyPolicy === 'baseline'
      ? 'baseline'
      : 'original'
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
  const pluginCtx = {
    stickersEnabled: false,
    getStickerPath: null as ((category: string, name: string) => string) | null,
    mathClaims: [] as MathClaim[],
    htmlBlocks: [] as string[],
  }

  // 两条管线：只有内容里真的含 HTML 块时，才启用 rehype-raw。
  //
  // rehype-raw 会用 parse5 把整棵树重新解析一遍，是解析阶段最大的单点开销；
  // 而绝大多数消息里根本没有 HTML 块。按需启用可在不损失能力的前提下省掉这笔钱。
  function createProcessor(withRaw: boolean) {
    let p = unified()
      .use(remarkParse)
      // GFM：表格、删除线、任务列表、自动链接等（旧引擎的 marked 默认开启，这里对齐）
      .use(remarkGfm)
      // 单换行即换行（旧引擎 marked 配置了 breaks: true，这里对齐）
      .use(remarkBreaks)
      .use(remarkRehype, { allowDangerousHtml: true })
      // HTML 块占位还原必须排在 rehype-raw 之前，才能被重新解析成真节点。
      .use(rehypeRestoreHtmlBlock, { getBlocks: () => pluginCtx.htmlBlocks })
    if (withRaw) p = p.use(rehypeRaw)
    return p
      // 块内围栏：HTML 块里的 ```mermaid / ```js 不会被 Markdown 解析，这里还原成 pre > code。
      .use(rehypeFence)
      .use(rehypeSticker, { getCtx: () => pluginCtx })
      .use(rehypeMathPlaceholder, { getClaims: () => pluginCtx.mathClaims })
      .use(rehypeMermaid)
      .use(rehypeEscapeCode)
      .use(rehypeStringify, { allowDangerousHtml: true })
  }

  const processorWithRaw = createProcessor(true)
  const processorNoRaw = createProcessor(false)

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

    const renderSafetyPolicy = normalizeRenderSafetyPolicy(options)
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
    }

    // 交互接线只需在根上绑定一次；能力自身保证幂等。
    for (const capability of capabilityList) {
      try {
        capability.bind?.(host, ctx)
      } catch (_) {}
    }

    const source = String(text || '')
    // HTML 缩进去缩进：AI 输出的缩进 HTML 若保留 4 空格，会被 Markdown 当成代码块。
    const noIndent = preprocessHtmlIndentation(source)
    // 公式必须在 Markdown 解析前保护：否则 TeX 里的反斜杠命令（\, \\ \| 等）会被当成 Markdown 转义吃掉。
    const mathProtected = protectMath(noIndent)
    pluginCtx.mathClaims = mathProtected.claims
    // HTML 块必须在 Markdown 解析前整块保护：块内空行会让 Markdown 提前结束该块，把 SVG 后半截拆出去。
    const htmlProtected = protectHtmlBlocks(mathProtected.text)
    pluginCtx.htmlBlocks = htmlProtected.blocks
    // 未闭合围栏去掉语言标记，保持草稿态（不进入专用渲染）。
    const finalSource = demoteOpenFences(htmlProtected.text)
    // 有 HTML 块才启用 rehype-raw（parse5 重解析是解析阶段最大的单点开销）。
    const processor = pluginCtx.htmlBlocks.length ? processorWithRaw : processorNoRaw
    let html = ''
    try {
      html = String(processor.processSync(finalSource))
    } catch (_) {
      // 失败隔离：解析整体失败时降级为纯文本，不影响其余消息。
      html = `<pre>${esc(source)}</pre>`
    }

    let safe = htmlSanitizer.sanitizeHtml(html, renderSafetyPolicy)

    // 增量提交：只对新增尾部片段做装饰。
    commitHtml(host, safe, (fragment) => {
      for (const capability of capabilityList) {
        try {
          capability.decorate?.(fragment, ctx)
        } catch (_) {}
      }
    })

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
