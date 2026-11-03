// 基准专用的「纯字符串 → HTML」解析管线。
//
// 主线程的完整渲染引擎同时承担解析、消毒与 DOM 提交，无法放进 Web Worker。
// 这里复用应用真实的解析前置模块、插件注册表与 unified 处理链，只把
// 「解析成 HTML 字符串」这一段单独装起来，供后台线程基准使用。
//
// 该文件不复制任何业务实现：预处理、插件、插件顺序全部来自 src/render。
// 它只镜像 engine.ts 中 createProcessor 的装配顺序，属于基准侧的解析装配。

import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import remarkRehype from 'remark-rehype'
import rehypeRaw from 'rehype-raw'
import rehypeStringify from 'rehype-stringify'

import { preprocessHtmlIndentation } from '../src/render/markdown'
import { RENDER_PLUGINS, type RenderPluginContext } from '../src/render/unified/plugins/registry'
import { protectMath, type MathClaim } from '../src/render/unified/mathProtect'
import { protectHtmlBlocks, demoteOpenFences } from '../src/render/unified/htmlProtect'

type PluginContext = RenderPluginContext

function applyPlugins(processor: any, phase: 'before-raw' | 'after-raw', withRaw: boolean, ctx: PluginContext) {
  let p = processor
  for (const entry of RENDER_PLUGINS) {
    if (entry.phase !== phase) continue
    if (entry.requiresRaw && !withRaw) continue
    p = entry.options ? p.use(entry.plugin, entry.options(ctx)) : p.use(entry.plugin)
  }
  return p
}

function createProcessor(withRaw: boolean, ctx: PluginContext) {
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

export type ParsePipeline = (source: string) => string

export function createParsePipeline(): ParsePipeline {
  const ctx: PluginContext = {
    stickersEnabled: false,
    getStickerPath: null,
    mathClaims: [] as MathClaim[],
    htmlBlocks: [] as string[],
  }

  const processorWithRaw = createProcessor(true, ctx)
  const processorNoRaw = createProcessor(false, ctx)

  return function parse(source: string): string {
    const noIndent = preprocessHtmlIndentation(source)
    const mathProtected = protectMath(noIndent)
    ctx.mathClaims = mathProtected.claims
    const htmlProtected = protectHtmlBlocks(mathProtected.text)
    ctx.htmlBlocks = htmlProtected.blocks
    const finalSource = demoteOpenFences(htmlProtected.text)
    const processor = ctx.htmlBlocks.length ? processorWithRaw : processorNoRaw
    return String(processor.processSync(finalSource))
  }
}
