import katex from 'katex'

import { createUnifiedPipeline } from '../unified/pipeline'
import type { RenderPluginContext } from '../unified/plugins/registry'

// ============================================================================
// Worker 纯计算层
//
// 只做两件事：
//   1. Markdown 文本 → HTML 字符串（与主线程引擎共用同一条 unified 管线）
//   2. TeX → KaTeX HTML 字符串
//
// 不接触 DOM、不消毒、不提交、不装饰。消毒与提交仍由主线程能力完成，
// 因此这里产出的 HTML 与引擎解析阶段的结果逐字节一致。
// ============================================================================

export type MarkdownComputeOptions = {
  stickersEnabled?: boolean
  getStickerPath?: (category: string, name: string) => string
}

export type MarkdownComputer = {
  renderMarkdown: (source: string, options?: MarkdownComputeOptions) => string
  renderMath: (tex: string, display: boolean) => string
}

export function createMarkdownComputer(): MarkdownComputer {
  // processSync 是同步的，Worker 内不存在并发交错，因此上下文可安全复用。
  const ctx: RenderPluginContext = {
    stickersEnabled: false,
    getStickerPath: null,
    mathClaims: [],
    htmlBlocks: [],
  }

  const pipeline = createUnifiedPipeline(ctx)

  function renderMarkdown(source: string, options?: MarkdownComputeOptions): string {
    ctx.stickersEnabled = !!options?.stickersEnabled
    ctx.getStickerPath = typeof options?.getStickerPath === 'function' ? options.getStickerPath : null
    return pipeline.render(String(source || ''))
  }

  function renderMath(tex: string, display: boolean): string {
    return katex.renderToString(String(tex || ''), {
      displayMode: !!display,
      throwOnError: false,
    })
  }

  return { renderMarkdown, renderMath }
}
