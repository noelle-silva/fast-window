import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import remarkRehype from 'remark-rehype'
import rehypeRaw from 'rehype-raw'
import rehypeStringify from 'rehype-stringify'

import { preprocessHtmlIndentation } from '../markdown'
import type { RenderPluginContext } from './plugins/registry'
import { RENDER_PLUGINS } from './plugins/registry'
import { protectMath } from './mathProtect'
import { protectHtmlBlocks, demoteOpenFences } from './htmlProtect'

// ============================================================================
// unified 纯计算管线：字符串 → HTML 字符串。
//
// 这是引擎与 Worker 共用的唯一解析底座：
//   - 主线程引擎只关心「何时解析、失败如何降级、结果如何提交」
//   - Worker 只关心「收到文本、算完回传」
// 两边因此不会出现插件顺序、raw 开关或保护步骤的漂移。
//
// 本模块禁止引入任何 DOM / 全局能力依赖，可在 Web Worker 中直接运行。
// ============================================================================

// 动态插件注册表让 unified 的泛型无法静态收敛；这里与 engine 原先的写法一致，
// 只在编排层放宽类型，协议与业务数据不使用 any。
type UnifiedProcessor = any

function applyPlugins(
  processor: UnifiedProcessor,
  phase: 'before-raw' | 'after-raw',
  withRaw: boolean,
  ctx: RenderPluginContext,
) {
  let p = processor
  for (const entry of RENDER_PLUGINS) {
    if (entry.phase !== phase) continue
    if (entry.requiresRaw && !withRaw) continue
    p = entry.options ? p.use(entry.plugin, entry.options(ctx)) : p.use(entry.plugin)
  }
  return p
}

function createProcessor(ctx: RenderPluginContext, withRaw: boolean) {
  // 解析底座（固定）：Markdown 语法 + GFM 扩展 + 单换行语义。
  let p = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkBreaks)
    .use(remarkRehype, { allowDangerousHtml: true })

  p = applyPlugins(p, 'before-raw', withRaw, ctx)
  if (withRaw) p = p.use(rehypeRaw)
  p = applyPlugins(p, 'after-raw', withRaw, ctx)

  return p.use(rehypeStringify, { allowDangerousHtml: true })
}

export type UnifiedPipeline = {
  render: (source: string) => string
}

export function createUnifiedPipeline(ctx: RenderPluginContext): UnifiedPipeline {
  // 两条管线：只有内容里真的含 HTML 块时，才启用 rehype-raw。
  //
  // rehype-raw 会用 parse5 把整棵树重新解析一遍，是解析阶段最大的单点开销；
  // 而绝大多数消息里根本没有 HTML 块。按需启用可在不损失能力的前提下省掉这笔钱。
  const processorWithRaw = createProcessor(ctx, true)
  const processorNoRaw = createProcessor(ctx, false)

  function render(source: string): string {
    // HTML 缩进去缩进：AI 输出的缩进 HTML 若保留 4 空格，会被 Markdown 当成代码块。
    const noIndent = preprocessHtmlIndentation(source)
    // 公式必须在 Markdown 解析前保护：否则 TeX 里的反斜杠命令（\, \\ \| 等）会被当成 Markdown 转义吃掉。
    const mathProtected = protectMath(noIndent)
    ctx.mathClaims = mathProtected.claims
    // HTML 块必须在 Markdown 解析前整块保护：块内空行会让 Markdown 提前结束该块，把 SVG 后半截拆出去。
    const htmlProtected = protectHtmlBlocks(mathProtected.text)
    ctx.htmlBlocks = htmlProtected.blocks
    // 未闭合围栏去掉语言标记，保持草稿态（不进入专用渲染）。
    const finalSource = demoteOpenFences(htmlProtected.text)
    // 有 HTML 块才启用 rehype-raw（parse5 重解析是解析阶段最大的单点开销）。
    const processor = ctx.htmlBlocks.length ? processorWithRaw : processorNoRaw
    return String(processor.processSync(finalSource))
  }

  return { render }
}
