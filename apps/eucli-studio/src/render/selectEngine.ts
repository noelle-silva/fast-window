import type { AiChatCapabilities } from '../gateway/capabilities'
import { createDefaultAssistantRenderEngine, type AssistantRenderEngine } from './assistantEngineDefault'
import { createUnifiedAssistantRenderEngine } from './unified/engine'

// ============================================================================
// 渲染引擎选择（迁移期开关）
//
// 新旧两套引擎并存：
//   legacy  —— 自研字符串管线（旧）
//   unified —— unified 生态管线（新）
//
// 切换方式（迁移期临时机制，验收通过后随旧引擎一并移除）：
//   localStorage.setItem('fw-render-engine', 'unified' | 'legacy')
//   或控制台调用 window.__fwSetRenderEngine('unified')
// ============================================================================

const STORAGE_KEY = 'fw-render-engine'

export type RenderEngineKind = 'legacy' | 'unified'

export function getRenderEngineKind(): RenderEngineKind {
  try {
    const value = String(localStorage.getItem(STORAGE_KEY) || '')
      .trim()
      .toLowerCase()
    // 迁移期默认使用 unified；显式设为 legacy 可随时回退。
    if (value === 'legacy') return 'legacy'
    if (value === 'unified') return 'unified'
  } catch (_) {}
  return 'unified'
}

export function setRenderEngineKind(kind: RenderEngineKind) {
  try {
    localStorage.setItem(STORAGE_KEY, kind === 'unified' ? 'unified' : 'legacy')
  } catch (_) {}
}

export function createAssistantRenderEngine(capabilities: AiChatCapabilities): AssistantRenderEngine {
  // 迁移期便捷入口：控制台可读写当前引擎。
  try {
    const w = window as any
    w.__fwSetRenderEngine = setRenderEngineKind
    w.__fwGetRenderEngine = getRenderEngineKind
  } catch (_) {}

  return getRenderEngineKind() === 'unified'
    ? (createUnifiedAssistantRenderEngine(capabilities) as AssistantRenderEngine)
    : createDefaultAssistantRenderEngine(capabilities)
}
