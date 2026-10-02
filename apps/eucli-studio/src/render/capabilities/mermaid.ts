import { esc } from '../../core/utils'
import { createMermaidSupport } from '../mermaid'
import type { RenderCapability } from '../contract'
import type { AiChatCapabilities } from '../../gateway/capabilities'
import type { BoolRef } from '../types'

const MERMAID_LANGS = new Set(['mermaid', 'flowchart', 'graph'])

// 图表能力：认领已闭合的 mermaid / flowchart / graph 代码围栏，产出成品态占位，
// 由 Mermaid 在受控容器内异步渲染。未闭合围栏不认领（保持草稿态）。
// 地盘、换班、善后规矩由 createMermaidSupport 的受控渲染与在位核对承担。
export function createMermaidCapability(deps: {
  mermaidInited: BoolRef
  mermaidSvgCache: Map<string, string>
  capabilities: AiChatCapabilities
}): RenderCapability {
  const support = createMermaidSupport(deps)
  return {
    id: 'mermaid',
    claimFence(lang: string, content: string, _ctx, claim) {
      const normalized = String(lang || '').trim().toLowerCase()
      if (!MERMAID_LANGS.has(normalized)) return null
      return claim.push(String(content || '').trim())
    },
    placeholder(data: unknown): string {
      return `<pre data-fw-mermaid-complete="1"><code class="language-mermaid">${esc(data)}</code></pre>`
    },
    init() {
      support.initMermaidOnce()
    },
    bind(host) {
      support.ensureMermaidBlockCopyHandlerOnce(host)
      support.ensureMermaidErrorCopyHandlerOnce(host)
      support.ensureMermaidErrorAiFixHandlerOnce(host)
    },
    enhance(ctx) {
      return support.renderMermaidInto(ctx.host, ctx.policy)
    },
    permissions: ['clipboard.writeImage', 'clipboard.writeText', 'ui.showToast'],
  }
}
