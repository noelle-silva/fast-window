import { messageCacheKey } from './messageCache'
import type { RenderSafetyPolicy } from './types'

// ============================================================================
// 渲染缓存键构造
//
// 引擎（同步渲染）与预计算（后台批量）必须落在同一个键上，否则后台算完
// 主线程命不中，等于白算。因此键的语义只在这里定义一次：
//   - policy：与消毒策略一致，未识别值一律按 original；
//   - capsSignature：贴纸开启与否 + 是否存在贴纸路径解析器；
//   - scope：会话身份；
//   - 流式中态与空 scope 不参与缓存，返回空键。
// ============================================================================

export function normalizeRenderSafetyPolicy(value: unknown): RenderSafetyPolicy {
  return value === 'unsafe' ? 'unsafe' : value === 'baseline' ? 'baseline' : 'original'
}

export type AssistantRenderCacheKeyInput = {
  source: unknown
  policy?: unknown
  stickersEnabled?: boolean
  hasStickerPath?: boolean
  scope?: unknown
  streaming?: boolean
}

export function assistantRenderCacheKey(input: AssistantRenderCacheKeyInput): string {
  if (input.streaming) return ''
  const scope = String(input.scope || '')
  if (!scope) return ''
  return messageCacheKey({
    source: String(input.source || ''),
    policy: normalizeRenderSafetyPolicy(input.policy),
    capsSignature: `${input.stickersEnabled ? 1 : 0}:${input.hasStickerPath ? 1 : 0}`,
    scope,
  })
}
