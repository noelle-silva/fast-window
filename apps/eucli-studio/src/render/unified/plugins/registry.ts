import type { MathClaim } from '../mathProtect'
import { rehypeSticker } from './rehypeSticker'
import { rehypeMathPlaceholder } from './rehypeMathPlaceholder'
import { rehypeRestoreHtmlBlock } from './rehypeRestoreHtmlBlock'
import { rehypeFence } from './rehypeFence'
import { rehypeMermaid } from './rehypeMermaid'
import { rehypeEscapeCode } from './rehypeEscapeCode'

// ============================================================================
// 渲染插件注册表
//
// 这是「新增渲染能力」唯一需要改动的地方。
// 引擎只遍历本清单，不认识任何具体插件；插件之间也互不认识。
//
// 新增一个渲染能力 = 写一个 rehype 插件 + 在下方清单加一项，引擎不动。
//
// 字段说明：
//   id          插件标识（仅用于诊断与调试）
//   phase       相对 rehype-raw 的位置：before-raw 先跑，after-raw 后跑
//   requiresRaw 仅在启用 rehype-raw 时才注册（依赖块内节点已展开）
//   plugin      unified 插件本体
//   options     按渲染上下文生成插件参数（可选）
// ============================================================================

export type RenderPluginPhase = 'before-raw' | 'after-raw'

// 一次渲染的上下文：插件按需取用，互不感知彼此。
export type RenderPluginContext = {
  stickersEnabled: boolean
  getStickerPath: ((category: string, name: string) => string) | null
  mathClaims: MathClaim[]
  htmlBlocks: string[]
}

export type RenderPluginEntry = {
  id: string
  phase: RenderPluginPhase
  requiresRaw?: boolean
  plugin: any
  options?: (ctx: RenderPluginContext) => any
}

export const RENDER_PLUGINS: RenderPluginEntry[] = [
  {
    id: 'restore-html-block',
    phase: 'before-raw',
    requiresRaw: true,
    plugin: rehypeRestoreHtmlBlock,
    options: (ctx) => ({ getBlocks: () => ctx.htmlBlocks }),
  },
  {
    id: 'fence',
    phase: 'after-raw',
    plugin: rehypeFence,
  },
  {
    id: 'sticker',
    phase: 'after-raw',
    plugin: rehypeSticker,
    options: (ctx) => ({ getCtx: () => ctx }),
  },
  {
    id: 'math-placeholder',
    phase: 'after-raw',
    plugin: rehypeMathPlaceholder,
    options: (ctx) => ({ getClaims: () => ctx.mathClaims }),
  },
  {
    id: 'mermaid',
    phase: 'after-raw',
    plugin: rehypeMermaid,
  },
  {
    id: 'escape-code',
    phase: 'after-raw',
    plugin: rehypeEscapeCode,
  },
]
