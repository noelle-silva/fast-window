import { splitInlineCodeSpans, tokenizeFences } from './fences'
import { findHtmlBlocks } from './htmlBlocks'
import type { ClaimSink, RenderCapability, RenderContext } from './contract'

// ============================================================================
// 内容形态层：唯一的「读懂内容」入口。
//
// 只干一件事——把原始内容切成片段，每个片段标明类型与状态，并交给能力认领。
// 内容理解由能力通过契约提供，本层不识别任何具体能力。
//
// 半成品规矩：只有已闭合的代码围栏才交给能力认领；未闭合围栏保持原文，
// 由 Markdown 基础渲染为草稿态，绝不进入易失败的专用渲染。
// ============================================================================

export type ShapedClaim = {
  capabilityId: string
  data: unknown
}

export type ShapedContent = {
  text: string
  claims: ShapedClaim[]
}

// 占位符由本层统一生成：能力只管认领数据，格式不外泄。
// 行内占位（公式 / 贴纸）用纯文本标记；块级占位（HTML 块）用空 div，
// 让 Markdown 把它当独立 HTML 块原样保留，不被包进 <p>。
const INLINE_PLACEHOLDER_RE = /@@FW_([A-Za-z0-9_-]+)_(\d+)@@/g
const BLOCK_PLACEHOLDER_RE = /<div data-fw-claim="([A-Za-z0-9_-]+)" data-fw-claim-id="(\d+)"><\/div>/g

function createSink(capabilityId: string, claims: ShapedClaim[], counts: Map<string, number>): ClaimSink {
  return {
    push(data: unknown, options?: { block?: boolean }) {
      const index = counts.get(capabilityId) || 0
      counts.set(capabilityId, index + 1)
      claims.push({ capabilityId, data })
      if (options?.block) return `<div data-fw-claim="${capabilityId}" data-fw-claim-id="${index}"></div>`
      return `@@FW_${capabilityId}_${index}@@`
    },
  }
}

function claimInlineText(text: string, ctx: RenderContext, capabilities: RenderCapability[], claims: ShapedClaim[], counts: Map<string, number>): string {
  let current = text
  for (const capability of capabilities) {
    if (!capability.claimText) continue
    current = capability.claimText(current, ctx, createSink(capability.id, claims, counts))
  }
  return current
}

// claimText 处理一段普通文本：先切出行内代码（不参与认领），再在非代码区里
// 优先整块认领 HTML 块（防止 Markdown 破坏），剩余部分交给能力做行内认领。
function claimText(text: string, ctx: RenderContext, capabilities: RenderCapability[], claims: ShapedClaim[], counts: Map<string, number>): string {
  const parts = splitInlineCodeSpans(text)
  return parts
    .map((part) => {
      if (part.kind === 'code') return part.value
      return claimHtmlBlocksIn(part.value, ctx, capabilities, claims, counts)
    })
    .join('')
}

// 在文本中识别整块 HTML，交给声明了 claimHtmlBlock 的能力认领。
// 半成品规矩：未闭合的 HTML 块保持原文（草稿态），不进入认领。
function claimHtmlBlocksIn(text: string, ctx: RenderContext, capabilities: RenderCapability[], claims: ShapedClaim[], counts: Map<string, number>): string {
  const blocks = findHtmlBlocks(text)
  if (!blocks.length) return claimInlineText(text, ctx, capabilities, claims, counts)

  const out: string[] = []
  let cursor = 0
  for (const block of blocks) {
    if (block.start > cursor) out.push(claimInlineText(text.slice(cursor, block.start), ctx, capabilities, claims, counts))

    let replaced: string | null = null
    if (block.closed) {
      for (const capability of capabilities) {
        if (!capability.claimHtmlBlock) continue
        const result = capability.claimHtmlBlock(block.raw, ctx, createSink(capability.id, claims, counts))
        if (result != null) {
          replaced = result
          break
        }
      }
    }
    out.push(replaced != null ? replaced : block.raw)
    cursor = block.end
  }
  if (cursor < text.length) out.push(claimInlineText(text.slice(cursor), ctx, capabilities, claims, counts))
  return out.join('')
}

export function shapeContent(source: string, ctx: RenderContext, capabilities: RenderCapability[]): ShapedContent {
  const tokens = tokenizeFences(source)
  const claims: ShapedClaim[] = []
  const counts = new Map<string, number>()
  const out: string[] = []

  for (const token of tokens) {
    if (token.kind === 'fence') {
      let replaced: string | null = null
      if (token.closed) {
        for (const capability of capabilities) {
          if (!capability.claimFence) continue
          const result = capability.claimFence(token.lang, token.content, ctx, createSink(capability.id, claims, counts))
          if (result != null) {
            replaced = result
            break
          }
        }
      }
      out.push(replaced != null ? replaced : token.raw)
      continue
    }

    out.push(claimText(token.text, ctx, capabilities, claims, counts))
  }

  return { text: out.join(''), claims }
}

// 把占位符替换为各能力产出的成品 HTML 片段。
export function substituteClaims(safe: string, claims: ShapedClaim[], ctx: RenderContext, capabilities: RenderCapability[]): string {
  if (!claims.length) return safe

  const byId = new Map(capabilities.map((capability) => [capability.id, capability]))
  const grouped = new Map<string, unknown[]>()
  for (const claim of claims) {
    const list = grouped.get(claim.capabilityId) || []
    list.push(claim.data)
    grouped.set(claim.capabilityId, list)
  }

  const replaceOne = (match: string, capabilityId: string, index: string) => {
    const capability = byId.get(capabilityId)
    if (!capability || !capability.placeholder) return match
    const list = grouped.get(capabilityId) || []
    const data = list[Number(index)]
    if (data === undefined) return match
    return capability.placeholder(data, ctx)
  }

  return safe.replace(BLOCK_PLACEHOLDER_RE, replaceOne).replace(INLINE_PLACEHOLDER_RE, replaceOne)
}
