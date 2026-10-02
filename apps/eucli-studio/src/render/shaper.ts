import { splitInlineCodeSpans, tokenizeFences } from './fences'
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
const PLACEHOLDER_RE = /@@FW_([A-Za-z0-9_-]+)_(\d+)@@/g

function createSink(capabilityId: string, claims: ShapedClaim[], counts: Map<string, number>): ClaimSink {
  return {
    push(data: unknown) {
      const index = counts.get(capabilityId) || 0
      counts.set(capabilityId, index + 1)
      claims.push({ capabilityId, data })
      return `@@FW_${capabilityId}_${index}@@`
    },
  }
}

function claimText(text: string, ctx: RenderContext, capabilities: RenderCapability[], claims: ShapedClaim[], counts: Map<string, number>): string {
  const parts = splitInlineCodeSpans(text)
  return parts
    .map((part) => {
      if (part.kind === 'code') return part.value
      let current = part.value
      for (const capability of capabilities) {
        if (!capability.claimText) continue
        current = capability.claimText(current, ctx, createSink(capability.id, claims, counts))
      }
      return current
    })
    .join('')
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

  return safe.replace(PLACEHOLDER_RE, (match, capabilityId: string, index: string) => {
    const capability = byId.get(capabilityId)
    if (!capability || !capability.placeholder) return match
    const list = grouped.get(capabilityId) || []
    const data = list[Number(index)]
    if (data === undefined) return match
    return capability.placeholder(data, ctx)
  })
}
