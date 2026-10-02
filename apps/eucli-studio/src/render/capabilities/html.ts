import { decorateCodeBlocks, ensureCodeCopyHandlerOnce } from '../copy'
import type { RenderCapability } from '../contract'

// HTML 能力：负责两件事。
//   1. 整块认领：把整块原始 HTML（含内嵌 SVG）在进入 Markdown 前认领为块级占位，
//      防止 Markdown 遇空行结束 HTML 块、把后续元素包进 <p>，导致 SVG 图形被
//      浏览器丢弃。成品时原样放行整块 HTML。
//   2. 代码块装饰：给代码块挂复制按钮。
export function createHtmlCapability(): RenderCapability {
  return {
    id: 'html',
    claimHtmlBlock(raw: string, _ctx, claim): string | null {
      // 块级占位：让 Markdown 把它当独立 HTML 块原样保留，不被包进 <p>。
      return claim.push({ raw }, { block: true })
    },
    placeholder(data: unknown): string {
      const it = data as { raw?: string }
      return String(it?.raw || '')
    },
    decorate(fragment) {
      decorateCodeBlocks(fragment)
    },
    bind(host) {
      ensureCodeCopyHandlerOnce(host)
    },
    permissions: ['clipboard.writeText', 'ui.showToast'],
  }
}
